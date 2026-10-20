//! Native screen capture streamed to the frontend.
//!
//! WKWebView (Tauri on macOS) does not expose `navigator.mediaDevices.getDisplayMedia`,
//! so browser screen capture is unavailable in the desktop app. Instead we capture
//! the screen natively with ScreenCaptureKit, downscale + JPEG-encode each frame in a
//! background thread (to stay well within the IPC bandwidth budget — JPEG is ~10-20x
//! smaller than raw BGRA), and stream the frames to the frontend over a Tauri Channel.
//! The frontend decodes each JPEG into a canvas that feeds the existing 2x2 composite +
//! WebCodecs encode pipeline, so cameras and mic stay on the browser side unchanged.

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::JoinHandle;
use std::time::Duration;

use image::{ExtendedColorType, ImageBuffer, RgbaImage, codecs::jpeg::JpegEncoder};
use parking_lot::{Condvar, Mutex};
use tauri::ipc::{Channel, InvokeResponseBody};

use crate::screen::{
    CaptureRegion, CaptureSize, DisplayGeometry, ScreenCapture, ScreenCaptureConfig,
};
use crate::screen_preview::PreviewError;

/// JPEG quality (0-100) for streamed preview/composite frames.
const JPEG_QUALITY: u8 = 80;
/// How long the worker waits for a frame before re-checking the stop flag.
/// Kept short so stop()/replacement observes the flag (and returns) promptly.
const RECV_TIMEOUT: Duration = Duration::from_millis(100);
/// Maximum frames in flight from worker to JS decoder at once (ack-based backpressure).
const MAX_INFLIGHT: u32 = 2;

struct StreamHandle {
    stream_id: String,
    running: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
    /// Ack-based backpressure credit shared with the worker. ack_screen_frame
    /// increments it; the worker decrements before each Channel::send.
    credit: Arc<(Mutex<u32>, Condvar)>,
    #[cfg(target_os = "macos")]
    frames: crate::latest_frame::LatestFrame<crate::screen::ScreenFrame>,
}

impl StreamHandle {
    fn stop(mut self) {
        self.running.store(false, Ordering::Relaxed);
        self.credit.1.notify_all();
        #[cfg(target_os = "macos")]
        self.frames.close();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

impl Drop for StreamHandle {
    fn drop(&mut self) {
        // Safety net: if a handle is dropped without stop() (e.g. it was
        // overwritten in the map by a racing start), signal its worker to exit.
        // We deliberately do NOT join here — the worker is detached and exits on
        // its own within RECV_TIMEOUT, calling capture.stop() — so Drop never
        // blocks or deadlocks (it may run while the streams mutex is held).
        self.running.store(false, Ordering::Relaxed);
        self.credit.1.notify_all();
    }
}

/// Managed state holding one active capture stream per section index.
#[derive(Default)]
pub struct ScreenStreamState {
    slots: Mutex<HashMap<u32, StreamSlot>>,
}

#[derive(Default)]
struct StreamSlot {
    generation: u64,
    pending_id: Option<String>,
    stream: Option<StreamHandle>,
}

impl ScreenStreamState {
    fn reserve(&self, section: u32, stream_id: &str) -> u64 {
        let mut slots = self.slots.lock();
        let slot = slots.entry(section).or_default();
        slot.generation += 1;
        slot.pending_id = Some(stream_id.to_string());
        slot.generation
    }

    fn commit(
        &self,
        section: u32,
        generation: u64,
        stream: StreamHandle,
    ) -> Result<Option<StreamHandle>, StreamHandle> {
        let mut slots = self.slots.lock();
        let slot = slots.entry(section).or_default();
        if slot.generation != generation {
            return Err(stream);
        }
        slot.pending_id = None;
        Ok(slot.stream.replace(stream))
    }

    #[cfg(test)]
    fn remove(&self, section: u32) -> Option<StreamHandle> {
        self.remove_matching(section, None)
    }

    fn remove_matching(&self, section: u32, stream_id: Option<&str>) -> Option<StreamHandle> {
        let mut slots = self.slots.lock();
        let slot = slots.entry(section).or_default();
        if stream_id.is_none() || slot.pending_id.as_deref() == stream_id {
            slot.generation += 1;
            slot.pending_id = None;
        }
        if stream_id.is_none() || slot.stream.as_ref().map(|s| s.stream_id.as_str()) == stream_id {
            slot.stream.take()
        } else {
            None
        }
    }

    fn acknowledge(&self, section: u32, stream_id: &str) {
        if let Some(stream) = self
            .slots
            .lock()
            .get(&section)
            .and_then(|s| s.stream.as_ref())
        {
            if stream.stream_id == stream_id {
                return_credit(&stream.credit);
            }
        }
    }
}

fn return_credit(credit: &Arc<(Mutex<u32>, Condvar)>) {
    let (m, cv) = &**credit;
    let mut count = m.lock();
    *count = (*count + 1).min(MAX_INFLIGHT);
    cv.notify_one();
}

/// Reserve capacity before conversion, then take the newest captured frame.
fn reserve_credit(credit: &Arc<(Mutex<u32>, Condvar)>, running: &AtomicBool) -> bool {
    let (m, cv) = &**credit;
    let mut count = m.lock();
    while *count == 0 && running.load(Ordering::Relaxed) {
        cv.wait_for(&mut count, RECV_TIMEOUT);
    }
    if !running.load(Ordering::Relaxed) {
        return false;
    }
    *count -= 1;
    true
}

/// Downscale a BGRA screen frame to fit within `max_dimension` and JPEG-encode it.
fn encode_frame(
    rgba: RgbaImage,
    src_w: u32,
    src_h: u32,
    max_dimension: u32,
) -> Result<(Vec<u8>, u32, u32), String> {
    // Preserve aspect ratio; never upscale.
    let longest = src_w.max(src_h).max(1);
    let scale = (max_dimension as f32 / longest as f32).min(1.0);
    let target_w = ((src_w as f32 * scale).round() as u32).max(1);
    let target_h = ((src_h as f32 * scale).round() as u32).max(1);

    let resized = if target_w == src_w && target_h == src_h {
        rgba
    } else {
        image::imageops::resize(
            &rgba,
            target_w,
            target_h,
            image::imageops::FilterType::Triangle,
        )
    };

    // JPEG has no alpha channel — drop it.
    let rgb = image::DynamicImage::ImageRgba8(resized).into_rgb8();

    let mut buf = Vec::new();
    let mut encoder = JpegEncoder::new_with_quality(&mut buf, JPEG_QUALITY);
    encoder
        .encode(
            rgb.as_raw(),
            rgb.width(),
            rgb.height(),
            ExtendedColorType::Rgb8,
        )
        .map_err(|e| format!("JPEG encode failed: {}", e))?;

    Ok((buf, target_w, target_h))
}

/// Start streaming a display to the frontend over `on_frame`.
///
/// Prepare a replacement before releasing the current stream. Returns an error if the
/// capture cannot be initialized (e.g. Screen Recording permission not granted).
#[tauri::command]
pub async fn start_screen_stream(
    section_index: u32,
    stream_id: String,
    display_index: usize,
    display_id: Option<u32>,
    expected_geometry: Option<DisplayGeometry>,
    fps: u32,
    max_dimension: u32,
    target_size: Option<CaptureSize>,
    region: Option<CaptureRegion>,
    on_frame: Channel<InvokeResponseBody>,
    state: tauri::State<'_, Arc<ScreenStreamState>>,
) -> Result<(), PreviewError> {
    let state = state.inner().clone();
    let generation = state.reserve(section_index, &stream_id);
    tauri::async_runtime::spawn_blocking(move || {
        start_stream(
            section_index,
            stream_id,
            display_index,
            display_id,
            expected_geometry,
            fps,
            max_dimension,
            target_size,
            region,
            on_frame,
            state,
            generation,
        )
    })
    .await
    .map_err(PreviewError::capture)?
}

fn start_stream(
    section_index: u32,
    stream_id: String,
    display_index: usize,
    display_id: Option<u32>,
    expected_geometry: Option<DisplayGeometry>,
    fps: u32,
    max_dimension: u32,
    target_size: Option<CaptureSize>,
    region: Option<CaptureRegion>,
    on_frame: Channel<InvokeResponseBody>,
    state: Arc<ScreenStreamState>,
    generation: u64,
) -> Result<(), PreviewError> {
    let mut capture = ScreenCapture::new(ScreenCaptureConfig {
        fps,
        display_index,
        display_id,
        expected_geometry,
        region,
        target_size,
    })
    .map_err(PreviewError::capture)?;

    let receiver = capture
        .take_receiver()
        .ok_or_else(|| PreviewError::new("captureFailed", "Screen capture receiver unavailable"))?;

    capture.start().map_err(PreviewError::capture)?;

    let running = Arc::new(AtomicBool::new(true));
    let worker_running = running.clone();
    let published = Arc::new(AtomicBool::new(false));
    let worker_published = published.clone();

    let credit = Arc::new((Mutex::new(MAX_INFLIGHT), Condvar::new()));
    let worker_credit = credit.clone();
    #[cfg(target_os = "macos")]
    let wake_frames = receiver.clone();

    let worker = std::thread::spawn(move || {
        // `capture` is moved in so the SCStream stays alive for the worker's lifetime
        // and is stopped when the loop exits.
        let mut sent: u64 = 0;
        let mut errors: u64 = 0;

        // No candidate frames reach JS until its replacement is committed.
        while !worker_published.load(Ordering::Acquire) && worker_running.load(Ordering::Relaxed) {
            std::thread::sleep(Duration::from_millis(10));
        }
        while worker_running.load(Ordering::Relaxed) {
            if !reserve_credit(&worker_credit, &worker_running) {
                break;
            }
            let frame = match receiver.recv_timeout(RECV_TIMEOUT) {
                Ok(frame) => frame,
                Err(crossbeam_channel::RecvTimeoutError::Timeout) => {
                    return_credit(&worker_credit);
                    continue;
                }
                Err(crossbeam_channel::RecvTimeoutError::Disconnected) => {
                    return_credit(&worker_credit);
                    break;
                }
            };

            // Drain to the latest frame so the preview/composite never lags behind.
            let mut latest = frame;
            while let Ok(newer) = receiver.try_recv() {
                latest = newer;
            }

            let (src_w, src_h) = (latest.width, latest.height);
            let timestamp_ms = latest.timestamp.as_millis() as u64;

            // BGRA (with stride) -> packed RGBA for the image crate.
            let rgba_data = latest.to_rgba();
            let Some(rgba): Option<RgbaImage> = ImageBuffer::from_raw(src_w, src_h, rgba_data)
            else {
                errors += 1;
                return_credit(&worker_credit);
                continue;
            };

            match encode_frame(rgba, src_w, src_h, max_dimension) {
                Ok((jpeg, width, height)) => {
                    // 16-byte LE header: u32 width, u32 height, u64 timestamp_ms
                    let mut payload = Vec::with_capacity(16 + jpeg.len());
                    payload.extend_from_slice(&width.to_le_bytes());
                    payload.extend_from_slice(&height.to_le_bytes());
                    payload.extend_from_slice(&timestamp_ms.to_le_bytes());
                    payload.extend_from_slice(&jpeg);

                    if on_frame.send(InvokeResponseBody::Raw(payload)).is_err() {
                        return_credit(&worker_credit);
                        // Frontend dropped the channel — stop streaming.
                        break;
                    }
                    sent += 1;
                }
                Err(e) => {
                    return_credit(&worker_credit);
                    errors += 1;
                    if errors == 1 || errors % 60 == 0 {
                        eprintln!("[screen_stream] encode error ({}): {}", errors, e);
                    }
                }
            }
        }

        capture.stop();
        println!(
            "[screen_stream] section {} stopped: {} frames sent, {} errors",
            section_index, sent, errors
        );
    });

    let candidate = StreamHandle {
        stream_id,
        running,
        worker: Some(worker),
        credit,
        #[cfg(target_os = "macos")]
        frames: wake_frames,
    };
    match state.commit(section_index, generation, candidate) {
        Ok(previous) => {
            if let Some(previous) = previous {
                previous.stop();
            }
            published.store(true, Ordering::Release);
        }
        Err(cancelled) => {
            cancelled.stop();
            return Err(PreviewError::new(
                "cancelled",
                "Screen selection was cancelled.",
            ));
        }
    }

    println!(
        "[screen_stream] section {} started: display {}, {}fps, max {}px",
        section_index, display_index, fps, max_dimension
    );

    Ok(())
}

/// Stop the stream for a section (no-op if none is running).
#[tauri::command]
pub async fn stop_screen_stream(
    section_index: u32,
    stream_id: Option<String>,
    state: tauri::State<'_, Arc<ScreenStreamState>>,
) -> Result<(), String> {
    let handle = state.remove_matching(section_index, stream_id.as_deref());
    if let Some(handle) = handle {
        handle.stop();
    }
    Ok(())
}

/// Acknowledge a delivered frame, restoring one unit of backpressure credit.
///
/// Called by the frontend after each `createImageBitmap` resolves. Always call
/// this (even on decode failure) so a single bad frame can't starve the worker.
#[tauri::command]
pub fn ack_screen_frame(
    section_index: u32,
    stream_id: String,
    state: tauri::State<'_, Arc<ScreenStreamState>>,
) {
    state.acknowledge(section_index, &stream_id);
}

#[cfg(test)]
mod tests {
    use super::*;
    fn handle() -> StreamHandle {
        StreamHandle {
            stream_id: "test".into(),
            #[cfg(target_os = "macos")]
            frames: crate::latest_frame::LatestFrame::default(),
            running: Arc::new(AtomicBool::new(true)),
            worker: None,
            credit: Arc::new((Mutex::new(MAX_INFLIGHT), Condvar::new())),
        }
    }
    #[test]
    fn failed_preparation_keeps_existing_stream_and_stop_cancels_pending_start() {
        let state = ScreenStreamState::default();
        let first = state.reserve(0, "test");
        assert!(state.commit(0, first, handle()).is_ok());
        let pending = state.reserve(0, "test");
        // A failed preparation never reaches commit.
        assert!(state.slots.lock()[&0].stream.is_some());
        state.remove(0).unwrap().stop();
        assert!(state.commit(0, pending, handle()).is_err());
        assert!(state.slots.lock()[&0].stream.is_none());
    }
    #[test]
    fn only_latest_replacement_can_commit() {
        let state = ScreenStreamState::default();
        let old = state.reserve(0, "test");
        let new = state.reserve(0, "test");
        assert!(state.commit(0, old, handle()).is_err());
        assert!(state.commit(0, new, handle()).is_ok());
    }
    #[test]
    fn retired_ack_and_stop_cannot_affect_replacement() {
        let state = ScreenStreamState::default();
        let generation = state.reserve(0, "new");
        let mut stream = handle();
        stream.stream_id = "new".into();
        *stream.credit.0.lock() = 0;
        let credit = stream.credit.clone();
        assert!(state.commit(0, generation, stream).is_ok());
        state.acknowledge(0, "old");
        assert_eq!(*credit.0.lock(), 0);
        assert!(state.remove_matching(0, Some("old")).is_none());
        state.acknowledge(0, "new");
        assert_eq!(*credit.0.lock(), 1);
    }
    #[test]
    fn capacity_is_reserved_before_taking_latest_frame_and_stop_wakes_wait() {
        let credit = Arc::new((Mutex::new(0), Condvar::new()));
        let running = Arc::new(AtomicBool::new(true));
        let frames = crate::latest_frame::LatestFrame::default();
        frames.publish_with(|| 1);
        let (tx, rx) = std::sync::mpsc::channel();
        let (c, r, f) = (credit.clone(), running.clone(), frames.clone());
        let worker = std::thread::spawn(move || {
            tx.send(()).unwrap();
            if reserve_credit(&c, &r) {
                f.try_recv().ok()
            } else {
                None
            }
        });
        rx.recv().unwrap();
        frames.publish_with(|| 2);
        return_credit(&credit);
        assert_eq!(worker.join().unwrap(), Some(2));
        let (c, r) = (credit.clone(), running.clone());
        let worker = std::thread::spawn(move || reserve_credit(&c, &r));
        running.store(false, Ordering::Relaxed);
        credit.1.notify_all();
        assert!(!worker.join().unwrap());
    }
}

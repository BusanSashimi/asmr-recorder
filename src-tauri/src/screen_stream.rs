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
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

use image::{codecs::jpeg::JpegEncoder, ExtendedColorType, ImageBuffer, RgbaImage};
use parking_lot::{Condvar, Mutex};
use tauri::ipc::{Channel, InvokeResponseBody};

use crate::screen::{CaptureRegion, ScreenCapture, ScreenCaptureConfig};

/// JPEG quality (0-100) for streamed preview/composite frames.
const JPEG_QUALITY: u8 = 80;
/// How long the worker waits for a frame before re-checking the stop flag.
/// Kept short so stop()/replacement observes the flag (and returns) promptly.
const RECV_TIMEOUT: Duration = Duration::from_millis(100);
/// Maximum frames in flight from worker to JS decoder at once (ack-based backpressure).
const MAX_INFLIGHT: u32 = 2;

struct StreamHandle {
    running: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
    /// Ack-based backpressure credit shared with the worker. ack_screen_frame
    /// increments it; the worker decrements before each Channel::send.
    credit: Arc<(Mutex<u32>, Condvar)>,
}

impl StreamHandle {
    fn stop(mut self) {
        self.running.store(false, Ordering::Relaxed);
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
    }
}

/// Managed state holding one active capture stream per section index.
#[derive(Default)]
pub struct ScreenStreamState {
    streams: Mutex<HashMap<u32, StreamHandle>>,
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
        .encode(rgb.as_raw(), rgb.width(), rgb.height(), ExtendedColorType::Rgb8)
        .map_err(|e| format!("JPEG encode failed: {}", e))?;

    Ok((buf, target_w, target_h))
}

/// Start streaming a display to the frontend over `on_frame`.
///
/// Any existing stream for `section_index` is stopped first. Returns an error if the
/// capture cannot be initialized (e.g. Screen Recording permission not granted).
#[tauri::command]
pub async fn start_screen_stream(
    section_index: u32,
    display_index: usize,
    fps: u32,
    max_dimension: u32,
    region: Option<CaptureRegion>,
    on_frame: Channel<InvokeResponseBody>,
    state: tauri::State<'_, Arc<ScreenStreamState>>,
) -> Result<(), String> {
    // Stop any existing stream for this section before starting a new one.
    // Bind to a local first so the mutex guard is released before the blocking
    // join inside stop().
    let existing = state.streams.lock().remove(&section_index);
    if let Some(existing) = existing {
        existing.stop();
    }

    let mut capture = ScreenCapture::new(ScreenCaptureConfig { fps, display_index, region })
        .map_err(|e| {
            let lower = e.to_lowercase();
            if lower.contains("permission") || lower.contains("screen recording") {
                "Screen Recording permission required. Open System Settings → Privacy & Security → Screen Recording and enable access for this app.".to_string()
            } else {
                format!("Failed to initialize screen capture: {}", e)
            }
        })?;

    let receiver = capture
        .take_receiver()
        .ok_or("Screen capture receiver unavailable")?;

    capture.start()?;

    let running = Arc::new(AtomicBool::new(true));
    let worker_running = running.clone();

    let credit = Arc::new((Mutex::new(MAX_INFLIGHT), Condvar::new()));
    let worker_credit = credit.clone();

    let worker = std::thread::spawn(move || {
        // `capture` is moved in so the SCStream stays alive for the worker's lifetime
        // and is stopped when the loop exits.
        let mut sent: u64 = 0;
        let mut errors: u64 = 0;

        while worker_running.load(Ordering::Relaxed) {
            let frame = match receiver.recv_timeout(RECV_TIMEOUT) {
                Ok(frame) => frame,
                Err(crossbeam_channel::RecvTimeoutError::Timeout) => continue,
                Err(crossbeam_channel::RecvTimeoutError::Disconnected) => break,
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

                    // Block until the JS decoder has capacity (ack-based backpressure).
                    // wait_for uses RECV_TIMEOUT so a stopped frontend never deadlocks.
                    {
                        let (m, cv) = &*worker_credit;
                        let mut c = m.lock();
                        while *c == 0 && worker_running.load(Ordering::Relaxed) {
                            cv.wait_for(&mut c, RECV_TIMEOUT);
                        }
                        if !worker_running.load(Ordering::Relaxed) { break; }
                        *c -= 1;
                    }

                    if on_frame.send(InvokeResponseBody::Raw(payload)).is_err() {
                        // Frontend dropped the channel — stop streaming.
                        break;
                    }
                    sent += 1;
                }
                Err(e) => {
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

    // Insert atomically; if a racing start already inserted one for this section,
    // stop the replaced handle gracefully so its worker + SCStream don't leak.
    let replaced = state.streams.lock().insert(
        section_index,
        StreamHandle {
            running,
            worker: Some(worker),
            credit,
        },
    );
    if let Some(replaced) = replaced {
        replaced.stop();
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
    state: tauri::State<'_, Arc<ScreenStreamState>>,
) -> Result<(), String> {
    let handle = state.streams.lock().remove(&section_index);
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
    state: tauri::State<'_, Arc<ScreenStreamState>>,
) {
    if let Some(h) = state.streams.lock().get(&section_index) {
        let (m, cv) = &*h.credit;
        let mut c = m.lock();
        if *c < MAX_INFLIGHT {
            *c += 1;
            cv.notify_one();
        }
    }
}

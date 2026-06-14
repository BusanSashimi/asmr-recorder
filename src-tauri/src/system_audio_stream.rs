//! Native system-audio capture streamed to the frontend.
//!
//! WKWebView (Tauri on macOS) does not expose `navigator.mediaDevices.getDisplayMedia`,
//! so browser system-audio capture is unavailable in the desktop app. Instead we capture
//! system audio natively via ScreenCaptureKit (see `system_audio_macos.rs`), then stream
//! the raw interleaved f32 PCM to the frontend over a Tauri Channel. The frontend mixes
//! it into the recording AudioContext alongside the mic track.
//!
//! The transport mirrors `screen_stream.rs`: ack-based backpressure via a Condvar credit
//! counter, so a stalled frontend can't pile unbounded Raw messages into the webview.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

use parking_lot::{Condvar, Mutex};
use tauri::ipc::{Channel, InvokeResponseBody};

use crate::system_audio::{SystemAudioCapture, SystemAudioCaptureConfig};

/// How long the worker waits for a chunk before re-checking the stop flag.
const RECV_TIMEOUT: Duration = Duration::from_millis(100);
/// Maximum in-flight audio chunks. Audio is low-bandwidth (48 kHz × 2 × 4 B ≈ 384 KB/s)
/// so a larger credit than the screen path (MAX_INFLIGHT = 2) is fine; SCK's bounded(30)
/// channel already drops on overflow so the worker can't accumulate unbounded chunks.
const MAX_INFLIGHT: u32 = 8;

struct SysAudioHandle {
    running: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
    credit: Arc<(Mutex<u32>, Condvar)>,
}

impl SysAudioHandle {
    fn stop(mut self) {
        self.running.store(false, Ordering::Relaxed);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

impl Drop for SysAudioHandle {
    fn drop(&mut self) {
        self.running.store(false, Ordering::Relaxed);
    }
}

/// Managed state holding one active audio stream per section index.
#[derive(Default)]
pub struct SystemAudioStreamState {
    streams: Mutex<HashMap<u32, SysAudioHandle>>,
}

/// Start streaming system audio for a section to the frontend over `on_chunk`.
///
/// Wire format — 16-byte LE header + interleaved f32 PCM:
/// ```text
/// bytes 0..4  : u32 sample_rate
/// bytes 4..6  : u16 channels
/// bytes 6..8  : u16 reserved (0)
/// bytes 8..16 : u64 timestamp_ms
/// bytes 16..  : f32 interleaved PCM (LE)  ← 4-byte aligned for a zero-copy Float32Array view
/// ```
#[tauri::command]
pub async fn start_system_audio_stream(
    section_index: u32,
    sample_rate: u32,
    channels: u16,
    app_bundle_id: Option<String>,
    on_chunk: Channel<InvokeResponseBody>,
    state: tauri::State<'_, Arc<SystemAudioStreamState>>,
) -> Result<(), String> {
    let bundle_id_display = app_bundle_id
        .as_deref()
        .map(|b| format!(", app={}", b))
        .unwrap_or_default();

    let existing = state.streams.lock().remove(&section_index);
    if let Some(existing) = existing {
        existing.stop();
    }

    let mut capture = SystemAudioCapture::new(SystemAudioCaptureConfig {
        sample_rate,
        channels,
        app_bundle_id,
    })
    .map_err(|e| format!("Failed to initialize system audio capture: {}", e))?;

    let receiver = capture
        .take_receiver()
        .ok_or("System audio capture receiver unavailable")?;

    capture.start()?;

    let running = Arc::new(AtomicBool::new(true));
    let worker_running = running.clone();

    let credit = Arc::new((Mutex::new(MAX_INFLIGHT), Condvar::new()));
    let worker_credit = credit.clone();

    let worker = std::thread::spawn(move || {
        // `capture` is moved in so the SCStream stays alive for the worker's lifetime
        // and is stopped when the loop exits.
        let mut sent: u64 = 0;
        let mut dropped: u64 = 0;

        while worker_running.load(Ordering::Relaxed) {
            let chunk = match receiver.recv_timeout(RECV_TIMEOUT) {
                Ok(c) => c,
                Err(crossbeam_channel::RecvTimeoutError::Timeout) => continue,
                Err(crossbeam_channel::RecvTimeoutError::Disconnected) => break,
            };

            let timestamp_ms = chunk.timestamp.as_millis() as u64;
            let pcm_byte_len = chunk.samples.len() * 4;

            // Build 16-byte header + f32 PCM payload. Header is 16 bytes so the
            // PCM region starts at a 4-byte boundary — the JS side can create a
            // zero-copy Float32Array view at offset 16 without a copy.
            let mut payload = Vec::with_capacity(16 + pcm_byte_len);
            payload.extend_from_slice(&chunk.sample_rate.to_le_bytes()); // 0..4
            payload.extend_from_slice(&chunk.channels.to_le_bytes());    // 4..6
            payload.extend_from_slice(&0u16.to_le_bytes());              // 6..8 reserved
            payload.extend_from_slice(&timestamp_ms.to_le_bytes());      // 8..16
            for &s in &chunk.samples {
                payload.extend_from_slice(&s.to_le_bytes());
            }

            // Block until the JS decoder has capacity (ack-based backpressure).
            {
                let (m, cv) = &*worker_credit;
                let mut c = m.lock();
                while *c == 0 && worker_running.load(Ordering::Relaxed) {
                    cv.wait_for(&mut c, RECV_TIMEOUT);
                }
                if !worker_running.load(Ordering::Relaxed) {
                    dropped += 1;
                    break;
                }
                *c -= 1;
            }

            if on_chunk.send(InvokeResponseBody::Raw(payload)).is_err() {
                break;
            }
            sent += 1;

            if dropped > 0 && sent % 200 == 0 {
                println!(
                    "[system_audio_stream] section {} stats: {} sent, {} dropped",
                    section_index, sent, dropped
                );
            }
        }

        capture.stop();
        println!(
            "[system_audio_stream] section {} stopped: {} chunks sent, {} dropped",
            section_index, sent, dropped
        );
    });

    let replaced = state.streams.lock().insert(
        section_index,
        SysAudioHandle {
            running,
            worker: Some(worker),
            credit,
        },
    );
    if let Some(replaced) = replaced {
        replaced.stop();
    }

    println!(
        "[system_audio_stream] section {} started: {}Hz, {} channels{}",
        section_index, sample_rate, channels, bundle_id_display
    );

    Ok(())
}

/// Stop the system-audio stream for a section (no-op if none is running).
#[tauri::command]
pub async fn stop_system_audio_stream(
    section_index: u32,
    state: tauri::State<'_, Arc<SystemAudioStreamState>>,
) -> Result<(), String> {
    let handle = state.streams.lock().remove(&section_index);
    if let Some(handle) = handle {
        handle.stop();
    }
    Ok(())
}

/// Acknowledge a delivered chunk, restoring one unit of backpressure credit.
///
/// Call this after each chunk is enqueued into the AudioWorklet/ScriptProcessorNode.
/// Always ack (even on failure) so a single bad chunk can't starve the worker.
#[tauri::command]
pub fn ack_system_audio_chunk(
    section_index: u32,
    state: tauri::State<'_, Arc<SystemAudioStreamState>>,
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

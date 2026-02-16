use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

use crossbeam_channel::{bounded, Receiver, Sender};
use parking_lot::Mutex;
use screencapturekit::cv::CVPixelBufferLockFlags;
use screencapturekit::prelude::*;

use super::{ScreenCaptureConfig, ScreenFrame};

/// Channel capacity for frame buffer - larger buffer absorbs processing delays
/// At 30fps, 120 frames = 4 seconds of buffer
const FRAME_CHANNEL_CAPACITY: usize = 120;

pub struct ScreenCapture {
    config: ScreenCaptureConfig,
    width: u32,
    height: u32,
    running: Arc<Mutex<bool>>,
    frame_sender: Option<Sender<ScreenFrame>>,
    frame_receiver: Option<Receiver<ScreenFrame>>,
    stream: Arc<Mutex<Option<SCStream>>>,
    /// Shared frame counter for diagnostics
    frame_count: Arc<AtomicU64>,
}

struct FrameHandler {
    sender: Sender<ScreenFrame>,
    start_time: Instant,
    frame_count: Arc<AtomicU64>,
    /// Counter for callbacks with no image buffer (for diagnostics)
    empty_buffer_count: AtomicU64,
}

impl Drop for FrameHandler {
    fn drop(&mut self) {
        let frames = self.frame_count.load(Ordering::Relaxed);
        let empty = self.empty_buffer_count.load(Ordering::Relaxed);
        eprintln!(
            "FrameHandler dropped: {} frames captured, {} empty buffers (ratio: {:.1}%)",
            frames,
            empty,
            if frames + empty > 0 {
                (empty as f64 / (frames + empty) as f64) * 100.0
            } else {
                0.0
            }
        );
    }
}

impl SCStreamOutputTrait for FrameHandler {
    fn did_output_sample_buffer(&self, sample: CMSampleBuffer, of_type: SCStreamOutputType) {
        if of_type != SCStreamOutputType::Screen {
            return;
        }

        // Get image buffer - may be None for some callback types (expected behavior)
        let Some(buffer) = sample.image_buffer() else {
            // Track empty buffers but don't spam logs
            let empty_count = self.empty_buffer_count.fetch_add(1, Ordering::Relaxed) + 1;
            if empty_count == 1 || empty_count % 100 == 0 {
                eprintln!("Screen capture: {} callbacks with no image buffer", empty_count);
            }
            return;
        };

        let Ok(guard) = buffer.lock(CVPixelBufferLockFlags::READ_ONLY) else {
            eprintln!("Screen capture: failed to lock pixel buffer");
            return;
        };

        let frame = ScreenFrame {
            data: guard.as_slice().to_vec(),
            width: guard.width() as u32,
            height: guard.height() as u32,
            stride: guard.bytes_per_row(),
            timestamp: self.start_time.elapsed(),
        };

        // Track frame count
        let count = self.frame_count.fetch_add(1, Ordering::Relaxed) + 1;

        // Log periodically to show frames are being captured
        if count % 60 == 0 {
            let empty = self.empty_buffer_count.load(Ordering::Relaxed);
            println!(
                "Screen capture: {} frames captured ({} empty buffers)",
                count, empty
            );
        }

        // CRITICAL: Use try_send to NEVER block the callback
        // Blocking even briefly causes ScreenCaptureKit's pixel buffer pool to exhaust
        // which results in image_buffer() returning None (empty buffers)
        // It's better to drop a frame than to cause buffer pool exhaustion
        if let Err(_) = self.sender.try_send(frame) {
            // Only log occasionally to avoid spam
            if count % 30 == 0 {
                eprintln!(
                    "Screen capture: frame {} dropped - channel full (queue len: {})",
                    count,
                    self.sender.len()
                );
            }
        }
    }
}

impl ScreenCapture {
    pub fn new(config: ScreenCaptureConfig) -> Result<Self, String> {
        let content = SCShareableContent::get()
            .map_err(|e| format!("Failed to get shareable content: {}", e))?;
        let displays = content.displays();
        let display = displays
            .get(config.display_index)
            .ok_or_else(|| format!("Display {} not found", config.display_index))?;

        let (sender, receiver) = bounded(FRAME_CHANNEL_CAPACITY);

        Ok(Self {
            config,
            width: display.width(),
            height: display.height(),
            running: Arc::new(Mutex::new(false)),
            frame_sender: Some(sender),
            frame_receiver: Some(receiver),
            stream: Arc::new(Mutex::new(None)),
            frame_count: Arc::new(AtomicU64::new(0)),
        })
    }

    pub fn take_receiver(&mut self) -> Option<Receiver<ScreenFrame>> {
        self.frame_receiver.take()
    }

    pub fn start(&self) -> Result<(), String> {
        let mut running = self.running.lock();
        if *running {
            return Err("Screen capture already running".to_string());
        }
        *running = true;
        drop(running);

        let content = SCShareableContent::get().map_err(|e| {
            if format!("{e}").to_lowercase().contains("permission") {
                "Screen recording permission denied. Enable it in System Settings → Privacy & Security → Screen Recording".to_string()
            } else {
                format!("Failed to get shareable content: {}", e)
            }
        })?;

        let displays = content.displays();
        let display = displays
            .get(self.config.display_index)
            .ok_or_else(|| format!("Display {} not found", self.config.display_index))?;

        let filter = SCContentFilter::create()
            .with_display(display)
            .with_excluding_windows(&[])
            .build();

        let frame_interval = CMTime::new(1, self.config.fps as i32);
        let stream_config = SCStreamConfiguration::new()
            .with_width(self.width)
            .with_height(self.height)
            .with_pixel_format(PixelFormat::BGRA)
            .with_minimum_frame_interval(&frame_interval)
            .with_shows_cursor(true);

        let mut stream = SCStream::new(&filter, &stream_config);

        // Reset frame counter
        self.frame_count.store(0, Ordering::Relaxed);

        let handler = FrameHandler {
            sender: self
                .frame_sender
                .clone()
                .ok_or("Frame sender not available")?,
            start_time: Instant::now(),
            frame_count: self.frame_count.clone(),
            empty_buffer_count: AtomicU64::new(0),
        };

        stream.add_output_handler(handler, SCStreamOutputType::Screen);
        stream
            .start_capture()
            .map_err(|e| format!("Failed to start capture: {}", e))?;

        let mut stream_guard = self.stream.lock();
        *stream_guard = Some(stream);

        println!(
            "Screen capture started: {}x{} @ {}fps",
            self.width, self.height, self.config.fps
        );

        Ok(())
    }

    pub fn stop(&self) {
        let mut running = self.running.lock();
        *running = false;

        let mut stream_guard = self.stream.lock();
        if let Some(stream) = stream_guard.take() {
            let _ = stream.stop_capture();
        }

        let total_frames = self.frame_count.load(Ordering::Relaxed);
        println!("Screen capture stopped: {} total frames captured", total_frames);
    }

}

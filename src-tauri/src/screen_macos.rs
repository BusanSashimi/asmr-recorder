use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

use parking_lot::Mutex;
use screencapturekit::cm::SCFrameStatus;
use screencapturekit::cv::CVPixelBufferLockFlags;
use screencapturekit::prelude::*;

use super::{ScreenCaptureConfig, ScreenFrame};
use crate::latest_frame::LatestFrame;

pub struct ScreenCapture {
    config: ScreenCaptureConfig,
    width: u32,
    height: u32,
    running: Arc<Mutex<bool>>,
    frames: LatestFrame<ScreenFrame>,
    frame_receiver: Option<LatestFrame<ScreenFrame>>,
    stream: Arc<Mutex<Option<SCStream>>>,
    /// Shared frame counter for diagnostics
    frame_count: Arc<AtomicU64>,
}

struct FrameHandler {
    frames: LatestFrame<ScreenFrame>,
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

        // Idle/suspended notifications can carry an image buffer without a new
        // display image. Keep the last complete frame instead of drawing it blank.
        if crate::screen_frame_status::frame_status(&sample) != Some(SCFrameStatus::Complete) {
            return;
        }

        // Get image buffer - may be None for some callback types (expected behavior)
        let Some(buffer) = sample.image_buffer() else {
            // Track empty buffers but don't spam logs
            let empty_count = self.empty_buffer_count.fetch_add(1, Ordering::Relaxed) + 1;
            if empty_count == 1 || empty_count % 100 == 0 {
                eprintln!(
                    "Screen capture: {} callbacks with no image buffer",
                    empty_count
                );
            }
            return;
        };

        let Ok(guard) = buffer.lock(CVPixelBufferLockFlags::READ_ONLY) else {
            eprintln!("Screen capture: failed to lock pixel buffer");
            return;
        };

        self.frames.publish_with(|| ScreenFrame {
            data: guard.as_slice().to_vec(),
            width: guard.width() as u32,
            height: guard.height() as u32,
            stride: guard.bytes_per_row(),
            timestamp: self.start_time.elapsed(),
        });
        self.frame_count.fetch_add(1, Ordering::Relaxed);
    }
}

impl ScreenCapture {
    pub fn new(mut config: ScreenCaptureConfig) -> Result<Self, String> {
        let content = SCShareableContent::get()
            .map_err(|e| format!("Failed to get shareable content: {}", e))?;
        let displays = content.displays();
        let display = super::resolve_display(&displays, &config)?;

        let scale = super::describe_display(display, 0).point_pixel_scale;
        let (crop, size) = super::capture_geometry(
            display.width(),
            display.height(),
            scale,
            config.region.as_ref(),
            config.target_size.as_ref(),
        )?;
        if config.region.is_some() {
            config.region = Some(crop);
        }
        let (width, height) = (size.width, size.height);
        let frames = LatestFrame::default();
        Ok(Self {
            config,
            width,
            height,
            running: Arc::new(Mutex::new(false)),
            frame_receiver: Some(frames.clone()),
            frames,
            stream: Arc::new(Mutex::new(None)),
            frame_count: Arc::new(AtomicU64::new(0)),
        })
    }

    pub fn take_receiver(&mut self) -> Option<LatestFrame<ScreenFrame>> {
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
        let display = super::resolve_display(&displays, &self.config)?;

        let filter = SCContentFilter::create()
            .with_display(display)
            .with_excluding_windows(&[])
            .build();

        let frame_interval = CMTime::new(1, self.config.fps as i32);
        let base_config = SCStreamConfiguration::new()
            .with_width(self.width)
            .with_height(self.height)
            .with_pixel_format(PixelFormat::BGRA)
            .with_minimum_frame_interval(&frame_interval)
            .with_shows_cursor(true)
            .with_preserves_aspect_ratio(true)
            .with_queue_depth(3);

        // sourceRect is logical; width/height are the scaled output pixels.
        // scalesToFit is left false: never request artificial upscaling.
        let stream_config = if let Some(ref r) = self.config.region {
            base_config
                .with_source_rect(CGRect::new(
                    r.x as f64,
                    r.y as f64,
                    r.width as f64,
                    r.height as f64,
                ))
                .with_scales_to_fit(false)
        } else {
            base_config
        };

        let mut stream = SCStream::new(&filter, &stream_config);

        // Reset frame counter
        self.frame_count.store(0, Ordering::Relaxed);

        let handler = FrameHandler {
            frames: self.frames.clone(),
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
            "Screen capture started: {}x{} @ {}fps region={:?}",
            self.width, self.height, self.config.fps, self.config.region
        );

        Ok(())
    }

    pub fn stop(&self) {
        let mut running = self.running.lock();
        *running = false;

        self.frames.close();
        let mut stream_guard = self.stream.lock();
        if let Some(stream) = stream_guard.take() {
            let _ = stream.stop_capture();
        }

        let total_frames = self.frame_count.load(Ordering::Relaxed);
        println!(
            "Screen capture stopped: {} total frames captured",
            total_frames
        );
    }
}

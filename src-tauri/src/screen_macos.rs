use std::sync::Arc;
use std::time::Instant;

use crossbeam_channel::{bounded, Receiver, Sender};
use parking_lot::Mutex;
use screencapturekit::cv::CVPixelBufferLockFlags;
use screencapturekit::prelude::*;

use super::{ScreenCaptureConfig, ScreenFrame};

pub struct ScreenCapture {
    config: ScreenCaptureConfig,
    width: u32,
    height: u32,
    running: Arc<Mutex<bool>>,
    frame_sender: Option<Sender<ScreenFrame>>,
    frame_receiver: Option<Receiver<ScreenFrame>>,
    stream: Arc<Mutex<Option<SCStream>>>,
}

struct FrameHandler {
    sender: Sender<ScreenFrame>,
    start_time: Instant,
}

impl SCStreamOutputTrait for FrameHandler {
    fn did_output_sample_buffer(&self, sample: CMSampleBuffer, of_type: SCStreamOutputType) {
        if of_type != SCStreamOutputType::Screen {
            return;
        }

        let Some(buffer) = sample.image_buffer() else {
            return;
        };

        let Ok(guard) = buffer.lock(CVPixelBufferLockFlags::READ_ONLY) else {
            return;
        };

        let frame = ScreenFrame {
            data: guard.as_slice().to_vec(),
            width: guard.width() as u32,
            height: guard.height() as u32,
            stride: guard.bytes_per_row(),
            timestamp: self.start_time.elapsed(),
        };

        let _ = self.sender.try_send(frame);
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

        let (sender, receiver) = bounded(5);

        Ok(Self {
            config,
            width: display.width(),
            height: display.height(),
            running: Arc::new(Mutex::new(false)),
            frame_sender: Some(sender),
            frame_receiver: Some(receiver),
            stream: Arc::new(Mutex::new(None)),
        })
    }

    pub fn dimensions(&self) -> (u32, u32) {
        (self.width, self.height)
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
            .with_minimum_frame_interval(&frame_interval);

        let mut stream = SCStream::new(&filter, &stream_config);

        let handler = FrameHandler {
            sender: self
                .frame_sender
                .clone()
                .ok_or("Frame sender not available")?,
            start_time: Instant::now(),
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
        if let Some(mut stream) = stream_guard.take() {
            let _ = stream.stop_capture();
        }

        println!("Screen capture stopped");
    }

    pub fn is_running(&self) -> bool {
        *self.running.lock()
    }
}

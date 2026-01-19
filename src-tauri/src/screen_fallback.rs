use scrap::{Capturer, Display};
use std::io::ErrorKind;
use std::sync::Arc;
use std::time::{Duration, Instant};

use crossbeam_channel::{bounded, Receiver, Sender};
use parking_lot::Mutex;

use super::{ScreenCaptureConfig, ScreenFrame};

/// Manages continuous screen capture (fallback for non-macOS/Windows)
pub struct ScreenCapture {
    config: ScreenCaptureConfig,
    width: u32,
    height: u32,
    running: Arc<Mutex<bool>>,
    frame_sender: Option<Sender<ScreenFrame>>,
    frame_receiver: Option<Receiver<ScreenFrame>>,
}

impl ScreenCapture {
    /// Create a new screen capture instance
    pub fn new(config: ScreenCaptureConfig) -> Result<Self, String> {
        let displays = Display::all().map_err(|e| format!("Failed to get displays: {}", e))?;

        let display = displays
            .into_iter()
            .nth(config.display_index)
            .ok_or_else(|| format!("Display {} not found", config.display_index))?;

        let width = display.width() as u32;
        let height = display.height() as u32;

        let (sender, receiver) = bounded(5);

        Ok(Self {
            config,
            width,
            height,
            running: Arc::new(Mutex::new(false)),
            frame_sender: Some(sender),
            frame_receiver: Some(receiver),
        })
    }

    /// Get the capture dimensions
    pub fn dimensions(&self) -> (u32, u32) {
        (self.width, self.height)
    }

    /// Get a receiver for captured frames
    pub fn take_receiver(&mut self) -> Option<Receiver<ScreenFrame>> {
        self.frame_receiver.take()
    }

    /// Start capturing frames in a background thread
    pub fn start(&self) -> Result<(), String> {
        let mut running = self.running.lock();
        if *running {
            return Err("Screen capture already running".to_string());
        }
        *running = true;
        drop(running);

        let running_clone = self.running.clone();
        let sender = self
            .frame_sender
            .clone()
            .ok_or("Frame sender not available")?;
        let fps = self.config.fps;
        let display_index = self.config.display_index;

        std::thread::spawn(move || {
            if let Err(e) = capture_loop(running_clone, sender, fps, display_index) {
                eprintln!("Screen capture error: {}", e);
            }
        });

        Ok(())
    }

    /// Stop capturing
    pub fn stop(&self) {
        let mut running = self.running.lock();
        *running = false;
    }

    /// Check if capture is running
    pub fn is_running(&self) -> bool {
        *self.running.lock()
    }
}

fn capture_loop(
    running: Arc<Mutex<bool>>,
    sender: Sender<ScreenFrame>,
    fps: u32,
    display_index: usize,
) -> Result<(), String> {
    let displays = Display::all().map_err(|e| format!("Failed to get displays: {}", e))?;
    let display = displays
        .into_iter()
        .nth(display_index)
        .ok_or_else(|| format!("Display {} not found", display_index))?;

    let width = display.width() as u32;
    let height = display.height() as u32;

    let mut capturer = Capturer::new(display).map_err(|e| {
        let error_msg = format!("{}", e);
        if error_msg.contains("other error") || error_msg.contains("permission") {
            "Screen recording permission denied. Please grant permission in System Settings → Privacy & Security → Screen Recording".to_string()
        } else {
            format!("Failed to create capturer: {}", e)
        }
    })?;

    let frame_duration = Duration::from_secs_f64(1.0 / fps as f64);
    let start_time = Instant::now();

    println!("Screen capture started: {}x{} @ {}fps", width, height, fps);

    while *running.lock() {
        let frame_start = Instant::now();

        match capturer.frame() {
            Ok(frame) => {
                let timestamp = start_time.elapsed();
                let stride = frame.len() / height as usize;
                let screen_frame = ScreenFrame {
                    data: frame.to_vec(),
                    width,
                    height,
                    stride,
                    timestamp,
                };

                let _ = sender.try_send(screen_frame);
            }
            Err(ref e) if e.kind() == ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(1));
                continue;
            }
            Err(e) => {
                eprintln!("Capture error: {}", e);
                std::thread::sleep(Duration::from_millis(10));
            }
        }

        let elapsed = frame_start.elapsed();
        if elapsed < frame_duration {
            std::thread::sleep(frame_duration - elapsed);
        }
    }

    println!("Screen capture stopped");
    Ok(())
}

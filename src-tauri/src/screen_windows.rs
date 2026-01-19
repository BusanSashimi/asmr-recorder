use std::sync::Arc;
use std::time::{Duration, Instant};

use crossbeam_channel::{bounded, Receiver, Sender};
use parking_lot::Mutex;
use windows_capture::dxgi_duplication_api::DxgiDuplicationApi;
use windows_capture::monitor::Monitor;

use super::{ScreenCaptureConfig, ScreenFrame};

pub struct ScreenCapture {
    config: ScreenCaptureConfig,
    width: u32,
    height: u32,
    running: Arc<Mutex<bool>>,
    frame_sender: Option<Sender<ScreenFrame>>,
    frame_receiver: Option<Receiver<ScreenFrame>>,
}

impl ScreenCapture {
    pub fn new(config: ScreenCaptureConfig) -> Result<Self, String> {
        let monitor = Monitor::from_index(config.display_index)
            .or_else(|_| Monitor::primary())
            .map_err(|e| format!("Failed to access monitor: {}", e))?;

        let width = monitor.width();
        let height = monitor.height();

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

        let running_clone = self.running.clone();
        let sender = self
            .frame_sender
            .clone()
            .ok_or("Frame sender not available")?;
        let fps = self.config.fps;
        let display_index = self.config.display_index;
        let width = self.width;
        let height = self.height;

        std::thread::spawn(move || {
            if let Err(e) = capture_loop(running_clone, sender, fps, display_index, width, height)
            {
                eprintln!("Screen capture error: {}", e);
            }
        });

        Ok(())
    }

    pub fn stop(&self) {
        let mut running = self.running.lock();
        *running = false;
    }

    pub fn is_running(&self) -> bool {
        *self.running.lock()
    }
}

fn capture_loop(
    running: Arc<Mutex<bool>>,
    sender: Sender<ScreenFrame>,
    fps: u32,
    display_index: usize,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let monitor = Monitor::from_index(display_index)
        .or_else(|_| Monitor::primary())
        .map_err(|e| format!("Failed to access monitor: {}", e))?;

    let mut duplication =
        DxgiDuplicationApi::new(monitor).map_err(|e| format!("DXGI init failed: {}", e))?;

    let frame_duration = Duration::from_secs_f64(1.0 / fps as f64);
    let start_time = Instant::now();

    println!(
        "Screen capture started: {}x{} @ {}fps",
        width, height, fps
    );

    while *running.lock() {
        let frame_start = Instant::now();

        match duplication.acquire_next_frame(33) {
            Ok(mut frame) => {
                if let Ok(buffer) = frame.buffer() {
                    let screen_frame = ScreenFrame {
                        data: buffer.to_vec(),
                        width: frame.width(),
                        height: frame.height(),
                        stride: frame.width() as usize * 4,
                        timestamp: start_time.elapsed(),
                    };
                    let _ = sender.try_send(screen_frame);
                }
            }
            Err(_) => {
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

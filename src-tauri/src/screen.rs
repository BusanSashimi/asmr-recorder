use scrap::{Capturer, Display};
use std::io::ErrorKind;
use std::sync::Arc;
use std::time::{Duration, Instant};
use crossbeam_channel::{bounded, Receiver, Sender};
use parking_lot::Mutex;
use tauri::command;

/// Represents a captured screen frame
#[derive(Clone)]
pub struct ScreenFrame {
    /// Raw BGRA pixel data
    pub data: Vec<u8>,
    /// Frame width
    pub width: u32,
    /// Frame height
    pub height: u32,
    /// Timestamp when frame was captured
    pub timestamp: Duration,
}

impl ScreenFrame {
    /// Convert BGRA to RGB format
    pub fn to_rgb(&self) -> Vec<u8> {
        let pixel_count = (self.width * self.height) as usize;
        let mut rgb = Vec::with_capacity(pixel_count * 3);
        
        for i in 0..pixel_count {
            let offset = i * 4;
            // BGRA -> RGB
            rgb.push(self.data[offset + 2]); // R
            rgb.push(self.data[offset + 1]); // G
            rgb.push(self.data[offset]);     // B
        }
        
        rgb
    }
    
    /// Convert BGRA to RGBA format
    pub fn to_rgba(&self) -> Vec<u8> {
        let pixel_count = (self.width * self.height) as usize;
        let mut rgba = Vec::with_capacity(pixel_count * 4);
        
        for i in 0..pixel_count {
            let offset = i * 4;
            // BGRA -> RGBA
            rgba.push(self.data[offset + 2]); // R
            rgba.push(self.data[offset + 1]); // G
            rgba.push(self.data[offset]);     // B
            rgba.push(self.data[offset + 3]); // A
        }
        
        rgba
    }
}

/// Screen capture configuration
pub struct ScreenCaptureConfig {
    /// Target frames per second
    pub fps: u32,
    /// Display index to capture (0 = primary)
    pub display_index: usize,
}

impl Default for ScreenCaptureConfig {
    fn default() -> Self {
        Self {
            fps: 30,
            display_index: 0,
        }
    }
}

/// Manages continuous screen capture
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
        
        // Create a bounded channel for frames (buffer up to 5 frames)
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
        let sender = self.frame_sender.clone()
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

/// The main capture loop that runs in a background thread
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
    
    let mut capturer = Capturer::new(display)
        .map_err(|e| format!("Failed to create capturer: {}", e))?;
    
    let frame_duration = Duration::from_secs_f64(1.0 / fps as f64);
    let start_time = Instant::now();
    
    println!("Screen capture started: {}x{} @ {}fps", width, height, fps);
    
    while *running.lock() {
        let frame_start = Instant::now();
        
        // Attempt to capture a frame
        match capturer.frame() {
            Ok(frame) => {
                let timestamp = start_time.elapsed();
                let screen_frame = ScreenFrame {
                    data: frame.to_vec(),
                    width,
                    height,
                    timestamp,
                };
                
                // Send frame (non-blocking, drops if buffer is full)
                let _ = sender.try_send(screen_frame);
            }
            Err(ref e) if e.kind() == ErrorKind::WouldBlock => {
                // Frame not ready, wait a bit
                std::thread::sleep(Duration::from_millis(1));
                continue;
            }
            Err(e) => {
                eprintln!("Capture error: {}", e);
                // Brief pause before retry
                std::thread::sleep(Duration::from_millis(10));
            }
        }
        
        // Maintain target frame rate
        let elapsed = frame_start.elapsed();
        if elapsed < frame_duration {
            std::thread::sleep(frame_duration - elapsed);
        }
    }
    
    println!("Screen capture stopped");
    Ok(())
}

/// Legacy Tauri command for backward compatibility
#[command]
pub fn start_screen_capture() {
    println!("Starting screen capture...");
    
    match Display::primary() {
        Ok(display) => {
            println!("Primary display found: {}x{}", display.width(), display.height());
            println!("Screen capture initialized (use new recording API for actual capture).");
        }
        Err(e) => println!("Failed to find primary display: {}", e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_screen_frame_conversion() {
        let frame = ScreenFrame {
            data: vec![255, 128, 64, 255], // One BGRA pixel
            width: 1,
            height: 1,
            timestamp: Duration::from_secs(0),
        };
        
        let rgb = frame.to_rgb();
        assert_eq!(rgb, vec![64, 128, 255]); // RGB
        
        let rgba = frame.to_rgba();
        assert_eq!(rgba, vec![64, 128, 255, 255]); // RGBA
    }
}

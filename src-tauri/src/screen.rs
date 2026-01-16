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
    /// Raw BGRA pixel data (may include row padding)
    pub data: Vec<u8>,
    /// Frame width in pixels
    pub width: u32,
    /// Frame height in pixels
    pub height: u32,
    /// Actual bytes per row (may be larger than width * 4 due to alignment)
    pub stride: usize,
    /// Timestamp when frame was captured
    pub timestamp: Duration,
}

impl ScreenFrame {
    /// Convert platform-specific pixel data (BGRA or ARGB) to RGBA format
    /// 
    /// This method properly handles row stride/padding by iterating row-by-row
    /// rather than assuming tightly-packed pixel data.
    pub fn to_rgba(&self) -> Vec<u8> {
        let output_size = (self.width * self.height * 4) as usize;
        let mut rgba = Vec::with_capacity(output_size);
        
        for y in 0..self.height as usize {
            let row_start = y * self.stride;
            for x in 0..self.width as usize {
                let offset = row_start + x * 4;
                
                #[cfg(target_os = "macos")]
                {
                    // macOS uses ARGB format
                    rgba.push(self.data[offset + 1]); // R
                    rgba.push(self.data[offset + 2]); // G
                    rgba.push(self.data[offset + 3]); // B
                    rgba.push(self.data[offset]);     // A
                }
                
                #[cfg(not(target_os = "macos"))]
                {
                    // Windows/Linux use BGRA format
                    rgba.push(self.data[offset + 2]); // R
                    rgba.push(self.data[offset + 1]); // G
                    rgba.push(self.data[offset]);     // B
                    rgba.push(self.data[offset + 3]); // A
                }
            }
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
        .map_err(|e| {
            let error_msg = format!("{}", e);
            if error_msg.contains("other error") || error_msg.contains("permission") {
                format!("Screen recording permission denied. Please grant permission in System Settings → Privacy & Security → Screen Recording")
            } else {
                format!("Failed to create capturer: {}", e)
            }
        })?;
    
    let frame_duration = Duration::from_secs_f64(1.0 / fps as f64);
    let start_time = Instant::now();
    
    println!("Screen capture started: {}x{} @ {}fps", width, height, fps);
    
    while *running.lock() {
        let frame_start = Instant::now();
        
        // Attempt to capture a frame
        match capturer.frame() {
            Ok(frame) => {
                let timestamp = start_time.elapsed();
                // Calculate stride: total bytes / number of rows
                let stride = frame.len() / height as usize;
                let screen_frame = ScreenFrame {
                    data: frame.to_vec(),
                    width,
                    height,
                    stride,
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

/// Check if screen recording permission is granted
#[command]
pub fn check_screen_recording_permission() -> Result<bool, String> {
    match Display::primary() {
        Ok(display) => {
            match Capturer::new(display) {
                Ok(_) => Ok(true),
                Err(_) => Ok(false),
            }
        }
        Err(e) => Err(format!("Failed to access display: {}", e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_screen_frame_conversion() {
        // Test with tightly-packed data (stride = width * 4)
        let frame = ScreenFrame {
            data: vec![255, 128, 64, 255], // One BGRA pixel (on non-macOS) or ARGB (on macOS)
            width: 1,
            height: 1,
            stride: 4, // 1 pixel * 4 bytes per pixel
            timestamp: Duration::from_secs(0),
        };
        
        let rgba = frame.to_rgba();
        #[cfg(target_os = "macos")]
        assert_eq!(rgba, vec![128, 64, 255, 255]); // ARGB -> RGBA
        #[cfg(not(target_os = "macos"))]
        assert_eq!(rgba, vec![64, 128, 255, 255]); // BGRA -> RGBA
    }
    
    #[test]
    fn test_screen_frame_with_stride_padding() {
        // Test with padded data (stride > width * 4)
        // Simulates 2x2 frame with 16-byte stride (4 bytes padding per row)
        #[cfg(not(target_os = "macos"))]
        let frame = ScreenFrame {
            // Row 0: 2 BGRA pixels + 8 bytes padding
            // Row 1: 2 BGRA pixels + 8 bytes padding
            data: vec![
                // Row 0
                0, 255, 0, 255,     // Pixel (0,0): BGRA = green
                255, 0, 0, 255,     // Pixel (1,0): BGRA = blue
                0, 0, 0, 0, 0, 0, 0, 0, // 8 bytes padding
                // Row 1
                0, 0, 255, 255,     // Pixel (0,1): BGRA = red
                255, 255, 255, 255, // Pixel (1,1): BGRA = white
                0, 0, 0, 0, 0, 0, 0, 0, // 8 bytes padding
            ],
            width: 2,
            height: 2,
            stride: 16, // 2 pixels * 4 bytes + 8 bytes padding = 16 bytes
            timestamp: Duration::from_secs(0),
        };
        
        #[cfg(not(target_os = "macos"))]
        {
            let rgba = frame.to_rgba();
            assert_eq!(rgba.len(), 16); // 2x2 * 4 bytes = 16 bytes (no padding in output)
            // Check first pixel: green (BGRA 0,255,0,255 -> RGBA 0,255,0,255)
            assert_eq!(&rgba[0..4], &[0, 255, 0, 255]);
            // Check second pixel: blue (BGRA 255,0,0,255 -> RGBA 0,0,255,255)
            assert_eq!(&rgba[4..8], &[0, 0, 255, 255]);
        }
    }
}

use std::sync::Arc;
use std::time::{Duration, Instant};
use crossbeam_channel::{bounded, Receiver, Sender};
use parking_lot::Mutex;

/// Represents a captured webcam frame
#[derive(Clone)]
pub struct WebcamFrame {
    /// Raw RGB pixel data
    pub data: Vec<u8>,
    /// Frame width
    pub width: u32,
    /// Frame height
    pub height: u32,
    /// Timestamp when frame was captured
    pub timestamp: Duration,
}

impl WebcamFrame {
    /// Convert to RGBA format (adds alpha channel)
    pub fn to_rgba(&self) -> Vec<u8> {
        let pixel_count = (self.width * self.height) as usize;
        let mut rgba = Vec::with_capacity(pixel_count * 4);
        
        for i in 0..pixel_count {
            let offset = i * 3;
            rgba.push(self.data[offset]);     // R
            rgba.push(self.data[offset + 1]); // G
            rgba.push(self.data[offset + 2]); // B
            rgba.push(255);                   // A
        }
        
        rgba
    }
}

/// Webcam capture configuration
pub struct WebcamCaptureConfig {
    /// Target frames per second
    pub fps: u32,
    /// Desired capture width
    pub width: u32,
    /// Desired capture height
    pub height: u32,
    /// Camera device index
    pub device_index: usize,
}

impl Default for WebcamCaptureConfig {
    fn default() -> Self {
        Self {
            fps: 30,
            width: 640,
            height: 480,
            device_index: 0,
        }
    }
}

/// Manages continuous webcam capture
/// 
/// Note: This implementation uses a platform-agnostic approach.
/// nokhwa provides the actual camera access, but we wrap it for
/// consistent interface across the application.
pub struct WebcamCapture {
    config: WebcamCaptureConfig,
    actual_width: u32,
    actual_height: u32,
    running: Arc<Mutex<bool>>,
    frame_sender: Option<Sender<WebcamFrame>>,
    frame_receiver: Option<Receiver<WebcamFrame>>,
}

impl WebcamCapture {
    /// Create a new webcam capture instance
    /// 
    /// This attempts to initialize the camera with the requested settings.
    /// The actual resolution may differ from requested.
    pub fn new(config: WebcamCaptureConfig) -> Result<Self, String> {
        // For now, we'll use the requested dimensions
        // nokhwa will adjust to closest supported resolution
        let actual_width = config.width;
        let actual_height = config.height;
        
        // Create a bounded channel for frames (buffer up to 3 frames)
        let (sender, receiver) = bounded(3);
        
        Ok(Self {
            config,
            actual_width,
            actual_height,
            running: Arc::new(Mutex::new(false)),
            frame_sender: Some(sender),
            frame_receiver: Some(receiver),
        })
    }
    
    /// Get a receiver for captured frames
    pub fn take_receiver(&mut self) -> Option<Receiver<WebcamFrame>> {
        self.frame_receiver.take()
    }
    
    /// Start capturing frames in a background thread
    pub fn start(&self) -> Result<(), String> {
        let mut running = self.running.lock();
        if *running {
            return Err("Webcam capture already running".to_string());
        }
        *running = true;
        drop(running);
        
        let running_clone = self.running.clone();
        let sender = self.frame_sender.clone()
            .ok_or("Frame sender not available")?;
        let config = WebcamCaptureConfig {
            fps: self.config.fps,
            width: self.actual_width,
            height: self.actual_height,
            device_index: self.config.device_index,
        };
        
        std::thread::spawn(move || {
            if let Err(e) = capture_loop(running_clone, sender, config) {
                eprintln!("Webcam capture error: {}", e);
            }
        });
        
        Ok(())
    }
    
    /// Stop capturing
    pub fn stop(&self) {
        let mut running = self.running.lock();
        *running = false;
    }
    
}

/// The main webcam capture loop
/// 
/// This function runs in a background thread and captures frames from the webcam.
/// Due to nokhwa's complexity with different backends, we use a simplified approach
/// that works across platforms.
fn capture_loop(
    running: Arc<Mutex<bool>>,
    sender: Sender<WebcamFrame>,
    config: WebcamCaptureConfig,
) -> Result<(), String> {
    use nokhwa::pixel_format::RgbFormat;
    use nokhwa::utils::{CameraIndex, RequestedFormat, RequestedFormatType};
    use nokhwa::Camera;
    
    // Create camera with requested format
    let requested = RequestedFormat::new::<RgbFormat>(
        RequestedFormatType::AbsoluteHighestFrameRate
    );
    
    let index = CameraIndex::Index(config.device_index as u32);
    
    let mut camera = Camera::new(index, requested)
        .map_err(|e| format!("Failed to open camera: {}", e))?;
    
    // Get actual resolution
    let resolution = camera.resolution();
    let width = resolution.width();
    let height = resolution.height();
    
    // Open the camera stream
    camera.open_stream()
        .map_err(|e| format!("Failed to open camera stream: {}", e))?;
    
    let frame_duration = Duration::from_secs_f64(1.0 / config.fps as f64);
    let start_time = Instant::now();
    
    println!("Webcam capture started: {}x{} @ {}fps", width, height, config.fps);
    
    while *running.lock() {
        let frame_start = Instant::now();
        
        // Capture a frame
        match camera.frame() {
            Ok(frame) => {
                let timestamp = start_time.elapsed();
                let buffer = frame.buffer();
                
                let webcam_frame = WebcamFrame {
                    data: buffer.to_vec(),
                    width,
                    height,
                    timestamp,
                };
                
                // Send frame (non-blocking, drops if buffer is full)
                let _ = sender.try_send(webcam_frame);
            }
            Err(e) => {
                eprintln!("Webcam frame error: {}", e);
                std::thread::sleep(Duration::from_millis(10));
                continue;
            }
        }
        
        // Maintain target frame rate
        let elapsed = frame_start.elapsed();
        if elapsed < frame_duration {
            std::thread::sleep(frame_duration - elapsed);
        }
    }
    
    // Close the stream
    let _ = camera.stop_stream();
    
    println!("Webcam capture stopped");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_webcam_frame_to_rgba() {
        let frame = WebcamFrame {
            data: vec![255, 128, 64], // One RGB pixel
            width: 1,
            height: 1,
            timestamp: Duration::from_secs(0),
        };
        
        let rgba = frame.to_rgba();
        assert_eq!(rgba, vec![255, 128, 64, 255]); // RGBA with full alpha
    }
}

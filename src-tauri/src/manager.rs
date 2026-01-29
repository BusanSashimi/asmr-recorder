use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use crossbeam_channel::{bounded, Receiver, Sender};
use parking_lot::Mutex;

use crate::audio::{AudioChunk, MicrophoneCapture, MicrophoneCaptureConfig};
use crate::audio_mixer::{AudioMixer, AudioMixerConfig, MixedAudioChunk};
use crate::compositor::{CompositeFrame, CompositorConfig, VideoCompositor};
use crate::encoder::{Encoder, EncoderConfig};
use crate::recording::{OutputResolution, PipPosition, RecordingConfig, RecordingStatus, VideoQuality};
use crate::screen::{ScreenCapture, ScreenCaptureConfig, ScreenFrame};
use crate::system_audio::{SystemAudioCapture, SystemAudioCaptureConfig};
use crate::webcam::{WebcamCapture, WebcamCaptureConfig, WebcamFrame};

/// Recording Manager - orchestrates all capture and encoding components
pub struct RecordingManager {
    /// Current recording configuration
    config: Option<RecordingConfig>,
    /// Current recording status
    status: Arc<Mutex<RecordingStatus>>,
    /// Stop signal
    stop_signal: Arc<Mutex<bool>>,
    /// Screen capture component
    screen_capture: Option<ScreenCapture>,
    /// Webcam capture component
    webcam_capture: Option<WebcamCapture>,
    /// Microphone capture component
    mic_capture: Option<MicrophoneCapture>,
    /// System audio capture component
    system_audio_capture: Option<SystemAudioCapture>,
    /// Audio mixer component
    audio_mixer: Option<AudioMixer>,
    /// Video compositor
    compositor: Option<VideoCompositor>,
    /// Encoder
    encoder: Option<Encoder>,
    /// Encoder error receiver
    encoder_error_receiver: Option<Receiver<String>>,
    /// Compositing thread handle
    compositor_running: Arc<Mutex<bool>>,
}

impl RecordingManager {
    /// Create a new recording manager
    pub fn new() -> Self {
        Self {
            config: None,
            status: Arc::new(Mutex::new(RecordingStatus::default())),
            stop_signal: Arc::new(Mutex::new(false)),
            screen_capture: None,
            webcam_capture: None,
            mic_capture: None,
            system_audio_capture: None,
            audio_mixer: None,
            compositor: None,
            encoder: None,
            encoder_error_receiver: None,
            compositor_running: Arc::new(Mutex::new(false)),
        }
    }
    
    /// Get the current recording status
    pub fn status(&mut self) -> RecordingStatus {
        self.handle_encoder_errors();
        self.status.lock().clone()
    }
    
    /// Start recording with the given configuration
    pub fn start(&mut self, config: RecordingConfig) -> Result<(), String> {
        // Check if already recording
        if self.status.lock().is_recording {
            return Err("Recording already in progress".to_string());
        }
        
        // Validate configuration
        if !config.capture_screen && !config.capture_webcam {
            return Err("At least one video source must be enabled".to_string());
        }
        
        // Generate output path if not provided
        let output_path = config.output_path.clone().unwrap_or_else(|| {
            let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
            let filename = format!("recording_{}.mp4", timestamp);
            
            // In debug/dev mode, save to test-results directory
            #[cfg(debug_assertions)]
            {
                let manifest_dir = env!("CARGO_MANIFEST_DIR");
                let test_results_dir = PathBuf::from(manifest_dir).join("../test-results");
                
                // Create directory if it doesn't exist
                if let Err(e) = std::fs::create_dir_all(&test_results_dir) {
                    eprintln!("Failed to create test-results directory: {}", e);
                    return dirs::video_dir()
                        .unwrap_or_else(|| PathBuf::from("."))
                        .join(&filename);
                }
                
                return test_results_dir.join(&filename);
            }
            
            #[cfg(not(debug_assertions))]
            {
                dirs::video_dir()
                    .unwrap_or_else(|| PathBuf::from("."))
                    .join(filename)
            }
        });
        
        // Reset stop signal
        *self.stop_signal.lock() = false;
        
        // Get output dimensions from config (always 16:9)
        let (output_width, output_height) = config.output_resolution.dimensions();
        
        // Initialize screen capture if enabled
        if config.capture_screen {
            let screen_config = ScreenCaptureConfig {
                fps: config.frame_rate.unwrap_or(30),
                display_index: 0,
            };
            
            let screen_capture = ScreenCapture::new(screen_config)
                .map_err(|e| {
                    let lower = e.to_lowercase();
                    if lower.contains("permission") || lower.contains("screen recording") {
                        "Screen Recording permission required. Open System Settings → Privacy & Security → Screen Recording and enable access for this app.".to_string()
                    } else {
                        format!("Failed to initialize screen capture: {}", e)
                    }
                })?;
            
            self.screen_capture = Some(screen_capture);
        }
        
        // Initialize webcam capture if enabled
        if config.capture_webcam {
            let webcam_config = WebcamCaptureConfig {
                fps: config.frame_rate.unwrap_or(30),
                width: 640,
                height: 480,
                device_index: 0,
            };
            
            let webcam_capture = WebcamCapture::new(webcam_config)
                .map_err(|e| format!("Failed to initialize webcam: {}", e))?;
            
            self.webcam_capture = Some(webcam_capture);
        }
        
        // Initialize microphone capture if enabled
        if config.capture_mic {
            let mic_config = MicrophoneCaptureConfig::default();
            
            let mic_capture = MicrophoneCapture::new(mic_config)
                .map_err(|e| format!("Failed to initialize microphone: {}", e))?;
            
            self.mic_capture = Some(mic_capture);
        }
        
        // Initialize system audio capture if enabled
        if config.capture_system_audio {
            let sys_config = SystemAudioCaptureConfig::default();
            
            match SystemAudioCapture::new(sys_config) {
                Ok(sys_capture) => {
                    if sys_capture.is_available() {
                        self.system_audio_capture = Some(sys_capture);
                    } else {
                        println!("System audio capture not available on this platform");
                    }
                }
                Err(e) => {
                    println!("System audio capture initialization failed: {}", e);
                }
            }
        }
        
        // Initialize compositor with 16:9 output resolution
        let compositor_config = CompositorConfig {
            output_width,
            output_height,
            include_webcam: config.capture_webcam,
            pip_position: config.webcam_position,
            pip_size_percent: config.webcam_size,
            pip_padding: 20,
        };
        
        self.compositor = Some(VideoCompositor::new(compositor_config));
        
        // Initialize audio mixer
        let mixer_config = AudioMixerConfig::default();
        self.audio_mixer = Some(AudioMixer::new(mixer_config));
        
        // Initialize encoder with 16:9 output resolution
        let encoder_config = EncoderConfig {
            output_path: output_path.to_string_lossy().to_string(),
            width: output_width,
            height: output_height,
            frame_rate: config.frame_rate.unwrap_or(30),
            quality: config.video_quality,
            audio_sample_rate: 48000,
            audio_channels: 2,
        };
        
        self.encoder = Some(Encoder::new(encoder_config));
        
        // Store config BEFORE starting pipeline (needed by compositor thread)
        self.config = Some(config);
        
        // Connect components and start capture
        self.start_capture_pipeline()?;
        
        // Update status
        {
            let mut status = self.status.lock();
            status.is_recording = true;
            status.duration_ms = 0;
            status.frame_count = 0;
            status.output_path = Some(output_path);
            status.error = None;
        }
        
        println!("Recording manager started");
        
        Ok(())
    }
    
    /// Start the capture pipeline
    fn start_capture_pipeline(&mut self) -> Result<(), String> {
        // Get receivers from capture components
        let screen_receiver = self.screen_capture.as_mut()
            .and_then(|c| c.take_receiver());
        
        let webcam_receiver = self.webcam_capture.as_mut()
            .and_then(|c| c.take_receiver());
        
        let mic_receiver = self.mic_capture.as_mut()
            .and_then(|c| c.take_receiver());
        
        let system_receiver = self.system_audio_capture.as_mut()
            .and_then(|c| c.take_receiver());
        
        // Connect audio sources to mixer
        if let Some(ref mut mixer) = self.audio_mixer {
            if let Some(receiver) = mic_receiver {
                mixer.set_mic_receiver(receiver);
            }
            if let Some(receiver) = system_receiver {
                mixer.set_system_receiver(receiver);
            }
        }
        
        // Get mixed audio output
        let mixed_audio_receiver = self.audio_mixer.as_mut()
            .and_then(|m| m.take_output_receiver());
        
        // Create channel for composite frames - larger buffer to absorb encoder delays
        // At 30fps, 120 frames = 4 seconds of buffer
        let (composite_sender, composite_receiver) = bounded::<CompositeFrame>(120);

        // Create channel for encoder errors
        let (error_sender, error_receiver) = bounded::<String>(1);
        
        // Connect encoder
        if let Some(ref mut encoder) = self.encoder {
            encoder.set_video_receiver(composite_receiver);
            if let Some(receiver) = mixed_audio_receiver {
                encoder.set_audio_receiver(receiver);
            }
            encoder.set_error_sender(error_sender);
        }
        self.encoder_error_receiver = Some(error_receiver);
        
        // Start all components
        if let Some(ref capture) = self.screen_capture {
            capture.start()?;
        }
        
        if let Some(ref capture) = self.webcam_capture {
            capture.start()?;
        }
        
        if let Some(ref capture) = self.mic_capture {
            capture.start()?;
        }
        
        if let Some(ref capture) = self.system_audio_capture {
            let _ = capture.start(); // Ignore errors for system audio
        }
        
        if let Some(ref mixer) = self.audio_mixer {
            mixer.start()?;
        }
        
        if let Some(ref encoder) = self.encoder {
            encoder.start()?;
        }
        
        // Start compositor thread
        self.start_compositor_thread(
            screen_receiver,
            webcam_receiver,
            composite_sender,
        )?;
        
        Ok(())
    }
    
    /// Start the compositor thread
    fn start_compositor_thread(
        &mut self,
        screen_receiver: Option<Receiver<ScreenFrame>>,
        webcam_receiver: Option<Receiver<WebcamFrame>>,
        composite_sender: Sender<CompositeFrame>,
    ) -> Result<(), String> {
        let config = self.config.as_ref()
            .ok_or("No recording configuration")?;
        
        // Use configured 16:9 output resolution
        let (width, height) = config.output_resolution.dimensions();
        
        let compositor_config = CompositorConfig {
            output_width: width,
            output_height: height,
            include_webcam: config.capture_webcam,
            pip_position: config.webcam_position,
            pip_size_percent: config.webcam_size,
            pip_padding: 20,
        };
        
        let compositor = VideoCompositor::new(compositor_config);
        let running = self.compositor_running.clone();
        let stop_signal = self.stop_signal.clone();
        let status = self.status.clone();
        let capture_screen = config.capture_screen;
        
        *running.lock() = true;
        
        std::thread::spawn(move || {
            compositor_loop(
                running,
                stop_signal,
                status,
                compositor,
                screen_receiver,
                webcam_receiver,
                composite_sender,
                capture_screen,
            );
        });
        
        Ok(())
    }
    
    /// Stop recording
    pub fn stop(&mut self) -> Result<String, String> {
        if !self.status.lock().is_recording {
            return Err("No recording in progress".to_string());
        }
        
        // Signal stop
        *self.stop_signal.lock() = true;
        *self.compositor_running.lock() = false;
        
        // Stop all components
        if let Some(ref capture) = self.screen_capture {
            capture.stop();
        }
        
        if let Some(ref capture) = self.webcam_capture {
            capture.stop();
        }
        
        if let Some(ref capture) = self.mic_capture {
            capture.stop();
        }
        
        if let Some(ref capture) = self.system_audio_capture {
            capture.stop();
        }
        
        if let Some(ref mixer) = self.audio_mixer {
            mixer.stop();
        }
        
        if let Some(ref encoder) = self.encoder {
            let _ = encoder.stop();
        }
        
        // Wait a moment for threads to finish
        std::thread::sleep(Duration::from_millis(500));
        
        // Get output path before clearing
        let output_path = self.status.lock().output_path.clone();
        
        // Update status
        {
            let mut status = self.status.lock();
            status.is_recording = false;
        }
        
        // Clear components
        self.config = None;
        self.screen_capture = None;
        self.webcam_capture = None;
        self.mic_capture = None;
        self.system_audio_capture = None;
        self.audio_mixer = None;
        self.compositor = None;
        self.encoder = None;
        self.encoder_error_receiver = None;
        
        println!("Recording manager stopped");
        
        output_path
            .map(|p| p.to_string_lossy().to_string())
            .ok_or_else(|| "No output path".to_string())
    }
}

impl RecordingManager {
    fn handle_encoder_errors(&mut self) {
        let error_message = match self.encoder_error_receiver.as_ref() {
            Some(receiver) => receiver.try_recv().ok(),
            None => None,
        };

        if let Some(message) = error_message {
            self.handle_encoder_failure(message);
        }
    }

    fn handle_encoder_failure(&mut self, message: String) {
        eprintln!("Encoder failure: {}", message);
        let _ = self.stop();
        let mut status = self.status.lock();
        status.error = Some(message);
        status.is_recording = false;
    }
}

impl Default for RecordingManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Timeout for sending composite frames to encoder
/// Shorter timeout keeps the pipeline responsive
const COMPOSITE_SEND_TIMEOUT: Duration = Duration::from_millis(50);

/// Compositor loop - combines screen and webcam frames
fn compositor_loop(
    running: Arc<Mutex<bool>>,
    stop_signal: Arc<Mutex<bool>>,
    status: Arc<Mutex<RecordingStatus>>,
    compositor: VideoCompositor,
    screen_receiver: Option<Receiver<ScreenFrame>>,
    webcam_receiver: Option<Receiver<WebcamFrame>>,
    composite_sender: Sender<CompositeFrame>,
    capture_screen: bool,
) {
    let start_time = Instant::now();
    let mut frame_count: u64 = 0;
    let mut skipped_frames: u64 = 0;
    let mut latest_webcam: Option<WebcamFrame> = None;
    let mut last_frame_time = Instant::now();
    let mut no_frame_warning_printed = false;

    // Adaptive frame rate control
    // Target: process frames at a rate the encoder can handle
    let target_frame_interval = Duration::from_millis(33); // ~30fps target
    let mut last_processed_time = Instant::now();

    println!("Compositor loop started (capture_screen: {})", capture_screen);

    while *running.lock() && !*stop_signal.lock() {
        // Get latest webcam frame (non-blocking)
        if let Some(ref receiver) = webcam_receiver {
            while let Ok(frame) = receiver.try_recv() {
                latest_webcam = Some(frame);
            }
        }

        // Process screen frames
        if capture_screen {
            if let Some(ref receiver) = screen_receiver {
                let mut received_frame = false;
                let mut latest_screen_frame: Option<ScreenFrame> = None;

                // Drain all available frames, keeping only the latest
                // This implements adaptive frame skipping - we always use the most recent frame
                while let Ok(screen_frame) = receiver.try_recv() {
                    if latest_screen_frame.is_some() {
                        skipped_frames += 1;
                    }
                    latest_screen_frame = Some(screen_frame);
                    received_frame = true;
                }

                // Process the latest frame if we have one and enough time has passed
                if let Some(screen_frame) = latest_screen_frame {
                    last_frame_time = Instant::now();
                    no_frame_warning_printed = false;

                    // Check if encoder queue has space (adaptive rate control)
                    let queue_len = composite_sender.len();
                    let queue_pressure = queue_len as f32 / 120.0; // 0.0 to 1.0

                    // Skip frames if queue is getting full (backpressure)
                    // This prevents buffer overflow and keeps latency low
                    let should_skip = queue_pressure > 0.8
                        && last_processed_time.elapsed() < target_frame_interval * 2;

                    if should_skip {
                        skipped_frames += 1;
                    } else {
                        let composite = compositor.composite(
                            &screen_frame,
                            latest_webcam.as_ref(),
                        );

                        // Use try_send to avoid blocking - if queue is full, skip this frame
                        match composite_sender.try_send(composite) {
                            Ok(()) => {
                                frame_count += 1;
                                last_processed_time = Instant::now();

                                // Update status periodically
                                if frame_count % 30 == 0 {
                                    let mut s = status.lock();
                                    s.frame_count = frame_count;
                                    s.duration_ms = start_time.elapsed().as_millis() as u64;
                                }
                            }
                            Err(_) => {
                                skipped_frames += 1;
                            }
                        }
                    }
                }

                // Check if we haven't received frames for too long
                if !received_frame && !no_frame_warning_printed {
                    let elapsed = last_frame_time.elapsed();
                    if elapsed > Duration::from_secs(2) {
                        eprintln!(
                            "Compositor: no screen frames received for {:.1}s (len: {})",
                            elapsed.as_secs_f32(),
                            receiver.len()
                        );
                        no_frame_warning_printed = true;
                    }
                }
            }
        } else if let Some(ref webcam) = latest_webcam {
            // Webcam only mode - use same adaptive approach
            let queue_len = composite_sender.len();
            let should_skip = queue_len > 96; // 80% of 120

            if should_skip {
                skipped_frames += 1;
            } else {
                let composite = compositor.composite_webcam_only(webcam);

                match composite_sender.try_send(composite) {
                    Ok(()) => {
                        frame_count += 1;
                        last_processed_time = Instant::now();

                        if frame_count % 30 == 0 {
                            let mut s = status.lock();
                            s.frame_count = frame_count;
                            s.duration_ms = start_time.elapsed().as_millis() as u64;
                        }
                    }
                    Err(_) => {
                        skipped_frames += 1;
                    }
                }
            }

            // Clear webcam frame to wait for next
            latest_webcam = None;
        }

        std::thread::sleep(Duration::from_millis(1));
    }

    // Final status update
    {
        let mut s = status.lock();
        s.frame_count = frame_count;
        s.duration_ms = start_time.elapsed().as_millis() as u64;
    }

    let duration_secs = start_time.elapsed().as_secs_f32();
    let effective_fps = frame_count as f32 / duration_secs;
    println!(
        "Compositor loop stopped: {} frames in {:.1}s ({:.1} fps), {} skipped",
        frame_count, duration_secs, effective_fps, skipped_frames
    );
}

//! External Frame Recorder
//! 
//! This module handles recording when video frames are sent from the frontend
//! instead of being captured natively. This enables WYSIWYG recording where
//! the frontend composites multiple sources and sends the combined frames.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use crossbeam_channel::{bounded, Sender, Receiver};
use parking_lot::Mutex;

use crate::audio::{AudioChunk, MicrophoneCapture, MicrophoneCaptureConfig};
use crate::audio_mixer::{AudioMixer, AudioMixerConfig, MixedAudioChunk};
use crate::compositor::CompositeFrame;
use crate::encoder::{Encoder, EncoderConfig};
use crate::recording::{ExternalRecordingConfig, RecordingStatus, VideoQuality};
use crate::system_audio::{SystemAudioCapture, SystemAudioCaptureConfig};

/// External Frame Recorder - records video frames sent from the frontend
pub struct ExternalRecorder {
    /// Current recording configuration
    config: Option<ExternalRecordingConfig>,
    /// Current recording status
    status: Arc<Mutex<RecordingStatus>>,
    /// Stop signal
    stop_signal: Arc<Mutex<bool>>,
    /// Microphone capture component
    mic_capture: Option<MicrophoneCapture>,
    /// System audio capture component
    system_audio_capture: Option<SystemAudioCapture>,
    /// Audio mixer component
    audio_mixer: Option<AudioMixer>,
    /// Encoder
    encoder: Option<Encoder>,
    /// Encoder error receiver
    encoder_error_receiver: Option<Receiver<String>>,
    /// Frame sender channel (for receiving frames from Tauri commands)
    frame_sender: Option<Sender<CompositeFrame>>,
    /// Recording start time
    start_time: Option<Instant>,
    /// Frame count
    frame_count: Arc<Mutex<u64>>,
}

impl ExternalRecorder {
    /// Create a new external recorder
    pub fn new() -> Self {
        Self {
            config: None,
            status: Arc::new(Mutex::new(RecordingStatus::default())),
            stop_signal: Arc::new(Mutex::new(false)),
            mic_capture: None,
            system_audio_capture: None,
            audio_mixer: None,
            encoder: None,
            encoder_error_receiver: None,
            frame_sender: None,
            start_time: None,
            frame_count: Arc::new(Mutex::new(0)),
        }
    }

    /// Get the current recording status
    pub fn status(&mut self) -> RecordingStatus {
        self.handle_encoder_errors();
        
        let mut status = self.status.lock().clone();
        
        // Update duration if recording
        if status.is_recording {
            if let Some(start) = self.start_time {
                status.duration_ms = start.elapsed().as_millis() as u64;
            }
            status.frame_count = *self.frame_count.lock();
        }
        
        status
    }

    /// Start recording with the given configuration
    pub fn start(&mut self, config: ExternalRecordingConfig) -> Result<(), String> {
        // Check if already recording
        if self.status.lock().is_recording {
            return Err("Recording already in progress".to_string());
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
        *self.frame_count.lock() = 0;

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

        // Initialize audio mixer
        let mixer_config = AudioMixerConfig::default();
        self.audio_mixer = Some(AudioMixer::new(mixer_config));

        // Initialize encoder
        let encoder_config = EncoderConfig {
            output_path: output_path.to_string_lossy().to_string(),
            width: config.output_width,
            height: config.output_height,
            frame_rate: config.frame_rate.unwrap_or(30),
            quality: config.video_quality,
            audio_sample_rate: 48000,
            audio_channels: 2,
        };

        self.encoder = Some(Encoder::new(encoder_config));

        // Store config
        self.config = Some(config);

        // Connect components and start capture
        self.start_pipeline(output_path.clone())?;

        // Update status
        {
            let mut status = self.status.lock();
            status.is_recording = true;
            status.duration_ms = 0;
            status.frame_count = 0;
            status.output_path = Some(output_path);
            status.error = None;
        }

        self.start_time = Some(Instant::now());

        println!("External recorder started");

        Ok(())
    }

    /// Start the recording pipeline
    fn start_pipeline(&mut self, _output_path: PathBuf) -> Result<(), String> {
        // Get receivers from audio capture components
        let mic_receiver = self.mic_capture.as_mut().and_then(|c| c.take_receiver());

        let system_receiver = self
            .system_audio_capture
            .as_mut()
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
        let mixed_audio_receiver = self
            .audio_mixer
            .as_mut()
            .and_then(|m| m.take_output_receiver());

        // Create channel for video frames from frontend
        // Buffer size: 120 frames = ~4 seconds at 30fps
        let (frame_sender, frame_receiver) = bounded::<CompositeFrame>(120);
        self.frame_sender = Some(frame_sender);

        // Create channel for encoder errors
        let (error_sender, error_receiver) = bounded::<String>(1);

        // Connect encoder
        if let Some(ref mut encoder) = self.encoder {
            encoder.set_video_receiver(frame_receiver);
            if let Some(receiver) = mixed_audio_receiver {
                encoder.set_audio_receiver(receiver);
            }
            encoder.set_error_sender(error_sender);
        }
        self.encoder_error_receiver = Some(error_receiver);

        // Start audio components
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

        Ok(())
    }

    /// Receive a video frame from the frontend
    pub fn receive_frame(
        &mut self,
        data: Vec<u8>,
        width: u32,
        height: u32,
        timestamp_ms: u64,
    ) -> Result<(), String> {
        // Check if recording
        if !self.status.lock().is_recording {
            return Err("Not recording".to_string());
        }

        // Log first frame
        let count = *self.frame_count.lock();
        if count == 0 {
            println!("Received first frame: {}x{}, {} bytes, timestamp: {}ms", 
                width, height, data.len(), timestamp_ms);
        }

        // Validate frame dimensions
        let config = self.config.as_ref().ok_or("No recording configuration")?;
        if width != config.output_width || height != config.output_height {
            return Err(format!(
                "Frame dimensions {}x{} don't match config {}x{}",
                width, height, config.output_width, config.output_height
            ));
        }

        // Validate data size (RGBA = 4 bytes per pixel)
        let expected_size = (width * height * 4) as usize;
        if data.len() != expected_size {
            return Err(format!(
                "Frame data size {} doesn't match expected {} ({}x{}x4)",
                data.len(),
                expected_size,
                width,
                height
            ));
        }

        // Create composite frame
        let frame = CompositeFrame {
            data,
            width,
            height,
            timestamp: Duration::from_millis(timestamp_ms),
            is_bgra: false, // Frontend sends RGBA
        };

        // Send to encoder
        if let Some(ref sender) = self.frame_sender {
            match sender.try_send(frame) {
                Ok(()) => {
                    let mut count = self.frame_count.lock();
                    *count += 1;
                    
                    // Update status periodically
                    if *count % 30 == 0 {
                        let mut status = self.status.lock();
                        status.frame_count = *count;
                        if let Some(start) = self.start_time {
                            status.duration_ms = start.elapsed().as_millis() as u64;
                        }
                    }
                    
                    Ok(())
                }
                Err(crossbeam_channel::TrySendError::Full(_)) => {
                    // Queue is full, skip this frame (backpressure)
                    Ok(())
                }
                Err(crossbeam_channel::TrySendError::Disconnected(_)) => {
                    Err("Encoder disconnected".to_string())
                }
            }
        } else {
            Err("Frame sender not initialized".to_string())
        }
    }

    /// Stop recording
    pub fn stop(&mut self) -> Result<String, String> {
        if !self.status.lock().is_recording {
            return Err("No recording in progress".to_string());
        }

        // Signal stop
        *self.stop_signal.lock() = true;

        // Close frame sender to signal encoder
        self.frame_sender = None;

        // Stop all components
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
        self.mic_capture = None;
        self.system_audio_capture = None;
        self.audio_mixer = None;
        self.encoder = None;
        self.encoder_error_receiver = None;
        self.start_time = None;

        println!("External recorder stopped");

        output_path
            .map(|p| p.to_string_lossy().to_string())
            .ok_or_else(|| "No output path".to_string())
    }

    /// Check if recording is in progress
    pub fn is_recording(&self) -> bool {
        self.status.lock().is_recording
    }

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

impl Default for ExternalRecorder {
    fn default() -> Self {
        Self::new()
    }
}

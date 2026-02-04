use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use parking_lot::{Mutex, RwLock};
use tauri::command;
use thiserror::Error;

use crate::manager::RecordingManager;
use crate::system_audio::is_system_audio_available;

/// Position for picture-in-picture webcam overlay
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum PipPosition {
    #[default]
    TopRight,
    TopLeft,
    BottomRight,
    BottomLeft,
}

/// Video quality preset
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum VideoQuality {
    Low,
    #[default]
    Medium,
    High,
}

impl VideoQuality {
    /// Get the CRF (Constant Rate Factor) value for H.264 encoding
    /// Lower values = higher quality, larger files
    pub fn crf(&self) -> u32 {
        match self {
            VideoQuality::Low => 28,
            VideoQuality::Medium => 23,
            VideoQuality::High => 18,
        }
    }

    /// Get the bitrate in kbps for encoding
    pub fn video_bitrate(&self) -> u32 {
        match self {
            VideoQuality::Low => 2500,
            VideoQuality::Medium => 5000,
            VideoQuality::High => 10000,
        }
    }

    /// Get audio bitrate in kbps
    pub fn audio_bitrate(&self) -> u32 {
        match self {
            VideoQuality::Low => 128,
            VideoQuality::Medium => 192,
            VideoQuality::High => 256,
        }
    }
}

/// Output resolution preset for 16:9 aspect ratio
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum OutputResolution {
    /// 1280x720 (720p)
    Hd720,
    /// 1920x1080 (1080p)
    #[default]
    Hd1080,
    /// 2560x1440 (1440p/2K)
    Qhd1440,
    /// 3840x2160 (4K)
    Uhd4k,
}

impl OutputResolution {
    /// Get the width and height for this resolution
    pub fn dimensions(&self) -> (u32, u32) {
        match self {
            OutputResolution::Hd720 => (1280, 720),
            OutputResolution::Hd1080 => (1920, 1080),
            OutputResolution::Qhd1440 => (2560, 1440),
            OutputResolution::Uhd4k => (3840, 2160),
        }
    }
    
    /// Get just the width
    pub fn width(&self) -> u32 {
        self.dimensions().0
    }
    
    /// Get just the height
    pub fn height(&self) -> u32 {
        self.dimensions().1
    }
}

/// Configuration for a recording session
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingConfig {
    /// Whether to capture the screen
    pub capture_screen: bool,
    
    /// Whether to capture webcam
    pub capture_webcam: bool,
    
    /// Position of webcam PiP overlay
    pub webcam_position: PipPosition,
    
    /// Size of webcam as percentage of screen (10-50)
    pub webcam_size: u32,
    
    /// Whether to capture microphone audio
    pub capture_mic: bool,
    
    /// Whether to capture system audio
    pub capture_system_audio: bool,
    
    /// Output file path (optional, will generate if not provided)
    pub output_path: Option<PathBuf>,
    
    /// Video quality preset
    pub video_quality: VideoQuality,
    
    /// Target frame rate (default 30)
    pub frame_rate: Option<u32>,
    
    /// Output resolution (default 1080p, always 16:9)
    #[serde(default)]
    pub output_resolution: OutputResolution,
}

impl Default for RecordingConfig {
    fn default() -> Self {
        Self {
            capture_screen: true,
            capture_webcam: false,
            webcam_position: PipPosition::default(),
            webcam_size: 25,
            capture_mic: true,
            capture_system_audio: false,
            output_path: None,
            video_quality: VideoQuality::default(),
            frame_rate: Some(30),
            output_resolution: OutputResolution::default(),
        }
    }
}

/// Configuration for external frame recording (frames sent from frontend)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalRecordingConfig {
    /// Whether to capture microphone audio
    pub capture_mic: bool,
    
    /// Whether to capture system audio
    pub capture_system_audio: bool,
    
    /// Output file path (optional, will generate if not provided)
    pub output_path: Option<PathBuf>,
    
    /// Video quality preset
    pub video_quality: VideoQuality,
    
    /// Target frame rate (default 30)
    pub frame_rate: Option<u32>,
    
    /// Output resolution (default 1080p, always 16:9)
    #[serde(default)]
    pub output_resolution: OutputResolution,
    
    /// Output width in pixels (must match frames sent from frontend)
    pub output_width: u32,
    
    /// Output height in pixels (must match frames sent from frontend)
    pub output_height: u32,
}

impl Default for ExternalRecordingConfig {
    fn default() -> Self {
        Self {
            capture_mic: true,
            capture_system_audio: false,
            output_path: None,
            video_quality: VideoQuality::default(),
            frame_rate: Some(30),
            output_resolution: OutputResolution::default(),
            output_width: 1920,
            output_height: 1080,
        }
    }
}

/// Current recording status
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingStatus {
    /// Whether recording is currently active
    pub is_recording: bool,
    
    /// Duration in milliseconds
    pub duration_ms: u64,
    
    /// Current frame count
    pub frame_count: u64,
    
    /// Output file path (if recording)
    pub output_path: Option<PathBuf>,
    
    /// Any error message
    pub error: Option<String>,
}

impl Default for RecordingStatus {
    fn default() -> Self {
        Self {
            is_recording: false,
            duration_ms: 0,
            frame_count: 0,
            output_path: None,
            error: None,
        }
    }
}

/// Information about available devices
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
}

/// List of available capture devices
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DeviceList {
    pub screens: Vec<DeviceInfo>,
    pub webcams: Vec<DeviceInfo>,
    pub microphones: Vec<DeviceInfo>,
    pub has_system_audio: bool,
}

/// Recording errors
#[derive(Error, Debug)]
pub enum RecordingError {
    #[error("Recording already in progress")]
    AlreadyRecording,
    
    #[error("No recording in progress")]
    NotRecording,
    
    #[error("No video source selected")]
    NoVideoSource,
    
    #[error("Screen capture error: {0}")]
    ScreenCapture(String),
    
    #[error("Webcam error: {0}")]
    Webcam(String),
    
    #[error("Audio error: {0}")]
    Audio(String),
    
    #[error("Encoding error: {0}")]
    Encoding(String),
    
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

impl Serialize for RecordingError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

/// Global recording state
pub struct RecordingState {
    pub status: RwLock<RecordingStatus>,
    pub config: RwLock<Option<RecordingConfig>>,
    pub stop_signal: RwLock<bool>,
    pub manager: Mutex<RecordingManager>,
}

impl Default for RecordingState {
    fn default() -> Self {
        Self {
            status: RwLock::new(RecordingStatus::default()),
            config: RwLock::new(None),
            stop_signal: RwLock::new(false),
            manager: Mutex::new(RecordingManager::new()),
        }
    }
}

/// Tauri command: Get list of available capture devices
#[command]
pub fn get_available_devices() -> Result<DeviceList, String> {
    use cpal::traits::{DeviceTrait, HostTrait};

    let mut device_list = DeviceList::default();

    // Get available screens
    #[cfg(target_os = "macos")]
    {
        if let Ok(content) = screencapturekit::prelude::SCShareableContent::get() {
            for (i, display) in content.displays().iter().enumerate() {
                device_list.screens.push(DeviceInfo {
                    id: format!("screen_{}", display.display_id()),
                    name: if i == 0 {
                        "Primary Display".to_string()
                    } else {
                        format!("Display {}", i + 1)
                    },
                });
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        for index in 0..8 {
            match windows_capture::monitor::Monitor::from_index(index) {
                Ok(monitor) => {
                    let name = monitor.name().unwrap_or_else(|| format!("Display {}", index + 1));
                    device_list.screens.push(DeviceInfo {
                        id: format!("screen_{}", index),
                        name,
                    });
                }
                Err(_) => break,
            }
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        if let Ok(displays) = scrap::Display::all() {
            for (i, _display) in displays.iter().enumerate() {
                device_list.screens.push(DeviceInfo {
                    id: format!("screen_{}", i),
                    name: if i == 0 {
                        "Primary Display".to_string()
                    } else {
                        format!("Display {}", i + 1)
                    },
                });
            }
        }
    }

    // Get available microphones
    let host = cpal::default_host();
    if let Ok(devices) = host.input_devices() {
        for device in devices {
            if let Ok(name) = device.name() {
                device_list.microphones.push(DeviceInfo {
                    id: name.clone(),
                    name,
                });
            }
        }
    }
    
    // Check for system audio capability (platform-specific)
    device_list.has_system_audio = is_system_audio_available();
    
    // Note: Webcam enumeration will be added when nokhwa is properly configured
    // For now, we'll try to detect if any webcam is available
    device_list.webcams.push(DeviceInfo {
        id: "default".to_string(),
        name: "Default Camera".to_string(),
    });
    
    Ok(device_list)
}

/// Tauri command: Get current recording status
#[command]
pub fn get_recording_status(state: tauri::State<'_, Arc<RecordingState>>) -> RecordingStatus {
    state.status.read().clone()
}

/// Tauri command: Start recording with the given configuration
#[command]
pub async fn start_recording(
    config: RecordingConfig,
    state: tauri::State<'_, Arc<RecordingState>>,
) -> Result<(), String> {
    // Check if already recording
    {
        let status = state.status.read();
        if status.is_recording {
            return Err(RecordingError::AlreadyRecording.to_string());
        }
    }
    
    // Validate configuration
    if !config.capture_screen && !config.capture_webcam {
        return Err(RecordingError::NoVideoSource.to_string());
    }
    
    // Store config
    {
        let mut cfg = state.config.write();
        *cfg = Some(config.clone());
    }
    
    {
        let mut stop = state.stop_signal.write();
        *stop = false;
    }
    
    // Start recording using the manager
    let result = {
        let mut manager = state.manager.lock();
        manager.start(config)
    };
    
    match result {
        Ok(()) => {
            // Update status from manager
            let manager_status = {
                let mut manager = state.manager.lock();
                manager.status()
            };
            
            let mut status = state.status.write();
            *status = manager_status;
            
            println!("Recording started successfully");
            Ok(())
        }
        Err(e) => {
            // Clear config on error
            let mut cfg = state.config.write();
            *cfg = None;
            
            Err(e)
        }
    }
}

/// Tauri command: Stop recording and finalize the output file
#[command]
pub async fn stop_recording(
    state: tauri::State<'_, Arc<RecordingState>>,
) -> Result<String, String> {
    {
        let status = state.status.read();
        if !status.is_recording {
            return Err(RecordingError::NotRecording.to_string());
        }
    }
    
    // Signal stop
    {
        let mut stop = state.stop_signal.write();
        *stop = true;
    }
    
    // Stop recording using the manager
    let result = {
        let mut manager = state.manager.lock();
        manager.stop()
    };
    
    // Update status
    {
        let mut status = state.status.write();
        status.is_recording = false;
    }
    
    // Clear config
    {
        let mut cfg = state.config.write();
        *cfg = None;
    }
    
    println!("Recording stopped");
    
    result
}

/// Tauri command: Get current recording status (refreshed from manager)
#[command]
pub fn get_recording_status_live(state: tauri::State<'_, Arc<RecordingState>>) -> RecordingStatus {
    let mut manager = state.manager.lock();
    manager.status()
}

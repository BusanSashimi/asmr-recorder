/// Represents a chunk of captured audio
#[derive(Clone)]
pub struct AudioChunk {
    pub samples: Vec<f32>,
    pub sample_rate: u32,
    pub channels: u16,
    pub timestamp: std::time::Duration,
}

/// System audio capture configuration
pub struct SystemAudioCaptureConfig {
    /// Target sample rate
    pub sample_rate: u32,
    /// Number of channels
    pub channels: u16,
    /// Restrict capture to a single application by bundle ID (macOS only).
    /// `None` captures the whole system mix.
    pub app_bundle_id: Option<String>,
}

impl Default for SystemAudioCaptureConfig {
    fn default() -> Self {
        Self {
            sample_rate: 48000,
            channels: 2,
            app_bundle_id: None,
        }
    }
}

#[cfg(target_os = "macos")]
#[path = "system_audio_macos.rs"]
mod system_audio_macos;
#[cfg(target_os = "macos")]
pub use system_audio_macos::{is_system_audio_available, SystemAudioCapture};

#[cfg(not(target_os = "macos"))]
#[path = "system_audio_fallback.rs"]
mod system_audio_fallback;
#[cfg(not(target_os = "macos"))]
pub use system_audio_fallback::{is_system_audio_available, SystemAudioCapture};

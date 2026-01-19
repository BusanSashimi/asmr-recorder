use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::SampleFormat;
use std::sync::Arc;
use std::time::{Duration, Instant};

use crossbeam_channel::{bounded, Receiver, Sender};
use parking_lot::Mutex;

use crate::audio::AudioChunk;

use super::SystemAudioCaptureConfig;

/// Manages system audio capture (loopback)
/// 
/// This captures audio that is being played on the system's speakers.
/// Implementation varies by platform:
/// - Windows: WASAPI loopback
/// - macOS: Requires virtual audio device
/// - Linux: PulseAudio monitor source
pub struct SystemAudioCapture {
    #[allow(dead_code)]
    config: SystemAudioCaptureConfig,
    actual_sample_rate: u32,
    actual_channels: u16,
    running: Arc<Mutex<bool>>,
    chunk_sender: Option<Sender<AudioChunk>>,
    chunk_receiver: Option<Receiver<AudioChunk>>,
    is_available: bool,
}

impl SystemAudioCapture {
    /// Create a new system audio capture instance
    pub fn new(config: SystemAudioCaptureConfig) -> Result<Self, String> {
        let (sender, receiver) = bounded(30);

        let (is_available, actual_sample_rate, actual_channels) =
            Self::check_availability(&config)?;

        Ok(Self {
            config,
            actual_sample_rate,
            actual_channels,
            running: Arc::new(Mutex::new(false)),
            chunk_sender: Some(sender),
            chunk_receiver: Some(receiver),
            is_available,
        })
    }

    /// Check if system audio capture is available on this platform
    fn check_availability(config: &SystemAudioCaptureConfig) -> Result<(bool, u32, u16), String> {
        #[cfg(target_os = "windows")]
        {
            if let Ok(host) = cpal::host_from_id(cpal::HostId::Wasapi) {
                if let Some(device) = host.default_output_device() {
                    if let Ok(supported) = device.default_output_config() {
                        return Ok((
                            true,
                            supported.sample_rate().0,
                            supported.channels(),
                        ));
                    }
                }
            }
            Ok((false, config.sample_rate, config.channels))
        }

        #[cfg(target_os = "macos")]
        {
            let host = cpal::default_host();
            if let Some(device) = host.default_output_device() {
                if let Ok(supported) = device.default_output_config() {
                    return Ok((
                        true,
                        supported.sample_rate().0,
                        supported.channels(),
                    ));
                }
            }
            Ok((true, config.sample_rate, config.channels))
        }

        #[cfg(target_os = "linux")]
        {
            let host = cpal::default_host();

            if let Ok(devices) = host.input_devices() {
                for device in devices {
                    if let Ok(name) = device.name() {
                        if name.contains("monitor") || name.contains("Monitor") {
                            if let Ok(supported) = device.default_input_config() {
                                return Ok((
                                    true,
                                    supported.sample_rate().0,
                                    supported.channels(),
                                ));
                            }
                        }
                    }
                }
            }
            Ok((true, config.sample_rate, config.channels))
        }

        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        {
            Ok((false, config.sample_rate, config.channels))
        }
    }

    /// Check if system audio capture is available
    pub fn is_available(&self) -> bool {
        self.is_available
    }

    /// Get actual audio format
    #[allow(dead_code)]
    pub fn format(&self) -> (u32, u16) {
        (self.actual_sample_rate, self.actual_channels)
    }

    /// Get a receiver for audio chunks
    pub fn take_receiver(&mut self) -> Option<Receiver<AudioChunk>> {
        self.chunk_receiver.take()
    }

    /// Start capturing system audio
    pub fn start(&self) -> Result<(), String> {
        if !self.is_available {
            return Err("System audio capture is not available on this platform".to_string());
        }

        let mut running = self.running.lock();
        if *running {
            return Err("System audio capture already running".to_string());
        }
        *running = true;
        drop(running);

        let running_clone = self.running.clone();
        let sender = self.chunk_sender.clone().ok_or("Chunk sender not available")?;
        let sample_rate = self.actual_sample_rate;
        let channels = self.actual_channels;

        std::thread::spawn(move || {
            if let Err(e) = run_system_audio_capture(running_clone, sender, sample_rate, channels)
            {
                eprintln!("System audio capture error: {}", e);
            }
        });

        println!(
            "System audio capture started: {}Hz, {} channels",
            self.actual_sample_rate, self.actual_channels
        );

        Ok(())
    }

    /// Stop capturing
    pub fn stop(&self) {
        let mut running = self.running.lock();
        *running = false;
        println!("System audio capture stopped");
    }

    /// Check if capture is running
    #[allow(dead_code)]
    pub fn is_running(&self) -> bool {
        *self.running.lock()
    }
}

/// Run system audio capture in a background thread
fn run_system_audio_capture(
    running: Arc<Mutex<bool>>,
    sender: Sender<AudioChunk>,
    sample_rate: u32,
    channels: u16,
) -> Result<(), String> {
    let host = cpal::default_host();

    #[cfg(target_os = "linux")]
    let device = {
        host.input_devices()
            .map_err(|e| format!("Failed to enumerate devices: {}", e))?
            .find(|d| d.name().map(|n| n.contains("monitor")).unwrap_or(false))
            .ok_or("No monitor device found")?
    };

    #[cfg(target_os = "macos")]
    let device = {
        host.input_devices()
            .map_err(|e| format!("Failed to enumerate devices: {}", e))?
            .find(|d| {
                d.name()
                    .map(|n| {
                        n.to_lowercase().contains("blackhole")
                            || n.to_lowercase().contains("soundflower")
                            || n.to_lowercase().contains("loopback")
                    })
                    .unwrap_or(false)
            })
            .or_else(|| host.default_input_device())
            .ok_or("No suitable audio device for system capture")?
    };

    #[cfg(target_os = "windows")]
    let device = { host.default_output_device().ok_or("No default output device")? };

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    return Err("System audio capture not supported on this platform".to_string());

    let supported_config = device
        .default_input_config()
        .map_err(|e| format!("Failed to get config: {}", e))?;

    let sample_format = supported_config.sample_format();
    let config = supported_config.into();

    let start_time = Instant::now();
    let running_for_callback = running.clone();

    let err_fn = |err| eprintln!("System audio stream error: {}", err);

    let stream = match sample_format {
        SampleFormat::F32 => device.build_input_stream(
            &config,
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                if !*running_for_callback.lock() {
                    return;
                }
                let chunk = AudioChunk {
                    samples: data.to_vec(),
                    sample_rate,
                    channels,
                    timestamp: start_time.elapsed(),
                };
                let _ = sender.try_send(chunk);
            },
            err_fn,
            None,
        ),
        SampleFormat::I16 => device.build_input_stream(
            &config,
            move |data: &[i16], _: &cpal::InputCallbackInfo| {
                if !*running_for_callback.lock() {
                    return;
                }
                let samples: Vec<f32> = data.iter().map(|&s| s as f32 / 32768.0).collect();
                let chunk = AudioChunk {
                    samples,
                    sample_rate,
                    channels,
                    timestamp: start_time.elapsed(),
                };
                let _ = sender.try_send(chunk);
            },
            err_fn,
            None,
        ),
        _ => return Err(format!("Unsupported sample format: {:?}", sample_format)),
    }
    .map_err(|e| format!("Failed to build stream: {}", e))?;

    stream
        .play()
        .map_err(|e| format!("Failed to start stream: {}", e))?;

    while *running.lock() {
        std::thread::sleep(Duration::from_millis(100));
    }

    Ok(())
}

pub fn is_system_audio_available() -> bool {
    #[cfg(target_os = "windows")]
    {
        cpal::host_from_id(cpal::HostId::Wasapi).is_ok()
    }

    #[cfg(target_os = "macos")]
    {
        true
    }

    #[cfg(target_os = "linux")]
    {
        let host = cpal::default_host();
        if let Ok(devices) = host.input_devices() {
            devices
                .into_iter()
                .any(|d| d.name().map(|n| n.contains("monitor")).unwrap_or(false))
        } else {
            false
        }
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        false
    }
}

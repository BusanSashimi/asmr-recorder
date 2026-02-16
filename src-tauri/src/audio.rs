use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::SampleFormat;
use std::sync::Arc;
use std::time::{Duration, Instant};
use crossbeam_channel::{bounded, Receiver, Sender};
use parking_lot::Mutex;
use tauri::command;

/// Represents a chunk of captured audio
#[derive(Clone)]
pub struct AudioChunk {
    /// Audio samples (f32 format, interleaved for stereo)
    pub samples: Vec<f32>,
    /// Sample rate
    pub sample_rate: u32,
    /// Number of channels
    pub channels: u16,
    /// Timestamp when chunk was captured
    pub timestamp: Duration,
}

/// Microphone capture configuration
pub struct MicrophoneCaptureConfig {
    /// Device name (None for default)
    pub device_name: Option<String>,
}

impl Default for MicrophoneCaptureConfig {
    fn default() -> Self {
        Self {
            device_name: None,
        }
    }
}

/// Manages microphone audio capture
pub struct MicrophoneCapture {
    config: MicrophoneCaptureConfig,
    actual_sample_rate: u32,
    actual_channels: u16,
    running: Arc<Mutex<bool>>,
    chunk_sender: Option<Sender<AudioChunk>>,
    chunk_receiver: Option<Receiver<AudioChunk>>,
}

impl MicrophoneCapture {
    /// Create a new microphone capture instance
    pub fn new(config: MicrophoneCaptureConfig) -> Result<Self, String> {
        let host = cpal::default_host();
        
        // Get the input device
        let device = if let Some(ref name) = config.device_name {
            host.input_devices()
                .map_err(|e| format!("Failed to enumerate devices: {}", e))?
                .find(|d| d.name().map(|n| n == *name).unwrap_or(false))
                .ok_or_else(|| format!("Device '{}' not found", name))?
        } else {
            host.default_input_device()
                .ok_or("No default input device available")?
        };
        
        // Get supported config
        let supported_config = device.default_input_config()
            .map_err(|e| format!("Failed to get default config: {}", e))?;
        
        let actual_sample_rate = supported_config.sample_rate().0;
        let actual_channels = supported_config.channels();
        
        // Create channel for audio chunks
        let (sender, receiver) = bounded(30); // Buffer ~1 second of audio
        
        Ok(Self {
            config,
            actual_sample_rate,
            actual_channels,
            running: Arc::new(Mutex::new(false)),
            chunk_sender: Some(sender),
            chunk_receiver: Some(receiver),
        })
    }
    
    /// Get a receiver for audio chunks
    pub fn take_receiver(&mut self) -> Option<Receiver<AudioChunk>> {
        self.chunk_receiver.take()
    }
    
    /// Start capturing audio
    /// 
    /// Note: The audio stream runs in a background thread managed by cpal.
    /// To stop, call the stop() method which signals the running flag.
    pub fn start(&self) -> Result<(), String> {
        let mut running = self.running.lock();
        if *running {
            return Err("Microphone capture already running".to_string());
        }
        *running = true;
        drop(running);
        
        let running_clone = self.running.clone();
        let sender = self.chunk_sender.clone()
            .ok_or("Chunk sender not available")?;
        let sample_rate = self.actual_sample_rate;
        let channels = self.actual_channels;
        let device_name = self.config.device_name.clone();
        
        // Spawn thread to manage the stream
        std::thread::spawn(move || {
            if let Err(e) = run_audio_capture(running_clone, sender, sample_rate, channels, device_name) {
                eprintln!("Audio capture error: {}", e);
            }
        });
        
        println!(
            "Microphone capture started: {}Hz, {} channels",
            self.actual_sample_rate, self.actual_channels
        );
        
        Ok(())
    }
    
    /// Stop capturing
    pub fn stop(&self) {
        let mut running = self.running.lock();
        *running = false;
        println!("Microphone capture stopped");
    }
    
}

/// Run the audio capture in a background thread
fn run_audio_capture(
    running: Arc<Mutex<bool>>,
    sender: Sender<AudioChunk>,
    sample_rate: u32,
    channels: u16,
    device_name: Option<String>,
) -> Result<(), String> {
    let host = cpal::default_host();
    
    let device = if let Some(ref name) = device_name {
        host.input_devices()
            .map_err(|e| format!("Failed to enumerate devices: {}", e))?
            .find(|d| d.name().map(|n| n == *name).unwrap_or(false))
            .ok_or_else(|| format!("Device '{}' not found", name))?
    } else {
        host.default_input_device()
            .ok_or("No default input device available")?
    };
    
    let supported_config = device.default_input_config()
        .map_err(|e| format!("Failed to get config: {}", e))?;
    
    let sample_format = supported_config.sample_format();
    let config = supported_config.into();
    
    let start_time = Instant::now();
    let running_for_callback = running.clone();
    
    let err_fn = |err| eprintln!("Audio stream error: {}", err);
    
    let stream = match sample_format {
        SampleFormat::F32 => {
            device.build_input_stream(
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
            )
        }
        SampleFormat::I16 => {
            device.build_input_stream(
                &config,
                move |data: &[i16], _: &cpal::InputCallbackInfo| {
                    if !*running_for_callback.lock() {
                        return;
                    }
                    let samples: Vec<f32> = data
                        .iter()
                        .map(|&s| s as f32 / 32768.0)
                        .collect();
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
            )
        }
        SampleFormat::U16 => {
            device.build_input_stream(
                &config,
                move |data: &[u16], _: &cpal::InputCallbackInfo| {
                    if !*running_for_callback.lock() {
                        return;
                    }
                    let samples: Vec<f32> = data
                        .iter()
                        .map(|&s| (s as f32 - 32768.0) / 32768.0)
                        .collect();
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
            )
        }
        _ => return Err(format!("Unsupported sample format: {:?}", sample_format)),
    }.map_err(|e| format!("Failed to build stream: {}", e))?;
    
    stream.play().map_err(|e| format!("Failed to start stream: {}", e))?;
    
    // Keep the stream alive while running
    while *running.lock() {
        std::thread::sleep(Duration::from_millis(100));
    }
    
    // Stream is dropped when function returns
    Ok(())
}

/// Legacy Tauri command for backward compatibility
#[command]
pub fn start_audio_capture() {
    println!("Starting audio capture...");
    let host = cpal::default_host();
    match host.default_input_device() {
        Some(device) => {
            if let Ok(name) = device.name() {
                println!("Default input device: {}", name);
            }
            println!("Audio capture initialized (use new recording API for actual capture).");
        }
        None => println!("No input device available."),
    }
}


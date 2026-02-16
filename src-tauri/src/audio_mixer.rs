use std::sync::Arc;
use std::time::Duration;
use crossbeam_channel::{bounded, Receiver, Sender, TryRecvError};
use parking_lot::Mutex;

use crate::audio::AudioChunk;

/// Mixed audio output chunk
#[derive(Clone)]
#[allow(dead_code)]
pub struct MixedAudioChunk {
    /// Mixed audio samples (f32 format)
    pub samples: Vec<f32>,
    /// Sample rate
    pub sample_rate: u32,
    /// Number of channels
    pub channels: u16,
    /// Timestamp
    pub timestamp: Duration,
}

/// Audio mixer configuration
pub struct AudioMixerConfig {
    /// Output sample rate
    pub sample_rate: u32,
    /// Output channels
    pub channels: u16,
    /// Microphone volume (0.0 - 2.0)
    pub mic_volume: f32,
    /// System audio volume (0.0 - 2.0)
    pub system_volume: f32,
    /// Buffer size in samples
    pub buffer_size: usize,
}

impl Default for AudioMixerConfig {
    fn default() -> Self {
        Self {
            sample_rate: 48000,
            channels: 2,
            mic_volume: 1.0,
            system_volume: 1.0,
            buffer_size: 1024,
        }
    }
}

/// Audio mixer that combines multiple audio sources
pub struct AudioMixer {
    config: AudioMixerConfig,
    running: Arc<Mutex<bool>>,
    mic_receiver: Option<Receiver<AudioChunk>>,
    system_receiver: Option<Receiver<AudioChunk>>,
    output_sender: Option<Sender<MixedAudioChunk>>,
    output_receiver: Option<Receiver<MixedAudioChunk>>,
}

impl AudioMixer {
    /// Create a new audio mixer
    pub fn new(config: AudioMixerConfig) -> Self {
        let (sender, receiver) = bounded(30);
        
        Self {
            config,
            running: Arc::new(Mutex::new(false)),
            mic_receiver: None,
            system_receiver: None,
            output_sender: Some(sender),
            output_receiver: Some(receiver),
        }
    }
    
    /// Set the microphone audio receiver
    pub fn set_mic_receiver(&mut self, receiver: Receiver<AudioChunk>) {
        self.mic_receiver = Some(receiver);
    }
    
    /// Set the system audio receiver
    pub fn set_system_receiver(&mut self, receiver: Receiver<AudioChunk>) {
        self.system_receiver = Some(receiver);
    }
    
    /// Get the mixed output receiver
    pub fn take_output_receiver(&mut self) -> Option<Receiver<MixedAudioChunk>> {
        self.output_receiver.take()
    }
    
    /// Start mixing audio
    pub fn start(&self) -> Result<(), String> {
        let mut running = self.running.lock();
        if *running {
            return Err("Audio mixer already running".to_string());
        }
        *running = true;
        drop(running);
        
        let running_clone = self.running.clone();
        let mic_receiver = self.mic_receiver.clone();
        let system_receiver = self.system_receiver.clone();
        let output_sender = self.output_sender.clone()
            .ok_or("Output sender not available")?;
        let config = AudioMixerConfig {
            sample_rate: self.config.sample_rate,
            channels: self.config.channels,
            mic_volume: self.config.mic_volume,
            system_volume: self.config.system_volume,
            buffer_size: self.config.buffer_size,
        };
        
        std::thread::spawn(move || {
            mix_loop(running_clone, mic_receiver, system_receiver, output_sender, config);
        });
        
        println!(
            "Audio mixer started: {}Hz, {} channels",
            self.config.sample_rate, self.config.channels
        );
        
        Ok(())
    }
    
    /// Stop mixing
    pub fn stop(&self) {
        let mut running = self.running.lock();
        *running = false;
        println!("Audio mixer stopped");
    }
    
}

/// The main mixing loop
fn mix_loop(
    running: Arc<Mutex<bool>>,
    mic_receiver: Option<Receiver<AudioChunk>>,
    system_receiver: Option<Receiver<AudioChunk>>,
    output_sender: Sender<MixedAudioChunk>,
    config: AudioMixerConfig,
) {
    let mut mic_buffer: Vec<f32> = Vec::new();
    let mut system_buffer: Vec<f32> = Vec::new();
    let mut timestamp = Duration::from_secs(0);
    
    let samples_per_chunk = config.buffer_size * config.channels as usize;
    
    while *running.lock() {
        // Collect samples from microphone
        if let Some(ref receiver) = mic_receiver {
            loop {
                match receiver.try_recv() {
                    Ok(chunk) => {
                        // Resample if necessary and apply volume
                        let processed = process_audio_chunk(
                            &chunk,
                            config.sample_rate,
                            config.channels,
                            config.mic_volume,
                        );
                        mic_buffer.extend(processed);
                        timestamp = chunk.timestamp;
                    }
                    Err(TryRecvError::Empty) => break,
                    Err(TryRecvError::Disconnected) => break,
                }
            }
        }
        
        // Collect samples from system audio
        if let Some(ref receiver) = system_receiver {
            loop {
                match receiver.try_recv() {
                    Ok(chunk) => {
                        let processed = process_audio_chunk(
                            &chunk,
                            config.sample_rate,
                            config.channels,
                            config.system_volume,
                        );
                        system_buffer.extend(processed);
                    }
                    Err(TryRecvError::Empty) => break,
                    Err(TryRecvError::Disconnected) => break,
                }
            }
        }
        
        // Mix when we have enough samples
        while mic_buffer.len() >= samples_per_chunk || system_buffer.len() >= samples_per_chunk {
            let mixed = mix_buffers(
                &mut mic_buffer,
                &mut system_buffer,
                samples_per_chunk,
            );
            
            if !mixed.is_empty() {
                let chunk = MixedAudioChunk {
                    samples: mixed,
                    sample_rate: config.sample_rate,
                    channels: config.channels,
                    timestamp,
                };
                
                let _ = output_sender.try_send(chunk);
            }
        }
        
        // Small sleep to prevent busy waiting
        std::thread::sleep(Duration::from_millis(5));
    }
}

/// Process an audio chunk: resample if needed and apply volume
fn process_audio_chunk(
    chunk: &AudioChunk,
    target_sample_rate: u32,
    target_channels: u16,
    volume: f32,
) -> Vec<f32> {
    let mut samples = chunk.samples.clone();
    
    // Apply volume
    for sample in &mut samples {
        *sample *= volume;
    }
    
    // Convert channels if needed
    if chunk.channels != target_channels {
        samples = convert_channels(&samples, chunk.channels, target_channels);
    }
    
    // Resample if needed (simple linear interpolation)
    if chunk.sample_rate != target_sample_rate {
        samples = resample(&samples, chunk.sample_rate, target_sample_rate, target_channels);
    }
    
    samples
}

/// Convert audio between channel counts
fn convert_channels(samples: &[f32], from_channels: u16, to_channels: u16) -> Vec<f32> {
    if from_channels == to_channels {
        return samples.to_vec();
    }
    
    let num_frames = samples.len() / from_channels as usize;
    let mut output = Vec::with_capacity(num_frames * to_channels as usize);
    
    for i in 0..num_frames {
        if from_channels == 1 && to_channels == 2 {
            // Mono to stereo
            let sample = samples[i];
            output.push(sample);
            output.push(sample);
        } else if from_channels == 2 && to_channels == 1 {
            // Stereo to mono
            let left = samples[i * 2];
            let right = samples[i * 2 + 1];
            output.push((left + right) / 2.0);
        } else {
            // Generic conversion - take first channels or duplicate
            for ch in 0..to_channels as usize {
                if ch < from_channels as usize {
                    output.push(samples[i * from_channels as usize + ch]);
                } else {
                    output.push(samples[i * from_channels as usize]);
                }
            }
        }
    }
    
    output
}

/// Simple linear interpolation resampling
fn resample(samples: &[f32], from_rate: u32, to_rate: u32, channels: u16) -> Vec<f32> {
    if from_rate == to_rate {
        return samples.to_vec();
    }
    
    let num_frames = samples.len() / channels as usize;
    let ratio = from_rate as f64 / to_rate as f64;
    let output_frames = (num_frames as f64 / ratio) as usize;
    
    let mut output = Vec::with_capacity(output_frames * channels as usize);
    
    for i in 0..output_frames {
        let src_pos = i as f64 * ratio;
        let src_idx = src_pos as usize;
        let frac = src_pos - src_idx as f64;
        
        for ch in 0..channels as usize {
            let curr_sample = samples.get(src_idx * channels as usize + ch).copied().unwrap_or(0.0);
            let next_sample = samples.get((src_idx + 1) * channels as usize + ch).copied().unwrap_or(curr_sample);
            
            // Linear interpolation
            let interpolated = curr_sample + (next_sample - curr_sample) * frac as f32;
            output.push(interpolated);
        }
    }
    
    output
}

/// Mix two audio buffers together
fn mix_buffers(
    mic_buffer: &mut Vec<f32>,
    system_buffer: &mut Vec<f32>,
    samples_needed: usize,
) -> Vec<f32> {
    let mut mixed = Vec::with_capacity(samples_needed);
    
    let mic_available = mic_buffer.len().min(samples_needed);
    let system_available = system_buffer.len().min(samples_needed);
    
    // Mix available samples
    for i in 0..samples_needed {
        let mic_sample = if i < mic_available {
            mic_buffer[i]
        } else {
            0.0
        };
        
        let system_sample = if i < system_available {
            system_buffer[i]
        } else {
            0.0
        };
        
        // Simple additive mixing with soft clipping
        let mixed_sample = soft_clip(mic_sample + system_sample);
        mixed.push(mixed_sample);
    }
    
    // Remove used samples from buffers
    if mic_available > 0 {
        mic_buffer.drain(0..mic_available);
    }
    if system_available > 0 {
        system_buffer.drain(0..system_available);
    }
    
    mixed
}

/// Soft clipping to prevent harsh distortion
fn soft_clip(sample: f32) -> f32 {
    if sample.abs() <= 0.5 {
        sample
    } else if sample > 0.0 {
        0.5 + (1.0 - (-2.0 * (sample - 0.5)).exp()) / 2.0
    } else {
        -0.5 - (1.0 - (-2.0 * (-sample - 0.5)).exp()) / 2.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_soft_clip() {
        // Values within range should pass through
        assert!((soft_clip(0.3) - 0.3).abs() < 0.001);
        
        // Values outside range should be clipped
        assert!(soft_clip(2.0) < 1.0);
        assert!(soft_clip(-2.0) > -1.0);
    }
    
    #[test]
    fn test_channel_conversion() {
        // Mono to stereo
        let mono = vec![0.5, 1.0];
        let stereo = convert_channels(&mono, 1, 2);
        assert_eq!(stereo, vec![0.5, 0.5, 1.0, 1.0]);
        
        // Stereo to mono
        let stereo = vec![0.5, 0.5, 1.0, 0.0];
        let mono = convert_channels(&stereo, 2, 1);
        assert_eq!(mono.len(), 2);
        assert!((mono[0] - 0.5).abs() < 0.001);
        assert!((mono[1] - 0.5).abs() < 0.001);
    }
}

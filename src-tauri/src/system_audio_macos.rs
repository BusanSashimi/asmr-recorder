use std::sync::Arc;
use std::time::Instant;

use crossbeam_channel::{bounded, Receiver, Sender};
use parking_lot::Mutex;
use screencapturekit::prelude::*;

use crate::audio::AudioChunk;

use super::SystemAudioCaptureConfig;

pub struct SystemAudioCapture {
    config: SystemAudioCaptureConfig,
    running: Arc<Mutex<bool>>,
    chunk_sender: Option<Sender<AudioChunk>>,
    chunk_receiver: Option<Receiver<AudioChunk>>,
    stream: Arc<Mutex<Option<SCStream>>>,
    is_available: bool,
}

struct AudioHandler {
    sender: Sender<AudioChunk>,
    start_time: Instant,
    sample_rate: u32,
    channels: u16,
}

impl SCStreamOutputTrait for AudioHandler {
    fn did_output_sample_buffer(&self, sample: CMSampleBuffer, of_type: SCStreamOutputType) {
        if of_type != SCStreamOutputType::Audio {
            return;
        }

        let Some(samples) = extract_audio_samples(&sample) else {
            return;
        };

        let chunk = AudioChunk {
            samples,
            sample_rate: self.sample_rate,
            channels: self.channels,
            timestamp: self.start_time.elapsed(),
        };

        let _ = self.sender.try_send(chunk);
    }
}

impl SystemAudioCapture {
    pub fn new(config: SystemAudioCaptureConfig) -> Result<Self, String> {
        let (sender, receiver) = bounded(30);

        Ok(Self {
            config,
            running: Arc::new(Mutex::new(false)),
            chunk_sender: Some(sender),
            chunk_receiver: Some(receiver),
            stream: Arc::new(Mutex::new(None)),
            is_available: true,
        })
    }

    pub fn is_available(&self) -> bool {
        self.is_available
    }

    pub fn take_receiver(&mut self) -> Option<Receiver<AudioChunk>> {
        self.chunk_receiver.take()
    }

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

        let content = SCShareableContent::get()
            .map_err(|e| format!("Failed to get shareable content: {}", e))?;
        let displays = content.displays();
        let display = displays.first().ok_or_else(|| "No display found".to_string())?;

        let filter = SCContentFilter::create()
            .with_display(display)
            .with_excluding_windows(&[])
            .build();

        let stream_config = SCStreamConfiguration::new()
            .with_captures_audio(true)
            .with_sample_rate(self.config.sample_rate as i32)
            .with_channel_count(self.config.channels as i32);

        let mut stream = SCStream::new(&filter, &stream_config);

        let handler = AudioHandler {
            sender: self
                .chunk_sender
                .clone()
                .ok_or("Chunk sender not available")?,
            start_time: Instant::now(),
            sample_rate: self.config.sample_rate,
            channels: self.config.channels,
        };

        stream.add_output_handler(handler, SCStreamOutputType::Audio);
        stream
            .start_capture()
            .map_err(|e| format!("Failed to start capture: {}", e))?;

        let mut stream_guard = self.stream.lock();
        *stream_guard = Some(stream);

        println!(
            "System audio capture started: {}Hz, {} channels",
            self.config.sample_rate, self.config.channels
        );

        Ok(())
    }

    pub fn stop(&self) {
        let mut running = self.running.lock();
        *running = false;

        let mut stream_guard = self.stream.lock();
        if let Some(stream) = stream_guard.take() {
            let _ = stream.stop_capture();
        }

        println!("System audio capture stopped");
    }

}

pub fn is_system_audio_available() -> bool {
    true
}

fn extract_audio_samples(sample: &CMSampleBuffer) -> Option<Vec<f32>> {
    let audio_list = sample.audio_buffer_list()?;
    let mut channel_buffers: Vec<Vec<f32>> = Vec::new();

    for buffer in audio_list.iter() {
        let bytes = buffer.data();
        if bytes.is_empty() {
            continue;
        }

        let samples = unsafe {
            std::slice::from_raw_parts(
                bytes.as_ptr() as *const f32,
                bytes.len() / std::mem::size_of::<f32>(),
            )
        };
        channel_buffers.push(samples.to_vec());
    }

    if channel_buffers.is_empty() {
        return None;
    }

    if channel_buffers.len() == 1 {
        return Some(channel_buffers[0].clone());
    }

    let frame_count = channel_buffers
        .iter()
        .map(|samples| samples.len())
        .min()
        .unwrap_or(0);

    let mut interleaved = Vec::with_capacity(frame_count * channel_buffers.len());
    for frame_index in 0..frame_count {
        for channel in &channel_buffers {
            interleaved.push(channel[frame_index]);
        }
    }

    Some(interleaved)
}

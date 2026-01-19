use std::sync::Arc;
use crossbeam_channel::Receiver;
use parking_lot::Mutex;

use crate::compositor::CompositeFrame;
use crate::audio_mixer::MixedAudioChunk;
use crate::recording::VideoQuality;

#[cfg(feature = "ffmpeg")]
use ffmpeg_next::channel_layout::ChannelLayout;

/// Encoder configuration
pub struct EncoderConfig {
    /// Output file path
    pub output_path: String,
    /// Video width
    pub width: u32,
    /// Video height
    pub height: u32,
    /// Frame rate
    pub frame_rate: u32,
    /// Video quality preset
    pub quality: VideoQuality,
    /// Audio sample rate
    pub audio_sample_rate: u32,
    /// Audio channels
    pub audio_channels: u16,
}

impl Default for EncoderConfig {
    fn default() -> Self {
        Self {
            output_path: "output.mp4".to_string(),
            width: 1920,
            height: 1080,
            frame_rate: 30,
            quality: VideoQuality::Medium,
            audio_sample_rate: 48000,
            audio_channels: 2,
        }
    }
}

/// Video/Audio encoder
/// 
/// When compiled with the `ffmpeg` feature, uses FFmpeg for encoding.
/// Otherwise, uses a simple frame-saving approach.
pub struct Encoder {
    config: EncoderConfig,
    running: Arc<Mutex<bool>>,
    video_receiver: Option<Receiver<CompositeFrame>>,
    audio_receiver: Option<Receiver<MixedAudioChunk>>,
    frames_encoded: Arc<Mutex<u64>>,
}

impl Encoder {
    /// Create a new encoder
    pub fn new(config: EncoderConfig) -> Self {
        Self {
            config,
            running: Arc::new(Mutex::new(false)),
            video_receiver: None,
            audio_receiver: None,
            frames_encoded: Arc::new(Mutex::new(0)),
        }
    }
    
    /// Set the video frame receiver
    pub fn set_video_receiver(&mut self, receiver: Receiver<CompositeFrame>) {
        self.video_receiver = Some(receiver);
    }
    
    /// Set the audio chunk receiver
    pub fn set_audio_receiver(&mut self, receiver: Receiver<MixedAudioChunk>) {
        self.audio_receiver = Some(receiver);
    }
    
    /// Get the number of frames encoded
    pub fn frames_encoded(&self) -> u64 {
        *self.frames_encoded.lock()
    }
    
    /// Start encoding
    pub fn start(&self) -> Result<(), String> {
        let mut running = self.running.lock();
        if *running {
            return Err("Encoder already running".to_string());
        }
        *running = true;
        drop(running);
        
        let running_clone = self.running.clone();
        let frames_encoded = self.frames_encoded.clone();
        let video_receiver = self.video_receiver.clone();
        let audio_receiver = self.audio_receiver.clone();
        let config = EncoderConfig {
            output_path: self.config.output_path.clone(),
            width: self.config.width,
            height: self.config.height,
            frame_rate: self.config.frame_rate,
            quality: self.config.quality,
            audio_sample_rate: self.config.audio_sample_rate,
            audio_channels: self.config.audio_channels,
        };
        
        std::thread::spawn(move || {
            #[cfg(feature = "ffmpeg")]
            {
                if let Err(e) = encode_loop_ffmpeg(
                    running_clone,
                    frames_encoded,
                    video_receiver,
                    audio_receiver,
                    config,
                ) {
                    eprintln!("Encoder error: {}", e);
                }
            }
            
            #[cfg(not(feature = "ffmpeg"))]
            {
                encode_loop_fallback(
                    running_clone,
                    frames_encoded,
                    video_receiver,
                    audio_receiver,
                    config,
                );
            }
        });
        
        println!("Encoder started: {} @ {}fps", self.config.output_path, self.config.frame_rate);
        
        Ok(())
    }
    
    /// Stop encoding and finalize the output file
    pub fn stop(&self) -> Result<(), String> {
        let mut running = self.running.lock();
        *running = false;
        println!("Encoder stopping...");
        Ok(())
    }
    
    /// Check if encoder is running
    pub fn is_running(&self) -> bool {
        *self.running.lock()
    }
}

/// Fallback encoding loop when FFmpeg is not available
/// Saves raw frames as images instead of encoding to video
#[cfg(not(feature = "ffmpeg"))]
fn encode_loop_fallback(
    running: Arc<Mutex<bool>>,
    frames_encoded: Arc<Mutex<u64>>,
    video_receiver: Option<Receiver<CompositeFrame>>,
    _audio_receiver: Option<Receiver<MixedAudioChunk>>,
    config: EncoderConfig,
) {
    use std::path::Path;
    use std::fs;
    
    println!("Using fallback encoder (FFmpeg not available)");
    println!("Frames will be saved as PNG images");
    
    // Create output directory for frames
    let output_path = Path::new(&config.output_path);
    let output_dir = output_path.parent().unwrap_or(Path::new("."));
    let base_name = output_path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("recording");
    
    let frames_dir = output_dir.join(format!("{}_frames", base_name));
    if let Err(e) = fs::create_dir_all(&frames_dir) {
        eprintln!("Failed to create frames directory: {}", e);
        return;
    }
    
    let mut frame_count: u64 = 0;
    
    while *running.lock() {
        // Process video frames
        if let Some(ref receiver) = video_receiver {
            while let Ok(composite_frame) = receiver.try_recv() {
                // Save frame as PNG
                let frame_path = frames_dir.join(format!("frame_{:06}.png", frame_count));
                
                // Convert RGBA to image and save
                if let Some(img) = image::RgbaImage::from_raw(
                    config.width,
                    config.height,
                    composite_frame.data.clone(),
                ) {
                    if let Err(e) = img.save(&frame_path) {
                        eprintln!("Failed to save frame: {}", e);
                    }
                } else {
                    eprintln!("Failed to create image from frame data (expected {} bytes, got {})",
                        config.width * config.height * 4,
                        composite_frame.data.len());
                }
                
                frame_count += 1;
                *frames_encoded.lock() = frame_count;
                
                // Print progress every 30 frames
                if frame_count % 30 == 0 {
                    println!("Encoded {} frames", frame_count);
                }
            }
        }
        
        std::thread::sleep(std::time::Duration::from_millis(1));
    }
    
    println!("Fallback encoding complete: {} frames saved to {:?}", frame_count, frames_dir);
    
    // Write a metadata file
    let metadata_path = output_dir.join(format!("{}_metadata.txt", base_name));
    let metadata = format!(
        "Recording Metadata\n\
        ==================\n\
        Frames: {}\n\
        Resolution: {}x{}\n\
        Frame Rate: {} fps\n\
        Quality: {:?}\n\
        \n\
        To convert to video, use FFmpeg:\n\
        ffmpeg -r {} -i {}_frames/frame_%06d.png -c:v libx264 -pix_fmt yuv420p {}.mp4\n",
        frame_count,
        config.width,
        config.height,
        config.frame_rate,
        config.quality,
        config.frame_rate,
        base_name,
        base_name,
    );
    
    if let Err(e) = fs::write(&metadata_path, metadata) {
        eprintln!("Failed to write metadata: {}", e);
    }
}

/// FFmpeg encoding loop
#[cfg(feature = "ffmpeg")]
fn encode_loop_ffmpeg(
    running: Arc<Mutex<bool>>,
    frames_encoded: Arc<Mutex<u64>>,
    video_receiver: Option<Receiver<CompositeFrame>>,
    audio_receiver: Option<Receiver<MixedAudioChunk>>,
    config: EncoderConfig,
) -> Result<(), String> {
    use ffmpeg_next as ffmpeg;
    use ffmpeg_next::software::scaling::{context::Context, flag::Flags};
    
    // Initialize FFmpeg
    ffmpeg::init().map_err(|e| format!("FFmpeg init failed: {}", e))?;
    
    // Create output context
    let mut output = ffmpeg::format::output(&config.output_path)
        .map_err(|e| format!("Failed to create output: {}", e))?;
    
    // Find H.264 encoder
    let video_codec = ffmpeg::encoder::find(ffmpeg::codec::Id::H264)
        .ok_or("H.264 encoder not found")?;
    
    // Find AAC encoder
    let audio_codec = ffmpeg::encoder::find(ffmpeg::codec::Id::AAC)
        .ok_or("AAC encoder not found")?;
    
    let global_header = output
        .format()
        .flags()
        .contains(ffmpeg::format::flag::Flags::GLOBAL_HEADER);
    
    let (mut video_encoder, video_stream_index, video_time_base) = {
        let mut video_stream = output
            .add_stream(video_codec)
            .map_err(|e| format!("Failed to add video stream: {}", e))?;

        let mut video_encoder_context =
            ffmpeg::codec::context::Context::from_parameters(video_stream.parameters())
                .map_err(|e| format!("Failed to create video context: {}", e))?;

        video_encoder_context.set_time_base(ffmpeg::Rational(1, config.frame_rate as i32));

        if global_header {
            video_encoder_context.set_flags(ffmpeg::codec::flag::Flags::GLOBAL_HEADER);
        }

        let mut video_encoder = video_encoder_context
            .encoder()
            .video()
            .map_err(|e| format!("Failed to create video encoder: {}", e))?;

        video_encoder.set_width(config.width);
        video_encoder.set_height(config.height);
        video_encoder.set_format(ffmpeg::format::Pixel::YUV420P);
        video_encoder.set_frame_rate(Some(ffmpeg::Rational(config.frame_rate as i32, 1)));
        video_encoder.set_bit_rate(config.quality.video_bitrate() as usize * 1000);

        let mut video_options = ffmpeg::Dictionary::new();
        video_options.set("preset", "medium");
        video_options.set("crf", &config.quality.crf().to_string());

        let mut video_encoder = video_encoder
            .open_with(video_options)
            .map_err(|e| format!("Failed to open video encoder: {}", e))?;

        let index = video_stream.index();
        let time_base = video_stream.time_base();
        video_stream.set_parameters(&video_encoder);

        (video_encoder, index, time_base)
    };

    let (mut audio_encoder, audio_stream_index, audio_time_base) = {
        let mut audio_stream = output
            .add_stream(audio_codec)
            .map_err(|e| format!("Failed to add audio stream: {}", e))?;

        let mut audio_encoder = ffmpeg::codec::context::Context::from_parameters(
            audio_stream.parameters(),
        )
        .map_err(|e| format!("Failed to create audio context: {}", e))?
        .encoder()
        .audio()
        .map_err(|e| format!("Failed to create audio encoder: {}", e))?;

        audio_encoder.set_rate(config.audio_sample_rate as i32);
        let channel_layout = if config.audio_channels == 1 {
            ChannelLayout::MONO
        } else {
            ChannelLayout::STEREO
        };
        audio_encoder.set_channel_layout(channel_layout);
        audio_encoder
            .set_format(ffmpeg::format::Sample::F32(ffmpeg::format::sample::Type::Planar));
        audio_encoder.set_time_base(ffmpeg::Rational(1, config.audio_sample_rate as i32));
        audio_encoder.set_bit_rate(config.quality.audio_bitrate() as usize * 1000);

        let mut audio_encoder = audio_encoder
            .open()
            .map_err(|e| format!("Failed to open audio encoder: {}", e))?;

        let index = audio_stream.index();
        let time_base = audio_stream.time_base();
        audio_stream.set_parameters(&audio_encoder);

        (audio_encoder, index, time_base)
    };
    
    
    // Write header
    output.write_header()
        .map_err(|e| format!("Failed to write header: {}", e))?;
    
    println!("FFmpeg encoding started");
    
    let mut frame_count: i64 = 0;
    let mut audio_pts: i64 = 0;
    
    // Create video frame buffer for the encoded format
    let mut yuv_frame = ffmpeg::frame::Video::new(
        ffmpeg::format::Pixel::YUV420P,
        config.width,
        config.height,
    );
    
    // Create a scaler for converting from RGBA to YUV420P
    let mut scaler = Context::get(
        ffmpeg::format::Pixel::RGBA,
        config.width,
        config.height,
        ffmpeg::format::Pixel::YUV420P,
        config.width,
        config.height,
        Flags::BILINEAR,
    ).map_err(|e| format!("Failed to create scaler: {}", e))?;
    
    // Create audio frame buffer
    let samples_per_frame = audio_encoder.frame_size() as usize;
    let mut audio_frame = ffmpeg::frame::Audio::new(
        ffmpeg::format::Sample::F32(ffmpeg::format::sample::Type::Planar),
        samples_per_frame,
        ffmpeg::ChannelLayout::STEREO,
    );
    
    // Audio sample buffer
    let mut audio_buffer: Vec<f32> = Vec::new();
    
    while *running.lock() {
        // Process video frames
        if let Some(ref receiver) = video_receiver {
            while let Ok(composite_frame) = receiver.try_recv() {
                // Create a temporary frame from the incoming RGBA data
                let mut rgba_frame = ffmpeg::frame::Video::new(
                    ffmpeg::format::Pixel::RGBA,
                    config.width,
                    config.height,
                );
                fill_rgba_frame(&mut rgba_frame, config.width, config.height, &composite_frame.data);
                
                // Convert RGBA to YUV420P
                if let Err(e) = scaler.run(&rgba_frame, &mut yuv_frame) {
                    eprintln!("RGBA to YUV conversion error: {}", e);
                    continue;
                }
                
                yuv_frame.set_pts(Some(frame_count));
                
                // Encode video frame
                if let Err(e) = encode_video_frame(
                    &mut video_encoder,
                    &yuv_frame,
                    &mut output,
                    video_stream_index,
                    video_time_base,
                ) {
                    eprintln!("Video encode error: {}", e);
                }
                
                frame_count += 1;
                *frames_encoded.lock() = frame_count as u64;
            }
        }
        
        // Process audio chunks
        if let Some(ref receiver) = audio_receiver {
            while let Ok(audio_chunk) = receiver.try_recv() {
                audio_buffer.extend(&audio_chunk.samples);
                
                // Encode complete audio frames
                while audio_buffer.len() >= samples_per_frame * config.audio_channels as usize {
                    // Fill audio frame
                    let samples_to_take = samples_per_frame * config.audio_channels as usize;
                    let samples: Vec<f32> = audio_buffer.drain(0..samples_to_take).collect();
                    
                    // Convert interleaved to planar
                    if let Err(e) = fill_audio_frame(
                        &samples,
                        config.audio_channels,
                        &mut audio_frame,
                    ) {
                        eprintln!("Audio frame fill error: {}", e);
                        continue;
                    }
                    
                    audio_frame.set_pts(Some(audio_pts));
                    audio_pts += samples_per_frame as i64;
                    
                    // Encode audio frame
                    if let Err(e) = encode_audio_frame(
                        &mut audio_encoder,
                        &audio_frame,
                        &mut output,
                        audio_stream_index,
                        audio_time_base,
                    ) {
                        eprintln!("Audio encode error: {}", e);
                    }
                }
            }
        }
        
        std::thread::sleep(std::time::Duration::from_millis(1));
    }
    
    // Flush encoders
    println!("Flushing encoders...");
    
    // Flush video encoder
    let _ = flush_video_encoder(
        &mut video_encoder,
        &mut output,
        video_stream_index,
        video_time_base,
    );
    
    // Flush audio encoder
    let _ = flush_audio_encoder(
        &mut audio_encoder,
        &mut output,
        audio_stream_index,
        audio_time_base,
    );
    
    // Write trailer
    output.write_trailer()
        .map_err(|e| format!("Failed to write trailer: {}", e))?;
    
    println!("Encoding complete: {} frames", frame_count);
    
    Ok(())
}

/// Fill audio frame with interleaved samples converted to planar
#[cfg(feature = "ffmpeg")]
fn fill_audio_frame(
    interleaved: &[f32],
    channels: u16,
    frame: &mut ffmpeg_next::frame::Audio,
) -> Result<(), String> {
    let samples_per_channel = interleaved.len() / channels as usize;
    
    for ch in 0..channels as usize {
        let plane = frame.data_mut(ch);
        let plane_f32: &mut [f32] = unsafe {
            std::slice::from_raw_parts_mut(
                plane.as_mut_ptr() as *mut f32,
                samples_per_channel,
            )
        };
        
        for i in 0..samples_per_channel {
            plane_f32[i] = interleaved[i * channels as usize + ch];
        }
    }
    
    frame.set_samples(samples_per_channel);
    
    Ok(())
}

/// Encode a video frame
#[cfg(feature = "ffmpeg")]
fn encode_video_frame(
    encoder: &mut ffmpeg_next::encoder::video::Video,
    frame: &ffmpeg_next::frame::Video,
    output: &mut ffmpeg_next::format::context::Output,
    stream_index: usize,
    time_base: ffmpeg_next::Rational,
) -> Result<(), String> {
    let mut packet = ffmpeg_next::Packet::empty();
    
    encoder.send_frame(frame)
        .map_err(|e| format!("Failed to send video frame: {}", e))?;
    
    while encoder.receive_packet(&mut packet).is_ok() {
        packet.set_stream(stream_index);
        packet.rescale_ts(encoder.time_base(), time_base);
        
        packet.write_interleaved(output)
            .map_err(|e| format!("Failed to write video packet: {}", e))?;
    }
    
    Ok(())
}

/// Encode an audio frame
#[cfg(feature = "ffmpeg")]
fn encode_audio_frame(
    encoder: &mut ffmpeg_next::encoder::audio::Audio,
    frame: &ffmpeg_next::frame::Audio,
    output: &mut ffmpeg_next::format::context::Output,
    stream_index: usize,
    time_base: ffmpeg_next::Rational,
) -> Result<(), String> {
    let mut packet = ffmpeg_next::Packet::empty();
    
    encoder.send_frame(frame)
        .map_err(|e| format!("Failed to send audio frame: {}", e))?;
    
    while encoder.receive_packet(&mut packet).is_ok() {
        packet.set_stream(stream_index);
        packet.rescale_ts(encoder.time_base(), time_base);
        
        packet.write_interleaved(output)
            .map_err(|e| format!("Failed to write audio packet: {}", e))?;
    }
    
    Ok(())
}

/// Flush remaining packets from encoder
#[cfg(feature = "ffmpeg")]
fn flush_video_encoder(
    encoder: &mut ffmpeg_next::encoder::video::Video,
    output: &mut ffmpeg_next::format::context::Output,
    stream_index: usize,
    time_base: ffmpeg_next::Rational,
) -> Result<(), String> {
    let mut packet = ffmpeg_next::Packet::empty();
    
    encoder.send_eof()
        .map_err(|e| format!("Failed to send EOF: {}", e))?;
    
    while encoder.receive_packet(&mut packet).is_ok() {
        packet.set_stream(stream_index);
        packet.rescale_ts(encoder.time_base(), time_base);
        
        let _ = packet.write_interleaved(output);
    }
    
    Ok(())
}

#[cfg(feature = "ffmpeg")]
fn flush_audio_encoder(
    encoder: &mut ffmpeg_next::encoder::audio::Audio,
    output: &mut ffmpeg_next::format::context::Output,
    stream_index: usize,
    time_base: ffmpeg_next::Rational,
) -> Result<(), String> {
    let mut packet = ffmpeg_next::Packet::empty();

    encoder
        .send_eof()
        .map_err(|e| format!("Failed to send EOF: {}", e))?;

    while encoder.receive_packet(&mut packet).is_ok() {
        packet.set_stream(stream_index);
        packet.rescale_ts(encoder.time_base(), time_base);

        let _ = packet.write_interleaved(output);
    }

    Ok(())
}

#[cfg(feature = "ffmpeg")]
fn fill_rgba_frame(
    frame: &mut ffmpeg_next::frame::Video,
    width: u32,
    height: u32,
    data: &[u8],
) {
    let stride = frame.stride(0) as usize;
    let row_bytes = (width * 4) as usize;
    let frame_data = frame.data_mut(0);

    for y in 0..height as usize {
        let src_start = y * row_bytes;
        let dst_start = y * stride;
        let src = &data[src_start..src_start + row_bytes];
        let dst = &mut frame_data[dst_start..dst_start + row_bytes];
        dst.copy_from_slice(src);
    }
}

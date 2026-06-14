// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use std::sync::Arc;
use parking_lot::Mutex;

mod audio;
mod screen;
mod webcam;
mod compositor;
mod system_audio;
mod audio_mixer;
mod encoder;
mod manager;
mod recording;
mod external_recorder;
mod screen_stream;
mod system_audio_stream;

pub use recording::{RecordingConfig, RecordingState, RecordingStatus, DeviceList, ExternalRecordingConfig};
use external_recorder::ExternalRecorder;
use screen_stream::ScreenStreamState;
use system_audio_stream::SystemAudioStreamState;

/// Global state for external frame recorder
pub struct ExternalRecorderState {
    pub recorder: Mutex<ExternalRecorder>,
}

impl Default for ExternalRecorderState {
    fn default() -> Self {
        Self {
            recorder: Mutex::new(ExternalRecorder::new()),
        }
    }
}

/// Tauri command: Start external frame recording
#[tauri::command]
async fn start_external_recording(
    config: ExternalRecordingConfig,
    state: tauri::State<'_, Arc<ExternalRecorderState>>,
) -> Result<(), String> {
    let mut recorder = state.recorder.lock();
    recorder.start(config)
}

/// Tauri command: Receive a video frame from the frontend
#[tauri::command]
fn receive_video_frame(
    data: Vec<u8>,
    width: u32,
    height: u32,
    timestamp_ms: u64,
    state: tauri::State<'_, Arc<ExternalRecorderState>>,
) -> Result<(), String> {
    let mut recorder = state.recorder.lock();
    recorder.receive_frame(data, width, height, timestamp_ms)
}

/// Tauri command: Receive a video frame from the frontend (base64 encoded)
/// This is faster than JSON array serialization for large binary data
#[tauri::command]
fn receive_video_frame_base64(
    data_base64: String,
    width: u32,
    height: u32,
    timestamp_ms: u64,
    state: tauri::State<'_, Arc<ExternalRecorderState>>,
) -> Result<(), String> {
    use base64::{Engine as _, engine::general_purpose::STANDARD};

    // Decode base64 to bytes
    let data = STANDARD.decode(&data_base64)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;

    let mut recorder = state.recorder.lock();
    recorder.receive_frame(data, width, height, timestamp_ms)
}

/// Tauri command: Save media recording from frontend (WebM or MP4)
/// Frontend handles encoding and muxing, backend just saves the file
#[tauri::command]
fn save_media_recording(request: tauri::ipc::Request<'_>) -> Result<String, String> {
    use std::path::PathBuf;

    // Video bytes arrive as the raw IPC request body (not base64), so large
    // recordings don't hit the JS string-length limit on the way to Rust.
    let tauri::ipc::InvokeBody::Raw(video_bytes) = request.body() else {
        return Err("save_media_recording expects a raw byte body".to_string());
    };

    // Determine the extension from the container's magic bytes (more reliable
    // than a passed mime type): WebM/Matroska starts with the EBML header, MP4
    // has "ftyp" at byte offset 4.
    let extension = if video_bytes.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]) {
        "webm"
    } else if video_bytes.get(4..8) == Some(&b"ftyp"[..]) {
        "mp4"
    } else {
        "webm" // Default to webm
    };

    // Generate output path
    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let filename = format!("recording_{}.{}", timestamp, extension);

    // In debug/dev mode, save to test-results directory
    #[cfg(debug_assertions)]
    let output_path = {
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let test_results_dir = PathBuf::from(manifest_dir).join("../test-results");

        // Create directory if it doesn't exist
        std::fs::create_dir_all(&test_results_dir)
            .map_err(|e| format!("Failed to create test-results directory: {}", e))?;

        test_results_dir.join(&filename)
    };

    // In release mode, save to user's videos directory
    #[cfg(not(debug_assertions))]
    let output_path = {
        let videos_dir = dirs::video_dir()
            .ok_or("Could not find videos directory")?;
        videos_dir.join(&filename)
    };

    // Write video file
    std::fs::write(&output_path, video_bytes)
        .map_err(|e| format!("Failed to write video file: {}", e))?;

    let path_str = output_path.to_string_lossy().to_string();
    println!(
        "[Backend-MediaRecorder] Saved {}: {} ({} bytes)",
        extension.to_uppercase(),
        path_str,
        video_bytes.len()
    );

    Ok(path_str)
}

/// Tauri command: Stop external frame recording
#[tauri::command]
async fn stop_external_recording(
    state: tauri::State<'_, Arc<ExternalRecorderState>>,
) -> Result<String, String> {
    let mut recorder = state.recorder.lock();
    recorder.stop()
}

/// Tauri command: Get external recording status
#[tauri::command]
fn get_external_recording_status(
    state: tauri::State<'_, Arc<ExternalRecorderState>>,
) -> RecordingStatus {
    let mut recorder = state.recorder.lock();
    recorder.status()
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize recording state
    let recording_state = Arc::new(RecordingState::default());
    
    // Initialize external recorder state
    let external_recorder_state = Arc::new(ExternalRecorderState::default());

    // Initialize native screen-stream state
    let screen_stream_state = Arc::new(ScreenStreamState::default());

    // Initialize native system-audio stream state
    let system_audio_stream_state = Arc::new(SystemAudioStreamState::default());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(recording_state)
        .manage(external_recorder_state)
        .manage(screen_stream_state)
        .manage(system_audio_stream_state)
        .invoke_handler(tauri::generate_handler![
            greet,
            // Legacy commands (will be deprecated)
            audio::start_audio_capture,
            screen::start_screen_capture,
            screen::check_screen_recording_permission,
            screen::list_displays,
            // New unified recording commands
            recording::get_available_devices,
            recording::get_recording_status,
            recording::get_recording_status_live,
            recording::start_recording,
            recording::stop_recording,
            // External frame recording commands
            start_external_recording,
            receive_video_frame,
            receive_video_frame_base64,
            stop_external_recording,
            get_external_recording_status,
            // MediaRecorder recording
            save_media_recording,
            // Native screen capture streaming (WKWebView lacks getDisplayMedia)
            screen_stream::start_screen_stream,
            screen_stream::stop_screen_stream,
            screen_stream::ack_screen_frame,
            // Native system-audio capture streaming (WKWebView lacks getDisplayMedia)
            system_audio_stream::start_system_audio_stream,
            system_audio_stream::stop_system_audio_stream,
            system_audio_stream::ack_system_audio_chunk,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

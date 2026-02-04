// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use std::sync::Arc;
use parking_lot::Mutex;

mod audio;
mod screen;
mod screen_capture;
mod webcam;
mod compositor;
mod system_audio;
mod audio_mixer;
mod encoder;
mod manager;
mod recording;
mod external_recorder;

pub use recording::{RecordingConfig, RecordingState, RecordingStatus, DeviceList, ExternalRecordingConfig};
use external_recorder::ExternalRecorder;

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
    
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(recording_state)
        .manage(external_recorder_state)
        .invoke_handler(tauri::generate_handler![
            greet,
            // Legacy commands (will be deprecated)
            audio::start_audio_capture,
            screen::start_screen_capture,
            screen::check_screen_recording_permission,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

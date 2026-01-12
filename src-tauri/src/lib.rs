// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use std::sync::Arc;

mod audio;
mod screen;
mod webcam;
mod compositor;
mod system_audio;
mod audio_mixer;
mod encoder;
mod manager;
mod recording;

pub use recording::{RecordingConfig, RecordingState, RecordingStatus, DeviceList};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize recording state
    let recording_state = Arc::new(RecordingState::default());
    
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(recording_state)
        .invoke_handler(tauri::generate_handler![
            greet,
            // Legacy commands (will be deprecated)
            audio::start_audio_capture,
            screen::start_screen_capture,
            // New unified recording commands
            recording::get_available_devices,
            recording::get_recording_status,
            recording::get_recording_status_live,
            recording::start_recording,
            recording::stop_recording,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

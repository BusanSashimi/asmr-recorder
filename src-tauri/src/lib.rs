use std::sync::Arc;
use tauri::Manager;

mod screen;
mod system_audio;
mod recording;
mod screen_stream;
mod system_audio_stream;
mod build_sounds;

use screen_stream::ScreenStreamState;
use system_audio_stream::SystemAudioStreamState;
use build_sounds::BuildSoundsState;

/// Tauri command: Save media recording from frontend (WebM or MP4)
/// Frontend handles encoding and muxing, backend just saves the file
#[tauri::command]
fn save_media_recording(request: tauri::ipc::Request<'_>) -> Result<String, String> {
    #[cfg(debug_assertions)]
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let screen_stream_state = Arc::new(ScreenStreamState::default());
    let system_audio_stream_state = Arc::new(SystemAudioStreamState::default());

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            let build_sounds = BuildSoundsState::load(app.handle())?;
            build_sounds::start_bridge(app.handle().clone(), build_sounds.clone());
            app.manage(build_sounds);
            Ok(())
        })
        .manage(screen_stream_state)
        .manage(system_audio_stream_state)
        .invoke_handler(tauri::generate_handler![
            screen::list_displays,
            recording::get_available_devices,
            recording::list_audio_apps,
            save_media_recording,
            screen_stream::start_screen_stream,
            screen_stream::stop_screen_stream,
            screen_stream::ack_screen_frame,
            system_audio_stream::start_system_audio_stream,
            system_audio_stream::stop_system_audio_stream,
            system_audio_stream::ack_system_audio_chunk,
            build_sounds::get_build_sound_state,
            build_sounds::update_build_sound_settings,
            build_sounds::import_soundbite,
            build_sounds::read_soundbite,
            build_sounds::set_soundbite_availability,
            build_sounds::delete_soundbite,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            app_handle
                .state::<Arc<BuildSoundsState>>()
                .clean_discovery();
        }
    });
}

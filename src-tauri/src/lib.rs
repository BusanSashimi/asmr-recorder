use std::sync::Arc;
use tauri::{Emitter, Manager};

mod editor;
mod editor_playback;

mod recording;
mod screen;
mod screen_stream;
mod system_audio;
mod system_audio_stream;

use screen_stream::ScreenStreamState;
use system_audio_stream::SystemAudioStreamState;

/// Tauri command: Save media recording from frontend (WebM or MP4)
/// Frontend handles encoding and muxing, backend just saves the file
#[tauri::command(async)]
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
    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S_%f");
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
        let videos_dir = dirs::video_dir().ok_or("Could not find videos directory")?;
        videos_dir.join(&filename)
    };

    use std::io::Write;
    let temporary = output_path.with_extension(format!("{}.partial", extension));
    let result = (|| -> std::io::Result<()> {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(video_bytes)?;
        file.sync_all()?;
        std::fs::rename(&temporary, &output_path)?;
        Ok(())
    })();
    if let Err(e) = result {
        let _ = std::fs::remove_file(&temporary);
        return Err(format!("Failed to save video file: {}", e));
    }

    #[cfg(debug_assertions)]
    if let Some(timing) = request
        .headers()
        .get("x-recording-timing")
        .and_then(|v| v.to_str().ok())
    {
        let _ = std::fs::write(output_path.with_extension("timing.json"), timing);
    }
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

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let editor = editor::Editor::start(app.path().app_data_dir()?.join("editor"))
                .map_err(std::io::Error::other)?;
            app.manage(editor);
            #[cfg(target_os = "macos")]
            {
                // AppKit's predefined Quit calls terminate: directly, bypassing
                // Tauri ExitRequested. Route Cmd-Q through the document guard.
                use tauri::menu::{Menu, MenuItem, MenuItemKind};
                let menu = Menu::default(app.handle())?;
                if let Some(MenuItemKind::Submenu(app_menu)) = menu.items()?.first() {
                    let count = app_menu.items()?.len();
                    app_menu.remove_at(count - 1)?;
                    app_menu.append(&MenuItem::with_id(
                        app,
                        "editor-quit",
                        "Quit ASMR Recorder",
                        true,
                        Some("CmdOrCtrl+Q"),
                    )?)?;
                }
                app.set_menu(menu)?;
                app.on_menu_event(|app, event| {
                    if event.id().as_ref() == "editor-quit" {
                        let _ = app.emit("editor-close-requested", ());
                    }
                });
            }
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            Ok(())
        })
        .manage(screen_stream_state)
        .manage(system_audio_stream_state)
        .invoke_handler(tauri::generate_handler![
            editor::editor_snapshot,
            editor::editor_execute,
            editor::editor_effects,
            editor::editor_import_take,
            editor::editor_frame,
            editor::editor_waveform,
            editor::editor_transport,
            editor::editor_shutdown,
            editor::editor_query,
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
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                if (code.is_none() || code == Some(0))
                    && !app
                        .state::<editor::Editor>()
                        .closing
                        .load(std::sync::atomic::Ordering::SeqCst)
                {
                    api.prevent_exit();
                    let _ = app.emit("editor-close-requested", ());
                }
            }
        });
}

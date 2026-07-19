use std::sync::Arc;
use tauri::Manager;

mod build_sounds;
mod recording;
mod recording_files;
mod screen;
mod screen_stream;
mod system_audio;
mod system_audio_stream;

use build_sounds::BuildSoundsState;
use recording_files::RecordingFileStore;
use screen_stream::ScreenStreamState;
use system_audio_stream::SystemAudioStreamState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let screen_stream_state = Arc::new(ScreenStreamState::default());
    let system_audio_stream_state = Arc::new(SystemAudioStreamState::default());
    let recording_file_store =
        RecordingFileStore::load().expect("could not initialize recording file store");

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
        .manage(recording_file_store)
        .invoke_handler(tauri::generate_handler![
            screen::list_displays,
            recording::get_available_devices,
            recording::list_audio_apps,
            recording_files::begin_recording_file,
            recording_files::write_recording_file,
            recording_files::finalize_recording_file,
            recording_files::abort_recording_file,
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
            app_handle.state::<Arc<RecordingFileStore>>().abort_all();
        }
    });
}

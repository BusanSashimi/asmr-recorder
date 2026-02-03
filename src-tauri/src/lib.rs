// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use std::sync::Arc;
use serde::Serialize;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

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

pub use recording::{RecordingConfig, RecordingState, RecordingStatus, DeviceList};

/// Information about a connected monitor
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    /// Unique identifier for the monitor
    pub id: String,
    /// Human-readable name of the monitor
    pub name: String,
    /// X position of the monitor (physical position)
    pub x: i32,
    /// Y position of the monitor (physical position)
    pub y: i32,
    /// Width in pixels
    pub width: u32,
    /// Height in pixels
    pub height: u32,
    /// Scale factor (for HiDPI displays)
    pub scale_factor: f64,
    /// Whether this is the primary monitor
    pub is_primary: bool,
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Get information about all connected monitors
#[tauri::command]
fn get_monitors(app: tauri::AppHandle) -> Vec<MonitorInfo> {
    let mut monitors = Vec::new();
    
    if let Some(primary) = app.primary_monitor().ok().flatten() {
        let position = primary.position();
        let size = primary.size();
        let name = primary.name().cloned().unwrap_or_else(|| "Primary Display".to_string());
        monitors.push(MonitorInfo {
            id: "primary".to_string(),
            name,
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
            scale_factor: primary.scale_factor(),
            is_primary: true,
        });
    }
    
    if let Ok(available) = app.available_monitors() {
        for (index, monitor) in available.into_iter().enumerate() {
            let position = monitor.position();
            let size = monitor.size();
            let name = monitor.name().cloned().unwrap_or_else(|| format!("Display {}", index + 1));
            let id = format!("monitor_{}", index);
            
            // Skip if this is the primary monitor (already added)
            let is_duplicate = monitors.iter().any(|m| 
                m.x == position.x && 
                m.y == position.y && 
                m.width == size.width && 
                m.height == size.height
            );
            
            if !is_duplicate {
                monitors.push(MonitorInfo {
                    id,
                    name,
                    x: position.x,
                    y: position.y,
                    width: size.width,
                    height: size.height,
                    scale_factor: monitor.scale_factor(),
                    is_primary: false,
                });
            }
        }
    }
    
    // If no monitors found, return a default
    if monitors.is_empty() {
        monitors.push(MonitorInfo {
            id: "default".to_string(),
            name: "Default Display".to_string(),
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
            scale_factor: 1.0,
            is_primary: true,
        });
    }
    
    monitors
}

/// Open the region selector overlay window on a specific monitor
#[tauri::command]
async fn open_region_selector(
    app: tauri::AppHandle,
    monitor_x: i32,
    monitor_y: i32,
    monitor_width: u32,
    monitor_height: u32,
    scale_factor: f64,
) -> Result<(), String> {
    // Close existing region selector if any
    if let Some(existing) = app.get_webview_window("region-selector") {
        let _ = existing.close();
    }
    
    // Create the overlay window
    let url = WebviewUrl::App("index.html?window=region-selector".into());
    
    let window = WebviewWindowBuilder::new(&app, "region-selector", url)
        .title("Select Region")
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .position(monitor_x as f64, monitor_y as f64)
        .inner_size(
            monitor_width as f64 / scale_factor,
            monitor_height as f64 / scale_factor,
        )
        .build()
        .map_err(|e| format!("Failed to create region selector window: {}", e))?;
    
    // Make sure the window is focused
    window.set_focus().map_err(|e| format!("Failed to focus window: {}", e))?;
    
    println!(
        "Region selector opened at ({}, {}) with size {}x{} (scale: {})",
        monitor_x, monitor_y, monitor_width, monitor_height, scale_factor
    );
    
    Ok(())
}

/// Close the region selector overlay window
#[tauri::command]
async fn close_region_selector(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("region-selector") {
        window.close().map_err(|e| format!("Failed to close window: {}", e))?;
        println!("Region selector closed");
    }
    Ok(())
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
            screen::check_screen_recording_permission,
            // New unified recording commands
            recording::get_available_devices,
            recording::get_recording_status,
            recording::get_recording_status_live,
            recording::start_recording,
            recording::stop_recording,
            // Monitor and region selector commands
            get_monitors,
            open_region_selector,
            close_region_selector,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

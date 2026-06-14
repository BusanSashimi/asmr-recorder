use serde::{Deserialize, Serialize};
use tauri::command;

use crate::system_audio::is_system_audio_available;

/// A running application visible to ScreenCaptureKit.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioApp {
    pub bundle_id: String,
    pub name: String,
    pub pid: i32,
}

/// Return every running app that SCK can enumerate, sorted by name and deduped
/// by bundle ID. Used to populate the per-app system-audio picker. Returns an
/// empty list on non-macOS platforms.
#[command]
pub fn list_audio_apps() -> Result<Vec<AudioApp>, String> {
    #[cfg(target_os = "macos")]
    {
        use screencapturekit::prelude::SCShareableContent;
        let content = SCShareableContent::get()
            .map_err(|e| format!("SCShareableContent::get failed: {}", e))?;
        let mut apps: Vec<AudioApp> = content
            .applications()
            .iter()
            .filter(|a| !a.application_name().is_empty())
            .map(|a| AudioApp {
                bundle_id: a.bundle_identifier(),
                name: a.application_name(),
                pid: a.process_id(),
            })
            .collect();
        apps.sort_by(|a, b| a.bundle_id.cmp(&b.bundle_id));
        apps.dedup_by_key(|a| a.bundle_id.clone());
        apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        return Ok(apps);
    }
    #[cfg(not(target_os = "macos"))]
    Ok(vec![])
}

/// Information about available capture devices
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
}

/// List of available capture devices
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DeviceList {
    pub screens: Vec<DeviceInfo>,
    pub webcams: Vec<DeviceInfo>,
    pub microphones: Vec<DeviceInfo>,
    pub has_system_audio: bool,
}

/// Tauri command: Get list of available capture devices
#[command]
pub fn get_available_devices() -> Result<DeviceList, String> {
    let mut device_list = DeviceList::default();

    #[cfg(target_os = "macos")]
    {
        if let Ok(content) = screencapturekit::prelude::SCShareableContent::get() {
            for (i, display) in content.displays().iter().enumerate() {
                device_list.screens.push(DeviceInfo {
                    id: format!("screen_{}", display.display_id()),
                    name: if i == 0 {
                        "Primary Display".to_string()
                    } else {
                        format!("Display {}", i + 1)
                    },
                });
            }
        }
    }

    device_list.has_system_audio = is_system_audio_available();

    Ok(device_list)
}

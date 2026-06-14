use serde::{Deserialize, Serialize};
use tauri::command;

use crate::system_audio::is_system_audio_available;

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

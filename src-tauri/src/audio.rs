use tauri::command;
use cpal::traits::{DeviceTrait, HostTrait};

#[command]
pub fn start_audio_capture() {
    println!("Starting audio capture...");
    let host = cpal::default_host();
    match host.default_input_device() {
        Some(device) => {
            println!("Default input device: {}", device.name().unwrap_or("unknown".to_string()));
            // In a real app, we would configure the stream here.
            println!("Audio capture initialized (mock).");
        }
        None => println!("No input device available."),
    }
}

use std::time::Duration;
use tauri::command;

/// A sub-region of a display to capture (in display pixels).
#[derive(Clone, Debug, serde::Deserialize)]
pub struct CaptureRegion {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

/// Represents a captured screen frame
#[derive(Clone)]
pub struct ScreenFrame {
    /// Raw BGRA pixel data (may include row padding)
    pub data: Vec<u8>,
    /// Frame width in pixels
    pub width: u32,
    /// Frame height in pixels
    pub height: u32,
    /// Actual bytes per row (may be larger than width * 4 due to alignment)
    pub stride: usize,
    /// Timestamp when frame was captured
    pub timestamp: Duration,
}

impl ScreenFrame {
    /// Convert platform-specific pixel data (BGRA or ARGB) to RGBA format
    ///
    /// This method properly handles row stride/padding by iterating row-by-row
    /// rather than assuming tightly-packed pixel data.
    pub fn to_rgba(&self) -> Vec<u8> {
        let output_size = (self.width * self.height * 4) as usize;
        let mut rgba = Vec::with_capacity(output_size);

        for y in 0..self.height as usize {
            let row_start = y * self.stride;
            for x in 0..self.width as usize {
                let offset = row_start + x * 4;

                #[cfg(target_os = "macos")]
                {
                    // macOS ScreenCaptureKit uses BGRA format
                    rgba.push(self.data[offset + 2]); // R
                    rgba.push(self.data[offset + 1]); // G
                    rgba.push(self.data[offset]);     // B
                    rgba.push(self.data[offset + 3]); // A
                }

                #[cfg(not(target_os = "macos"))]
                {
                    // Windows/Linux use BGRA format
                    rgba.push(self.data[offset + 2]); // R
                    rgba.push(self.data[offset + 1]); // G
                    rgba.push(self.data[offset]);     // B
                    rgba.push(self.data[offset + 3]); // A
                }
            }
        }

        rgba
    }

}

/// Screen capture configuration
pub struct ScreenCaptureConfig {
    /// Target frames per second
    pub fps: u32,
    /// Display index to capture (0 = primary)
    pub display_index: usize,
    /// Optional crop region in display pixels. None = full display.
    pub region: Option<CaptureRegion>,
}

impl Default for ScreenCaptureConfig {
    fn default() -> Self {
        Self {
            fps: 30,
            display_index: 0,
            region: None,
        }
    }
}

/// Display information returned by list_displays.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayInfo {
    pub index: usize,
    pub display_id: u32,
    pub width: u32,
    pub height: u32,
    pub is_primary: bool,
}

#[cfg(target_os = "macos")]
#[path = "screen_macos.rs"]
mod screen_macos;
#[cfg(target_os = "macos")]
pub use screen_macos::ScreenCapture;

#[cfg(target_os = "windows")]
#[path = "screen_windows.rs"]
mod screen_windows;
#[cfg(target_os = "windows")]
pub use screen_windows::ScreenCapture;

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
#[path = "screen_fallback.rs"]
mod screen_fallback;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub use screen_fallback::ScreenCapture;

/// Enumerate available displays.
///
/// macOS: returns all displays via SCShareableContent. Other platforms return a
/// single synthetic entry for the primary display.
#[command]
pub fn list_displays() -> Result<Vec<DisplayInfo>, String> {
    #[cfg(target_os = "macos")]
    {
        match screencapturekit::prelude::SCShareableContent::get() {
            Ok(content) => {
                let infos = content
                    .displays()
                    .iter()
                    .enumerate()
                    .map(|(index, display)| {
                        let frame = display.frame();
                        DisplayInfo {
                            index,
                            display_id: display.display_id(),
                            width: display.width(),
                            height: display.height(),
                            is_primary: frame.x == 0.0 && frame.y == 0.0,
                        }
                    })
                    .collect();
                Ok(infos)
            }
            Err(e) => Err(format!("Failed to access displays: {}", e)),
        }
    }

    #[cfg(target_os = "windows")]
    {
        match windows_capture::monitor::Monitor::primary() {
            Ok(m) => Ok(vec![DisplayInfo {
                index: 0,
                display_id: 0,
                width: m.width().unwrap_or(1920),
                height: m.height().unwrap_or(1080),
                is_primary: true,
            }]),
            Err(e) => Err(format!("Failed to access displays: {}", e)),
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        match scrap::Display::primary() {
            Ok(d) => Ok(vec![DisplayInfo {
                index: 0,
                display_id: 0,
                width: d.width() as u32,
                height: d.height() as u32,
                is_primary: true,
            }]),
            Err(e) => Err(format!("Failed to access displays: {}", e)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_screen_frame_conversion() {
        // Test with tightly-packed data (stride = width * 4)
        let frame = ScreenFrame {
            data: vec![255, 128, 64, 255], // One BGRA pixel (on non-macOS) or ARGB (on macOS)
            width: 1,
            height: 1,
            stride: 4, // 1 pixel * 4 bytes per pixel
            timestamp: Duration::from_secs(0),
        };
        
        let rgba = frame.to_rgba();
        // Both macOS and other platforms use BGRA format now
        // Input BGRA [255, 128, 64, 255] -> Output RGBA [64, 128, 255, 255]
        assert_eq!(rgba, vec![64, 128, 255, 255]); // BGRA -> RGBA
    }
    
    #[test]
    fn test_screen_frame_with_stride_padding() {
        // Test with padded data (stride > width * 4)
        // Simulates 2x2 frame with 16-byte stride (4 bytes padding per row)
        #[cfg(not(target_os = "macos"))]
        let frame = ScreenFrame {
            // Row 0: 2 BGRA pixels + 8 bytes padding
            // Row 1: 2 BGRA pixels + 8 bytes padding
            data: vec![
                // Row 0
                0, 255, 0, 255,     // Pixel (0,0): BGRA = green
                255, 0, 0, 255,     // Pixel (1,0): BGRA = blue
                0, 0, 0, 0, 0, 0, 0, 0, // 8 bytes padding
                // Row 1
                0, 0, 255, 255,     // Pixel (0,1): BGRA = red
                255, 255, 255, 255, // Pixel (1,1): BGRA = white
                0, 0, 0, 0, 0, 0, 0, 0, // 8 bytes padding
            ],
            width: 2,
            height: 2,
            stride: 16, // 2 pixels * 4 bytes + 8 bytes padding = 16 bytes
            timestamp: Duration::from_secs(0),
        };
        
        #[cfg(not(target_os = "macos"))]
        {
            let rgba = frame.to_rgba();
            assert_eq!(rgba.len(), 16); // 2x2 * 4 bytes = 16 bytes (no padding in output)
            // Check first pixel: green (BGRA 0,255,0,255 -> RGBA 0,255,0,255)
            assert_eq!(&rgba[0..4], &[0, 255, 0, 255]);
            // Check second pixel: blue (BGRA 255,0,0,255 -> RGBA 0,0,255,255)
            assert_eq!(&rgba[4..8], &[0, 0, 255, 255]);
        }
    }
}

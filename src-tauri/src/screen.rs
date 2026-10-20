use std::time::Duration;
use tauri::command;

/// Display-local capture coordinates: logical points on macOS, pixels elsewhere.
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
                    rgba.push(self.data[offset]); // B
                    rgba.push(self.data[offset + 3]); // A
                }

                #[cfg(not(target_os = "macos"))]
                {
                    // Windows/Linux use BGRA format
                    rgba.push(self.data[offset + 2]); // R
                    rgba.push(self.data[offset + 1]); // G
                    rgba.push(self.data[offset]); // B
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
    /// Stable macOS display ID. When present, never fall back to an array index.
    pub display_id: Option<u32>,
    pub expected_geometry: Option<DisplayGeometry>,
    /// Optional crop in display-local coordinates. None = full display.
    pub region: Option<CaptureRegion>,
    /// Requested output pixels; macOS scales before copying a native buffer.
    pub target_size: Option<CaptureSize>,
}

impl Default for ScreenCaptureConfig {
    fn default() -> Self {
        Self {
            fps: 30,
            display_index: 0,
            display_id: None,
            expected_geometry: None,
            region: None,
            target_size: None,
        }
    }
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSize {
    pub width: u32,
    pub height: u32,
}

/// Crop stays in logical points; output is bounded by available backing pixels.
pub fn capture_geometry(
    width: u32,
    height: u32,
    backing_scale: f32,
    region: Option<&CaptureRegion>,
    target: Option<&CaptureSize>,
) -> Result<(CaptureRegion, CaptureSize), String> {
    if width == 0 || height == 0 || !backing_scale.is_finite() || backing_scale <= 0.0 {
        return Err("Invalid display geometry.".into());
    }
    let r = region.cloned().unwrap_or(CaptureRegion {
        x: 0,
        y: 0,
        width,
        height,
    });
    if r.x >= width || r.y >= height || r.width == 0 || r.height == 0 {
        return Err("The capture region is outside the selected display.".into());
    }
    let crop = CaptureRegion {
        width: r.width.min(width - r.x),
        height: r.height.min(height - r.y),
        ..r
    };
    let scale = if let Some(target) = target {
        if target.width == 0 || target.height == 0 {
            return Err("Invalid capture output size.".into());
        }
        (target.width as f64 / crop.width as f64)
            .min(target.height as f64 / crop.height as f64)
            .min(backing_scale as f64)
    } else {
        1.0
    };
    let size = CaptureSize {
        width: (crop.width as f64 * scale).ceil().max(1.0) as u32,
        height: (crop.height as f64 * scale).ceil().max(1.0) as u32,
    };
    Ok((crop, size))
}

/// Display information returned by list_displays.
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayInfo {
    pub index: usize,
    pub display_id: u32,
    pub width: u32,
    pub height: u32,
    pub is_primary: bool,
    /// Backing pixels per logical point (1 outside macOS).
    pub point_pixel_scale: f32,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayGeometry {
    pub width: u32,
    pub height: u32,
    pub point_pixel_scale: f32,
}

impl DisplayInfo {
    pub fn matches_geometry(&self, expected: &DisplayGeometry) -> bool {
        self.width == expected.width
            && self.height == expected.height
            && (self.point_pixel_scale - expected.point_pixel_scale).abs() < 0.001
    }
}

#[cfg(target_os = "macos")]
pub fn describe_display(
    display: &screencapturekit::shareable_content::SCDisplay,
    index: usize,
) -> DisplayInfo {
    use screencapturekit::stream::content_filter::SCContentFilter;
    let filter = SCContentFilter::create()
        .with_display(display)
        .with_excluding_windows(&[])
        .build();
    let frame = display.frame();
    DisplayInfo {
        index,
        display_id: display.display_id(),
        width: display.width(),
        height: display.height(),
        is_primary: frame.x == 0.0 && frame.y == 0.0,
        point_pixel_scale: filter.point_pixel_scale(),
    }
}

#[cfg(target_os = "macos")]
pub fn resolve_display<'a>(
    displays: &'a [screencapturekit::shareable_content::SCDisplay],
    config: &ScreenCaptureConfig,
) -> Result<&'a screencapturekit::shareable_content::SCDisplay, String> {
    let display = if let Some(id) = config.display_id {
        displays.iter().find(|d| d.display_id() == id)
    } else {
        displays.get(config.display_index)
    }
    .ok_or_else(|| {
        "The selected display is no longer connected. Choose a display again.".to_string()
    })?;
    if let Some(expected) = &config.expected_geometry {
        if !describe_display(display, 0).matches_geometry(expected) {
            return Err(
                "The selected display's dimensions or scale changed. Refresh and choose it again."
                    .into(),
            );
        }
    }
    Ok(display)
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
#[command(async)]
pub fn list_displays() -> Result<Vec<DisplayInfo>, String> {
    #[cfg(target_os = "macos")]
    {
        match screencapturekit::prelude::SCShareableContent::get() {
            Ok(content) => {
                let infos = content
                    .displays()
                    .iter()
                    .enumerate()
                    .map(|(index, display)| describe_display(display, index))
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
                point_pixel_scale: 1.0,
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
                point_pixel_scale: 1.0,
            }]),
            Err(e) => Err(format!("Failed to access displays: {}", e)),
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn native_output_uses_backing_pixels_without_changing_logical_crop() {
        use super::*;
        let crop = CaptureRegion {
            x: 100,
            y: 200,
            width: 800,
            height: 600,
        };
        let (r, size) = capture_geometry(
            2000,
            1200,
            2.0,
            Some(&crop),
            Some(&CaptureSize {
                width: 1600,
                height: 1200,
            }),
        )
        .unwrap();
        assert_eq!((r.x, r.y, r.width, r.height), (100, 200, 800, 600));
        assert_eq!((size.width, size.height), (1600, 1200));
        let (_, capped) = capture_geometry(
            2000,
            1200,
            1.0,
            Some(&crop),
            Some(&CaptureSize {
                width: 1600,
                height: 1200,
            }),
        )
        .unwrap();
        assert_eq!((capped.width, capped.height), (800, 600));
        let (_, small) = capture_geometry(
            2560,
            1440,
            1.0,
            None,
            Some(&CaptureSize {
                width: 1280,
                height: 720,
            }),
        )
        .unwrap();
        assert_eq!((small.width, small.height), (1280, 720));
    }
    #[test]
    fn crop_validation_and_rounding_share_one_geometry() {
        use super::*;
        let crop = CaptureRegion {
            x: 1900,
            y: 1100,
            width: 300,
            height: 300,
        };
        let (r, size) = capture_geometry(
            2000,
            1200,
            2.0,
            Some(&crop),
            Some(&CaptureSize {
                width: 101,
                height: 101,
            }),
        )
        .unwrap();
        assert_eq!(
            (r.width, r.height, size.width, size.height),
            (100, 100, 101, 101)
        );
        assert!(
            capture_geometry(
                2000,
                1200,
                1.0,
                Some(&CaptureRegion { x: 2000, ..crop }),
                None
            )
            .is_err()
        );
        assert!(
            capture_geometry(
                2000,
                1200,
                1.0,
                None,
                Some(&CaptureSize {
                    width: 0,
                    height: 10
                })
            )
            .is_err()
        );
    }
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
                0, 255, 0, 255, // Pixel (0,0): BGRA = green
                255, 0, 0, 255, // Pixel (1,0): BGRA = blue
                0, 0, 0, 0, 0, 0, 0, 0, // 8 bytes padding
                // Row 1
                0, 0, 255, 255, // Pixel (0,1): BGRA = red
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

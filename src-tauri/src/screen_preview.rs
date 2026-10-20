//! One-shot chooser images. Never participates in recording-section stream state.
use crate::screen::DisplayGeometry;
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewError {
    pub kind: &'static str,
    pub message: String,
}

impl PreviewError {
    pub fn new(kind: &'static str, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    pub fn capture(message: impl ToString) -> Self {
        let message = message.to_string();
        let lower = message.to_lowercase();
        let kind = if lower.contains("no longer connected") {
            "displayUnavailable"
        } else if lower.contains("dimensions or scale changed") {
            "geometryChanged"
        } else if lower.contains("permission")
            || lower.contains("declined")
            || lower.contains("tcc")
        {
            "permissionDenied"
        } else {
            "captureFailed"
        };
        Self::new(kind, message)
    }
}

#[cfg(target_os = "macos")]
pub fn capture_error(error: impl ToString) -> PreviewError {
    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGPreflightScreenCaptureAccess() -> bool;
    }
    if !unsafe { CGPreflightScreenCaptureAccess() } {
        PreviewError::new(
            "permissionDenied",
            "Allow ASMR Recorder in System Settings → Privacy & Security → Screen & System Audio Recording. macOS may require Quit & Reopen before access takes effect.",
        )
    } else {
        PreviewError::capture(error)
    }
}

/// Preserve aspect ratio and never upscale beyond backing dimensions.
fn preview_size(
    geometry: &DisplayGeometry,
    max_dimension: u32,
) -> Result<(u32, u32), PreviewError> {
    if geometry.width == 0
        || geometry.height == 0
        || !geometry.point_pixel_scale.is_finite()
        || geometry.point_pixel_scale <= 0.0
        || !(1..=1600).contains(&max_dimension)
    {
        return Err(PreviewError::new(
            "invalidInput",
            "Invalid display geometry or preview size.",
        ));
    }
    let w = geometry.width as f64 * geometry.point_pixel_scale as f64;
    let h = geometry.height as f64 * geometry.point_pixel_scale as f64;
    let scale = (max_dimension as f64 / w.max(h)).min(1.0);
    Ok((
        (w * scale).round().max(1.0) as u32,
        (h * scale).round().max(1.0) as u32,
    ))
}

#[tauri::command]
pub async fn capture_display_preview(
    display_id: u32,
    expected_geometry: DisplayGeometry,
    max_dimension: u32,
) -> Result<tauri::ipc::Response, PreviewError> {
    let (width, height) = preview_size(&expected_geometry, max_dimension)?;
    // The permit lives inside the blocking task, including if its caller closes.
    static SERIAL: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);
    let permit = SERIAL.acquire().await.map_err(PreviewError::capture)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        capture(display_id, expected_geometry, width, height).map(tauri::ipc::Response::new)
    })
    .await
    .map_err(PreviewError::capture)?
}

#[cfg(target_os = "macos")]
fn capture(
    id: u32,
    geometry: DisplayGeometry,
    width: u32,
    height: u32,
) -> Result<Vec<u8>, PreviewError> {
    use image::{ExtendedColorType, RgbaImage, codecs::jpeg::JpegEncoder};
    use screencapturekit::{prelude::*, screenshot_manager::SCScreenshotManager};
    let content = SCShareableContent::get().map_err(capture_error)?;
    let config = crate::screen::ScreenCaptureConfig {
        display_id: Some(id),
        expected_geometry: Some(geometry),
        ..Default::default()
    };
    let displays = content.displays();
    let display =
        crate::screen::resolve_display(&displays, &config).map_err(PreviewError::capture)?;
    let filter = SCContentFilter::create()
        .with_display(display)
        .with_excluding_windows(&[])
        .build();
    let configuration = SCStreamConfiguration::new()
        .with_width(width)
        .with_height(height)
        .with_scales_to_fit(true)
        .with_shows_cursor(false)
        .with_captures_audio(false);
    let image =
        SCScreenshotManager::capture_image(&filter, &configuration).map_err(capture_error)?;
    let rgba = RgbaImage::from_raw(
        image.width() as u32,
        image.height() as u32,
        image.rgba_data().map_err(PreviewError::capture)?,
    )
    .ok_or_else(|| PreviewError::new("captureFailed", "The display returned an invalid image."))?;
    let rgb = image::DynamicImage::ImageRgba8(rgba).into_rgb8();
    let mut bytes = Vec::new();
    JpegEncoder::new_with_quality(&mut bytes, 80)
        .encode(
            rgb.as_raw(),
            rgb.width(),
            rgb.height(),
            ExtendedColorType::Rgb8,
        )
        .map_err(PreviewError::capture)?;
    Ok(bytes)
}

#[cfg(not(target_os = "macos"))]
fn capture(_: u32, _: DisplayGeometry, _: u32, _: u32) -> Result<Vec<u8>, PreviewError> {
    Err(PreviewError::new(
        "unsupported",
        "Screen thumbnails are supported on macOS.",
    ))
}

/// Fixed destination; the frontend cannot pass an arbitrary command or URL.
#[tauri::command]
pub async fn open_screen_recording_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("/usr/bin/open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
            .status()
            .map_err(|e| e.to_string())?;
        if status.success() {
            Ok(())
        } else {
            Err("Could not open System Settings.".into())
        }
    }
    #[cfg(not(target_os = "macos"))]
    Err("This settings pane is only available on macOS.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn thumbnails_preserve_aspect_and_backing_scale() {
        let g = |width, height, point_pixel_scale| DisplayGeometry {
            width,
            height,
            point_pixel_scale,
        };
        assert_eq!(preview_size(&g(2560, 1440, 2.0), 480).unwrap(), (480, 270));
        assert_eq!(preview_size(&g(1080, 1920, 1.0), 480).unwrap(), (270, 480));
        assert_eq!(preview_size(&g(3440, 1440, 1.0), 480).unwrap(), (480, 201));
        assert_eq!(preview_size(&g(100, 50, 2.0), 480).unwrap(), (200, 100));
        assert!(preview_size(&g(0, 50, 1.0), 480).is_err());
        assert!(preview_size(&g(50, 50, f32::NAN), 480).is_err());
    }
}

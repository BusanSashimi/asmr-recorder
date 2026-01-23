use crate::recording::PipPosition;
use crate::screen::ScreenFrame;
use crate::webcam::WebcamFrame;
use image::{ImageBuffer, Rgba, RgbaImage};

/// A composited video frame ready for encoding
#[derive(Clone)]
pub struct CompositeFrame {
    /// Pixel data (RGBA or BGRA depending on is_bgra flag)
    pub data: Vec<u8>,
    /// Frame width
    pub width: u32,
    /// Frame height
    pub height: u32,
    /// Timestamp
    pub timestamp: std::time::Duration,
    /// If true, data is in BGRA format (fast path - no color conversion needed)
    /// If false, data is in RGBA format (webcam overlay was applied)
    pub is_bgra: bool,
}

/// Video compositor configuration
pub struct CompositorConfig {
    /// Output width
    pub output_width: u32,
    /// Output height
    pub output_height: u32,
    /// Whether to include webcam overlay
    pub include_webcam: bool,
    /// Webcam PiP position
    pub pip_position: PipPosition,
    /// Webcam size as percentage of output (10-50)
    pub pip_size_percent: u32,
    /// Padding from edges in pixels
    pub pip_padding: u32,
}

impl Default for CompositorConfig {
    fn default() -> Self {
        Self {
            output_width: 1920,
            output_height: 1080,
            include_webcam: false,
            pip_position: PipPosition::TopRight,
            pip_size_percent: 25,
            pip_padding: 20,
        }
    }
}

/// Video compositor that combines screen capture and webcam into a single frame
pub struct VideoCompositor {
    config: CompositorConfig,
    /// Cached PiP dimensions
    pip_width: u32,
    pip_height: u32,
    /// Cached PiP position
    pip_x: u32,
    pip_y: u32,
}

impl VideoCompositor {
    /// Create a new video compositor
    pub fn new(config: CompositorConfig) -> Self {
        // Calculate PiP dimensions based on percentage
        let pip_width = (config.output_width * config.pip_size_percent) / 100;
        let pip_height = (pip_width * 3) / 4; // Assume 4:3 aspect ratio for webcam
        
        // Calculate PiP position
        let (pip_x, pip_y) = Self::calculate_pip_position(
            config.output_width,
            config.output_height,
            pip_width,
            pip_height,
            config.pip_position,
            config.pip_padding,
        );
        
        Self {
            config,
            pip_width,
            pip_height,
            pip_x,
            pip_y,
        }
    }
    
    /// Calculate the top-left corner position for PiP overlay
    fn calculate_pip_position(
        output_width: u32,
        output_height: u32,
        pip_width: u32,
        pip_height: u32,
        position: PipPosition,
        padding: u32,
    ) -> (u32, u32) {
        match position {
            PipPosition::TopLeft => (padding, padding),
            PipPosition::TopRight => (output_width - pip_width - padding, padding),
            PipPosition::BottomLeft => (padding, output_height - pip_height - padding),
            PipPosition::BottomRight => (
                output_width - pip_width - padding,
                output_height - pip_height - padding,
            ),
        }
    }
    
    /// Composite a screen frame with optional webcam overlay
    pub fn composite(
        &self,
        screen_frame: &ScreenFrame,
        webcam_frame: Option<&WebcamFrame>,
    ) -> CompositeFrame {
        // Fast path: if no webcam overlay and dimensions match, skip BGRA→RGBA conversion
        // This is significantly faster because FFmpeg can handle BGRA→YUV directly
        if !self.config.include_webcam
            && screen_frame.width == self.config.output_width
            && screen_frame.height == self.config.output_height
        {
            return self.composite_fast_path(screen_frame);
        }

        // Slow path: need to use image processing for webcam overlay or scaling
        let mut output = self.prepare_base_frame(screen_frame);

        // Add webcam overlay if enabled and frame is available
        if self.config.include_webcam {
            if let Some(webcam) = webcam_frame {
                self.overlay_webcam(&mut output, webcam);
            }
        }

        CompositeFrame {
            data: output.into_raw(),
            width: self.config.output_width,
            height: self.config.output_height,
            timestamp: screen_frame.timestamp,
            is_bgra: false, // RGBA format after image processing
        }
    }

    /// Fast path compositing: directly pass BGRA data to encoder without conversion
    ///
    /// This bypasses the expensive BGRA→RGBA conversion when:
    /// - Webcam overlay is disabled
    /// - Screen dimensions match output dimensions (no scaling needed)
    fn composite_fast_path(&self, screen_frame: &ScreenFrame) -> CompositeFrame {
        CompositeFrame {
            data: screen_frame.to_packed_bgra(),
            width: screen_frame.width,
            height: screen_frame.height,
            timestamp: screen_frame.timestamp,
            is_bgra: true, // BGRA format - encoder will use BGRA→YUV conversion
        }
    }
    
    /// Prepare the base frame from screen capture
    /// 
    /// This scales the screen frame to output dimensions if necessary
    fn prepare_base_frame(&self, screen_frame: &ScreenFrame) -> RgbaImage {
        // Convert BGRA to RGBA
        let rgba_data = screen_frame.to_rgba();
        
        // Create image from raw data
        let screen_image: RgbaImage = ImageBuffer::from_raw(
            screen_frame.width,
            screen_frame.height,
            rgba_data,
        ).expect("Failed to create image from screen frame");
        
        // Scale to output dimensions if necessary
        if screen_frame.width != self.config.output_width 
            || screen_frame.height != self.config.output_height 
        {
            image::imageops::resize(
                &screen_image,
                self.config.output_width,
                self.config.output_height,
                image::imageops::FilterType::Triangle,
            )
        } else {
            screen_image
        }
    }
    
    /// Overlay webcam frame onto the output image
    fn overlay_webcam(&self, output: &mut RgbaImage, webcam_frame: &WebcamFrame) {
        // Convert webcam frame to RGBA and create image
        let rgba_data = webcam_frame.to_rgba();
        let webcam_image: RgbaImage = ImageBuffer::from_raw(
            webcam_frame.width,
            webcam_frame.height,
            rgba_data,
        ).expect("Failed to create image from webcam frame");
        
        // Scale webcam to PiP size
        let scaled_webcam = image::imageops::resize(
            &webcam_image,
            self.pip_width,
            self.pip_height,
            image::imageops::FilterType::Triangle,
        );
        
        // Draw border around PiP (optional visual enhancement)
        let border_width = 2u32;
        let border_color = Rgba([255, 255, 255, 200]);
        
        // Draw border
        for x in 0..self.pip_width + border_width * 2 {
            for y in 0..self.pip_height + border_width * 2 {
                let out_x = self.pip_x.saturating_sub(border_width) + x;
                let out_y = self.pip_y.saturating_sub(border_width) + y;
                
                if out_x < self.config.output_width && out_y < self.config.output_height {
                    let is_border = x < border_width 
                        || x >= self.pip_width + border_width
                        || y < border_width 
                        || y >= self.pip_height + border_width;
                    
                    if is_border {
                        output.put_pixel(out_x, out_y, border_color);
                    }
                }
            }
        }
        
        // Overlay the scaled webcam
        for (x, y, pixel) in scaled_webcam.enumerate_pixels() {
            let out_x = self.pip_x + x;
            let out_y = self.pip_y + y;
            
            if out_x < self.config.output_width && out_y < self.config.output_height {
                output.put_pixel(out_x, out_y, *pixel);
            }
        }
    }
    
    /// Create a composite frame from only a webcam frame (no screen)
    ///
    /// This is useful when only webcam recording is selected
    pub fn composite_webcam_only(&self, webcam_frame: &WebcamFrame) -> CompositeFrame {
        // Convert and scale webcam to fill output
        let rgba_data = webcam_frame.to_rgba();
        let webcam_image: RgbaImage = ImageBuffer::from_raw(
            webcam_frame.width,
            webcam_frame.height,
            rgba_data,
        )
        .expect("Failed to create image from webcam frame");

        let scaled = image::imageops::resize(
            &webcam_image,
            self.config.output_width,
            self.config.output_height,
            image::imageops::FilterType::Triangle,
        );

        CompositeFrame {
            data: scaled.into_raw(),
            width: self.config.output_width,
            height: self.config.output_height,
            timestamp: webcam_frame.timestamp,
            is_bgra: false, // RGBA format after image processing
        }
    }
    
    /// Get output dimensions
    pub fn output_dimensions(&self) -> (u32, u32) {
        (self.config.output_width, self.config.output_height)
    }
    
    /// Get PiP dimensions
    pub fn pip_dimensions(&self) -> (u32, u32) {
        (self.pip_width, self.pip_height)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    
    #[test]
    fn test_pip_position_calculation() {
        let (x, y) = VideoCompositor::calculate_pip_position(
            1920, 1080, 480, 360, PipPosition::TopRight, 20
        );
        assert_eq!(x, 1920 - 480 - 20); // 1420
        assert_eq!(y, 20);
        
        let (x, y) = VideoCompositor::calculate_pip_position(
            1920, 1080, 480, 360, PipPosition::BottomLeft, 20
        );
        assert_eq!(x, 20);
        assert_eq!(y, 1080 - 360 - 20); // 700
    }
    
    #[test]
    fn test_compositor_creation() {
        let config = CompositorConfig {
            output_width: 1920,
            output_height: 1080,
            include_webcam: true,
            pip_position: PipPosition::TopRight,
            pip_size_percent: 25,
            pip_padding: 20,
        };
        
        let compositor = VideoCompositor::new(config);
        let (w, h) = compositor.output_dimensions();
        assert_eq!(w, 1920);
        assert_eq!(h, 1080);
    }
}

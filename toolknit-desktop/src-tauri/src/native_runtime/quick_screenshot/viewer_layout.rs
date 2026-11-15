// Logical client size, fitted to the current monitor's physical work area.
pub(super) fn size(image: (u32, u32), work: (u32, u32), scale: f64) -> (f64, f64) {
    let scale = if scale.is_finite() && scale > 0.0 { scale } else { 1.0 };
    let max_width = (work.0 as f64 / scale * 0.9).max(1.0);
    let max_height = (work.1 as f64 / scale * 0.9).max(1.0);
    let image_width = (image.0 as f64 / scale).max(1.0);
    let image_height = (image.1 as f64 / scale).max(1.0);
    let fit = ((max_width - 16.0).max(1.0) / image_width)
        .min((max_height - 114.0).max(1.0) / image_height).min(1.0);
    ((image_width * fit + 16.0).max(480.0).min(max_width),
     (image_height * fit + 114.0).max(280.0).min(max_height))
}

#[cfg(test)]
mod tests {
    use super::size;
    #[test]
    fn screenshot_viewer_fits_image_and_small_high_dpi_work_areas() {
        assert_eq!(size((200, 100), (1920, 1080), 1.0), (480.0, 280.0));
        for scale in [1.0, 1.25, 1.5, 2.0, f64::NAN, 0.0] {
            for image in [(200, 100), (8000, 300), (300, 8000), (3840, 2160)] {
                let (w, h) = size(image, (720, 480), scale);
                let s = if scale.is_finite() && scale > 0.0 { scale } else { 1.0 };
                assert!(w.is_finite() && h.is_finite() && w > 0.0 && h > 0.0);
                assert!(w * s <= 648.001 && h * s <= 432.001);
            }
        }
    }
}

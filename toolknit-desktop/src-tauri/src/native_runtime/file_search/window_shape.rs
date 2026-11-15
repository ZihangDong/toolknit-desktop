//! Keep binary HWND clipping outside Chromium's antialiased CSS contour.
//! The HWND rectangle is unchanged, including the 20-DIP inter-window gap.
use windows::Win32::Graphics::Gdi::{CreateRoundRectRgn, HRGN};

pub(super) const EDGE_FRINGE: i32 = 2;

pub(super) fn region(x: i32, y: i32, width: u32, height: u32, diameter: i32) -> HRGN {
    let pad = EDGE_FRINGE;
    unsafe {
        CreateRoundRectRgn(
            x - pad,
            y - pad,
            x + width as i32 + pad + 1,
            y + height as i32 + pad + 1,
            diameter + pad * 2,
            diameter + pad * 2,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::Graphics::Gdi::{DeleteObject, GetRgnBox, PtInRegion};
    #[test]
    fn native_region_keeps_antialias_pixels_and_excludes_outer_corners() {
        let mut hard_clipped = 0;
        for scale in [1.0_f64, 1.25, 1.5, 2.0] {
            for (width, height, radius) in [
                (148.0, 48.0, 24.0),
                (500.0, 56.0, 28.0),
                (500.0, 406.0, 24.0),
                (300.0, 162.0, 16.0),
            ] {
                let (w, h, r) = (
                    (width * scale).round() as u32,
                    (height * scale).round() as u32,
                    radius * scale,
                );
                let d = (r * 2.0).round() as i32;
                let smooth = region(0, 0, w, h, d);
                let hard = unsafe { CreateRoundRectRgn(0, 0, w as i32 + 1, h as i32 + 1, d, d) };
                assert_ne!(smooth.0, 0);
                assert_ne!(hard.0, 0);
                let mut bounds = Default::default();
                unsafe {
                    GetRgnBox(smooth, &mut bounds);
                }
                assert_eq!(bounds.left + EDGE_FRINGE, 0);
                assert_eq!(bounds.top + EDGE_FRINGE, 0);
                assert_eq!(
                    bounds.right - bounds.left - EDGE_FRINGE * 2,
                    w as i32,
                    "morph reversal reconstructs the visible width without the antialias fringe"
                );
                assert_eq!(bounds.bottom - bounds.top - EDGE_FRINGE * 2, h as i32);
                for y in 0..r.ceil() as i32 + 1 {
                    for x in 0..r.ceil() as i32 + 1 {
                        let distance =
                            ((x as f64 + 0.5 - r).powi(2) + (y as f64 + 0.5 - r).powi(2)).sqrt()
                                - r;
                        if distance <= 0.75 {
                            if !unsafe { PtInRegion(hard, x, y) }.as_bool() {
                                hard_clipped += 1;
                            }
                            for (px, py) in [
                                (x, y),
                                (w as i32 - 1 - x, y),
                                (x, h as i32 - 1 - y),
                                (w as i32 - 1 - x, h as i32 - 1 - y),
                            ] {
                                assert!(
                                    unsafe { PtInRegion(smooth, px, py) }.as_bool(),
                                    "CSS edge clipped: {w}x{h} {r} ({px},{py})"
                                );
                            }
                        }
                    }
                }
                assert!(
                    !unsafe { PtInRegion(smooth, 0, 0) }.as_bool(),
                    "empty outer corner stays outside native input"
                );
                assert!(unsafe { PtInRegion(smooth, w as i32 / 2, h as i32 / 2) }.as_bool());
                unsafe {
                    let _ = DeleteObject(smooth);
                    let _ = DeleteObject(hard);
                }
            }
        }
        assert!(
            hard_clipped > 0,
            "the previous tight mask clipped partially covered edge pixels"
        );
    }
}

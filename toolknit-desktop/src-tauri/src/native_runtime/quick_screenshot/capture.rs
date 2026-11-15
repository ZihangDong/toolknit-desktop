use super::*;

#[cfg(any(windows, test))]
pub(super) fn encode_desktop_bgra(width: u32, height: u32, mut pixels: Vec<u8>) -> Result<Vec<u8>, String> {
    use image::{codecs::png::{CompressionType, FilterType, PngEncoder}, ImageEncoder};
    check_pixels(width,height)?;
    let count=width as usize * height as usize;
    if pixels.len()!=count*4 { return Err("screenshot:capture-failed".into()); }
    // GDI's alpha is undefined. Keep the aligned four-byte pixels so this
    // transform remains vectorizable; RGB compaction was slower in benchmarks.
    for pixel in pixels.chunks_exact_mut(4) {
        pixel.swap(0,2);pixel[3]=255;
    }
    let mut encoded=Vec::new();
    PngEncoder::new_with_quality(&mut encoded,CompressionType::Fast,FilterType::Adaptive)
        .write_image(&pixels,width,height,image::ExtendedColorType::Rgba8)
        .map_err(|_| "screenshot:capture-failed")?;
    Ok(encoded)
}

#[cfg(windows)]
pub(super) fn capture() -> Result<(Desktop, Vec<u8>), String> {
    use windows::Win32::{
        Foundation::{BOOL, HWND, LPARAM, RECT},
        Graphics::{
            Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS},
            Gdi::*,
        },
        UI::WindowsAndMessaging::*,
    };
    struct Surface {
        screen: HDC,
        memory: HDC,
        bitmap: HBITMAP,
        previous: HGDIOBJ,
    }
    impl Drop for Surface {
        fn drop(&mut self) {
            unsafe {
                if self.previous.0 != 0 {
                    SelectObject(self.memory, self.previous);
                }
                if self.bitmap.0 != 0 {
                    let _ = DeleteObject(self.bitmap);
                }
                if self.memory.0 != 0 {
                    let _ = DeleteDC(self.memory);
                }
                if self.screen.0 != 0 {
                    ReleaseDC(HWND::default(), self.screen);
                }
            }
        }
    }
    let bounds = screen_picker_bounds_impl()?;
    check_pixels(bounds.width, bounds.height)?;
    let mut surface = Surface {
        screen: unsafe { GetDC(HWND::default()) },
        memory: HDC::default(),
        bitmap: HBITMAP::default(),
        previous: HGDIOBJ::default(),
    };
    if surface.screen.0 == 0 {
        return Err("screenshot:capture-failed".into());
    }
    unsafe {
        surface.memory = CreateCompatibleDC(surface.screen);
        surface.bitmap =
            CreateCompatibleBitmap(surface.screen, bounds.width as i32, bounds.height as i32);
        if surface.memory.0 == 0 || surface.bitmap.0 == 0 {
            return Err("screenshot:capture-failed".into());
        }
        surface.previous = SelectObject(surface.memory, surface.bitmap);
        BitBlt(
            surface.memory,
            0,
            0,
            bounds.width as i32,
            bounds.height as i32,
            surface.screen,
            bounds.x,
            bounds.y,
            SRCCOPY | CAPTUREBLT,
        )
        .map_err(|_| "screenshot:capture-failed")?;
    }
    let mut pixels = vec![0u8; bounds.width as usize * bounds.height as usize * 4];
    let mut info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: bounds.width as i32,
            biHeight: -(bounds.height as i32),
            biPlanes: 1,
            biBitCount: 32,
            ..Default::default()
        },
        ..Default::default()
    };
    // GetDIBits requires the bitmap to be deselected from its drawing DC.
    unsafe {
        SelectObject(surface.memory, surface.previous);
    }
    surface.previous = HGDIOBJ::default();
    if unsafe {
        GetDIBits(
            surface.screen,
            surface.bitmap,
            0,
            bounds.height,
            Some(pixels.as_mut_ptr().cast()),
            &mut info,
            DIB_RGB_COLORS,
        )
    } != bounds.height as i32
    {
        return Err("screenshot:capture-failed".into());
    }
    drop(surface);
    let output=encode_desktop_bgra(bounds.width,bounds.height,pixels)?;
    unsafe extern "system" fn enumerate(hwnd: HWND, context: LPARAM) -> BOOL {
        if !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool() {
            return BOOL(1);
        }
        let mut cloaked = 0u32;
        let _ = DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, (&mut cloaked as *mut u32).cast(), 4);
        if cloaked != 0 {
            return BOOL(1);
        }
        let mut rect = RECT::default();
        if DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            (&mut rect as *mut RECT).cast(),
            std::mem::size_of::<RECT>() as u32,
        )
        .is_err()
            && GetWindowRect(hwnd, &mut rect).is_err()
        {
            return BOOL(1);
        }
        if rect.right > rect.left && rect.bottom > rect.top {
            let list = &mut *(context.0 as *mut Vec<Rect>);
            if list.len() < 1024 {
                list.push(Rect {
                    x: rect.left,
                    y: rect.top,
                    width: (rect.right - rect.left) as u32,
                    height: (rect.bottom - rect.top) as u32,
                });
            }
        }
        BOOL(1)
    }
    let mut windows = Vec::<Rect>::new();
    unsafe {
        EnumWindows(
            Some(enumerate),
            LPARAM((&mut windows as *mut Vec<Rect>) as isize),
        )
        .map_err(|_| "screenshot:windows-failed")?;
    }
    Ok((
        Desktop {
            bounds: Rect {
                x: bounds.x,
                y: bounds.y,
                width: bounds.width,
                height: bounds.height,
            },
            windows,
            monitors: Vec::new(),
        },
        output,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn screenshot_bgra_png_preserves_colors_rows_and_opaque_pixels() {
        let raw=vec![1,2,3,0, 11,12,13,40, 21,22,23,255, 31,32,33,0, 41,42,43,127, 51,52,53,255];
        let encoded=encode_desktop_bgra(3,2,raw.clone()).unwrap();
        let image=image::load_from_memory(&encoded).unwrap().to_rgba8();
        let expected:Vec<u8>=raw.chunks_exact(4).flat_map(|p|[p[2],p[1],p[0],255]).collect();
        assert_eq!(image.as_raw(),&expected);
        assert_eq!(image.dimensions(),(3,2));
        assert!(encode_desktop_bgra(3,2,vec![0;23]).is_err());
        assert!(encode_desktop_bgra(0,2,vec![]).is_err());
    }
}

#[cfg(not(windows))]
pub(super) fn capture() -> Result<(Desktop, Vec<u8>), String> {
    Err("screenshot:windows-only".into())
}

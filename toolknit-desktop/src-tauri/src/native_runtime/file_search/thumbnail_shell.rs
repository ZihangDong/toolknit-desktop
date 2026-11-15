//! Runs only in the bounded, ordinary-user filesystem child process.
use std::path::Path;
use windows::{core::PCWSTR, Win32::{Foundation::{HWND, SIZE}, Graphics::Gdi::*, System::Com::*, UI::Shell::*}};

pub(super) fn read(path: &Path, cached: bool) -> Option<image::DynamicImage> {
    use std::os::windows::ffi::OsStrExt;
    unsafe {
        if CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_err() { return None; }
        struct Apartment;
        impl Drop for Apartment { fn drop(&mut self) { unsafe { CoUninitialize(); } } }
        let _apartment = Apartment;
        let wide: Vec<_> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let item: IShellItemImageFactory = SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None).ok()?;
        let flags = SIIGBF_THUMBNAILONLY | if cached { SIIGBF_INCACHEONLY } else { SIIGBF_RESIZETOFIT };
        let bitmap = item.GetImage(SIZE { cx: super::EDGE as i32, cy: super::EDGE as i32 }, flags).ok()?;
        struct Bitmap(HBITMAP);
        impl Drop for Bitmap { fn drop(&mut self) { unsafe { let _ = DeleteObject(self.0); } } }
        let _bitmap = Bitmap(bitmap);
        let mut object = BITMAP::default();
        if GetObjectW(bitmap, std::mem::size_of::<BITMAP>() as i32, Some(&mut object as *mut _ as *mut _)) == 0 { return None; }
        let width = u32::try_from(object.bmWidth).ok()?;
        let height = object.bmHeight.unsigned_abs();
        if width == 0 || height == 0 || width > 512 || height > 512 { return None; }
        let dc = GetDC(HWND::default()); if dc.0 == 0 { return None; }
        struct Dc(HDC);
        impl Drop for Dc { fn drop(&mut self) { unsafe { ReleaseDC(HWND::default(), self.0); } } }
        let _dc = Dc(dc);
        let mut info = BITMAPINFO::default();
        info.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        info.bmiHeader.biWidth = width as i32; info.bmiHeader.biHeight = -(height as i32);
        info.bmiHeader.biPlanes = 1; info.bmiHeader.biBitCount = 32; info.bmiHeader.biCompression = BI_RGB.0;
        let mut bytes = vec![0u8; (width * height * 4) as usize];
        if GetDIBits(dc, bitmap, 0, height, Some(bytes.as_mut_ptr() as *mut _), &mut info, DIB_RGB_COLORS) != height as i32 { return None; }
        let opaque = bytes.chunks_exact(4).all(|p| p[3] == 0);
        for pixel in bytes.chunks_exact_mut(4) {
            pixel.swap(0, 2);
            if opaque { pixel[3] = 255; }
            else if pixel[3] > 0 && pixel[3] < 255 { for c in 0..3 { pixel[c] = ((u32::from(pixel[c]) * 255 / u32::from(pixel[3])).min(255)) as u8; } }
        }
        Some(image::DynamicImage::ImageRgba8(image::RgbaImage::from_raw(width, height, bytes)?))
    }
}

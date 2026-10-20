use super::types::Content;
use std::{
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, SystemTime},
};
use tauri::Manager;

static ACTIVE: AtomicBool = AtomicBool::new(false);
struct Active;
impl Drop for Active {
    fn drop(&mut self) {
        ACTIVE.store(false, Ordering::Release);
    }
}
const CACHE_BYTES: u64 = 128 * 1024 * 1024;
const CACHE_FILES: usize = 64;

fn export_image(directory: &Path, png: &[u8]) -> Result<PathBuf, String> {
    use std::io::Write;
    std::fs::create_dir_all(directory).map_err(|_| "clipboard:drag-failed")?;
    if std::fs::symlink_metadata(directory)
        .map_err(|_| "clipboard:drag-failed")?
        .file_type()
        .is_symlink()
    {
        return Err("clipboard:drag-failed".into());
    }
    let mut bytes = 0;
    let mut count = 0;
    for entry in std::fs::read_dir(directory).map_err(|_| "clipboard:drag-failed")? {
        let entry = entry.map_err(|_| "clipboard:drag-failed")?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let Some(key) = name
            .strip_prefix("toolknit-drag-")
            .and_then(|name| name.strip_suffix(".png"))
        else {
            continue;
        };
        if key.len() != 32 || !key.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            continue;
        }
        let meta = entry.metadata().map_err(|_| "clipboard:drag-failed")?;
        if !entry
            .file_type()
            .map_err(|_| "clipboard:drag-failed")?
            .is_file()
        {
            continue;
        }
        // Receivers may read the file after Drop returns (e.g. a chat attachment draft).
        if meta
            .modified()
            .ok()
            .and_then(|t| SystemTime::now().duration_since(t).ok())
            .is_some_and(|age| age > Duration::from_secs(86400))
        {
            if std::fs::remove_file(entry.path()).is_ok() {
                continue;
            }
        }
        bytes += meta.len();
        count += 1;
    }
    if count >= CACHE_FILES || bytes.saturating_add(png.len() as u64) > CACHE_BYTES {
        return Err("clipboard:drag-capacity".into());
    }
    let mut random = [0; 16];
    getrandom::getrandom(&mut random).map_err(|_| "clipboard:drag-failed")?;
    let path = directory.join(format!("toolknit-drag-{}.png", hex::encode(random)));
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|_| "clipboard:drag-failed")?;
    if file.write_all(png).and_then(|_| file.sync_all()).is_err() {
        drop(file);
        let _ = std::fs::remove_file(&path);
        return Err("clipboard:drag-failed".into());
    }
    Ok(path)
}
fn unicode(text: &str) -> Vec<u8> {
    text.encode_utf16()
        .chain(std::iter::once(0))
        .flat_map(u16::to_le_bytes)
        .collect()
}
fn text_payload(text: &str) -> Vec<u8> {
    // CF_UNICODETEXT uses CRLF. Preserve the number of logical lines, including
    // intentional empty lines; never turn visual wrapping into stored newlines.
    let mut units = Vec::with_capacity(text.len() + 1);
    let mut chars = text.encode_utf16().peekable();
    while let Some(unit) = chars.next() {
        if unit == 13 {
            if chars.peek() == Some(&10) {
                chars.next();
            }
            units.extend([13, 10]);
        } else if unit == 10 {
            units.extend([13, 10]);
        } else {
            units.push(unit);
        }
    }
    units.push(0);
    units.into_iter().flat_map(u16::to_le_bytes).collect()
}
fn file_drop(path: &Path) -> Vec<u8> {
    let mut bytes = vec![0; 20];
    bytes[..4].copy_from_slice(&20u32.to_le_bytes());
    bytes[16..20].copy_from_slice(&1u32.to_le_bytes());
    bytes.extend(unicode(&path.to_string_lossy()));
    bytes.extend([0, 0]);
    bytes
}

#[cfg(windows)]
mod native {
    use windows::Win32::{
        Foundation::{GlobalFree, HWND},
        System::{
            Com::{
                IDataObject, DVASPECT_CONTENT, FORMATETC, STGMEDIUM, STGMEDIUM_0, TYMED_HGLOBAL,
            },
            Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE},
            Ole::{IDropSource, OleInitialize, OleUninitialize, DROPEFFECT_COPY},
        },
        UI::{
            Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON},
            Shell::{SHCreateDataObject, SHDoDragDrop},
        },
    };
    pub struct Ole;
    impl Ole {
        pub fn init() -> Result<Self, String> {
            unsafe {
                OleInitialize(None).map_err(|_| "clipboard:drag-failed")?;
            }
            Ok(Self)
        }
    }
    impl Drop for Ole {
        fn drop(&mut self) {
            unsafe {
                OleUninitialize();
            }
        }
    }
    pub fn held() -> bool {
        unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) < 0 }
    }
    pub fn data(format: u16, bytes: &[u8]) -> Result<IDataObject, String> {
        unsafe {
            let object: IDataObject = SHCreateDataObject(None, None, None::<&IDataObject>)
                .map_err(|_| "clipboard:drag-failed")?;
            let memory =
                GlobalAlloc(GMEM_MOVEABLE, bytes.len()).map_err(|_| "clipboard:drag-failed")?;
            let pointer = GlobalLock(memory);
            if pointer.is_null() {
                let _ = GlobalFree(memory);
                return Err("clipboard:drag-failed".into());
            }
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), pointer.cast::<u8>(), bytes.len());
            let _ = GlobalUnlock(memory);
            let medium = STGMEDIUM {
                tymed: TYMED_HGLOBAL.0 as u32,
                u: STGMEDIUM_0 { hGlobal: memory },
                pUnkForRelease: std::mem::ManuallyDrop::new(None),
            };
            let descriptor = FORMATETC {
                cfFormat: format,
                dwAspect: DVASPECT_CONTENT.0,
                lindex: -1,
                tymed: TYMED_HGLOBAL.0 as u32,
                ..Default::default()
            };
            if object.SetData(&descriptor, &medium, true).is_err() {
                let _ = GlobalFree(memory);
                return Err("clipboard:drag-failed".into());
            }
            Ok(object)
        }
    }
    pub fn run(handle: isize, format: u16, bytes: &[u8]) -> Result<bool, String> {
        let _ole = Ole::init()?;
        if !held()
            || !unsafe {
                windows::Win32::UI::WindowsAndMessaging::IsWindowVisible(HWND(handle)).as_bool()
            }
        {
            return Ok(false);
        }
        let object = data(format, bytes)?;
        unsafe {
            SHDoDragDrop(HWND(handle), &object, None::<&IDropSource>, DROPEFFECT_COPY)
                .map(|effect| effect == DROPEFFECT_COPY)
                .map_err(|_| "clipboard:drag-failed".into())
        }
    }
}

pub async fn start(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    content: Content,
) -> Result<bool, String> {
    if ACTIVE.swap(true, Ordering::AcqRel) {
        return Err("clipboard:drag-busy".into());
    }
    let _active = Active;
    content.validate()?;
    #[cfg(windows)]
    {
        if !native::held() {
            return Ok(false);
        }
        let directory = app
            .path()
            .app_cache_dir()
            .map_err(|_| "clipboard:drag-failed")?
            .join("clipboard-drag");
        let (format, bytes) = tauri::async_runtime::spawn_blocking(move || match content {
            Content::Text { text, .. } => Ok((13, text_payload(&text))),
            Content::Image { png, .. } => {
                export_image(&directory, &png).map(|path| (15, file_drop(&path)))
            }
            _ => Err("clipboard:drag-unsupported".into()),
        })
        .await
        .map_err(|_| "clipboard:drag-failed")??;
        let handle = window.hwnd().map_err(|_| "clipboard:drag-failed")?.0 as isize;
        let (sender, receiver) = tokio::sync::oneshot::channel();
        window
            .run_on_main_thread(move || {
                let result = native::run(handle, format, &bytes);
                let _ = sender.send(result);
            })
            .map_err(|_| "clipboard:drag-failed")?;
        receiver
            .await
            .map_err(|_| "clipboard:drag-failed".to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (app, window, content);
        Err("clipboard:desktop-only".into())
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use windows::Win32::System::{
        Com::{DVASPECT_CONTENT, FORMATETC, TYMED_HGLOBAL},
        Memory::{GlobalLock, GlobalSize, GlobalUnlock},
        Ole::ReleaseStgMedium,
    };
    #[test]
    fn native_ole_delivers_complete_unicode_text_and_png_file_payloads() {
        let _ole = native::Ole::init().unwrap();
        for (format, bytes) in [
            (13, text_payload(&format!("邮箱\n{}", "x".repeat(800)))),
            (15, file_drop(Path::new("C:/Synthetic/图片.png"))),
        ] {
            let object = native::data(format, &bytes).unwrap();
            let descriptor = FORMATETC {
                cfFormat: format,
                dwAspect: DVASPECT_CONTENT.0,
                lindex: -1,
                tymed: TYMED_HGLOBAL.0 as u32,
                ..Default::default()
            };
            unsafe {
                let mut medium = object.GetData(&descriptor).unwrap();
                let memory = medium.u.hGlobal;
                assert!(GlobalSize(memory) >= bytes.len());
                let pointer = GlobalLock(memory);
                assert!(!pointer.is_null());
                assert_eq!(
                    std::slice::from_raw_parts(pointer.cast::<u8>(), bytes.len()),
                    bytes
                );
                let _ = GlobalUnlock(memory);
                ReleaseStgMedium(&mut medium);
            }
        }
    }
    #[test]
    fn image_export_keeps_complete_file_and_never_overwrites() {
        let directory = std::env::temp_dir().join(format!(
            "toolknit-drag-test-{}-{}",
            std::process::id(),
            super::super::types::now_ms()
        ));
        let mut png = std::io::Cursor::new(Vec::new());
        image::RgbaImage::from_pixel(640, 360, image::Rgba([32u8, 96, 160, 220]))
            .write_to(&mut png, image::ImageFormat::Png)
            .unwrap();
        let first = export_image(&directory, png.get_ref()).unwrap();
        let second = export_image(&directory, b"second").unwrap();
        assert_ne!(first, second);
        assert_eq!(std::fs::read(&first).unwrap(), *png.get_ref());
        let decoded = image::open(&first).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (640, 360));
        assert!(second.exists());
        std::fs::remove_file(first).unwrap();
        std::fs::remove_file(second).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }
    #[test]
    fn windows_text_payload_keeps_single_lines_and_normalizes_without_extra_blank_lines() {
        let decode = |bytes: Vec<u8>| {
            let units: Vec<_> = bytes
                .chunks_exact(2)
                .map(|b| u16::from_le_bytes([b[0], b[1]]))
                .collect();
            assert_eq!(units.last(), Some(&0));
            String::from_utf16(&units[..units.len() - 1]).unwrap()
        };
        for text in [
            "123456@qq.com".to_string(),
            "中文及emoji🙂".repeat(300),
            "  keep spaces  ".into(),
        ] {
            assert_eq!(decode(text_payload(&text)), text);
        }
        for text in ["a\nb", "a\r\nb", "a\rb"] {
            assert_eq!(decode(text_payload(text)), "a\r\nb");
        }
        assert_eq!(
            decode(text_payload("first\n\nlast\n")),
            "first\r\n\r\nlast\r\n"
        );
        assert_eq!(
            text_payload("first\n\nlast\n"),
            text_payload("first\r\n\r\nlast\r\n")
        );
    }
    #[test]
    fn cache_limits_preserve_recent_drafts_and_only_reclaim_owned_expired_files() {
        let directory = std::env::temp_dir().join(format!(
            "toolknit-drag-capacity-test-{}-{}",
            std::process::id(),
            super::super::types::now_ms()
        ));
        let files: Vec<_> = (0..CACHE_FILES)
            .map(|_| export_image(&directory, b"fixture").unwrap())
            .collect();
        assert_eq!(
            export_image(&directory, b"extra").unwrap_err(),
            "clipboard:drag-capacity"
        );
        assert!(files.iter().all(|path| path.exists()));
        let foreign = directory.join("toolknit-drag-not-owned.png");
        std::fs::write(&foreign, b"preserve").unwrap();
        let old =
            std::fs::FileTimes::new().set_modified(SystemTime::now() - Duration::from_secs(90000));
        std::fs::File::options()
            .write(true)
            .open(&files[0])
            .unwrap()
            .set_times(old)
            .unwrap();
        std::fs::File::options()
            .write(true)
            .open(&foreign)
            .unwrap()
            .set_times(old)
            .unwrap();
        let extra = export_image(&directory, b"extra").unwrap();
        assert!(!files[0].exists());
        assert!(foreign.exists());
        for file in files.iter().skip(1).chain([&extra, &foreign]) {
            std::fs::remove_file(file).unwrap();
        }
        std::fs::remove_dir(directory).unwrap();
    }
}

use super::types::*;
use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::{self, SyncSender},
        Arc, Mutex,
    },
    thread::JoinHandle,
};
use windows::core::{w, PCWSTR, PWSTR};
use windows::Win32::{
    Foundation::*,
    System::{DataExchange::*, LibraryLoader::GetModuleHandleW, Memory::*, Threading::*, Time::*},
    UI::{
        Shell::{DragQueryFileW, HDROP},
        WindowsAndMessaging::*,
    },
};

const OWN_FORMAT: PCWSTR = w!("ToolKnit.ClipboardHistory.Internal.v1");
pub enum RawContent {
    Ready(Content),
    Dib(Vec<u8>),
    Png(Vec<u8>),
}
pub struct Capture {
    pub raw: RawContent,
    pub source: Option<String>,
    pub timestamp: i64,
    pub offset: i32,
    pub generation: u64,
}
pub enum Notice {
    Capture(Capture),
    Skipped,
    Failed(&'static str),
}
pub struct Monitor {
    thread_id: u32,
    thread: Option<JoinHandle<()>>,
}
struct Context {
    sender: SyncSender<Notice>,
    settings: Arc<Mutex<Settings>>,
    generation: Arc<AtomicU64>,
    epoch: u64,
    sequence: u32,
    dropped: Arc<AtomicU64>,
}
impl Monitor {
    pub fn start(
        sender: SyncSender<Notice>,
        settings: Arc<Mutex<Settings>>,
        generation: Arc<AtomicU64>,
        dropped: Arc<AtomicU64>,
    ) -> Result<Self, String> {
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        let thread = std::thread::Builder::new()
            .name("clipboard-listener".into())
            .spawn(move || unsafe {
                let epoch = generation.load(Ordering::Acquire);
                let mut context = Box::new(Context {
                    sender,
                    settings,
                    generation,
                    epoch,
                    sequence: 0,
                    dropped,
                });
                let hwnd = match create_window() {
                    Ok(hwnd) => hwnd,
                    Err(e) => {
                        let _ = ready_tx.send(Err(e));
                        return;
                    }
                };
                SetWindowLongPtrW(
                    hwnd,
                    GWLP_USERDATA,
                    (&mut *context as *mut Context) as isize,
                );
                if AddClipboardFormatListener(hwnd).is_err() {
                    let _ = DestroyWindow(hwnd);
                    let _ = ready_tx.send(Err("clipboard:listener-failed".into()));
                    return;
                }
                // Establish a baseline only: enabling never reads the pre-existing clipboard.
                context.sequence = GetClipboardSequenceNumber();
                let _ = ready_tx.send(Ok(GetCurrentThreadId()));
                let mut msg = MSG::default();
                while GetMessageW(&mut msg, HWND::default(), 0, 0).0 > 0 {
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
                let _ = RemoveClipboardFormatListener(hwnd);
                SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
                let _ = DestroyWindow(hwnd);
            })
            .map_err(|_| "clipboard:listener-failed")?;
        match ready_rx.recv() {
            Ok(Ok(thread_id)) => Ok(Self {
                thread_id,
                thread: Some(thread),
            }),
            _ => {
                let _ = thread.join();
                Err("clipboard:listener-failed".into())
            }
        }
    }
    pub fn stop(&mut self) {
        if let Some(thread) = self.thread.take() {
            unsafe {
                let _ = PostThreadMessageW(self.thread_id, WM_QUIT, WPARAM(0), LPARAM(0));
            }
            let _ = thread.join();
        }
    }
}
impl Drop for Monitor {
    fn drop(&mut self) {
        self.stop();
    }
}

unsafe fn create_window() -> Result<HWND, String> {
    let instance = GetModuleHandleW(None).map_err(|_| "clipboard:listener-failed")?;
    let class = WNDCLASSW {
        lpfnWndProc: Some(window_proc),
        hInstance: HINSTANCE(instance.0),
        lpszClassName: w!("ToolKnitClipboardListenerV1"),
        ..Default::default()
    };
    RegisterClassW(&class);
    let hwnd = CreateWindowExW(
        WINDOW_EX_STYLE(0),
        class.lpszClassName,
        w!(""),
        WINDOW_STYLE(0),
        0,
        0,
        0,
        0,
        HWND_MESSAGE,
        HMENU::default(),
        class.hInstance,
        None,
    );
    if hwnd.0 == 0 {
        Err("clipboard:listener-failed".into())
    } else {
        Ok(hwnd)
    }
}
unsafe extern "system" fn window_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if msg == WM_CLIPBOARDUPDATE {
        let ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut Context;
        if !ptr.is_null() {
            let context = &mut *ptr;
            if context.epoch != context.generation.load(Ordering::Acquire) {
                return LRESULT(0);
            }
            let seq = GetClipboardSequenceNumber();
            if seq != 0 && seq != context.sequence {
                context.sequence = seq;
                let settings = context
                    .settings
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .clone();
                let notice = match read_clipboard(hwnd, seq, &settings, context.epoch) {
                    Ok(Some(capture)) => Notice::Capture(capture),
                    Ok(None) => Notice::Skipped,
                    Err(e) => Notice::Failed(e),
                };
                if context.sender.try_send(notice).is_err() {
                    context.dropped.fetch_add(1, Ordering::Relaxed);
                }
            }
        }
        return LRESULT(0);
    }
    DefWindowProcW(hwnd, msg, wparam, lparam)
}

struct ClipboardGuard;
impl Drop for ClipboardGuard {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseClipboard();
        }
    }
}
unsafe fn open(hwnd: HWND) -> Result<ClipboardGuard, &'static str> {
    for delay in [0, 10, 20, 40, 80] {
        if delay > 0 {
            std::thread::sleep(std::time::Duration::from_millis(delay));
        }
        if OpenClipboard(hwnd).is_ok() {
            return Ok(ClipboardGuard);
        }
    }
    Err("clipboard:busy")
}
unsafe fn bytes(format: u32, limit: usize) -> Result<Vec<u8>, &'static str> {
    let handle = GetClipboardData(format).map_err(|_| "clipboard:read-failed")?;
    let memory = HGLOBAL(handle.0 as *mut _);
    let size = GlobalSize(memory);
    if size == 0 || size > limit {
        return Err("clipboard:too-large");
    }
    let ptr = GlobalLock(memory);
    if ptr.is_null() {
        return Err("clipboard:read-failed");
    }
    let data = std::slice::from_raw_parts(ptr as *const u8, size).to_vec();
    let _ = GlobalUnlock(memory);
    Ok(data)
}
unsafe fn available(format: u32) -> bool {
    format != 0 && IsClipboardFormatAvailable(format).is_ok()
}
unsafe fn excluded() -> bool {
    if available(RegisterClipboardFormatW(OWN_FORMAT))
        || available(RegisterClipboardFormatW(w!(
            "ExcludeClipboardContentFromMonitorProcessing"
        )))
        || available(RegisterClipboardFormatW(w!("Clipboard Viewer Ignore")))
    {
        return true;
    }
    let history = RegisterClipboardFormatW(w!("CanIncludeInClipboardHistory"));
    if available(history) {
        // Malformed privacy metadata is treated conservatively as excluded.
        return bytes(history, 16)
            .map(|b| b.len() < 4 || u32::from_le_bytes(b[..4].try_into().unwrap()) == 0)
            .unwrap_or(true);
    }
    false
}
unsafe fn source_app() -> Option<String> {
    let owner = GetClipboardOwner();
    if owner.0 == 0 {
        return None;
    }
    let mut pid = 0;
    GetWindowThreadProcessId(owner, Some(&mut pid));
    if pid == 0 {
        return None;
    }
    let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
    let mut buffer = vec![0u16; 32768];
    let mut length = buffer.len() as u32;
    let result = QueryFullProcessImageNameW(
        process,
        PROCESS_NAME_FORMAT(0),
        PWSTR(buffer.as_mut_ptr()),
        &mut length,
    );
    let _ = CloseHandle(process);
    result.ok()?;
    std::path::Path::new(&String::from_utf16_lossy(&buffer[..length as usize]))
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
}
pub fn offset_minutes() -> i32 {
    unsafe {
        let mut timezone = TIME_ZONE_INFORMATION::default();
        let status = GetTimeZoneInformation(&mut timezone);
        -(timezone.Bias
            + if status == 2 {
                timezone.DaylightBias
            } else {
                timezone.StandardBias
            })
    }
}
unsafe fn read_clipboard(
    hwnd: HWND,
    sequence: u32,
    settings: &Settings,
    generation: u64,
) -> Result<Option<Capture>, &'static str> {
    let timestamp = now_ms();
    let _guard = open(hwnd)?;
    if sequence != GetClipboardSequenceNumber() {
        return Err("clipboard:changed");
    }
    if excluded() {
        return Ok(None);
    }
    let source = source_app();
    if source.as_ref().is_some_and(|name| {
        settings
            .excluded_apps
            .iter()
            .any(|s| s.eq_ignore_ascii_case(name))
    }) {
        return Ok(None);
    }
    let png = RegisterClipboardFormatW(w!("PNG"));
    let raw = if available(15) {
        if !settings.files {
            return Ok(None);
        }
        let hdrop = HDROP(GetClipboardData(15).map_err(|_| "clipboard:read-failed")?.0);
        let count = DragQueryFileW(hdrop, u32::MAX, None) as usize;
        if count == 0 || count > MAX_FILES {
            return Err("clipboard:too-large");
        }
        let mut paths = Vec::with_capacity(count);
        let mut total = 0;
        for index in 0..count {
            let length = DragQueryFileW(hdrop, index as u32, None) as usize;
            if length == 0 || length > 32767 {
                return Err("clipboard:too-large");
            }
            let mut path = vec![0u16; length + 1];
            let read = DragQueryFileW(hdrop, index as u32, Some(&mut path));
            let path = String::from_utf16_lossy(&path[..read as usize]);
            total += path.len();
            if total > MAX_TEXT {
                return Err("clipboard:too-large");
            }
            paths.push(path);
        }
        RawContent::Ready(Content::Files { paths })
    } else if available(png) && settings.images {
        RawContent::Png(bytes(png, MAX_IMAGE)?)
    } else if (available(17) || available(8)) && settings.images {
        RawContent::Dib(bytes(
            if available(17) { 17 } else { 8 },
            (MAX_PIXELS * 4 + 4096) as usize,
        )?)
    } else if available(13) && settings.text {
        let data = bytes(13, MAX_TEXT * 2 + 2)?;
        let words: Vec<u16> = data
            .chunks_exact(2)
            .map(|b| u16::from_le_bytes([b[0], b[1]]))
            .take_while(|w| *w != 0)
            .collect();
        let text = String::from_utf16_lossy(&words);
        if text.is_empty() {
            return Ok(None);
        }
        if text.len() > MAX_TEXT {
            return Err("clipboard:too-large");
        }
        RawContent::Ready(Content::Text {
            text,
            rich: available(RegisterClipboardFormatW(w!("HTML Format")))
                || available(RegisterClipboardFormatW(w!("Rich Text Format"))),
        })
    } else {
        return Ok(None);
    };
    if sequence != GetClipboardSequenceNumber() {
        return Err("clipboard:changed");
    }
    Ok(Some(Capture {
        raw,
        source,
        timestamp,
        offset: offset_minutes(),
        generation,
    }))
}

pub fn normalize(raw: RawContent) -> Result<Content, String> {
    let (bytes, format) = match raw {
        RawContent::Ready(content) => {
            content.validate()?;
            return Ok(content);
        }
        RawContent::Png(bytes) => (bytes, image::ImageFormat::Png),
        RawContent::Dib(bytes) => {
            if bytes.len() < 40 {
                return Err("clipboard:image-invalid".into());
            }
            let word =
                |offset: usize| u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap());
            let header = word(0) as usize;
            if ![40, 108, 124].contains(&header) || bytes.len() < header {
                return Err("clipboard:image-invalid".into());
            }
            let bits = u16::from_le_bytes([bytes[14], bytes[15]]);
            let palette = if word(32) > 0 {
                word(32) as usize
            } else if bits <= 8 {
                1usize << bits
            } else {
                0
            };
            let masks = if header == 40 && word(16) == 3 {
                12
            } else if header == 40 && word(16) == 6 {
                16
            } else {
                0
            };
            let offset = 14usize
                .checked_add(header)
                .and_then(|x| x.checked_add(palette.checked_mul(4)?))
                .and_then(|x| x.checked_add(masks))
                .ok_or("clipboard:image-invalid")?;
            if offset > bytes.len() + 14 {
                return Err("clipboard:image-invalid".into());
            }
            let mut bmp = vec![b'B', b'M'];
            bmp.extend(((bytes.len() + 14) as u32).to_le_bytes());
            bmp.extend([0u8; 4]);
            bmp.extend((offset as u32).to_le_bytes());
            bmp.extend(bytes);
            (bmp, image::ImageFormat::Bmp)
        }
    };
    let reader = image::ImageReader::with_format(std::io::Cursor::new(&bytes), format);
    let (width, height) = reader
        .into_dimensions()
        .map_err(|_| "clipboard:image-invalid")?;
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > MAX_PIXELS {
        return Err("clipboard:too-large".into());
    }
    let mut reader = image::ImageReader::with_format(std::io::Cursor::new(bytes), format);
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(MAX_PIXELS * 8);
    reader.limits(limits);
    let image = reader.decode().map_err(|_| "clipboard:image-invalid")?;
    let mut output = std::io::Cursor::new(Vec::new());
    image
        .write_to(&mut output, image::ImageFormat::Png)
        .map_err(|_| "clipboard:image-invalid")?;
    let content = Content::Image {
        png: output.into_inner(),
        width,
        height,
    };
    content.validate()?;
    Ok(content)
}

unsafe fn put(format: u32, data: &[u8]) -> Result<(), String> {
    let memory = GlobalAlloc(GMEM_MOVEABLE, data.len()).map_err(|_| "clipboard:write-failed")?;
    let pointer = GlobalLock(memory);
    if pointer.is_null() {
        let _ = GlobalFree(memory);
        return Err("clipboard:write-failed".into());
    }
    std::ptr::copy_nonoverlapping(data.as_ptr(), pointer as *mut u8, data.len());
    let _ = GlobalUnlock(memory);
    if SetClipboardData(format, HANDLE(memory.0 as isize)).is_err() {
        let _ = GlobalFree(memory);
        return Err("clipboard:write-failed".into());
    }
    Ok(())
}
fn unicode_bytes(text: &str) -> Vec<u8> {
    text.encode_utf16()
        .chain(Some(0))
        .flat_map(u16::to_le_bytes)
        .collect()
}
pub fn write(content: &Content, sensitive: bool, paths_only: bool) -> Result<(), String> {
    write_impl(content, sensitive, paths_only, true)
}
pub fn write_captured_content(content: &Content) -> Result<(), String> {
    // New captures should reach the monitor; history replay keeps its exclusion marker.
    write_impl(content, false, false, false)
}
fn write_impl(
    content: &Content,
    sensitive: bool,
    paths_only: bool,
    internal: bool,
) -> Result<(), String> {
    content.validate()?;
    // Prepare all potentially failing conversions before replacing the clipboard.
    let mut formats: Vec<(u32, Vec<u8>)> = vec![];
    unsafe {
        match content {
            Content::Text { text, .. } => formats.push((13, unicode_bytes(text))),
            Content::Files { paths } => {
                formats.push((13, unicode_bytes(&paths.join("\r\n"))));
                if !paths_only {
                    if paths.iter().any(|p| !std::path::Path::new(p).exists()) {
                        return Err("clipboard:files-missing".into());
                    }
                    let mut drop = vec![0u8; 20];
                    drop[..4].copy_from_slice(&20u32.to_le_bytes());
                    drop[16..20].copy_from_slice(&1u32.to_le_bytes());
                    for path in paths {
                        drop.extend(unicode_bytes(path));
                    }
                    drop.extend([0, 0]);
                    formats.push((15, drop));
                    formats.push((
                        RegisterClipboardFormatW(w!("Preferred DropEffect")),
                        1u32.to_le_bytes().to_vec(),
                    ));
                }
            }
            Content::Image { png, .. } => {
                formats.push((RegisterClipboardFormatW(w!("PNG")), png.clone()));
                let image = image::load_from_memory_with_format(png, image::ImageFormat::Png)
                    .map_err(|_| "clipboard:image-invalid")?
                    .into_rgba8();
                let (width, height) = image.dimensions();
                let mut dib = vec![0u8; 124];
                dib[..4].copy_from_slice(&124u32.to_le_bytes());
                dib[4..8].copy_from_slice(&width.to_le_bytes());
                dib[8..12].copy_from_slice(&(-(height as i32)).to_le_bytes());
                dib[12..14].copy_from_slice(&1u16.to_le_bytes());
                dib[14..16].copy_from_slice(&32u16.to_le_bytes());
                dib[16..20].copy_from_slice(&3u32.to_le_bytes());
                for (index, mask) in [
                    0x00ff0000u32,
                    0x0000ff00,
                    0x000000ff,
                    0xff000000,
                    0x73524742,
                ]
                .iter()
                .enumerate()
                {
                    dib[40 + index * 4..44 + index * 4].copy_from_slice(&mask.to_le_bytes());
                }
                for pixel in image.pixels() {
                    dib.extend([pixel[2], pixel[1], pixel[0], pixel[3]]);
                }
                formats.push((17, dib));
            }
        }
        let hwnd = create_window()?;
        let result = (|| {
            let _guard = open(hwnd).map_err(str::to_string)?;
            EmptyClipboard().map_err(|_| "clipboard:write-failed")?;
            if internal {
                put(RegisterClipboardFormatW(OWN_FORMAT), &[1])?;
            }
            if sensitive {
                put(
                    RegisterClipboardFormatW(w!("ExcludeClipboardContentFromMonitorProcessing")),
                    &[1],
                )?;
                put(
                    RegisterClipboardFormatW(w!("CanIncludeInClipboardHistory")),
                    &0u32.to_le_bytes(),
                )?;
                put(
                    RegisterClipboardFormatW(w!("CanUploadToCloudClipboard")),
                    &0u32.to_le_bytes(),
                )?;
            }
            for (format, data) in &formats {
                if *format == 0 {
                    return Err("clipboard:write-failed".into());
                }
                put(*format, data)?;
            }
            Ok(())
        })();
        let _ = DestroyWindow(hwnd);
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn isolated_native_listener() {
        // The child uses a separate window station and desktop, never the user's clipboard.
        if std::env::var_os("TOOLKNIT_CLIPBOARD_ISOLATED_TEST").is_none() {
            let result = std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "clipboard_history::windows::tests::isolated_native_listener",
                    "--test-threads=1",
                ])
                .env("TOOLKNIT_CLIPBOARD_ISOLATED_TEST", "1")
                .output()
                .unwrap();
            assert!(
                result.status.success(),
                "{}",
                String::from_utf8_lossy(&result.stdout)
            );
            return;
        }
        unsafe {
            use windows::Win32::System::StationsAndDesktops::*;
            let station = CreateWindowStationW(PCWSTR::null(), 0, 0x000f037f, None)
                .expect("isolated station");
            SetProcessWindowStation(station).expect("isolate clipboard");
            let desktop = CreateDesktopW(
                w!("ClipboardTest"),
                PCWSTR::null(),
                None,
                DESKTOP_CONTROL_FLAGS(0),
                0x000f01ff,
                None,
            )
            .expect("isolated desktop");
            SetThreadDesktop(desktop).expect("isolate test thread");
        }
        let text = Content::Text {
            text: "Synthetic clipboard QA\n中文".into(),
            rich: false,
        };
        write_impl(&text, false, false, false).unwrap();
        let (tx, rx) = mpsc::sync_channel(8);
        let generation = Arc::new(AtomicU64::new(1));
        let settings = Arc::new(Mutex::new(Settings::default()));
        let mut monitor = Monitor::start(
            tx,
            settings.clone(),
            generation.clone(),
            Arc::new(AtomicU64::new(0)),
        )
        .unwrap();
        assert!(
            rx.recv_timeout(std::time::Duration::from_millis(100))
                .is_err(),
            "enable must not read existing content"
        );
        for _ in 0..2 {
            write_impl(&text, false, false, false).unwrap();
            match rx.recv_timeout(std::time::Duration::from_secs(3)).unwrap() {
                Notice::Capture(capture) => assert_eq!(
                    normalize(capture.raw).unwrap().searchable(),
                    text.searchable()
                ),
                _ => panic!("expected text capture"),
            }
        }
        write_impl(&text, true, false, false).unwrap();
        assert!(matches!(
            rx.recv_timeout(std::time::Duration::from_secs(3)).unwrap(),
            Notice::Skipped
        ));
        write(&text, false, false).unwrap();
        assert!(matches!(
            rx.recv_timeout(std::time::Duration::from_secs(3)).unwrap(),
            Notice::Skipped
        ));
        settings.lock().unwrap().text = false;
        write_impl(&text, false, false, false).unwrap();
        assert!(matches!(
            rx.recv_timeout(std::time::Duration::from_secs(3)).unwrap(),
            Notice::Skipped
        ));
        let image = image::RgbaImage::from_pixel(4, 3, image::Rgba([10, 20, 30, 160]));
        let mut png = std::io::Cursor::new(Vec::new());
        image.write_to(&mut png, image::ImageFormat::Png).unwrap();
        let png = png.into_inner();
        super::super::copy_screenshot_image(png.clone(), 4, 3).unwrap();
        match rx.recv_timeout(std::time::Duration::from_secs(3)).unwrap() {
            Notice::Capture(capture) => match normalize(capture.raw).unwrap() {
                Content::Image { png, width, height } => {
                    assert_eq!((width, height), (4, 3));
                    assert_eq!(image::load_from_memory(&png).unwrap().into_rgba8(), image);
                }
                _ => panic!("expected image content"),
            },
            _ => panic!("expected image"),
        }
        write(
            &Content::Image {
                png: png.clone(),
                width: 4,
                height: 3,
            },
            false,
            false,
        )
        .unwrap();
        assert!(matches!(
            rx.recv_timeout(std::time::Duration::from_secs(3)).unwrap(),
            Notice::Skipped
        ));
        settings.lock().unwrap().images = false;
        super::super::copy_screenshot_image(png.clone(), 4, 3).unwrap();
        assert!(matches!(
            rx.recv_timeout(std::time::Duration::from_secs(3)).unwrap(),
            Notice::Skipped
        ));
        settings.lock().unwrap().images = true;
        settings.lock().unwrap().text = true;
        super::super::copy_screenshot_text("Synthetic screenshot OCR\n中文".into()).unwrap();
        match rx.recv_timeout(std::time::Duration::from_secs(3)).unwrap() {
            Notice::Capture(capture) => assert_eq!(
                normalize(capture.raw).unwrap().searchable(),
                "Synthetic screenshot OCR\n中文"
            ),
            _ => panic!("expected screenshot text"),
        }
        let paths = vec![std::env::current_exe()
            .unwrap()
            .to_string_lossy()
            .into_owned()];
        let files = Content::Files {
            paths: paths.clone(),
        };
        write_impl(&files, false, false, false).unwrap();
        match rx.recv_timeout(std::time::Duration::from_secs(3)).unwrap() {
            Notice::Capture(capture) => match normalize(capture.raw).unwrap() {
                Content::Files { paths: captured } => assert_eq!(captured, paths),
                _ => panic!("expected file paths"),
            },
            _ => panic!("expected file capture"),
        }
        unsafe {
            let _guard = open(HWND::default()).unwrap();
            assert_eq!(
                bytes(RegisterClipboardFormatW(w!("Preferred DropEffect")), 16).unwrap(),
                1u32.to_le_bytes()
            );
        }
        settings.lock().unwrap().text = true;
        write_impl(&files, false, true, false).unwrap();
        match rx.recv_timeout(std::time::Duration::from_secs(3)).unwrap() {
            Notice::Capture(capture) => assert!(matches!(
                normalize(capture.raw).unwrap(),
                Content::Text { .. }
            )),
            _ => panic!("expected paths as text"),
        }
        generation.fetch_add(1, Ordering::SeqCst);
        monitor.stop();
        super::super::copy_screenshot_image(png, 4, 3).unwrap();
        assert!(rx
            .recv_timeout(std::time::Duration::from_millis(100))
            .is_err());
    }
    #[test]
    fn rejects_malformed_and_oversized_images_without_allocating_pixels() {
        assert!(normalize(RawContent::Dib(vec![0; 39])).is_err());
        assert!(normalize(RawContent::Png(vec![1, 2, 3])).is_err());
        let mut dib = vec![0; 40];
        dib[..4].copy_from_slice(&40u32.to_le_bytes());
        dib[4..8].copy_from_slice(&100000u32.to_le_bytes());
        dib[8..12].copy_from_slice(&100000u32.to_le_bytes());
        dib[12] = 1;
        dib[14] = 32;
        assert!(normalize(RawContent::Dib(dib)).is_err());
    }
    #[test]
    fn png_roundtrip_preserves_dimensions_and_alpha() {
        let image = image::RgbaImage::from_pixel(3, 2, image::Rgba([10, 20, 30, 128]));
        let mut png = std::io::Cursor::new(Vec::new());
        image.write_to(&mut png, image::ImageFormat::Png).unwrap();
        match normalize(RawContent::Png(png.into_inner())).unwrap() {
            Content::Image { png, width, height } => {
                assert_eq!((width, height), (3, 2));
                assert_eq!(
                    image::load_from_memory(&png)
                        .unwrap()
                        .into_rgba8()
                        .get_pixel(0, 0)[3],
                    128
                );
            }
            _ => panic!(),
        }
    }
}

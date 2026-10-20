use super::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
mod capture;
mod feedback;
mod history_actions;
mod history_menu;
mod ocr;
mod window_visibility;

const MAX_PIXELS: u64 = 32_000_000;
const MAX_BYTES: usize = 32 * 1024 * 1024;
const HISTORY_BYTES: usize = 64 * 1024 * 1024;
const CAPTURE_LABEL: &str = "screenshot-capture";
const HISTORY_LABEL: &str = "screenshot-history";

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}
#[derive(Clone, Serialize)]
pub(crate) struct Desktop {
    bounds: Rect,
    windows: Vec<Rect>,
    monitors: Vec<Rect>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct Preferences {
    shortcut: Option<String>,
    history: bool,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            shortcut: Some("Alt+Q".into()),
            history: false,
        }
    }
}
#[derive(Clone)]
struct Shot {
    id: u64,
    png: Arc<Vec<u8>>,
    width: u32,
    height: u32,
    time: u64,
}
struct Session {
    id: u64,
    desktop: Desktop,
    png: Vec<u8>,
    restore: Vec<HiddenWindow>,
    ready: bool,
}
#[derive(Default)]
pub(crate) struct ScreenshotState {
    inner: Mutex<Inner>,
    starting: AtomicBool,
    sequence: AtomicU64,
    work: AtomicBool,
    history_hidden: AtomicBool,
    history_adjusting: AtomicBool,
    history_reduced_motion: AtomicBool,
    history_drag_revision: AtomicU64,
    history_transition: tokio::sync::Mutex<()>,
    menu_transition: tokio::sync::Mutex<()>,
    feedback_pending: Mutex<Option<feedback::Pending>>,
    feedback_revision: AtomicU64,
    feedback_timer: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}
#[derive(Default)]
struct Inner {
    session: Option<Session>,
    viewers: HashMap<String, Shot>,
    context: serde_json::Value,
    history_anchor: Option<Rect>,
    history_expanded: bool,
    history_bounds: Option<Rect>,
    history_menu: Option<history_menu::MenuSession>,
    registered: Option<String>,
    shortcut_error: Option<String>,
}
fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}
fn preferences_path() -> Result<std::path::PathBuf, String> {
    Ok(toolknit_app_data_dir()?.join("quick-screenshot.json"))
}
fn preferences() -> Preferences {
    preferences_path()
        .ok()
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}
fn store_preferences(p: &Preferences) -> Result<(), String> {
    let path = preferences_path()?;
    std::fs::create_dir_all(path.parent().ok_or("screenshot:storage-failed")?)
        .map_err(|_| "screenshot:storage-failed")?;
    std::fs::write(
        path,
        serde_json::to_vec(p).map_err(|_| "screenshot:storage-failed")?,
    )
    .map_err(|_| "screenshot:storage-failed".into())
}
fn check_pixels(width: u32, height: u32) -> Result<(), String> {
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > MAX_PIXELS {
        Err("screenshot:image-too-large".into())
    } else {
        Ok(())
    }
}
fn image_dimensions(bytes: &[u8]) -> Result<(u32, u32), String> {
    let reader = image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| "screenshot:invalid-image")?;
    let dimensions = reader
        .into_dimensions()
        .map_err(|_| "screenshot:invalid-image")?;
    check_pixels(dimensions.0, dimensions.1)?;
    Ok(dimensions)
}
fn decode(bytes: &[u8]) -> Result<image::DynamicImage, String> {
    if bytes.len() > MAX_BYTES {
        return Err("screenshot:image-too-large".into());
    }
    image_dimensions(bytes)?;
    image::load_from_memory(bytes).map_err(|_| "screenshot:invalid-image".into())
}
fn png_from_data(value: &serde_json::Value) -> Result<Vec<u8>, String> {
    let data = value.as_str().ok_or("screenshot:invalid-image")?;
    if data.len() > MAX_BYTES * 4 / 3 + 128 {
        return Err("screenshot:image-too-large".into());
    }
    let encoded = data
        .strip_prefix("data:image/png;base64,")
        .ok_or("screenshot:invalid-image")?;
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| "screenshot:invalid-image")?;
    if bytes.len() > MAX_BYTES || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("screenshot:invalid-image".into());
    }
    image_dimensions(&bytes)?;
    Ok(bytes)
}
fn shot_json(shot: &Shot, full: bool) -> serde_json::Value {
    let mut value =
        serde_json::json!({"id":shot.id,"width":shot.width,"height":shot.height,"time":shot.time});
    if full {
        value["image"] = format!(
            "data:image/png;base64,{}",
            STANDARD.encode(shot.png.as_slice())
        )
        .into();
    }
    value
}
fn window_builder<'a>(
    app: &'a tauri::AppHandle,
    label: &str,
    role: &str,
) -> Result<WebviewWindowBuilder<'a, tauri::Wry, tauri::AppHandle>, String> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|_| "screenshot:window-failed")?
        .join(format!("{label}-webview"));
    Ok(WebviewWindowBuilder::new(
        app,
        label,
        WebviewUrl::App(format!("screenshot.html?role={role}").into()),
    )
    .title("ToolKnit Screenshot")
    .decorations(false)
    .visible(false)
    .devtools(false)
    .data_directory(directory))
}

fn validate_shortcut(value: &str) -> Result<Shortcut, String> {
    use tauri_plugin_global_shortcut::Modifiers;
    let shortcut: Shortcut = value.parse().map_err(|_| "screenshot:shortcut-invalid")?;
    if !shortcut
        .mods
        .intersects(Modifiers::ALT | Modifiers::CONTROL | Modifiers::SUPER)
    {
        return Err("screenshot:shortcut-invalid".into());
    }
    Ok(shortcut)
}
pub(crate) fn register_shortcut(app: &tauri::AppHandle, value: Option<&str>) -> Result<(), String> {
    let state = app.state::<ScreenshotState>();
    let previous = lock(&state.inner).registered.clone();
    if previous.as_deref() == value {
        return Ok(());
    }
    if let Some(value) = value {
        validate_shortcut(value)?;
        if app.global_shortcut().is_registered(value) {
            return Err("screenshot:shortcut-conflict".into());
        }
        app.global_shortcut()
            .on_shortcut(value, |app, _, event| {
                if event.state == ShortcutState::Pressed {
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(error) = begin(&app).await {
                            if let Some(main) = app.get_webview_window("main") {
                                let _ = main.emit("screenshot-error", error);
                            }
                        }
                    });
                }
            })
            .map_err(|_| "screenshot:shortcut-conflict")?;
    }
    if let Some(old) = previous.as_deref() {
        if app.global_shortcut().unregister(old).is_err() {
            if let Some(new) = value {
                let _ = app.global_shortcut().unregister(new);
            }
            return Err("screenshot:shortcut-failed".into());
        }
    }
    let mut inner = lock(&state.inner);
    inner.registered = value.map(str::to_string);
    inner.shortcut_error = None;
    Ok(())
}
pub(crate) fn initialize(app: &tauri::AppHandle) {
    let p = preferences();
    if let Err(e) = register_shortcut(app, p.shortcut.as_deref()) {
        lock(&app.state::<ScreenshotState>().inner).shortcut_error = Some(e);
    }
    // The main renderer supplies theme/language context before restoring the shelf.
}
pub(crate) async fn begin(app: &tauri::AppHandle) -> Result<(), String> {
    feedback::dismiss(app).await?;
    history_menu::dismiss(app, false);
    let state = app.state::<ScreenshotState>();
    if state.starting.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let result = async {
        if lock(&state.inner).session.is_some() {
            if let Some(window) = app.get_webview_window(CAPTURE_LABEL) {
                let _ = window.set_focus();
            }
            return Ok(());
        }
        let mut restore = RestoreWindows {
            app: app.clone(),
            labels: Vec::new(),
        };
        for (label, w) in app.webview_windows() {
            if label == "main"
                || label.starts_with("screenshot-")
                || label == "color-picker-overlay"
            {
                if w.is_visible().unwrap_or(false) {
                    let minimized = w.is_minimized().map_err(|_| "screenshot:window-failed")?;
                    window_visibility::hide(&w).await?;
                    restore.labels.push(HiddenWindow { label, minimized });
                }
            }
        }
        // Let the desktop compositor remove our surfaces before freezing pixels.
        tokio::time::sleep(std::time::Duration::from_millis(160)).await;
        let captured = tauri::async_runtime::spawn_blocking(capture::capture)
            .await
            .map_err(|_| "screenshot:capture-failed")?;
        let (mut desktop, png) = captured?;
        if png.len() > MAX_BYTES {
            return Err("screenshot:image-too-large".into());
        }
        desktop.monitors = app
            .available_monitors()
            .map_err(|_| "screenshot:window-failed")?
            .iter()
            .map(|m| {
                let area = m.work_area();
                Rect {
                    x: area.position.x,
                    y: area.position.y,
                    width: area.size.width,
                    height: area.size.height,
                }
            })
            .collect();
        let bounds = desktop.bounds.clone();
        let session = state.sequence.fetch_add(1, Ordering::SeqCst) + 1;
        lock(&state.inner).session = Some(Session {
            id: session,
            desktop,
            png,
            restore: std::mem::take(&mut restore.labels),
            ready: false,
        });
        let opened = (|| {
            let window = if let Some(window) = app.get_webview_window(CAPTURE_LABEL) {
                window
            } else {
                window_builder(app, CAPTURE_LABEL, "capture")?
                    .always_on_top(true)
                    .skip_taskbar(true)
                    .shadow(false)
                    .resizable(false)
                    .build()
                    .map_err(|_| "screenshot:window-failed")?
            };
            window
                .set_position(Position::Physical(PhysicalPosition::new(
                    bounds.x, bounds.y,
                )))
                .map_err(|_| "screenshot:window-failed")?;
            window
                .set_size(Size::Physical(PhysicalSize::new(
                    bounds.width,
                    bounds.height,
                )))
                .map_err(|_| "screenshot:window-failed")?;
            let _ = window.emit("screenshot-opened", session);
            Ok(())
        })();
        if opened.is_err() {
            finish(app);
        } else {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(20)).await;
                let expired = lock(&app.state::<ScreenshotState>().inner)
                    .session
                    .as_ref()
                    .is_some_and(|s| s.id == session && !s.ready);
                if expired {
                    finish(&app);
                    if let Some(main) = app.get_webview_window("main") {
                        let _ = main.emit("screenshot-error", "screenshot:window-failed");
                    }
                }
            });
        }
        opened
    }
    .await;
    state.starting.store(false, Ordering::SeqCst);
    result
}
pub(crate) fn finish(app: &tauri::AppHandle) {
    let state = app.state::<ScreenshotState>();
    if let Some(window) = app.get_webview_window(CAPTURE_LABEL) {
        let _ = window.emit("screenshot-ended", ());
        let _ = window.hide();
    }
    let previous = lock(&state.inner).session.take();
    if let Some(session) = previous {
        for hidden in session.restore {
            if hidden.label == HISTORY_LABEL && !history_actions::allowed(app) {
                continue;
            }
            if let Some(window) = app.get_webview_window(&hidden.label) {
                let _ = show_without_activation(&window, hidden.minimized);
            }
        }
    }
}
struct RestoreWindows {
    app: tauri::AppHandle,
    labels: Vec<HiddenWindow>,
}
struct HiddenWindow {
    label: String,
    minimized: bool,
}
fn show_without_activation(window: &tauri::WebviewWindow, minimized: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows::Win32::{
            Foundation::HWND,
            UI::WindowsAndMessaging::{
                SetWindowPos, ShowWindow, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER,
                SWP_SHOWWINDOW, SW_SHOWMINNOACTIVE,
            },
        };
        let handle = window.hwnd().map_err(|_| "screenshot:window-failed")?.0 as isize;
        let window_label = window.label().to_string();
        let app_handle = window.app_handle().clone();
        window
            .run_on_main_thread(move || {
                // Restore visibility without taking foreground focus or raising the main window.
                unsafe {
                    if window_label == HISTORY_LABEL && !history_actions::allowed(&app_handle) {
                        return;
                    }
                    if minimized {
                        let _ = ShowWindow(HWND(handle), SW_SHOWMINNOACTIVE);
                    } else {
                        let _ = SetWindowPos(
                            HWND(handle),
                            HWND::default(),
                            0,
                            0,
                            0,
                            0,
                            SWP_NOACTIVATE
                                | SWP_NOZORDER
                                | SWP_NOMOVE
                                | SWP_NOSIZE
                                | SWP_SHOWWINDOW,
                        );
                    }
                }
            })
            .map_err(|_| "screenshot:window-failed".into())
    }
    #[cfg(not(windows))]
    {
        window
            .show()
            .and_then(|_| if minimized { window.minimize() } else { Ok(()) })
            .map_err(|_| "screenshot:window-failed".into())
    }
}
impl Drop for RestoreWindows {
    fn drop(&mut self) {
        for hidden in &self.labels {
            if hidden.label == HISTORY_LABEL && !history_actions::allowed(&self.app) {
                continue;
            }
            if let Some(w) = self.app.get_webview_window(&hidden.label) {
                let _ = show_without_activation(&w, hidden.minimized);
            }
        }
    }
}
pub(crate) fn open_clipboard_image(app: &tauri::AppHandle, png: Vec<u8>) -> Result<(), String> {
    let (width, height) = image_dimensions(&png)?;
    decode(&png)?;
    let state = app.state::<ScreenshotState>();
    let shot = Shot {
        id: state.sequence.fetch_add(1, Ordering::SeqCst) + 1,
        png: Arc::new(png),
        width,
        height,
        time: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
    };
    open_viewer(app, shot)
}
fn open_viewer(app: &tauri::AppHandle, shot: Shot) -> Result<(), String> {
    let label = format!("screenshot-viewer-{}", shot.id);
    if let Some(w) = app.get_webview_window(&label) {
        w.show().map_err(|_| "screenshot:window-failed")?;
        let _ = w.set_focus();
        return Ok(());
    }
    let state = app.state::<ScreenshotState>();
    {
        let mut inner = lock(&state.inner);
        if inner.viewers.len() >= 8
            || inner.viewers.values().map(|s| s.png.len()).sum::<usize>() + shot.png.len()
                > HISTORY_BYTES
        {
            return Err("screenshot:viewer-limit".into());
        }
        inner.viewers.insert(label.clone(), shot);
    }
    let created = window_builder(app, &label, "viewer").and_then(|b| {
        b.inner_size(1000.0, 720.0)
            .min_inner_size(740.0, 420.0)
            .always_on_top(true)
            .build()
            .map_err(|_| "screenshot:window-failed".into())
    });
    match created {
        Ok(w) => {
            let _ = w.show();
            let _ = w.set_focus();
            Ok(())
        }
        Err(e) => {
            lock(&state.inner).viewers.remove(&label);
            Err(e)
        }
    }
}
fn monitor_for(app: &tauri::AppHandle, x: f64, y: f64) -> Result<(Rect, f64), String> {
    let monitors = app
        .available_monitors()
        .map_err(|_| "screenshot:window-failed")?;
    let m = monitors
        .iter()
        .find(|m| {
            x >= m.position().x as f64
                && y >= m.position().y as f64
                && x < m.position().x as f64 + m.size().width as f64
                && y < m.position().y as f64 + m.size().height as f64
        })
        .or_else(|| {
            monitors.iter().min_by(|a, b| {
                let distance = |m: &tauri::Monitor| {
                    let left = m.position().x as f64;
                    let top = m.position().y as f64;
                    let dx = x - x.clamp(left, left + m.size().width as f64);
                    let dy = y - y.clamp(top, top + m.size().height as f64);
                    dx * dx + dy * dy
                };
                distance(a).total_cmp(&distance(b))
            })
        })
        .ok_or("screenshot:window-failed")?;
    let area = m.work_area();
    Ok((
        Rect {
            x: area.position.x,
            y: area.position.y,
            width: area.size.width,
            height: area.size.height,
        },
        m.scale_factor(),
    ))
}
fn history_layout(area: &Rect, scale: f64, anchor: Option<&Rect>, expanded: bool) -> (Rect, Rect) {
    let dimension =
        |logical: f64, limit: u32| (logical * scale).round().min(limit as f64).max(1.0) as u32;
    let mut bubble = Rect {
        x: anchor
            .map(|r| r.x)
            .unwrap_or(area.x + area.width as i32 - (120.0 * scale).round() as i32),
        y: anchor
            .map(|r| r.y)
            .unwrap_or(area.y + area.height as i32 / 2 - (48.0 * scale).round() as i32),
        width: dimension(96.0, area.width),
        height: dimension(96.0, area.height),
    };
    let clamp_x =
        |x: i32, width: u32| x.clamp(area.x, area.x + area.width.saturating_sub(width) as i32);
    let clamp_y =
        |y: i32, height: u32| y.clamp(area.y, area.y + area.height.saturating_sub(height) as i32);
    bubble.x = clamp_x(bubble.x, bubble.width);
    bubble.y = clamp_y(bubble.y, bubble.height);
    if !expanded {
        return (bubble.clone(), bubble);
    }
    let width = dimension(376.0, area.width);
    // Four 156px cards, three 10px gaps, header and shadow padding.
    let height = dimension(760.0, area.height);
    let bounds = Rect {
        x: clamp_x(bubble.x + bubble.width as i32 / 2 - width as i32 / 2, width),
        y: clamp_y(bubble.y, height),
        width,
        height,
    };
    (bubble, bounds)
}
fn dragged_history_anchor(anchor: &Rect, previous: &Rect, x: i32, y: i32) -> Rect {
    Rect {
        x: anchor.x.saturating_add(x.saturating_sub(previous.x)),
        y: anchor.y.saturating_add(y.saturating_sub(previous.y)),
        ..anchor.clone()
    }
}
async fn move_history_window(window: &tauri::WebviewWindow, bounds: Rect) -> Result<(), String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let shelf = window.clone();
    window
        .run_on_main_thread(move || {
            #[cfg(windows)]
            let result = (|| {
                use windows::Win32::{
                    Foundation::HWND,
                    UI::WindowsAndMessaging::{SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER},
                };
                let handle = shelf.hwnd().map_err(|_| "screenshot:window-failed")?;
                // Commit bounds once; the WebView animates content without resizing the OS window.
                unsafe {
                    SetWindowPos(
                        HWND(handle.0 as isize),
                        HWND::default(),
                        bounds.x,
                        bounds.y,
                        bounds.width as i32,
                        bounds.height as i32,
                        SWP_NOACTIVATE | SWP_NOZORDER,
                    )
                }
                .map_err(|_| "screenshot:window-failed".to_string())
            })();
            #[cfg(not(windows))]
            let result = shelf
                .set_size(Size::Physical(PhysicalSize::new(
                    bounds.width,
                    bounds.height,
                )))
                .and_then(|_| {
                    shelf.set_position(Position::Physical(PhysicalPosition::new(
                        bounds.x, bounds.y,
                    )))
                })
                .map_err(|_| "screenshot:window-failed".to_string());
            let _ = sender.send(result);
        })
        .map_err(|_| "screenshot:window-failed")?;
    receiver.await.map_err(|_| "screenshot:window-failed")?
}

fn show_history(app: &tauri::AppHandle) -> Result<(), String> {
    if !history_actions::allowed(app) {
        return Ok(());
    }
    let state = app.state::<ScreenshotState>();
    let w = if let Some(w) = app.get_webview_window(HISTORY_LABEL) {
        w
    } else {
        let p = app
            .cursor_position()
            .map_err(|_| "screenshot:window-failed")?;
        let (area, scale) = monitor_for(app, p.x, p.y)?;
        let (bounds, _) = history_layout(&area, scale, None, false);
        let w = window_builder(app, HISTORY_LABEL, "history")?
            .always_on_top(true)
            .skip_taskbar(true)
            .transparent(true)
            .shadow(false)
            .resizable(false)
            .inner_size(bounds.width as f64 / scale, bounds.height as f64 / scale)
            .position(bounds.x as f64 / scale, bounds.y as f64 / scale)
            .build()
            .map_err(|_| "screenshot:window-failed")?;
        w.set_position(Position::Physical(PhysicalPosition::new(
            bounds.x, bounds.y,
        )))
        .map_err(|_| "screenshot:window-failed")?;
        let events = w.clone();
        w.on_window_event(move |event| {
            if matches!(event, tauri::WindowEvent::Moved(_)) {
                history_actions::moved(&events);
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let app = events.app_handle().clone();
                tauri::async_runtime::spawn(async move {
                    let _ = history_actions::visibility(&app, true).await;
                });
            }
        });
        let mut inner = lock(&state.inner);
        inner.history_anchor = Some(bounds);
        inner.history_expanded = false;
        w
    };
    if lock(&state.inner).session.is_none() {
        show_without_activation(&w, false)?;
    }
    Ok(())
}
pub(crate) fn closed(app: &tauri::AppHandle, label: &str) {
    if label == history_menu::LABEL {
        lock(&app.state::<ScreenshotState>().inner).history_menu = None;
    }
    if label == CAPTURE_LABEL {
        finish(app);
    }
    if label.starts_with("screenshot-viewer-") {
        lock(&app.state::<ScreenshotState>().inner)
            .viewers
            .remove(label);
    }
}

#[tauri::command]
pub(crate) async fn quick_screenshot(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    request: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let action = request["action"]
        .as_str()
        .ok_or("screenshot:invalid-request")?;
    let label = window.label();
    let state = app.state::<ScreenshotState>();
    if label == history_menu::LABEL {
        let token = request["token"].as_u64().unwrap_or(0);
        match action {
            "menu-boot" => return history_menu::boot(&app),
            "menu-ready" => history_menu::ready(&app, &window, token).await?,
            "menu-select" => {
                history_menu::select(&app, token, request["selected"].as_str().unwrap_or(""))?
            }
            "menu-dismiss" => {
                history_menu::dismiss_token(
                    &app,
                    token,
                    request["focusParent"].as_bool().unwrap_or(false),
                )?;
            }
            "metadata" => return Ok(serde_json::json!({"context":lock(&state.inner).context})),
            _ => return Err("screenshot:forbidden".into()),
        }
        return Ok(serde_json::Value::Null);
    }
    if label == feedback::LABEL {
        return match action {
            "boot" => feedback::boot(&app),
            "feedback-ready" => {
                feedback::ready(
                    &app,
                    &window,
                    request["revision"]
                        .as_u64()
                        .ok_or("screenshot:invalid-request")?,
                )?;
                Ok(serde_json::Value::Null)
            }
            _ => Err("screenshot:forbidden".into()),
        };
    }
    let viewer = lock(&state.inner).viewers.contains_key(label);
    if label != "main" && label != CAPTURE_LABEL && label != HISTORY_LABEL && !viewer {
        return Err("screenshot:forbidden".into());
    }
    let main = label == "main";
    match action {
        "prepare-history-menu" if label == HISTORY_LABEL => {
            history_menu::warm(&app).await?;
            Ok(serde_json::Value::Null)
        }
        "feedback" if label == HISTORY_LABEL => {
            feedback::show(
                &app,
                request["kind"]
                    .as_str()
                    .ok_or("screenshot:invalid-request")?,
            )?;
            Ok(serde_json::Value::Null)
        }
        "preferences" if main => {
            let p = preferences();
            let inner = lock(&state.inner);
            Ok(
                serde_json::json!({"shortcut":p.shortcut,"history":p.history,"registered":inner.registered,"error":inner.shortcut_error}),
            )
        }
        "configure" if main => {
            history_menu::dismiss(&app, false);
            let _transition = state.history_transition.lock().await;
            let old_hidden = state.history_hidden.load(Ordering::Acquire);
            let old = preferences();
            let mut p: Preferences = serde_json::from_value(request["preferences"].clone())
                .map_err(|_| "screenshot:invalid-request")?;
            if let Some(s) = &p.shortcut {
                if s.len() > 64 {
                    return Err("screenshot:shortcut-invalid".into());
                }
            }
            p.shortcut = p.shortcut.filter(|v| !v.trim().is_empty());
            register_shortcut(&app, p.shortcut.as_deref())?;
            if let Err(e) = store_preferences(&p) {
                let _ = register_shortcut(&app, old.shortcut.as_deref());
                return Err(e);
            }
            state.history_hidden.store(false, Ordering::Release);
            let updated = if p.history {
                show_history(&app)
            } else if let Some(w) = app.get_webview_window(HISTORY_LABEL) {
                window_visibility::hide(&w).await
            } else {
                Ok(())
            };
            if let Err(e) = updated {
                state.history_hidden.store(old_hidden, Ordering::Release);
                let _ = store_preferences(&old);
                let _ = register_shortcut(&app, old.shortcut.as_deref());
                if !old.history {
                    if let Some(w) = app.get_webview_window(HISTORY_LABEL) {
                        let _ = window_visibility::hide(&w).await;
                    }
                }
                return Err(e);
            }
            let _ = app.emit_to("main", "screenshot-preferences-changed", ());
            Ok(
                serde_json::json!({"shortcut":p.shortcut,"history":p.history,"registered":lock(&state.inner).registered}),
            )
        }
        "context" if main => {
            let context = request["context"].clone();
            if serde_json::to_vec(&context)
                .map_err(|_| "screenshot:invalid-request")?
                .len()
                > 4096
            {
                return Err("screenshot:invalid-request".into());
            }
            // Provider metadata, theme and language only; credentials stay in protected storage.
            let first = lock(&state.inner).context.is_null();
            let next = serde_json::json!({"theme":context["theme"],"lang":context["lang"],"provider":context["provider"],"vision":context["vision"]});
            if lock(&state.inner).context == next {
                return Ok(serde_json::Value::Null);
            }
            lock(&state.inner).context = next;
            for (label, w) in app.webview_windows() {
                if label.starts_with("screenshot-") {
                    let _ = w.emit("screenshot-context-changed", ());
                }
            }
            if first && preferences().history {
                show_history(&app)?;
            }
            Ok(serde_json::Value::Null)
        }
        "start" if main => {
            begin(&app).await?;
            Ok(serde_json::Value::Null)
        }
        "metadata" => Ok(serde_json::json!({"context":lock(&state.inner).context})),
        "navigate" if viewer || label == HISTORY_LABEL => {
            let target = request["target"]
                .as_str()
                .ok_or("screenshot:invalid-request")?;
            match target {
                "website" => open_url("https://toolknit.com".into())?,
                "main" | "settings" | "support" | "help" | "feedback" | "clipboard-history" => {
                    let main_window = app
                        .get_webview_window("main")
                        .ok_or("screenshot:window-failed")?;
                    history_menu::dismiss(&app, false);
                    super::show_main_window(&app);
                    if target != "main" {
                        main_window
                            .emit("screenshot-navigate", target)
                            .map_err(|_| "screenshot:window-failed")?;
                    }
                }
                _ => return Err("screenshot:forbidden".into()),
            }
            Ok(serde_json::Value::Null)
        }
        "boot" => {
            let inner = lock(&state.inner);
            let mut result = serde_json::json!({"context":inner.context,"role": if viewer { "viewer" } else if label == CAPTURE_LABEL { "capture" } else { "history" }});
            if label == CAPTURE_LABEL {
                let session = inner.session.as_ref().ok_or("screenshot:expired")?;
                result["session"] = session.id.into();
                result["desktop"] = serde_json::to_value(&session.desktop)
                    .map_err(|_| "screenshot:capture-failed")?;
                result["image"] =
                    format!("data:image/png;base64,{}", STANDARD.encode(&session.png)).into();
            } else if viewer {
                result["shot"] =
                    shot_json(inner.viewers.get(label).ok_or("screenshot:expired")?, true);
            }
            Ok(result)
        }
        "expand" if label == HISTORY_LABEL => {
            history_menu::dismiss(&app, false);
            let _transition = state.history_transition.lock().await;
            if !history_actions::allowed(&app) {
                window_visibility::hide(&window).await?;
                return Err("screenshot:expired".into());
            }
            state.history_reduced_motion.store(
                request["reducedMotion"].as_bool().unwrap_or(false),
                Ordering::Release,
            );
            let position = window
                .outer_position()
                .map_err(|_| "screenshot:window-failed")?;
            let expanded = request["expanded"].as_bool().unwrap_or(false);
            let size = window
                .outer_size()
                .map_err(|_| "screenshot:window-failed")?;
            let mut anchor = {
                let inner = lock(&state.inner);
                if inner.history_expanded {
                    let anchor = inner
                        .history_anchor
                        .as_ref()
                        .ok_or("screenshot:window-failed")?;
                    let previous = inner
                        .history_bounds
                        .as_ref()
                        .ok_or("screenshot:window-failed")?;
                    dragged_history_anchor(anchor, previous, position.x, position.y)
                } else {
                    Rect {
                        x: position.x,
                        y: position.y,
                        width: size.width,
                        height: size.height,
                    }
                }
            };
            let (area, scale) = monitor_for(
                &app,
                anchor.x as f64 + anchor.width as f64 / 2.0,
                anchor.y as f64 + anchor.height as f64 / 2.0,
            )?;
            let (bubble, bounds) = history_layout(&area, scale, Some(&anchor), expanded);
            anchor = bubble;
            move_history_window(&window, bounds.clone()).await?;
            {
                let mut inner = lock(&state.inner);
                inner.history_anchor = Some(anchor.clone());
                inner.history_expanded = expanded;
                inner.history_bounds = Some(bounds.clone());
            }
            Ok(serde_json::json!({
                "origin": {"x": (anchor.x - bounds.x) as f64 / scale + 48.0,
                           "y": (anchor.y - bounds.y) as f64 / scale + 48.0},
                "width": bounds.width as f64 / scale, "height": bounds.height as f64 / scale
            }))
        }
        "hide-history" if label == HISTORY_LABEL => {
            history_actions::visibility(&app, false).await?;
            Ok(serde_json::Value::Null)
        }
        "close-history" if label == HISTORY_LABEL => {
            history_actions::visibility(&app, true).await?;
            Ok(serde_json::Value::Null)
        }
        "history-menu" if label == HISTORY_LABEL => {
            history_menu::open(&app, &window, &request).await?;
            Ok(serde_json::Value::Null)
        }
        "dismiss-history-menu" if label == HISTORY_LABEL => {
            history_menu::dismiss(&app, false);
            Ok(serde_json::Value::Null)
        }
        "ready" if label == CAPTURE_LABEL => {
            require_session(&state, &request)?;
            window.show().map_err(|_| "screenshot:window-failed")?;
            window.set_focus().map_err(|_| "screenshot:window-failed")?;
            if let Some(session) = lock(&state.inner).session.as_mut() {
                session.ready = true;
            }
            Ok(serde_json::Value::Null)
        }
        "cancel" if label == CAPTURE_LABEL => {
            require_session(&state, &request)?;
            finish(&app);
            Ok(serde_json::Value::Null)
        }
        "copy-text" if label == CAPTURE_LABEL => {
            require_session(&state, &request)?;
            crate::clipboard_history::copy_screenshot_text(
                request["text"]
                    .as_str()
                    .ok_or("screenshot:invalid-request")?
                    .to_string(),
            )?;
            Ok(serde_json::Value::Null)
        }
        "copy" | "confirm" | "pin" | "save" | "ocr" if label == CAPTURE_LABEL || viewer => {
            if label == CAPTURE_LABEL {
                require_session(&state, &request)?;
            }
            if viewer && action != "copy" && action != "save" {
                return Err("screenshot:forbidden".into());
            }
            if state.work.swap(true, Ordering::SeqCst) {
                return Err("screenshot:busy".into());
            }
            let result = async {
                let bytes = if viewer {
                    lock(&state.inner)
                        .viewers
                        .get(label)
                        .ok_or("screenshot:expired")?
                        .png
                        .as_ref()
                        .clone()
                } else {
                    png_from_data(&request["image"])?
                };
                let (width, height) = image_dimensions(&bytes)?;
                if action == "ocr" {
                    let language = match request.get("language").and_then(|v| v.as_str()) {
                        Some("zh") => Some("zh".to_string()),
                        Some("en") => Some("en".to_string()),
                        None => None,
                        _ => return Err("screenshot:invalid-request".into()),
                    };
                    return tauri::async_runtime::spawn_blocking(move || {
                        ocr::recognize_with_language(bytes, language)
                    })
                    .await
                    .map_err(|_| "screenshot:ocr-failed")?;
                }
                if action == "save" {
                    let directory = request["directory"]
                        .as_str()
                        .ok_or("screenshot:invalid-request")?
                        .to_string();
                    let jpeg = request["format"].as_str() == Some("jpg");
                    let extension = if jpeg { "jpg" } else { "png" };
                    let filename = format!(
                        "ToolKnit_{}.{extension}",
                        std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis()
                    );
                    let path = tauri::async_runtime::spawn_blocking(move || {
                        let image = decode(&bytes)?;
                        let mut encoded = std::io::Cursor::new(Vec::new());
                        image
                            .to_rgb8()
                            .write_to(
                                &mut encoded,
                                if jpeg {
                                    image::ImageFormat::Jpeg
                                } else {
                                    image::ImageFormat::Png
                                },
                            )
                            .map_err(|_| "screenshot:save-failed")?;
                        write_unique_file_bytes(directory, filename, encoded.into_inner())
                    })
                    .await
                    .map_err(|_| "screenshot:save-failed")??;
                    return Ok(path.into());
                }
                let copied = bytes.clone();
                if label == CAPTURE_LABEL {
                    require_session(&state, &request)?;
                }
                tauri::async_runtime::spawn_blocking(move || {
                    crate::clipboard_history::copy_screenshot_image(copied, width, height)
                })
                .await
                .map_err(|_| "screenshot:copy-failed")??;
                if action == "confirm" || action == "pin" {
                    require_session(&state, &request)?;
                    if preferences().history {
                        let history_app = app.clone();
                        let history_png = bytes.clone();
                        let result = tauri::async_runtime::spawn_blocking(move || {
                            crate::clipboard_history::record_explicit_screenshot(
                                &history_app,
                                history_png,
                                width,
                                height,
                            )
                        })
                        .await;
                        if let Err(error) =
                            result.unwrap_or_else(|_| Err("clipboard:worker-failed".into()))
                        {
                            let _ = app.emit_to(HISTORY_LABEL, "clipboard-history-changed", 0u64);
                            let _ = app.emit_to("main", "screenshot-error", error);
                        }
                        require_session(&state, &request)?;
                    }
                    let id = state.sequence.fetch_add(1, Ordering::SeqCst) + 1;
                    let shot = Shot {
                        id,
                        png: Arc::new(bytes),
                        width,
                        height,
                        time: std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis() as u64,
                    };
                    if action == "pin" {
                        open_viewer(&app, shot.clone())?;
                    }
                    finish(&app);
                    if preferences().history {
                        show_history(&app)?;
                    }
                    if action == "pin" {
                        if let Some(w) =
                            app.get_webview_window(&format!("screenshot-viewer-{}", shot.id))
                        {
                            let _ = w.set_focus();
                        }
                    }
                }
                Ok(serde_json::Value::Null)
            }
            .await;
            state.work.store(false, Ordering::SeqCst);
            result
        }
        _ => Err("screenshot:forbidden".into()),
    }
}
pub(super) fn require_session(
    state: &ScreenshotState,
    request: &serde_json::Value,
) -> Result<(), String> {
    if lock(&state.inner).session.as_ref().map(|s| s.id) != request["session"].as_u64() {
        Err("screenshot:expired".into())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn screenshot_viewer_keeps_original() {
        let mut bytes = std::io::Cursor::new(Vec::new());
        image::RgbImage::new(1200, 720)
            .write_to(&mut bytes, image::ImageFormat::Png)
            .unwrap();
        let shot = Shot {
            id: 1,
            png: Arc::new(bytes.into_inner()),
            width: 1200,
            height: 720,
            time: 0,
        };
        let clone = shot.clone();
        let original = png_from_data(&shot_json(&clone, true)["image"]).unwrap();
        assert_eq!(original, *shot.png);
        assert_eq!(image_dimensions(&original).unwrap(), (1200, 720));
    }
    #[test]
    fn screenshot_dimensions_are_bounded() {
        assert!(check_pixels(0, 10).is_err());
        assert!(check_pixels(u32::MAX, u32::MAX).is_err());
        assert!(check_pixels(3840, 2160).is_ok());
    }
    #[test]
    fn screenshot_rejects_non_png_and_oversize_headers() {
        assert!(png_from_data(&serde_json::json!("https://example.com/private.png")).is_err());
        assert!(png_from_data(&serde_json::json!("data:image/png;base64,SGVsbG8=")).is_err());
        let mut bytes = std::io::Cursor::new(Vec::new());
        image::RgbImage::new(2, 3)
            .write_to(&mut bytes, image::ImageFormat::Png)
            .unwrap();
        let valid = serde_json::json!(format!(
            "data:image/png;base64,{}",
            STANDARD.encode(bytes.into_inner())
        ));
        assert_eq!(
            image_dimensions(&png_from_data(&valid).unwrap()).unwrap(),
            (2, 3)
        );
    }
    #[test]
    fn screenshot_defaults_are_opt_in_history() {
        let p = Preferences::default();
        assert_eq!(p.shortcut.as_deref(), Some("Alt+Q"));
        assert!(!p.history);
    }
    #[test]
    fn screenshot_history_returns_to_dragged_anchor() {
        let area = Rect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        };
        for (x, y) in [(40, 40), (900, 400), (1800, 970)] {
            let dragged = Rect {
                x,
                y,
                width: 96,
                height: 96,
            };
            let (anchor, panel) = history_layout(&area, 1.0, Some(&dragged), true);
            assert_eq!((anchor.x, anchor.y), (x, y));
            assert_eq!((panel.width, panel.height), (376, 760));
            assert!(anchor.x >= panel.x && anchor.y >= panel.y);
            assert!(anchor.x + 96 <= panel.x + 376 && anchor.y + 96 <= panel.y + 760);
            let (_, collapsed) = history_layout(&area, 1.0, Some(&anchor), false);
            assert_eq!(
                (collapsed.x, collapsed.y, collapsed.width, collapsed.height),
                (x, y, 96, 96)
            );
        }
    }
    #[test]
    fn screenshot_history_panel_drag_moves_collapsed_bubble() {
        for scale in [1.0, 1.25, 1.5, 2.0] {
            let area = Rect {
                x: -2560,
                y: -240,
                width: 2560,
                height: 1440,
            };
            let start = Rect {
                x: -1200,
                y: 100,
                width: 96,
                height: 96,
            };
            let (anchor, panel) = history_layout(&area, scale, Some(&start), true);
            for (dx, dy) in [(-120, 60), (250, -80), (2000, 2000)] {
                let moved = dragged_history_anchor(&anchor, &panel, panel.x + dx, panel.y + dy);
                assert_eq!((moved.x, moved.y), (anchor.x + dx, anchor.y + dy));
                let (bubble, collapsed) = history_layout(&area, scale, Some(&moved), false);
                let (reopened, _) = history_layout(&area, scale, Some(&bubble), true);
                assert_eq!((collapsed.x, collapsed.y), (reopened.x, reopened.y));
                assert!(collapsed.x >= area.x && collapsed.y >= area.y);
                assert!(collapsed.x + collapsed.width as i32 <= area.x + area.width as i32);
                assert!(collapsed.y + collapsed.height as i32 <= area.y + area.height as i32);
            }
        }
    }
    #[test]
    fn screenshot_history_stays_inside_work_area_at_every_dpi() {
        for scale in [1.0, 1.25, 1.5, 2.0] {
            let area = Rect {
                x: -2560,
                y: -240,
                width: 2560,
                height: 1360,
            };
            for (x, y) in [(-2500, -200), (-1, 1100), (-3000, -1000), (4000, 3000)] {
                let dragged = Rect {
                    x,
                    y,
                    width: 96,
                    height: 96,
                };
                let (collapsed, expanded) = history_layout(&area, scale, Some(&dragged), true);
                assert_eq!(collapsed.width, (96.0 * scale).round() as u32);
                assert_eq!(expanded.width, (376.0 * scale).round() as u32);
                for bounds in [collapsed, expanded] {
                    assert!(bounds.x >= area.x && bounds.y >= area.y);
                    assert!(bounds.x + bounds.width as i32 <= area.x + area.width as i32);
                    assert!(bounds.y + bounds.height as i32 <= area.y + area.height as i32);
                }
            }
        }
        let small = Rect {
            x: 0,
            y: 0,
            width: 200,
            height: 180,
        };
        let (bubble, panel) = history_layout(&small, 2.0, None, true);
        assert_eq!((panel.width, panel.height), (200, 180));
        assert!(bubble.width <= small.width && bubble.height <= small.height);
    }
    #[test]
    fn screenshot_shortcuts_require_a_modifier() {
        assert!(validate_shortcut("Alt+Q").is_ok());
        assert!(validate_shortcut("Ctrl+Shift+Q").is_ok());
        assert!(validate_shortcut("Q").is_err());
        assert!(validate_shortcut("Shift+Q").is_err());
        assert!(validate_shortcut("Alt+Unknown").is_err());
    }
    #[cfg(windows)]
    #[test]
    #[ignore = "Requires an interactive Windows desktop; pixels stay in memory"]
    fn screenshot_native_capture_smoke() {
        let (desktop, bytes) = capture::capture().unwrap();
        let image = decode(&bytes).unwrap().to_rgba8();
        assert_eq!(
            image.dimensions(),
            (desktop.bounds.width, desktop.bounds.height)
        );
        assert!(!desktop.windows.is_empty());
        assert!(image.pixels().all(|p| p.0[3] == 255));
        let first = image.get_pixel(0, 0);
        assert!(
            image.pixels().any(|p| p != first),
            "Captured surface must contain pixels"
        );
    }
    #[cfg(windows)]
    #[test]
    #[ignore = "Requires installed Windows OCR languages and a synthetic fixture"]
    fn screenshot_native_ocr_smoke() {
        let fixture = std::env::var("TOOLKNIT_SCREENSHOT_OCR_FIXTURE")
            .expect("Synthetic OCR fixture required");
        let result = ocr::recognize(std::fs::read(fixture).unwrap()).unwrap();
        let text = result["text"].as_str().unwrap().to_uppercase();
        assert!(
            text.contains("SCREENSHOT") && text.contains("TEST"),
            "Synthetic OCR words missing"
        );
        assert!(result["lines"].as_array().unwrap().iter().all(|line| {
            line["width"].as_f64().unwrap() > 0.0 && line["height"].as_f64().unwrap() > 0.0
        }));
    }
    #[test]
    fn screenshot_late_operations_are_rejected() {
        assert!(require_session(
            &ScreenshotState::default(),
            &serde_json::json!({"session":1})
        )
        .is_err());
    }
}

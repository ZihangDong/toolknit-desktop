#[tauri::command]
pub(crate) async fn hide_main_window(window: tauri::Window) -> Result<(), String> {
    if window.label() != "main" {
        return Err("window:main-only".into());
    }
    platform::window_visibility::hide(&window).await
}

/// Read the installer language at startup (from install_lang.txt).
/// Returns "zh" or "en", defaulting to "zh" on any error.
pub(crate) fn read_initial_lang() -> String {
    let exe = match std::env::current_exe() {
        Ok(e) => e,
        Err(_) => return "zh".to_string(),
    };
    let dir = match exe.parent() {
        Some(d) => d,
        None => return "zh".to_string(),
    };
    let lang_file = dir.join("install_lang.txt");
    match std::fs::read_to_string(&lang_file) {
        Ok(content) => match content.trim().parse::<u32>() {
            Ok(2052) => "zh".to_string(),
            _ => "en".to_string(),
        },
        Err(_) => "zh".to_string(),
    }
}

/// Build the tray menu with labels in the given language.
pub(crate) fn build_tray_menu(
    app: &tauri::AppHandle,
    lang: &str,
) -> Result<tauri::menu::Menu<tauri::Wry>, tauri::Error> {
    let (show_text, quit_text) = if lang == "zh" {
        (
            "\u{663e}\u{793a}\u{4e3b}\u{7a0b}\u{5e8f}",
            "\u{9000}\u{51fa} ToolKnit",
        )
    } else {
        ("Show ToolKnit", "Quit ToolKnit")
    };
    let show_i = tauri::menu::MenuItem::with_id(app, "show", show_text, true, None::<&str>)?;
    let quit_i = tauri::menu::MenuItem::with_id(app, "quit", quit_text, true, None::<&str>)?;
    let active = app.state::<crate::clipboard_history::ClipboardHistoryState>().enabled();
    let clipboard_label = crate::clipboard_history::tray_label(lang, active);
    let clipboard_i = tauri::menu::CheckMenuItem::with_id(app, "clipboard-toggle", clipboard_label, true, active, None::<&str>)?;
    app.state::<crate::clipboard_history::ClipboardHistoryState>().register_tray(clipboard_i.clone(), lang);
    let startup_i = tauri::menu::CheckMenuItem::with_id(app, "autostart-toggle", if lang == "zh" { "开机自启动" } else { "Start with Windows" }, true, false, None::<&str>)?;
    if register_autostart_tray(app, startup_i.clone()).is_err() {
        let _ = startup_i.set_enabled(false);
        log::warn!("Unable to read Windows startup setting");
    }
    tauri::menu::Menu::with_items(app, &[&show_i, &clipboard_i, &startup_i, &quit_i])
}

#[tauri::command]
pub(crate) fn set_tray_lang(app: tauri::AppHandle, lang: String) -> Result<(), String> {
    let menu = build_tray_menu(&app, &lang).map_err(|e| e.to_string())?;
    if let Some(tray) = app.tray_by_id("main-tray") {
        tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Clears the legacy binary Win32 clipping region before the webview applies
/// its alpha-antialiased CSS window mask. GDI regions contain only fully on or
/// fully off pixels, which makes rounded corners visibly stair-step.
#[cfg(target_os = "windows")]
pub(crate) fn apply_native_window_corner_radius(
    window: &tauri::WebviewWindow,
    _logical_radius: u32,
) -> Result<(), String> {
    use windows::Win32::{
        Foundation::{BOOL, HWND},
        Graphics::Gdi::{SetWindowRgn, HRGN},
    };

    let tauri_hwnd = window.hwnd().map_err(|error| error.to_string())?;
    let hwnd = HWND(tauri_hwnd.0 as isize);
    let result = unsafe { SetWindowRgn(hwnd, HRGN::default(), BOOL(1)) };
    if result == 0 {
        return Err(format!(
            "Unable to clear the native window clipping region: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn apply_native_window_corner_radius(
    _window: &tauri::WebviewWindow,
    _logical_radius: u32,
) -> Result<(), String> {
    // Keep the command available on other desktop platforms. Their native
    // window systems either supply their own rounded corners or use CSS only.
    Ok(())
}

#[tauri::command]
pub(crate) async fn set_window_corner_radius(
    window: tauri::WebviewWindow,
    radius: u32,
    shadow: Option<bool>,
    state: tauri::State<'_, WindowCornerRadiusState>,
) -> Result<(), String> {
    // The configured radius belongs to the primary application window. In
    // particular, the full-screen screen picker must stay rectangular so it
    // can cover the whole virtual desktop and receive pointer input at every
    // edge.
    if window.label() != "main" {
        return Ok(());
    }
    let radius = radius.min(MAX_WINDOW_CORNER_RADIUS);
    // The shadow HWND and subclass must be owned by the main UI thread. Never
    // hold the radius mutex across Win32 calls that can reenter window events.
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let target = window.clone();
    window.run_on_main_thread(move || {
        let result = (|| {
            apply_native_window_corner_radius(&target, radius)?;
            #[cfg(target_os = "windows")]
            {
                let hwnd = target.hwnd().map_err(|e| e.to_string())?;
                platform::window_shadow::configure(windows::Win32::Foundation::HWND(hwnd.0 as isize), radius, shadow)?;
            }
            #[cfg(not(target_os = "windows"))]
            let _ = shadow;
            Ok::<(), String>(())
        })();
        let _ = sender.send(result);
    }).map_err(|e| e.to_string())?;
    receiver.await.map_err(|_| "Window surface update was cancelled".to_string())??;
    *state.radius.lock().map_err(|_| "Window corner radius state is unavailable".to_string())? = radius;
    Ok(())
}

pub(crate) fn reapply_native_window_corner_radius(window: &tauri::WebviewWindow) {
    let state = window.state::<WindowCornerRadiusState>();
    let radius = match state.radius.lock() {
        Ok(radius) => *radius,
        Err(_) => return,
    };
    if radius > 0 {
        // Window resize notifications cannot be surfaced to the user. The next
        // setting change will still report an error if the native API fails.
        let _ = apply_native_window_corner_radius(window, radius);
    }
}

pub(crate) fn schedule_native_window_corner_radius_reapply(window: tauri::WebviewWindow) {
    reapply_native_window_corner_radius(&window);

    // Resizing emits a stream of native events. Keep the corner region current
    // immediately, then do one trailing repair after Windows has settled.
    // Older generations become no-ops, so a drag cannot accumulate hundreds
    // of delayed GDI updates in the background.
    let state = window.state::<WindowCornerRadiusState>();
    let generation = state
        .reapply_generation
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        .saturating_add(1);
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(180)).await;
        let state = window.state::<WindowCornerRadiusState>();
        if state
            .reapply_generation
            .load(std::sync::atomic::Ordering::Relaxed)
            == generation
        {
            reapply_native_window_corner_radius(&window);
        }
    });
}

/// Fit the first window to the monitor work area rather than assuming the
/// developer's screen. The values are logical pixels, so Windows DPI scaling
/// is accounted for before the native minimum size is applied.
pub(crate) fn fit_main_window_to_work_area(window: &tauri::WebviewWindow) -> Result<(), String> {
    let monitor = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .or(
            window
                .primary_monitor()
                .map_err(|error| error.to_string())?,
        );
    let Some(monitor) = monitor else {
        return Ok(());
    };

    let scale_factor = monitor.scale_factor().max(0.1);
    let work_area = monitor.work_area().size;
    let usable_width = ((work_area.width as f64 / scale_factor) - MAIN_WINDOW_SAFE_MARGIN).max(480.0);
    let usable_height = ((work_area.height as f64 / scale_factor) - MAIN_WINDOW_SAFE_MARGIN).max(360.0);
    let min_width = MAIN_WINDOW_MIN_WIDTH.min(usable_width).max(480.0);
    let min_height = MAIN_WINDOW_MIN_HEIGHT.min(usable_height).max(360.0);
    let max_width = MAIN_WINDOW_MAX_WIDTH.min(usable_width).max(min_width);
    let max_height = MAIN_WINDOW_MAX_HEIGHT.min(usable_height).max(min_height);
    let width = (usable_width * 0.84).round().clamp(min_width, max_width);
    let height = (usable_height * 0.88).round().clamp(min_height, max_height);

    window
        .set_min_size(Some(Size::Logical(LogicalSize::new(min_width, min_height))))
        .map_err(|error| error.to_string())?;
    window
        .set_max_size(None::<Size>)
        .map_err(|error| error.to_string())?;
    window
        .set_size(Size::Logical(LogicalSize::new(width, height)))
        .map_err(|error| error.to_string())?;
    window.center().map_err(|error| error.to_string())?;
    Ok(())
}

pub(crate) fn validate_external_url(url: &str) -> Result<url::Url, String> {
    platform::security::validate_external_url(url)
}

pub(crate) fn allow_webview_navigation(url: &url::Url) -> bool {
    platform::security::allow_webview_navigation(url)
}

#[tauri::command]
pub(crate) fn open_url(url: String) -> Result<(), String> {
    let parsed = validate_external_url(&url)?;
    opener::open(parsed.as_str()).map_err(|error| format!("Failed to open URL: {}", error))
}

#[tauri::command]
pub(crate) fn get_documents_dir() -> Result<String, String> {
    let dir = dirs::document_dir().ok_or("Cannot find Documents folder")?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub(crate) fn get_download_dir() -> Result<String, String> {
    let dir = dirs::download_dir().ok_or("Cannot find Downloads folder")?;
    Ok(dir.to_string_lossy().to_string())
}

#[derive(serde::Serialize, serde::Deserialize, Default)]
pub(crate) struct OutputRootConfig {
    pub(crate) output_root: Option<String>,
}

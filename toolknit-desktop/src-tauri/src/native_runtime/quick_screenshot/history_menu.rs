use super::*;

pub(super) const LABEL: &str = "screenshot-history-menu";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct MenuSession {
    token: u64,
    entry_id: Option<i64>,
    kind: String,
    expanded: bool,
    recording: bool,
    ready: bool,
    #[serde(skip)]
    trigger: Option<Rect>,
}

impl MenuSession {
    fn restore_parent_after(action: &str) -> bool {
        !matches!(action, "main" | "open" | "hide" | "close")
    }
    fn toggled_by(&self, request: &serde_json::Value) -> bool {
        request["toggle"].as_bool() == Some(true) && self.entry_id.is_none()
    }
    fn permits(&self, token: u64, action: &str) -> bool {
        self.token == token
            && match (self.entry_id, action) {
                (Some(_), "copy" | "view" | "delete") => true,
                (Some(_), "note") => self.kind != "phrase",
                (Some(_), "phrase-add") => self.kind == "text",
                (Some(_), "phrase-edit") => self.kind == "phrase",
                (None, "toggle" | "main" | "open" | "monitor" | "hide" | "close") => true,
                _ => false,
            }
    }
}

fn bounds(area: &Rect, scale: f64, x: i32, y: i32, kind: &str) -> Rect {
    let width = (304.0 * scale).round().min(area.width as f64) as u32;
    let height = (match kind {
        "phrase" | "image" | "files" => 214.0,
        "text" => 252.0,
        _ => 286.0,
    } * scale)
        .round()
        .min(area.height as f64) as u32;
    history_actions::clamped(
        area,
        &Rect {
            x,
            y,
            width,
            height,
        },
    )
}

pub(super) fn dismiss(app: &tauri::AppHandle, focus_parent: bool) {
    lock(&app.state::<ScreenshotState>().inner).history_menu = None;
    hide_dismissed(app, focus_parent);
}

fn lost_focus(window: &tauri::WebviewWindow) {
    let app = window.app_handle();
    let pending = lock(&app.state::<ScreenshotState>().inner)
        .history_menu
        .clone();
    // Windows sends blur before the parent's click. Retain this token briefly only
    // when that click is on the same toggle, so it closes instead of reopening.
    let on_trigger = pending
        .as_ref()
        .and_then(|menu| menu.trigger.as_ref())
        .is_some_and(|rect| {
            app.cursor_position().is_ok_and(|p| {
                p.x >= rect.x as f64
                    && p.y >= rect.y as f64
                    && p.x < rect.x as f64 + rect.width as f64
                    && p.y < rect.y as f64 + rect.height as f64
            })
        });
    if on_trigger {
        if let Some(menu) = pending {
            let _ = window.hide();
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(600)).await;
                let _ = dismiss_token(&app, menu.token, false);
            });
            return;
        }
    }
    dismiss(app, false);
}

fn hide_dismissed(app: &tauri::AppHandle, focus_parent: bool) {
    let host = app.clone();
    let _ = app.run_on_main_thread(move || {
        if lock(&host.state::<ScreenshotState>().inner)
            .history_menu
            .is_some()
        {
            return;
        }
        if let Some(window) = host.get_webview_window(LABEL) {
            let _ = window.hide();
        }
        if focus_parent && history_actions::allowed(&host) {
            if let Some(parent) = host.get_webview_window(HISTORY_LABEL) {
                if parent.is_visible().unwrap_or(false) {
                    let _ = parent.set_focus();
                }
            }
        }
    });
}

pub(super) fn dismiss_token(
    app: &tauri::AppHandle,
    token: u64,
    focus_parent: bool,
) -> Result<(), String> {
    let state = app.state::<ScreenshotState>();
    {
        let mut inner = lock(&state.inner);
        if !inner
            .history_menu
            .as_ref()
            .is_some_and(|menu| menu.token == token)
        {
            return Err("screenshot:expired".into());
        }
        inner.history_menu = None;
    }
    hide_dismissed(app, focus_parent);
    Ok(())
}

fn ensure_window(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(LABEL) {
        return Ok(window);
    }
    let window = window_builder(app, LABEL, "history-menu")?
        .always_on_top(true)
        .skip_taskbar(true)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .focused(false)
        .inner_size(304.0, 286.0)
        .build()
        .map_err(|_| "screenshot:window-failed")?;
    let events = window.clone();
    window.on_window_event(move |event| match event {
        tauri::WindowEvent::Focused(false)
            if events.is_visible().unwrap_or(false) && !events.is_focused().unwrap_or(false) =>
        {
            lost_focus(&events)
        }
        tauri::WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            dismiss(events.app_handle(), false);
        }
        _ => {}
    });
    Ok(window)
}

pub(super) async fn warm(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<ScreenshotState>();
    let _transition = state.menu_transition.lock().await;
    if !history_actions::allowed(app) || state.starting.load(Ordering::Acquire) {
        return Ok(());
    }
    // Preparing the hidden WebView must never create a selectable session or take focus.
    ensure_window(app)?;
    Ok(())
}

pub(super) async fn open(
    app: &tauri::AppHandle,
    parent: &tauri::WebviewWindow,
    request: &serde_json::Value,
) -> Result<(), String> {
    let state = app.state::<ScreenshotState>();
    let _transition = state.menu_transition.lock().await;
    let toggle_token = {
        let inner = lock(&state.inner);
        inner
            .history_menu
            .as_ref()
            .filter(|menu| menu.toggled_by(request))
            .map(|menu| menu.token)
    };
    if let Some(token) = toggle_token {
        return dismiss_token(app, token, true);
    }
    if !history_actions::allowed(app)
        || !parent.is_visible().unwrap_or(false)
        || state.starting.load(Ordering::Acquire)
        || lock(&state.inner).session.is_some()
    {
        return Err("screenshot:expired".into());
    }
    let entry_id = match request.get("id") {
        None | Some(serde_json::Value::Null) => None,
        Some(value) => Some(
            value
                .as_i64()
                .filter(|id| *id > 0)
                .ok_or("screenshot:invalid-request")?,
        ),
    };
    let kind = request["kind"].as_str().unwrap_or("");
    if entry_id.is_some() && !["text", "image", "files", "phrase"].contains(&kind) {
        return Err("screenshot:invalid-request".into());
    }
    let mut trigger = None;
    let point = if let Some(anchor) = request.get("anchor") {
        let x = anchor["x"]
            .as_f64()
            .filter(|v| v.is_finite())
            .ok_or("screenshot:invalid-request")?;
        let y = anchor["y"]
            .as_f64()
            .filter(|v| v.is_finite())
            .ok_or("screenshot:invalid-request")?;
        let position = parent
            .inner_position()
            .map_err(|_| "screenshot:window-failed")?;
        let size = parent
            .inner_size()
            .map_err(|_| "screenshot:window-failed")?;
        let scale = parent
            .scale_factor()
            .map_err(|_| "screenshot:window-failed")?;
        let width = anchor["width"]
            .as_f64()
            .filter(|v| v.is_finite())
            .unwrap_or(32.0)
            .clamp(1.0, 96.0);
        let height = anchor["height"]
            .as_f64()
            .filter(|v| v.is_finite())
            .unwrap_or(32.0)
            .clamp(1.0, 96.0);
        trigger = Some(Rect {
            x: position.x + (x * scale) as i32,
            y: position.y + ((y - height) * scale) as i32,
            width: (width * scale) as u32,
            height: (height * scale) as u32,
        });
        PhysicalPosition::new(
            position.x as f64 + (x * scale).clamp(0.0, size.width as f64),
            position.y as f64 + (y * scale).clamp(0.0, size.height as f64),
        )
    } else {
        app.cursor_position()
            .map_err(|_| "screenshot:window-failed")?
    };
    let (area, scale) = monitor_for(app, point.x, point.y)?;
    let rect = bounds(
        &area,
        scale,
        point.x as i32,
        point.y as i32,
        if entry_id.is_some() { kind } else { "" },
    );
    dismiss(app, false);
    let menu = ensure_window(app)?;
    menu.hide().map_err(|_| "screenshot:window-failed")?;
    let token = state.sequence.fetch_add(1, Ordering::AcqRel) + 1;
    let recording = app
        .state::<crate::clipboard_history::ClipboardHistoryState>()
        .enabled();
    let expanded = lock(&state.inner).history_expanded;
    lock(&state.inner).history_menu = Some(MenuSession {
        token,
        entry_id,
        kind: kind.into(),
        expanded,
        recording,
        ready: false,
        trigger,
    });
    if let Err(error) = move_history_window(&menu, rect).await {
        let _ = dismiss_token(app, token, false);
        return Err(error);
    }
    let _ = menu.emit("screenshot-menu-opened", token);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        let expired = lock(&app.state::<ScreenshotState>().inner)
            .history_menu
            .as_ref()
            .is_some_and(|menu| menu.token == token && !menu.ready);
        if expired && dismiss_token(&app, token, false).is_ok() {
            let _ = app.emit_to(HISTORY_LABEL, "screenshot-history-action", "error");
        }
    });
    Ok(())
}

pub(super) fn boot(app: &tauri::AppHandle) -> Result<serde_json::Value, String> {
    let state = app.state::<ScreenshotState>();
    let inner = lock(&state.inner);
    Ok(serde_json::json!({"context":inner.context,"menu":inner.history_menu}))
}

pub(super) async fn ready(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
    token: u64,
) -> Result<(), String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let host = app.clone();
    let window = window.clone();
    app.run_on_main_thread(move || {
        let result = (|| {
            let state = host.state::<ScreenshotState>();
            if state.starting.load(Ordering::Acquire) || !history_actions::allowed(&host) {
                return Err("screenshot:expired".to_string());
            }
            {
                let mut inner = lock(&state.inner);
                if inner.session.is_some() {
                    return Err("screenshot:expired".into());
                }
                let menu = inner
                    .history_menu
                    .as_mut()
                    .filter(|menu| menu.token == token)
                    .ok_or("screenshot:expired")?;
                menu.ready = true;
            }
            window
                .show()
                .and_then(|_| window.set_focus())
                .map_err(|_| "screenshot:window-failed")?;
            // A close request can invalidate this token while native show is queued.
            if !lock(&state.inner)
                .history_menu
                .as_ref()
                .is_some_and(|menu| menu.token == token)
            {
                let _ = window.hide();
                return Err("screenshot:expired".into());
            }
            Ok(())
        })();
        if result.is_err() {
            let _ = dismiss_token(&host, token, false);
        }
        let _ = sender.send(result);
    })
    .map_err(|_| "screenshot:window-failed")?;
    receiver.await.map_err(|_| "screenshot:window-failed")?
}

pub(super) fn select(app: &tauri::AppHandle, token: u64, action: &str) -> Result<(), String> {
    let state = app.state::<ScreenshotState>();
    let menu = {
        let mut inner = lock(&state.inner);
        let menu = inner.history_menu.as_ref().ok_or("screenshot:expired")?;
        if !menu.ready || !menu.permits(token, action) {
            return Err("screenshot:forbidden".into());
        }
        inner.history_menu.take().ok_or("screenshot:expired")?
    };
    hide_dismissed(app, MenuSession::restore_parent_after(action));
    app.emit_to(
        HISTORY_LABEL,
        "screenshot-history-action",
        serde_json::json!({"action":action,"id":menu.entry_id,"kind":menu.kind}),
    )
    .map_err(|_| "screenshot:window-failed".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn menu_actions_stay_bound_to_the_open_record_and_generation() {
        let entry = MenuSession {
            token: 3,
            entry_id: Some(7),
            kind: "image".into(),
            expanded: true,
            recording: true,
            ready: true,
            trigger: None,
        };
        assert!(entry.permits(3, "delete"));
        assert!(!entry.permits(2, "delete"));
        assert!(!entry.permits(3, "close"));
        let global = MenuSession {
            entry_id: None,
            ..entry
        };
        assert!(global.permits(3, "hide"));
        assert!(global.permits(3, "main"));
        assert!(global.toggled_by(&serde_json::json!({"toggle":true})));
        assert!(!global.toggled_by(&serde_json::json!({})));
        assert!(!global.toggled_by(&serde_json::json!({"toggle":false})));
        assert!(!global.permits(3, "delete"));
        assert!(!global.permits(3, "unknown"));
        for action in ["hide", "close", "main", "open"] {
            assert!(!MenuSession::restore_parent_after(action));
        }
        for action in ["toggle", "copy", "view", "monitor"] {
            assert!(MenuSession::restore_parent_after(action));
        }
        let text = MenuSession {
            entry_id: Some(3),
            kind: "text".into(),
            ..global
        };
        assert!(text.permits(3, "phrase-add"));
        assert!(text.permits(3, "note"));
        assert!(!text.toggled_by(&serde_json::json!({"toggle":true})));
        let phrase = MenuSession {
            kind: "phrase".into(),
            ..text
        };
        assert!(phrase.permits(3, "phrase-edit"));
        assert!(!phrase.permits(3, "phrase-add"));
        assert!(!phrase.permits(3, "note"));
    }
    #[test]
    fn menu_fits_negative_origin_and_high_dpi_work_areas() {
        for scale in [1.0, 1.5, 2.0] {
            for kind in ["", "text", "image", "files", "phrase"] {
                let area = Rect {
                    x: -1280,
                    y: -100,
                    width: 1280,
                    height: 720,
                };
                let rect = bounds(&area, scale, -1, 700, kind);
                assert!(rect.x >= area.x && rect.y >= area.y);
                assert!(rect.x + rect.width as i32 <= 0 && rect.y + rect.height as i32 <= 620);
            }
        }
    }
}

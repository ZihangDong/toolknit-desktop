use super::*;
pub(super) const LABEL: &str = "screenshot-toast";
fn placement(x: i32, y: i32, width: u32, height: u32, scale: f64) -> Rect {
    let toast_width = (340.0 * scale).round().min(width as f64) as u32;
    let toast_height = (88.0 * scale).round().min(height as f64) as u32;
    let bottom = (24.0 * scale)
        .round()
        .min(height.saturating_sub(toast_height) as f64) as i32;
    Rect {
        x: x + (width - toast_width) as i32 / 2,
        y: y + height as i32 - toast_height as i32 - bottom,
        width: toast_width,
        height: toast_height,
    }
}
#[derive(Clone, Serialize)]
pub(super) struct Pending {
    pub revision: u64,
    pub kind: String,
    pub lang: String,
}

pub(super) fn show(app: &tauri::AppHandle, kind: &str) -> Result<(), String> {
    if !["copied", "phraseAdded", "orderSaved"].contains(&kind) {
        return Err("screenshot:invalid-request".into());
    }
    let state = app.state::<ScreenshotState>();
    if let Some(timer) = lock(&state.feedback_timer).take() {
        timer.abort();
    }
    let lang = lock(&state.inner).context["lang"]
        .as_str()
        .unwrap_or("zh")
        .to_owned();
    let pending = Pending {
        revision: state.feedback_revision.fetch_add(1, Ordering::AcqRel) + 1,
        kind: kind.into(),
        lang,
    };
    *lock(&state.feedback_pending) = Some(pending.clone());
    if let Some(window) = app.get_webview_window(LABEL) {
        window
            .emit("desktop-feedback", &pending)
            .map_err(|_| "screenshot:window-failed")?;
    } else {
        window_builder(app, LABEL, "toast")?
            .always_on_top(true)
            .skip_taskbar(true)
            .transparent(true)
            .shadow(false)
            .focusable(false)
            .focused(false)
            .resizable(false)
            .inner_size(340.0, 88.0)
            .build()
            .map_err(|_| "screenshot:window-failed")?;
    }
    Ok(())
}
pub(super) fn boot(app: &tauri::AppHandle) -> Result<serde_json::Value, String> {
    let state = app.state::<ScreenshotState>();
    let pending = lock(&state.feedback_pending)
        .clone()
        .ok_or("screenshot:expired")?;
    Ok(serde_json::json!({"context":{"lang":pending.lang,"theme":"light"},"feedback":pending}))
}
pub(super) fn ready(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
    revision: u64,
) -> Result<(), String> {
    let state = app.state::<ScreenshotState>();
    if revision != state.feedback_revision.load(Ordering::Acquire) {
        return Ok(());
    }
    let monitor = app
        .primary_monitor()
        .map_err(|_| "screenshot:window-failed")?
        .ok_or("screenshot:window-failed")?;
    let area = monitor.work_area();
    let scale = monitor.scale_factor();
    let bounds = placement(
        area.position.x,
        area.position.y,
        area.size.width,
        area.size.height,
        scale,
    );
    window
        .set_size(PhysicalSize::new(bounds.width, bounds.height))
        .map_err(|_| "screenshot:window-failed")?;
    window
        .set_position(PhysicalPosition::new(bounds.x, bounds.y))
        .map_err(|_| "screenshot:window-failed")?;
    window
        .set_ignore_cursor_events(true)
        .map_err(|_| "screenshot:window-failed")?;
    #[cfg(windows)]
    let handle = window.hwnd().map_err(|_| "screenshot:window-failed")?.0 as isize;
    #[cfg(not(windows))]
    let target = window.clone();
    let owner = app.clone();
    window
        .run_on_main_thread(move || {
            if owner
                .state::<ScreenshotState>()
                .feedback_revision
                .load(Ordering::Acquire)
                != revision
            {
                return;
            }
            #[cfg(windows)]
            unsafe {
                use windows::Win32::{Foundation::HWND, UI::WindowsAndMessaging::*};
                let _ = SetWindowPos(
                    HWND(handle),
                    HWND::default(),
                    0,
                    0,
                    0,
                    0,
                    SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
                );
            }
            #[cfg(not(windows))]
            let _ = target.show();
        })
        .map_err(|_| "screenshot:window-failed")?;
    let timer_owner = app.clone();
    let app = app.clone();
    let window = window.clone();
    let timer = tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(2200)).await;
        let target = window.clone();
        let _ = window.run_on_main_thread(move || {
            if app
                .state::<ScreenshotState>()
                .feedback_revision
                .load(Ordering::Acquire)
                == revision
            {
                let _ = window_visibility::hide_on_main_thread(&target);
            }
        });
    });
    if let Some(previous) =
        lock(&timer_owner.state::<ScreenshotState>().feedback_timer).replace(timer)
    {
        previous.abort();
    }
    Ok(())
}

pub(super) async fn dismiss(app: &tauri::AppHandle) -> Result<(), String> {
    if let Some(timer) = lock(&app.state::<ScreenshotState>().feedback_timer).take() {
        timer.abort();
    }
    app.state::<ScreenshotState>()
        .feedback_revision
        .fetch_add(1, Ordering::AcqRel);
    if let Some(window) = app.get_webview_window(LABEL) {
        window_visibility::hide(&window).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn toast_is_centered_above_taskbar_at_every_scale() {
        for (x, y, width, height, scale) in [
            (0, 0, 1920, 1040, 1.0),
            (-2560, -120, 2560, 1380, 1.5),
            (0, 0, 320, 80, 2.0),
        ] {
            let rect = placement(x, y, width, height, scale);
            assert!((rect.x + rect.width as i32 / 2 - (x + width as i32 / 2)).abs() <= 1);
            assert!(
                rect.x >= x
                    && rect.y >= y
                    && rect.x + rect.width as i32 <= x + width as i32
                    && rect.y + rect.height as i32 <= y + height as i32
            );
        }
    }
}

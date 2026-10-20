use super::*;

pub(super) fn allowed(app: &tauri::AppHandle) -> bool {
    preferences().history
        && !app
            .state::<ScreenshotState>()
            .history_hidden
            .load(Ordering::Acquire)
}

pub(super) async fn visibility(app: &tauri::AppHandle, permanent: bool) -> Result<(), String> {
    history_menu::dismiss(app, false);
    let state = app.state::<ScreenshotState>();
    let _transition = state.history_transition.lock().await;
    let old = preferences();
    if permanent {
        store_preferences(&Preferences {
            history: false,
            ..old.clone()
        })?;
    }
    let previous = state.history_hidden.swap(true, Ordering::AcqRel);
    if let Some(window) = app.get_webview_window(HISTORY_LABEL) {
        if let Err(error) = window_visibility::hide(&window).await {
            state.history_hidden.store(previous, Ordering::Release);
            if permanent {
                let _ = store_preferences(&old);
            }
            return Err(error);
        }
    }
    let _ = app.emit_to("main", "screenshot-preferences-changed", ());
    Ok(())
}

pub(super) fn clamped(area: &Rect, bounds: &Rect) -> Rect {
    let width = bounds.width.min(area.width).max(1);
    let height = bounds.height.min(area.height).max(1);
    Rect {
        x: bounds
            .x
            .clamp(area.x, area.x + area.width.saturating_sub(width) as i32),
        y: bounds
            .y
            .clamp(area.y, area.y + area.height.saturating_sub(height) as i32),
        width,
        height,
    }
}

fn pointer_down() -> bool {
    #[cfg(windows)]
    {
        unsafe { windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState(1) < 0 }
    }
    #[cfg(not(windows))]
    {
        false
    }
}

pub(super) fn moved(window: &tauri::WebviewWindow) {
    let state = window.state::<ScreenshotState>();
    if state.history_adjusting.load(Ordering::Acquire) {
        return;
    }
    let revision = state.history_drag_revision.fetch_add(1, Ordering::AcqRel) + 1;
    let window = window.clone();
    tauri::async_runtime::spawn(async move {
        let state = window.state::<ScreenshotState>();
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(80)).await;
            if state.history_drag_revision.load(Ordering::Acquire) != revision {
                return;
            }
            if !pointer_down() {
                break;
            }
        }
        let _transition = state.history_transition.lock().await;
        if state.history_drag_revision.load(Ordering::Acquire) != revision
            || !allowed(window.app_handle())
        {
            return;
        }
        let result = async {
            let position = window
                .outer_position()
                .map_err(|_| "screenshot:window-failed")?;
            let size = window
                .outer_size()
                .map_err(|_| "screenshot:window-failed")?;
            let from = Rect {
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
            };
            let (area, _) = monitor_for(
                window.app_handle(),
                from.x as f64 + from.width as f64 / 2.0,
                from.y as f64 + from.height as f64 / 2.0,
            )?;
            let target = clamped(&area, &from);
            if target.x == from.x
                && target.y == from.y
                && target.width == from.width
                && target.height == from.height
            {
                return Ok::<(), String>(());
            }
            state.history_adjusting.store(true, Ordering::Release);
            let steps = if state.history_reduced_motion.load(Ordering::Acquire) {
                1
            } else {
                14
            };
            for i in 1..=steps {
                if pointer_down() || !allowed(window.app_handle()) {
                    break;
                }
                let t = 1.0 - (1.0 - i as f64 / steps as f64).powi(3);
                window
                    .set_position(Position::Physical(PhysicalPosition::new(
                        (from.x as f64 + (target.x - from.x) as f64 * t).round() as i32,
                        (from.y as f64 + (target.y - from.y) as f64 * t).round() as i32,
                    )))
                    .map_err(|_| "screenshot:window-failed")?;
                if steps > 1 {
                    tokio::time::sleep(std::time::Duration::from_millis(16)).await;
                }
            }
            if !pointer_down()
                && allowed(window.app_handle())
                && (target.width != from.width || target.height != from.height)
            {
                move_history_window(&window, target).await?;
            }
            Ok(())
        }
        .await;
        state.history_adjusting.store(false, Ordering::Release);
        if result.is_err() {
            let _ = window.emit("screenshot-history-action", "error");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn snap_keeps_bubble_and_panel_inside_negative_and_small_work_areas() {
        for area in [
            Rect {
                x: -1920,
                y: -100,
                width: 1920,
                height: 1040,
            },
            Rect {
                x: 0,
                y: 0,
                width: 640,
                height: 480,
            },
        ] {
            for (width, height) in [(96, 96), (376, 760), (564, 1140)] {
                for (x, y) in [(-4000, -4000), (0, 0), (6000, 4000)] {
                    let value = clamped(
                        &area,
                        &Rect {
                            x,
                            y,
                            width,
                            height,
                        },
                    );
                    assert!(value.x >= area.x && value.y >= area.y);
                    assert!(
                        value.x as i64 + value.width as i64 <= area.x as i64 + area.width as i64
                    );
                    assert!(
                        value.y as i64 + value.height as i64 <= area.y as i64 + area.height as i64
                    );
                }
            }
        }
    }
}

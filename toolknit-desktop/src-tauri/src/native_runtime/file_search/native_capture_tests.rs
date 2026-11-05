//! Real HWND visibility through the same guard used before screenshot capture.
//! Does not acquire desktop pixels or synthesize keyboard/mouse input.
use super::*;

async fn visible(app: &tauri::AppHandle, bar: bool, results: bool) -> Result<(), String> {
    windows::on_main(app, move |host| {
        use ::windows::Win32::{Foundation::HWND, UI::WindowsAndMessaging::IsWindowVisible};
        for (label, expected) in [(BAR, bar), (RESULTS, results), (MENU, false)] {
            let window = host
                .get_webview_window(label)
                .ok_or("capture:missing-window")?;
            let actual =
                unsafe { IsWindowVisible(HWND(window.hwnd().unwrap().0 as isize)) }.as_bool();
            if actual != expected {
                return Err(format!("capture:visibility-mismatch {label}"));
            }
            if expected && window.is_focused().unwrap_or(true) {
                return Err("capture:restore-stole-focus".into());
            }
        }
        Ok(())
    })
    .await
}

async fn settle(app: &tauri::AppHandle) -> Result<(), String> {
    let until = Instant::now() + Duration::from_secs(3);
    loop {
        if !lock(&app.state::<FileSearchState>().inner).suspended {
            // The guard schedules restoration onto the native event loop.
            tokio::time::sleep(Duration::from_millis(380)).await;
            return Ok(());
        }
        if Instant::now() > until {
            return Err("capture:restore-timeout".into());
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

pub(super) async fn verify(app: &tauri::AppHandle) -> Result<(), String> {
    for expanded in [false, true] {
        windows::set_expanded(app, expanded, false).await?;
        tokio::time::sleep(Duration::from_millis(380)).await;
        visible(app, true, expanded).await?;
        let guard = crate::native_runtime::quick_screenshot::test_capture_visibility(app).await?;
        visible(app, false, false).await?;
        assert!(!allowed(&app.state::<FileSearchState>()));
        drop(guard);
        settle(app).await?;
        visible(app, true, expanded).await?;
    }

    // Queue a newer collapse while the window transition is busy, then cancel
    // capture. The restore queued after that intent must not expand it again.
    let guard = crate::native_runtime::quick_screenshot::test_capture_visibility(app).await?;
    let state = app.state::<FileSearchState>();
    let transition = state.transition.lock().await;
    let host = app.clone();
    let (started, waiting) = tokio::sync::oneshot::channel();
    let collapse = tauri::async_runtime::spawn(async move {
        let _ = started.send(());
        windows::set_expanded(&host, false, false).await
    });
    waiting.await.map_err(|_| "capture:collapse-task")?;
    tokio::time::sleep(Duration::from_millis(25)).await;
    drop(guard);
    tokio::time::sleep(Duration::from_millis(25)).await;
    drop(transition);
    collapse.await.map_err(|_| "capture:collapse-task")??;
    settle(app).await?;
    if lock(&state.inner).expanded {
        return Err("delayed capture restore must not overwrite a newer collapse".into());
    }
    visible(app, true, false).await?;

    // A newer explicit hide during a pending capture is not undone on cancel.
    let guard = crate::native_runtime::quick_screenshot::test_capture_visibility(app).await?;
    windows::hide(app, true).await?;
    drop(guard);
    settle(app).await?;
    visible(app, false, false).await?;
    assert!(lock(&app.state::<FileSearchState>().inner).hidden);

    file_search(
        app.clone(),
        app.get_webview_window("main").ok_or("missing main")?,
        json!({"action":"configure","enabled":true}),
    )
    .await?;
    windows::set_expanded(app, true, false).await?;
    let guard = crate::native_runtime::quick_screenshot::test_capture_visibility(app).await?;
    file_search(
        app.clone(),
        app.get_webview_window("main").ok_or("missing main")?,
        json!({"action":"configure","enabled":false}),
    )
    .await?;
    drop(guard);
    settle(app).await?;
    visible(app, false, false).await?;
    assert!(
        !lock(&app.state::<FileSearchState>().inner)
            .preferences
            .enabled
    );

    file_search(
        app.clone(),
        app.get_webview_window("main").ok_or("missing main")?,
        json!({"action":"configure","enabled":true}),
    )
    .await?;
    println!("WEBVIEW_CAPTURE production guard hides both HWNDs, restores without activation, honors newer hide/disable");
    Ok(())
}

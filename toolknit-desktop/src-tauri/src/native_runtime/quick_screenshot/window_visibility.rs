pub(super) async fn hide(window: &tauri::WebviewWindow) -> Result<(), String> {
    crate::platform::window_visibility::hide(&window.as_ref().window())
        .await
        .map_err(|_| "screenshot:window-hide-failed".into())
}

pub(super) fn hide_on_main_thread(window: &tauri::WebviewWindow) -> Result<(), String> {
    crate::platform::window_visibility::hide_on_main_thread(&window.as_ref().window())
        .map_err(|_| "screenshot:window-hide-failed".into())
}

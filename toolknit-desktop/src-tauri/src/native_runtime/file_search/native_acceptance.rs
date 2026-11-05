//! Manual test controller only. Never compiled into the shipped application.
use super::*;

#[derive(Default)]
pub(super) struct Control(pub AtomicBool);

pub(super) fn handle(invoke: tauri::ipc::Invoke<tauri::Wry>) {
    let view = invoke.message.webview();
    let app = view.app_handle().clone();
    let window = app.get_webview_window(view.label());
    let action = match invoke.message.payload() {
        tauri::ipc::InvokeBody::Json(body) => {
            body["action"].as_str().unwrap_or_default().to_owned()
        }
        _ => String::new(),
    };
    invoke.resolver.respond_async(async move {
        let window = window.ok_or_else(|| tauri::ipc::InvokeError::from("test:window"))?;
        run(app, window, action)
            .await
            .map_err(tauri::ipc::InvokeError::from)
    });
}
async fn run(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    action: String,
) -> Result<(), String> {
    if window.label() != "main" || std::env::var_os("TOOLKNIT_FILE_SEARCH_ACCEPTANCE").is_none() {
        return Err("test:forbidden".into());
    }
    if action == "finish" {
        app.state::<Control>().0.store(true, Ordering::Release);
        return Ok(());
    }
    if !["enable", "expand", "capture"].contains(&action.as_str()) {
        return Err("test:invalid-action".into());
    }
    let state = snapshot(&app.state::<FileSearchState>());
    if state["enabled"] != true || state["hidden"] == true {
        file_search(
            app.clone(),
            window,
            json!({"action":"configure","enabled":true}),
        )
        .await?;
    }
    windows::set_expanded(&app, action != "enable", action != "enable").await?;
    if action == "capture" {
        tokio::time::sleep(Duration::from_millis(500)).await;
        crate::native_runtime::quick_screenshot::begin(&app).await?;
    }
    Ok(())
}

pub(super) async fn show(app: &tauri::AppHandle) -> Result<(), String> {
    windows::on_main(app, |host| {
        let window = host
            .get_webview_window("main")
            .ok_or("missing acceptance panel")?;
        window
            .set_size(tauri::PhysicalSize::new(1000, 650))
            .map_err(|_| "panel:size")?;
        window
            .set_position(tauri::PhysicalPosition::new(16, 16))
            .map_err(|_| "panel:position")?;
        window.show().map_err(|_| "panel:show")?;
        Ok(())
    })
    .await
}

use super::{engine, install};
use crate::native_runtime::*;
use serde::Deserialize;
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

pub(super) const VERSION: &str = "onnx-20261106-r1";
pub(super) fn lock<T>(value: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    value.lock().unwrap_or_else(|e| e.into_inner())
}
pub(super) fn root() -> Result<PathBuf, String> {
    #[cfg(test)]
    if let Some(root) = std::env::var_os("TOOLKNIT_OCR_WEBVIEW_APPDATA") {
        return Ok(PathBuf::from(root).join("ToolKnit/local-ocr"));
    }
    Ok(toolknit_app_data_dir()?.join("local-ocr"))
}
#[derive(Default)]
pub(crate) struct OcrState {
    pub(super) engine: Arc<Mutex<Option<engine::Engine>>>,
    pub(super) busy: AtomicBool,
    pub(super) installing: AtomicBool,
    pub(super) install_cancel: AtomicBool,
    pub(super) progress: Mutex<serde_json::Value>,
    tasks: Mutex<HashMap<String, Arc<AtomicBool>>>,
    cancelled: Mutex<HashMap<String, Instant>>,
    idle: std::sync::atomic::AtomicU64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Request {
    action: String,
    #[serde(default)]
    request_id: String,
    session: Option<u64>,
    image: Option<String>,
}
pub(super) fn status(state: &OcrState) -> Result<serde_json::Value, String> {
    Ok(
        serde_json::json!({"ready":install::complete(&root()?.join(VERSION)),"installing":state.installing.load(Ordering::SeqCst),"busy":state.busy.load(Ordering::SeqCst),"progress":lock(&state.progress).clone(),"version":VERSION,"downloadBytes":install::total_bytes(),"engine":"pp-ocrv5-mobile"}),
    )
}
struct Busy<'a>(&'a AtomicBool);
impl Drop for Busy<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}
fn acquire(flag: &AtomicBool) -> Result<Busy<'_>, String> {
    flag.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .map_err(|_| "ocr:busy")?;
    Ok(Busy(flag))
}
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

pub(crate) async fn recognize(
    app: &tauri::AppHandle,
    owner: &str,
    id: &str,
    bytes: Vec<u8>,
) -> Result<serde_json::Value, String> {
    if !valid_id(id) || bytes.is_empty() || bytes.len() > 24 * 1024 * 1024 {
        return Err("ocr:invalid-input".into());
    }
    let state = app.state::<OcrState>();
    let _busy = acquire(&state.busy)?;
    if state.installing.load(Ordering::SeqCst) {
        return Err("ocr:busy".into());
    }
    let directory = root()?.join(VERSION);
    if !install::complete(&directory) {
        return Err("ocr:not-installed".into());
    }
    let key = format!("{owner}:{id}");
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut tasks = lock(&state.tasks);
        if lock(&state.cancelled)
            .remove(&key)
            .is_some_and(|at| at.elapsed() < Duration::from_secs(60))
        {
            return Err("ocr:cancelled".into());
        }
        tasks.insert(key.clone(), cancel.clone());
    }
    let shared = state.engine.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        if cancel.load(Ordering::SeqCst) {
            return Err("ocr:cancelled".into());
        }
        let mut cache = lock(&shared);
        if cache.is_none() {
            install::verify(&directory)?;
            *cache = Some(engine::Engine::open(&directory)?);
        }
        let result = cache
            .as_mut()
            .ok_or("ocr:model-load")?
            .recognize(&bytes, &cancel);
        result.and_then(|page| serde_json::to_value(page).map_err(|_| "ocr:result".into()))
    })
    .await
    .map_err(|_| "ocr:worker".to_string())
    .and_then(|r| r);
    lock(&state.tasks).remove(&key);
    let revision = state.idle.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(120)).await;
        let state = app.state::<OcrState>();
        if revision == state.idle.load(Ordering::SeqCst) && !state.busy.load(Ordering::SeqCst) {
            if let Ok(mut engine) = state.engine.try_lock() {
                *engine = None;
            }
        }
    });
    result
}
pub(crate) fn cancel_owner(app: &tauri::AppHandle, owner: &str) {
    let state = app.state::<OcrState>();
    let prefix = format!("{owner}:");
    for (key, cancel) in lock(&state.tasks).iter() {
        if key.starts_with(&prefix) {
            cancel.store(true, Ordering::SeqCst);
        }
    }
}
#[tauri::command]
pub(crate) async fn local_ocr(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, OcrState>,
    request: Request,
) -> Result<serde_json::Value, String> {
    let main = window.label() == "main";
    if !main {
        if window.label() != "screenshot-capture" {
            return Err("ocr:forbidden".into());
        }
        quick_screenshot::require_session(
            &app.state::<quick_screenshot::ScreenshotState>(),
            &serde_json::json!({"session":request.session}),
        )?;
    }
    match request.action.as_str() {
        "status" => status(&state),
        "install" if main => {
            let _mutation = acquire(&state.installing)?;
            if state.busy.load(Ordering::SeqCst) {
                return Err("ocr:busy".into());
            }
            state.install_cancel.store(false, Ordering::SeqCst);
            let result = install::install(&app, &state).await;
            let _ = app.emit("local-ocr-changed", status(&state)?);
            result?;
            status(&state)
        }
        "cancel-install" if main => {
            state.install_cancel.store(true, Ordering::SeqCst);
            Ok(serde_json::Value::Null)
        }
        "remove" if main => {
            let _mutation = acquire(&state.installing)?;
            if state.busy.load(Ordering::SeqCst) {
                return Err("ocr:busy".into());
            }
            *lock(&state.engine) = None;
            let dir = root()?.join(VERSION);
            if dir.exists() {
                install::safe_dir(&dir)?;
                std::fs::remove_dir_all(dir).map_err(|_| "ocr:storage")?;
            }
            let value = status(&state)?;
            let _ = app.emit("local-ocr-changed", &value);
            Ok(value)
        }
        "open-manager" => {
            if !main {
                quick_screenshot::finish(&app);
            }
            if let Some(main) = app.get_webview_window("main") {
                crate::native_runtime::show_main_window(&app);
                let _ = main.emit("local-ocr-open", ());
            }
            Ok(serde_json::Value::Null)
        }
        "cancel" => {
            if !valid_id(&request.request_id) {
                return Err("ocr:invalid-input".into());
            }
            let key = format!("{}:{}", window.label(), request.request_id);
            let tasks = lock(&state.tasks);
            if let Some(cancel) = tasks.get(&key) {
                cancel.store(true, Ordering::SeqCst);
            } else {
                let mut cancelled = lock(&state.cancelled);
                cancelled.retain(|_, at| at.elapsed() < Duration::from_secs(60));
                if cancelled.len() < 32 {
                    cancelled.insert(key, Instant::now());
                }
            }
            Ok(serde_json::Value::Null)
        }
        "recognize" => {
            use base64::Engine;
            let image = request.image.as_deref().ok_or("ocr:invalid-input")?;
            if image.len() > 34 * 1024 * 1024 {
                return Err("ocr:image-too-large".into());
            }
            let encoded = image
                .strip_prefix("data:image/png;base64,")
                .or_else(|| image.strip_prefix("data:image/jpeg;base64,"))
                .ok_or("ocr:invalid-image")?;
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(encoded)
                .map_err(|_| "ocr:invalid-image")?;
            let result = recognize(&app, window.label(), &request.request_id, bytes).await?;
            if !main {
                quick_screenshot::require_session(
                    &app.state::<quick_screenshot::ScreenshotState>(),
                    &serde_json::json!({"session":request.session}),
                )?;
            }
            Ok(result)
        }
        _ => Err("ocr:forbidden".into()),
    }
}
pub(crate) fn shutdown(app: &tauri::AppHandle) {
    let state = app.state::<OcrState>();
    state.install_cancel.store(true, Ordering::SeqCst);
    for cancel in lock(&state.tasks).values() {
        cancel.store(true, Ordering::SeqCst);
    }
    if let Ok(mut engine) = state.engine.try_lock() {
        *engine = None;
    };
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn request_and_work_boundaries() {
        assert!(valid_id("page-1.3"));
        assert!(!valid_id("../file"));
        assert!(!valid_id(&"a".repeat(81)));
        assert!(serde_json::from_value::<Request>(
            serde_json::json!({"action":"install","url":"https://evil.invalid"})
        )
        .is_err());
        let state = OcrState::default();
        let guard = acquire(&state.busy).unwrap();
        assert!(acquire(&state.busy).is_err());
        drop(guard);
        assert!(acquire(&state.busy).is_ok());
    }
}

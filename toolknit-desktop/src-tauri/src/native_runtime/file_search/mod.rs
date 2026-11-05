//! Local filename search; windows and indexing have independent lifetimes.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Mutex, MutexGuard,
};
use tauri::{Emitter, Manager};
#[cfg(windows)]
mod accelerator;
#[cfg(test)]
mod bench_tests;
#[cfg(windows)]
mod filesystem_worker;
mod geometry;
mod index;
mod matcher;
#[cfg(all(test, windows))]
mod native_tests;
#[cfg(all(test, windows))]
mod automatic_tests;
#[cfg(windows)]
mod ntfs;
#[cfg(windows)]
mod ntfs_tree;
mod protocol;
#[cfg(windows)]
pub(super) fn dispatch_accelerator() -> Option<i32> {
    filesystem_worker::dispatch().or_else(accelerator::dispatch_install_mode)
}
mod query;
mod service;
mod storage;
mod scope_policy;
mod discovery;
mod windows;

pub(super) const BAR: &str = "file-search-bar";
pub(super) const RESULTS: &str = "file-search-results";
pub(super) const MENU: &str = "file-search-menu";
pub(super) fn lock<T>(value: &Mutex<T>) -> MutexGuard<'_, T> {
    value.lock().unwrap_or_else(|e| e.into_inner())
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(super) struct Preferences {
    pub enabled: bool,
    pub anchor: Option<SavedAnchor>,
    pub roots: Vec<String>,
    pub acceleration: bool,
    pub automatic: bool,
    pub legacy_roots: Option<Vec<String>>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SavedAnchor {
    pub monitor: String,
    pub x: f64,
    pub y: f64,
}
#[derive(Default)]
struct Inner {
    pub preferences: Preferences,
    pub hidden: bool,
    pub suspended: bool,
    pub expanded: bool,
    pub ready: std::collections::HashSet<String>,
    pub anchor: Option<geometry::Rect>,
    pub layout: Option<geometry::Layout>,
    pub context: Value,
    pub query: Value,
    pub menu_token: Option<u64>,
}
#[derive(Default)]
pub(crate) struct FileSearchState {
    inner: Mutex<Inner>,
    pub(super) transition: tokio::sync::Mutex<()>,
    pub(super) generation: AtomicU64,
    pub(super) drag_generation: AtomicU64,
    menu_generation: AtomicU64,
    pub(super) adjusting: AtomicBool,
    pub(super) stopping: AtomicBool,
    index: Mutex<Option<std::sync::Arc<index::Index>>>,
    index_transition: tokio::sync::Mutex<()>,
    index_configuration: Mutex<Option<std::sync::Arc<AtomicBool>>>,
    setup_transition: tokio::sync::Mutex<()>,
    setup_busy: AtomicBool,
    index_paused: AtomicBool,
    auto_monitor_started: AtomicBool,
    needs_service_repair: AtomicBool,
    auto_locations: Mutex<Vec<discovery::Location>>,
    leases: Mutex<[service::Lease; 2]>,
}
pub(super) fn allowed(state: &FileSearchState) -> bool {
    let s = lock(&state.inner);
    s.preferences.enabled && !s.hidden && !s.suspended && !state.stopping.load(Ordering::Acquire)
}
fn prefs_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| "file-search:storage")?
        .join("file-search-settings.json"))
}
pub(super) fn save_preferences(app: &tauri::AppHandle, prefs: &Preferences) -> Result<(), String> {
    let path = prefs_path(app)?;
    std::fs::create_dir_all(path.parent().ok_or("file-search:storage")?)
        .map_err(|_| "file-search:storage")?;
    let bytes = serde_json::to_vec(prefs).map_err(|_| "file-search:storage")?;
    if std::fs::symlink_metadata(&path).is_ok_and(|m| storage::reparse(&m) || !m.is_file()) {
        return Err("file-search:storage".into());
    }
    let mut nonce = [0u8; 16];
    getrandom::getrandom(&mut nonce).map_err(|_| "file-search:storage")?;
    let temp = path.with_extension(format!("{}.tmp", hex::encode(nonce)));
    let result = (|| -> Result<(), String> {
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|_| "file-search:storage")?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| "file-search:storage")?;
        drop(file);
        std::fs::rename(&temp, &path).map_err(|_| "file-search:storage".into())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temp);
    }
    result
}
pub(super) fn snapshot(state: &FileSearchState) -> Value {
    let s = lock(&state.inner);
    let index = lock(&state.index).as_ref().map(|index| index.status());
    json!({"enabled":s.preferences.enabled,"hidden":s.hidden,"suspended":s.suspended,"index":index,
        "expanded":s.expanded,"generation":state.generation.load(Ordering::Acquire),
        "layout":s.layout,"context":s.context,"query":s.query,"menuToken":s.menu_token})
}
pub(super) fn notify(app: &tauri::AppHandle) {
    let data = snapshot(&app.state::<FileSearchState>());
    for label in ["main", BAR, RESULTS, MENU] {
        let _ = app.emit_to(label, "file-search-state", &data);
    }
}
pub(crate) fn initialize(app: &tauri::AppHandle) {
    register_capture_group(app);
    restore_preferences(app);
}
fn register_capture_group(app: &tauri::AppHandle) {
    crate::platform::auxiliary_windows::register(
        app,
        "file-search",
        crate::platform::auxiliary_windows::Group {
            labels: vec![BAR, RESULTS, MENU],
            suspend: capture_suspend,
            restore: capture_restore,
        },
    );
}
fn restore_preferences(app: &tauri::AppHandle) {
    let mut prefs = prefs_path(app)
        .ok()
        .and_then(|p| {
            use std::io::Read;
            if std::fs::symlink_metadata(&p).is_ok_and(|m| storage::reparse(&m) || !m.is_file()) {
                return None;
            }
            let mut bytes = Vec::new();
            std::fs::File::open(p)
                .ok()?
                .take(2 * 1024 * 1024 + 1)
                .read_to_end(&mut bytes)
                .ok()?;
            Some(bytes)
        })
        .filter(|b| b.len() <= 2 * 1024 * 1024)
        .and_then(|b| serde_json::from_slice::<Preferences>(&b).ok())
        .unwrap_or_default();
    if prefs.roots.len() > if prefs.automatic { 256 } else { 32 }
        || prefs.roots.iter().any(|p| {
            p.len() > 32768
                || p.chars().any(char::is_control)
                || index::validate_local_scope(std::path::Path::new(p)).is_err()
        })
    {
        prefs.roots.clear();
    }
    if prefs.legacy_roots.as_ref().is_some_and(|v| v.len() > 32 || v.iter().any(|p| p.len() > 32768 || index::validate_local_scope(std::path::Path::new(p)).is_err())) {
        prefs.legacy_roots = None;
    }
    let state = app.state::<FileSearchState>();
    lock(&state.inner).preferences = prefs;
    service::bootstrap(app);
    windows::watch_work_area(app);
    if allowed(&state) {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = windows::set_expanded(&app, false, false).await;
        });
    }
}
fn capture_suspend(app: &tauri::AppHandle) -> u64 {
    let state = app.state::<FileSearchState>();
    let token = state.generation.fetch_add(1, Ordering::AcqRel) + 1;
    let _=service::invalidate(app,1);
    {
        let mut s = lock(&state.inner);
        s.suspended = true;
        s.menu_token = None;
    }
    notify(app);
    token
}
fn capture_restore(app: &tauri::AppHandle, token: u64) {
    let state = app.state::<FileSearchState>();
    let expanded = {
        let mut s = lock(&state.inner);
        s.suspended = false;
        s.expanded
    };
    if state.generation.load(Ordering::Acquire) == token && allowed(&state) {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = windows::restore_after_capture(&app, expanded, token).await;
        });
    }
}
pub(crate) fn shutdown(app: &tauri::AppHandle) {
    let state = app.state::<FileSearchState>();
    state.stopping.store(true, Ordering::Release);
    service::cancel_configuration(&state);
    state.generation.fetch_add(1, Ordering::AcqRel);
    if let Some(index) = lock(&state.index).as_ref() {
        index.stop();
    };
}

#[tauri::command]
pub(crate) async fn file_search(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    request: Value,
) -> Result<Value, String> {
    let action = request["action"]
        .as_str()
        .ok_or("file-search:invalid-request")?;
    let label = window.label();
    if !["main", BAR, RESULTS, MENU].contains(&label) {
        return Err("file-search:forbidden".into());
    }
    let state = app.state::<FileSearchState>();
    if state.stopping.load(Ordering::Acquire) {
        return Err("file-search:stopping".into());
    }
    match action {
        "status" => return service::status(&app),
        "automatic-setup" if label == "main" => return service::automatic_setup(&app, request["ordinary"].as_bool().unwrap_or(false)).await,
        "automatic-resume" if label == "main" => return service::automatic_resume(&app, false).await,
        "automatic-rebuild" if label == "main" => return service::automatic_resume(&app, true).await,
        "boot" => return Ok(snapshot(&state)),
        "index-configure" if label == "main" => {
            let roots = serde_json::from_value::<Vec<String>>(request["roots"].clone())
                .map_err(|_| "file-search:scope")?;
            return service::configure(&app, roots).await;
        }
        "acceleration-status" if label == "main" => {
            return service::acceleration_status(&app).await
        }
        "acceleration-configure" if label == "main" => {
            return service::acceleration_configure(
                &app,
                request["enabled"]
                    .as_bool()
                    .ok_or("file-search:invalid-request")?,
            )
            .await
        }
        "index-stop" if label == "main" => {
            state.index_paused.store(true, Ordering::Release);
            service::cancel_configuration(&state);
            if let Some(index) = lock(&state.index).as_ref() {
                index.stop();
            }
            return service::status(&app);
        }
        "index-clear" if label == "main" => return service::clear(&app).await,
        "query-invalidate" if label != MENU => {
            service::invalidate(&app, usize::from(label != "main"))?;
            if label == BAR {
                let _ = app.emit_to(RESULTS, "file-search-pending", ());
            }
        }
        "search" if label != MENU => {
            ensure_query_surface(&state,label)?;
            let query = serde_json::from_value::<query::Query>(request["query"].clone())
                .map_err(|_| "file-search:query")?;
            let cursor = (!request["cursor"].is_null()).then(|| request["cursor"].clone());
            let result=service::search(&app, usize::from(label != "main"), query, cursor).await?;
            ensure_query_surface(&state,label)?; return Ok(result);
        }
        "query-check" if label != MENU => {
            ensure_query_surface(&state,label)?;
            let result=service::check_query(&app, usize::from(label != "main"), request["ticket"].as_str().ok_or("file-search:query")?).await?;
            ensure_query_surface(&state,label)?; return Ok(result);
        }
        "reveal" if label != MENU => {
            ensure_query_surface(&state,label)?;
            service::reveal(
                &app,
                usize::from(label != "main"),
                request["id"].as_str().ok_or("file-search:query")?,
                request["ticket"].as_str().ok_or("file-search:query")?,
            )
            .await?;
            if label != "main" {
                windows::set_expanded(&app, false, false).await?;
            }
        }
        "context" if label == "main" => {
            let context = json!({"lang":if request["lang"]=="en" {"en"} else {"zh"},
                "theme":if request["theme"]=="light" {"light"} else {"dark"},
                "reducedMotion":request["reducedMotion"].as_bool().unwrap_or(false)});
            let changed = { let mut inner = lock(&state.inner);
                if inner.context == context { false } else { inner.context = context; true } };
            if changed { notify(&app); }
        }
        "configure" if label == "main" => {
            let enabled = request["enabled"]
                .as_bool()
                .ok_or("file-search:invalid-request")?;
            {
                let _transition = state.transition.lock().await;
                let mut s = lock(&state.inner);
                let next = Preferences {
                    enabled,
                    ..s.preferences.clone()
                };
                save_preferences(&app, &next)?;
                s.preferences = next;
                s.hidden = false;
            }
            service::invalidate(&app,0)?;
            service::invalidate(&app,1)?;
            if enabled {
                windows::set_expanded(&app, false, false).await?;
            } else {
                windows::hide(&app, false).await?;
            }
            notify(&app);
        }
        "ready" if [BAR, RESULTS, MENU].contains(&label) => windows::ready(&app, label).await?,
        "menu-open" if label == BAR => windows::menu_open(&app).await?,
        "menu-dismiss" if label == MENU => {
            windows::menu_close(&app, request["token"].as_u64()).await?
        }
        "menu-select" if label == MENU => {
            let token = request["token"].as_u64().ok_or("file-search:expired")?;
            let action = request["selected"]
                .as_str()
                .ok_or("file-search:invalid-request")?;
            if !["open", "hide", "disable"].contains(&action) {
                return Err("file-search:invalid-request".into());
            }
            windows::menu_close(&app, Some(token)).await?;
            match action {
                "open" => windows::open_tool(&app).await?,
                "hide" => windows::hide(&app, true).await?,
                "disable" => {
                    {
                        let mut s = lock(&state.inner);
                        let next = Preferences {
                            enabled: false,
                            ..s.preferences.clone()
                        };
                        save_preferences(&app, &next)?;
                        s.preferences = next;
                    }
                    windows::hide(&app, false).await?;
                }
                _ => {}
            }
        }
        "take-handoff" if label == "main" => {
            // Compatibility for older callers; each surface now owns its draft.
            return Ok(Value::Null)
        }
        "open-tool" if label == RESULTS => windows::open_tool(&app).await?,
        "expand" if label == BAR => windows::set_expanded(&app, true, true).await?,
        "collapse" if [BAR, RESULTS].contains(&label) => {
            windows::set_expanded(&app, false, false).await?
        }
        "hide" if [BAR, RESULTS, MENU].contains(&label) => windows::hide(&app, true).await?,
        "disable" if [BAR, RESULTS, MENU].contains(&label) => {
            {
                let _transition = state.transition.lock().await;
                let mut s = lock(&state.inner);
                let next = Preferences {
                    enabled: false,
                    ..s.preferences.clone()
                };
                save_preferences(&app, &next)?;
                s.preferences = next;
            }
            windows::hide(&app, false).await?;
        }
        "drag" if label == BAR => {
            window.start_dragging().map_err(|_| "file-search:window")?;
        }
        "query" if [BAR, RESULTS].contains(&label) => {
            ensure_query_surface(&state,label)?;
            let mut s = lock(&state.inner);
            let mut query =
                serde_json::from_value::<query::Query>(s.query.clone()).unwrap_or_default();
            if let Some(text) = request["text"].as_str() {
                query.text = text.to_owned();
            }
            if let Some(extension) = request["extension"].as_str() {
                query.extension = extension.to_owned();
            }
            if !request["sort"].is_null() {
                query.sort = serde_json::from_value(request["sort"].clone())
                    .map_err(|_| "file-search:query")?;
            }
            s.query = serde_json::to_value(query.normalized()?).map_err(|_| "file-search:query")?;
            drop(s);
            notify(&app);
        }
        "navigate" if label == BAR => {
            let key = request["key"].as_str().ok_or("file-search:query")?;
            if ![
                "ArrowDown",
                "ArrowUp",
                "Home",
                "End",
                "PageDown",
                "PageUp",
                "Enter",
                "Escape",
            ]
            .contains(&key)
            {
                return Err("file-search:query".into());
            }
            let _ = app.emit_to(RESULTS, "file-search-navigate", key);
        }
        _ => return Err("file-search:invalid-request".into()),
    }
    Ok(snapshot(&state))
}
fn ensure_query_surface(state: &FileSearchState,label: &str) -> Result<(),String> {
    let inner=lock(&state.inner);
    let permitted=if label=="main" {!inner.preferences.enabled} else {
        inner.preferences.enabled && inner.expanded && !inner.hidden && !inner.suspended
    };
    if permitted {Ok(())} else {Err("file-search:cancelled".into())}
}
#[cfg(test)]
mod surface_tests {
    use super::*;
    #[test]
    fn query_surfaces_are_mutually_exclusive_even_when_capsule_is_collapsed() {
        let state=FileSearchState::default();
        assert!(ensure_query_surface(&state,"main").is_ok());assert!(ensure_query_surface(&state,RESULTS).is_err());
        lock(&state.inner).preferences.enabled=true;
        assert!(ensure_query_surface(&state,"main").is_err());assert!(ensure_query_surface(&state,RESULTS).is_err());
        lock(&state.inner).expanded=true;
        assert!(ensure_query_surface(&state,RESULTS).is_ok());assert!(ensure_query_surface(&state,"main").is_err());
        lock(&state.inner).hidden=true;assert!(ensure_query_surface(&state,RESULTS).is_err());assert!(ensure_query_surface(&state,"main").is_err());
        lock(&state.inner).preferences.enabled=false;assert!(ensure_query_surface(&state,"main").is_ok());
    }
}

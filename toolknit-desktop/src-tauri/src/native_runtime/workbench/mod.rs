mod documents;
mod folders;
mod launcher;
#[cfg(all(test, windows))]
mod native_tests;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tauri::Manager;

pub(crate) use folders::FolderState;
pub(crate) use launcher::LauncherState;
pub(crate) fn bootstrap(app: &tauri::AppHandle) {
    launcher::bootstrap(app);
    folders::bootstrap(app);
}
pub(crate) fn shutdown(app: &tauri::AppHandle) {
    folders::shutdown(app);
}

fn app_folder(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    Ok(root)
}
fn string<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty() && !s.contains('\0'))
        .ok_or_else(|| format!("Invalid {key}"))
}
fn db(folder: &Path) -> Result<rusqlite::Connection, String> {
    let connection =
        rusqlite::Connection::open(folder.join("workbench.sqlite")).map_err(|e| e.to_string())?;
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    connection.execute_batch("PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS documents(path TEXT PRIMARY KEY, root TEXT NOT NULL, name TEXT NOT NULL, bytes INTEGER NOT NULL, modified INTEGER NOT NULL, text TEXT NOT NULL, truncated INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS folder_seen(rule TEXT NOT NULL,path TEXT NOT NULL,stamp TEXT NOT NULL,state TEXT NOT NULL,PRIMARY KEY(rule,path));
      CREATE TABLE IF NOT EXISTS folder_history(id INTEGER PRIMARY KEY AUTOINCREMENT,rule TEXT NOT NULL,path TEXT NOT NULL,state TEXT NOT NULL,message TEXT NOT NULL,output TEXT NOT NULL,created INTEGER NOT NULL);")
      .map_err(|e| e.to_string())?;
    Ok(connection)
}

#[tauri::command]
pub(crate) async fn document_content_index(
    app: tauri::AppHandle,
    request: Value,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || documents::dispatch(&app_folder(&app)?, request))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub(crate) async fn folder_automation(
    app: tauri::AppHandle,
    request: Value,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || folders::dispatch(&app, request))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub(crate) fn launcher_settings(app: tauri::AppHandle, request: Value) -> Result<Value, String> {
    launcher::dispatch(&app, request)
}

fn modified_ms(meta: &std::fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}
fn canonical_directory(value: &str) -> Result<PathBuf, String> {
    let path = Path::new(value);
    if !path.is_absolute() || value.contains('\0') {
        return Err("Choose an absolute folder path".into());
    }
    let resolved = path.canonicalize().map_err(|e| e.to_string())?;
    if !resolved.is_dir() {
        return Err("Folder does not exist".into());
    }
    Ok(resolved)
}

use super::*;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub(crate) struct LauncherState {
    shortcut: Mutex<Option<String>>,
    error: Mutex<Option<String>>,
    pending: AtomicBool,
}
impl Default for LauncherState {
    fn default() -> Self {
        Self {
            shortcut: Mutex::new(None),
            error: Mutex::new(None),
            pending: AtomicBool::new(false),
        }
    }
}
const DEFAULT: &str = "Ctrl+Shift+Space";

fn change(app: &tauri::AppHandle, value: Option<String>) -> Result<(), String> {
    let state = app.state::<LauncherState>();
    let old = state.shortcut.lock().map_err(|e| e.to_string())?.clone();
    if old == value {
        return Ok(());
    }
    if let Some(new) = value.as_deref() {
        if new.len() > 80 || !new.contains('+') || new.parse::<Shortcut>().is_err() {
            return Err("Invalid shortcut; include Ctrl, Alt, or Shift".into());
        }
        if app.global_shortcut().is_registered(new) {
            return Err("Shortcut is already in use".into());
        }
        app.global_shortcut()
            .on_shortcut(new, |app, _, event| {
                if event.state == ShortcutState::Pressed {
                    app.state::<LauncherState>()
                        .pending
                        .store(true, Ordering::Release);
                    super::super::runner::show_main_window(app);
                    if let Some(main) = app.get_webview_window("main") {
                        let _ = main.emit("toolknit-launcher-open", ());
                    }
                }
            })
            .map_err(|e| e.to_string())?;
    }
    if let Some(old) = old.as_deref() {
        if let Err(error) = app.global_shortcut().unregister(old) {
            if let Some(new) = value.as_deref() {
                let _ = app.global_shortcut().unregister(new);
            }
            return Err(error.to_string());
        }
    }
    *state.shortcut.lock().map_err(|e| e.to_string())? = value;
    *state.error.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}
pub(super) fn bootstrap(app: &tauri::AppHandle) {
    let configured = app_folder(app)
        .ok()
        .and_then(|folder| std::fs::read(folder.join("launcher.json")).ok())
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok());
    let value = match configured {
        Some(value) => value["shortcut"].as_str().map(str::to_string),
        None => Some(DEFAULT.into()),
    };
    if let Err(error) = change(app, value) {
        if let Ok(mut slot) = app.state::<LauncherState>().error.lock() {
            *slot = Some(error);
        }
    }
}
pub(super) fn dispatch(app: &tauri::AppHandle, request: Value) -> Result<Value, String> {
    let action = string(&request, "action")?;
    let state = app.state::<LauncherState>();
    if action == "save" {
        let value = request["shortcut"]
            .as_str()
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string);
        let old = state.shortcut.lock().map_err(|e| e.to_string())?.clone();
        change(app, value.clone())?;
        let folder = app_folder(app)?;
        if let Err(error) = std::fs::write(
            folder.join("launcher.json"),
            serde_json::to_vec(&json!({"shortcut":value})).map_err(|e| e.to_string())?,
        ) {
            let _ = change(app, old);
            return Err(error.to_string());
        }
    } else if action == "ack" {
        state.pending.store(false, Ordering::Release);
    } else if action != "status" {
        return Err("Unknown launcher action".into());
    }
    let shortcut = state.shortcut.lock().map_err(|e| e.to_string())?.clone();
    let error = state.error.lock().map_err(|e| e.to_string())?.clone();
    Ok(json!({"shortcut":shortcut,"error":error,"pending":state.pending.load(Ordering::Acquire)}))
}

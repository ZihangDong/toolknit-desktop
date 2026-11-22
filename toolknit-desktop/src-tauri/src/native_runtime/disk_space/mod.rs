mod engine;
#[cfg(test)]
mod tests;
use engine::{Report, Summary};
use serde::Deserialize;
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};

#[derive(Default)]
pub(crate) struct DiskSpaceState {
    inner: Mutex<Registry>,
}
#[derive(Default)]
struct Registry {
    active: Option<Arc<Job>>,
    report: Option<Arc<Report>>,
    cancelled: HashMap<String, Instant>,
}
struct Job {
    id: String,
    cancel: AtomicBool,
    retired: AtomicBool,
}
fn lock<T>(value: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    value.lock().unwrap_or_else(|e| e.into_inner())
}
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.'))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Request {
    action: String,
    job_id: String,
    root: Option<String>,
    node_id: Option<usize>,
    offset: Option<usize>,
    limit: Option<usize>,
}
fn reserve(state: &DiskSpaceState, id: &str) -> Result<Arc<Job>, String> {
    if !valid_id(id) {
        return Err("disk:request".into());
    }
    let mut registry = lock(&state.inner);
    registry
        .cancelled
        .retain(|_, at| at.elapsed() < Duration::from_secs(60));
    if registry.cancelled.remove(id).is_some() {
        return Err("disk:cancelled".into());
    }
    if registry.active.is_some() {
        return Err("disk:busy".into());
    }
    let job = Arc::new(Job {
        id: id.into(),
        cancel: AtomicBool::new(false),
        retired: AtomicBool::new(false),
    });
    registry.active = Some(job.clone());
    Ok(job)
}
fn finish(
    state: &DiskSpaceState,
    job: &Job,
    report: Result<Report, String>,
) -> Result<Summary, String> {
    let mut registry = lock(&state.inner);
    if registry
        .active
        .as_ref()
        .is_some_and(|active| active.id == job.id)
    {
        registry.active = None;
    }
    if job.retired.load(Ordering::SeqCst) {
        return Err("disk:cancelled".into());
    }
    let report = Arc::new(report?);
    let summary = report.summary.clone();
    registry.report = Some(report);
    Ok(summary)
}
fn cancel(state: &DiskSpaceState, id: &str, release: bool) -> bool {
    let mut registry = lock(&state.inner);
    let active = registry.active.as_ref().filter(|active| active.id == id);
    let accepted = if let Some(job) = active {
        job.cancel.store(true, Ordering::SeqCst);
        if release {
            job.retired.store(true, Ordering::SeqCst);
        }
        true
    } else {
        false
    };
    let completed = registry
        .report
        .as_ref()
        .is_some_and(|report| report.summary.job_id == id);
    if release && completed {
        registry.report = None;
    }
    if !accepted && !completed {
        registry
            .cancelled
            .retain(|_, at| at.elapsed() < Duration::from_secs(60));
        if registry.cancelled.len() < 32 {
            registry.cancelled.insert(id.into(), Instant::now());
        }
    }
    accepted
}
pub(crate) fn shutdown(app: &tauri::AppHandle) {
    let state = app.state::<DiskSpaceState>();
    let mut registry = lock(&state.inner);
    if let Some(job) = &registry.active {
        job.cancel.store(true, Ordering::SeqCst);
        job.retired.store(true, Ordering::SeqCst);
    }
    registry.report = None;
}

#[tauri::command]
pub(crate) async fn disk_space(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    request: Request,
) -> Result<serde_json::Value, String> {
    if window.label() != "main" {
        return Err("disk:forbidden".into());
    }
    if !valid_id(&request.job_id) {
        return Err("disk:request".into());
    }
    let state = app.state::<DiskSpaceState>();
    match request.action.as_str() {
        "start" => {
            let root = PathBuf::from(request.root.ok_or("disk:root")?);
            let job = reserve(&state, &request.job_id)?;
            let worker_job = job.clone();
            let worker_app = app.clone();
            let result = tauri::async_runtime::spawn_blocking(move || {
                engine::scan(
                    &root,
                    &worker_job.id,
                    &worker_job.cancel,
                    engine::Limits::default(),
                    |value| {
                        let _ = worker_app.emit_to("main", "disk-space-progress", value);
                    },
                )
            })
            .await
            .map_err(|_| "disk:worker".to_string())
            .and_then(|r| r);
            serde_json::to_value(finish(&state, &job, result)?).map_err(|_| "disk:result".into())
        }
        "cancel" | "release" => Ok(
            serde_json::json!({"accepted":cancel(&state,&request.job_id,request.action=="release")}),
        ),
        "children" => {
            let report = lock(&state.inner)
                .report
                .as_ref()
                .filter(|report| report.summary.job_id == request.job_id)
                .cloned()
                .ok_or("disk:expired")?;
            tauri::async_runtime::spawn_blocking(move || {
                serde_json::to_value(engine::view(
                    &report,
                    request.node_id.unwrap_or(0),
                    request.offset.unwrap_or(0),
                    request.limit.unwrap_or(100),
                )?)
                .map_err(|_| "disk:result".to_string())
            })
            .await
            .map_err(|_| "disk:worker".to_string())?
        }
        _ => Err("disk:request".into()),
    }
}

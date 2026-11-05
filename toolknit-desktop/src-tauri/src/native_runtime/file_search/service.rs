//! Validated query/reveal contracts shared by the page and floating pair.
use super::*;
#[path = "automatic.rs"]
mod automatic;
pub(super) async fn automatic_setup(app: &tauri::AppHandle, ordinary: bool) -> Result<Value, String> { automatic::setup(app, ordinary).await }
pub(super) async fn automatic_resume(app: &tauri::AppHandle, rebuild: bool) -> Result<Value, String> { automatic::resume(app, rebuild).await }
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
};

#[derive(Default)]
pub(super) struct Lease {
    ticket: String,
    generation: u64,
    query: query::Query,
    allowed: HashMap<u64, Arc<Path>>,
    fingerprint: String,
}
pub(super) fn cancel_configuration(state: &FileSearchState) {
    if let Some(cancel) = lock(&state.index_configuration).as_ref() {
        cancel.store(true, Ordering::Release);
    }
}
fn begin_configuration(state: &FileSearchState) -> Arc<AtomicBool> {
    let mut pending = lock(&state.index_configuration);
    if let Some(cancel) = pending.take() {
        cancel.store(true, Ordering::Release);
    }
    let cancel = Arc::new(AtomicBool::new(false));
    *pending = Some(cancel.clone());
    cancel
}
fn index(app: &tauri::AppHandle) -> Result<Arc<index::Index>, String> {
    let state = app.state::<FileSearchState>();
    let mut current = lock(&state.index);
    if let Some(value) = current.as_ref() {
        return Ok(value.clone());
    }
    let path = app
        .path()
        .app_data_dir()
        .map_err(|_| "file-search:storage")?
        .join("file-search/index.sqlite");
    let value = Arc::new(index::Index::new(path));
    *current = Some(value.clone());
    Ok(value)
}
pub(super) fn status(app: &tauri::AppHandle) -> Result<Value, String> {
    let state = app.state::<FileSearchState>();
    let status = index(app)?.status();
    let prefs = lock(&state.inner).preferences.clone();
    if prefs.automatic && prefs.acceleration && status.acceleration_error.as_ref().is_some_and(|code|
        code.contains("service-") || code.contains("protocol") || code.contains("identity")) {
        state.needs_service_repair.store(true, Ordering::Release);
    }
    Ok(
        json!({"index":status,"roots":prefs.roots,"defaultRoots":default_roots(),"window":snapshot(&state),
            "automatic":prefs.automatic,"setupBusy":state.setup_busy.load(Ordering::Acquire),
            "needsServiceRepair":state.needs_service_repair.load(Ordering::Acquire)}),
    )
}
fn default_roots() -> Vec<String> {
    [
        dirs::desktop_dir(),
        dirs::document_dir(),
        dirs::download_dir(),
    ]
    .into_iter()
    .flatten()
    .map(|p| p.to_string_lossy().into_owned())
    .collect()
}
pub(super) fn bootstrap(app: &tauri::AppHandle) {
    let prefs = lock(&app.state::<FileSearchState>().inner)
        .preferences
        .clone();
    if prefs.automatic { automatic::bootstrap(app); return; }
    let roots = prefs.roots;
    if roots.is_empty() {
        return;
    }
    let cancel = begin_configuration(&app.state::<FileSearchState>());
    let host = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = host.state::<FileSearchState>();
        let _guard = state.index_transition.lock().await;
        if cancel.load(Ordering::Acquire) || state.stopping.load(Ordering::Acquire) {
            return;
        }
        if let Ok(engine) = index(&host) {
            let starting = engine.clone();
            let _ = tauri::async_runtime::spawn_blocking(move || {
                starting.start_mode(
                    roots.into_iter().map(PathBuf::from).collect(),
                    prefs.acceleration,
                )
            })
            .await;
            if cancel.load(Ordering::Acquire) || state.stopping.load(Ordering::Acquire) {
                engine.stop();
            }
        }
    });
}
pub(super) async fn configure(
    app: &tauri::AppHandle,
    values: Vec<String>,
) -> Result<Value, String> {
    let state = app.state::<FileSearchState>();
    let _setup = state.setup_transition.lock().await;
    let cancel = begin_configuration(&state);
    let normalizing = cancel.clone();
    let roots = tauri::async_runtime::spawn_blocking(move || {
        index::normalize_roots_cancellable(&values, &normalizing)
    })
    .await
    .map_err(|_| "file-search:worker")??;
    let _guard = state.index_transition.lock().await;
    if cancel.load(Ordering::Acquire) || state.stopping.load(Ordering::Acquire) {
        return Err("file-search:cancelled".into());
    }
    let engine = index(app)?;
    let start = engine.clone();
    let new_roots = roots.clone();
    let accelerated = lock(&state.inner).preferences.acceleration;
    let starting = cancel.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if starting.load(Ordering::Acquire) {
            return Err("file-search:cancelled".into());
        }
        start.start_mode(new_roots, accelerated)
    })
    .await
    .map_err(|_| "file-search:worker")??;
    if cancel.load(Ordering::Acquire) || state.stopping.load(Ordering::Acquire) {
        engine.stop();
        return Err("file-search:cancelled".into());
    }
    {
        let mut s = lock(&state.inner);
        let mut next = s.preferences.clone();
        next.automatic = false;
        next.roots = roots
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect();
        if let Err(e) = save_preferences(app, &next) {
            engine.stop();
            return Err(e);
        }
        s.preferences = next;
    }
    *lock(&state.leases) = [Lease::default(), Lease::default()];
    notify(app);
    status(app)
}
pub(super) async fn clear(app: &tauri::AppHandle) -> Result<Value, String> {
    let state = app.state::<FileSearchState>();
    let _setup = state.setup_transition.lock().await;
    cancel_configuration(&state);
    let _guard = state.index_transition.lock().await;
    let engine = index(app)?;
    tauri::async_runtime::spawn_blocking(move || engine.clear())
        .await
        .map_err(|_| "file-search:worker")??;
    {
        let mut s = lock(&state.inner);
        let next = Preferences {
            roots: Vec::new(),
            automatic: false,
            ..s.preferences.clone()
        };
        save_preferences(app, &next)?;
        s.preferences = next;
    }
    *lock(&state.leases) = [Lease::default(), Lease::default()];
    notify(app);
    status(app)
}
pub(super) async fn acceleration_status(app: &tauri::AppHandle) -> Result<Value, String> {
    let enabled = lock(&app.state::<FileSearchState>().inner)
        .preferences
        .acceleration;
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(move||json!({"supported":true,"enabled":enabled,"installed":accelerator::installed(),"volumes":accelerator::volumes()})).await.map_err(|_|"file-search:worker".into())
    }
    #[cfg(not(windows))]
    {
        let _ = enabled;
        Ok(json!({"supported":false,"enabled":false,"installed":false,"volumes":[]}))
    }
}
pub(super) async fn acceleration_configure(
    app: &tauri::AppHandle,
    enabled: bool,
) -> Result<Value, String> {
    #[cfg(windows)]
    {
        let state = app.state::<FileSearchState>();
        let _guard = state.index_transition.lock().await;
        let previous = lock(&state.inner).preferences.clone();
        let resume = lock(&state.index)
            .as_ref()
            .filter(|index| {
                matches!(
                    index.status().phase.as_str(),
                    "loading" | "indexing" | "ready" | "partial"
                )
            })
            .cloned();
        if !enabled {
            if let Some(index) = lock(&state.index).as_ref() {
                index.stop();
            }
        }
        let mut outcome = tauri::async_runtime::spawn_blocking(move || {
            if enabled && accelerator::current() {
                Ok(())
            } else {
                accelerator::configure(!enabled)
            }
        })
        .await
        .map_err(|_| "file-search:worker".to_owned())
        .and_then(|result| result);
        if outcome.is_ok() {
            let mut s = lock(&state.inner);
            let mut next = s.preferences.clone();
            next.acceleration = enabled;
            outcome = save_preferences(app, &next);
            if outcome.is_ok() {
                s.preferences = next;
            }
        }
        if !enabled {
            if let Some(index) = resume {
                let roots = previous.roots.into_iter().map(PathBuf::from).collect();
                let accelerated = if outcome.is_ok() {
                    false
                } else {
                    previous.acceleration
                };
                tauri::async_runtime::spawn_blocking(move || index.start_mode(roots, accelerated))
                    .await
                    .map_err(|_| "file-search:worker")??;
            }
        }
        notify(app);
        outcome?;
        acceleration_status(app).await
    }
    #[cfg(not(windows))]
    {
        let _ = (app, enabled);
        Err("file-search:windows-only".into())
    }
}
pub(super) fn invalidate(app: &tauri::AppHandle, view: usize) -> Result<(), String> {
    index(app)?.shared.query_revisions[view].fetch_add(1, Ordering::AcqRel);
    lock(&app.state::<FileSearchState>().leases)[view] = Lease::default();
    Ok(())
}
pub(super) async fn search(
    app: &tauri::AppHandle,
    view: usize,
    query: query::Query,
    cursor: Option<Value>,
) -> Result<Value, String> {
    let query = query.normalized()?;
    let engine = index(app)?;
    let shared = engine.shared.clone();
    let revision = shared.query_revisions[view].fetch_add(1, Ordering::AcqRel) + 1;
    // Each surface owns one blocking query lane. Superseded requests leave
    // this async queue before allocating a worker or waiting on the catalog.
    let _worker = engine.shared.query_turn(view, revision).await?;
    let state = app.state::<FileSearchState>();
    let (after, ticket, expected) = if let Some(cursor) = cursor {
        let leases = lock(&state.leases);
        let lease = &leases[view];
        let ticket = cursor["ticket"].as_str().ok_or("file-search:stale-query")?;
        let id = cursor["after"]
            .as_str()
            .and_then(|s| s.parse::<u64>().ok())
            .ok_or("file-search:stale-query")?;
        if ticket != lease.ticket
            || !lease.allowed.contains_key(&id)
            || serde_json::to_value(&lease.query).ok() != serde_json::to_value(&query).ok()
        {
            return Err("file-search:stale-query".into());
        }
        (Some(id), ticket.to_owned(), Some(lease.generation))
    } else {
        let mut bytes = [0u8; 16];
        getrandom::getrandom(&mut bytes).map_err(|_| "file-search:query")?;
        lock(&state.leases)[view] = Lease::default();
        (None, hex::encode(bytes), None)
    };
    let run_query = query.clone();
    let (result, generation, paths) = tauri::async_runtime::spawn_blocking(move || {
        let catalog = shared.query_catalog(view, revision)?;
        if expected.is_some_and(|n| n != catalog.generation) {
            return Err("file-search:stale-query".into());
        }
        let pivot = after.map(|id| catalog.ids.get(&id).and_then(|at| catalog.entries.get(*at))
            .ok_or("file-search:stale-query")).transpose()?;
        let result = query::search_with_metadata(&catalog.entries, &run_query, 50, pivot, Some(&catalog.extensions), || {
            shared.query_revisions[view].load(Ordering::Acquire) != revision
        })?;
        let paths = result
            .rows
            .iter()
            .filter_map(|r| {
                let id = r.id.parse::<u64>().ok()?;
                let entry = catalog.ids.get(&id).and_then(|i| catalog.entries.get(*i))?;
                Some((id, entry.path.clone()))
            })
            .collect::<HashMap<_, _>>();
        Ok::<_, String>((result, catalog.generation, paths))
    })
    .await
    .map_err(|_| "file-search:worker")??;
    if engine.shared.query_revisions[view].load(Ordering::Acquire) != revision {
        return Err("file-search:cancelled".into());
    }
    {
        let mut leases = lock(&state.leases);
        if engine.shared.query_revisions[view].load(Ordering::Acquire) != revision {
            return Err("file-search:cancelled".into());
        }
        let lease = &mut leases[view];
        if after.is_none() {
            *lease = Lease {
                ticket: ticket.clone(),
                generation,
                query: query.clone(),
                allowed: paths,
                fingerprint: result.fingerprint.clone(),
            };
        } else {
            lease.allowed.extend(paths);
            if lease.allowed.len() > 10000 {
                return Err("file-search:query-limit".into());
            }
        }
    }
    let cursor = result.more.then(
        || json!({"ticket":ticket,"after":result.rows.last().map(|r|r.id.as_str()).unwrap_or("")}),
    );
    Ok(
        json!({"query":query,"result":result,"cursor":cursor,"ticket":ticket,"generation":generation,"index":engine.status()}),
    )
}
pub(super) async fn check_query(app: &tauri::AppHandle, view: usize, ticket: &str) -> Result<Value, String> {
    let engine=index(app)?; let shared=engine.shared.clone();
    let revision=shared.query_revisions[view].load(Ordering::Acquire);
    let _turn=engine.shared.query_turn(view,revision).await?;
    let (query, previous)={
        let state=app.state::<FileSearchState>(); let leases=lock(&state.leases); let lease=&leases[view];
        if ticket.is_empty() || lease.ticket!=ticket {return Err("file-search:stale-query".into());}
        (lease.query.clone(),lease.fingerprint.clone())
    };
    let (changed,generation,extensions)=tauri::async_runtime::spawn_blocking(move||{
        let catalog=shared.query_catalog(view,revision)?;
        let result=query::search_with_metadata(&catalog.entries,&query,1,None,Some(&catalog.extensions),||shared.query_revisions[view].load(Ordering::Acquire)!=revision)?;
        Ok::<_,String>((result.fingerprint!=previous,catalog.generation,result.extensions))
    }).await.map_err(|_|"file-search:worker")??;
    let state=app.state::<FileSearchState>(); let mut leases=lock(&state.leases); let lease=&mut leases[view];
    if lease.ticket!=ticket || engine.shared.query_revisions[view].load(Ordering::Acquire)!=revision {return Err("file-search:cancelled".into());}
    // The same matching set keeps its cursor usable even if another file changed.
    if !changed {lease.generation=generation;}
    Ok(json!({"changed":changed,"generation":generation,"extensions":extensions}))
}
pub(super) async fn reveal(
    app: &tauri::AppHandle,
    view: usize,
    id: &str,
    ticket: &str,
) -> Result<(), String> {
    let id = id.parse::<u64>().map_err(|_| "file-search:stale-query")?;
    let engine = index(app)?;
    let state = app.state::<FileSearchState>();
    let roots = lock(&state.inner)
        .preferences
        .roots
        .iter()
        .map(PathBuf::from)
        .collect::<Vec<_>>();
    let path = {
        let leases = lock(&state.leases);
        let lease = &leases[view];
        if ticket != lease.ticket || ticket.is_empty() || !lease.allowed.contains_key(&id) {
            return Err("file-search:stale-query".into());
        }
        let catalog = engine
            .shared
            .catalog
            .read()
            .unwrap_or_else(|e| e.into_inner());
        let entry = catalog
            .ids
            .get(&id)
            .and_then(|i| catalog.entries.get(*i))
            .ok_or("file-search:unavailable")?;
        if lease.allowed.get(&id) != Some(&entry.path) {
            return Err("file-search:stale-query".into());
        }
        if !roots.iter().any(|r| entry.path.starts_with(r)) {
            return Err("file-search:forbidden".into());
        }
        entry.path.clone()
    };
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        #[cfg(windows)]
        if super::filesystem_worker::remote(&path) {
            let root = roots
                .iter()
                .find(|r| path.starts_with(r))
                .ok_or("file-search:forbidden")?;
            return super::filesystem_worker::reveal(&path, root);
        }
        let parent = path
            .parent()
            .ok_or("file-search:unavailable")?
            .canonicalize()
            .map_err(|_| "file-search:unavailable")?;
        if !roots.iter().any(|r| r.canonicalize().is_ok_and(|root| parent.starts_with(root))) {
            return Err("file-search:forbidden".into());
        }
        crate::platform::file_location::reveal_file(&path)
    })
    .await
    .map_err(|_| "file-search:worker")?;
    if outcome.is_err() {
        engine
            .shared
            .repair_requested
            .store(true, Ordering::Release);
    }
    outcome
}

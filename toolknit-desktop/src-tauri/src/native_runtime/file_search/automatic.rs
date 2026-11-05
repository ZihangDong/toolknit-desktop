//! User-enabled automatic mode. Only setup may request elevation; background
//! discovery/resume never does. Old custom scopes remain recoverable metadata.
use super::*;
use std::time::Duration;

struct Busy<'a>(&'a AtomicBool);
impl Drop for Busy<'_> { fn drop(&mut self) { self.0.store(false, Ordering::Release); } }
async fn locations(app: &tauri::AppHandle, cancel: Arc<AtomicBool>) -> Result<Vec<discovery::Location>, String> {
    let state = app.state::<FileSearchState>();
    let prefs = lock(&state.inner).preferences.clone();
    let legacy = prefs.legacy_roots.unwrap_or(prefs.roots);
    let mut found = tauri::async_runtime::spawn_blocking(move || discovery::discover(&legacy, &cancel))
        .await.map_err(|_| "file-search:worker")??;
    // Keep a detached device's cached results marked unverified; never silently
    // reinterpret its cache when another device takes the same drive letter.
    for old in lock(&state.auto_locations).iter() {
        if !found.iter().any(|v| v.root == old.root || v.identity == old.identity) {
            let mut unavailable = old.clone(); unavailable.available = false; found.push(unavailable);
        }
    }
    found.sort_by(|a,b| a.root.cmp(&b.root));
    if found.len() > 256 { return Err("file-search:scope".into()); }
    Ok(found)
}
async fn start(app: &tauri::AppHandle, found: Vec<discovery::Location>, acceleration: bool, cancel: Arc<AtomicBool>) -> Result<Value, String> {
    let state = app.state::<FileSearchState>();
    let _transition = state.index_transition.lock().await;
    if cancel.load(Ordering::Acquire) || state.stopping.load(Ordering::Acquire) { return Err("file-search:cancelled".into()); }
    let engine = index(app)?;
    let policy = scope_policy::Policy::automatic(&app.path().app_data_dir().map_err(|_| "file-search:storage")?)?
        .with_volumes(found.iter().filter(|v| !v.remote).map(|v| (v.root.clone(), v.identity.clone())).collect());
    let roots = found.iter().map(|v| v.root.clone()).collect::<Vec<_>>();
    let worker = engine.clone();
    tauri::async_runtime::spawn_blocking(move || worker.start_policy(roots, acceleration, policy)).await.map_err(|_| "file-search:worker")??;
    if cancel.load(Ordering::Acquire) || state.stopping.load(Ordering::Acquire) { engine.stop(); return Err("file-search:cancelled".into()); }
    {
        let mut s = lock(&state.inner); let mut next = s.preferences.clone();
        if !next.automatic && next.legacy_roots.is_none() { next.legacy_roots = Some(next.roots.clone()); }
        next.automatic = true; next.roots = found.iter().map(|v| v.root.to_string_lossy().into_owned()).collect();
        if let Err(e) = save_preferences(app, &next) { engine.stop(); return Err(e); }
        s.preferences = next;
    }
    *lock(&state.auto_locations) = found;
    *lock(&state.leases) = Default::default(); notify(app); status(app)
}
pub(super) async fn setup(app: &tauri::AppHandle, ordinary: bool) -> Result<Value, String> {
    let state = app.state::<FileSearchState>(); let _setup = state.setup_transition.lock().await;
    state.setup_busy.store(true, Ordering::Release); let _busy = Busy(&state.setup_busy);
    let cancel = begin_configuration(&state); let found = locations(app, cancel.clone()).await?;
    let acceleration = !ordinary && found.iter().any(|v| v.fast && v.available);
    if acceleration { acceleration_configure(app, true).await?; }
    if ordinary || !acceleration {
        let mut s = lock(&state.inner); let mut next = s.preferences.clone(); next.acceleration = false;
        save_preferences(app, &next)?; s.preferences = next;
    }
    state.needs_service_repair.store(false, Ordering::Release); state.index_paused.store(false, Ordering::Release);
    start(app, found, acceleration, cancel).await?;
    drop(_busy);
    monitor(app); notify(app); status(app)
}
pub(super) async fn resume(app: &tauri::AppHandle, rebuild: bool) -> Result<Value, String> {
    let state = app.state::<FileSearchState>(); let _setup = state.setup_transition.lock().await;
    if !lock(&state.inner).preferences.automatic { return Err("file-search:setup-required".into()); }
    let cancel = begin_configuration(&state); let found = locations(app, cancel.clone()).await?;
    if rebuild {
        let _transition = state.index_transition.lock().await; let worker = index(app)?;
        tauri::async_runtime::spawn_blocking(move || worker.clear()).await.map_err(|_| "file-search:worker")??;
    }
    let wanted = lock(&state.inner).preferences.acceleration;
    #[cfg(windows)]
    let acceleration = wanted && tauri::async_runtime::spawn_blocking(accelerator::current).await.map_err(|_| "file-search:worker")?;
    #[cfg(not(windows))]
    let acceleration = false;
    state.needs_service_repair.store(wanted && !acceleration, Ordering::Release);
    state.index_paused.store(false, Ordering::Release);
    let result = start(app, found, acceleration, cancel).await?;
    monitor(app); Ok(result)
}
pub(super) fn bootstrap(app: &tauri::AppHandle) {
    let app = app.clone(); tauri::async_runtime::spawn(async move {
        if let Err(code) = resume(&app, false).await {
            if let Ok(engine) = index(&app) { let mut status = lock(&engine.shared.status); status.phase = "error".into(); status.error = Some(code); }
        }
        monitor(&app);
    });
}
fn monitor(app: &tauri::AppHandle) {
    if app.state::<FileSearchState>().auto_monitor_started.swap(true, Ordering::AcqRel) { return; }
    let app = app.clone(); tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(30)).await;
            let state = app.state::<FileSearchState>();
            if state.stopping.load(Ordering::Acquire) { break; }
            if state.index_paused.load(Ordering::Acquire) || !lock(&state.inner).preferences.automatic { continue; }
            let Ok(_setup) = state.setup_transition.try_lock() else { continue; };
            let cancel = begin_configuration(&state);
            if let Ok(found) = locations(&app, cancel.clone()).await {
                if found != *lock(&state.auto_locations) {
                    let acceleration = lock(&state.inner).preferences.acceleration && !state.needs_service_repair.load(Ordering::Acquire);
                    let _ = start(&app, found, acceleration, cancel).await;
                }
            }
        }
    });
}

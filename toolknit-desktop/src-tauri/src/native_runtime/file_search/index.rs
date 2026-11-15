//! One app-owned metadata worker. UI lifetimes never stop the shared index.
use super::{lock, query::Entry, storage};
use notify::{RecursiveMode, Watcher};
#[cfg(windows)]
#[path = "index_fast.rs"]
mod fast;
#[cfg(windows)]
#[path = "index_remote.rs"]
mod remote;
use serde::Serialize;
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
        mpsc, Arc, Mutex, RwLock,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const LIMIT: usize = 5_000_000;
#[derive(Default)]
pub(super) struct Catalog {
    pub entries: Vec<Entry>,
    pub paths: HashMap<Arc<Path>, usize>,
    parents: HashMap<Arc<str>, usize>,
    pub ids: HashMap<u64, usize>,
    pub extensions: BTreeMap<String, usize>,
    pub generation: u64,
}
impl Catalog {
    pub(super) fn insert(&mut self, mut e: Entry) {
        if let Some(&at) = self.paths.get(&e.path) {
            let previous = &self.entries[at];
            if previous.id == e.id
                && previous.name == e.name
                && previous.parent == e.parent
                && previous.extension == e.extension
                && previous.size == e.size
                && previous.modified == e.modified
                && previous.verified == e.verified
            {
                return;
            }
            if previous.parent == e.parent {
                e.parent = previous.parent.clone();
            } else {
                let old_parent = previous.parent.clone();
                e.parent = self.retain_parent(e.parent);
                self.release_parent(&old_parent);
            }
            let previous = &self.entries[at];
            if previous.extension != e.extension {
                let old_extension = previous.extension.clone();
                self.release_extension(&old_extension);
                *self.extensions.entry(e.extension.clone()).or_default() += 1;
            }
            e.path = self.entries[at].path.clone();
            self.ids.remove(&self.entries[at].id);
            self.ids.insert(e.id, at);
            self.entries[at] = e;
        } else {
            e.parent = self.retain_parent(e.parent);
            *self.extensions.entry(e.extension.clone()).or_default() += 1;
            let at = self.entries.len();
            self.paths.insert(e.path.clone(), at);
            self.ids.insert(e.id, at);
            self.entries.push(e);
        }
        self.generation = self.generation.wrapping_add(1);
    }
    fn remove(&mut self, path: &Path) {
        if let Some(at) = self.paths.remove(path) {
            self.generation = self.generation.wrapping_add(1);
            let removed = self.entries.swap_remove(at);
            self.release_parent(&removed.parent);
            self.release_extension(&removed.extension);
            self.ids.remove(&removed.id);
            if let Some(moved) = self.entries.get(at) {
                self.paths.insert(moved.path.clone(), at);
                self.ids.insert(moved.id, at);
            }
        }
    }
    fn retain_parent(&mut self, mut parent: Arc<str>) -> Arc<str> {
        if let Some((existing, _)) = self.parents.get_key_value(parent.as_ref()) {
            parent = existing.clone();
        }
        *self.parents.entry(parent.clone()).or_default() += 1;
        parent
    }
    fn release_parent(&mut self, parent: &str) {
        if let Some(count) = self.parents.get_mut(parent) {
            *count -= 1;
            if *count == 0 { self.parents.remove(parent); }
        }
    }
    fn release_extension(&mut self, extension: &str) {
        if let Some(count) = self.extensions.get_mut(extension) {
            *count -= 1;
            if *count == 0 { self.extensions.remove(extension); }
        }
    }
    fn matching_paths(&self, path: &Path) -> Vec<Arc<Path>> {
        // A directory may have become a file before queued notifications were
        // consumed. Keep prefix semantics even when an exact cached hit exists.
        self.entries.iter().filter(|entry| entry.path.starts_with(path)).map(|entry| entry.path.clone()).collect()
    }
}
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Status {
    pub phase: String,
    pub indexed: usize,
    pub skipped: usize,
    pub roots: Vec<String>,
    pub unavailable: Vec<String>,
    pub error: Option<String>,
    pub generation: u64,
    pub accelerated: bool,
    pub acceleration_error: Option<String>,
}
pub(super) struct Shared {
    pub catalog: RwLock<Catalog>,
    pub status: Mutex<Status>,
    pub query_revisions: [AtomicU64; 2],
    pub query_workers: [tokio::sync::Mutex<()>; 2],
    pub repair_requested: AtomicBool,
    remote_pending: AtomicUsize,
    settled: AtomicBool,
    skipped_by_root: Mutex<HashMap<PathBuf, usize>>,
}
impl Default for Shared {
    fn default() -> Self {
        Self {
            catalog: RwLock::new(Catalog::default()),
            status: Mutex::new(Status {
                phase: "unconfigured".into(),
                ..Default::default()
            }),
            query_revisions: Default::default(),
            query_workers: Default::default(),
            repair_requested: AtomicBool::new(false),
            remote_pending: AtomicUsize::new(0),
            settled: AtomicBool::new(false),
            skipped_by_root: Mutex::new(HashMap::new()),
        }
    }
}
impl Shared {
    pub async fn query_turn(&self, view: usize, revision: u64) -> Result<tokio::sync::MutexGuard<'_, ()>, String> {
        let turn = self.query_workers[view].lock().await;
        if self.query_revisions[view].load(Ordering::Acquire) != revision { return Err("file-search:cancelled".into()); }
        Ok(turn)
    }
    pub fn query_catalog(&self, view: usize, revision: u64) -> Result<std::sync::RwLockReadGuard<'_, Catalog>, String> {
        loop {
            if self.query_revisions[view].load(Ordering::Acquire) != revision { return Err("file-search:cancelled".into()); }
            match self.catalog.try_read() {
                Ok(catalog) => return Ok(catalog),
                Err(std::sync::TryLockError::Poisoned(error)) => return Ok(error.into_inner()),
                Err(std::sync::TryLockError::WouldBlock) => std::thread::sleep(Duration::from_millis(2)),
            }
        }
    }
}
struct Worker {
    cancel: Arc<AtomicBool>,
    join: std::thread::JoinHandle<()>,
}
pub(super) struct Index {
    pub shared: Arc<Shared>,
    worker: Mutex<Option<Worker>>,
    path: PathBuf,
}
impl Index {
    pub fn new(path: PathBuf) -> Self {
        Self {
            shared: Arc::default(),
            worker: Mutex::new(None),
            path,
        }
    }
    #[cfg(test)]
    pub fn start(&self, roots: Vec<PathBuf>) -> Result<(), String> {
        self.start_mode(roots, false)
    }
    pub fn start_mode(&self, roots: Vec<PathBuf>, accelerated: bool) -> Result<(), String> {
        self.start_policy(roots, accelerated, super::scope_policy::Policy::default())
    }
    pub fn start_policy(&self, roots: Vec<PathBuf>, accelerated: bool, policy: super::scope_policy::Policy) -> Result<(), String> {
        let mut worker = lock(&self.worker);
        if let Some(old) = worker.take() {
            old.cancel.store(true, Ordering::Release);
            old.join.join().map_err(|_| "file-search:worker")?;
        }
        for revision in &self.shared.query_revisions {
            revision.fetch_add(1, Ordering::AcqRel);
        }
        write_catalog(&self.shared, |c| {
            let generation = c.generation.wrapping_add(1);
            *c = Catalog {
                generation,
                ..Default::default()
            };
        });
        let shared = self.shared.clone();
        lock(&shared.skipped_by_root).clear();
        shared.remote_pending.store(0, Ordering::Release);
        shared.settled.store(false, Ordering::Release);
        let cancel = Arc::new(AtomicBool::new(false));
        let stopped = cancel.clone();
        let path = self.path.clone();
        *lock(&shared.status) = Status {
            phase: "loading".into(),
            generation: shared.catalog.read().unwrap_or_else(|e|e.into_inner()).generation,
            accelerated,
            roots: roots
                .iter()
                .map(|p| p.to_string_lossy().into_owned())
                .collect(),
            ..Default::default()
        };
        let join = std::thread::Builder::new()
            .name("toolknit-file-index".into())
            .spawn(move || {
                if let Err(code) = run(&path, &roots, &shared, &stopped, accelerated, policy) {
                    let mut status = lock(&shared.status);
                    status.phase = if stopped.load(Ordering::Acquire) {
                        "stopped"
                    } else {
                        "error"
                    }
                    .into();
                    status.error = Some(code);
                }
            })
            .map_err(|_| "file-search:worker")?;
        *worker = Some(Worker { cancel, join });
        Ok(())
    }
    pub fn stop(&self) {
        if let Some(w) = lock(&self.worker).as_ref() {
            w.cancel.store(true, Ordering::Release);
        }
    }
    pub fn clear(&self) -> Result<(), String> {
        for revision in &self.shared.query_revisions {
            revision.fetch_add(1, Ordering::AcqRel);
        }
        let mut worker = lock(&self.worker);
        if let Some(old) = worker.take() {
            old.cancel.store(true, Ordering::Release);
            old.join.join().map_err(|_| "file-search:worker")?;
        }
        let parent = self.path.parent().ok_or("file-search:storage")?;
        if std::fs::symlink_metadata(parent).is_ok_and(|m| storage::reparse(&m)) {
            return Err("file-search:storage".into());
        }
        for name in ["index.sqlite", "index.sqlite-wal", "index.sqlite-shm"] {
            let path = parent.join(name);
            if let Err(error) = std::fs::remove_file(path) {
                if error.kind() != std::io::ErrorKind::NotFound {
                    return Err("file-search:storage".into());
                }
            }
        }
        write_catalog(&self.shared, |c| {
            let generation = c.generation.wrapping_add(1);
            *c = Catalog {
                generation,
                ..Default::default()
            };
        });
        *lock(&self.shared.status) = Status {
            phase: "unconfigured".into(),
            generation: self.shared.catalog.read().unwrap_or_else(|e|e.into_inner()).generation,
            ..Default::default()
        };
        lock(&self.shared.skipped_by_root).clear();
        Ok(())
    }
    pub fn status(&self) -> Status {
        lock(&self.shared.status).clone()
    }
}
impl Drop for Index {
    fn drop(&mut self) {
        if let Some(worker) = lock(&self.worker).take() {
            worker.cancel.store(true, Ordering::Release);
            let _ = worker.join.join();
        }
    }
}

#[cfg(test)]
pub(super) fn normalize_roots(values: &[String]) -> Result<Vec<PathBuf>, String> {
    normalize_roots_cancellable(values, &AtomicBool::new(false))
}
pub(super) fn normalize_roots_cancellable(
    values: &[String],
    cancel: &AtomicBool,
) -> Result<Vec<PathBuf>, String> {
    if values.is_empty() || values.len() > 32 {
        return Err("file-search:scope".into());
    }
    let mut roots = Vec::new();
    for value in values {
        if cancel.load(Ordering::Acquire) {
            return Err("file-search:cancelled".into());
        }
        if value.len() > 32768 || value.chars().any(|c| c.is_control()) {
            return Err("file-search:scope".into());
        }
        let path = PathBuf::from(value);
        validate_local_scope(&path)?;
        #[cfg(windows)]
        if super::filesystem_worker::remote(&path) {
            roots.push(super::filesystem_worker::normalize(&path, cancel)?);
            continue;
        }
        if !path.is_absolute()
            || path
                .components()
                .any(|c| matches!(c, std::path::Component::ParentDir))
        {
            return Err("file-search:scope".into());
        }
        let resolved = path
            .canonicalize()
            .map_err(|_| "file-search:scope-unavailable")?;
        if !resolved.is_dir() {
            return Err("file-search:scope".into());
        }
        roots.push(resolved);
    }
    roots.sort();
    roots.dedup();
    let filtered = roots
        .iter()
        .filter(|p| !roots.iter().any(|r| r != *p && p.starts_with(r)))
        .cloned()
        .collect();
    Ok(filtered)
}
pub(super) fn validate_local_scope(path: &Path) -> Result<(), String> {
    if !path.is_absolute()
        || path
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("file-search:scope".into());
    }
    #[cfg(windows)]
    {
        super::filesystem_worker::validate_path(path)?;
    }
    Ok(())
}
fn write_catalog<T>(shared: &Shared, f: impl FnOnce(&mut Catalog) -> T) -> T {
    f(&mut shared.catalog.write().unwrap_or_else(|e| e.into_inner()))
}
fn publish(shared: &Shared, phase: &str) {
    let (count, generation) = {
        let catalog = shared.catalog.read().unwrap_or_else(|e| e.into_inner());
        (catalog.entries.len(), catalog.generation)
    };
    let mut status = lock(&shared.status);
    if phase=="ready" && shared.remote_pending.load(Ordering::Acquire)==0 { shared.settled.store(true,Ordering::Release); }
    // Once usable, ordinary reconciliation is background maintenance. Report
    // unavailable/partial coverage truthfully without replaying initial loading.
    let phase=if phase=="indexing" && shared.settled.load(Ordering::Acquire) {"ready"} else {phase};
    status.phase = if phase == "ready" && shared.remote_pending.load(Ordering::Acquire) > 0 && !shared.settled.load(Ordering::Acquire) {
        "indexing"
    } else if phase == "ready" && (status.skipped > 0 || !status.unavailable.is_empty()) {
        "partial"
    } else {
        phase
    }
    .into();
    status.indexed = count;
    status.generation = generation;
}
fn run(
    path: &Path,
    roots: &[PathBuf],
    shared: &Shared,
    cancel: &Arc<AtomicBool>,
    accelerated: bool,
    policy: super::scope_policy::Policy,
) -> Result<(), String> {
    let store = storage::Store::open_policy(path, policy)?;
    // Build outside the shared write lock. Streaming avoids retaining a second
    // complete set of decoded paths and duplicate parent strings at startup.
    let mut restored = Catalog::default();
    store.visit(roots, || cancel.load(Ordering::Acquire), |entry| {
        restored.insert(entry); Ok(())
    })?;
    if cancel.load(Ordering::Acquire) { return Err("file-search:cancelled".into()); }
    write_catalog(shared, |c| {
        restored.generation = c.generation.wrapping_add(1);
        *c = restored;
    });
    publish(shared, "indexing");
    // Bounded notifications. Overflow is explicitly repaired with a rescan.
    let (tx, rx) = mpsc::sync_channel(4096);
    let overflow = Arc::new(AtomicBool::new(false));
    let out = overflow.clone();
    let watch_policy = store.policy.clone();
    let cache_directory = path.parent().unwrap_or(path).to_path_buf();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        // Filter noise before the bounded queue. Keep complete rename pairs if
        // either endpoint is visible, so moving out of an exclusion still adds.
        if let Ok(e) = &event {
            if !e.need_rescan() && !e.paths.is_empty() && e.paths.iter().all(|p|
                p.starts_with(&cache_directory) || watch_policy.excludes(p)) { return; }
        }
        if !matches!(&event,Ok(e) if matches!(e.kind,notify::EventKind::Access(_)))
            && tx.try_send(event).is_err()
        {
            out.store(true, Ordering::Release);
        }
    })
    .map_err(|_| "file-search:watcher")?;
    for root in roots {
        #[cfg(windows)]
        if super::filesystem_worker::remote(root) {
            continue;
        }
        if watcher.watch(root, RecursiveMode::Recursive).is_err() {
            lock(&shared.status)
                .unavailable
                .push(root.to_string_lossy().into_owned());
        }
    }
    #[cfg(windows)]
    let (remote_roots, local_roots): (Vec<_>, Vec<_>) = roots.iter().cloned().partition(|r| super::filesystem_worker::remote(r));
    #[cfg(windows)]
    let mut remote = remote::Pump::start(remote_roots, store.policy.clone(), cancel.clone(), shared)?;
    #[cfg(windows)]
    let roots = local_roots.as_slice();
    scan_roots(roots, &store, shared, cancel, accelerated)?;
    let mut last_repair = Instant::now();
    let mut pending = HashSet::new();
    let mut next_flush = Instant::now();
    while !cancel.load(Ordering::Acquire) {
        #[cfg(windows)]
        remote.poll(&store, shared)?;
        match rx.recv_timeout(Duration::from_millis(150)) {
            Ok(Ok(event)) => {
                if event.need_rescan() {
                    overflow.store(true, Ordering::Release);
                }
                // Windows resolves the old spelling after a case-only rename.
                // Do not use existence checks to decide whether that old entry
                // should remain in the cache.
                let rename_source = matches!(
                    event.kind,
                    notify::EventKind::Modify(notify::event::ModifyKind::Name(
                        notify::event::RenameMode::Both | notify::event::RenameMode::From
                    ))
                );
                if rename_source {
                    if let Some(old) = event
                        .paths
                        .first()
                        .filter(|p| roots.iter().any(|r| p.starts_with(r)))
                    {
                        forget(old, &store, shared)?;
                    }
                }
                for path in event.paths.into_iter().skip(usize::from(rename_source)) {
                    if !store.excludes(&path) && roots.iter().any(|r| path.starts_with(r)) {
                        pending.insert(path);
                    }
                }
            }
            Ok(Err(_)) => {
                overflow.store(true, Ordering::Release);
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
        if pending.len() > 4096 {
            pending.clear();
            overflow.store(true, Ordering::Release);
        }
        if !pending.is_empty() && Instant::now() >= next_flush {
            let paths = pending.drain().collect::<Vec<_>>();
            for path in paths {
                if cancel.load(Ordering::Acquire) {
                    break;
                }
                refresh(&path, roots, &store, shared, cancel)?;
            }
            publish(shared, "ready");
            next_flush = Instant::now() + Duration::from_millis(350);
        }
        if ((overflow.load(Ordering::Acquire) || shared.repair_requested.load(Ordering::Acquire))
            && last_repair.elapsed() >= Duration::from_secs(2))
            || last_repair.elapsed() >= Duration::from_secs(if store.policy.spec().is_some() { 1800 } else { 300 })
        {
            overflow.store(false, Ordering::Release);
            shared.repair_requested.store(false, Ordering::Release);
            #[cfg(windows)]
            remote.refresh();
            // Removable disks may have returned after their original watcher
            // failed. Reattach before repairing the event gap with a scan.
            lock(&shared.status).unavailable.retain(|p| !roots.iter().any(|r| r == Path::new(p)));
            for root in roots {
                #[cfg(windows)]
                if super::filesystem_worker::remote(root) {
                    continue;
                }
                let _ = watcher.unwatch(root);
                if watcher.watch(root, RecursiveMode::Recursive).is_err() {
                    lock(&shared.status)
                        .unavailable
                        .push(root.to_string_lossy().into_owned());
                }
            }
            scan_roots(roots, &store, shared, cancel, accelerated)?;
            last_repair = Instant::now();
        }
    }
    drop(watcher);
    #[cfg(windows)]
    drop(remote);
    store.checkpoint()?;
    publish(shared, "stopped");
    Ok(())
}
fn scan_roots(
    roots: &[PathBuf],
    store: &storage::Store,
    shared: &Shared,
    cancel: &Arc<AtomicBool>,
    accelerated: bool,
) -> Result<(), String> {
    publish(shared, "indexing");
    #[cfg(windows)]
    let fast = if accelerated {
        fast::run(roots, store, shared, cancel)
    } else {
        HashSet::new()
    };
    #[cfg(not(windows))]
    let fast: HashSet<PathBuf> = {
        let _ = accelerated;
        HashSet::new()
    };
    for root in roots {
        if fast.contains(root) {
            lock(&shared.skipped_by_root).remove(root);
            continue;
        }
        if cancel.load(Ordering::Acquire) {
            return Ok(());
        }
        let mut seen = HashSet::new();
        let mut incomplete = false;
        // A remote refresh covers only its roots. Preserve failures belonging
        // to other scopes instead of briefly advertising the whole index ready.
        let other_skipped = lock(&shared.skipped_by_root)
            .iter()
            .filter(|(p, _)| *p != root)
            .map(|(_, n)| *n)
            .sum::<usize>();
        lock(&shared.status).skipped = other_skipped;
        scan(root, store, shared, cancel, &mut seen, &mut incomplete)?;
        let own_skipped = lock(&shared.status).skipped.saturating_sub(other_skipped);
        lock(&shared.skipped_by_root).insert(root.clone(), own_skipped);
        if !incomplete && !cancel.load(Ordering::Acquire) {
            prune_scope(root, &seen, store, shared)?;
        } else if incomplete {
            mark_unseen_stale(root,&seen,store,shared);
        }
    }
    lock(&shared.status).skipped = lock(&shared.skipped_by_root).values().copied().sum();
    publish(
        shared,
        if cancel.load(Ordering::Acquire) {
            "stopped"
        } else {
            "ready"
        },
    );
    Ok(())
}
fn mark_unseen_stale(root: &Path, seen: &HashSet<PathBuf>, store: &storage::Store, shared: &Shared) {
    let roots=[root.to_path_buf()];
    write_catalog(shared,|catalog|{
        let mut changed=false;
        for entry in &mut catalog.entries {
            if entry.verified && store.policy.in_roots(&entry.path,&roots) && !seen.contains(entry.path.as_ref()) {entry.verified=false;changed=true;}
        }
        if changed {catalog.generation=catalog.generation.wrapping_add(1);}
    });
}
fn prune_scope(root: &Path, seen: &HashSet<PathBuf>, store: &storage::Store, shared: &Shared) -> Result<(), String> {
    let roots = [root.to_path_buf()];
    let removed = {
        let c = shared.catalog.read().unwrap_or_else(|e| e.into_inner());
        c.entries.iter().filter(|e| store.policy.in_roots(&e.path, &roots) && !seen.contains(e.path.as_ref()))
            .map(|e| e.path.clone()).collect::<Vec<_>>()
    };
    remove_cached_paths(&removed, store, shared)
}
fn scan(
    root: &Path,
    store: &storage::Store,
    shared: &Shared,
    cancel: &AtomicBool,
    seen: &mut HashSet<PathBuf>,
    incomplete: &mut bool,
) -> Result<(), String> {
    if store.excludes(root) { return Ok(()); }
    #[cfg(windows)]
    if super::filesystem_worker::remote(root) {
        let mut batch = Vec::with_capacity(128);
        let result = super::filesystem_worker::scan_policy(root, cancel, store.policy.spec(), |entry| {
            if !store.excludes(&entry.path) {
                seen.insert(entry.path.to_path_buf());
                batch.push(entry);
                if batch.len() >= 128 {
                    flush(&mut batch, store, shared, 0)?;
                    publish(shared, "indexing");
                }
            }
            Ok(())
        });
        flush(&mut batch, store, shared, 0)?;
        match result {
            Ok(skipped) => {
                *incomplete = skipped > 0;
                let mut status = lock(&shared.status);
                status.skipped += skipped;
                status.unavailable.retain(|p| Path::new(p) != root);
            }
            Err(code) if code == "file-search:cancelled" => {
                *incomplete = true;
            }
            Err(code)
                if [
                    "file-search:scope-timeout",
                    "file-search:scope-unavailable",
                    "file-search:worker",
                ]
                .contains(&code.as_str()) =>
            {
                *incomplete = true;
                let mut status = lock(&shared.status);
                status.skipped += 1;
                let name = root.to_string_lossy().into_owned();
                if !status.unavailable.contains(&name) {
                    status.unavailable.push(name);
                }
            }
            Err(code) => return Err(code),
        }
        return Ok(());
    }
    if std::fs::symlink_metadata(root).is_ok_and(|meta| !storage::can_descend(root, &meta, true)) {
        *incomplete = true;
        lock(&shared.status).skipped += 1;
        return Ok(());
    }
    let mut stack = vec![root.to_path_buf()];
    let mut batch = Vec::with_capacity(256);
    let seen_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    while let Some(dir) = stack.pop() {
        if cancel.load(Ordering::Acquire) {
            return Ok(());
        }
        let iter = match std::fs::read_dir(&dir) {
            Ok(v) => v,
            Err(_) => {
                *incomplete = true;
                lock(&shared.status).skipped += 1;
                continue;
            }
        };
        for item in iter {
            if cancel.load(Ordering::Acquire) {
                return Ok(());
            }
            let item = match item {
                Ok(v) => v,
                Err(_) => {
                    *incomplete = true;
                    lock(&shared.status).skipped += 1;
                    continue;
                }
            };
            let path = item.path();
            if store.excludes(&path) {
                continue;
            }
            let Ok(meta) = std::fs::symlink_metadata(&path) else {
                *incomplete = true;
                continue;
            };
            if storage::directory(&meta) {
                if storage::can_descend(&path, &meta, false) {
                    stack.push(path);
                } else if store.policy.spec().is_none() {
                    lock(&shared.status).skipped += 1;
                }
                continue;
            }
            if let Ok(e) = storage::entry(&path, 0) {
                seen.insert(path);
                batch.push(e);
            }
            if batch.len() >= 256 {
                flush(&mut batch, store, shared, seen_at)?;
                publish(shared, "indexing");
            }
        }
    }
    flush(&mut batch, store, shared, seen_at)
}
fn flush(
    batch: &mut Vec<Entry>,
    store: &storage::Store,
    shared: &Shared,
    seen: u64,
) -> Result<(), String> {
    if batch.is_empty() {
        return Ok(());
    }
    store.transaction()?;
    for e in batch.iter_mut() {
        if let Err(error) = store.upsert(e, seen) {
            store.rollback();
            return Err(error);
        }
    }
    store.commit()?;
    write_catalog(shared, |c| {
        for e in batch.drain(..) {
            if c.entries.len() >= LIMIT && !c.paths.contains_key(&e.path) {
                return Err("file-search:index-limit".into());
            }
            c.insert(e);
        }
        Ok(())
    })
}
fn refresh(
    path: &Path,
    roots: &[PathBuf],
    store: &storage::Store,
    shared: &Shared,
    cancel: &AtomicBool,
) -> Result<(), String> {
    let skipped_before = lock(&shared.status).skipped;
    // A delayed change notification may still carry a pre-rename spelling.
    // Resolve normal entries to the current on-disk spelling; never follow a
    // leaf reparse point or admit a target outside the selected roots.
    let resolved = std::fs::symlink_metadata(path)
        .ok()
        .filter(|m| !storage::reparse(m))
        .and_then(|_| path.canonicalize().ok());
    if let Some(current) = resolved.as_ref().filter(|p| p.as_path() != path) {
        forget(path, store, shared)?;
        if !roots.iter().any(|r| current.starts_with(r)) {
            return Ok(());
        }
    }
    let path = resolved.as_deref().unwrap_or(path);
    match std::fs::symlink_metadata(path) {
        Ok(meta) if storage::can_descend(path, &meta, false) => {
            let mut seen = HashSet::new();
            let mut incomplete = false;
            scan(path, store, shared, cancel, &mut seen, &mut incomplete)?;
            if !incomplete && !cancel.load(Ordering::Acquire) {
                let removed = {
                    let c = shared.catalog.read().unwrap_or_else(|e| e.into_inner());
                    c.entries
                        .iter()
                        .filter(|e| e.path.starts_with(path) && !seen.contains(e.path.as_ref()))
                        .map(|e| e.path.clone())
                        .collect::<Vec<_>>()
                };
                remove_cached_paths(&removed, store, shared)?;
            }
        }
        Ok(meta) if !storage::directory(&meta) => {
            if let Ok(e) = storage::entry(path, 0) {
                flush(&mut vec![e], store, shared, 0)?;
            }
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => forget(path, store, shared)?,
        Err(_) => {
            lock(&shared.status).skipped += 1;
        }
    }
    let extra = lock(&shared.status).skipped.saturating_sub(skipped_before);
    if extra > 0 {
        if let Some(root) = roots.iter().find(|r| path.starts_with(r)) {
            *lock(&shared.skipped_by_root)
                .entry(root.clone())
                .or_default() += extra;
        }
    }
    Ok(())
}
fn forget(path: &Path, store: &storage::Store, shared: &Shared) -> Result<(), String> {
    let removed = {
        let c = shared.catalog.read().unwrap_or_else(|e| e.into_inner());
        c.matching_paths(path)
    };
    remove_cached_paths(&removed, store, shared)
}
fn remove_cached_paths(paths: &[Arc<Path>], store: &storage::Store, shared: &Shared) -> Result<(), String> {
    // A bounded transaction replaces per-file database commits and lock cycles.
    for batch in paths.chunks(256) {
        store.remove_batch(batch)?;
        write_catalog(shared, |catalog| { for path in batch { catalog.remove(path); } });
    }
    Ok(())
}
#[cfg(test)]
#[path = "performance_soak.rs"]
mod performance_soak;
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unchanged_background_reconciliation_preserves_generation_and_ready_state() {
        let base=std::env::temp_dir().join(format!("toolknit-stable-reconcile-{}",std::process::id()));
        std::fs::create_dir(&base).unwrap();let source=base.join("source");std::fs::create_dir(&source).unwrap();
        std::fs::write(source.join("合同.txt"),b"unchanged").unwrap();
        let source=source.canonicalize().unwrap();let store=storage::Store::open(&base.join("cache/index.sqlite")).unwrap();
        let shared=Shared::default();let cancel=Arc::new(AtomicBool::new(false));
        scan_roots(std::slice::from_ref(&source),&store,&shared,&cancel,false).unwrap();
        let generation=shared.catalog.read().unwrap().generation;
        for _ in 0..5 {
            publish(&shared,"indexing");assert_eq!(lock(&shared.status).phase,"ready");
            scan_roots(std::slice::from_ref(&source),&store,&shared,&cancel,false).unwrap();
            assert_eq!(shared.catalog.read().unwrap().generation,generation);
            assert_eq!(lock(&shared.status).phase,"ready");
        }
        shared.remote_pending.store(1,Ordering::Release);publish(&shared,"ready");assert_eq!(lock(&shared.status).phase,"ready");
        shared.remote_pending.store(0,Ordering::Release);lock(&shared.status).skipped=1;publish(&shared,"ready");assert_eq!(lock(&shared.status).phase,"partial");
        drop(store);std::fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn directory_intern_pool_tracks_live_entries_through_repeated_moves() {
        let mut catalog=Catalog::default();
        let make=|id,parent:&str| Entry{id,path:PathBuf::from(format!("{parent}/file{id}.txt")).into(),name:format!("file{id}.txt"),parent:parent.into(),extension:"txt".into(),size:Some(1),modified:None,verified:true};
        catalog.insert(make(1,"stable"));catalog.insert(make(2,"stable"));
        assert!(Arc::ptr_eq(&catalog.entries[0].parent,&catalog.entries[1].parent));
        assert_eq!(catalog.parents.get("stable"),Some(&2));
        for n in 0..2000 {
            let entry=make(3,&format!("moved-{n}"));let path=entry.path.clone();
            catalog.insert(entry);catalog.remove(&path);
            assert_eq!(catalog.parents.len(),1);
        }
        let mut changed=make(1,"stable");changed.parent="corrected".into();catalog.insert(changed);
        assert_eq!(catalog.parents.get("stable"),Some(&1));assert_eq!(catalog.parents.get("corrected"),Some(&1));
        catalog.remove(Path::new("stable/file1.txt"));catalog.remove(Path::new("stable/file2.txt"));
        assert!(catalog.parents.is_empty());assert!(catalog.extensions.is_empty());
    }
    #[test]
    fn cancelled_query_releases_its_wait_while_catalog_writer_is_active() {
        let shared=Arc::new(Shared::default());shared.query_revisions[0].store(1,Ordering::Release);
        let write=shared.catalog.write().unwrap();let worker=shared.clone();
        let (tx,rx)=mpsc::channel();
        let join=std::thread::spawn(move||{let result=worker.query_catalog(0,1).map(|_|());tx.send(result).unwrap();});
        std::thread::sleep(Duration::from_millis(20));shared.query_revisions[0].store(2,Ordering::Release);
        let result=rx.recv_timeout(Duration::from_secs(1));drop(write);join.join().unwrap();
        assert_eq!(result.unwrap().unwrap_err(),"file-search:cancelled");
    }
    #[test]
    fn query_lanes_discard_obsolete_waiters_and_keep_surfaces_independent() {
        let runtime=tokio::runtime::Runtime::new().unwrap();
        runtime.block_on(async {
            let shared=Arc::new(Shared::default());let held=shared.query_workers[0].lock().await;
            let mut waiting=Vec::new();
            for revision in 1..=100 {
                shared.query_revisions[0].store(revision,Ordering::Release);let worker=shared.clone();
                waiting.push(tokio::spawn(async move {worker.query_turn(0,revision).await.map(|_|revision)}));
            }
            shared.query_revisions[1].store(1,Ordering::Release);
            let other=tokio::time::timeout(Duration::from_millis(100),shared.query_turn(1,1)).await;
            assert!(other.is_ok(),"a busy main query cannot block the floating query lane");drop(other);drop(held);
            let mut successful=Vec::new();
            for task in waiting { if let Ok(revision)=task.await.unwrap(){successful.push(revision);} }
            assert_eq!(successful,[100]);
        });
    }
    #[test]
    fn extension_counts_follow_insert_update_remove_and_reset() {
        let mut catalog = Catalog::default();
        let make = |id, path: &str, extension: &str| Entry { id, path: PathBuf::from(path).into(),
            name:path.into(), parent:"C:\\Synthetic".into(), extension:extension.into(), size:Some(1), modified:None, verified:true };
        catalog.insert(make(1, "a.pdf", "pdf")); catalog.insert(make(2, "b.pdf", "pdf"));
        catalog.insert(make(3, "README", ""));
        assert_eq!(catalog.extensions.get("pdf"), Some(&2));
        let generation = catalog.generation; catalog.insert(make(2, "b.pdf", "pdf"));
        assert_eq!(catalog.generation, generation); assert_eq!(catalog.extensions.get("pdf"), Some(&2));
        catalog.insert(make(2, "b.pdf", "txt"));
        assert_eq!(catalog.extensions.get("pdf"), Some(&1)); assert_eq!(catalog.extensions.get("txt"), Some(&1));
        catalog.remove(Path::new("a.pdf")); catalog.remove(Path::new("missing.pdf"));
        assert!(!catalog.extensions.contains_key("pdf"));
        assert_eq!(catalog.extensions.values().sum::<usize>(), catalog.entries.len());
        assert_eq!(catalog.entries[*catalog.ids.get(&3).unwrap()].id, 3);
        catalog.remove(Path::new("README")); assert!(!catalog.extensions.contains_key(""));
        catalog = Catalog::default(); assert!(catalog.extensions.is_empty());
    }
    #[test]
    fn status_only_publication_does_not_invalidate_query_generation() {
        let shared = Shared::default();
        write_catalog(&shared, |catalog| catalog.insert(Entry { id:1,path:PathBuf::from("file.txt").into(),name:"file.txt".into(),parent:".".into(),extension:"txt".into(),size:Some(1),modified:None,verified:true }));
        publish(&shared,"ready");let generation=lock(&shared.status).generation;
        for phase in ["ready","indexing","stopped","ready"] {publish(&shared,phase);assert_eq!(lock(&shared.status).generation,generation);}
        write_catalog(&shared,|catalog|catalog.remove(Path::new("file.txt")));publish(&shared,"ready");
        assert_ne!(lock(&shared.status).generation,generation);assert_eq!(lock(&shared.status).indexed,0);
    }
    #[test]
    fn exact_file_deletion_and_directory_pruning_share_cache_contract() {
        let base = std::env::temp_dir().join(format!("toolknit-search-remove-{}", std::process::id()));
        std::fs::create_dir(&base).unwrap();
        let source = base.join("source"); std::fs::create_dir(&source).unwrap();
        let store = storage::Store::open(&base.join("cache/index.sqlite")).unwrap();
        let shared = Shared::default();
        let folder = source.join("nested"); std::fs::create_dir(&folder).unwrap();
        let sibling = source.join("nested-other.pdf"); std::fs::write(&sibling,b"keep").unwrap();
        let mut batch = vec![storage::entry(&sibling,0).unwrap()];
        for i in 0..600 { let p=folder.join(format!("file{i}.pdf")); std::fs::write(&p,b"source").unwrap(); batch.push(storage::entry(&p,0).unwrap()); }
        flush(&mut batch, &store, &shared, 1).unwrap();
        let leaf=folder.join("file1.pdf");
        assert_eq!(shared.catalog.read().unwrap().matching_paths(&leaf).len(),1);
        forget(&leaf,&store,&shared).unwrap();
        assert_eq!(shared.catalog.read().unwrap().entries.len(),600);
        forget(&folder,&store,&shared).unwrap();
        let catalog=shared.catalog.read().unwrap();
        assert_eq!(catalog.entries.len(),1); assert_eq!(catalog.extensions.get("pdf"),Some(&1));
        assert_eq!(catalog.entries[0].path.as_ref(),sibling.as_path()); drop(catalog);
        assert_eq!(store.load(&[source],||false).unwrap().len(),1);
        assert_eq!(std::fs::read(&leaf).unwrap(),b"source","removes only index metadata");
        assert_eq!(std::fs::read(&sibling).unwrap(),b"keep");
        drop(store); std::fs::remove_dir_all(base).unwrap();
    }
    fn wait(index: &Index, predicate: impl Fn(&Catalog) -> bool) {
        let deadline = Instant::now() + Duration::from_secs(12);
        loop {
            if predicate(&index.shared.catalog.read().unwrap()) && index.status().phase == "ready" {
                return;
            }
            assert!(
                Instant::now() < deadline,
                "index phase {}",
                index.status().phase
            );
            std::thread::sleep(Duration::from_millis(80));
        }
    }
    #[test]
    fn scans_watches_and_resumes_without_changing_sources() {
        let base = std::env::temp_dir().join(format!(
            "toolknit-fsearch-index-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let source = base.join("source");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::write(source.join("before.txt"), b"source").unwrap();
        let roots = normalize_roots(&[source.to_string_lossy().into_owned()]).unwrap();
        let index = Index::new(base.join("cache/index.sqlite"));
        index.start(roots.clone()).unwrap();
        wait(&index, |c| c.entries.len() == 1);
        std::fs::write(source.join("新增合同.pdf"), b"test").unwrap();
        wait(&index, |c| c.entries.len() == 2);
        std::fs::rename(source.join("新增合同.pdf"), source.join("renamed.pdf")).unwrap();
        wait(&index, |c| {
            c.entries.iter().any(|e| e.name == "renamed.pdf")
                && !c.entries.iter().any(|e| e.name == "新增合同.pdf")
        });
        std::fs::remove_file(source.join("before.txt")).unwrap();
        wait(&index, |c| c.entries.len() == 1);
        std::fs::rename(source.join("renamed.pdf"), source.join("RENAMED.pdf")).unwrap();
        wait(&index, |c| {
            c.entries.len() == 1 && c.entries[0].name == "RENAMED.pdf"
        });
        let nested = source.join("nested");
        std::fs::create_dir(&nested).unwrap();
        std::fs::write(nested.join("child.txt"), b"fixture").unwrap();
        wait(&index, |c| c.entries.len() == 2);
        std::fs::rename(&nested, source.join("changed")).unwrap();
        wait(&index, |c| {
            c.entries.len() == 2 && c.entries.iter().any(|e| e.parent.ends_with("changed"))
        });
        std::fs::remove_file(source.join("changed/child.txt")).unwrap();
        std::fs::remove_dir(source.join("changed")).unwrap();
        wait(&index, |c| c.entries.len() == 1);
        index.stop();
        index.start(roots.clone()).unwrap();
        wait(&index, |c| c.entries.len() == 1);
        index.stop();
        if let Some(worker) = lock(&index.worker).take() {
            worker.join.join().unwrap();
        }
        let offline = base.join("temporarily-offline");
        std::fs::rename(&source, &offline).unwrap();
        index.start(roots.clone()).unwrap();
        let deadline = Instant::now() + Duration::from_secs(3);
        while index.status().phase != "partial" && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(30));
        }
        assert_eq!(index.status().phase, "partial");
        assert!(index
            .shared
            .catalog
            .read()
            .unwrap()
            .entries
            .iter()
            .all(|e| !e.verified));
        index.stop();
        if let Some(worker) = lock(&index.worker).take() {
            worker.join.join().unwrap();
        }
        std::fs::rename(&offline, &source).unwrap();
        index.start(roots).unwrap();
        wait(&index, |c| {
            c.entries.len() == 1 && c.entries.iter().all(|e| e.verified)
        });
        let other = base.join("other");
        std::fs::create_dir(&other).unwrap();
        std::fs::write(other.join("scope.txt"), b"scope").unwrap();
        index
            .start(normalize_roots(&[other.to_string_lossy().into_owned()]).unwrap())
            .unwrap();
        wait(&index, |c| {
            c.entries.len() == 1 && c.entries[0].name == "scope.txt"
        });
        index.clear().unwrap();
        assert!(index.shared.catalog.read().unwrap().entries.is_empty());
        assert_eq!(std::fs::read(source.join("RENAMED.pdf")).unwrap(), b"test");
        // A corrupt disposable cache has an explicit recovery path that never
        // touches the selected sources.
        std::fs::write(base.join("cache/index.sqlite"), b"not a SQLite database").unwrap();
        index
            .start(normalize_roots(&[other.to_string_lossy().into_owned()]).unwrap())
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(3);
        while index.status().phase != "error" && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(30));
        }
        assert_eq!(index.status().phase, "error");
        index.clear().unwrap();
        index
            .start(normalize_roots(&[other.to_string_lossy().into_owned()]).unwrap())
            .unwrap();
        wait(&index, |c| {
            c.entries.len() == 1 && c.entries[0].name == "scope.txt"
        });
        index.stop();
        if let Some(worker) = lock(&index.worker).take() {
            worker.join.join().unwrap();
        }
        assert_eq!(std::fs::read(source.join("RENAMED.pdf")).unwrap(), b"test");
        drop(index);
        std::fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn policy_is_shared_by_scan_rename_events_and_cached_restart() {
        use super::super::scope_policy::{Policy, Spec, VERSION};
        let base = std::env::temp_dir().join(format!("toolknit-policy-watch-{}", std::process::id()));
        let source = base.join("source"); let ignored = source.join("node_modules");
        std::fs::create_dir_all(&ignored).unwrap(); std::fs::create_dir(source.join("dist")).unwrap();
        std::fs::write(source.join("合同.pdf"), b"document").unwrap();
        std::fs::write(source.join("dist/deliverable.zip"), b"delivery").unwrap();
        std::fs::write(ignored.join("noise.js"), b"dependency").unwrap();
        let roots = normalize_roots(&[source.to_string_lossy().into_owned()]).unwrap();
        let policy = Policy::from_spec(Some(Spec { version: VERSION, ..Default::default() })).unwrap();
        let index = Index::new(base.join("cache/index.sqlite"));
        index.start_policy(roots.clone(), false, policy.clone()).unwrap();
        wait(&index, |c| c.entries.len() == 2 && !c.entries.iter().any(|e| e.name == "noise.js"));
        std::fs::rename(source.join("合同.pdf"), ignored.join("合同.pdf")).unwrap();
        wait(&index, |c| c.entries.len() == 1);
        std::fs::rename(ignored.join("合同.pdf"), source.join("合同.pdf")).unwrap();
        wait(&index, |c| c.entries.len() == 2);
        index.start_policy(roots, false, policy).unwrap();
        wait(&index, |c| c.entries.len() == 2 && c.entries.iter().all(|e| e.verified));
        index.clear().unwrap(); drop(index);
        assert_eq!(std::fs::read(source.join("合同.pdf")).unwrap(), b"document");
        assert_eq!(std::fs::read(ignored.join("noise.js")).unwrap(), b"dependency");
        std::fs::remove_dir_all(base).unwrap();
    }
}

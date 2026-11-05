//! Bounded remote producers; only the index thread writes SQLite/the catalog.
//! A stalled SMB helper cannot delay local watcher events or hold a DB lock.
use super::*;
use super::super::{filesystem_worker, scope_policy::Policy};

enum Event {
    Begin(PathBuf),
    Rows(PathBuf, Vec<Entry>),
    End(PathBuf, Result<usize, String>),
}
pub(super) struct Pump {
    receiver: mpsc::Receiver<Event>,
    workers: Vec<std::thread::JoinHandle<()>>,
    cancel: Arc<AtomicBool>,
    refresh: Arc<AtomicU64>,
    pending: HashSet<PathBuf>,
    seen: HashMap<PathBuf, HashSet<PathBuf>>,
}
fn send(tx: &mpsc::SyncSender<Event>, cancel: &AtomicBool, mut event: Event) -> Result<(), String> {
    loop {
        if cancel.load(Ordering::Acquire) { return Err("file-search:cancelled".into()); }
        match tx.try_send(event) {
            Ok(()) => return Ok(()),
            Err(mpsc::TrySendError::Full(value)) => { event = value; std::thread::sleep(Duration::from_millis(15)); }
            Err(mpsc::TrySendError::Disconnected(_)) => return Err("file-search:cancelled".into()),
        }
    }
}
impl Pump {
    pub fn start(roots: Vec<PathBuf>, policy: Policy, cancel: Arc<AtomicBool>, shared: &Shared) -> Result<Self, String> {
        let (tx, receiver) = mpsc::sync_channel(16);
        let mut pump = Self { receiver, workers: Vec::new(), cancel, refresh: Arc::new(AtomicU64::new(0)),
            pending: roots.iter().cloned().collect(), seen: HashMap::new() };
        shared.remote_pending.store(roots.len(), Ordering::Release);
        for lane in 0..roots.len().min(2) {
            let roots = roots.iter().skip(lane).step_by(2).cloned().collect::<Vec<_>>();
            let (tx, cancel, policy) = (tx.clone(), pump.cancel.clone(), policy.clone());
            let refresh = pump.refresh.clone();
            let worker = std::thread::Builder::new().name("toolknit-remote-index".into()).spawn(move || {
                loop {
                    let revision = refresh.load(Ordering::Acquire);
                    for root in &roots {
                        if send(&tx, &cancel, Event::Begin(root.clone())).is_err() { return; }
                        let mut batch = Vec::with_capacity(128);
                        let result = filesystem_worker::scan_policy(root, &cancel, policy.spec(), |entry| {
                            if !policy.excludes(&entry.path) {
                                batch.push(entry);
                                if batch.len() >= 128 { send(&tx, &cancel, Event::Rows(root.clone(), std::mem::take(&mut batch)))?; }
                            }
                            Ok(())
                        });
                        if !batch.is_empty() && send(&tx, &cancel, Event::Rows(root.clone(), batch)).is_err() { return; }
                        if send(&tx, &cancel, Event::End(root.clone(), result)).is_err() { return; }
                    }
                    for _ in 0..300 {
                        if cancel.load(Ordering::Acquire) { return; }
                        if refresh.load(Ordering::Acquire) != revision { break; }
                        std::thread::sleep(Duration::from_millis(100));
                    }
                }
            }).map_err(|_| "file-search:worker")?;
            pump.workers.push(worker);
        }
        Ok(pump)
    }
    pub fn refresh(&self) { self.refresh.fetch_add(1, Ordering::AcqRel); }
    pub fn poll(&mut self, store: &storage::Store, shared: &Shared) -> Result<(), String> {
        // Leave room for local changes even while a large share streams data.
        for _ in 0..8 {
            let Ok(event) = self.receiver.try_recv() else { break; };
            match event {
                Event::Begin(root) => {
                    self.pending.insert(root.clone());
                    self.seen.insert(root.clone(), HashSet::new());
                }
                Event::Rows(root, mut rows) => {
                    rows.retain(|e| e.path.starts_with(&root) && !store.excludes(&e.path));
                    self.seen.entry(root).or_default().extend(rows.iter().map(|e| e.path.to_path_buf()));
                    flush(&mut rows, store, shared, 0)?;
                }
                Event::End(root, result) => {
                    let seen = self.seen.remove(&root).unwrap_or_default();
                    if matches!(result, Ok(0)) && !self.cancel.load(Ordering::Acquire) {
                        prune_scope(&root, &seen, store, shared)?;
                    } else if !matches!(result, Ok(0)) {
                        mark_unseen_stale(&root,&seen,store,shared);
                    }
                    let skipped = result.as_ref().copied().unwrap_or(1);
                    lock(&shared.skipped_by_root).insert(root.clone(), skipped);
                    let name = root.to_string_lossy().into_owned();
                    let mut status = lock(&shared.status);
                    status.unavailable.retain(|p| p != &name);
                    if result.is_err() { status.unavailable.push(name); }
                    drop(status);
                    self.pending.remove(&root);
                }
            }
            shared.remote_pending.store(self.pending.len(), Ordering::Release);
            lock(&shared.status).skipped = lock(&shared.skipped_by_root).values().copied().sum();
            publish(shared, "ready");
        }
        Ok(())
    }
}
impl Drop for Pump {
    fn drop(&mut self) {
        self.cancel.store(true, Ordering::Release);
        for worker in self.workers.drain(..) { let _ = worker.join(); }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn successful_remote_rechecks_keep_versions_stable_and_failure_marks_stale_once() {
        let base=std::env::temp_dir().join(format!("toolknit-remote-generation-{}",std::process::id()));
        std::fs::create_dir(&base).unwrap();let store=storage::Store::open(&base.join("cache/index.sqlite")).unwrap();
        let remote=PathBuf::from(r"\\example.invalid\documents");let shared=Shared::default();
        write_catalog(&shared,|c|c.insert(Entry{id:1,path:remote.join("a.txt").into(),name:"a.txt".into(),parent:remote.to_string_lossy().as_ref().into(),extension:"txt".into(),size:Some(1),modified:None,verified:true}));
        let (tx,receiver)=mpsc::sync_channel(4);let mut pump=Pump{receiver,workers:Vec::new(),cancel:Arc::new(AtomicBool::new(false)),refresh:Arc::new(AtomicU64::new(0)),pending:HashSet::new(),seen:HashMap::new()};
        let initial=shared.catalog.read().unwrap().generation;
        tx.send(Event::Begin(remote.clone())).unwrap();pump.poll(&store,&shared).unwrap();
        assert_eq!(shared.catalog.read().unwrap().generation,initial);assert!(shared.catalog.read().unwrap().entries[0].verified);
        tx.send(Event::End(remote.clone(),Err("file-search:scope-timeout".into()))).unwrap();pump.poll(&store,&shared).unwrap();
        let stale=shared.catalog.read().unwrap().generation;assert_eq!(stale,initial+1);assert!(!shared.catalog.read().unwrap().entries[0].verified);
        tx.send(Event::Begin(remote.clone())).unwrap();pump.poll(&store,&shared).unwrap();
        tx.send(Event::End(remote,Err("file-search:scope-timeout".into()))).unwrap();pump.poll(&store,&shared).unwrap();
        assert_eq!(shared.catalog.read().unwrap().generation,stale);assert_eq!(lock(&shared.status).generation,stale);
        drop(pump);drop(store);std::fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn unfinished_remote_scan_keeps_local_refresh_and_failure_accounting_independent() {
        let base = std::env::temp_dir().join(format!("toolknit-remote-pump-{}", std::process::id()));
        std::fs::create_dir(&base).unwrap();
        let local = base.join("local"); std::fs::create_dir(&local).unwrap();
        let local = local.canonicalize().unwrap();
        let remote = PathBuf::from(r"\\example.invalid\documents");
        let store = storage::Store::open(&base.join("cache/index.sqlite")).unwrap();
        let shared = Shared::default();
        let (tx, receiver) = mpsc::sync_channel(16);
        let cancel = Arc::new(AtomicBool::new(false));
        let mut pump = Pump { receiver, workers: Vec::new(), cancel: cancel.clone(), refresh: Arc::new(AtomicU64::new(0)),
            pending: [remote.clone()].into(), seen: HashMap::new() };
        tx.send(Event::Begin(remote.clone())).unwrap(); pump.poll(&store, &shared).unwrap();
        lock(&shared.skipped_by_root).insert(local.clone(), 2);
        // A local create must be applied while the share has sent no End yet.
        let file = local.join("new.txt"); std::fs::write(&file, b"unchanged").unwrap();
        refresh(&file, std::slice::from_ref(&local), &store, &shared, &cancel).unwrap();
        assert_eq!(shared.catalog.read().unwrap().entries.len(), 1);
        assert_eq!(shared.remote_pending.load(Ordering::Acquire), 1);
        tx.send(Event::End(remote.clone(), Err("file-search:scope-timeout".into()))).unwrap();
        pump.poll(&store, &shared).unwrap();
        assert_eq!(lock(&shared.status).skipped, 3);
        assert_eq!(lock(&shared.status).phase, "partial");
        assert_eq!(std::fs::read(&file).unwrap(), b"unchanged");
        drop(pump); drop(store); std::fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn full_remote_queue_is_cancellable_without_a_reader_or_database_lock() {
        let cancel = Arc::new(AtomicBool::new(false));
        let (tx, _rx) = mpsc::sync_channel(1);
        send(&tx, &cancel, Event::Begin("first".into())).unwrap();
        let worker_cancel = cancel.clone();
        let join = std::thread::spawn(move || send(&tx, &worker_cancel, Event::Begin("blocked".into())));
        std::thread::sleep(Duration::from_millis(40));
        cancel.store(true, Ordering::Release);
        assert_eq!(join.join().unwrap().unwrap_err(), "file-search:cancelled");
    }
}

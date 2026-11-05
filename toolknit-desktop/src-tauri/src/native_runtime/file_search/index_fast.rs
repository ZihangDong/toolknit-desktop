use super::*;
use crate::native_runtime::file_search::accelerator::{Change, Checkpoint, Client};
use std::{
    collections::BTreeMap,
    path::{Component, Prefix},
};

pub(super) fn run(
    roots: &[PathBuf],
    store: &storage::Store,
    shared: &Shared,
    cancel: &Arc<AtomicBool>,
) -> HashSet<PathBuf> {
    let mut groups: BTreeMap<u8, Vec<PathBuf>> = BTreeMap::new();
    let mut complete = HashSet::new();
    for root in roots {
        if super::super::filesystem_worker::remote(root) {
            continue;
        }
        if !super::super::discovery::fast_root(root) { continue; }
        if let Some(Component::Prefix(prefix)) = root.components().next() {
            if let Prefix::Disk(d) | Prefix::VerbatimDisk(d) = prefix.kind() {
                groups
                    .entry(d.to_ascii_uppercase())
                    .or_default()
                    .push(root.clone());
            }
        }
    }
    if groups.is_empty() {
        return complete;
    }
    // One connection for all volumes: dropping it ends the demand service.
    let mut client = match Client::connect(cancel.clone()) {
        Ok(client) => client,
        Err(code) => {
            let mut status = lock(&shared.status);
            status.acceleration_error = Some(code);
            status.accelerated = false;
            return complete;
        }
    };
    for (drive, scopes) in groups {
        if cancel.load(Ordering::Acquire) {
            break;
        }
        let result = store.policy.for_roots(&scopes).and_then(|policy| {
            client.set_policy(policy.spec());
            sync(&mut client, drive, &scopes, store, shared, cancel)
        });
        match result {
            Ok(()) => complete.extend(scopes),
            Err(code) => {
                if cancel.load(Ordering::Acquire) {
                    break;
                }
                let mut status = lock(&shared.status);
                status.acceleration_error = Some(code);
                status.accelerated = false;
                continue;
            }
        }
    }
    complete
}
fn sync(
    client: &mut Client,
    drive: u8,
    roots: &[PathBuf],
    store: &storage::Store,
    shared: &Shared,
    cancel: &Arc<AtomicBool>,
) -> Result<(), String> {
    use sha2::{Digest, Sha256};
    let key = format!(
        "ntfs:{}:{}:{}",
        drive as char,
        store.policy.for_roots(roots)?.fingerprint(),
        hex::encode(Sha256::digest(
            serde_json::to_vec(roots).map_err(|_| "file-search:scope")?
        ))
    );
    if let Some(checkpoint) = store.value::<Checkpoint>(&key)? {
        let next = client.changes(drive, &checkpoint, roots, |change| {
            if cancel.load(Ordering::Acquire) {
                return Err("file-search:cancelled".into());
            }
            let path = match &change {
                Change::File(e) => e.path.as_ref(),
                Change::Removed(p) | Change::Directory(p) => p.as_path(),
            };
            if store.excludes(path) || !store.policy.in_roots(path, roots) {
                return Ok(());
            }
            match change {
                Change::File(entry) => flush(&mut vec![entry], store, shared, 0)?,
                Change::Removed(path) => forget(&path, store, shared)?,
                Change::Directory(path) => {
                    let mut seen = HashSet::new();
                    let mut incomplete = false;
                    scan(&path, store, shared, cancel, &mut seen, &mut incomplete)?;
                    if incomplete {
                        return Err("file-search:scope-unavailable".into());
                    }
                    if !incomplete && !cancel.load(Ordering::Acquire) {
                        prune(&[path], &seen, store, shared)?;
                    }
                }
            }
            Ok(())
        })?;
        if let Some(next) = next {
            write_catalog(shared, |c| {
                let mut changed=false;
                for entry in &mut c.entries {
                    if !entry.verified && store.policy.in_roots(&entry.path, roots) {
                        entry.verified = true;
                        changed=true;
                    }
                }
                if changed { c.generation = c.generation.wrapping_add(1); }
            });
            store.set_value(&key, &next)?;
            return Ok(());
        }
    }
    let mut batch = Vec::with_capacity(1024);
    let mut seen = HashSet::new();
    let checkpoint = client.scan(drive, roots, |entry| {
        if cancel.load(Ordering::Acquire) {
            return Err("file-search:cancelled".into());
        }
        if store.excludes(&entry.path) || !store.policy.in_roots(&entry.path, roots) {
            return Ok(());
        }
        seen.insert(entry.path.to_path_buf());
        batch.push(entry);
        if batch.len() >= 1024 {
            flush(&mut batch, store, shared, 0)?;
            publish(shared, "indexing");
        }
        Ok(())
    })?;
    flush(&mut batch, store, shared, 0)?;
    if cancel.load(Ordering::Acquire) {
        return Err("file-search:cancelled".into());
    }
    prune(roots, &seen, store, shared)?;
    store.set_value(&key, &checkpoint)?;
    Ok(())
}
fn prune(
    roots: &[PathBuf],
    seen: &HashSet<PathBuf>,
    store: &storage::Store,
    shared: &Shared,
) -> Result<(), String> {
    let paths = {
        let c = shared.catalog.read().unwrap_or_else(|e| e.into_inner());
        c.entries
            .iter()
            .filter(|e| {
                store.policy.in_roots(&e.path, roots) && !seen.contains(e.path.as_ref())
            })
            .map(|e| e.path.clone())
            .collect::<Vec<_>>()
    };
    remove_cached_paths(&paths, store, shared)
}

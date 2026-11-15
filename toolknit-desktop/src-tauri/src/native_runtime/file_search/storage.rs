//! Filename metadata only. Native path bytes round-trip without lossy decoding.
use super::query::{extension, Entry};
use rusqlite::{params, Connection};
use std::{
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

pub(super) struct Store {
    db: Connection,
    cache_root: PathBuf,
    pub policy: super::scope_policy::Policy,
}
pub(super) fn encode(path: &Path) -> Vec<u8> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        path.as_os_str()
            .encode_wide()
            .flat_map(u16::to_le_bytes)
            .collect()
    }
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        path.as_os_str().as_bytes().to_vec()
    }
}
pub(super) fn decode(bytes: &[u8]) -> Result<PathBuf, String> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStringExt;
        if bytes.len() % 2 != 0 {
            return Err("file-search:cache".into());
        }
        Ok(std::ffi::OsString::from_wide(
            &bytes
                .chunks_exact(2)
                .map(|b| u16::from_le_bytes([b[0], b[1]]))
                .collect::<Vec<_>>(),
        )
        .into())
    }
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStringExt;
        Ok(std::ffi::OsString::from_vec(bytes.to_vec()).into())
    }
}
pub(super) fn entry(path: &Path, id: u64) -> Result<Entry, String> {
    let meta = std::fs::symlink_metadata(path).map_err(|_| "file-search:unavailable")?;
    if directory(&meta) || (!meta.is_file() && !meta.file_type().is_symlink()) {
        return Err("file-search:not-file".into());
    }
    let name = path
        .file_name()
        .ok_or("file-search:not-file")?
        .to_string_lossy()
        .into_owned();
    let parent = path
        .parent()
        .ok_or("file-search:not-file")?
        .to_string_lossy()
        .into_owned();
    let size = (!meta.file_type().is_symlink()).then_some(meta.len());
    let modified = meta
        .modified()
        .ok()
        .and_then(|v| v.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs());
    Ok(Entry {
        id,
        path: path.into(),
        extension: extension(&name),
        name,
        parent: parent.into(),
        size,
        modified,
        verified: true,
    })
}
pub(super) fn reparse(meta: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        meta.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        meta.file_type().is_symlink()
    }
}
pub(super) fn directory(meta: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        meta.is_dir() || meta.file_attributes() & 0x10 != 0
    }
    #[cfg(not(windows))]
    {
        meta.is_dir()
    }
}
pub(super) fn can_descend(path: &Path, meta: &std::fs::Metadata, explicit_root: bool) -> bool {
    if !directory(meta) { return false; }
    if !reparse(meta) { return true; }
    #[cfg(windows)]
    if explicit_root && super::discovery::volume_id(path).is_some() { return true; }
    let _ = explicit_root;
    cloud_directory(path)
}
pub(super) fn cloud_directory(path: &Path) -> bool {
    #[cfg(windows)]
    unsafe {
        use std::{mem::size_of, os::windows::ffi::OsStrExt};
        use windows::{core::PCWSTR, Win32::{Foundation::CloseHandle, Storage::FileSystem::*}};
        let name = path.as_os_str().encode_wide().chain(Some(0)).collect::<Vec<_>>();
        let Ok(handle) = CreateFileW(PCWSTR(name.as_ptr()), FILE_READ_ATTRIBUTES.0,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, None, OPEN_EXISTING,
            FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_NO_RECALL, None) else { return false; };
        let mut info = FILE_ATTRIBUTE_TAG_INFO::default();
        let result = GetFileInformationByHandleEx(handle, FileAttributeTagInfo,
            (&mut info as *mut FILE_ATTRIBUTE_TAG_INFO).cast(), size_of::<FILE_ATTRIBUTE_TAG_INFO>() as u32);
        let _ = CloseHandle(handle);
        // Cloud and Cloud_1..Cloud_F markers are not directory junctions. Query
        // metadata only, explicitly preventing data hydration/network recall.
        return result.is_ok() && cloud_tag(info.FileAttributes, info.ReparseTag);
    }
    #[cfg(not(windows))]
    { let _ = path; false }
}
#[cfg(windows)]
pub(super) fn cloud_tag(attributes: u32, tag: u32) -> bool {
    attributes & 0x10 != 0 && tag & 0xffff0fff == 0x9000001a
}
impl Store {
    pub fn value<T: serde::de::DeserializeOwned>(&self, key: &str) -> Result<Option<T>, String> {
        use rusqlite::OptionalExtension;
        let value: Option<String> = self
            .db
            .query_row("SELECT value FROM metadata WHERE key=?1", [key], |r| {
                r.get(0)
            })
            .optional()
            .map_err(|_| "file-search:cache")?;
        value
            .map(|v| {
                if v.len() > 1024 * 1024 {
                    return Err("file-search:cache".into());
                }
                serde_json::from_str(&v).map_err(|_| "file-search:cache".into())
            })
            .transpose()
    }
    pub fn set_value<T: serde::Serialize>(&self, key: &str, value: &T) -> Result<(), String> {
        let value = serde_json::to_string(value).map_err(|_| "file-search:cache")?;
        self.db.execute("INSERT INTO metadata(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![key,value]).map_err(|_|"file-search:cache")?;
        Ok(())
    }
    #[cfg(test)]
    pub fn open(path: &Path) -> Result<Self, String> {
        Self::open_policy(path, super::scope_policy::Policy::default())
    }
    pub fn open_policy(path: &Path, policy: super::scope_policy::Policy) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            if std::fs::symlink_metadata(parent).is_ok_and(|m| reparse(&m)) {
                return Err("file-search:storage".into());
            }
            std::fs::create_dir_all(parent).map_err(|_| "file-search:storage")?;
            #[cfg(windows)]
            super::accelerator::protect_cache_directory(parent)?;
        }
        for candidate in [
            path.to_path_buf(),
            path.with_file_name(format!(
                "{}-wal",
                path.file_name().unwrap_or_default().to_string_lossy()
            )),
            path.with_file_name(format!(
                "{}-shm",
                path.file_name().unwrap_or_default().to_string_lossy()
            )),
        ] {
            if std::fs::symlink_metadata(candidate).is_ok_and(|m| reparse(&m) || !m.is_file()) {
                return Err("file-search:storage".into());
            }
        }
        let db = Connection::open(path).map_err(|_| "file-search:cache")?;
        db.busy_timeout(std::time::Duration::from_secs(3))
            .map_err(|_| "file-search:cache")?;
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
          CREATE TABLE IF NOT EXISTS files(id INTEGER PRIMARY KEY AUTOINCREMENT,path BLOB NOT NULL UNIQUE,size INTEGER,modified INTEGER,seen INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
          INSERT OR IGNORE INTO metadata VALUES('schema','1');").map_err(|_|"file-search:cache")?;
        let schema: String = db
            .query_row("SELECT value FROM metadata WHERE key='schema'", [], |r| {
                r.get(0)
            })
            .map_err(|_| "file-search:cache")?;
        if schema != "1" {
            return Err("file-search:cache-version".into());
        }
        Ok(Self {
            db,
            policy,
            cache_root: path
                .parent()
                .unwrap_or(path)
                .canonicalize()
                .map_err(|_| "file-search:storage")?,
        })
    }
    pub fn excludes(&self, path: &Path) -> bool {
        path.starts_with(&self.cache_root) || self.policy.excludes(path)
    }
    fn prepare_policy(&self, cancelled: &impl Fn() -> bool) -> Result<(), String> {
        let fingerprint = self.policy.fingerprint();
        let previous = self.value::<String>("scope-policy-fingerprint")?;
        let old_volumes = self.value::<Vec<(Vec<u8>, String)>>("volume-identities")?.unwrap_or_default();
        let new_volumes = self.policy.volumes().iter().map(|(p,id)| (encode(p), id.clone())).collect::<Vec<_>>();
        let invalid = self.policy.volumes().iter().filter(|(p,id)| !old_volumes.iter().any(|(bytes,old)| old == id && bytes == &encode(p)))
            .map(|(p,_)| p).collect::<Vec<_>>();
        if previous.as_ref() != Some(&fingerprint) || !invalid.is_empty() {
            let mut last = 0u64;
            loop {
                if cancelled() { return Err("file-search:cancelled".into()); }
                let batch = {
                    let mut statement = self.db.prepare("SELECT id,path FROM files WHERE id>?1 ORDER BY id LIMIT 1024").map_err(|_| "file-search:cache")?;
                    let values = statement.query_map([last], |r| Ok((r.get::<_,u64>(0)?, r.get::<_,Vec<u8>>(1)?))).map_err(|_| "file-search:cache")?
                        .collect::<Result<Vec<_>,_>>().map_err(|_| "file-search:cache")?;
                    values
                };
                if batch.is_empty() { break; }
                last = batch.last().unwrap().0;
                let mut remove = Vec::new();
                for (id, bytes) in batch {
                    if bytes.len() > 65536 { return Err("file-search:cache".into()); }
                    let path = decode(&bytes)?;
                    if self.excludes(&path) || invalid.iter().any(|root| path.starts_with(root)) { remove.push(id); }
                }
                if !remove.is_empty() {
                    self.transaction()?;
                    for id in remove {
                        if self.db.execute("DELETE FROM files WHERE id=?1", [id]).is_err() { self.rollback(); return Err("file-search:cache".into()); }
                    }
                    self.commit()?;
                }
            }
            self.set_value("scope-policy-fingerprint", &fingerprint)?;
        }
        if !new_volumes.is_empty() { self.set_value("volume-identities", &new_volumes)?; }
        Ok(())
    }
    #[cfg(test)]
    pub fn load(
        &self,
        roots: &[PathBuf],
        cancelled: impl Fn() -> bool,
    ) -> Result<Vec<Entry>, String> {
        let mut result = Vec::new();
        self.visit(roots, cancelled, |entry| { result.push(entry); Ok(()) })?;
        Ok(result)
    }
    pub fn visit(
        &self,
        roots: &[PathBuf],
        cancelled: impl Fn() -> bool,
        mut consume: impl FnMut(Entry) -> Result<(), String>,
    ) -> Result<usize, String> {
        self.prepare_policy(&cancelled)?;
        let mut stmt = self
            .db
            .prepare("SELECT id,path,size,modified FROM files ORDER BY id LIMIT 5000001")
            .map_err(|_| "file-search:cache")?;
        let mut rows = stmt.query([]).map_err(|_| "file-search:cache")?;
        let mut count = 0;
        while let Some(row) = rows.next().map_err(|_| "file-search:cache")? {
            if cancelled() {
                return Err("file-search:cancelled".into());
            }
            if count >= 5_000_000 {
                return Err("file-search:index-limit".into());
            }
            let bytes: Vec<u8> = row.get(1).map_err(|_| "file-search:cache")?;
            if bytes.len() > 65536 {
                return Err("file-search:cache".into());
            }
            let path = decode(&bytes)?;
            if !path.is_absolute()
                || path
                    .components()
                    .any(|c| matches!(c, std::path::Component::ParentDir))
                || !roots.iter().any(|r| path.starts_with(r))
                || self.excludes(&path)
            {
                continue;
            }
            let Some(name) = path.file_name() else {
                continue;
            };
            let name = name.to_string_lossy().into_owned();
            let Some(parent) = path.parent() else {
                continue;
            };
            let parent = parent.to_string_lossy().into_owned();
            consume(Entry {
                id: row.get(0).map_err(|_| "file-search:cache")?,
                path: path.into(),
                extension: extension(&name),
                name,
                parent: parent.into(),
                verified: false,
                size: row
                    .get::<_, Option<i64>>(2)
                    .map_err(|_| "file-search:cache")?
                    .and_then(|v| u64::try_from(v).ok()),
                modified: row
                    .get::<_, Option<i64>>(3)
                    .map_err(|_| "file-search:cache")?
                    .and_then(|v| u64::try_from(v).ok()),
            })?;
            count += 1;
        }
        Ok(count)
    }
    pub fn upsert(&self, entry: &mut Entry, seen: u64) -> Result<(), String> {
        let bytes = encode(&entry.path);
        let size = entry.size.and_then(|v| i64::try_from(v).ok());
        let modified = entry.modified.and_then(|v| i64::try_from(v).ok());
        entry.id=self.db.prepare_cached("INSERT INTO files(path,size,modified,seen) VALUES(?1,?2,?3,?4) ON CONFLICT(path) DO UPDATE SET size=excluded.size,modified=excluded.modified,seen=excluded.seen RETURNING id")
            .map_err(|_|"file-search:storage")?.query_row(params![bytes,size,modified,seen],|r|r.get(0)).map_err(|_|"file-search:storage")?;
        Ok(())
    }
    pub fn remove(&self, path: &Path) -> Result<(), String> {
        self.db
            .prepare_cached("DELETE FROM files WHERE path=?1")
            .map_err(|_| "file-search:storage")?
            .execute([encode(path)])
            .map_err(|_| "file-search:storage")?;
        Ok(())
    }
    pub fn remove_batch(&self, paths: &[std::sync::Arc<Path>]) -> Result<(), String> {
        if paths.is_empty() { return Ok(()); }
        self.transaction()?;
        let result = paths.iter().try_for_each(|path| self.remove(path)).and_then(|_| self.commit());
        if result.is_err() { self.rollback(); }
        result
    }
    pub fn checkpoint(&self) -> Result<(), String> {
        self.db
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .map_err(|_| "file-search:storage".into())
    }
    pub fn transaction(&self) -> Result<(), String> {
        self.db
            .execute_batch("BEGIN IMMEDIATE")
            .map_err(|_| "file-search:storage".into())
    }
    pub fn commit(&self) -> Result<(), String> {
        self.db
            .execute_batch("COMMIT")
            .map_err(|_| "file-search:storage".into())
    }
    pub fn rollback(&self) {
        let _ = self.db.execute_batch("ROLLBACK");
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn streamed_cache_preserves_scope_and_stops_on_cancel_or_consumer_failure() {
        let base=std::env::temp_dir().join(format!("toolknit-stream-cache-{}",std::process::id()));
        std::fs::create_dir(&base).unwrap();let source=base.join("source");std::fs::create_dir(&source).unwrap();
        let store=Store::open(&base.join("cache/index.sqlite")).unwrap();
        for n in 0..12 {let file=source.join(format!("file{n}.txt"));std::fs::write(&file,b"source unchanged").unwrap();store.upsert(&mut entry(&file,0).unwrap(),1).unwrap();}
        let mut ids=Vec::new();let count=store.visit(std::slice::from_ref(&source),||false,|e|{assert!(!e.verified);ids.push(e.id);Ok(())}).unwrap();
        assert_eq!(count,12);assert_eq!(ids,store.load(std::slice::from_ref(&source),||false).unwrap().iter().map(|e|e.id).collect::<Vec<_>>());
        let visited=std::cell::Cell::new(0);
        let error=store.visit(std::slice::from_ref(&source),||visited.get()>=3,|_|{visited.set(visited.get()+1);Ok(())}).unwrap_err();
        assert_eq!(error,"file-search:cancelled");assert_eq!(visited.get(),3);
        let mut calls=0;let error=store.visit(std::slice::from_ref(&source),||false,|_|{calls+=1;Err("synthetic consumer failure".into())}).unwrap_err();
        assert_eq!(error,"synthetic consumer failure");assert_eq!(calls,1);
        assert_eq!(store.visit(&[base.join("elsewhere")],||false,|_|panic!("outside scope")).unwrap(),0);
        assert_eq!(store.load(&[source.clone()],||false).unwrap().len(),12);assert_eq!(std::fs::read(source.join("file0.txt")).unwrap(),b"source unchanged");
        drop(store);std::fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn batched_deletion_rolls_back_on_error_without_touching_source_files() {
        let base = std::env::temp_dir().join(format!("toolknit-delete-batch-{}",std::process::id()));
        std::fs::create_dir(&base).unwrap();
        let source = base.join("source");std::fs::create_dir(&source).unwrap();
        let a=source.join("a.txt");let b=source.join("b.txt");
        std::fs::write(&a,b"a").unwrap();std::fs::write(&b,b"b").unwrap();
        let store=Store::open(&base.join("cache/index.sqlite")).unwrap();
        for path in [&a,&b] { store.upsert(&mut entry(path,0).unwrap(),1).unwrap(); }
        store.db.execute_batch("CREATE TRIGGER reject_second BEFORE DELETE ON files WHEN OLD.id=2 BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;").unwrap();
        let paths=vec![std::sync::Arc::<Path>::from(a.as_path()),std::sync::Arc::<Path>::from(b.as_path())];
        assert!(store.remove_batch(&paths).is_err());
        assert_eq!(store.load(&[source.clone()],||false).unwrap().len(),2);
        store.db.execute_batch("DROP TRIGGER reject_second").unwrap();
        store.remove_batch(&paths).unwrap();assert!(store.load(&[source],||false).unwrap().is_empty());
        assert_eq!(std::fs::read(&a).unwrap(),b"a");assert_eq!(std::fs::read(&b).unwrap(),b"b");
        drop(store);std::fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn policy_upgrade_and_reused_volume_remove_only_cached_metadata() {
        use super::super::scope_policy::{Policy, Spec, VERSION};
        let base = std::env::temp_dir().join(format!("toolknit-policy-cache-{}", std::process::id()));
        let root = base.join("source"); let noise = root.join("node_modules");
        std::fs::create_dir_all(&noise).unwrap();
        let doc = root.join("合同.pdf"); let dep = noise.join("index.js");
        std::fs::write(&doc, b"document").unwrap(); std::fs::write(&dep, b"dependency").unwrap();
        let root = root.canonicalize().unwrap(); let db = base.join("cache/index.sqlite");
        let store = Store::open(&db).unwrap();
        for path in [&doc, &dep] { store.upsert(&mut entry(&path.canonicalize().unwrap(), 0).unwrap(), 1).unwrap(); }
        assert_eq!(store.load(&[root.clone()], || false).unwrap().len(), 2); drop(store);
        let policy = Policy::from_spec(Some(Spec { version: VERSION, ..Default::default() })).unwrap();
        let store = Store::open_policy(&db, policy.clone()).unwrap();
        let kept = store.load(&[root.clone()], || false).unwrap(); assert_eq!(kept.len(), 1); assert_eq!(kept[0].name, "合同.pdf"); drop(store);
        let store = Store::open_policy(&db, policy.clone().with_volumes(vec![(root.clone(), "disk-a".into())])).unwrap();
        assert!(store.load(&[root.clone()], || false).unwrap().is_empty(), "unidentified old cache is not attributed to a new disk");
        store.upsert(&mut entry(&doc.canonicalize().unwrap(), 0).unwrap(), 1).unwrap();
        assert_eq!(store.load(&[root.clone()], || false).unwrap().len(), 1); drop(store);
        let store = Store::open_policy(&db, policy.with_volumes(vec![(root.clone(), "disk-b".into())])).unwrap();
        assert!(store.load(&[root], || false).unwrap().is_empty(), "a reused mount cannot show the previous disk's entries"); drop(store);
        assert_eq!(std::fs::read(&doc).unwrap(), b"document"); assert_eq!(std::fs::read(&dep).unwrap(), b"dependency");
        std::fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn metadata_cache_keeps_ids_scope_and_original_file() {
        let root = std::env::temp_dir().join(format!(
            "toolknit-fsearch-store-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let file = root.join("合同, final.pdf");
        std::fs::write(&file, b"source unchanged").unwrap();
        let store = Store::open(&root.join("index.sqlite")).unwrap();
        let mut e = entry(&file, 0).unwrap();
        store.upsert(&mut e, 1).unwrap();
        let id = e.id;
        store.upsert(&mut e, 2).unwrap();
        assert_eq!(e.id, id);
        let rows = store.load(&[root.clone()], || false).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].path.as_ref(), file);
        assert_eq!(rows[0].size, Some(16));
        assert!(store
            .load(&[root.join("other")], || false)
            .unwrap()
            .is_empty());
        store.remove(&file).unwrap();
        assert!(store.load(&[root.clone()], || false).unwrap().is_empty());
        assert_eq!(std::fs::read(file).unwrap(), b"source unchanged");
        store.checkpoint().unwrap();
        drop(store);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    #[cfg(windows)]
    fn native_path_encoding_preserves_unpaired_utf16() {
        use std::os::windows::ffi::OsStringExt;
        let path = PathBuf::from(std::ffi::OsString::from_wide(&[
            68, 58, 92, 0xD800, 46, 116, 120, 116,
        ]));
        assert_eq!(decode(&encode(&path)).unwrap(), path);
    }
}

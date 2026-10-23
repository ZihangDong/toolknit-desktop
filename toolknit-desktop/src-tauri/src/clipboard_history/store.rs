use super::types::*;
use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use base64::Engine;
use hmac::{Hmac, Mac};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha2::Sha256;
use std::path::{Path, PathBuf};
use zeroize::Zeroizing;

type Result<T> = std::result::Result<T, String>;
pub(super) fn db_error(_: rusqlite::Error) -> String {
    "clipboard:storage-failed".into()
}

#[derive(Serialize, Deserialize)]
struct Summary {
    preview: String,
    bytes: usize,
    width: Option<u32>,
    height: Option<u32>,
    count: usize,
    rich: bool,
    thumbnail: Option<String>,
}
impl Summary {
    fn new(content: &Content) -> Result<Self> {
        let mut summary = Self {
            preview: String::new(),
            bytes: content.bytes(),
            width: None,
            height: None,
            count: 0,
            rich: false,
            thumbnail: None,
        };
        match content {
            Content::Text { text, rich } => {
                summary.preview = text.chars().take(240).collect();
                summary.count = text.chars().count();
                summary.rich = *rich;
            }
            Content::Files { paths } => {
                summary.preview = paths
                    .iter()
                    .take(5)
                    .filter_map(|p| Path::new(p).file_name())
                    .map(|p| p.to_string_lossy())
                    .collect::<Vec<_>>()
                    .join("\n");
                summary.count = paths.len();
            }
            Content::Image { png, width, height } => {
                summary.width = Some(*width);
                summary.height = Some(*height);
                let image = image::load_from_memory_with_format(png, image::ImageFormat::Png)
                    .map_err(|_| "clipboard:image-invalid")?;
                let mut buffer = std::io::Cursor::new(Vec::new());
                image
                    .thumbnail(320, 200)
                    .write_to(&mut buffer, image::ImageFormat::Png)
                    .map_err(|_| "clipboard:image-invalid")?;
                summary.thumbnail = Some(format!(
                    "data:image/png;base64,{}",
                    base64::engine::general_purpose::STANDARD.encode(buffer.into_inner())
                ));
            }
        }
        Ok(summary)
    }
}

pub struct Store {
    pub(super) db: Connection,
    pub(super) key: Zeroizing<Vec<u8>>,
    pub directory: PathBuf,
}
impl Store {
    pub fn preserve_unreadable(directory: &Path) -> Result<PathBuf> {
        match Self::open(directory) {
            Err(error)
                if matches!(
                    error.as_str(),
                    "clipboard:key-missing"
                        | "clipboard:key-invalid"
                        | "clipboard:key-unavailable"
                        | "clipboard:key-mismatch"
                ) => {}
            _ => return Err("clipboard:restart-unavailable".into()),
        }
        let archive = directory.with_file_name(format!("clipboard-history-preserved-{}", now_ms()));
        if archive.exists() {
            return Err("clipboard:storage-failed".into());
        }
        std::fs::rename(directory, &archive).map_err(|_| "clipboard:storage-failed")?;
        Ok(archive)
    }
    pub fn open(directory: &Path) -> Result<Self> {
        std::fs::create_dir_all(directory).map_err(|_| "clipboard:storage-failed")?;
        let guard = std::fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(directory.join("history-init.lock"))
            .map_err(|_| "clipboard:key-storage")?;
        guard.try_lock().map_err(|_| "clipboard:storage-busy")?;
        let db = Connection::open(directory.join("history.sqlite")).map_err(db_error)?;
        db.busy_timeout(std::time::Duration::from_secs(2))
            .map_err(db_error)?;
        let key = super::key::load(&db, directory)?;
        Self::initialize(db, key, directory.to_owned())
    }

    pub(super) fn initialize(db: Connection, key: Vec<u8>, directory: PathBuf) -> Result<Self> {
        db.busy_timeout(std::time::Duration::from_secs(2))
            .map_err(db_error)?;
        db.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE; PRAGMA secure_delete=ON; PRAGMA auto_vacuum=INCREMENTAL;
            CREATE TABLE IF NOT EXISTS config (id INTEGER PRIMARY KEY CHECK(id=1), value BLOB NOT NULL);
            CREATE TABLE IF NOT EXISTS contents (hash TEXT PRIMARY KEY, body BLOB NOT NULL, summary BLOB NOT NULL);
            CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, captured_at INTEGER NOT NULL, offset_minutes INTEGER NOT NULL,
                kind TEXT NOT NULL, hash TEXT NOT NULL REFERENCES contents(hash), source BLOB NOT NULL, favorite INTEGER NOT NULL DEFAULT 0, used_at INTEGER);
            CREATE INDEX IF NOT EXISTS events_time ON events(captured_at);
            CREATE INDEX IF NOT EXISTS events_hash ON events(hash);
            CREATE TABLE IF NOT EXISTS event_notes (id INTEGER PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE, body BLOB NOT NULL);
            CREATE TABLE IF NOT EXISTS phrases (id INTEGER PRIMARY KEY AUTOINCREMENT, fingerprint TEXT NOT NULL UNIQUE, body BLOB NOT NULL);
            CREATE TABLE IF NOT EXISTS history_order (id INTEGER PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE, rank INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS phrase_order (id INTEGER PRIMARY KEY REFERENCES phrases(id) ON DELETE CASCADE, rank INTEGER NOT NULL);
            INSERT OR IGNORE INTO history_order SELECT id,id FROM events;
            INSERT OR IGNORE INTO phrase_order SELECT id,id FROM phrases;
            CREATE INDEX IF NOT EXISTS history_order_rank ON history_order(rank);
            CREATE INDEX IF NOT EXISTS phrase_order_rank ON phrase_order(rank);
            PRAGMA user_version=3;").map_err(db_error)?;
        Ok(Self {
            db,
            key: Zeroizing::new(key),
            directory,
        })
    }
    pub(super) fn seal<T: Serialize>(&self, value: &T, context: &[u8]) -> Result<Vec<u8>> {
        let plain =
            Zeroizing::new(serde_json::to_vec(value).map_err(|_| "clipboard:storage-failed")?);
        let mut nonce = [0u8; 12];
        getrandom::getrandom(&mut nonce).map_err(|_| "clipboard:key-failed")?;
        let cipher = Aes256Gcm::new_from_slice(&self.key).map_err(|_| "clipboard:key-failed")?;
        let mut result = nonce.to_vec();
        result.extend(
            cipher
                .encrypt(
                    Nonce::from_slice(&nonce),
                    Payload {
                        msg: &plain,
                        aad: context,
                    },
                )
                .map_err(|_| "clipboard:key-failed")?,
        );
        Ok(result)
    }
    pub(super) fn unseal<T: DeserializeOwned>(&self, bytes: &[u8], context: &[u8]) -> Result<T> {
        if bytes.len() < 28 {
            return Err("clipboard:record-damaged".into());
        }
        let cipher = Aes256Gcm::new_from_slice(&self.key).map_err(|_| "clipboard:key-failed")?;
        let plain = Zeroizing::new(
            cipher
                .decrypt(
                    Nonce::from_slice(&bytes[..12]),
                    Payload {
                        msg: &bytes[12..],
                        aad: context,
                    },
                )
                .map_err(|_| "clipboard:record-damaged")?,
        );
        serde_json::from_slice(&plain).map_err(|_| "clipboard:record-damaged".into())
    }
    pub fn settings(&self) -> Result<Settings> {
        let data: Option<Vec<u8>> = self
            .db
            .query_row("SELECT value FROM config WHERE id=1", [], |r| r.get(0))
            .optional()
            .map_err(db_error)?;
        let settings: Settings = match data {
            Some(bytes) => self.unseal(&bytes, b"settings")?,
            None => Settings::default(),
        };
        settings.validate()?;
        Ok(settings)
    }
    pub fn save_settings(&self, settings: &Settings) -> Result<()> {
        settings.validate()?;
        self.db.execute("INSERT INTO config VALUES(1, ?1) ON CONFLICT(id) DO UPDATE SET value=excluded.value", [self.seal(settings, b"settings")?]).map_err(db_error)?;
        Ok(())
    }
    pub fn save_monitoring_state(&self, settings: &Settings, enabled: bool) -> Result<Settings> {
        let mut settings = settings.clone();
        settings.resume_on_launch = enabled;
        self.save_settings(&settings)?;
        std::fs::write(
            self.directory.join("resume.json"),
            if enabled {
                b"true".as_slice()
            } else {
                b"false".as_slice()
            },
        )
        .map_err(|_| "clipboard:storage-failed")?;
        Ok(settings)
    }
    pub fn stats(&self, day_start: i64) -> Result<(u64, u64, u64)> {
        let (total, today) = self
            .db
            .query_row(
                "SELECT COUNT(*), COALESCE(SUM(captured_at >= ?1),0) FROM events",
                [day_start],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(db_error)?;
        let bytes = self.logical_bytes()?;
        Ok((total, today, bytes))
    }
    pub fn latest_id(&self) -> Result<i64> {
        self.db
            .query_row(
                "SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name='events'),0)",
                [],
                |r| r.get(0),
            )
            .map_err(db_error)
    }
    pub(super) fn logical_bytes(&self) -> Result<u64> {
        self.db.query_row("SELECT COALESCE((SELECT SUM(length(body)+length(summary)) FROM contents),0) + COALESCE((SELECT SUM(length(source)+128) FROM events),0) + COALESCE((SELECT SUM(length(body)) FROM event_notes),0)", [], |r|r.get(0)).map_err(db_error)
    }
    fn garbage_collect(&self) -> Result<()> {
        self.db.execute("DELETE FROM contents WHERE NOT EXISTS(SELECT 1 FROM events WHERE events.hash=contents.hash)", []).map_err(db_error)?;
        Ok(())
    }
    fn enforce(&self, settings: &Settings, now: i64) -> Result<()> {
        self.db
            .execute(
                "DELETE FROM events WHERE favorite=0 AND captured_at < ?1",
                [now - i64::from(settings.retention_days) * 86_400_000],
            )
            .map_err(db_error)?;
        self.garbage_collect()?;
        loop {
            let count: u64 = self
                .db
                .query_row("SELECT COUNT(*) FROM events", [], |r| r.get(0))
                .map_err(db_error)?;
            if count <= u64::from(settings.max_records)
                && self.logical_bytes()? <= u64::from(settings.max_megabytes) * 1024 * 1024
            {
                return Ok(());
            }
            if self.db.execute("DELETE FROM events WHERE id=(SELECT id FROM events WHERE favorite=0 ORDER BY id LIMIT 1)", []).map_err(db_error)? == 0 { return Err("clipboard:capacity".into()); }
            self.garbage_collect()?;
        }
    }
    pub fn prune(&self, settings: &Settings) -> Result<()> {
        self.enforce(settings, now_ms())?;
        self.db
            .execute_batch("PRAGMA incremental_vacuum(128)")
            .map_err(db_error)
    }
    pub fn insert(
        &self,
        content: &Content,
        source: Option<String>,
        timestamp: i64,
        offset: i32,
        settings: &Settings,
    ) -> Result<i64> {
        content.validate()?;
        let raw =
            Zeroizing::new(serde_json::to_vec(content).map_err(|_| "clipboard:storage-failed")?);
        let mut mac =
            <Hmac<Sha256> as Mac>::new_from_slice(&self.key).map_err(|_| "clipboard:key-failed")?;
        mac.update(&raw);
        let hash = hex::encode(mac.finalize().into_bytes());
        let exists: bool = self
            .db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM contents WHERE hash=?1)",
                [&hash],
                |r| r.get(0),
            )
            .map_err(db_error)?;
        let encrypted = if exists {
            None
        } else {
            Some((
                self.seal(content, hash.as_bytes())?,
                self.seal(&Summary::new(content)?, hash.as_bytes())?,
            ))
        };
        let provenance = self.seal(&Provenance { source }, b"source")?;
        let transaction = self.db.unchecked_transaction().map_err(db_error)?;
        if let Some((body, summary)) = encrypted {
            if (body.len() + summary.len()) as u64 > u64::from(settings.max_megabytes) * 1024 * 1024
            {
                return Err("clipboard:too-large".into());
            }
            transaction
                .execute(
                    "INSERT INTO contents VALUES(?1,?2,?3)",
                    params![hash, body, summary],
                )
                .map_err(db_error)?;
        }
        transaction.execute("INSERT INTO events(captured_at,offset_minutes,kind,hash,source) VALUES(?1,?2,?3,?4,?5)", params![timestamp,offset,content.kind(),hash,provenance]).map_err(db_error)?;
        let id = transaction.last_insert_rowid();
        transaction.execute("INSERT INTO history_order VALUES(?1,(SELECT COALESCE(MAX(rank),0)+1 FROM history_order))", [id]).map_err(db_error)?;
        self.enforce(settings, timestamp)?;
        let retained: bool = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM events WHERE id=?1)",
                [id],
                |r| r.get(0),
            )
            .map_err(db_error)?;
        if !retained {
            return Err("clipboard:capacity".into());
        }
        transaction.commit().map_err(db_error)?;
        Ok(id)
    }
    pub fn entry(&self, id: i64) -> Result<Entry> {
        let (timestamp,offset,kind,hash,source,favorite,used_at,summary): (i64,i32,String,String,Vec<u8>,bool,Option<i64>,Vec<u8>) = self.db.query_row(
            "SELECT e.captured_at,e.offset_minutes,e.kind,e.hash,e.source,e.favorite,e.used_at,c.summary FROM events e JOIN contents c ON e.hash=c.hash WHERE e.id=?1", [id],
            |r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?))).optional().map_err(db_error)?.ok_or("clipboard:not-found")?;
        let summary: Summary = self.unseal(&summary, hash.as_bytes())?;
        let source: Provenance = self.unseal(&source, b"source")?;
        Ok(Entry {
            id,
            note: self.note(id)?,
            captured_at: timestamp,
            offset_minutes: offset,
            kind,
            favorite,
            source: source.source,
            preview: summary.preview,
            bytes: summary.bytes,
            width: summary.width,
            height: summary.height,
            count: summary.count,
            rich: summary.rich,
            thumbnail: summary.thumbnail,
            used_at,
        })
    }
    pub fn content(&self, id: i64) -> Result<Content> {
        let (hash, bytes): (String, Vec<u8>) = self
            .db
            .query_row(
                "SELECT c.hash,c.body FROM contents c JOIN events e ON e.hash=c.hash WHERE e.id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(db_error)?
            .ok_or("clipboard:not-found")?;
        self.unseal(&bytes, hash.as_bytes())
    }
    pub fn detail(&self, id: i64) -> Result<Detail> {
        let mut detail = Detail {
            entry: self.entry(id)?,
            text: None,
            image: None,
            paths: vec![],
        };
        match self.content(id)? {
            Content::Text { text, .. } => detail.text = Some(text),
            Content::Image { png, .. } => {
                detail.image = Some(format!(
                    "data:image/png;base64,{}",
                    base64::engine::general_purpose::STANDARD.encode(png)
                ))
            }
            Content::Files { paths } => detail.paths = paths,
        }
        Ok(detail)
    }
    pub fn page(&self, query: &Query, cancelled: impl Fn() -> bool) -> Result<Page> {
        let limit = query.limit.unwrap_or(50);
        if query.search.len() > 512
            || !(1..=50).contains(&limit)
            || !["", "text", "image", "files"].contains(&query.kind.as_str())
        {
            return Err("clipboard:invalid-query".into());
        }
        let max: i64 = self
            .db
            .query_row("SELECT COALESCE(MAX(id),0) FROM events", [], |r| r.get(0))
            .map_err(db_error)?;
        let snapshot = query.snapshot.unwrap_or(max).min(max);
        if query.ordered && (query.before.is_some() || query.snapshot.is_some()) {
            return Err("clipboard:invalid-query".into());
        }
        let sql = if query.ordered {
            "SELECT e.id FROM events e JOIN history_order o ON o.id=e.id WHERE e.id<=?1 AND e.id<?2 AND (?3='' OR kind=?3) AND (?4=0 OR favorite=1) AND captured_at>=?5 AND captured_at<=?6 ORDER BY o.rank DESC,e.id DESC"
        } else {
            "SELECT id FROM events WHERE id<=?1 AND id<?2 AND (?3='' OR kind=?3) AND (?4=0 OR favorite=1) AND captured_at>=?5 AND captured_at<=?6 ORDER BY id DESC"
        };
        let mut stmt = self.db.prepare(sql).map_err(db_error)?;
        let ids = stmt
            .query_map(
                params![
                    snapshot,
                    query.before.unwrap_or(i64::MAX),
                    query.kind,
                    query.favorites,
                    query.from.unwrap_or(0),
                    query.to.unwrap_or(i64::MAX)
                ],
                |r| r.get::<_, i64>(0),
            )
            .map_err(db_error)?;
        let needle = query.search.to_lowercase();
        let mut items = vec![];
        let mut next = None;
        for id in ids {
            if cancelled() {
                return Err("clipboard:cancelled".into());
            }
            let id = id.map_err(db_error)?;
            let entry = self.entry(id)?;
            if !needle.is_empty()
                && !entry
                    .source
                    .as_deref()
                    .unwrap_or("")
                    .to_lowercase()
                    .contains(&needle)
                && !entry.preview.to_lowercase().contains(&needle)
                && !entry.note.to_lowercase().contains(&needle)
                && (entry.kind == "image"
                    || !self
                        .content(id)?
                        .searchable()
                        .to_lowercase()
                        .contains(&needle))
            {
                continue;
            }
            if items.len() == limit {
                if !query.ordered {
                    next = items.last().map(|e: &Entry| e.id);
                }
                break;
            }
            items.push(entry);
        }
        Ok(Page {
            items,
            next,
            snapshot,
        })
    }
    pub fn favorite(&self, id: i64, favorite: bool) -> Result<()> {
        self.db
            .execute(
                "UPDATE events SET favorite=?2 WHERE id=?1",
                params![id, favorite],
            )
            .map_err(db_error)?;
        Ok(())
    }
    pub fn used(&self, id: i64) -> Result<()> {
        self.db
            .execute(
                "UPDATE events SET used_at=?2 WHERE id=?1",
                params![id, now_ms()],
            )
            .map_err(db_error)?;
        Ok(())
    }
    pub fn delete(&self, ids: &[i64]) -> Result<()> {
        if ids.len() > 10000 {
            return Err("clipboard:invalid-query".into());
        }
        let tx = self.db.unchecked_transaction().map_err(db_error)?;
        for id in ids {
            tx.execute("DELETE FROM events WHERE id=?1", [id])
                .map_err(db_error)?;
        }
        self.garbage_collect()?;
        tx.commit().map_err(db_error)?;
        self.db
            .execute_batch("PRAGMA incremental_vacuum(128)")
            .map_err(db_error)
    }
    pub fn clear(&self, include_favorites: bool) -> Result<()> {
        let tx = self.db.unchecked_transaction().map_err(db_error)?;
        tx.execute(
            "DELETE FROM events WHERE ?1 OR favorite=0",
            [include_favorites],
        )
        .map_err(db_error)?;
        self.garbage_collect()?;
        tx.commit().map_err(db_error)?;
        self.db.execute_batch("VACUUM").map_err(db_error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn store() -> Store {
        Store::initialize(
            Connection::open_in_memory().unwrap(),
            vec![7; 32],
            PathBuf::new(),
        )
        .unwrap()
    }
    fn text(value: &str) -> Content {
        Content::Text {
            text: value.into(),
            rich: false,
        }
    }
    #[cfg(windows)]
    #[test]
    fn protected_backup_recovers_missing_and_corrupt_key_without_losing_records() {
        let directory = std::env::temp_dir().join(format!(
            "toolknit-key-recovery-{}-{}",
            std::process::id(),
            now_ms()
        ));
        let store = Store::open(&directory).unwrap();
        let id = store
            .insert(
                &text("recovery fixture"),
                None,
                now_ms(),
                0,
                &Settings::default(),
            )
            .unwrap();
        drop(store);
        std::fs::remove_file(directory.join("history-key.dpapi")).unwrap();
        let store = Store::open(&directory).unwrap();
        assert_eq!(
            store.detail(id).unwrap().text.as_deref(),
            Some("recovery fixture")
        );
        drop(store);
        std::fs::write(directory.join("history-key.dpapi"), b"damaged").unwrap();
        let store = Store::open(&directory).unwrap();
        assert_eq!(
            store.detail(id).unwrap().text.as_deref(),
            Some("recovery fixture")
        );
        assert!(std::fs::read_dir(&directory).unwrap().any(|p| p
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with("history-key-unreadable-")));
        drop(store);
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[cfg(windows)]
    #[test]
    fn legacy_missing_key_is_distinguished_and_database_is_preserved() {
        let directory = std::env::temp_dir().join(format!(
            "toolknit-key-legacy-{}-{}",
            std::process::id(),
            now_ms()
        ));
        let store = Store::open(&directory).unwrap();
        store
            .insert(
                &text("keep encrypted record"),
                None,
                now_ms(),
                0,
                &Settings::default(),
            )
            .unwrap();
        store.db.execute_batch("DROP TABLE key_backup").unwrap();
        drop(store);
        std::fs::remove_file(directory.join("history-key.dpapi")).unwrap();
        let before = std::fs::read(directory.join("history.sqlite")).unwrap();
        assert!(matches!(Store::open(&directory), Err(e) if e == "clipboard:key-missing"));
        assert_eq!(
            before,
            std::fs::read(directory.join("history.sqlite")).unwrap()
        );
        assert!(!directory.join("history-key.dpapi").exists());
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[cfg(windows)]
    #[test]
    fn foreign_valid_key_never_replaces_the_database_key() {
        let directory = std::env::temp_dir().join(format!(
            "toolknit-key-mismatch-{}-{}",
            std::process::id(),
            now_ms()
        ));
        let store = Store::open(&directory).unwrap();
        let id = store
            .insert(&text("original"), None, now_ms(), 0, &Settings::default())
            .unwrap();
        drop(store);
        let other = crate::platform::protected_data::transform(&mut [4; 32], true).unwrap();
        std::fs::write(directory.join("history-key.dpapi"), other).unwrap();
        let store = Store::open(&directory).unwrap();
        assert_eq!(store.detail(id).unwrap().text.as_deref(), Some("original"));
        drop(store);
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[cfg(windows)]
    #[test]
    fn restarting_unreadable_history_preserves_the_entire_database() {
        let parent = std::env::temp_dir().join(format!(
            "toolknit-key-preserve-{}-{}",
            std::process::id(),
            now_ms()
        ));
        let directory = parent.join("clipboard-history");
        let store = Store::open(&directory).unwrap();
        store
            .insert(
                &text("preserve me"),
                None,
                now_ms(),
                0,
                &Settings::default(),
            )
            .unwrap();
        store.db.execute_batch("DROP TABLE key_backup").unwrap();
        drop(store);
        assert!(
            matches!(Store::preserve_unreadable(&directory), Err(error) if error == "clipboard:restart-unavailable")
        );
        // A successful legacy open creates the backup, so remove it to simulate a V3.1 loss.
        let db = Connection::open(directory.join("history.sqlite")).unwrap();
        db.execute_batch("DROP TABLE key_backup").unwrap();
        drop(db);
        std::fs::remove_file(directory.join("history-key.dpapi")).unwrap();
        let bytes = std::fs::read(directory.join("history.sqlite")).unwrap();
        let archive = Store::preserve_unreadable(&directory).unwrap();
        assert_eq!(
            bytes,
            std::fs::read(archive.join("history.sqlite")).unwrap()
        );
        let new = Store::open(&directory).unwrap();
        assert_eq!(new.stats(0).unwrap().0, 0);
        assert!(!new.settings().unwrap().resume_on_launch);
        drop(new);
        std::fs::remove_dir_all(parent).unwrap();
    }
    #[cfg(target_os = "windows")]
    #[test]
    fn encrypted_history_reopens_with_current_user_key() {
        let directory = std::env::temp_dir().join(format!(
            "toolknit-clipboard-{}-{}",
            std::process::id(),
            now_ms()
        ));
        let store = Store::open(&directory).unwrap();
        let id = store
            .insert(
                &text("synthetic persistence fixture"),
                Some("fixture.exe".into()),
                now_ms(),
                480,
                &Settings::default(),
            )
            .unwrap();
        let settings = Settings {
            retention_days: 14,
            ..Default::default()
        };
        store.save_settings(&settings).unwrap();
        drop(store);
        let raw = std::fs::read(directory.join("history.sqlite")).unwrap();
        assert!(!raw.windows(21).any(|w| w == b"synthetic persistence"));
        let store = Store::open(&directory).unwrap();
        assert_eq!(
            store.detail(id).unwrap().text.as_deref(),
            Some("synthetic persistence fixture")
        );
        assert_eq!(store.settings().unwrap().retention_days, 14);
        store.clear(true).unwrap();
        drop(store);
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[cfg(target_os = "windows")]
    #[test]
    fn monitoring_switch_persists_resume_across_reopens() {
        let directory = std::env::temp_dir().join(format!(
            "toolknit-clipboard-resume-{}-{}",
            std::process::id(),
            now_ms()
        ));
        let store = Store::open(&directory).unwrap();
        let mut settings = store.settings().unwrap();
        assert!(!settings.resume_on_launch);
        settings.retention_days = 14;
        settings.excluded_apps = vec!["fixture.exe".into()];
        let saved = store.save_monitoring_state(&settings, true).unwrap();
        assert!(saved.resume_on_launch);
        drop(store);

        let store = Store::open(&directory).unwrap();
        let settings = store.settings().unwrap();
        assert!(settings.resume_on_launch);
        assert_eq!(settings.retention_days, 14);
        assert_eq!(settings.excluded_apps, vec!["fixture.exe"]);
        assert_eq!(
            std::fs::read(directory.join("resume.json")).unwrap(),
            b"true"
        );
        store.save_monitoring_state(&settings, false).unwrap();
        drop(store);

        let store = Store::open(&directory).unwrap();
        assert!(!store.settings().unwrap().resume_on_launch);
        assert_eq!(
            std::fs::read(directory.join("resume.json")).unwrap(),
            b"false"
        );
        std::fs::remove_file(directory.join("resume.json")).unwrap();
        std::fs::create_dir(directory.join("resume.json")).unwrap();
        assert_eq!(
            store.save_monitoring_state(&settings, true).unwrap_err(),
            "clipboard:storage-failed"
        );
        drop(store);
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn full_favorites_rollback_new_capture_without_losing_history() {
        let store = store();
        let settings = Settings {
            max_records: 100,
            ..Default::default()
        };
        for _ in 0..100 {
            let id = store
                .insert(&text("favorite"), None, now_ms(), 0, &settings)
                .unwrap();
            store.favorite(id, true).unwrap();
        }
        assert_eq!(
            store
                .insert(&text("cannot fit"), None, now_ms(), 0, &settings)
                .unwrap_err(),
            "clipboard:capacity"
        );
        assert_eq!(store.stats(0).unwrap().0, 100);
        assert_eq!(
            store
                .db
                .query_row("SELECT COUNT(*) FROM contents", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );
    }
    #[cfg(target_os = "windows")]
    #[test]
    fn file_preview_retains_paths_without_touching_originals() {
        let store = store();
        let paths = vec![
            r"\\unreachable.invalid\share\sample.pdf".to_string(),
            r"C:\missing-clipboard-fixture.txt".to_string(),
        ];
        let id = store
            .insert(
                &Content::Files {
                    paths: paths.clone(),
                },
                None,
                now_ms(),
                0,
                &Settings::default(),
            )
            .unwrap();
        assert_eq!(store.detail(id).unwrap().paths, paths);
    }
    #[test]
    fn repeated_copies_preserve_events_and_deduplicate_encrypted_content() {
        let s = store();
        let settings = Settings::default();
        let first = s
            .insert(
                &text("private QA content"),
                Some("example.exe".into()),
                now_ms(),
                480,
                &settings,
            )
            .unwrap();
        let second = s
            .insert(&text("private QA content"), None, now_ms(), 480, &settings)
            .unwrap();
        assert!(second > first);
        assert_eq!(s.stats(0).unwrap().0, 2);
        assert_eq!(
            s.db.query_row("SELECT COUNT(*) FROM contents", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );
        let raw: Vec<u8> =
            s.db.query_row("SELECT body FROM contents", [], |r| r.get(0))
                .unwrap();
        assert!(!raw.windows(7).any(|w| w == b"private"));
        assert_eq!(
            s.detail(first).unwrap().text.as_deref(),
            Some("private QA content")
        );
    }
    #[test]
    fn search_pagination_and_snapshot_survive_new_records() {
        let s = store();
        for n in 0..55 {
            s.insert(
                &text(&format!("row {n}")),
                None,
                now_ms(),
                0,
                &Settings::default(),
            )
            .unwrap();
        }
        let page = s.page(&Query::default(), || false).unwrap();
        assert_eq!(page.items.len(), 50);
        s.insert(&text("new"), None, now_ms(), 0, &Settings::default())
            .unwrap();
        assert_eq!(
            s.page(
                &Query {
                    before: page.next,
                    snapshot: Some(page.snapshot),
                    ..Default::default()
                },
                || false
            )
            .unwrap()
            .items
            .len(),
            5
        );
        assert_eq!(
            s.page(
                &Query {
                    search: "row 21".into(),
                    ..Default::default()
                },
                || false
            )
            .unwrap()
            .items
            .len(),
            1
        );
        assert!(s.page(&Query::default(), || true).is_err());
    }
    #[test]
    fn recent_twenty_is_a_view_and_single_delete_updates_shared_history() {
        let store = store();
        for index in 0..21 {
            store
                .insert(
                    &text(&format!("record {index}")),
                    None,
                    now_ms(),
                    0,
                    &Settings::default(),
                )
                .unwrap();
        }
        let query = Query {
            limit: Some(20),
            ..Default::default()
        };
        let recent = store.page(&query, || false).unwrap();
        assert_eq!(recent.items.len(), 20);
        assert_eq!(recent.items[0].id, 21);
        assert_eq!(recent.items[19].id, 2);
        assert_eq!(store.stats(0).unwrap().0, 21);
        assert_eq!(store.detail(1).unwrap().text.as_deref(), Some("record 0"));
        store.delete(&[21]).unwrap();
        assert!(store.detail(21).is_err());
        let after = store.page(&query, || false).unwrap();
        assert_eq!(after.items[0].id, 20);
        assert_eq!(after.items[19].id, 1);
        assert_eq!(store.stats(0).unwrap().0, 20);
        for limit in [0, 51, usize::MAX] {
            assert!(store
                .page(
                    &Query {
                        limit: Some(limit),
                        ..Default::default()
                    },
                    || false
                )
                .is_err());
        }
    }
    #[test]
    fn clear_preserves_favorites_and_removes_unreferenced_content() {
        let s = store();
        let a = s
            .insert(&text("one"), None, now_ms(), 0, &Settings::default())
            .unwrap();
        s.insert(&text("two"), None, now_ms(), 0, &Settings::default())
            .unwrap();
        s.favorite(a, true).unwrap();
        s.clear(false).unwrap();
        assert_eq!(s.stats(0).unwrap().0, 1);
        s.clear(true).unwrap();
        assert_eq!(s.stats(0).unwrap(), (0, 0, 0));
        let watermark = s.latest_id().unwrap();
        let next = s
            .insert(
                &text("after clear"),
                None,
                now_ms(),
                0,
                &Settings::default(),
            )
            .unwrap();
        assert_eq!(next, watermark + 1);
    }
    #[test]
    fn old_records_expire_but_favorites_remain_and_tampering_fails() {
        let s = store();
        let old = now_ms() - 9 * 86_400_000;
        let id = s
            .insert(&text("retain"), None, old, 0, &Settings::default())
            .unwrap();
        s.favorite(id, true).unwrap();
        s.insert(&text("expire"), None, old, 0, &Settings::default())
            .unwrap();
        s.prune(&Settings::default()).unwrap();
        assert_eq!(s.stats(0).unwrap().0, 1);
        s.db.execute("UPDATE contents SET body=zeroblob(50)", [])
            .unwrap();
        assert!(s.content(id).is_err());
    }
}

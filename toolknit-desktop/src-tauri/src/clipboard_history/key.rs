use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use rusqlite::{Connection, OptionalExtension};
use std::{io::Write, path::Path};
use zeroize::Zeroizing;

type Result<T> = std::result::Result<T, String>;
const FILE: &str = "history-key.dpapi";

fn table_exists(db: &Connection, name: &str) -> Result<bool> {
    db.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
        [name],
        |r| r.get(0),
    )
    .map_err(|_| "clipboard:storage-failed".into())
}

fn sample(db: &Connection) -> Result<Option<(Vec<u8>, Vec<u8>)>> {
    if table_exists(db, "config")? {
        let bytes: Option<Vec<u8>> = db
            .query_row("SELECT value FROM config LIMIT 1", [], |r| r.get(0))
            .optional()
            .map_err(|_| "clipboard:storage-failed")?;
        if let Some(bytes) = bytes {
            return Ok(Some((bytes, b"settings".to_vec())));
        }
    }
    if table_exists(db, "contents")? {
        let sample = db
            .query_row("SELECT summary, hash FROM contents LIMIT 1", [], |r| {
                Ok((r.get(0)?, r.get::<_, String>(1)?.into_bytes()))
            })
            .optional()
            .map_err(|_| "clipboard:storage-failed".to_string())?;
        if sample.is_some() {
            return Ok(sample);
        }
    }
    if table_exists(db, "phrases")? {
        return db
            .query_row("SELECT body,id FROM phrases LIMIT 1", [], |r| {
                Ok((
                    r.get(0)?,
                    format!("phrase:{}", r.get::<_, i64>(1)?).into_bytes(),
                ))
            })
            .optional()
            .map_err(|_| "clipboard:storage-failed".into());
    }
    Ok(None)
}

fn unlock(mut blob: Vec<u8>, sample: &Option<(Vec<u8>, Vec<u8>)>) -> Result<Vec<u8>> {
    if blob.is_empty() || blob.len() > 16384 {
        return Err("clipboard:key-invalid".into());
    }
    let key = Zeroizing::new(
        crate::platform::protected_data::transform(&mut blob, false)
            .map_err(|_| "clipboard:key-unavailable")?,
    );
    if key.len() != 32 {
        return Err("clipboard:key-invalid".into());
    }
    if let Some((bytes, context)) = sample {
        if bytes.len() < 28 {
            return Err("clipboard:record-damaged".into());
        }
        let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| "clipboard:key-invalid")?;
        let _plain = Zeroizing::new(
            cipher
                .decrypt(
                    Nonce::from_slice(&bytes[..12]),
                    Payload {
                        msg: &bytes[12..],
                        aad: context,
                    },
                )
                .map_err(|_| "clipboard:key-mismatch")?,
        );
    }
    Ok(key.to_vec())
}

fn publish(directory: &Path, blob: &[u8]) -> Result<()> {
    let pending = directory.join("history-key.pending");
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(&pending)
        .map_err(|_| "clipboard:key-storage")?;
    file.write_all(blob)
        .and_then(|_| file.sync_all())
        .map_err(|_| "clipboard:key-storage")?;
    drop(file);
    let target = directory.join(FILE);
    // Retain an invalid original for recovery; never overwrite it with another key.
    if target.exists() {
        let saved = directory.join(format!(
            "history-key-unreadable-{}.dpapi",
            super::types::now_ms()
        ));
        if saved.exists() {
            return Err("clipboard:key-storage".into());
        }
        std::fs::rename(&target, saved).map_err(|_| "clipboard:key-storage")?;
    }
    std::fs::rename(pending, target).map_err(|_| "clipboard:key-storage".into())
}

// The caller holds the directory initialization lock until the store is ready.
pub(super) fn load(db: &Connection, directory: &Path) -> Result<Vec<u8>> {
    let sample = sample(db)?;
    let path = directory.join(FILE);
    let mut failure = "clipboard:key-missing".to_string();
    let mut chosen = None;
    match std::fs::metadata(&path) {
        Ok(meta) if meta.len() <= 16384 => match std::fs::read(&path) {
            Ok(blob) => match unlock(blob.clone(), &sample) {
                Ok(key) => chosen = Some((key, blob, false)),
                Err(error) => failure = error,
            },
            Err(_) => failure = "clipboard:key-storage".into(),
        },
        Ok(_) => failure = "clipboard:key-invalid".into(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => failure = "clipboard:key-storage".into(),
    }
    if chosen.is_none() && table_exists(db, "key_backup")? {
        let backup: Option<Vec<u8>> = db
            .query_row(
                "SELECT protected FROM key_backup WHERE id=1 AND length(protected)<=16384",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(|_| "clipboard:storage-failed")?;
        if let Some(blob) = backup {
            match unlock(blob.clone(), &sample) {
                Ok(key) => chosen = Some((key, blob, true)),
                Err(error) if failure == "clipboard:key-missing" => failure = error,
                Err(_) => {}
            }
        }
    }
    if chosen.is_none() {
        // Existing ciphertext must never be stranded by generating a replacement key.
        if sample.is_some() || path.exists() || table_exists(db, "key_backup")? {
            return Err(failure);
        }
        let mut key = Zeroizing::new(vec![0u8; 32]);
        getrandom::getrandom(&mut key).map_err(|_| "clipboard:key-failed")?;
        let blob = crate::platform::protected_data::transform(&mut key, true)
            .map_err(|_| "clipboard:key-unavailable")?;
        chosen = Some((key.to_vec(), blob, true));
    }
    let (key, blob, restore) = chosen.ok_or("clipboard:key-failed")?;
    // Commit the DPAPI blob before publishing its file so interrupted writes are recoverable.
    db.execute_batch("CREATE TABLE IF NOT EXISTS key_backup(id INTEGER PRIMARY KEY CHECK(id=1), protected BLOB NOT NULL)")
        .map_err(|_| "clipboard:storage-failed")?;
    db.execute("INSERT INTO key_backup VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET protected=excluded.protected", [&blob])
        .map_err(|_| "clipboard:storage-failed")?;
    if restore {
        publish(directory, &blob)?;
    }
    Ok(key)
}

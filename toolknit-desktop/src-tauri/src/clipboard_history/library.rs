use super::{
    store::{db_error, Store},
    types::*,
};
use hmac::{Hmac, Mac};
use rusqlite::{params, OptionalExtension};
use sha2::Sha256;

type Result<T> = std::result::Result<T, String>;
const MAX_NOTE: usize = 4096;
const MAX_PHRASE_TEXT: usize = 65536;
const MAX_PHRASES: u64 = 2000;
const MAX_PHRASE_BYTES: u64 = 16 * 1024 * 1024;

impl Store {
    pub(super) fn note(&self, id: i64) -> Result<String> {
        let body: Option<Vec<u8>> = self
            .db
            .query_row("SELECT body FROM event_notes WHERE id=?1", [id], |r| {
                r.get(0)
            })
            .optional()
            .map_err(db_error)?;
        body.map(|body| self.unseal(&body, format!("note:{id}").as_bytes()))
            .unwrap_or_else(|| Ok(String::new()))
    }

    pub fn save_note(&self, id: i64, note: &str) -> Result<()> {
        if id <= 0 || note.len() > MAX_NOTE || note.contains('\0') {
            return Err("clipboard:invalid-note".into());
        }
        let exists: bool = self
            .db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM events WHERE id=?1)",
                [id],
                |r| r.get(0),
            )
            .map_err(db_error)?;
        if !exists {
            return Err("clipboard:not-found".into());
        }
        let tx = self.db.unchecked_transaction().map_err(db_error)?;
        if note.trim().is_empty() {
            self.db
                .execute("DELETE FROM event_notes WHERE id=?1", [id])
                .map_err(db_error)?;
        } else {
            let body = self.seal(&note, format!("note:{id}").as_bytes())?;
            self.db.execute("INSERT INTO event_notes VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET body=excluded.body", params![id, body]).map_err(db_error)?;
            if self.logical_bytes()? > u64::from(self.settings()?.max_megabytes) * 1024 * 1024 {
                return Err("clipboard:note-capacity".into());
            }
        }
        tx.commit().map_err(db_error)
    }

    pub fn phrase(&self, id: i64) -> Result<Phrase> {
        let body: Vec<u8> = self
            .db
            .query_row("SELECT body FROM phrases WHERE id=?1", [id], |r| r.get(0))
            .optional()
            .map_err(db_error)?
            .ok_or("clipboard:not-found")?;
        self.unseal(&body, format!("phrase:{id}").as_bytes())
    }

    pub fn save_phrase(
        &self,
        id: Option<i64>,
        title: String,
        text: String,
        note: String,
    ) -> Result<Phrase> {
        if id.is_some_and(|id| id <= 0)
            || title.trim().is_empty()
            || title.len() > 256
            || text.trim().is_empty()
            || text.len() > MAX_PHRASE_TEXT
            || note.len() > MAX_NOTE
            || [&title, &text, &note].iter().any(|s| s.contains('\0'))
        {
            return Err("clipboard:invalid-phrase".into());
        }
        // A keyed fingerprint supports duplicate detection without storing plaintext.
        let mut mac =
            <Hmac<Sha256> as Mac>::new_from_slice(&self.key).map_err(|_| "clipboard:key-failed")?;
        mac.update(b"phrase:");
        mac.update(text.replace("\r\n", "\n").trim().as_bytes());
        let fingerprint = hex::encode(mac.finalize().into_bytes());
        let tx = self.db.unchecked_transaction().map_err(db_error)?;
        let duplicate: Option<i64> = tx
            .query_row(
                "SELECT id FROM phrases WHERE fingerprint=?1",
                [&fingerprint],
                |r| r.get(0),
            )
            .optional()
            .map_err(db_error)?;
        if duplicate.is_some() && duplicate != id {
            return Err("clipboard:phrase-duplicate".into());
        }
        let (count, bytes): (u64, u64) = tx
            .query_row(
                "SELECT COUNT(*),COALESCE(SUM(length(body)),0) FROM phrases WHERE id<>?1",
                [id.unwrap_or(0)],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(db_error)?;
        if count >= MAX_PHRASES {
            return Err("clipboard:phrase-capacity".into());
        }
        let created_at = if let Some(id) = id {
            self.phrase(id)?.created_at
        } else {
            now_ms()
        };
        let id = match id {
            Some(id) => id,
            None => {
                tx.execute(
                    "INSERT INTO phrases(fingerprint,body) VALUES(?1,X'')",
                    [&fingerprint],
                )
                .map_err(db_error)?;
                tx.last_insert_rowid()
            }
        };
        tx.execute("INSERT OR IGNORE INTO phrase_order VALUES(?1,(SELECT COALESCE(MAX(rank),0)+1 FROM phrase_order))", [id]).map_err(db_error)?;
        let phrase = Phrase {
            id,
            title: title.trim().into(),
            text,
            note,
            created_at,
            updated_at: now_ms(),
        };
        let body = self.seal(&phrase, format!("phrase:{id}").as_bytes())?;
        if bytes + body.len() as u64 > MAX_PHRASE_BYTES {
            return Err("clipboard:phrase-capacity".into());
        }
        tx.execute(
            "UPDATE phrases SET fingerprint=?1,body=?2 WHERE id=?3",
            params![fingerprint, body, id],
        )
        .map_err(db_error)?;
        tx.commit().map_err(db_error)?;
        Ok(phrase)
    }

    pub fn phrase_from_history(&self, id: i64) -> Result<Phrase> {
        let Content::Text { text, .. } = self.content(id)? else {
            return Err("clipboard:phrase-text-only".into());
        };
        let title: String = text
            .lines()
            .find(|line| !line.trim().is_empty())
            .unwrap_or("")
            .trim()
            .chars()
            .take(60)
            .collect();
        self.save_phrase(None, title, text, String::new())
    }

    pub fn delete_phrase(&self, id: i64) -> Result<()> {
        if id <= 0 {
            return Err("clipboard:invalid-query".into());
        }
        if self
            .db
            .execute("DELETE FROM phrases WHERE id=?1", [id])
            .map_err(db_error)?
            == 0
        {
            return Err("clipboard:not-found".into());
        }
        Ok(())
    }

    pub fn phrases(&self, query: &PhraseQuery, cancelled: impl Fn() -> bool) -> Result<PhrasePage> {
        if query.search.len() > 512 {
            return Err("clipboard:invalid-query".into());
        }
        let needle = query.search.trim().to_lowercase();
        let mut stmt = self
            .db
            .prepare("SELECT id FROM phrase_order WHERE rank<?1 ORDER BY rank DESC,id DESC")
            .map_err(db_error)?;
        let ids = stmt
            .query_map(
                [match query.before {
                    Some(id) => self
                        .db
                        .query_row("SELECT rank FROM phrase_order WHERE id=?1", [id], |r| {
                            r.get::<_, i64>(0)
                        })
                        .optional()
                        .map_err(db_error)?
                        .ok_or("clipboard:order-changed")?,
                    None => i64::MAX,
                }],
                |r| r.get::<_, i64>(0),
            )
            .map_err(db_error)?;
        let mut page = PhrasePage {
            items: vec![],
            next: None,
        };
        for id in ids {
            if cancelled() {
                return Err("clipboard:cancelled".into());
            }
            let mut phrase = self.phrase(id.map_err(db_error)?)?;
            if ![&phrase.title, &phrase.text]
                .iter()
                .any(|s| s.to_lowercase().contains(&needle))
            {
                continue;
            }
            if page.items.len() == 50 {
                page.next = page.items.last().map(|p| p.id);
                break;
            }
            phrase.text = phrase.text.chars().take(240).collect();
            phrase.note = phrase.note.chars().take(240).collect();
            page.items.push(phrase);
        }
        Ok(page)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use std::path::PathBuf;

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
    #[test]
    fn notes_are_per_event_encrypted_and_searchable_outside_recent_twenty() {
        let s = store();
        let now = now_ms();
        let first = s
            .insert(&text("same body"), None, now, 480, &Settings::default())
            .unwrap();
        let second = s
            .insert(&text("same body"), None, now, 480, &Settings::default())
            .unwrap();
        for i in 0..21 {
            s.insert(
                &text(&format!("new {i}")),
                None,
                now,
                0,
                &Settings::default(),
            )
            .unwrap();
        }
        s.save_note(first, "SyntheticAccount-备注").unwrap();
        assert_eq!(s.entry(second).unwrap().note, "");
        assert_eq!(s.detail(first).unwrap().text.as_deref(), Some("same body"));
        assert_eq!(s.entry(first).unwrap().captured_at, now);
        let page = s
            .page(
                &Query {
                    search: "syntheticaccount".into(),
                    limit: Some(20),
                    ..Default::default()
                },
                || false,
            )
            .unwrap();
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].id, first);
        let blob: Vec<u8> =
            s.db.query_row("SELECT body FROM event_notes WHERE id=?1", [first], |r| {
                r.get(0)
            })
            .unwrap();
        assert!(!blob.windows(16).any(|v| v == b"SyntheticAccount"));
        assert!(s.save_note(999, "orphan").is_err());
        assert!(s.save_note(first, &"x".repeat(MAX_NOTE + 1)).is_err());
        s.delete(&[first]).unwrap();
        assert_eq!(s.note(first).unwrap(), "");
        assert_eq!(s.detail(second).unwrap().text.as_deref(), Some("same body"));
    }
    #[test]
    fn phrases_survive_retention_and_clear_and_reject_duplicates_without_mutation() {
        let s = store();
        let id = s
            .insert(
                &text("fixture@example.test"),
                None,
                now_ms(),
                0,
                &Settings::default(),
            )
            .unwrap();
        s.save_note(id, "Synthetic mail").unwrap();
        let phrase = s.phrase_from_history(id).unwrap();
        assert_eq!(phrase.note, "");
        assert_eq!(s.note(id).unwrap(), "Synthetic mail");
        assert_eq!(
            s.phrase_from_history(id).unwrap_err(),
            "clipboard:phrase-duplicate"
        );
        let other = s
            .save_phrase(None, "Other".into(), "second value".into(), "".into())
            .unwrap();
        assert!(s
            .save_phrase(
                Some(other.id),
                "overwrite".into(),
                phrase.text.clone(),
                "".into()
            )
            .is_err());
        assert_eq!(s.phrase(other.id).unwrap().text, "second value");
        s.prune(&Settings::default()).unwrap();
        s.clear(true).unwrap();
        assert_eq!(s.phrase(phrase.id).unwrap().text, "fixture@example.test");
        let page = s
            .phrases(
                &PhraseQuery {
                    search: "fixture@EXAMPLE".into(),
                    ..Default::default()
                },
                || false,
            )
            .unwrap();
        assert_eq!(page.items.len(), 1);
        let saved = s
            .save_phrase(
                Some(phrase.id),
                "Email".into(),
                "new@example.test".into(),
                "changed".into(),
            )
            .unwrap();
        assert_eq!(saved.created_at, phrase.created_at);
        assert!(
            s.phrases(
                &PhraseQuery {
                    search: "changed".into(),
                    ..Default::default()
                },
                || false
            )
            .unwrap()
            .items
            .is_empty(),
            "legacy notes are preserved but no longer searched for phrases"
        );
        assert!(s.phrases(&PhraseQuery::default(), || true).is_err());
        s.delete_phrase(phrase.id).unwrap();
        assert!(s.phrase(phrase.id).is_err());
        assert!(s.phrase(other.id).is_ok());
    }
    #[test]
    fn phrase_pagination_keeps_full_content_and_limits_do_not_evict() {
        let s = store();
        for i in 0..51 {
            s.save_phrase(
                None,
                format!("entry {i}"),
                format!("{} {i}", "long ".repeat(100)),
                "".into(),
            )
            .unwrap();
        }
        let page = s.phrases(&PhraseQuery::default(), || false).unwrap();
        assert_eq!(page.items.len(), 50);
        assert_eq!(page.items[0].text.chars().count(), 240);
        assert!(s.phrase(page.items[0].id).unwrap().text.len() > 240);
        let last = s
            .phrases(
                &PhraseQuery {
                    before: page.next,
                    ..Default::default()
                },
                || false,
            )
            .unwrap();
        assert_eq!(last.items.len(), 1);
        assert!(last.next.is_none());
        assert!(s
            .save_phrase(None, "".into(), "value".into(), "".into())
            .is_err());
        assert!(s
            .save_phrase(
                None,
                "oversized".into(),
                "x".repeat(MAX_PHRASE_TEXT + 1),
                "".into()
            )
            .is_err());
        assert_eq!(
            s.db.query_row("SELECT COUNT(*) FROM phrases", [], |r| r.get::<_, u64>(0))
                .unwrap(),
            51
        );
        let file = s
            .insert(
                &Content::Files {
                    paths: vec![std::env::current_exe()
                        .unwrap()
                        .to_string_lossy()
                        .into_owned()],
                },
                None,
                now_ms(),
                0,
                &Settings::default(),
            )
            .unwrap();
        assert_eq!(
            s.phrase_from_history(file).unwrap_err(),
            "clipboard:phrase-text-only"
        );
    }
    #[test]
    fn upgrading_v1_is_additive_and_phrase_ciphertext_is_bound_to_its_id() {
        let s = store();
        let id = s
            .insert(
                &text("legacy fixture"),
                None,
                now_ms(),
                0,
                &Settings::default(),
            )
            .unwrap();
        s.db.execute_batch("DROP TABLE event_notes; DROP TABLE phrases; PRAGMA user_version=1;")
            .unwrap();
        let s = Store::initialize(s.db, vec![7; 32], PathBuf::new()).unwrap();
        assert_eq!(
            s.detail(id).unwrap().text.as_deref(),
            Some("legacy fixture")
        );
        assert_eq!(s.entry(id).unwrap().note, "");
        let a = s
            .save_phrase(
                None,
                "fixture".into(),
                "SyntheticSecret".into(),
                "private note".into(),
            )
            .unwrap();
        let b = s
            .save_phrase(None, "another".into(), "OtherSecret".into(), "".into())
            .unwrap();
        let body: Vec<u8> =
            s.db.query_row("SELECT body FROM phrases WHERE id=?1", [a.id], |r| r.get(0))
                .unwrap();
        assert!(!body.windows(15).any(|v| v == b"SyntheticSecret"));
        s.db.execute(
            "UPDATE phrases SET body=?1 WHERE id=?2",
            params![body, b.id],
        )
        .unwrap();
        assert_eq!(s.phrase(b.id).unwrap_err(), "clipboard:record-damaged");
        assert_eq!(s.phrase(a.id).unwrap().text, "SyntheticSecret");
    }
    #[cfg(windows)]
    #[test]
    fn phrases_reopen_after_key_file_loss_when_history_is_empty() {
        let directory = std::env::temp_dir().join(format!(
            "toolknit-phrase-fixture-{}-{}",
            std::process::id(),
            now_ms()
        ));
        let s = Store::open(&directory).unwrap();
        let phrase = s
            .save_phrase(
                None,
                "fixture".into(),
                "not a real secret".into(),
                "note".into(),
            )
            .unwrap();
        drop(s);
        std::fs::remove_file(directory.join("history-key.dpapi")).unwrap();
        let s = Store::open(&directory).unwrap();
        assert_eq!(s.phrase(phrase.id).unwrap().text, "not a real secret");
        drop(s);
        std::fs::remove_dir_all(directory).unwrap();
    }
}

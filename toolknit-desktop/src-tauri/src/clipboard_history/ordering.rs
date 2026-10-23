use super::{
    store::{db_error, Store},
    types::Collection,
};
use rusqlite::params;

impl Store {
    pub fn reorder(
        &self,
        collection: Collection,
        id: i64,
        target: i64,
        after: bool,
    ) -> Result<(), String> {
        if id <= 0 || target <= 0 || id == target {
            return Err("clipboard:invalid-query".into());
        }
        let table = match collection {
            Collection::History => "history_order",
            Collection::Phrases => "phrase_order",
        };
        let tx = self.db.unchecked_transaction().map_err(db_error)?;
        let mut ids = {
            let mut statement = tx
                .prepare(&format!(
                    "SELECT id FROM {table} ORDER BY rank DESC,id DESC"
                ))
                .map_err(db_error)?;
            let result = statement
                .query_map([], |row| row.get::<_, i64>(0))
                .map_err(db_error)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(db_error)?;
            result
        };
        let from = ids
            .iter()
            .position(|value| *value == id)
            .ok_or("clipboard:order-changed")?;
        ids.remove(from);
        let to = ids
            .iter()
            .position(|value| *value == target)
            .ok_or("clipboard:order-changed")?;
        ids.insert(to + usize::from(after), id);
        // Resolve the anchor against the current transaction, preserving concurrent new records.
        let mut statement = tx
            .prepare(&format!("UPDATE {table} SET rank=?2 WHERE id=?1"))
            .map_err(db_error)?;
        for (index, id) in ids.iter().enumerate() {
            statement
                .execute(params![id, (ids.len() - index) as i64])
                .map_err(db_error)?;
        }
        drop(statement);
        tx.commit().map_err(db_error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clipboard_history::types::*;
    fn store() -> Store {
        Store::initialize(
            rusqlite::Connection::open_in_memory().unwrap(),
            vec![7; 32],
            Default::default(),
        )
        .unwrap()
    }
    fn add(s: &Store, value: usize) -> i64 {
        s.insert(
            &Content::Text {
                text: format!("record {value}"),
                rich: false,
            },
            None,
            now_ms(),
            480,
            &Settings::default(),
        )
        .unwrap()
    }
    fn shelf(s: &Store) -> Vec<i64> {
        s.page(
            &Query {
                ordered: true,
                limit: Some(20),
                ..Default::default()
            },
            || false,
        )
        .unwrap()
        .items
        .iter()
        .map(|v| v.id)
        .collect()
    }
    #[test]
    fn persisted_order_controls_shelf_replacement_without_deleting_archive() {
        let s = store();
        let ids: Vec<_> = (0..21).map(|i| add(&s, i)).collect();
        s.reorder(Collection::History, ids[1], ids[20], false)
            .unwrap();
        assert_eq!(shelf(&s)[0], ids[1]);
        let newest = add(&s, 22);
        let page = shelf(&s);
        assert_eq!(&page[..2], &[newest, ids[1]]);
        assert!(!page.contains(&ids[2]));
        assert!(s.entry(ids[2]).is_ok());
        assert_eq!(s.page(&Query::default(), || false).unwrap().items.len(), 22);
        assert_eq!(
            s.page(&Query::default(), || false).unwrap().items[0].id,
            newest
        );
        let s = Store::initialize(s.db, vec![7; 32], Default::default()).unwrap();
        assert_eq!(shelf(&s), page);
    }
    #[test]
    fn anchors_preserve_new_items_and_reject_removed_targets_without_changes() {
        let s = store();
        let a = add(&s, 1);
        let b = add(&s, 2);
        let c = add(&s, 3);
        let new = add(&s, 4);
        s.reorder(Collection::History, a, b, false).unwrap();
        assert_eq!(shelf(&s), vec![new, c, a, b]);
        let prior = shelf(&s);
        assert!(s.reorder(Collection::History, a, 999, false).is_err());
        assert_eq!(shelf(&s), prior);
        s.reorder(Collection::History, c, b, true).unwrap();
        assert_eq!(shelf(&s), vec![new, a, b, c]);
    }
    #[test]
    fn phrase_order_survives_edits_and_uses_ordered_page_cursor() {
        let s = store();
        let items: Vec<_> = (0..51)
            .map(|i| {
                s.save_phrase(None, format!("p{i}"), format!("text{i}"), String::new())
                    .unwrap()
            })
            .collect();
        s.reorder(Collection::Phrases, items[0].id, items[50].id, false)
            .unwrap();
        s.save_phrase(
            Some(items[0].id),
            "changed".into(),
            "edited".into(),
            String::new(),
        )
        .unwrap();
        let first = s.phrases(&PhraseQuery::default(), || false).unwrap();
        assert_eq!(first.items[0].id, items[0].id);
        let next = s
            .phrases(
                &PhraseQuery {
                    before: first.next,
                    ..Default::default()
                },
                || false,
            )
            .unwrap();
        assert_eq!(next.items[0].id, items[1].id);
    }
}

use super::matcher::Matcher;
use serde::{Deserialize, Serialize};
use std::hash::{Hash, Hasher};
use std::{
    cmp::Ordering,
    collections::{BTreeMap, BTreeSet, BinaryHeap},
    path::Path,
    sync::Arc,
};

#[derive(Clone, Debug)]
pub(super) struct Entry {
    pub id: u64,
    pub path: Arc<Path>,
    pub name: String,
    pub parent: Arc<str>,
    pub extension: String,
    pub size: Option<u64>,
    pub modified: Option<u64>,
    pub verified: bool,
}
#[derive(Clone, Copy, Default, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(super) enum Sort {
    #[default]
    Relevance,
    NameAsc,
    NameDesc,
    Newest,
    Oldest,
    Largest,
    Smallest,
}
#[derive(Clone, Default, Debug, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Query {
    pub text: String,
    pub extension: String,
    pub sort: Sort,
}
impl Query {
    pub fn normalized(mut self) -> Result<Self, String> {
        if self.text.chars().count() > 256
            || self.text.chars().any(|c| c.is_control())
            || self.extension.len() > 1024
        {
            return Err("file-search:query".into());
        }
        self.text = self.text.trim().to_owned();
        self.extension = self
            .extension
            .trim()
            .trim_start_matches('.')
            .to_ascii_lowercase();
        if self
            .extension
            .chars()
            .any(|c| c.is_control() || ['/', '\\', ':', '*', '?', '"', '<', '>', '|'].contains(&c))
        {
            return Err("file-search:query".into());
        }
        Ok(self)
    }
    pub fn empty(&self) -> bool {
        self.text.is_empty() && self.extension.is_empty()
    }
}
pub(super) fn extension(name: &str) -> String {
    name.rsplit_once('.')
        .filter(|(stem, ext)| !stem.is_empty() && !ext.is_empty())
        .map(|(_, ext)| ext.to_ascii_lowercase())
        .unwrap_or_default()
}
fn terms(text: &str) -> Vec<String> {
    let mut terms = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    for c in text.chars() {
        if c == '"' {
            quoted = !quoted;
        } else if c.is_whitespace() && !quoted {
            if !current.is_empty() {
                terms.push(std::mem::take(&mut current));
            }
        } else {
            current.push(c);
        }
    }
    if !current.is_empty() {
        terms.push(current);
    }
    terms
}
pub(super) fn natural_cmp(a: &str, b: &str) -> Ordering {
    let a = a.as_bytes();
    let b = b.as_bytes();
    let (mut i, mut j) = (0, 0);
    while i < a.len() && j < b.len() {
        if a[i].is_ascii_digit() && b[j].is_ascii_digit() {
            let (ai, bj) = (i, j);
            while i < a.len() && a[i].is_ascii_digit() {
                i += 1;
            }
            while j < b.len() && b[j].is_ascii_digit() {
                j += 1;
            }
            let (mut az, mut bz) = (ai, bj);
            while az + 1 < i && a[az] == b'0' {
                az += 1;
            }
            while bz + 1 < j && b[bz] == b'0' {
                bz += 1;
            }
            let order = (i - az)
                .cmp(&(j - bz))
                .then_with(|| a[az..i].cmp(&b[bz..j]))
                .then_with(|| (i - ai).cmp(&(j - bj)));
            if order != Ordering::Equal {
                return order;
            }
        } else {
            let order = a[i].to_ascii_lowercase().cmp(&b[j].to_ascii_lowercase());
            if order != Ordering::Equal {
                return order;
            }
            i += 1;
            j += 1;
        }
    }
    (a.len() - i).cmp(&(b.len() - j))
}
fn optional_cmp(a: Option<u64>, b: Option<u64>, descending: bool) -> Ordering {
    match (a, b) {
        (Some(a), Some(b)) => {
            if descending {
                b.cmp(&a)
            } else {
                a.cmp(&b)
            }
        }
        (None, Some(_)) => Ordering::Greater,
        (Some(_), None) => Ordering::Less,
        _ => Ordering::Equal,
    }
}
struct Hit<'a> {
    entry: &'a Entry,
    rank: u32,
    sort: Sort,
}
impl PartialEq for Hit<'_> {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == Ordering::Equal
    }
}
impl Eq for Hit<'_> {}
impl PartialOrd for Hit<'_> {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for Hit<'_> {
    fn cmp(&self, other: &Self) -> Ordering {
        let (a, b) = (self.entry, other.entry);
        let order = match self.sort {
            Sort::Relevance => self.rank.cmp(&other.rank),
            Sort::NameAsc => natural_cmp(&a.name, &b.name),
            Sort::NameDesc => natural_cmp(&b.name, &a.name),
            Sort::Newest => optional_cmp(a.modified, b.modified, true),
            Sort::Oldest => optional_cmp(a.modified, b.modified, false),
            Sort::Largest => optional_cmp(a.size, b.size, true),
            Sort::Smallest => optional_cmp(a.size, b.size, false),
        };
        order
            .then_with(|| natural_cmp(&a.name, &b.name))
            .then_with(|| natural_cmp(&a.parent, &b.parent))
            .then_with(|| a.id.cmp(&b.id))
    }
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Row {
    pub id: String,
    pub name: String,
    pub parent: String,
    pub extension: String,
    pub size: Option<u64>,
    pub modified: Option<u64>,
    pub stale: bool,
}
impl From<&Entry> for Row {
    fn from(e: &Entry) -> Self {
        Self {
            id: e.id.to_string(),
            name: e.name.clone(),
            parent: e.parent.to_string(),
            extension: e.extension.clone(),
            size: e.size,
            modified: e.modified,
            stale: !e.verified,
        }
    }
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Results {
    pub rows: Vec<Row>,
    pub total: usize,
    pub extensions: Vec<String>,
    pub more: bool,
    pub fingerprint: String,
}
// Global top-K: never sort only the first arbitrary matches. The cap bounds heap
// memory; cursor paging later uses a stable last-item key, not an unbounded offset.
#[cfg(test)]
pub(super) fn search(
    entries: &[Entry],
    query: &Query,
    limit: usize,
    cancelled: impl Fn() -> bool,
) -> Result<Results, String> {
    search_after(entries, query, limit, None, cancelled)
}
#[cfg(test)]
pub(super) fn search_after(
    entries: &[Entry],
    query: &Query,
    limit: usize,
    after: Option<u64>,
    cancelled: impl Fn() -> bool,
) -> Result<Results, String> {
    let pivot = if let Some(id) = after {
        let mut found = None;
        for chunk in entries.chunks(128) {
            if cancelled() { return Err("file-search:cancelled".into()); }
            if let Some(entry) = chunk.iter().find(|entry| entry.id == id) { found = Some(entry); break; }
        }
        Some(found.ok_or("file-search:stale-query")?)
    } else { None };
    search_with_metadata(entries, query, limit, pivot, None, cancelled)
}

// Catalog metadata is maintained at mutation time under the same read/write
// lock as entries. Empty input and cursor lookup no longer walk the entire disk.
pub(super) fn search_with_metadata(
    entries: &[Entry],
    query: &Query,
    limit: usize,
    after: Option<&Entry>,
    known_extensions: Option<&BTreeMap<String, usize>>,
    cancelled: impl Fn() -> bool,
) -> Result<Results, String> {
    if !(1..=200).contains(&limit) {
        return Err("file-search:query".into());
    }
    let query = query.clone().normalized()?;
    if cancelled() { return Err("file-search:cancelled".into()); }
    if query.empty() && after.is_none() {
        if let Some(extensions) = known_extensions {
            return Ok(Results { rows: Vec::new(), total: 0, extensions: extensions.keys().cloned().collect(), more: false, fingerprint: "0:0".into() });
        }
    }
    let mut extensions = BTreeSet::new();
    let text_terms = terms(&query.text);
    let matchers = text_terms
        .iter()
        .map(|t| Matcher::new(t))
        .collect::<Result<Vec<_>, _>>()?;
    let rank_of = |entry: &Entry| -> Option<u32> {
        let mut rank = 0;
        for m in &matchers {
            match m.rank(&entry.name) {
                Some(value) => rank += value,
                None => {
                    if m.literal(&entry.parent) {
                        rank += 8;
                    } else {
                        return None;
                    }
                }
            }
        }
        Some(rank)
    };
    let pivot = after
        .map(|entry| {
            rank_of(entry).map(|rank| Hit { entry, rank, sort: query.sort })
                .ok_or("file-search:stale-query")
        })
        .transpose()?;
    let mut best = BinaryHeap::with_capacity(limit + 1);
    let mut total = 0;
    let mut remaining = 0;
    let (mut fingerprint_sum, mut fingerprint_xor) = (0u64, 0u64);
    for (index, entry) in entries.iter().enumerate() {
        if index % 128 == 0 && cancelled() {
            return Err("file-search:cancelled".into());
        }
        if known_extensions.is_none() { extensions.insert(entry.extension.as_str()); }
        if query.empty() || (matchers.is_empty() && query.extension.is_empty()) {
            continue;
        }
        if !query.extension.is_empty()
            && ((query.extension == "__none__" && !entry.extension.is_empty())
                || (query.extension != "__none__" && query.extension != entry.extension))
        {
            continue;
        }
        let Some(rank) = rank_of(entry) else {
            continue;
        };
        total += 1;
        // Order independent: unrelated catalog swap-removes must not invalidate
        // this result set. Include metadata and identity, not only its count.
        let mut hash = std::collections::hash_map::DefaultHasher::new();
        (entry.id, &entry.name, &entry.parent, &entry.extension, entry.size, entry.modified, entry.verified).hash(&mut hash);
        let value = hash.finish(); fingerprint_sum = fingerprint_sum.wrapping_add(value); fingerprint_xor ^= value.rotate_left(23);
        let hit = Hit {
            entry,
            rank,
            sort: query.sort,
        };
        if pivot.as_ref().is_some_and(|p| hit <= *p) {
            continue;
        }
        remaining += 1;
        if best.len() < limit {
            best.push(hit);
        } else if best.peek().is_some_and(|last| hit < *last) {
            best.pop();
            best.push(hit);
        }
    }
    if cancelled() {
        return Err("file-search:cancelled".into());
    }
    let rows = best
        .into_sorted_vec()
        .into_iter()
        .map(|h| Row::from(h.entry))
        .collect::<Vec<_>>();
    Ok(Results {
        more: remaining > rows.len(),
        rows,
        total,
        fingerprint: format!("{fingerprint_sum:x}:{fingerprint_xor:x}"),
        extensions: known_extensions.map(|values| values.keys().cloned().collect())
            .unwrap_or_else(|| extensions.into_iter().map(str::to_owned).collect()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fingerprints_ignore_unrelated_changes_but_detect_equal_count_replacements() {
        let q=Query{text:"合同".into(),..Default::default()};
        let mut entries=vec![entry(1,"合同1.pdf",Some(5)),entry(2,"合同2.pdf",Some(7)),entry(3,"other.txt",Some(1))];
        let signature=|rows:&[Entry]|search(rows,&q,1,||false).unwrap().fingerprint;
        let original=signature(&entries);entries.reverse();assert_eq!(signature(&entries),original);
        entries[0].modified=Some(999);assert_eq!(signature(&entries),original);
        entries[1].name="合同改名.pdf".into();assert_ne!(signature(&entries),original);
        let renamed=signature(&entries);entries[1].verified=false;assert_ne!(signature(&entries),renamed);
        let stale=signature(&entries);entries[1].id=9;assert_ne!(signature(&entries),stale);
    }
    fn entry(id: u64, name: &str, size: Option<u64>) -> Entry {
        Entry {
            id,
            path: std::path::PathBuf::from(name).into(),
            name: name.into(),
            parent: "D:\\work".into(),
            extension: extension(name),
            size,
            modified: size,
            verified: true,
        }
    }
    #[test]
    fn extension_rules_and_natural_order() {
        assert_eq!(extension(".gitignore"), "");
        assert_eq!(extension("a.tar.GZ"), "gz");
        assert_eq!(extension("a.PDF"), "pdf");
        for (a, b) in [
            ("file2", "file10"),
            ("FILE2", "file02"),
            ("9", "99999999999999999999999999999999999"),
        ] {
            assert_eq!(natural_cmp(a, b), Ordering::Less);
        }
    }
    #[test]
    fn global_ranking_and_unknown_metadata() {
        let entries = vec![
            entry(1, "合同10.pdf", None),
            entry(2, "装修合同.docx", Some(99)),
            entry(3, "合同2.pdf", Some(3)),
            entry(4, "合同", Some(1)),
        ];
        let q = Query {
            text: "合同".into(),
            ..Default::default()
        };
        let r = search(&entries, &q, 2, || false).unwrap();
        assert_eq!(r.total, 4);
        assert_eq!(
            r.rows.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(),
            ["4", "3"]
        );
        assert!(r.more);
        let r = search(
            &entries,
            &Query {
                sort: Sort::Largest,
                ..q.clone()
            },
            20,
            || false,
        )
        .unwrap();
        assert_eq!(
            r.rows.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(),
            ["2", "3", "4", "1"]
        );
        let r = search(
            &entries,
            &Query {
                extension: ".PDF".into(),
                ..q
            },
            20,
            || false,
        )
        .unwrap();
        assert_eq!(r.total, 2);
        assert!(r.extensions.contains(&"docx".into()));
        assert!(search(&entries, &Query::default(), 20, || false)
            .unwrap()
            .rows
            .is_empty());
    }
    #[test]
    fn cancellation_multiword_and_extension_only() {
        let entries = vec![
            entry(1, "装修 合同.pdf", Some(1)),
            entry(2, "合同.txt", Some(2)),
        ];
        assert!(search(&entries, &Query::default(), 20, || true).is_err());
        assert_eq!(
            search(
                &entries,
                &Query {
                    text: "装修 合同".into(),
                    ..Default::default()
                },
                20,
                || false
            )
            .unwrap()
            .total,
            1
        );
        assert_eq!(
            search(
                &entries,
                &Query {
                    text: "\"装修 合同\"".into(),
                    ..Default::default()
                },
                20,
                || false
            )
            .unwrap()
            .total,
            1
        );
        assert_eq!(
            search(
                &entries,
                &Query {
                    extension: "txt".into(),
                    ..Default::default()
                },
                20,
                || false
            )
            .unwrap()
            .total,
            1
        );
        assert!(Query {
            text: "a\0b".into(),
            ..Default::default()
        }
        .normalized()
        .is_err());
    }
    #[test]
    fn cursor_paging_preserves_global_order_without_duplicate_rows() {
        let entries = (1..=13)
            .map(|id| entry(id, &format!("file{id}.pdf"), Some(id)))
            .collect::<Vec<_>>();
        let query = Query {
            text: "file".into(),
            sort: Sort::NameAsc,
            ..Default::default()
        };
        let mut collected = Vec::new();
        let mut after = None;
        loop {
            let r = search_after(&entries, &query, 5, after, || false).unwrap();
            if r.rows.is_empty() {
                break;
            }
            after = r.rows.last().unwrap().id.parse().ok();
            collected.extend(r.rows.into_iter().map(|r| r.id.parse::<u64>().unwrap()));
            if !r.more {
                break;
            }
        }
        assert_eq!(collected, (1..=13).collect::<Vec<_>>());
    }
    #[test]
    fn maintained_metadata_matches_scan_for_all_sorts_and_pages() {
        let mut catalog = super::super::index::Catalog::default();
        for id in 1..=173 {
            let extension = ["pdf", "docx", "", "PNG"][id as usize % 4];
            let name = format!("{}{}{}", ["合同", "invoice", "notes"][id as usize % 3], id,
                if extension.is_empty() { String::new() } else { format!(".{extension}") });
            catalog.insert(entry(id, &name, if id % 5 == 0 { None } else { Some(id * 31) }));
        }
        for sort in [Sort::Relevance, Sort::NameAsc, Sort::NameDesc, Sort::Newest, Sort::Oldest, Sort::Largest, Sort::Smallest] {
            for (text, extension) in [("",""),("合同",""),("hetong",""),("invoice",""),("","pdf"),("","__none__"),("none-matches","")] {
                let query = Query { text:text.into(), extension:extension.into(), sort };
                let mut after = None;
                loop {
                    let expected = search_after(&catalog.entries, &query, 11, after, || false).unwrap();
                    let pivot = after.and_then(|id| catalog.ids.get(&id).map(|at| &catalog.entries[*at]));
                    let actual = search_with_metadata(&catalog.entries, &query, 11, pivot, Some(&catalog.extensions), || false).unwrap();
                    assert_eq!(serde_json::to_value(&actual).unwrap(), serde_json::to_value(&expected).unwrap());
                    if !actual.more { break; }
                    after = actual.rows.last().unwrap().id.parse().ok();
                }
            }
        }
        assert_eq!(search_with_metadata(&catalog.entries, &Query::default(), 50, None, Some(&catalog.extensions), || true).unwrap_err(), "file-search:cancelled");
    }
}

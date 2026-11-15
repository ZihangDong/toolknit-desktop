//! Recover names of directories removed during this journal interval. Without
//! these edges, unrelated temporary-directory churn forces a full volume scan.
use super::super::{ntfs, ntfs_tree::valid_name};
use std::collections::{HashMap, HashSet};

struct Folder {
    parent: u64,
    name: Vec<u16>,
    reparse: bool,
}
#[derive(Default)]
pub(super) struct History {
    folders: HashMap<u64, Folder>,
    bytes: usize,
}
impl History {
    pub fn record(&mut self, record: &ntfs::Change<'_>) -> bool {
        if record.file & 0xFFFF_FFFF_FFFF < 16 || record.attributes & 0x10 == 0 {
            return true;
        }
        if !valid_name(record.name) {
            return false;
        }
        let cost = record.name.len() * 2 + 64;
        let previous = self
            .folders
            .get(&record.file)
            .map(|f| f.name.len() * 2 + 64)
            .unwrap_or(0);
        if self.bytes.saturating_sub(previous) + cost > 32 * 1024 * 1024
            || (previous == 0 && self.folders.len() >= 100_000)
        {
            return false;
        }
        self.bytes = self.bytes.saturating_sub(previous) + cost;
        self.folders.insert(
            record.file,
            Folder {
                parent: record.parent,
                name: record.name.to_vec(),
                reparse: record.attributes & 0x400 != 0,
            },
        );
        true
    }
    pub fn resolve(
        &self,
        drive: u8,
        parent: u64,
        mut live: impl FnMut(u64) -> Result<Vec<u16>, String>,
    ) -> Result<Vec<u16>, String> {
        let mut current = parent;
        let mut visited = HashSet::new();
        let mut chain = Vec::new();
        let mut path = loop {
            if !visited.insert(current) || chain.len() >= 256 {
                return Err("file-search:journal".into());
            }
            if let Ok(path) = live(current) {
                break path;
            }
            let folder = self.folders.get(&current).ok_or("file-search:journal")?;
            if folder.reparse {
                return Err("file-search:journal".into());
            }
            chain.push(folder.name.as_slice());
            current = folder.parent;
        };
        if !drive.is_ascii_uppercase() || !path.starts_with(&[drive as u16, 58, 92]) {
            return Err("file-search:journal".into());
        }
        for name in chain.into_iter().rev() {
            if path.last() != Some(&92) {
                path.push(92);
            }
            path.extend(name);
            if path.len() > 32700 {
                return Err("file-search:journal".into());
            }
        }
        Ok(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn add(history: &mut History, file: u64, parent: u64, name: &str, attributes: u32) -> bool {
        history.record(&ntfs::Change {
            file,
            parent,
            name: &name.encode_utf16().collect::<Vec<_>>(),
            reason: 0x200,
            attributes,
        })
    }
    fn live(id: u64) -> Result<Vec<u16>, String> {
        if id == 5 {
            Ok(r"C:\".encode_utf16().collect())
        } else {
            Err("missing".into())
        }
    }
    #[test]
    fn deleted_directory_chains_keep_full_reference_identity() {
        let mut history = History::default();
        assert!(add(&mut history, 40, 5, "outside", 0x10));
        assert!(add(&mut history, 60, 40, "gone", 0x10));
        assert_eq!(
            String::from_utf16(&history.resolve(b'C', 60, live).unwrap()).unwrap(),
            r"C:\outside\gone"
        );
        let reused = 60 + (1u64 << 48);
        assert!(add(&mut history, reused, 5, "new", 0x10));
        assert_eq!(
            String::from_utf16(&history.resolve(b'C', reused, live).unwrap()).unwrap(),
            r"C:\new"
        );
        assert_eq!(
            String::from_utf16(&history.resolve(b'C', 60, live).unwrap()).unwrap(),
            r"C:\outside\gone"
        );
    }
    #[test]
    fn historical_reparse_cycles_and_bad_names_require_reconciliation() {
        let mut history = History::default();
        assert!(!add(&mut history, 30, 5, "..", 0x10));
        assert!(add(&mut history, 30, 31, "a", 0x10));
        assert!(add(&mut history, 31, 30, "b", 0x10));
        assert!(history.resolve(b'C', 30, live).is_err());
        assert!(add(&mut history, 50, 5, "link", 0x410));
        assert!(history.resolve(b'C', 50, live).is_err());
        assert!(history.resolve(b'D', 5, live).is_err());
    }
}

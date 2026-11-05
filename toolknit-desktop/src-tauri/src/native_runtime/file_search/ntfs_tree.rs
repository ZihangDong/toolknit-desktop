//! MFT names are untrusted disk data; resolve only bounded, rooted parent chains.
#![cfg(windows)]
use super::ntfs;
use std::collections::{HashMap, HashSet};

#[derive(Clone, Debug)]
pub(super) struct Folder {
    pub parent: u32,
    pub name: Vec<u16>,
    pub reparse: bool,
}
#[derive(Default)]
pub(super) struct Tree {
    pub folders: HashMap<u32, Folder>,
    pub extensions: HashMap<u32, (Option<u64>, Option<u64>, u32, bool)>,
    paths: HashMap<u32, Vec<u16>>,
    blocked: HashSet<u32>,
    extension_names: Vec<(u32, u32, Vec<u16>)>,
}
pub(super) fn valid_name(name: &[u16]) -> bool {
    !name.is_empty()
        && name.len() <= 255
        && !name.iter().any(|c| [0, 47, 92, 58].contains(c))
        && name != [46]
        && name != [46, 46]
}
impl Tree {
    pub fn collect(&mut self, record: ntfs::Record<'_>) -> bool {
        if self.folders.len() > 1_000_000 || self.extensions.len() > 1_000_000 {
            return false;
        }
        if record.base != 0 {
            let value = self
                .extensions
                .entry(record.base)
                .or_insert((None, None, 0, false));
            if record.size.is_some() {
                value.0 = record.size;
            }
            if valid_name(record.name) {
                if self.extension_names.len() >= 1_000_000 {
                    return false;
                }
                self.extension_names.push((
                    record.base,
                    (record.parent & 0xFFFF_FFFF_FFFF).try_into().unwrap_or(0),
                    record.name.to_vec(),
                ));
            }
            return true;
        }
        // Metadata for extension-name records is bounded separately. Only base
        // records with a follow-up extension will be retained by the service.
        if record.attribute_list {
            let value = self
                .extensions
                .entry(record.number)
                .or_insert((None, None, 0, false));
            value.1 = record.modified;
            value.2 = record.attributes;
            value.3 = record.directory;
            if record.size.is_some() {
                value.0 = record.size;
            }
        }
        if record.directory && record.number != 5 && valid_name(record.name) {
            self.folders.entry(record.number).or_insert(Folder {
                parent: (record.parent & 0xFFFF_FFFF_FFFF).try_into().unwrap_or(0),
                name: record.name.to_vec(),
                reparse: record.attributes & 0x400 != 0,
            });
        }
        true
    }
    pub fn finish(&mut self) {
        for (owner, parent, name) in self.extension_names.drain(..) {
            if let Some((_, _, attributes, true)) = self.extensions.get(&owner) {
                self.folders.entry(owner).or_insert(Folder {
                    parent,
                    name,
                    reparse: attributes & 0x400 != 0,
                });
            }
        }
    }
    pub fn parent_path(&mut self, drive: u8, record: u32) -> Option<Vec<u16>> {
        use std::{ffi::OsString, os::windows::ffi::OsStringExt, path::PathBuf};
        self.parent_path_with(drive, record, |path| {
            super::storage::cloud_directory(&PathBuf::from(OsString::from_wide(path)))
        })
    }
    fn parent_path_with(&mut self, drive: u8, record: u32, mut cloud: impl FnMut(&[u16]) -> bool) -> Option<Vec<u16>> {
        if !drive.is_ascii_uppercase() {
            return None;
        }
        if record == 5 {
            return Some(vec![drive as u16, 58, 92]);
        }
        if let Some(path) = self.paths.get(&record) {
            return Some(path.clone());
        }
        let mut chain = Vec::new();
        let mut visited = HashSet::new();
        let mut current = record;
        let prefix = loop {
            if self.blocked.contains(&current) { self.blocked.insert(record); return None; }
            if current == 5 {
                break vec![drive as u16, 58, 92];
            }
            if let Some(prefix) = self.paths.get(&current) {
                break prefix.clone();
            }
            if !visited.insert(current) || chain.len() >= 512 {
                return None;
            }
            let folder = self.folders.get(&current)?;
            if !valid_name(&folder.name) {
                return None;
            }
            chain.push((current, folder.name.clone(), folder.reparse));
            current = folder.parent;
        };
        let mut path = prefix;
        for (number, name, reparse) in chain.into_iter().rev() {
            if path.last() != Some(&92) {
                path.push(92);
            }
            path.extend(name);
            if path.len() > 32700 {
                return None;
            }
            if reparse && !cloud(&path) {
                self.blocked.insert(number);
                self.blocked.insert(record);
                return None;
            }
            self.paths.insert(number, path.clone());
        }
        Some(path)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn folder(parent: u32, name: &str) -> Folder {
        Folder {
            parent,
            name: name.encode_utf16().collect(),
            reparse: false,
        }
    }
    #[test]
    fn cloud_metadata_is_allowed_but_junctions_and_unknown_tags_stay_blocked() {
        let mut tree = Tree::default();
        tree.folders.insert(20, Folder { reparse: true, ..folder(5, "cloud") });
        tree.folders.insert(21, folder(20, "documents"));
        let mut calls = 0;
        let path = tree.parent_path_with(b'C', 21, |_| { calls += 1; true }).unwrap();
        assert_eq!(String::from_utf16(&path).unwrap(), r"C:\cloud\documents");
        assert_eq!(calls, 1);
        assert!(tree.parent_path_with(b'C', 21, |_| panic!("cached metadata")).is_some());
        tree.folders.insert(30, Folder { reparse: true, ..folder(5, "junction") });
        tree.folders.insert(31, folder(30, "child"));
        assert!(tree.parent_path_with(b'C', 31, |_| false).is_none());
        assert!(tree.parent_path_with(b'C', 31, |_| panic!("cached rejection")).is_none());
        assert!(super::super::storage::cloud_tag(0x410, 0x9000f01a));
        assert!(!super::super::storage::cloud_tag(0x410, 0xa0000003));
        assert!(!super::super::storage::cloud_tag(0x400, 0x9000001a));
    }
    #[test]
    fn only_rooted_acyclic_non_reparse_paths_are_resolved() {
        let mut tree = Tree::default();
        tree.folders.insert(20, folder(5, "合同"));
        tree.folders.insert(21, folder(20, "2026"));
        assert_eq!(
            String::from_utf16(&tree.parent_path(b'C', 21).unwrap()).unwrap(),
            "C:\\合同\\2026"
        );
        tree.folders.insert(30, folder(31, "a"));
        tree.folders.insert(31, folder(30, "b"));
        assert!(tree.parent_path(b'C', 30).is_none());
        tree.folders.insert(
            40,
            Folder {
                reparse: true,
                ..folder(5, "junction")
            },
        );
        tree.folders.insert(41, folder(40, "child"));
        assert!(tree.parent_path(b'C', 41).is_none());
        assert!(tree.parent_path(b'C', 999).is_none());
        assert!(!valid_name(&[46, 46]));
        assert!(!valid_name(&[97, 92, 98]));
    }
}

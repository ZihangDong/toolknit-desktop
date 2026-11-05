//! Canonical local roots sent with each metadata request. Filter before ACL
//! traversal and serialization; unrelated activity must not force a rescan.
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{
    os::windows::ffi::{OsStrExt, OsStringExt},
    path::{Component, PathBuf, Prefix},
};

pub(super) fn encode(roots: &[PathBuf]) -> Vec<String> {
    roots
        .iter()
        .map(|p| {
            STANDARD.encode(
                p.as_os_str()
                    .encode_wide()
                    .flat_map(u16::to_le_bytes)
                    .collect::<Vec<_>>(),
            )
        })
        .collect()
}

pub(super) struct Scope(Vec<Vec<u16>>, super::super::scope_policy::Policy);
impl Scope {
    pub fn decode(drive: u8, roots: &[String]) -> Result<Self, String> {
        if roots.is_empty() || roots.len() > 32 {
            return Err("file-search:scope".into());
        }
        let mut result = Vec::new();
        for root in roots {
            if root.len() > 90000 {
                return Err("file-search:scope".into());
            }
            let raw = STANDARD.decode(root).map_err(|_| "file-search:scope")?;
            if raw.len() > 65534 || raw.len() % 2 != 0 {
                return Err("file-search:scope".into());
            }
            let mut units = raw
                .chunks_exact(2)
                .map(|b| u16::from_le_bytes([b[0], b[1]]))
                .collect::<Vec<_>>();
            if units.iter().any(|u| *u < 32 || *u == 47) {
                return Err("file-search:scope".into());
            }
            let path = PathBuf::from(std::ffi::OsString::from_wide(&units));
            if !path.is_absolute()
                || path
                    .components()
                    .any(|c| matches!(c, Component::ParentDir | Component::CurDir))
                || !matches!(path.components().next(),Some(Component::Prefix(p)) if matches!(p.kind(), Prefix::Disk(d)|Prefix::VerbatimDisk(d) if d.to_ascii_uppercase()==drive))
            {
                return Err("file-search:scope".into());
            }
            if units.starts_with(&[92, 92, 63, 92]) {
                units.drain(..4);
            }
            if units[3..].contains(&58) {
                return Err("file-search:scope".into());
            }
            units[0] = drive as u16;
            while units.len() > 3 && units.last() == Some(&92) {
                units.pop();
            }
            result.push(units);
        }
        Ok(Self(result, super::super::scope_policy::Policy::default()))
    }
    pub fn policy(mut self, spec: Option<super::super::scope_policy::Spec>) -> Result<Self, String> {
        self.1 = super::super::scope_policy::Policy::from_spec(spec)?; Ok(self)
    }
    pub fn contains(&self, path: &[u16]) -> bool {
        self.0.iter().any(|root| within(path, root))
            && !self.1.excludes(std::path::Path::new(&std::ffi::OsString::from_wide(path)))
    }
    pub fn ancestor(&self, path: &[u16]) -> bool {
        self.0.iter().any(|root| within(root, path))
    }
}
fn within(path: &[u16], root: &[u16]) -> bool {
    path.starts_with(root)
        && (path.len() == root.len()
            || root.last() == Some(&92)
            || path.get(root.len()) == Some(&92))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scope_is_volume_bound_and_respects_directory_boundaries() {
        let scope =
            Scope::decode(b'C', &encode(&[PathBuf::from(r"\\?\C:\Users\Test\Files")])).unwrap();
        let wide = |s: &str| s.encode_utf16().collect::<Vec<_>>();
        assert!(scope.contains(&wide(r"C:\Users\Test\Files\合同.pdf")));
        assert!(!scope.contains(&wide(r"C:\Users\Test\FilesExtra\x")));
        assert!(scope.ancestor(&wide(r"C:\Users\Test")));
        assert!(!scope.ancestor(&wide(r"C:\Windows")));
        for path in [r"D:\x", r"\\server\share", r"C:\a\..\b", r"C:\a\b:stream"] {
            let wire = encode(&[PathBuf::from(path)]);
            assert!(Scope::decode(b'C', &wire).is_err());
        }
        assert!(Scope::decode(b'C', &[]).is_err());
    }
}

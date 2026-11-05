//! One filename-only policy for ordinary scans, cache, USN and remote helpers.
//! Paths are resolved by the user's desktop process, never from SYSTEM's profile.
use super::storage;
use serde::{Deserialize, Serialize};
use std::path::Path;

pub(super) const VERSION: u32 = 1;
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Spec {
    pub version: u32,
    pub excluded: Vec<Vec<u8>>,
    pub browsers: Vec<Vec<u8>>,
}
#[derive(Clone, Default)]
pub(super) struct Policy {
    spec: Option<Spec>,
    excluded: Vec<Vec<u8>>,
    browsers: Vec<Vec<u8>>,
    volumes: Vec<(std::path::PathBuf, String)>,
}
fn key(path: &Path) -> Vec<u8> {
    let raw = path.as_os_str().as_encoded_bytes();
    let raw = raw.strip_prefix(b"\\\\?\\").unwrap_or(raw);
    let mut value = if raw.starts_with(b"UNC\\") {
        [b"\\\\".as_slice(), &raw[4..]].concat()
    } else { raw.to_vec() };
    for c in &mut value { *c = if *c == b'/' { b'\\' } else { c.to_ascii_lowercase() }; }
    while value.len() > 3 && value.last() == Some(&b'\\') { value.pop(); }
    value
}
fn within(path: &[u8], root: &[u8]) -> bool {
    path.starts_with(root) && (path.len() == root.len() || root.last() == Some(&b'\\') || path.get(root.len()) == Some(&b'\\'))
}
impl Policy {
    pub fn from_spec(spec: Option<Spec>) -> Result<Self, String> {
        let Some(spec) = spec else { return Ok(Self::default()); };
        if spec.version != VERSION || spec.excluded.len() > 320 || spec.browsers.len() > 16
            || spec.excluded.iter().chain(&spec.browsers).map(Vec::len).sum::<usize>() > 256 * 1024 {
            return Err("file-search:scope-policy".into());
        }
        let paths = |values: &[Vec<u8>]| -> Result<Vec<Vec<u8>>, String> {
            values.iter().map(|value| {
                if value.is_empty() || value.len() > 65534 { return Err("file-search:scope-policy".into()); }
                let path = storage::decode(value)?;
                if !path.is_absolute() || path.components().any(|p| matches!(p, std::path::Component::ParentDir)) {
                    return Err("file-search:scope-policy".into());
                }
                Ok(key(&path))
            }).collect()
        };
        let excluded = paths(&spec.excluded)?;
        let browsers = paths(&spec.browsers)?;
        Ok(Self { spec: Some(spec), excluded, browsers, volumes: Vec::new() })
    }
    pub fn automatic(app_data: &Path) -> Result<Self, String> {
        let mut excluded = vec![std::env::temp_dir(), app_data.join("file-search")];
        let mut browsers = Vec::new();
        if let Some(root) = std::env::var_os("SystemRoot") { excluded.push(root.into()); }
        if let Some(local) = dirs::data_local_dir() {
            excluded.extend([local.join("Temp"), local.join("CrashDumps")]);
            browsers.extend([local.join("Google/Chrome/User Data"), local.join("Microsoft/Edge/User Data"),
                local.join("BraveSoftware/Brave-Browser/User Data"), local.join("Mozilla/Firefox/Profiles")]);
        }
        Self::from_spec(Some(Spec { version: VERSION,
            excluded: excluded.iter().map(|p| storage::encode(p)).collect(),
            browsers: browsers.iter().map(|p| storage::encode(p)).collect() }))
    }
    pub fn spec(&self) -> Option<Spec> { self.spec.clone() }
    pub fn with_volumes(mut self, volumes: Vec<(std::path::PathBuf, String)>) -> Self { self.volumes = volumes; self }
    pub fn volumes(&self) -> &[(std::path::PathBuf, String)] { &self.volumes }
    fn volume(&self, path: &Path) -> Option<&str> {
        let path = key(path);
        self.volumes.iter().filter(|(root,_)| within(&path, &key(root)))
            .max_by_key(|(root,_)| root.as_os_str().len()).map(|(_,id)| id.as_str())
    }
    pub fn in_roots(&self, path: &Path, roots: &[std::path::PathBuf]) -> bool {
        roots.iter().any(|root| path.starts_with(root) && self.volume(path) == self.volume(root))
    }
    pub fn for_roots(&self, roots: &[std::path::PathBuf]) -> Result<Self, String> {
        let Some(mut spec) = self.spec() else { return Ok(self.clone()); };
        for (path,id) in &self.volumes {
            if roots.iter().any(|root| path.starts_with(root) && self.volume(root) != Some(id)) {
                spec.excluded.push(storage::encode(path));
            }
        }
        // Only native-discovered mounts can extend this internally validated policy.
        let mut value = Self::from_spec(Some(spec))?;
        value.volumes = self.volumes.clone(); Ok(value)
    }
    pub fn fingerprint(&self) -> String {
        use sha2::{Digest, Sha256};
        hex::encode(Sha256::digest(serde_json::to_vec(&self.spec).unwrap_or_default()))
    }
    pub fn excludes(&self, path: &Path) -> bool {
        if self.spec.is_none() { return false; }
        let path = key(path);
        if self.excluded.iter().any(|root| within(&path, root)) { return true; }
        let parts = path.split(|c| *c == b'\\').collect::<Vec<_>>();
        if parts.iter().any(|p| matches!(*p, b"$recycle.bin" | b"system volume information" | b"$windows.~bt" | b"$windows.~ws" |
            b"node_modules" | b".venv" | b"__pycache__" | b".gradle" | b".cache")) { return true; }
        if parts.windows(2).any(|p| matches!(p, [b".git", b"objects" | b"logs"] | [b".svn", b"pristine"])) { return true; }
        if parts.len() == 2 && matches!(parts[1], b"pagefile.sys" | b"hiberfil.sys" | b"swapfile.sys" | b"dumpstack.log.tmp") { return true; }
        self.browsers.iter().any(|root| within(&path, root)) && parts.iter().any(|p|
            matches!(*p, b"cache" | b"code cache" | b"gpucache" | b"cache2" | b"cachestorage"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn automatic_policy_filters_noise_without_hiding_user_deliverables() {
        let p = Policy::from_spec(Some(Spec { version: VERSION,
            excluded: vec![storage::encode(Path::new(r"C:\Windows"))],
            browsers: vec![storage::encode(Path::new(r"C:\Users\Demo\AppData\Local\Google\Chrome\User Data"))] })).unwrap();
        for path in [r"C:\Windows\System32\a.dll", r"\\?\C:\WINDOWS\Temp\x", r"D:\$Recycle.Bin\a.pdf",
            r"D:\work\node_modules\x.js", r"D:\work\.git\objects\x", r"C:\pagefile.sys",
            r"C:\Users\Demo\AppData\Local\Google\Chrome\User Data\Profile 1\Cache\a"] {
            assert!(p.excludes(Path::new(path)), "{path}");
        }
        for path in [r"D:\Windows\方案.docx", r"C:\Windows-notes\a.txt", r"D:\微信聊天\xwechat_files\合同.pdf",
            r"D:\work\dist\setup.exe", r"D:\work\target\release\app.exe", r"D:\work\build\deliverable.zip",
            r"C:\Users\Demo\AppData\Roaming\documents\a.pdf", r"D:\work\.git\config",
            r"C:\Program Files\Tool\tool.exe", r"D:\my node_modules notes.txt", r"D:\project\Cache\资料.docx"] {
            assert!(!p.excludes(Path::new(path)), "{path}");
        }
        assert!(!Policy::default().excludes(Path::new(r"C:\Windows\a")));
        assert!(Policy::from_spec(Some(Spec { version: 99, ..Default::default() })).is_err());
        assert_eq!(p.fingerprint(), Policy::from_spec(p.spec()).unwrap().fingerprint());
    }
    #[test]
    fn nested_mount_is_not_owned_or_pruned_by_its_parent_volume() {
        let p = Policy::from_spec(Some(Spec { version: VERSION, ..Default::default() })).unwrap()
            .with_volumes(vec![(r"C:\".into(), "volume-c".into()), (r"C:\mount\data".into(), "volume-d".into())]);
        let roots = [std::path::PathBuf::from(r"C:\")];
        assert!(!p.in_roots(Path::new(r"C:\mount\data\合同.pdf"), &roots));
        assert!(p.in_roots(Path::new(r"C:\work\合同.pdf"), &roots));
        assert!(p.for_roots(&roots).unwrap().excludes(Path::new(r"C:\mount\data\合同.pdf")));
        let mounted = [std::path::PathBuf::from(r"C:\mount\data")];
        assert!(p.in_roots(Path::new(r"C:\mount\data\合同.pdf"), &mounted));
        assert!(!p.for_roots(&mounted).unwrap().excludes(Path::new(r"C:\mount\data\合同.pdf")));
    }
}

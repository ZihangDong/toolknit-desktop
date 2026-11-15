//! Bounded discovery of mounted locations. Never mounts/unlocks a volume or
//! probes network neighbours; remote validation stays in the user-token helper.
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, path::{Path, PathBuf}, sync::atomic::{AtomicBool, Ordering}};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(super) struct Location { pub root: PathBuf, pub identity: String, pub fast: bool, pub remote: bool, pub available: bool }

#[cfg(windows)]
fn wide(path: &Path) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    let mut text = path.as_os_str().encode_wide().collect::<Vec<_>>();
    if text.last() != Some(&92) { text.push(92); } text.push(0); text
}
#[cfg(windows)]
pub(super) fn volume_id(path: &Path) -> Option<String> {
    use windows::{core::PCWSTR, Win32::Storage::FileSystem::GetVolumeNameForVolumeMountPointW};
    let mut result = [0u16; 256];
    unsafe { GetVolumeNameForVolumeMountPointW(PCWSTR(wide(path).as_ptr()), &mut result) }.ok()?;
    Some(String::from_utf16_lossy(&result[..result.iter().position(|c| *c == 0)?]).to_ascii_lowercase())
}
#[cfg(windows)]
pub(super) fn fast_root(path: &Path) -> bool {
    use std::path::{Component, Prefix};
    let Some(Component::Prefix(p)) = path.components().next() else { return false; };
    let drive = match p.kind() { Prefix::Disk(d) | Prefix::VerbatimDisk(d) => d, _ => return false };
    // A mount point under C: may name another volume. Do not send its scope to
    // C:'s MFT reader; the ordinary walker handles that explicit mount instead.
    let base = PathBuf::from(format!("{}:\\", drive as char));
    let mut fs = [0u16; 32];
    let ntfs = unsafe { windows::Win32::Storage::FileSystem::GetVolumeInformationW(
        windows::core::PCWSTR(wide(&base).as_ptr()), None, None, None, None, Some(&mut fs)) }.is_ok()
        && fs.starts_with(&[78, 84, 70, 83, 0]);
    ntfs && volume_id(path).is_none_or(|id| volume_id(&base).as_ref() == Some(&id))
}
#[cfg(windows)]
pub(super) fn discover(legacy: &[String], cancel: &AtomicBool) -> Result<Vec<Location>, String> {
    use windows::{core::PCWSTR, Win32::{Foundation::HANDLE, Storage::FileSystem::*}};
    fn local(root: PathBuf) -> Option<Location> {
        let name = wide(&root);
        if ![2, 3].contains(&unsafe { GetDriveTypeW(PCWSTR(name.as_ptr())) }) { return None; }
        let identity = volume_id(&root)?;
        let mut fs = [0u16; 32];
        unsafe { GetVolumeInformationW(PCWSTR(name.as_ptr()), None, None, None, None, Some(&mut fs)) }.ok()?;
        let ntfs = String::from_utf16_lossy(&fs[..fs.iter().position(|c| *c == 0).unwrap_or(fs.len())]) == "NTFS";
        // Keep a DOS mount path if canonicalization returns a volume namespace.
        let canonical = root.canonicalize().ok()?;
        let root = if super::index::validate_local_scope(&canonical).is_ok() { canonical } else { root };
        Some(Location { fast: ntfs && fast_root(&root), root, identity, remote: false, available: true })
    }
    let mut candidates = Vec::new();
    let mut network = Vec::new();
    let mask = unsafe { GetLogicalDrives() };
    for drive in b'A'..=b'Z' {
        if cancel.load(Ordering::Acquire) { return Err("file-search:cancelled".into()); }
        if mask & (1 << (drive - b'A')) == 0 { continue; }
        let root = PathBuf::from(format!("{}:\\", drive as char));
        if unsafe { GetDriveTypeW(PCWSTR(wide(&root).as_ptr())) } == 4 { network.push(root); }
        else if let Some(location) = local(root) { candidates.push(location); }
    }
    struct Volumes(HANDLE);
    impl Drop for Volumes { fn drop(&mut self) { unsafe { let _ = FindVolumeClose(self.0); } } }
    let mut name = [0u16; 256];
    if let Ok(handle) = unsafe { FindFirstVolumeW(&mut name) } {
        let _volumes = Volumes(handle);
        for _ in 0..256 {
            if cancel.load(Ordering::Acquire) { return Err("file-search:cancelled".into()); }
            let mut paths = vec![0u16; 32768]; let mut required = 0;
            if unsafe { GetVolumePathNamesForVolumeNameW(PCWSTR(name.as_ptr()), Some(&mut paths), &mut required) }.is_ok() {
                for part in paths.split(|c| *c == 0).take_while(|part| !part.is_empty()) {
                    use std::os::windows::ffi::OsStringExt;
                    if let Some(location) = local(std::ffi::OsString::from_wide(part).into()) { candidates.push(location); }
                }
            }
            if unsafe { FindNextVolumeW(handle, &mut name) }.is_err() { break; }
        }
    }
    for path in legacy.iter().take(32).map(PathBuf::from) {
        if super::filesystem_worker::remote(&path) { network.push(path); }
    }
    let mut locations = deduplicate(candidates);
    for root in network {
        if cancel.load(Ordering::Acquire) { return Err("file-search:cancelled".into()); }
        // Existing disconnected mappings remain visible as unavailable scopes;
        // their normalization/scans can be cancelled and cannot block local IO.
        // Discover names without contacting SMB. The asynchronous helper does
        // the availability probe; a disconnected share cannot delay startup.
        let normalized = mapped_share(&root).unwrap_or(root);
        super::index::validate_local_scope(&normalized)?;
        let available = true;
        let identity = format!("remote:{}", normalized.to_string_lossy().to_lowercase());
        if !locations.iter().any(|v| v.identity == identity) {
            locations.push(Location { root: normalized, identity, fast: false, remote: true, available });
        }
    }
    if locations.is_empty() { return Err("file-search:scope-unavailable".into()); }
    if locations.len() > 256 { return Err("file-search:scope".into()); }
    Ok(locations)
}
#[cfg(windows)]
fn mapped_share(root: &Path) -> Option<PathBuf> {
    use std::path::{Component, Prefix};
    use windows::{core::{PCWSTR, PWSTR}, Win32::NetworkManagement::WNet::WNetGetConnectionW};
    let Some(Component::Prefix(p)) = root.components().next() else { return None; };
    let drive = match p.kind() { Prefix::Disk(d) | Prefix::VerbatimDisk(d) => d, _ => return None };
    let local = [drive as u16, 58, 0];
    let mut remote = vec![0u16; 32768]; let mut length = remote.len() as u32;
    if unsafe { WNetGetConnectionW(PCWSTR(local.as_ptr()), PWSTR(remote.as_mut_ptr()), &mut length) }.0 != 0 { return None; }
    use std::os::windows::ffi::OsStringExt;
    let mut path = PathBuf::from(std::ffi::OsString::from_wide(&remote[..remote.iter().position(|u| *u == 0)?]));
    for component in root.components().skip(1) { if let Component::Normal(part) = component { path.push(part); } }
    Some(path)
}
#[cfg(not(windows))]
pub(super) fn discover(_: &[String], _: &AtomicBool) -> Result<Vec<Location>, String> { Err("file-search:desktop-only".into()) }

fn deduplicate(mut candidates: Vec<Location>) -> Vec<Location> {
    candidates.sort_by_key(|v| (!v.fast, v.root.as_os_str().len()));
    let mut seen = HashSet::new(); candidates.retain(|v| seen.insert(v.identity.to_ascii_lowercase())); candidates
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn aliases_prefer_the_short_accelerated_mount_but_keep_other_volumes() {
        let make = |root: &str, id: &str, fast| Location { root: root.into(), identity: id.into(), fast, remote: false, available: true };
        let result = deduplicate(vec![make(r"C:\mount\drive", "vol-a", false), make(r"D:\", "VOL-A", true), make(r"C:\", "vol-b", true)]);
        assert_eq!(result.len(), 2); assert!(result.iter().any(|r| r.root == Path::new(r"D:\")));
    }
}

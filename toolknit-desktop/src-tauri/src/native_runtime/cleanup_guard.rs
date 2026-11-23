use super::*;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, OnceLock,
};
use std::time::{Duration, Instant, SystemTime};

pub(super) const POLICY_VERSION: &str = "windows-cleanup-v2";

pub(super) fn protected_path(path: &Path) -> bool {
    // Component matching avoids treating WindowsBackup as Windows.
    if protected_cleanup_dir_names(path).iter().any(|part| {
        matches!(
            part.as_str(),
            "windows"
                | "windows.old"
                | "program files"
                | "program files (x86)"
                | "programdata"
                | "$recycle.bin"
                | "system volume information"
                | "recovery"
                | "boot"
                | "efi"
                | "config.msi"
                | "appdata"
                | "windowsapps"
                | "msocache"
                | "$windows.~bt"
                | "$windows.~ws"
                | "$winreagent"
                | "documents and settings"
        )
    }) {
        return true;
    }
    let value = cleanup_display_path(path).replace('/', "\\").to_lowercase();
    for key in [
        "SystemRoot",
        "windir",
        "ProgramFiles",
        "ProgramFiles(x86)",
        "ProgramW6432",
        "ProgramData",
        "APPDATA",
        "LOCALAPPDATA",
        "OneDrive",
        "OneDriveConsumer",
        "OneDriveCommercial",
    ] {
        if let Ok(root) = std::env::var(key) {
            let root = root
                .replace('/', "\\")
                .trim_end_matches('\\')
                .to_lowercase();
            if !root.is_empty() && (value == root || value.starts_with(&(root + "\\"))) {
                return true;
            }
        }
    }
    false
}

pub(super) fn system_drive_root(path: &Path) -> bool {
    #[cfg(target_os = "windows")]
    {
        let system = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into());
        return cleanup_drive_root_letter(path).is_some_and(|letter| {
            letter == 'C' || system.chars().next().map(|c| c.to_ascii_uppercase()) == Some(letter)
        });
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
        false
    }
}

pub(super) fn reject_links(path: &Path) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("An absolute local path is required".into());
    }
    #[cfg(target_os = "windows")]
    if !matches!(path.components().next(), Some(std::path::Component::Prefix(prefix))
        if matches!(prefix.kind(), std::path::Prefix::Disk(_) | std::path::Prefix::VerbatimDisk(_)))
    {
        return Err("Only local drive paths are supported".into());
    }
    for ancestor in path.ancestors() {
        if cleanup_path_is_reparse_point(ancestor) {
            return Err("Links and reparse points are not allowed".into());
        }
    }
    Ok(())
}

pub(super) fn protected_attributes(metadata: &std::fs::Metadata, directory: bool) -> bool {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::fs::MetadataExt;
        // Offline/recall items must not hydrate cloud content during cleanup.
        let mask =
            0x2 | 0x4 | 0x400 | 0x1000 | 0x40000 | 0x400000 | if directory { 0 } else { 0x1 };
        return metadata.file_attributes() & mask != 0;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = directory;
        metadata.file_type().is_symlink() || metadata.permissions().readonly()
    }
}

#[derive(Clone, PartialEq, Debug)]
struct Fingerprint {
    size: u64,
    modified: Option<SystemTime>,
    created: Option<SystemTime>,
    identity: Option<(u32, u64)>,
}
fn fingerprint(metadata: &std::fs::Metadata, identity: Option<(u32, u64)>) -> Fingerprint {
    Fingerprint {
        size: metadata.len(),
        modified: metadata.modified().ok(),
        created: metadata.created().ok(),
        identity,
    }
}

pub(in crate::native_runtime) fn file_identity(path: &Path) -> Result<Option<(u32, u64)>, String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::{fs::OpenOptionsExt, io::AsRawHandle};
        use windows::Win32::{
            Foundation::HANDLE,
            Storage::FileSystem::{
                GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION, FILE_READ_ATTRIBUTES,
            },
        };
        // Only open metadata; never read file contents or accept a hard-linked candidate.
        let file = std::fs::OpenOptions::new()
            .access_mode(FILE_READ_ATTRIBUTES.0)
            .open(path)
            .map_err(|_| "Cannot inspect file identity")?;
        let mut info = BY_HANDLE_FILE_INFORMATION::default();
        unsafe { GetFileInformationByHandle(HANDLE(file.as_raw_handle() as isize), &mut info) }
            .map_err(|_| "Cannot inspect file identity")?;
        if info.nNumberOfLinks != 1 {
            return Err("Protected hard-linked file".into());
        }
        Ok(Some((
            info.dwVolumeSerialNumber,
            ((info.nFileIndexHigh as u64) << 32) | info.nFileIndexLow as u64,
        )))
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
        Ok(None)
    }
}

pub(super) struct ScanSession {
    pub(super) cancelled: AtomicBool,
    created: Instant,
    files: Mutex<HashMap<PathBuf, Fingerprint>>,
    roots: Mutex<Vec<PathBuf>>,
    complete: AtomicBool,
}
static SESSIONS: OnceLock<Mutex<HashMap<String, Arc<ScanSession>>>> = OnceLock::new();
fn sessions() -> &'static Mutex<HashMap<String, Arc<ScanSession>>> {
    SESSIONS.get_or_init(Default::default)
}
pub(super) fn fresh_session() -> Arc<ScanSession> {
    Arc::new(ScanSession {
        cancelled: AtomicBool::new(false),
        created: Instant::now(),
        files: Mutex::new(HashMap::new()),
        roots: Mutex::new(Vec::new()),
        complete: AtomicBool::new(false),
    })
}

pub(super) fn begin(id: &str) -> Result<Arc<ScanSession>, String> {
    if id.len() < 16 || id.len() > 80 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err("Invalid cleanup scan session".into());
    }
    let mut sessions = sessions().lock().map_err(|_| "Cleanup state unavailable")?;
    sessions.retain(|_, session| session.created.elapsed() < Duration::from_secs(1800));
    if sessions.contains_key(id) {
        return Err("Cleanup session already used or cancelled".into());
    }
    if sessions
        .values()
        .filter(|session| !session.cancelled.load(Ordering::SeqCst))
        .count()
        >= 32
        || sessions.len() >= 4096
    {
        return Err("Too many cleanup sessions; retry later".into());
    }
    let session = fresh_session();
    sessions.insert(id.into(), session.clone());
    Ok(session)
}

pub(super) fn cancel(id: &str) {
    if let Ok(mut sessions) = sessions().lock() {
        // Remember early cancellation so a late scan invoke cannot start work.
        sessions.retain(|_, session| session.created.elapsed() < Duration::from_secs(1800));
        if !sessions.contains_key(id)
            && sessions.len() < 4096
            && id.len() >= 16
            && id.len() <= 80
            && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        {
            sessions.insert(id.into(), fresh_session());
        }
        if let Some(session) = sessions.get(id) {
            session.cancelled.store(true, Ordering::SeqCst);
            if let Ok(mut files) = session.files.lock() {
                files.clear();
            }
        }
    }
}

impl ScanSession {
    pub(super) fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        if let Ok(mut files) = self.files.lock() {
            files.clear();
        }
    }
    pub(super) fn check(&self) -> Result<(), String> {
        if self.cancelled.load(Ordering::SeqCst)
            || self.created.elapsed() >= Duration::from_secs(1800)
        {
            Err("cleanup-scan-cancelled".into())
        } else {
            Ok(())
        }
    }
    pub(super) fn set_root(&self, root: &Path) {
        let mut roots = self.roots.lock().unwrap();
        if !roots.iter().any(|item| item == root) {
            roots.push(root.into());
        }
    }
    pub(super) fn record(
        &self,
        path: &Path,
        metadata: &std::fs::Metadata,
        identity: Option<(u32, u64)>,
    ) {
        self.files
            .lock()
            .unwrap()
            .insert(path.into(), fingerprint(metadata, identity));
    }
    pub(super) fn finish(&self) {
        self.complete.store(true, Ordering::SeqCst);
    }
    pub(super) fn validate(&self, path: &str) -> Result<(PathBuf, u64), String> {
        self.check()?;
        if !self.complete.load(Ordering::SeqCst) {
            return Err("Scan is not complete".into());
        }
        let roots = self.roots.lock().map_err(|_| "Cleanup state unavailable")?;
        if roots.is_empty() {
            return Err("Scan scope is unavailable; scan again".into());
        }
        let (canonical, size) = roots
            .iter()
            .find_map(|root| validate_cleanup_delete_path(path, Some(root)).ok())
            .ok_or_else(|| "File is outside the current scan scope".to_string())?;
        let metadata = std::fs::metadata(&canonical).map_err(|_| "Cannot access scanned file")?;
        let files = self.files.lock().map_err(|_| "Cleanup state unavailable")?;
        if files.get(&canonical) != Some(&fingerprint(&metadata, file_identity(&canonical)?)) {
            return Err("File changed or was not in this scan; scan again".into());
        }
        Ok((canonical, size))
    }
}

pub(super) fn get(id: &str) -> Result<Arc<ScanSession>, String> {
    sessions()
        .lock()
        .map_err(|_| "Cleanup state unavailable")?
        .get(id)
        .cloned()
        .ok_or_else(|| "Cleanup scan session expired; scan again".into())
}

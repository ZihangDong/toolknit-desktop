use super::super::{
    ntfs,
    ntfs_tree::Tree,
    protocol::{self, Metadata, Request, RescanReason, Response},
};
use super::{
    access,
    identity::{self, wide},
    pipe,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use std::sync::{
    atomic::{AtomicBool, AtomicIsize, Ordering},
    Arc, OnceLock,
};
use windows::{
    core::{PCWSTR, PWSTR},
    Win32::{
        Foundation::NO_ERROR,
        Storage::FileSystem::{GetDriveTypeW, GetVolumeInformationW},
        System::{Pipes::GetNamedPipeClientProcessId, Services::*, Threading::WaitForSingleObject},
    },
};

static OWNER: OnceLock<String> = OnceLock::new();
static STOP: OnceLock<Arc<AtomicBool>> = OnceLock::new();
static STATUS: AtomicIsize = AtomicIsize::new(0);
fn report(state: SERVICE_STATUS_CURRENT_STATE, error: u32) {
    let handle = SERVICE_STATUS_HANDLE(STATUS.load(Ordering::Acquire));
    if handle.0 == 0 {
        return;
    }
    let status = SERVICE_STATUS {
        dwServiceType: SERVICE_WIN32_OWN_PROCESS,
        dwCurrentState: state,
        dwControlsAccepted: if state == SERVICE_RUNNING {
            SERVICE_ACCEPT_STOP | SERVICE_ACCEPT_SHUTDOWN
        } else {
            0
        },
        dwWin32ExitCode: error,
        dwServiceSpecificExitCode: 0,
        dwCheckPoint: 0,
        dwWaitHint: 0,
    };
    unsafe {
        let _ = SetServiceStatus(handle, &status);
    }
}
unsafe extern "system" fn control(
    control: u32,
    _event: u32,
    _data: *mut std::ffi::c_void,
    _context: *mut std::ffi::c_void,
) -> u32 {
    if [SERVICE_CONTROL_STOP, SERVICE_CONTROL_SHUTDOWN].contains(&control) {
        if let Some(stop) = STOP.get() {
            stop.store(true, Ordering::Release);
        }
        report(SERVICE_STOP_PENDING, 0);
    }
    NO_ERROR.0
}
unsafe extern "system" fn entry(_argc: u32, _argv: *mut PWSTR) {
    let result = std::panic::catch_unwind(|| {
        let sid = OWNER.get().ok_or("file-search:identity")?;
        let name = wide(&identity::service_name(sid)?);
        let handle =
            unsafe { RegisterServiceCtrlHandlerExW(PCWSTR(name.as_ptr()), Some(control), None) }
                .map_err(|_| "file-search:service-start")?;
        STATUS.store(handle.0, Ordering::Release);
        report(SERVICE_RUNNING, 0);
        serve(sid, STOP.get().ok_or("file-search:service-start")?.clone())
    });
    if let Some(stop) = STOP.get() {
        stop.store(true, Ordering::Release);
    }
    report(
        SERVICE_STOPPED,
        if matches!(result, Ok(Ok(()))) {
            0
        } else {
            1064
        },
    );
}
pub(super) fn dispatch(sid: &str) -> Result<(), String> {
    if !identity::valid_sid(sid) {
        return Err("file-search:identity".into());
    }
    OWNER
        .set(sid.to_owned())
        .map_err(|_| "file-search:service-start")?;
    STOP.set(Arc::new(AtomicBool::new(false)))
        .map_err(|_| "file-search:service-start")?;
    let mut name = wide(&identity::service_name(sid)?);
    let table = [
        SERVICE_TABLE_ENTRYW {
            lpServiceName: PWSTR(name.as_mut_ptr()),
            lpServiceProc: Some(entry),
        },
        SERVICE_TABLE_ENTRYW::default(),
    ];
    unsafe { StartServiceCtrlDispatcherW(table.as_ptr()) }
        .map_err(|_| "file-search:service-start".into())
}
fn serve(sid: &str, stop: Arc<AtomicBool>) -> Result<(), String> {
    let mut pipe = pipe::accept(sid, stop)?;
    let hello = protocol::read_frame::<Request>(&mut pipe)?;
    hello.validate()?;
    let Request::Hello { process, nonce, .. } = hello else {
        return Err("file-search:protocol".into());
    };
    let mut actual = 0;
    unsafe { GetNamedPipeClientProcessId(pipe.handle.0, &mut actual) }
        .map_err(|_| "file-search:identity")?;
    if actual != process {
        return Err("file-search:identity".into());
    }
    pipe.watch_peer(actual)?;
    let _lease = ParentLease::new(actual, pipe.stop.clone())?;
    // The client's token permits identity/AccessCheck only, not impersonated I/O.
    let token = access::client_token(pipe.handle.0, sid)?;
    let mut visibility = access::Visibility::new(token);
    protocol::write_frame(
        &mut pipe,
        &Response::Ready {
            version: protocol::VERSION,
            nonce,
        },
    )?;
    while !pipe.cancelled() {
        let request = match protocol::read_frame::<Request>(&mut pipe) {
            Ok(r) => r,
            Err(_) => break,
        };
        request.validate()?;
        visibility.clear();
        let result = match request {
            Request::Scan { drive, roots, policy } => {
                let scope = super::scope::Scope::decode(drive.as_bytes()[0], &roots)?.policy(policy)?;
                scan(&mut pipe, drive.as_bytes()[0], &scope, &mut visibility)
            }
            Request::Journal {
                drive,
                id,
                usn,
                roots,
                policy,
            } => {
                let scope = super::scope::Scope::decode(drive.as_bytes()[0], &roots)?.policy(policy)?;
                journal(
                    &mut pipe,
                    drive.as_bytes()[0],
                    id,
                    usn,
                    &scope,
                    &mut visibility,
                )
            }
            Request::Stop => break,
            Request::Hello { .. } => Err("file-search:protocol".into()),
        };
        if let Err(code) = result {
            if pipe.cancelled() {
                break;
            }
            protocol::write_frame(&mut pipe, &Response::Error { code })?;
        }
    }
    Ok(())
}

// This executable is a dedicated service host. A dead desktop process must not
// leave it blocked in filesystem I/O indefinitely, even after an abnormal exit.
struct ParentLease(Arc<AtomicBool>);
impl ParentLease {
    fn new(pid: u32, stop: Arc<AtomicBool>) -> Result<Self, String> {
        use windows::Win32::System::Threading::{OpenProcess, PROCESS_SYNCHRONIZE};
        let peer = identity::Handle(
            unsafe { OpenProcess(PROCESS_SYNCHRONIZE, false, pid) }
                .map_err(|_| "file-search:identity")?,
        );
        let done = Arc::new(AtomicBool::new(false));
        let completed = done.clone();
        std::thread::Builder::new()
            .name("file-search-parent-lease".into())
            .spawn(move || {
                while !completed.load(Ordering::Acquire) {
                    if unsafe { WaitForSingleObject(peer.0, 200) }.0 == 0 {
                        stop.store(true, Ordering::Release);
                        for _ in 0..15 {
                            if completed.load(Ordering::Acquire) {
                                return;
                            }
                            std::thread::sleep(std::time::Duration::from_millis(200));
                        }
                        report(SERVICE_STOPPED, 0);
                        std::process::exit(0);
                    }
                }
            })
            .map_err(|_| "file-search:service-start")?;
        Ok(Self(done))
    }
}
impl Drop for ParentLease {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Release);
    }
}
pub(super) fn volume_serial(drive: u8) -> Result<u32, String> {
    unsafe {
        if !drive.is_ascii_uppercase() {
            return Err("file-search:volume".into());
        }
        let path = wide(&format!("{}:\\", drive as char));
        if ![2, 3].contains(&GetDriveTypeW(PCWSTR(path.as_ptr()))) {
            return Err("file-search:volume".into());
        }
        let mut serial = 0;
        let mut filesystem = [0u16; 32];
        GetVolumeInformationW(
            PCWSTR(path.as_ptr()),
            None,
            Some(&mut serial),
            None,
            None,
            Some(&mut filesystem),
        )
        .map_err(|_| "file-search:volume")?;
        let length = filesystem
            .iter()
            .position(|v| *v == 0)
            .unwrap_or(filesystem.len());
        if String::from_utf16_lossy(&filesystem[..length]) != "NTFS" {
            return Err("file-search:volume".into());
        }
        Ok(serial)
    }
}
fn encode_path(path: &[u16]) -> String {
    STANDARD.encode(
        [92u16, 92, 63, 92]
            .iter()
            .chain(path)
            .flat_map(|v| v.to_le_bytes())
            .collect::<Vec<_>>(),
    )
}
fn scan(
    pipe: &mut pipe::Pipe,
    drive: u8,
    scope: &super::scope::Scope,
    visibility: &mut access::Visibility,
) -> Result<(), String> {
    let serial = volume_serial(drive)?;
    let journal = ntfs::journal(drive);
    let stop = pipe.stop.clone();
    let peer = pipe.peer.as_ref().map(|h| h.0);
    let cancelled = || {
        stop.load(Ordering::Acquire)
            || peer.is_some_and(|h| unsafe { WaitForSingleObject(h, 0) }.0 == 0)
    };
    let mut tree = Tree::default();
    let mut records = 0u64;
    let mut failure = None;
    let first = ntfs::scan(
        drive,
        &mut |record| {
            records += 1;
            if records % 32768 == 0 {
                if let Err(error) = protocol::write_frame(pipe, &Response::Progress { records }) {
                    failure = Some(error);
                    return false;
                }
            }
            if !tree.collect(record) {
                failure = Some("file-search:index-limit".into());
                return false;
            }
            true
        },
        &cancelled,
    );
    if let Some(error) = failure.take() {
        return Err(error);
    }
    first?;
    tree.finish();
    let mut batch = Vec::new();
    let mut path_bytes = 0usize;
    let second = ntfs::scan(
        drive,
        &mut |record| {
            records += 1;
            if records % 4096 == 0 {
                if let Err(error) = protocol::write_frame(pipe, &Response::Progress { records }) {
                    failure = Some(error);
                    return false;
                }
            }
            if !super::super::ntfs_tree::valid_name(record.name) {
                return true;
            }
            let base = if record.base == 0 {
                record.number
            } else {
                record.base
            };
            let extension = tree.extensions.get(&base).copied();
            let directory = if record.base != 0 {
                let Some(e) = extension else {
                    return true;
                };
                e.3
            } else {
                record.directory
            };
            if directory {
                return true;
            }
            let parent = (record.parent & 0xFFFF_FFFF_FFFF).try_into().unwrap_or(0);
            let Some(mut path) = tree.parent_path(drive, parent) else {
                return true;
            };
            if !scope.contains(&path) || !visibility.allows(&path) {
                return true;
            }
            if path.last() != Some(&92) {
                path.push(92);
            }
            path.extend(record.name);
            if !scope.contains(&path) { return true; }
            if path.len() > 32767 {
                return true;
            }
            path_bytes += path.len() * 3;
            let size = record.size.or_else(|| extension.and_then(|e| e.0));
            let modified = record.modified.or_else(|| extension.and_then(|e| e.1));
            batch.push(Metadata {
                path: encode_path(&path),
                size,
                modified,
                deleted: false,
                directory: false,
            });
            if batch.len() >= 128 || path_bytes >= 256 * 1024 {
                if let Err(error) = protocol::write_frame(
                    pipe,
                    &Response::Files {
                        items: std::mem::take(&mut batch),
                    },
                ) {
                    failure = Some(error);
                    return false;
                }
                path_bytes = 0;
            }
            true
        },
        &cancelled,
    );
    if let Some(error) = failure {
        return Err(error);
    }
    second?;
    if !batch.is_empty() {
        protocol::write_frame(pipe, &Response::Files { items: batch })?;
    }
    protocol::write_frame(
        pipe,
        &Response::Done {
            serial,
            journal_id: journal.map(|j| j.id),
            next_usn: journal.map(|j| j.next),
        },
    )
}

fn parent_by_id(drive: u8, parent: u64) -> Result<Vec<u16>, String> {
    unsafe {
        use windows::Win32::{Foundation::HANDLE, Storage::FileSystem::*};
        let device = wide(&format!("\\\\.\\{}:", drive as char));
        let volume = identity::Handle(
            CreateFileW(
                PCWSTR(device.as_ptr()),
                0,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                None,
                OPEN_EXISTING,
                FILE_FLAGS_AND_ATTRIBUTES(0),
                HANDLE::default(),
            )
            .map_err(|_| "file-search:journal")?,
        );
        let id = FILE_ID_DESCRIPTOR {
            dwSize: std::mem::size_of::<FILE_ID_DESCRIPTOR>() as u32,
            Type: FileIdType,
            Anonymous: FILE_ID_DESCRIPTOR_0 {
                FileId: parent as i64,
            },
        };
        let folder = identity::Handle(
            OpenFileById(
                volume.0,
                &id,
                FILE_READ_ATTRIBUTES.0,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                None,
                FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_OPEN_NO_RECALL,
            )
            .map_err(|_| "file-search:journal")?,
        );
        let mut info = BY_HANDLE_FILE_INFORMATION::default();
        GetFileInformationByHandle(folder.0, &mut info).map_err(|_| "file-search:journal")?;
        if info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0 {
            let mut tag = FILE_ATTRIBUTE_TAG_INFO::default();
            GetFileInformationByHandleEx(folder.0, FileAttributeTagInfo,
                (&mut tag as *mut FILE_ATTRIBUTE_TAG_INFO).cast(), std::mem::size_of::<FILE_ATTRIBUTE_TAG_INFO>() as u32)
                .map_err(|_| "file-search:journal")?;
            if !super::super::storage::cloud_tag(tag.FileAttributes, tag.ReparseTag) {
                return Err("file-search:journal".into());
            }
        }
        let mut path = vec![0u16; 32768];
        let length = GetFinalPathNameByHandleW(
            folder.0,
            &mut path,
            GETFINALPATHNAMEBYHANDLE_FLAGS(FILE_NAME_NORMALIZED.0 | VOLUME_NAME_DOS.0),
        ) as usize;
        if length == 0 || length >= path.len() {
            return Err("file-search:journal".into());
        }
        path.truncate(length);
        if path.starts_with(&[92, 92, 63, 92]) {
            path.drain(0..4);
        }
        if path.len() < 3 || path[0] as u8 != drive || path[1..3] != [58, 92] {
            return Err("file-search:journal".into());
        }
        Ok(path)
    }
}
fn journal(
    pipe: &mut pipe::Pipe,
    drive: u8,
    id: u64,
    start: i64,
    scope: &super::scope::Scope,
    visibility: &mut access::Visibility,
) -> Result<(), String> {
    use std::{
        collections::HashMap, os::windows::ffi::OsStringExt, path::PathBuf, time::UNIX_EPOCH,
    };
    let serial = volume_serial(drive)?;
    let Some(info) = ntfs::journal(drive) else {
        return protocol::write_frame(
            pipe,
            &Response::Rescan {
                reason: RescanReason::JournalUnavailable,
            },
        );
    };
    if info.id != id || start < info.first || start > info.next {
        return protocol::write_frame(
            pipe,
            &Response::Rescan {
                reason: RescanReason::JournalExpired,
            },
        );
    }
    let stop = pipe.stop.clone();
    let peer = pipe.peer.as_ref().map(|p| p.0);
    let cancelled = || {
        stop.load(Ordering::Acquire)
            || peer.is_some_and(|h| unsafe { WaitForSingleObject(h, 0) }.0 == 0)
    };
    // Directory delete records retain parent/name even after OpenFileById can
    // no longer resolve that parent. Collect a bounded history first, using the
    // same frozen USN endpoint for both passes.
    let mut history = super::journal_paths::History::default();
    let mut history_limit = false;
    let collected = ntfs::changes(
        drive,
        id,
        start,
        info.next,
        &mut |record| {
            if !history.record(&record) {
                history_limit = true;
                return false;
            }
            true
        },
        &cancelled,
    );
    if history_limit {
        return protocol::write_frame(
            pipe,
            &Response::Rescan {
                reason: RescanReason::DirectoryHistoryLimit,
            },
        );
    }
    if matches!(collected,Err(ref e)if e=="file-search:journal") {
        return protocol::write_frame(
            pipe,
            &Response::Rescan {
                reason: RescanReason::JournalRead,
            },
        );
    }
    collected?;
    let mut parents: HashMap<u64, Vec<u16>> = HashMap::new();
    let mut needs_scan = None;
    let mut failed = None;
    let mut batch = Vec::new();
    let mut size = 0usize;
    let result = ntfs::changes(
        drive,
        id,
        start,
        info.next,
        &mut |record| {
            if record.file & 0xFFFF_FFFF_FFFF < 16 {
                return true;
            }
            if !super::super::ntfs_tree::valid_name(record.name) {
                needs_scan = Some(RescanReason::MetadataChanged);
                return false;
            }
            let parent = if let Some(path) = parents.get(&record.parent) {
                path.clone()
            } else {
                let Ok(path) =
                    history.resolve(drive, record.parent, |parent| parent_by_id(drive, parent))
                else {
                    needs_scan = Some(RescanReason::ParentUnavailable);
                    return false;
                };
                parents.insert(record.parent, path.clone());
                path
            };
            let mut path = parent;
            if path.last() != Some(&92) {
                path.push(92);
            }
            path.extend(record.name);
            // Changes outside the chosen roots do not invalidate this index.
            // Ancestor changes can rename or revoke access to a selected root.
            if !scope.contains(&path) && !scope.ancestor(&path) {
                return true;
            }
            if record.reason & (0x10000 | 0x800) != 0 || scope.ancestor(&path) {
                needs_scan = Some(RescanReason::MetadataChanged);
                return false;
            }
            let parent_end = path.len() - record.name.len() - 1;
            if !visibility.allows(&path[..if parent_end == 2 { 3 } else { parent_end }]) {
                needs_scan = Some(RescanReason::AccessChanged);
                return false;
            }
            if path.len() > 32700 {
                needs_scan = Some(RescanReason::PathInvalid);
                return false;
            }
            let native = PathBuf::from(std::ffi::OsString::from_wide(
                &[&[92u16, 92, 63, 92][..], &path].concat(),
            ));
            let metadata = std::fs::symlink_metadata(&native);
            let deleted = journal_name_deleted(
                record.reason,
                matches!(&metadata,Err(e)if e.kind()==std::io::ErrorKind::NotFound),
            );
            if metadata.is_err() && !deleted {
                needs_scan = Some(RescanReason::MetadataUnavailable);
                return false;
            }
            let directory = metadata
                .as_ref()
                .map(super::super::storage::directory)
                .unwrap_or(record.attributes & 0x10 != 0);
            let bytes = metadata
                .as_ref()
                .ok()
                .filter(|m| m.is_file() && !m.file_type().is_symlink())
                .map(|m| m.len());
            let modified = metadata
                .as_ref()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|v| v.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs());
            size += path.len() * 3;
            batch.push(Metadata {
                path: encode_path(&path),
                size: bytes,
                modified,
                deleted,
                directory,
            });
            if batch.len() >= 128 || size >= 256 * 1024 {
                if let Err(e) = protocol::write_frame(
                    pipe,
                    &Response::Files {
                        items: std::mem::take(&mut batch),
                    },
                ) {
                    failed = Some(e);
                    return false;
                }
                size = 0;
            }
            true
        },
        &cancelled,
    );
    if let Some(error) = failed {
        return Err(error);
    }
    if let Some(reason) = needs_scan {
        return protocol::write_frame(pipe, &Response::Rescan { reason });
    }
    if matches!(result,Err(ref e)if e=="file-search:journal") {
        return protocol::write_frame(
            pipe,
            &Response::Rescan {
                reason: RescanReason::JournalRead,
            },
        );
    }
    let end = result?;
    if !batch.is_empty() {
        protocol::write_frame(pipe, &Response::Files { items: batch })?;
    }
    protocol::write_frame(
        pipe,
        &Response::Done {
            serial,
            journal_id: Some(id),
            next_usn: Some(end),
        },
    )
}

fn journal_name_deleted(reason: u32, missing: bool) -> bool {
    // Windows still resolves an old spelling after a case-only rename. Retire
    // the journal's old-name edge explicitly. A close record may accumulate
    // both rename flags while naming the new entry, which must remain live.
    const RENAME_OLD_NAME: u32 = 0x1000;
    const RENAME_NEW_NAME: u32 = 0x2000;
    missing || (reason & RENAME_OLD_NAME != 0 && reason & RENAME_NEW_NAME == 0)
}

#[cfg(test)]
mod rename_tests {
    use super::journal_name_deleted;
    #[test]
    fn case_only_rename_retires_old_spelling_even_when_it_resolves() {
        use std::{
            path::PathBuf,
            time::{SystemTime, UNIX_EPOCH},
        };
        struct Fixture(PathBuf);
        impl Drop for Fixture {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
        let root = std::env::temp_dir().join(format!(
            "toolknit-usn-case-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        let _fixture = Fixture(root.clone());
        let old = root.join("MixedCase.txt");
        let current = root.join("MIXEDCASE.txt");
        std::fs::write(&old, b"unchanged case fixture").unwrap();
        std::fs::rename(&old, &current).unwrap();
        let old_still_resolves = std::fs::symlink_metadata(&old).is_ok();
        assert!(
            old_still_resolves,
            "Windows permits the previous case-insensitive spelling"
        );
        assert!(
            journal_name_deleted(0x1000, !old_still_resolves),
            "USN old-name record must remove the stale index spelling"
        );
        assert!(
            !journal_name_deleted(0x2000, false),
            "new spelling remains live"
        );
        assert!(
            !journal_name_deleted(0x80003000, false),
            "accumulated close reasons retain the new spelling"
        );
        assert!(journal_name_deleted(0x80000000, true));
        assert_eq!(std::fs::read(&current).unwrap(), b"unchanged case fixture");
    }
}

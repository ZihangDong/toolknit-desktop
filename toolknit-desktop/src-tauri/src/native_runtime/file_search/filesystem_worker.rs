//! User-token filesystem helper. Potentially blocking remote I/O never owns
//! the index, UI, cache, or a privileged service. Its Windows job dies with us.
use super::{
    protocol,
    query::{extension, Entry},
    storage,
};
use serde::{Deserialize, Serialize};
use std::{
    io::Write,
    path::{Component, Path, PathBuf, Prefix},
    process::Stdio,
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[derive(Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "kebab-case", deny_unknown_fields)]
enum Request {
    Normalize { path: Vec<u8> },
    Scan { path: Vec<u8>, #[serde(default)] policy: Option<super::scope_policy::Spec> },
    Reveal { path: Vec<u8>, root: Vec<u8> },
}
#[derive(Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
enum Response {
    Normalized { path: Vec<u8> },
    Files { rows: Vec<Row> },
    Done { skipped: usize },
    Error,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Row {
    path: Vec<u8>,
    size: Option<u64>,
    modified: Option<u64>,
}

pub(super) fn validate_path(path: &Path) -> Result<(), String> {
    if !path.is_absolute()
        || path.as_os_str().len() > 32768
        || path.components().any(|c| matches!(c, Component::ParentDir))
    {
        return Err("file-search:scope".into());
    }
    match path.components().next() {
        Some(Component::Prefix(p))
            if matches!(
                p.kind(),
                Prefix::Disk(_)
                    | Prefix::VerbatimDisk(_)
                    | Prefix::UNC(_, _)
                    | Prefix::VerbatimUNC(_, _)
            ) => {}
        _ => return Err("file-search:scope".into()),
    }
    use std::os::windows::ffi::OsStrExt;
    if path.as_os_str().encode_wide().any(|u| u < 32) {
        return Err("file-search:scope".into());
    }
    Ok(())
}
pub(super) fn remote(path: &Path) -> bool {
    match path.components().next() {
        Some(Component::Prefix(p)) => match p.kind() {
            Prefix::UNC(_, _) | Prefix::VerbatimUNC(_, _) => true,
            Prefix::Disk(d) | Prefix::VerbatimDisk(d) => {
                let root = [d as u16, 58, 92, 0];
                // A disconnected mapping may report an unknown/missing root.
                // Keep its filesystem probes bounded as well.
                let kind = unsafe {
                    windows::Win32::Storage::FileSystem::GetDriveTypeW(windows::core::PCWSTR(
                        root.as_ptr(),
                    ))
                };
                matches!(kind, 0 | 1 | 4)
            }
            _ => false,
        },
        _ => false,
    }
}
fn decoded(bytes: &[u8]) -> Result<PathBuf, String> {
    if bytes.len() > 65534 {
        return Err("file-search:scope".into());
    }
    let path = storage::decode(bytes)?;
    validate_path(&path)?;
    Ok(path)
}
pub(super) fn normalize(path: &Path, cancel: &AtomicBool) -> Result<PathBuf, String> {
    let mut normalized = None;
    run(
        Request::Normalize {
            path: storage::encode(path),
        },
        cancel,
        Duration::from_secs(8),
        |message| {
            if let Response::Normalized { path } = message {
                normalized = Some(decoded(&path)?);
            } else {
                return Err("file-search:protocol".into());
            }
            Ok(())
        },
    )?;
    normalized.ok_or("file-search:scope-unavailable".into())
}
#[cfg(test)]
pub(super) fn scan(
    root: &Path,
    cancel: &AtomicBool,
    receive: impl FnMut(Entry) -> Result<(), String>,
) -> Result<usize, String> {
    scan_policy(root, cancel, None, receive)
}
pub(super) fn scan_policy(
    root: &Path, cancel: &AtomicBool, policy: Option<super::scope_policy::Spec>,
    mut receive: impl FnMut(Entry) -> Result<(), String>,
) -> Result<usize, String> {
    run(
        Request::Scan {
            path: storage::encode(root),
            policy,
        },
        cancel,
        Duration::from_secs(600),
        |message| {
            let Response::Files { rows } = message else {
                return Err("file-search:protocol".into());
            };
            if rows.len() > 128 {
                return Err("file-search:protocol".into());
            }
            for row in rows {
                let path = decoded(&row.path)?;
                if path == root || !path.starts_with(root) {
                    return Err("file-search:forbidden".into());
                }
                let name = path
                    .file_name()
                    .ok_or("file-search:protocol")?
                    .to_string_lossy()
                    .into_owned();
                let parent = path
                    .parent()
                    .ok_or("file-search:protocol")?
                    .to_string_lossy()
                    .into_owned();
                receive(Entry {
                    id: 0,
                    extension: extension(&name),
                    name,
                    parent: parent.into(),
                    path: path.into(),
                    size: row.size,
                    modified: row.modified,
                    verified: true,
                })?;
            }
            Ok(())
        },
    )
}
pub(super) fn reveal(path: &Path, root: &Path) -> Result<(), String> {
    run(
        Request::Reveal {
            path: storage::encode(path),
            root: storage::encode(root),
        },
        &AtomicBool::new(false),
        Duration::from_secs(8),
        |_| Err("file-search:protocol".into()),
    )
    .map(|_| ())
}
fn command() -> Result<tokio::process::Command, String> {
    #[cfg(test)]
    let exe = std::env::var_os("TOOLKNIT_FILE_SEARCH_IO_TEST_EXE")
        .map(PathBuf::from)
        .ok_or("file-search:worker")?;
    #[cfg(not(test))]
    let exe = std::env::current_exe().map_err(|_| "file-search:worker")?;
    let mut command = tokio::process::Command::new(exe);
    command.arg("--file-search-filesystem");
    Ok(command)
}
fn run(
    request: Request,
    cancel: &AtomicBool,
    limit: Duration,
    receive: impl FnMut(Response) -> Result<(), String>,
) -> Result<usize, String> {
    let mut command = command()?;
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|_| "file-search:worker")?
        .block_on(run_command(&mut command, request, cancel, limit, receive))
}
fn own(child: &tokio::process::Child) -> Result<std::os::windows::io::OwnedHandle, String> {
    use std::os::windows::io::{FromRawHandle, OwnedHandle};
    use windows::Win32::{Foundation::HANDLE, System::JobObjects::*};
    let result = || -> windows::core::Result<OwnedHandle> {
        unsafe {
            let handle = CreateJobObjectW(None, None)?;
            let job = OwnedHandle::from_raw_handle(handle.0 as *mut std::ffi::c_void);
            let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            // The helper itself belongs to us. Explorer launched by the Shell
            // remains user-owned and must survive the short-lived helper.
            limits.BasicLimitInformation.LimitFlags =
                JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK;
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const std::ffi::c_void,
                std::mem::size_of_val(&limits) as u32,
            )?;
            let process = child
                .raw_handle()
                .ok_or_else(windows::core::Error::from_win32)?;
            AssignProcessToJobObject(handle, HANDLE(process as isize))?;
            Ok(job)
        }
    };
    result().map_err(|_| "file-search:worker".into())
}
async fn run_command(
    command: &mut tokio::process::Command,
    request: Request,
    cancel: &AtomicBool,
    limit: Duration,
    mut receive: impl FnMut(Response) -> Result<(), String>,
) -> Result<usize, String> {
    if cancel.load(Ordering::Acquire) {
        return Err("file-search:cancelled".into());
    }
    let bytes = serde_json::to_vec(&request).map_err(|_| "file-search:protocol")?;
    if bytes.len() > protocol::MAX_FRAME {
        return Err("file-search:scope".into());
    }
    command
        .kill_on_drop(true)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(0x08000000);
    let mut child = command.spawn().map_err(|_| "file-search:worker")?;
    let job = own(&child)?;
    let mut input = child.stdin.take().ok_or("file-search:worker")?;
    let mut output = child.stdout.take().ok_or("file-search:worker")?;
    let dialogue = async {
        input
            .write_u32_le(bytes.len() as u32)
            .await
            .map_err(|_| "file-search:worker")?;
        input
            .write_all(&bytes)
            .await
            .map_err(|_| "file-search:worker")?;
        input.shutdown().await.map_err(|_| "file-search:worker")?;
        loop {
            let frame = async {
                let length = output
                    .read_u32_le()
                    .await
                    .map_err(|_| "file-search:worker")? as usize;
                if length == 0 || length > protocol::MAX_FRAME {
                    return Err("file-search:protocol".to_owned());
                }
                let mut bytes = vec![0; length];
                output
                    .read_exact(&mut bytes)
                    .await
                    .map_err(|_| "file-search:worker")?;
                serde_json::from_slice::<Response>(&bytes)
                    .map_err(|_| "file-search:protocol".to_owned())
            };
            let response = tokio::time::timeout(Duration::from_secs(8), frame)
                .await
                .map_err(|_| "file-search:scope-timeout")??;
            match response {
                Response::Done { skipped } => return Ok(skipped),
                Response::Error => return Err("file-search:scope-unavailable".into()),
                response => receive(response)?,
            }
        }
    };
    let cancellation = async {
        loop {
            if cancel.load(Ordering::Acquire) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    };
    let result = tokio::select! {
        biased;
        _=cancellation=>Err("file-search:cancelled".into()),
        _=tokio::time::sleep(limit)=>Err("file-search:scope-timeout".into()),
        outcome=dialogue=>outcome,
    };
    drop(input);
    drop(output);
    if result.is_err() {
        let _ = child.start_kill();
    }
    drop(job);
    let _ = tokio::time::timeout(Duration::from_secs(2), child.wait()).await;
    result
}

pub(super) fn dispatch() -> Option<i32> {
    if std::env::args().nth(1).as_deref() != Some("--file-search-filesystem") {
        return None;
    }
    if std::env::args().count() != 2 {
        return Some(2);
    }
    let mut output = std::io::stdout().lock();
    let result = (|| {
        let request = protocol::read_frame::<Request>(&mut std::io::stdin().lock())?;
        execute(request, &mut output)
    })();
    if result.is_err() {
        let _ = protocol::write_frame(&mut output, &Response::Error);
    }
    Some(if result.is_ok() { 0 } else { 1 })
}
fn execute(request: Request, out: &mut impl Write) -> Result<(), String> {
    match request {
        Request::Normalize { path } => {
            let path = decoded(&path)?
                .canonicalize()
                .map_err(|_| "file-search:scope-unavailable")?;
            validate_path(&path)?;
            if !path.is_dir() {
                return Err("file-search:scope".into());
            }
            protocol::write_frame(
                out,
                &Response::Normalized {
                    path: storage::encode(&path),
                },
            )?;
            protocol::write_frame(out, &Response::Done { skipped: 0 })
        }
        Request::Reveal { path, root } => {
            let path = decoded(&path)?;
            let root = decoded(&root)?;
            if path == root
                || !path.starts_with(&root)
                || !path
                    .parent()
                    .ok_or("file-search:scope")?
                    .canonicalize()
                    .map_err(|_| "file-search:unavailable")?
                    .starts_with(&root)
            {
                return Err("file-search:forbidden".into());
            }
            crate::platform::file_location::reveal_file(&path)?;
            protocol::write_frame(out, &Response::Done { skipped: 0 })
        }
        Request::Scan { path, policy } => scan_child(&decoded(&path)?, out, super::scope_policy::Policy::from_spec(policy)?),
    }
}
fn scan_child(root: &Path, out: &mut impl Write, policy: super::scope_policy::Policy) -> Result<(), String> {
    let root_meta = std::fs::symlink_metadata(root).map_err(|_| "file-search:scope-unavailable")?;
    if !storage::can_descend(root, &root_meta, true) {
        return Err("file-search:scope".into());
    }
    let mut stack = vec![root.to_path_buf()];
    let mut queued_bytes = root.as_os_str().len() * 2;
    let mut batch = Vec::new();
    let mut skipped = 0usize;
    let mut count = 0usize;
    let mut bytes = 0usize;
    let mut last = Instant::now();
    while let Some(dir) = stack.pop() {
        if policy.excludes(&dir) { continue; }
        queued_bytes = queued_bytes.saturating_sub(dir.as_os_str().len() * 2);
        if !std::fs::symlink_metadata(&dir)
            .is_ok_and(|m| storage::can_descend(&dir, &m, dir == root))
        {
            skipped += 1;
            continue;
        }
        if last.elapsed() > Duration::from_millis(250) {
            protocol::write_frame(
                out,
                &Response::Files {
                    rows: std::mem::take(&mut batch),
                },
            )?;
            bytes = 0;
            last = Instant::now();
        }
        let entries = match std::fs::read_dir(&dir) {
            Ok(v) => v,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };
        for item in entries {
            count += 1;
            if count > 5_000_000 {
                skipped += 1;
                stack.clear();
                break;
            }
            let item = match item {
                Ok(v) => v,
                Err(_) => {
                    skipped += 1;
                    continue;
                }
            };
            let path = item.path();
            if policy.excludes(&path) { continue; }
            let meta = match std::fs::symlink_metadata(&path) {
                Ok(v) => v,
                Err(_) => {
                    skipped += 1;
                    continue;
                }
            };
            if storage::directory(&meta) {
                if storage::can_descend(&path, &meta, false) {
                    let cost = path.as_os_str().len() * 2;
                    if queued_bytes + cost <= 16 * 1024 * 1024 && stack.len() < 100_000 {
                        queued_bytes += cost;
                        stack.push(path);
                    } else {
                        skipped += 1;
                    }
                } else {
                    skipped += 1;
                }
            } else if let Ok(entry) = storage::entry(&path, 0) {
                let encoded = storage::encode(&path);
                bytes += encoded.len() * 4 + 100;
                batch.push(Row {
                    path: encoded,
                    size: entry.size,
                    modified: entry.modified,
                });
            } else {
                skipped += 1;
            }
            if batch.len() >= 128
                || bytes >= 128 * 1024
                || last.elapsed() > Duration::from_millis(250)
            {
                protocol::write_frame(
                    out,
                    &Response::Files {
                        rows: std::mem::take(&mut batch),
                    },
                )?;
                bytes = 0;
                last = Instant::now();
            }
        }
    }
    if !batch.is_empty() {
        protocol::write_frame(out, &Response::Files { rows: batch })?;
    }
    protocol::write_frame(out, &Response::Done { skipped })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn remote_paths_are_explicit_and_device_names_are_rejected() {
        for value in [r"\\server\share\folder", r"\\?\UNC\server\share\folder"] {
            let path = Path::new(value);
            validate_path(path).unwrap();
            assert!(remote(path));
        }
        for value in [
            r"\\.\PhysicalDrive0",
            r"\\?\GLOBALROOT\Device",
            r"C:relative",
            r"\\server\share\..\other",
        ] {
            assert!(validate_path(Path::new(value)).is_err());
        }
        assert!(
            serde_json::from_str::<Request>(r#"{"action":"execute","command":"anything"}"#)
                .is_err()
        );
    }
    #[test]
    fn stalled_filesystem_process_times_out_and_cancels() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let slow = || {
                let mut c = tokio::process::Command::new("powershell.exe");
                c.args([
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    "Start-Sleep -Seconds 30",
                ]);
                c
            };
            let request = || Request::Normalize {
                path: storage::encode(Path::new(r"C:\")),
            };
            let started = Instant::now();
            let result = run_command(
                &mut slow(),
                request(),
                &AtomicBool::new(false),
                Duration::from_millis(300),
                |_| Ok(()),
            )
            .await;
            assert_eq!(result.unwrap_err(), "file-search:scope-timeout");
            assert!(started.elapsed() < Duration::from_secs(3));
            let cancel = AtomicBool::new(false);
            let mut command = slow();
            let started = Instant::now();
            let (result, ()) = tokio::join!(
                run_command(
                    &mut command,
                    request(),
                    &cancel,
                    Duration::from_secs(10),
                    |_| Ok(())
                ),
                async {
                    tokio::time::sleep(Duration::from_millis(150)).await;
                    cancel.store(true, Ordering::Release);
                }
            );
            assert_eq!(result.unwrap_err(), "file-search:cancelled");
            assert!(started.elapsed() < Duration::from_secs(3));
            let mut command = slow();
            command.creation_flags(0x08000000).kill_on_drop(true);
            let mut child = command.spawn().unwrap();
            let job = own(&child).unwrap();
            drop(job);
            assert!(
                tokio::time::timeout(Duration::from_secs(2), child.wait())
                    .await
                    .is_ok(),
                "Windows job must reclaim the helper"
            );
        });
    }
    struct Fixture(PathBuf);
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    #[test]
    #[ignore = "requires TOOLKNIT_FILE_SEARCH_IO_TEST_EXE pointing to a built desktop executable"]
    fn built_filesystem_helper_preserves_sources_and_bounds_missing_share() {
        let path =
            std::env::temp_dir().join(format!("toolknit-filesystem-worker-{}", std::process::id()));
        std::fs::create_dir(&path).unwrap();
        let fixture = Fixture(path.canonicalize().unwrap());
        std::fs::create_dir(fixture.0.join("nested")).unwrap();
        std::fs::write(fixture.0.join("合同,1.txt"), b"unchanged source").unwrap();
        std::fs::write(fixture.0.join("nested/invoice.csv"), b"sample").unwrap();
        assert_eq!(
            normalize(&fixture.0, &AtomicBool::new(false)).unwrap(),
            fixture.0
        );
        let mut files = Vec::new();
        let skipped = scan(&fixture.0, &AtomicBool::new(false), |entry| {
            files.push(entry.path.to_path_buf());
            Ok(())
        })
        .unwrap();
        assert_eq!(skipped, 0);
        assert_eq!(files.len(), 2);
        assert!(files.contains(&fixture.0.join("合同,1.txt")));
        assert!(files.contains(&fixture.0.join("nested/invoice.csv")));
        assert_eq!(
            std::fs::read(fixture.0.join("合同,1.txt")).unwrap(),
            b"unchanged source"
        );
        let started = Instant::now();
        let missing = PathBuf::from(format!(
            r"\\localhost\ToolKnit-missing-fixture-{}",
            std::process::id()
        ));
        assert!(normalize(&missing, &AtomicBool::new(false)).is_err());
        assert!(started.elapsed() < Duration::from_secs(11));
    }
    #[test]
    #[ignore = "requires a built helper and an already accessible localhost administrative share; never creates a share"]
    fn existing_loopback_share_reconciles_without_elevation() {
        let path =
            std::env::temp_dir().join(format!("toolknit-remote-index-{}", std::process::id()));
        std::fs::create_dir(&path).unwrap();
        let fixture = Fixture(path.canonicalize().unwrap());
        let source = fixture.0.join("source");
        std::fs::create_dir(&source).unwrap();
        std::fs::write(source.join("合同.txt"), b"unchanged source").unwrap();
        let normal = source
            .to_string_lossy()
            .trim_start_matches(r"\\?\")
            .to_owned();
        let unc = PathBuf::from(format!(r"\\localhost\{}${}", &normal[..1], &normal[2..]));
        let root = normalize(&unc, &AtomicBool::new(false))
            .expect("existing loopback share unavailable for this ordinary account");
        assert!(remote(&root));
        let index = super::super::index::Index::new(fixture.0.join("cache/index.sqlite"));
        index.start(vec![root.clone()]).unwrap();
        let wait = |count: usize| {
            let until = Instant::now() + Duration::from_secs(15);
            loop {
                let catalog = index.shared.catalog.read().unwrap();
                if index.status().phase == "ready" && catalog.entries.len() == count {
                    break;
                }
                drop(catalog);
                assert!(
                    Instant::now() < until,
                    "remote index did not reconcile: {}",
                    index.status().phase
                );
                std::thread::sleep(Duration::from_millis(50));
            }
        };
        wait(1);
        std::fs::write(source.join("new.txt"), b"new fixture").unwrap();
        index.shared.repair_requested.store(true, Ordering::Release);
        wait(2);
        std::fs::remove_file(source.join("new.txt")).unwrap();
        index.shared.repair_requested.store(true, Ordering::Release);
        wait(1);
        index.stop();
        index.clear().unwrap();
        assert_eq!(
            std::fs::read(source.join("合同.txt")).unwrap(),
            b"unchanged source"
        );
    }
}

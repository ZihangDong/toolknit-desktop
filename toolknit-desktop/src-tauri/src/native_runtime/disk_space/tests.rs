use super::*;
use engine::{scan, view, Limits};
use std::{
    fs,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};
struct Fixture {
    root: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "toolknit-disk-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&root).unwrap();
        Self { root }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}
fn write(path: &Path, size: u64) {
    fs::File::create(path).unwrap().set_len(size).unwrap();
}
fn run(root: &Path) -> Report {
    scan(
        root,
        "test-scan",
        &AtomicBool::new(false),
        Limits::default(),
        |_| {},
    )
    .unwrap()
}
#[test]
fn sizes_hard_links_and_readonly_sources() {
    let fixture = Fixture::new();
    let root = &fixture.root;
    fs::create_dir(root.join("资料")).unwrap();
    fs::create_dir(root.join("empty")).unwrap();
    write(&root.join("资料/original.bin"), 4096);
    fs::hard_link(root.join("资料/original.bin"), root.join("alias.bin")).unwrap();
    write(&root.join("plain.txt"), 17);
    write(&root.join("zero.txt"), 0);
    let before = fs::metadata(root.join("资料/original.bin"))
        .unwrap()
        .modified()
        .unwrap();
    let report = run(root);
    assert_eq!(report.summary.root.bytes, 4113);
    assert_eq!(report.summary.files, 4);
    assert_eq!(report.summary.hard_links, 1);
    assert_eq!(report.summary.directories, 3);
    assert!(!report.summary.partial);
    let alias = report.nodes.iter().find(|n| n.name == "alias.bin").unwrap();
    assert_eq!(alias.bytes, 4096);
    assert!(!alias.duplicate);
    let original = report
        .nodes
        .iter()
        .find(|n| n.name == "original.bin")
        .unwrap();
    assert_eq!(original.bytes, 0);
    assert_eq!(original.logical_bytes, 4096);
    assert!(original.duplicate);
    assert_eq!(
        fs::metadata(root.join("资料/original.bin"))
            .unwrap()
            .modified()
            .unwrap(),
        before
    );
    assert_eq!(fs::read(root.join("plain.txt")).unwrap(), vec![0; 17]);
    for node in &report.nodes {
        if node.kind == "directory" {
            assert_eq!(
                node.bytes,
                node.children
                    .iter()
                    .map(|id| report.nodes[*id].bytes)
                    .sum::<u64>()
            );
        }
    }
    let json = serde_json::to_value(&report.summary).unwrap();
    assert_eq!(json["root"]["bytes"], "4113");
}
#[test]
fn paging_tiles_zeroes_and_directory_navigation() {
    let fixture = Fixture::new();
    for i in 0..150 {
        write(&fixture.root.join(format!("item-{i:03}")), i as u64);
    }
    fs::create_dir(fixture.root.join("sub")).unwrap();
    write(&fixture.root.join("sub/nested"), 101);
    let report = run(&fixture.root);
    let first = view(&report, 0, 0, 100).unwrap();
    assert_eq!(first.total, 151);
    assert_eq!(first.items.len(), 100);
    assert_eq!(first.tiles.len(), 60);
    assert_eq!(first.zero_count, 1);
    assert_eq!(first.other_count, 90);
    assert_eq!(
        first.tiles.iter().map(|n| n.bytes).sum::<u64>() + first.other_bytes,
        first.node.bytes
    );
    assert!(first.items.windows(2).all(|w| w[0].bytes >= w[1].bytes));
    let tail = view(&report, 0, 100, 100).unwrap();
    assert_eq!(tail.items.len(), 51);
    assert!(first
        .items
        .iter()
        .all(|a| !tail.items.iter().any(|b| a.id == b.id)));
    let directory = report.nodes.iter().find(|n| n.name == "sub").unwrap();
    let nested = view(&report, directory.id, 0, 100).unwrap();
    assert_eq!(nested.breadcrumbs.len(), 2);
    assert_eq!(nested.items[0].name, "nested");
    assert!(view(&report, nested.items[0].id, 0, 100).is_err());
    assert!(view(&report, usize::MAX, 0, 100).is_err());
    assert_eq!(view(&report, 0, usize::MAX, 10000).unwrap().items.len(), 0);
}
#[test]
fn cancellation_entry_depth_and_time_limits_keep_partial_results() {
    let fixture = Fixture::new();
    fs::create_dir(fixture.root.join("deep")).unwrap();
    fs::create_dir(fixture.root.join("deep/more")).unwrap();
    write(&fixture.root.join("deep/more/data"), 1024);
    write(&fixture.root.join("top"), 20);
    let cancel = AtomicBool::new(false);
    let partial = scan(
        &fixture.root,
        "cancel-test",
        &cancel,
        Limits::default(),
        |_| cancel.store(true, Ordering::SeqCst),
    )
    .unwrap();
    assert!(partial.summary.cancelled);
    assert!(partial.summary.partial);
    assert!(!partial.nodes.is_empty());
    let capped = scan(
        &fixture.root,
        "cap-test",
        &AtomicBool::new(false),
        Limits {
            entries: 2,
            ..Limits::default()
        },
        |_| {},
    )
    .unwrap();
    assert_eq!(capped.summary.limit_reason, Some("entries"));
    assert!(capped.summary.partial);
    let depth = scan(
        &fixture.root,
        "depth-test",
        &AtomicBool::new(false),
        Limits {
            depth: 1,
            ..Limits::default()
        },
        |_| {},
    )
    .unwrap();
    assert_eq!(depth.summary.root.bytes, 20);
    assert_eq!(depth.summary.limit_reason, Some("depth"));
    assert!(depth.summary.issues.iter().any(|i| i.reason == "depth"));
    let timed = scan(
        &fixture.root,
        "time-test",
        &AtomicBool::new(false),
        Limits {
            duration: Duration::ZERO,
            ..Limits::default()
        },
        |_| {},
    )
    .unwrap();
    assert_eq!(timed.summary.limit_reason, Some("time"));
    let memory = scan(
        &fixture.root,
        "memory-test",
        &AtomicBool::new(false),
        Limits {
            path_bytes: 1,
            ..Limits::default()
        },
        |_| {},
    )
    .unwrap();
    assert_eq!(memory.summary.limit_reason, Some("memory"));
}
#[test]
fn root_validation_busy_scoped_cancel_and_release() {
    assert!(engine::validate_root(Path::new("relative/path")).is_err());
    let fixture = Fixture::new();
    write(&fixture.root.join("not-directory"), 0);
    assert!(engine::validate_root(&fixture.root.join("not-directory")).is_err());
    assert!(engine::validate_root(&fixture.root.join("missing")).is_err());
    let state = DiskSpaceState::default();
    assert!(reserve(&state, "bad/id").is_err());
    let job = reserve(&state, "one").unwrap();
    assert!(reserve(&state, "two").is_err());
    assert!(!cancel(&state, "unrelated", false));
    assert!(!job.cancel.load(Ordering::SeqCst));
    assert!(reserve(&state, "unrelated")
        .err()
        .unwrap()
        .contains("cancelled"));
    assert!(cancel(&state, "one", false));
    let summary = finish(
        &state,
        &job,
        scan(
            &fixture.root,
            &job.id,
            &job.cancel,
            Limits::default(),
            |_| {},
        ),
    )
    .unwrap();
    assert!(summary.cancelled);
    assert!(lock(&state.inner).report.is_some());
    cancel(&state, "one", true);
    assert!(lock(&state.inner).report.is_none());
    let job = reserve(&state, "retired").unwrap();
    cancel(&state, "retired", true);
    assert!(finish(&state, &job, Ok(run(&fixture.root))).is_err());
    assert!(lock(&state.inner).report.is_none());
    assert!(lock(&state.inner).active.is_none());
}
#[test]
fn failed_rescan_preserves_previous_cache_and_requests_are_bounded() {
    let fixture = Fixture::new();
    write(&fixture.root.join("source"), 42);
    let state = DiskSpaceState::default();
    let job = reserve(&state, "saved").unwrap();
    let report = scan(
        &fixture.root,
        &job.id,
        &job.cancel,
        Limits::default(),
        |_| {},
    )
    .unwrap();
    finish(&state, &job, Ok(report)).unwrap();
    let failed = reserve(&state, "failed").unwrap();
    assert!(finish(&state, &failed, Err("disk:root".into())).is_err());
    assert_eq!(
        lock(&state.inner).report.as_ref().unwrap().summary.job_id,
        "saved"
    );
    assert!(lock(&state.inner).active.is_none());
    assert!(serde_json::from_value::<Request>(
        serde_json::json!({"action":"children","jobId":"saved","nodeId":-1})
    )
    .is_err());
    assert!(serde_json::from_value::<Request>(
        serde_json::json!({"action":"start","jobId":"saved","unexpected":true})
    )
    .is_err());
}
#[cfg(windows)]
#[test]
fn offline_attributes_and_network_roots_are_excluded() {
    use std::os::windows::{ffi::OsStrExt, fs::MetadataExt};
    use windows::{
        core::PCWSTR,
        Win32::Storage::FileSystem::{SetFileAttributesW, FILE_FLAGS_AND_ATTRIBUTES},
    };
    let fixture = Fixture::new();
    let file = fixture.root.join("offline.bin");
    write(&file, 100);
    write(&fixture.root.join("visible"), 19);
    let wide = file
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let original = fs::metadata(&file).unwrap().file_attributes();
    unsafe {
        SetFileAttributesW(
            PCWSTR(wide.as_ptr()),
            FILE_FLAGS_AND_ATTRIBUTES(original | 0x1000),
        )
    }
    .unwrap();
    let result = scan(
        &fixture.root,
        "offline",
        &AtomicBool::new(false),
        Limits::default(),
        |_| {},
    );
    unsafe { SetFileAttributesW(PCWSTR(wide.as_ptr()), FILE_FLAGS_AND_ATTRIBUTES(original)) }
        .unwrap();
    let report = result.unwrap();
    assert_eq!(report.summary.root.bytes, 19);
    assert_eq!(report.summary.skipped, 1);
    assert_eq!(report.summary.issues[0].reason, "offline");
    assert!(engine::validate_root(Path::new(r"\\unreachable.invalid\share")).is_err());
    assert!(engine::validate_root(Path::new(r"\\.\C:")).is_err());
}
#[cfg(windows)]
#[test]
fn junction_cycles_are_skipped_and_explicit_junction_roots_rejected() {
    let fixture = Fixture::new();
    write(&fixture.root.join("known"), 128);
    let link = fixture.root.join("loop");
    let output = std::process::Command::new("cmd.exe")
        .args(["/d", "/c", "mklink", "/J"])
        .arg(&link)
        .arg(&fixture.root)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let report = run(&fixture.root);
    let rejected = engine::validate_root(&link).is_err();
    fs::remove_dir(&link).unwrap();
    assert_eq!(report.summary.root.bytes, 128);
    assert_eq!(report.summary.skipped, 1);
    assert_eq!(report.summary.issues[0].reason, "link");
    assert!(rejected);
}
#[cfg(windows)]
#[test]
fn unreadable_directory_retains_accessible_siblings() {
    struct DenyGuard(PathBuf);
    impl Drop for DenyGuard {
        fn drop(&mut self) {
            let _ = std::process::Command::new("icacls.exe")
                .arg(&self.0)
                .args(["/remove:d", "*S-1-1-0"])
                .output();
        }
    }
    let fixture = Fixture::new();
    let denied = fixture.root.join("denied");
    fs::create_dir(&denied).unwrap();
    write(&denied.join("hidden"), 1000);
    write(&fixture.root.join("visible"), 31);
    let guard = DenyGuard(denied.clone());
    let result = std::process::Command::new("icacls.exe")
        .arg(&denied)
        .args(["/deny", "*S-1-1-0:(RD)"])
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "Cannot restrict synthetic directory"
    );
    let report = run(&fixture.root);
    drop(guard);
    assert_eq!(report.summary.root.bytes, 31);
    assert!(report.summary.partial);
    assert!(report
        .summary
        .issues
        .iter()
        .any(|i| i.reason == "permission"));
}
#[test]
#[ignore = "Creates an isolated synthetic 5000-file directory and writes an explicit QA snapshot"]
fn disk_space_native_acceptance() {
    let output = std::env::var_os("TOOLKNIT_DISK_QA_ROOT")
        .map(PathBuf::from)
        .expect("QA output directory");
    fs::create_dir_all(&output).unwrap();
    let fixture = Fixture::new();
    let started = Instant::now();
    let mut expected = 0u64;
    for folder in 0..40 {
        let directory = fixture.root.join(format!("资料-{folder:02}"));
        fs::create_dir(&directory).unwrap();
        for file in 0..125 {
            let size = (folder * 125 + file + 1) as u64;
            write(&directory.join(format!("file-{file:03}.bin")), size);
            expected += size;
        }
    }
    fs::hard_link(
        fixture.root.join("资料-00/file-000.bin"),
        fixture.root.join("hard-link.bin"),
    )
    .unwrap();
    fs::create_dir(fixture.root.join("空目录")).unwrap();
    let report = run(&fixture.root);
    assert_eq!(report.summary.root.bytes, expected);
    assert_eq!(report.summary.files, 5001);
    assert_eq!(report.summary.hard_links, 1);
    assert!(!report.summary.partial);
    fs::write(
        output.join("native-report.json"),
        serde_json::to_vec_pretty(
            &serde_json::json!({"summary":report.summary,"nodes":report.nodes}),
        )
        .unwrap(),
    )
    .unwrap();
    println!(
        "Read-only synthetic scan: {} files, {} bytes, {} ms scan, {} ms fixture plus scan",
        report.summary.files,
        expected,
        report.summary.elapsed_ms,
        started.elapsed().as_millis()
    );
}

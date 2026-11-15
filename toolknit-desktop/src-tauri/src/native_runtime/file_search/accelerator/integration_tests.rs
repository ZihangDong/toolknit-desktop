use super::*;
use std::{
    collections::HashSet,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
struct Fixture(std::path::PathBuf);
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

// Requires the real, reviewed desktop service host to have been installed via
// its UAC flow. Reads volume metadata; never reads private document contents.
#[test]
#[ignore = "requires explicit real NTFS accelerator installation"]
fn installed_service_scans_catches_up_and_stops() {
    assert_eq!(
        std::env::var("TOOLKNIT_TEST_NTFS_SERVICE").as_deref(),
        Ok("1")
    );
    if let Some(marker) = std::env::var_os("TOOLKNIT_NTFS_PARENT_TEST") {
        let mut client = Client::connect(Arc::new(AtomicBool::new(false))).unwrap();
        std::fs::write(marker, b"connected").unwrap();
        let _ = client.scan(b'C', &[std::path::PathBuf::from(r"C:\")], |_| Ok(()));
        std::thread::sleep(Duration::from_secs(30));
        return;
    }
    assert!(
        !identity::elevated(),
        "run the desktop client without elevation"
    );
    let sid = identity::current_sid().unwrap();
    if let Some(exe) = std::env::var_os("TOOLKNIT_FILE_SEARCH_IO_TEST_EXE") {
        use std::os::windows::ffi::OsStrExt;
        let source = std::path::PathBuf::from(exe).canonicalize().unwrap().as_os_str()
            .encode_wide().flat_map(u16::to_le_bytes).collect::<Vec<_>>();
        assert!(install::current_for_source(&sid, &source), "compatible protected service must be reusable");
        assert!(!install::current_for_source(&sid, b"different installation"));
    }
    assert!(
        install::installed(&sid),
        "install the desktop service host first"
    );
    let parent = std::env::var_os("TOOLKNIT_TEST_NTFS_ROOT")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    let root = parent.join(format!("toolknit-ntfs-fixture-{}", std::process::id()));
    std::fs::create_dir(&root).unwrap();
    let root = root.canonicalize().unwrap();
    let _fixture = Fixture(root.clone());
    let source = root.join("合同,1.pdf");
    let sub = root.join("nested");
    std::fs::create_dir(&sub).unwrap();
    std::fs::write(&source, b"fixture unchanged").unwrap();
    std::fs::write(sub.join("old.txt"), b"fixture").unwrap();
    let old_case = root.join("MixedCase.txt");
    let new_case = root.join("MIXEDCASE.txt");
    std::fs::write(&old_case, b"case fixture unchanged").unwrap();
    let drive = match root.components().next().unwrap() {
        std::path::Component::Prefix(p) => match p.kind() {
            std::path::Prefix::Disk(d) | std::path::Prefix::VerbatimDisk(d) => d,
            _ => panic!("local fixture required"),
        },
        _ => panic!("local fixture required"),
    };
    let mut client = Client::connect(Arc::new(AtomicBool::new(false))).unwrap();
    let mut files = HashSet::new();
    let started = Instant::now();
    let checkpoint = client
        .scan(drive, std::slice::from_ref(&root), |entry| {
            assert!(
                entry.path.starts_with(&root),
                "service must return only selected scope"
            );
            files.insert(entry.path.to_path_buf());
            Ok(())
        })
        .unwrap();
    assert!(files.contains(&source));
    assert!(files.contains(&sub.join("old.txt")));
    assert!(files.contains(&old_case));
    println!(
        "NTFS first scan completed in {}ms; synthetic files found={}",
        started.elapsed().as_millis(),
        files.len()
    );
    std::fs::rename(&source, root.join("renamed.pdf")).unwrap();
    std::fs::remove_file(sub.join("old.txt")).unwrap();
    std::fs::write(root.join("new.txt"), b"new fixture").unwrap();
    std::fs::rename(&old_case, &new_case).unwrap();
    assert!(
        std::fs::symlink_metadata(&old_case).is_ok(),
        "old case is still a valid filesystem alias"
    );
    // A deleted parent outside the selected scope must not force a full scan.
    let noise = root
        .parent()
        .unwrap()
        .join(format!("toolknit-ntfs-noise-{}", std::process::id()));
    std::fs::create_dir(&noise).unwrap();
    std::fs::write(noise.join("discard.txt"), b"disposable fixture").unwrap();
    std::fs::remove_file(noise.join("discard.txt")).unwrap();
    std::fs::remove_dir(&noise).unwrap();
    let replay_started = Instant::now();
    let next = client
        .changes(drive, &checkpoint, std::slice::from_ref(&root), |change| {
            match change {
                Change::File(e) if e.path.starts_with(&root) => {
                    files.insert(e.path.to_path_buf());
                }
                Change::Removed(p) => {
                    files.retain(|f| !f.starts_with(&p));
                }
                _ => {}
            }
            Ok(())
        })
        .unwrap();
    println!(
        "NTFS change replay: {}",
        if next.is_some() {
            "USN incremental"
        } else {
            "full-scan fallback"
        }
    );
    assert!(
        next.is_some(),
        "ordinary synthetic changes must use USN replay"
    );
    let replay_checkpoint = next.unwrap();
    println!(
        "NTFS incremental replay completed in {}ms",
        replay_started.elapsed().as_millis()
    );
    assert!(files.contains(&root.join("renamed.pdf")) && files.contains(&root.join("new.txt")));
    assert!(!files.contains(&source) && !files.contains(&sub.join("old.txt")));
    assert!(
        files.contains(&new_case) && !files.contains(&old_case),
        "case-only rename must replace the spelling without a duplicate"
    );
    assert_eq!(std::fs::read(&new_case).unwrap(), b"case fixture unchanged");
    assert_eq!(
        std::fs::read(root.join("renamed.pdf")).unwrap(),
        b"fixture unchanged"
    );
    drop(client);
    let deadline = Instant::now() + Duration::from_secs(15);
    while install::running_pid(&sid).is_ok() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(100));
    }
    assert!(
        install::running_pid(&sid).is_err(),
        "service must stop on client disconnect"
    );
    std::fs::write(root.join("while-app-stopped.txt"), b"offline fixture").unwrap();
    // A new client must start a fresh demand-service process after disconnect.
    let mut client = Client::connect(Arc::new(AtomicBool::new(false))).unwrap();
    let mut resumed_file = false;
    let resumed = client
        .changes(
            drive,
            &replay_checkpoint,
            std::slice::from_ref(&root),
            |change| {
                if let Change::File(entry) = change {
                    if entry.path.as_ref() == root.join("while-app-stopped.txt") {
                        resumed_file = true;
                    }
                }
                Ok(())
            },
        )
        .unwrap();
    assert!(
        resumed.is_some() && resumed_file,
        "next launch must catch up from its saved USN checkpoint"
    );
    let mut invalid = checkpoint.clone();
    invalid.serial ^= 1;
    assert!(client
        .changes(drive, &invalid, std::slice::from_ref(&root), |_| panic!(
            "wrong volume must not emit files"
        ))
        .unwrap()
        .is_none());
    invalid = checkpoint.clone();
    invalid.journal_id = Some(checkpoint.journal_id.unwrap_or(0) ^ 1);
    invalid.next_usn = Some(checkpoint.next_usn.unwrap_or(0));
    assert!(client
        .changes(drive, &invalid, std::slice::from_ref(&root), |_| panic!(
            "invalid journal must not emit files"
        ))
        .unwrap()
        .is_none());
    drop(client);
    wait_stopped(&sid);

    // Cancellation during real MFT I/O must return and release the service.
    let cancel = Arc::new(AtomicBool::new(false));
    let mut client = Client::connect(cancel.clone()).unwrap();
    let signal = cancel.clone();
    let interrupter = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(250));
        signal.store(true, Ordering::Release);
    });
    let started = Instant::now();
    assert!(client
        .scan(drive, std::slice::from_ref(&root), |_| Ok(()))
        .is_err());
    assert!(started.elapsed() < Duration::from_secs(8));
    drop(client);
    interrupter.join().unwrap();
    wait_stopped(&sid);

    // Abrupt client death exercises the actual LocalSystem watchdog, not a
    // graceful Rust drop. Only this synthetic child process is terminated.
    let marker = root.join("child-ready");
    let mut child = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "native_runtime::file_search::accelerator::integration_tests::installed_service_scans_catches_up_and_stops", "--ignored", "--test-threads=1"])
        .env("TOOLKNIT_NTFS_PARENT_TEST", &marker)
        .stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null())
        .spawn().unwrap();
    let deadline = Instant::now() + Duration::from_secs(15);
    while !marker.exists() && child.try_wait().unwrap().is_none() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(50));
    }
    let ready = marker.exists();
    let _ = child.kill();
    child.wait().unwrap();
    assert!(ready, "synthetic child did not connect");
    wait_stopped(&sid);
    println!("NTFS normal-user connect/reconnect, invalid checkpoint, active-scan cancellation and client-death recovery passed");
    // The fixture was created above; no production cache or source is removed.
    // Fixture ownership is released even when an assertion above fails.
}

fn wait_stopped(sid: &str) {
    let deadline = Instant::now() + Duration::from_secs(15);
    while install::running_pid(sid).is_ok() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(100));
    }
    assert!(
        install::running_pid(sid).is_err(),
        "service must stop within 15s"
    );
}

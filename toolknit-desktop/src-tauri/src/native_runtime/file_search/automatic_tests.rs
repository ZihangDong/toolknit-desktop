//! Explicit real-machine metadata coverage. No document contents are opened.
use super::*;
use std::{path::PathBuf, sync::Arc, time::{Duration, Instant}};

#[test]
#[ignore = "explicit ordinary whole-machine metadata discovery/cancellation smoke test"]
fn ordinary_discovery_publishes_results_and_cancels_without_service() {
    let cancel = AtomicBool::new(false);
    let started = Instant::now();
    let locations = discovery::discover(&[], &cancel).unwrap();
    assert!(!locations.is_empty());
    let identities = locations.iter().map(|v| &v.identity).collect::<std::collections::HashSet<_>>();
    assert_eq!(identities.len(), locations.len());
    for location in locations.iter().filter(|v| !v.remote) {
        assert!(location.root.is_absolute());
        assert_eq!(discovery::volume_id(&location.root).as_ref(), Some(&location.identity));
        assert!(std::fs::metadata(&location.root).unwrap().is_dir());
    }
    println!("ORDINARY_DISCOVERY scopes={} ntfs={} elapsed_ms={}", locations.len(), locations.iter().filter(|v| v.fast).count(), started.elapsed().as_millis());
    let base = std::env::temp_dir().join(format!("toolknit-auto-ordinary-{}", std::process::id()));
    std::fs::create_dir(&base).unwrap();
    struct Cleanup(PathBuf);
    impl Drop for Cleanup { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); } }
    let _cleanup = Cleanup(base.clone());
    let policy = scope_policy::Policy::automatic(&base).unwrap().with_volumes(
        locations.iter().filter(|v| !v.remote).map(|v| (v.root.clone(), v.identity.clone())).collect());
    let engine = index::Index::new(base.join("file-search/index.sqlite"));
    let scan_started = Instant::now();
    engine.start_policy(locations.iter().map(|v| v.root.clone()).collect(), false, policy.clone()).unwrap();
    // Stop after the first useful batch. This verifies the fallback and cancel
    // path, without pretending to measure complete accelerated coverage.
    let until = Instant::now() + Duration::from_secs(30);
    loop {
        let status = engine.status();
        assert!(status.error.is_none(), "{:?}", status.error);
        if status.indexed >= 256 || status.phase == "ready" {
            println!("ORDINARY_FIRST_BATCH ms={} indexed={} phase={}", scan_started.elapsed().as_millis(), status.indexed, status.phase);
            assert!(status.indexed > 0 && !status.accelerated);
            break;
        }
        assert!(Instant::now() < until, "ordinary first batch deadline");
        std::thread::sleep(Duration::from_millis(25));
    }
    {
        let catalog = engine.shared.catalog.read().unwrap();
        assert!(catalog.entries.iter().all(|e| !policy.excludes(&e.path)));
    }
    let stop_started = Instant::now();
    engine.stop();
    engine.clear().unwrap();
    println!("ORDINARY_CANCEL ms={}", stop_started.elapsed().as_millis());
    assert!(stop_started.elapsed() < Duration::from_secs(10));
    assert!(engine.shared.catalog.read().unwrap().entries.is_empty());
    assert!(!base.join("file-search/index.sqlite").exists());
}

#[test]
#[ignore = "requires reviewed installed service and explicit whole-machine metadata test"]
fn automatic_discovery_indexes_local_volumes_and_resumes() {
    assert_eq!(std::env::var("TOOLKNIT_TEST_NTFS_SERVICE").as_deref(), Ok("1"));
    let cancel = Arc::new(AtomicBool::new(false));
    let started = Instant::now();
    let locations = discovery::discover(&[], &cancel).unwrap();
    println!("AUTO_DISCOVERY scopes={} accelerated_volumes={} elapsed_ms={}", locations.len(), locations.iter().filter(|v| v.fast).count(), started.elapsed().as_millis());
    assert!(!locations.is_empty());
    let base = std::env::temp_dir().join(format!("toolknit-auto-index-test-{}", std::process::id()));
    std::fs::create_dir(&base).unwrap();
    struct Cleanup(PathBuf);
    impl Drop for Cleanup { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); } }
    let _cleanup = Cleanup(base.clone());
    let policy = scope_policy::Policy::automatic(&base).unwrap().with_volumes(locations.iter().filter(|v| !v.remote).map(|v| (v.root.clone(), v.identity.clone())).collect());
    let roots = locations.iter().map(|v| v.root.clone()).collect::<Vec<_>>();
    let engine = index::Index::new(base.join("file-search/index.sqlite"));
    engine.start_policy(roots.clone(), true, policy.clone()).unwrap();
    let mut first = None;
    let until = Instant::now() + Duration::from_secs(360);
    loop {
        let status = engine.status();
        if first.is_none() && status.indexed > 0 { first = Some(started.elapsed().as_millis()); println!("AUTO_FIRST_RESULTS ms={}", first.unwrap()); }
        if ["ready", "partial", "error"].contains(&status.phase.as_str()) {
            println!("AUTO_INDEX elapsed_ms={} count={} skipped={} phase={} accelerated={} acceleration_error={:?}", started.elapsed().as_millis(), status.indexed, status.skipped, status.phase, status.accelerated, status.acceleration_error);
            assert!(status.error.is_none(), "{:?}", status.error);
            assert!(status.acceleration_error.is_none(), "{:?}", status.acceleration_error);
            break;
        }
        assert!(Instant::now() < until, "whole-machine metadata indexing exceeded deadline");
        std::thread::sleep(Duration::from_millis(250));
    }
    {
        let catalog = engine.shared.catalog.read().unwrap();
        assert!(!catalog.entries.is_empty());
        assert!(catalog.entries.iter().all(|e| !policy.excludes(&e.path)));
        for location in locations.iter().filter(|v| !v.remote) {
            assert!(catalog.entries.iter().any(|e| e.path.starts_with(&location.root)), "online local scope returned no visible files");
        }
        let query = query::Query { text: "合同".into(), ..Default::default() };
        let began = Instant::now();
        let result = query::search(&catalog.entries, &query, 50, || false).unwrap();
        println!("AUTO_QUERY ms={} rows={}", began.elapsed().as_millis(), result.rows.len());
    }
    engine.stop();
    // Reopen the same cache and protocol checkpoint without any installation.
    let resume = Instant::now(); engine.start_policy(roots, true, policy).unwrap();
    let until = Instant::now() + Duration::from_secs(180);
    loop {
        let status = engine.status();
        if ["ready", "partial", "error"].contains(&status.phase.as_str()) {
            println!("AUTO_RESUME ms={} count={} phase={}", resume.elapsed().as_millis(), status.indexed, status.phase);
            assert!(status.error.is_none() && status.acceleration_error.is_none()); break;
        }
        assert!(Instant::now() < until, "cache resume deadline");
        std::thread::sleep(Duration::from_millis(200));
    }
    engine.clear().unwrap();
}

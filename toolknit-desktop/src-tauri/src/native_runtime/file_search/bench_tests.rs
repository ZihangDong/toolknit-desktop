use super::{
    query::{self, Entry, Query, Sort},
    storage,
};
use std::{path::PathBuf, sync::Arc, time::Instant};

#[test]
#[ignore = "explicit separate-process cache restore memory probe"]
fn isolated_cache_restore_memory_probe() {
    assert!(!cfg!(debug_assertions), "use --release");
    let root = std::env::var_os("TOOLKNIT_SEARCH_CACHE_PROBE_ROOT").map(PathBuf::from)
        .expect("a dedicated synthetic cache directory is required");
    assert!(root.is_absolute());
    assert!(root.file_name().unwrap().to_string_lossy().starts_with("toolknit-cache-probe-"));
    let mode = std::env::var("TOOLKNIT_SEARCH_CACHE_PROBE_MODE").unwrap();
    assert!(["create", "collect", "stream", "cancel"].contains(&mode.as_str()));
    let source = PathBuf::from(r"C:\ToolKnit-Synthetic\cache-probe");
    let store = storage::Store::open(&root.join("index.sqlite")).unwrap();
    const COUNT: usize = 1_000_000;
    if mode == "create" {
        for start in (0..COUNT).step_by(4096) {
            store.transaction().unwrap();
            for i in start..(start + 4096).min(COUNT) {
                let parent: Arc<str> = source.join(format!("long-directory-name-{:04}-资料与合同", i % 512))
                    .to_string_lossy().as_ref().into();
                let name = format!("合同-{i}.pdf");
                let mut entry = Entry { id: 0, path: PathBuf::from(parent.as_ref()).join(&name).into(),
                    name, parent, extension: "pdf".into(), size: Some(i as u64), modified: None, verified: true };
                store.upsert(&mut entry, 1).unwrap();
            }
            store.commit().unwrap();
        }
        store.checkpoint().unwrap();
        println!("CACHE_PROBE created={COUNT}");
        return;
    }
    let start = Instant::now();
    let mut catalog = super::index::Catalog::default();
    if mode == "collect" {
        let rows = store.load(std::slice::from_ref(&source), || false).unwrap();
        for row in rows { catalog.insert(row); }
    } else if mode == "stream" {
        store.visit(std::slice::from_ref(&source), || false, |e| { catalog.insert(e); Ok(()) }).unwrap();
    } else {
        let consumed = std::cell::Cell::new(0);
        let outcome = store.visit(std::slice::from_ref(&source), || consumed.get() >= 10_000,
            |e| { catalog.insert(e); consumed.set(consumed.get() + 1); Ok(()) });
        assert_eq!(outcome.unwrap_err(), "file-search:cancelled");
        assert_eq!(consumed.get(), 10_000);
        println!("CACHE_PROBE cancelled_after={} elapsed_ms={}", consumed.get(), start.elapsed().as_millis());
        return;
    }
    assert_eq!(catalog.entries.len(), COUNT);
    assert_eq!(catalog.extensions.get("pdf"), Some(&COUNT));
    println!("CACHE_PROBE mode={mode} rows={COUNT} elapsed_ms={}", start.elapsed().as_millis());
    // A short observation window lets an external sampler capture retained
    // memory as well as the build peak. This binary owns only synthetic data.
    std::thread::sleep(std::time::Duration::from_secs(2));
    std::hint::black_box(catalog);
}

#[test]
#[ignore = "explicit release-mode synthetic performance measurement"]
fn synthetic_query_and_cache_benchmark() {
    assert!(!cfg!(debug_assertions), "run this benchmark with --release");
    for count in [100_000, 1_000_000] {
        let started = Instant::now();
        let parent: Arc<str> = "C:\\ToolKnit-Synthetic\\资料".into();
        let entries = (0..count)
            .map(|i| {
                let name = match i % 4 {
                    0 => format!("装修合同{i}.pdf"),
                    1 => format!("invoice-{i}.docx"),
                    2 => format!("image-{i}.png"),
                    _ => format!("notes-{i}.txt"),
                };
                Entry {
                    id: i + 1,
                    path: PathBuf::from(format!("{parent}\\{name}")).into(),
                    extension: query::extension(&name),
                    name,
                    parent: parent.clone(),
                    size: Some(i * 1024),
                    modified: Some(1_790_000_000 + i),
                    verified: true,
                }
            })
            .collect::<Vec<_>>();
        println!(
            "BENCH entries={count} construct_ms={}",
            started.elapsed().as_millis()
        );
        let extensions = entries.iter().fold(std::collections::BTreeMap::<String,usize>::new(), |mut map, e| { *map.entry(e.extension.clone()).or_default() += 1; map });
        for (term, ext, sort) in [
            ("", "", Sort::Relevance),
            ("合同", "", Sort::Relevance),
            ("hetong", "", Sort::Relevance),
            ("invoice-999", "", Sort::NameAsc),
            ("", "pdf", Sort::Newest),
            ("not-present", "", Sort::Relevance),
        ] {
            let query = Query {
                text: term.into(),
                extension: ext.into(),
                sort,
            };
            let mut times = Vec::new();
            for _ in 0..20 {
                let start = Instant::now();
                let result = query::search_with_metadata(&entries, &query, 50, None, Some(&extensions), || false).unwrap();
                std::hint::black_box(result);
                times.push(start.elapsed().as_secs_f64() * 1000.0);
            }
            times.sort_by(f64::total_cmp);
            println!(
                "BENCH entries={count} query={term:?} extension={ext:?} p50_ms={:.2} p95_ms={:.2}",
                times[10], times[18]
            );
        }
        let root = std::env::temp_dir().join(format!(
            "toolknit-synthetic-bench-{}-{count}",
            std::process::id()
        ));
        std::fs::create_dir(&root).unwrap();
        let store = storage::Store::open(&root.join("index.sqlite")).unwrap();
        let start = Instant::now();
        for chunk in entries.chunks(4096) {
            store.transaction().unwrap();
            for entry in chunk {
                store.upsert(&mut entry.clone(), 1).unwrap();
            }
            store.commit().unwrap();
        }
        store.checkpoint().unwrap();
        println!(
            "BENCH entries={count} cache_write_ms={} bytes={}",
            start.elapsed().as_millis(),
            std::fs::metadata(root.join("index.sqlite")).unwrap().len()
        );
        drop(store);
        let start = Instant::now();
        let store = storage::Store::open(&root.join("index.sqlite")).unwrap();
        let rows = store
            .load(&[PathBuf::from(parent.as_ref())], || false)
            .unwrap();
        assert_eq!(rows.len(), count as usize);
        println!(
            "BENCH entries={count} cache_reload_ms={}",
            start.elapsed().as_millis()
        );
        let mut catalog=super::index::Catalog::default();
        for row in rows {catalog.insert(row);}
        println!("BENCH entries={count} cache_collect_then_build_ms={}",start.elapsed().as_millis());
        drop(catalog);let start=Instant::now();
        let mut catalog=super::index::Catalog::default();
        let recovered=store.visit(&[PathBuf::from(parent.as_ref())],||false,|e|{catalog.insert(e);Ok(())}).unwrap();
        assert_eq!(recovered,count as usize);assert_eq!(catalog.entries.len(),count as usize);
        println!("BENCH entries={count} cache_stream_build_ms={}",start.elapsed().as_millis());
        drop(catalog);
        let start = Instant::now();
        let paths = entries.iter().take(2000).map(|e| e.path.clone()).collect::<Vec<_>>();
        for batch in paths.chunks(256) { store.remove_batch(batch).unwrap(); }
        println!("BENCH entries={count} delete_2000_ms={}", start.elapsed().as_millis());
        drop(store);
        // The fixed temporary directory was created above and contains only this test's database.
        std::fs::remove_dir_all(root).unwrap();
    }
}

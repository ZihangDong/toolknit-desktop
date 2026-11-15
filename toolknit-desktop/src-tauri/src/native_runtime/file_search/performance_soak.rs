//! Explicit sustained regression: synthetic sources and a separate metadata
//! database only. Does not install services or touch application preferences.
use super::*;
use super::super::query::{self, Query, Sort};

fn settled(index: &Index, expected: usize) {
    let deadline=Instant::now()+Duration::from_secs(15);
    loop {
        let state=index.status();
        if state.phase=="ready" && state.indexed==expected { return; }
        assert!(Instant::now()<deadline,"soak index did not settle: {} {} expected {}",state.phase,state.indexed,expected);
        std::thread::sleep(Duration::from_millis(30));
    }
}

#[test]
#[ignore = "explicit sustained release-mode synthetic index/query soak"]
fn sustained_search_and_incremental_lifecycle() {
    assert!(!cfg!(debug_assertions),"use --release");
    let seconds=std::env::var("TOOLKNIT_SEARCH_SOAK_SECONDS").ok().and_then(|v|v.parse::<u64>().ok()).unwrap_or(120).clamp(60,3600);
    let base=std::env::temp_dir().join(format!("toolknit-search-soak-{}",std::process::id()));
    std::fs::create_dir(&base).unwrap();
    struct Cleanup(PathBuf); impl Drop for Cleanup {fn drop(&mut self){let _=std::fs::remove_dir_all(&self.0);}}
    let _cleanup=Cleanup(base.clone());
    let source=base.join("source");std::fs::create_dir(&source).unwrap();
    for i in 0..2000 {std::fs::write(source.join(format!("合同{i}.txt")),b"synthetic original").unwrap();}
    let roots=normalize_roots(&[source.to_string_lossy().into_owned()]).unwrap();
    let index=Index::new(base.join("cache/index.sqlite"));index.start(roots.clone()).unwrap();settled(&index,2000);
    let mut synthetic=Catalog::default();
    for i in 0..250_000u64 {
        let parent:Arc<str>=format!("C:/ToolKnit-Synthetic/group{}",i%512).into();
        let name=if i%2==0{format!("合同{i}.pdf")}else{format!("invoice-{i}.docx")};
        synthetic.insert(Entry{id:i+1,path:PathBuf::from(format!("{parent}/{name}")).into(),extension:query::extension(&name),name,parent,size:Some(i*1024),modified:Some(1_790_000_000+i),verified:true});
    }
    println!("SOAK_START pid={} seconds={} metadata={} files={}",std::process::id(),seconds,synthetic.entries.len(),2000);
    let start=Instant::now();let mut iteration=0u64;let mut latencies=Vec::new();let mut max_cancel_us=0u128;let mut restarts=0;
    while start.elapsed()<Duration::from_secs(seconds) {
        let cycle=Instant::now();
        let text=["合同","hetong","invoice-99","group12","missing-term"][iteration as usize%5];
        let query=Query{text:text.into(),sort:[Sort::Relevance,Sort::NameAsc,Sort::Largest][iteration as usize%3],..Default::default()};
        let at=Instant::now();let result=query::search_with_metadata(&synthetic.entries,&query,50,None,Some(&synthetic.extensions),||false).unwrap();
        latencies.push(at.elapsed().as_secs_f64()*1000.0);
        assert!(result.rows.len()<=50);assert_eq!(result.extensions,["docx","pdf"]);
        let checks=std::cell::Cell::new(0);let at=Instant::now();
        let cancelled=query::search_with_metadata(&synthetic.entries,&query,50,None,Some(&synthetic.extensions),||{checks.set(checks.get()+1);checks.get()>3});
        assert_eq!(cancelled.unwrap_err(),"file-search:cancelled");max_cancel_us=max_cancel_us.max(at.elapsed().as_micros());
        let live=source.join("live.bin");let moved=source.join("renamed.bin");
        std::fs::write(&live,b"temporary synthetic event").unwrap();settled(&index,2001);
        std::fs::rename(&live,&moved).unwrap();
        let deadline=Instant::now()+Duration::from_secs(10);
        loop {
            let c=index.shared.catalog.read().unwrap();
            let valid=c.entries.iter().any(|e|e.name=="renamed.bin")&&!c.entries.iter().any(|e|e.name=="live.bin");drop(c);
            if valid {break;}assert!(Instant::now()<deadline,"rename not reflected");std::thread::sleep(Duration::from_millis(25));
        }
        std::fs::remove_file(&moved).unwrap();settled(&index,2000);
        {let c=index.shared.catalog.read().unwrap();assert_eq!(c.extensions.values().sum::<usize>(),c.entries.len());assert_eq!(c.entries.len(),c.ids.len());assert_eq!(c.entries.len(),c.paths.len());}
        if iteration>0&&iteration%60==0 {index.stop();index.start(roots.clone()).unwrap();settled(&index,2000);restarts+=1;}
        iteration+=1;
        if iteration%30==0 {println!("SOAK_PROGRESS elapsed_s={} cycles={} max_cancel_us={}",start.elapsed().as_secs(),iteration,max_cancel_us);}
        if let Some(left)=Duration::from_secs(1).checked_sub(cycle.elapsed()) {std::thread::sleep(left);}
    }
    let stop=Instant::now();index.stop();index.clear().unwrap();let stop_ms=stop.elapsed().as_millis();
    assert!(stop_ms<10_000);assert!(index.shared.catalog.read().unwrap().entries.is_empty());
    assert_eq!(std::fs::read(source.join("合同0.txt")).unwrap(),b"synthetic original");
    latencies.sort_by(f64::total_cmp);
    println!("SOAK_DONE elapsed_s={} cycles={} restarts={} query_p50_ms={:.3} query_p95_ms={:.3} max_cancel_us={} stop_ms={}",start.elapsed().as_secs(),iteration,restarts,latencies[latencies.len()/2],latencies[latencies.len()*95/100],max_cancel_us,stop_ms);
}

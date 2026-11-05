//! Explicit release-only measurement through the production bar/results WebViews.
//! Synthetic metadata stays in memory. No new command, production hook, files,
//! keyboard injection or Explorer action is added by this test module.
use super::*;
use std::{path::PathBuf, sync::Arc};

static SUBMISSION: Mutex<Option<(String, f64)>> = Mutex::new(None);
static NAVIGATION: AtomicU64 = AtomicU64::new(0);
pub(super) fn observe(invoke: &tauri::ipc::Invoke<tauri::Wry>) {
    if invoke.message.command() != "file_search" {
        return;
    }
    if let tauri::ipc::InvokeBody::Json(body) = invoke.message.payload() {
        if body["request"]["action"] == "navigate" {
            NAVIGATION.fetch_add(1, Ordering::AcqRel);
        }
        if body["request"]["action"] == "query" {
            if let Some(text) = body["request"]["text"].as_str() {
                let epoch = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_secs_f64()
                    * 1000.0;
                *lock(&SUBMISSION) = Some((text.into(), epoch));
            }
        }
    }
}

async fn eval(app: &tauri::AppHandle, label: &str, script: &str) -> Result<Value, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let sender = Mutex::new(Some(tx));
    app.get_webview_window(label)
        .ok_or("latency:missing-view")?
        .eval_with_callback(script, move |value| {
            if let Some(tx) = lock(&sender).take() {
                let _ = tx.send(value);
            }
        })
        .map_err(|_| "latency:eval")?;
    let value = tokio::time::timeout(Duration::from_secs(5), rx)
        .await
        .map_err(|_| "latency:eval-timeout")?
        .map_err(|_| "latency:eval-closed")?;
    serde_json::from_str(&value).map_err(|_| "latency:invalid-report".into())
}

pub(super) async fn measure(app: &tauri::AppHandle) -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Err("latency benchmark requires --release".into());
    }
    let state = app.state::<FileSearchState>();
    let previous = lock(&state.index).clone();
    let engine = Arc::new(index::Index::new(
        std::env::temp_dir().join("toolknit-unused-memory-benchmark.sqlite"),
    ));
    *lock(&state.index) = Some(engine.clone());
    let result = measure_inner(app, &engine).await;
    *lock(&state.index) = previous;
    *lock(&state.leases) = Default::default();
    result
}

async fn measure_inner(app: &tauri::AppHandle, engine: &index::Index) -> Result<(), String> {
    windows::set_expanded(app, true, false).await?;
    // Observe production DOM and native command receipt without replacing IPC.
    let deadline = Instant::now() + Duration::from_secs(5);
    while eval(app, BAR, "document.querySelector('.fs-input-row').inert").await? != false {
        if Instant::now() > deadline {
            return Err("latency:input-not-ready".into());
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    eval(app, RESULTS, r#"(() => {
      window.__searchLatency = {};
      new MutationObserver(() => {
        const probe = window.__searchLatency;
        if (!probe.expected || probe.ready) return;
        const row = document.querySelector('.fs-row');
        const name = row?.querySelector('.fs-file-name')?.textContent;
        const button = row?.querySelector('[data-fs-reveal]');
        if (!row || button?.disabled) probe.sawPending = true;
        if (probe.sawPending && name?.startsWith(probe.prefix) && button && !button.disabled) {
          probe.ready = performance.timeOrigin + performance.now();
          probe.rows = document.querySelectorAll('.fs-row').length;
        }
      }).observe(document.querySelector('.fs-list'), { childList:true, subtree:true, attributes:true });
      return true;
    })()"#).await?;
    for count in [100_000u64, 1_000_000u64] {
        {
            let mut catalog = engine.shared.catalog.write().unwrap();
            let generation = catalog.generation.wrapping_add(1);
            *catalog = index::Catalog::default();
            catalog.generation = generation;
            let parent: Arc<str> = r"C:\ToolKnit-Synthetic\资料".into();
            for i in 0..count {
                let name = match i % 4 {
                    0 => format!("装修合同{i}.pdf"),
                    1 => format!("invoice-{i}.docx"),
                    2 => format!("image-{i}.png"),
                    _ => format!("notes-{i}.txt"),
                };
                catalog.insert(query::Entry {
                    id: i + 1,
                    path: PathBuf::from(format!("{parent}\\{name}")).into(),
                    extension: query::extension(&name),
                    name,
                    parent: parent.clone(),
                    size: Some(i * 1024),
                    modified: Some(1_790_000_000 + i),
                    verified: true,
                });
            }
            catalog.generation += 1;
        }
        *lock(&engine.shared.status) = index::Status {
            phase: "ready".into(),
            indexed: count as usize,
            generation: engine.shared.catalog.read().unwrap().generation,
            ..Default::default()
        };
        let mut samples = Vec::new();
        // Five warmups, then 25 samples: Chinese, pinyin and three Latin queries.
        for round in 0..30 {
            let term = ["合同", "hetong", "invoice-999", "image-999", "notes-999"][round % 5];
            let prefix = [
                "装修合同",
                "装修合同",
                "invoice-999",
                "image-999",
                "notes-999",
            ][round % 5];
            let encoded = serde_json::to_string(term).unwrap();
            eval(
                app,
                RESULTS,
                &format!(
                    "window.__searchLatency = {{expected:{encoded},prefix:{}}}; true",
                    serde_json::to_string(prefix).unwrap()
                ),
            )
            .await?;
            *lock(&SUBMISSION) = None;
            NAVIGATION.store(0, Ordering::Release);
            eval(app, BAR, &format!(r#"(() => {{
                const input = document.querySelector('.fs-query');
                input.focus(); input.value = {encoded};
                window.__searchLatency = {{input:performance.timeOrigin + performance.now()}};
                input.dispatchEvent(new InputEvent('input', {{bubbles:true,inputType:'insertText',data:{encoded}}}));
                input.dispatchEvent(new KeyboardEvent('keydown', {{key:'Enter',bubbles:true,cancelable:true}}));
                return true;
            }})()"#)).await?;
            let deadline = Instant::now() + Duration::from_secs(10);
            let ready = loop {
                let report = eval(app, RESULTS, "window.__searchLatency").await?;
                if report["ready"].is_number() {
                    break report;
                }
                if Instant::now() >= deadline {
                    let detail = eval(app, RESULTS, "({probe:window.__searchLatency,count:document.querySelector('.fs-count').textContent,error:document.querySelector('.fs-message').textContent})").await?;
                    return Err(format!(
                        "latency:result-timeout count={count} term={term} detail={detail}"
                    ));
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            };
            let submitted = eval(app, BAR, "window.__searchLatency").await?;
            if NAVIGATION.load(Ordering::Acquire) != 0 {
                return Err("latency:pending-input-navigated-old-results".into());
            }
            let input_at = submitted["input"].as_f64().ok_or("latency:missing-input")?;
            let (submitted_term, query_at) =
                lock(&SUBMISSION).clone().ok_or("latency:missing-submit")?;
            if submitted_term != term {
                return Err("latency:wrong-submit".into());
            }
            let ready_at = ready["ready"].as_f64().ok_or("latency:missing-result")?;
            let total = ready_at - input_at;
            let processing = ready_at - query_at;
            if !(0.0..10_000.0).contains(&total)
                || !(0.0..10_000.0).contains(&processing)
                || ready["rows"].as_u64().unwrap_or(1000) > 30
            {
                return Err("latency:invalid-measurement".into());
            }
            if round >= 5 {
                samples.push((total, processing, query_at - input_at));
            }
        }
        for (name, column) in [
            ("input_to_usable", 0),
            ("native_receipt_to_usable", 1),
            ("input_to_native_receipt", 2),
        ] {
            let mut values: Vec<f64> = samples
                .iter()
                .map(|sample| match column {
                    0 => sample.0,
                    1 => sample.1,
                    _ => sample.2,
                })
                .collect();
            values.sort_by(f64::total_cmp);
            println!("WEBVIEW_LATENCY entries={count} samples={} metric={name} p50_ms={:.2} p95_ms={:.2}",
                values.len(), values[12], values[23]);
        }
    }
    // The real results WebView must keep its scroll offset across virtual row
    // replacement and appending the next native query page.
    eval(app, BAR, r#"(() => {
      const input = document.querySelector('.fs-query'); input.focus(); input.value = '合同';
      input.dispatchEvent(new InputEvent('input', {bubbles:true,inputType:'insertText',data:'合同'}));
      return true;
    })()"#).await?;
    let deadline = Instant::now() + Duration::from_secs(5);
    while eval(app, RESULTS, "!!document.querySelector('[data-fs-more]') && document.querySelector('.fs-file-name')?.textContent.startsWith('装修合同') && !!document.querySelector('[data-fs-reveal]:not(:disabled)')").await? != true {
        if Instant::now() > deadline { return Err("scroll:query-not-ready".into()); }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    for target in [740, 1480, 444, 1036, 2220] {
        eval(
            app,
            RESULTS,
            &format!("document.querySelector('.fs-list').scrollTop = {target}; true"),
        )
        .await?;
        tokio::time::sleep(Duration::from_millis(100)).await;
        let value = eval(app, RESULTS, "({top:document.querySelector('.fs-list').scrollTop,rows:document.querySelectorAll('.fs-row').length})").await?;
        if (value["top"].as_f64().unwrap_or(-1.0) - target as f64).abs() > 2.0
            || value["rows"].as_u64().unwrap_or(1000) > 30
        {
            return Err(format!("scroll:virtual-redraw-jumped {value}"));
        }
    }
    let before_more = eval(
        app,
        RESULTS,
        r#"(() => {
      const list=document.querySelector('.fs-list'); list.scrollTop=list.scrollHeight;
      return {top:list.scrollTop,height:list.scrollHeight};
    })()"#,
    )
    .await?;
    tokio::time::sleep(Duration::from_millis(100)).await;
    eval(
        app,
        RESULTS,
        "document.querySelector('[data-fs-more]').click(); true",
    )
    .await?;
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let value = eval(app, RESULTS, "({top:document.querySelector('.fs-list').scrollTop,height:document.querySelector('.fs-list').scrollHeight})").await?;
        if value["height"].as_f64() > before_more["height"].as_f64() {
            if (value["top"].as_f64().unwrap() - before_more["top"].as_f64().unwrap()).abs() > 2.0 {
                return Err("scroll:append-jumped".into());
            }
            break;
        }
        if Instant::now() > deadline {
            return Err("scroll:append-timeout".into());
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    eval(
        app,
        RESULTS,
        "document.querySelector('.fs-list').scrollTop = 1000000; true",
    )
    .await?;
    tokio::time::sleep(Duration::from_millis(100)).await;
    let last = eval(
        app,
        RESULTS,
        "Number([...document.querySelectorAll('[data-fs-row]')].at(-1)?.dataset.fsRow)",
    )
    .await?;
    if last.as_u64().unwrap_or(0) < 99 {
        return Err("scroll:second-page-unreachable".into());
    }
    println!(
        "WEBVIEW_SCROLL virtual scrolling, bottom reachability and native paging preserve position"
    );
    // A draft entered immediately before collapsing stays local. Opening again
    // publishes it once; the old committed query must not overwrite the input.
    eval(app, BAR, r#"(() => {
      const input = document.querySelector('.fs-query'); input.focus(); input.value = 'invoice-999';
      input.dispatchEvent(new InputEvent('input', {bubbles:true,inputType:'insertText',data:'invoice-999'}));
      return true;
    })()"#).await?;
    windows::set_expanded(app, false, false).await?;
    tokio::time::sleep(Duration::from_millis(220)).await;
    if lock(&app.state::<FileSearchState>().inner).query["text"] == "invoice-999" {
        return Err("latency:collapsed-draft-was-published".into());
    }
    if eval(app, BAR, "document.querySelector('.fs-query').value").await? != "invoice-999" {
        return Err("latency:collapsed-draft-was-lost".into());
    }
    windows::set_expanded(app, true, false).await?;
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let value = eval(app, RESULTS, "({name:document.querySelector('.fs-file-name')?.textContent,enabled:!!document.querySelector('[data-fs-reveal]:not(:disabled)')})").await?;
        if value["name"]
            .as_str()
            .is_some_and(|s| s.starts_with("invoice-999"))
            && value["enabled"] == true
        {
            break;
        }
        if Instant::now() > deadline {
            return Err("latency:reopened-draft-did-not-search".into());
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    println!("WEBVIEW_DRAFT collapse/reopen preserves text without hidden query; pending Enter suppressed");
    // Real native state broadcasts must not repaint unchanged lists or replay
    // animations. Count only our isolated test windows, never the installed app.
    tokio::time::sleep(Duration::from_millis(450)).await;
    for label in [BAR, RESULTS] {
        eval(app,label,r#"(() => {
          const root=document.getElementById('fileSearchRoot');
          window.__idlePaint={mutations:0,first:root.querySelector('.fs-row'),option:root.querySelector('.fs-extension option')};
          window.__idlePaint.observer=new MutationObserver(changes=>window.__idlePaint.mutations+=changes.length);
          window.__idlePaint.observer.observe(root,{childList:true,subtree:true,attributes:true,characterData:true});
          return true;
        })()"#).await?;
    }
    for _ in 0..100 {notify(app);}
    tokio::time::sleep(Duration::from_millis(1900)).await;
    for label in [BAR, RESULTS] {
        let report=eval(app,label,r#"(() => {
          const root=document.getElementById('fileSearchRoot'),probe=window.__idlePaint;probe.observer.disconnect();
          const value={mutations:probe.mutations,rowRetained:probe.first===root.querySelector('.fs-row'),optionRetained:probe.option===root.querySelector('.fs-extension option')};
          delete window.__idlePaint;return value;
        })()"#).await?;
        if report["mutations"]!=0 || report["rowRetained"]!=true || report["optionRetained"]!=true {
            return Err(format!("idle:unchanged-native-state-repainted {label} {report}"));
        }
        println!("WEBVIEW_IDLE surface={label} broadcasts=100 mutations=0 nodes_retained=true");
    }
    Ok(())
}

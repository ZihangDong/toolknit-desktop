//! Real hidden WebView2 -> capture controller -> IPC -> OCR/translation regression.
//! Explicit synthetic fixture and isolated APPDATA are required; no real desktop capture.
use super::*;
use serde_json::{json, Value};
use std::time::{Duration, Instant};

#[test]
#[ignore = "requires explicitly isolated APPDATA, synthetic PNG and installed OCR/translation models"]
fn screenshot_local_ocr_webview() {
    const TEST: &str = "native_runtime::quick_screenshot::native_ocr_tests::screenshot_local_ocr_webview";
    if std::env::var_os("TOOLKNIT_OCR_WEBVIEW_CHILD").is_none() {
        let root = std::env::var_os("TOOLKNIT_OCR_WEBVIEW_APPDATA").expect("explicit isolated test APPDATA");
        let mut child = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", TEST, "--ignored", "--nocapture", "--test-threads=1"])
            .env("TOOLKNIT_OCR_WEBVIEW_CHILD", "1").env("APPDATA", root)
            .stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).spawn().unwrap();
        let deadline = Instant::now() + Duration::from_secs(180);
        while child.try_wait().unwrap().is_none() {
            if Instant::now() > deadline { let _ = child.kill(); break; }
            std::thread::sleep(Duration::from_millis(40));
        }
        let output = child.wait_with_output().unwrap();
        assert!(output.status.success(), "{}\n{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
        print!("{}{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
        return;
    }
    let png = std::fs::read(std::env::var_os("TOOLKNIT_OCR_WEBVIEW_IMAGE").expect("explicit synthetic PNG")).unwrap();
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = "com.toolknit.screenshot-ocr-test".into();
    context.config_mut().app.windows.clear();
    let report = Arc::new(Mutex::new(None)); let result = report.clone();
    let app = tauri::Builder::default().any_thread()
        .manage(ScreenshotState::default()).manage(native_startup_tests::Fixture::from_png(png))
        .manage(super::super::local_ocr::runtime::OcrState::default())
        .manage(super::super::local_translation::TranslationState::default())
        .invoke_handler(tauri::generate_handler![quick_screenshot, quick_screenshot_image,
            super::super::local_ocr::runtime::local_ocr, super::super::local_translation::local_translation])
        .setup(move |app| {
            let app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let tested = exercise(&app).await;
                super::super::local_ocr::runtime::shutdown(&app);
                super::super::local_translation::shutdown(&app);
                *lock(&result) = Some(tested); app.exit(0);
            }); Ok(())
        }).build(context).unwrap();
    let running = report.clone();
    assert_eq!(app.run_return(move |_, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = event {
            if lock(&running).is_none() { api.prevent_exit(); }
        }
    }), 0);
    lock(&report).take().expect("OCR WebView result").unwrap();
}

async fn eval(window: &tauri::WebviewWindow, script: &str) -> Result<Value, String> {
    let (send, receive) = tokio::sync::oneshot::channel(); let send = Mutex::new(Some(send));
    window.eval_with_callback(script, move |value| { if let Some(send) = lock(&send).take() { let _ = send.send(value); } }).map_err(|_| "test:eval")?;
    let value = tokio::time::timeout(Duration::from_secs(4), receive).await.map_err(|_| "test:eval-timeout")?.map_err(|_| "test:eval-closed")?;
    serde_json::from_str(&value).map_err(|_| "test:eval-json".into())
}
async fn until(window: &tauri::WebviewWindow, script: &str) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        if eval(window, script).await? == true { return Ok(()); }
        if Instant::now() > deadline {
            let diagnostics = eval(window, "({toolbar:document.getElementById('shotToolbar')?.hidden,busy:document.getElementById('shotBusy')?.hidden,dialog:document.getElementById('shotDialogTitle')?.textContent,toasts:window.__qaToasts})").await?;
            return Err(format!("test:condition-timeout {script}: {diagnostics}"));
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}
async fn exercise(app: &tauri::AppHandle) -> Result<(), String> {
    lock(&app.state::<ScreenshotState>().inner).context = json!({"lang":"zh","theme":"light","provider":{}});
    begin(app).await?;
    let deadline = Instant::now() + Duration::from_secs(20);
    while !lock(&app.state::<ScreenshotState>().inner).session.as_ref().is_some_and(|s| s.ready) {
        if Instant::now() > deadline { return Err("test:capture-ready-timeout".into()); }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    let window = app.get_webview_window(CAPTURE_LABEL).ok_or("test:window")?;
    until(&window, "document.getElementById('shotCanvas')?.width>1 && document.getElementById('shotDesktop')?.naturalWidth>0").await?;
    // Scripted pointer events run against the production handlers in the hidden window.
    eval(&window, r#"(() => {
        window.__qaToasts=[];
        new MutationObserver(()=>{for(const e of document.querySelectorAll('.app-toast-message'))if(!window.__qaToasts.includes(e.textContent))window.__qaToasts.push(e.textContent);}).observe(document.getElementById('toastContainer'),{childList:true,subtree:true});
        HTMLCanvasElement.prototype.setPointerCapture=()=>{};
        const c=document.getElementById('shotCanvas'),r=c.getBoundingClientRect();
        for(const [type,x,y] of [['pointerdown',2,2],['pointermove',r.width-2,r.height-2],['pointerup',r.width-2,r.height-2]])
          c.dispatchEvent(new PointerEvent(type,{pointerId:1,button:0,clientX:x,clientY:y,bubbles:true}));
        document.querySelector('[data-shot-action="ocr"]').click(); return true;
    })()"#).await?;
    until(&window, "document.getElementById('shotDialog')?.classList.contains('visible') === true").await?;
    let result = eval(&window, "document.querySelector('#shotDialog textarea').value").await?;
    assert!(result.as_str().is_some_and(|text| text.chars().any(|c| ('\u{4e00}'..='\u{9fff}').contains(&c))), "synthetic Chinese fixture must be recognized");
    assert!(result.as_str().is_some_and(|text| text.contains("English OCR Test") && text.contains("ABC-123")), "CTC line spacing must survive the real screenshot formatter");
    println!("OCR_WEBVIEW real screenshot button -> session-bound IPC -> PP-OCR Chinese text passed");
    eval(&window, "(() => {document.getElementById('shotDialogOk').click();return true;})()").await?;
    until(&window, "document.getElementById('shotBusy').hidden && !document.querySelector('[data-shot-action=\"ai-translate\"]').disabled").await?;
    eval(&window, "(() => {document.querySelector('[data-shot-action=\"ai-translate\"]').click();return true;})()").await?;
    until(&window, "document.getElementById('shotBusy').hidden && (window.__qaToasts.some(e=>e.includes('翻译已覆盖')) || (document.getElementById('shotDialog').classList.contains('visible') && document.getElementById('shotDialogTitle').textContent.includes('翻译')))").await?;
    println!("OCR_WEBVIEW real local translation and overlay layout without AI key passed");
    let session = lock(&app.state::<ScreenshotState>().inner).session.as_ref().unwrap().id;
    // An expired session cannot invoke even the status action through real IPC.
    eval(&window, &format!(r#"(() => {{window.__ocrStale=null;window.__TAURI_INTERNALS__.invoke('local_ocr',{{request:{{action:'status',session:{}}}}}).then(()=>window.__ocrStale='allowed',e=>window.__ocrStale=String(e));return true;}})()"#, session+1)).await?;
    until(&window, "window.__ocrStale==='screenshot:expired'").await?;
    assert!(!window.is_visible().unwrap(), "QA must never activate or show the screenshot window");
    finish(app);
    until(&window, "document.getElementById('shotDesktop').getAttribute('src')===null && document.getElementById('shotCanvas').width===1").await?;
    println!("OCR_WEBVIEW stale-session denial and capture resource release passed");
    Ok(())
}

//! Exercise the real filter DOM and HWND close path without foreground input.
use super::*;
use ::windows::Win32::{Foundation::*, UI::WindowsAndMessaging::*};

async fn eval(app: &tauri::AppHandle, label: &str, script: &str) -> Result<Value, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let tx = Mutex::new(Some(tx));
    app.get_webview_window(label).ok_or("frame:view")?.eval_with_callback(script, move |value| {
        if let Some(tx) = lock(&tx).take() { let _ = tx.send(value); }
    }).map_err(|_| "frame:eval")?;
    let value = tokio::time::timeout(Duration::from_secs(4), rx).await
        .map_err(|_| "frame:timeout")?.map_err(|_| "frame:closed")?;
    serde_json::from_str(&value).map_err(|_| "frame:report".into())
}

pub(super) async fn exercise(app: &tauri::AppHandle) -> Result<(), String> {
    // Public handles are Send/Sync; clone/drop may race with GUI dispatch.
    // Protect the vendored runtime ownership fix against a dependency upgrade.
    let mut workers = Vec::new();
    for _ in 0..4 {
        let app = app.clone();
        workers.push(std::thread::spawn(move || {
            for _ in 0..4000 { std::hint::black_box(app.get_webview_window(BAR).unwrap()); }
        }));
    }
    for worker in workers { worker.join().map_err(|_| "frame:handle-lifetime")?; }
    for iteration in 0..100 {
        windows::set_expanded(app, true, false).await?;
        tokio::time::sleep(Duration::from_millis(65)).await;
        let index = iteration % 2;
        let value = eval(app, RESULTS, &format!(r#"(() => {{
            const b=document.querySelectorAll('.tool-custom-select-trigger')[{index}];
            if(!b || document.querySelector('.fs-card').inert) return false;
            b.click();
            const opened=b.getAttribute('aria-expanded')==='true';
            if({iteration}%3===0) document.querySelector('.tool-custom-select-menu:not([hidden]) [role=option]')?.click();
            return opened;
        }})()"#)).await?;
        if value != true { return Err(format!("frame:filter-not-open-{iteration}")); }
        windows::on_main(app, |host| {
            let hwnd = HWND(host.get_webview_window(RESULTS).ok_or("frame:window")?.hwnd().unwrap().0 as isize);
            unsafe {
                // Inspect the actual post-filter surface. Sending synthetic
                // activation messages would bypass USER32's focus transaction.
                let style = GetWindowLongW(hwnd, GWL_STYLE) as u32;
                let chrome = WS_CAPTION.0 | WS_THICKFRAME.0 | WS_MINIMIZEBOX.0 | WS_MAXIMIZEBOX.0 | WS_SYSMENU.0;
                if style & chrome != 0 {
                    return Err(format!("frame:native-chrome-after-filter style={style:08x}"));
                }
            }
            Ok(())
        }).await?;
        eval(app, BAR, "(() => {document.querySelector('.fs-collapse').click();return true;})()").await?;
        tokio::time::sleep(Duration::from_millis(210)).await;
        windows::on_main(app, |host| {
            let hwnd = HWND(host.get_webview_window(RESULTS).ok_or("frame:window")?.hwnd().unwrap().0 as isize);
            if unsafe { IsWindowVisible(hwnd).as_bool() } { return Err("frame:card-still-visible".into()); }
            Ok(())
        }).await?;
        if eval(app, RESULTS, "document.querySelectorAll('.tool-custom-select-menu:not([hidden])').length").await? != 0 {
            return Err("frame:filter-survived-collapse".into());
        }
    }
    println!("WEBVIEW_FRAME 100 filter/selection/collapse cycles: no native chrome, no visible result HWND or stale menu after collapse");
    Ok(())
}

use std::time::Instant;
use tauri::Manager;
use super::*;
static FLUSH_PENDING:AtomicBool=AtomicBool::new(false);

pub(super) struct FlagGuard<'a>(&'a AtomicBool);
impl<'a> FlagGuard<'a> {
    pub fn acquire(flag: &'a AtomicBool) -> Option<Self> {
        flag.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).ok().map(|_| Self(flag))
    }
}
impl Drop for FlagGuard<'_> {
    fn drop(&mut self) { self.0.store(false, Ordering::Release); }
}

pub(super) async fn capture_with_timeout(app: &tauri::AppHandle, deadline: std::time::Duration) -> Result<(Desktop, Vec<u8>), String> {
    let flag = app.state::<ScreenshotState>().capture_worker.clone();
    flag.compare_exchange(false,true,Ordering::AcqRel,Ordering::Acquire).map_err(|_| "screenshot:busy")?;
    let host=app.clone();
    let worker=tauri::async_runtime::spawn_blocking(move || {
        // The OS call cannot be forcibly cancelled. Keep its slot until it
        // actually returns so timeout/retry cannot accumulate blocked workers.
        let _slot=FlagGuard(&flag);
        capture_frame(&host)
    });
    tokio::time::timeout(deadline, worker).await.map_err(|_| "screenshot:capture-failed")?
        .map_err(|_| "screenshot:capture-failed")?
}

pub(super) async fn ensure_window(app: &tauri::AppHandle) -> Result<(), String> {
    let state=app.state::<ScreenshotState>();
    let _transition=state.capture_transition.lock().await;
    if app.get_webview_window(CAPTURE_LABEL).is_some() { return Ok(()); }
    state.capture_prepared.store(false, Ordering::Release);
    let window=window_builder(app,CAPTURE_LABEL,"capture")?.always_on_top(true)
        .skip_taskbar(true).shadow(false).resizable(false).focused(false)
        .build().map_err(|_|"screenshot:window-failed")?;
    let handle=app.clone();
    window.on_window_event(move|event| {
        if matches!(event,tauri::WindowEvent::Destroyed) {
            handle.state::<ScreenshotState>().capture_prepared.store(false,Ordering::Release);
            finish(&handle);
        }
    });
    Ok(())
}

pub(super) fn is_visible(window:&tauri::WebviewWindow)->bool {
    #[cfg(windows)]
    if let Ok(handle)=window.hwnd() {
        use windows::Win32::{Foundation::HWND,UI::WindowsAndMessaging::{IsWindowVisible,IsIconic}};
        return unsafe {IsWindowVisible(HWND(handle.0 as isize)).as_bool() && !IsIconic(HWND(handle.0 as isize)).as_bool()};
    }
    window.is_visible().unwrap_or(false)
}

pub(super) async fn settle_desktop(changed:bool) {
    if !changed { return; }
    let started=Instant::now();
    #[cfg(windows)]
    {
        let flushed=if !FLUSH_PENDING.swap(true,Ordering::AcqRel) {Some(tauri::async_runtime::spawn_blocking(|| {
            let result=unsafe {windows::Win32::Graphics::Dwm::DwmFlush().is_ok()};
            FLUSH_PENDING.store(false,Ordering::Release);result
        }))}else{None};
        if let Some(flushed)=flushed {if matches!(tokio::time::timeout(std::time::Duration::from_millis(160),flushed).await,Ok(Ok(true))) {
            // HWND visibility and WebView composition can finish on separate
            // queues. Keep a short presentation guard only after real hiding.
            tokio::time::sleep(std::time::Duration::from_millis(32).saturating_sub(started.elapsed())).await;
            return;
        }}
    }
    tokio::time::sleep(std::time::Duration::from_millis(160).saturating_sub(started.elapsed())).await;
}

pub(super) fn capture_frame(app: &tauri::AppHandle) -> Result<(super::Desktop, Vec<u8>), String> {
    #[cfg(all(test, windows))]
    if let Some(fixture) = app.try_state::<super::native_startup_tests::Fixture>() {
        return fixture.capture();
    }
    let _ = app;
    super::capture::capture()
}

pub(super) async fn show_ready(app: &tauri::AppHandle, window: &tauri::WebviewWindow, id:u64, timing:serde_json::Value) -> Result<(), String> {
    let (send,receive)=tokio::sync::oneshot::channel();let app=app.clone();let target=window.clone();
    window.run_on_main_thread(move|| {
        let result:Result<(),String>=(|| {
            let state=app.state::<ScreenshotState>();
            {
                let inner=lock(&state.inner);
                let session=inner.session.as_ref().filter(|s|s.id==id).ok_or("screenshot:expired")?;
                if session.ready {return Ok(());}
            }
            let visible={
            #[cfg(all(test, windows))]
            {app.try_state::<super::native_startup_tests::Fixture>().is_none()}
            #[cfg(not(all(test, windows)))]
            {true}
            };
            if visible {target.show().map_err(|_|"screenshot:window-failed")?;target.set_focus().map_err(|_|"screenshot:window-failed")?;}
            let mut inner=lock(&state.inner);
            if !inner.session.as_ref().is_some_and(|s|s.id==id) {
                let hide=inner.session.as_ref().is_none_or(|s|!s.ready);
                drop(inner);
                if visible&&hide {let _=target.hide();}
                return Err("screenshot:expired".into());
            }
            let session=inner.session.as_mut().unwrap();
            session.ready=true;session.trace.mark("shown");session.trace.finish(&timing);Ok(())
        })();let _=send.send(result);
    }).map_err(|_|"screenshot:window-failed")?;
    receive.await.map_err(|_|"screenshot:window-failed")?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn screenshot_gate_is_exclusive_and_released_on_unwind() {
        let flag=AtomicBool::new(false);
        let guard=FlagGuard::acquire(&flag).unwrap();
        assert!(FlagGuard::acquire(&flag).is_none());
        drop(guard);
        assert!(!flag.load(Ordering::Acquire));
        let _=std::panic::catch_unwind(|| { let _guard=FlagGuard::acquire(&flag).unwrap();panic!("synthetic task failure"); });
        assert!(!flag.load(Ordering::Acquire));
        assert!(FlagGuard::acquire(&flag).is_some());
    }
}

pub(super) struct Trace {
    started: Instant,
    stages: Vec<(&'static str, f64)>,
}
impl Trace {
    pub fn new() -> Self { Self { started: Instant::now(), stages: Vec::with_capacity(8) } }
    pub fn mark(&mut self, name: &'static str) {
        self.stages.push((name, self.started.elapsed().as_secs_f64() * 1000.0));
    }
    pub fn finish(&self, frontend: &serde_json::Value) {
        // Opt-in development measurements contain no pixels, text or paths.
        #[cfg(any(test, feature = "qa-devtools"))]
        if std::env::var_os("TOOLKNIT_SCREENSHOT_TIMING").is_some() {
            let values = ["boot", "module", "decode", "sample", "language", "editor", "ready"]
                .into_iter().filter_map(|key| frontend[key].as_f64()
                    .filter(|value| value.is_finite() && *value >= 0.0 && *value <= 60000.0)
                    .map(|value| (key, value))).collect::<Vec<_>>();
            eprintln!("SCREENSHOT_TIMING {}", serde_json::json!({"native":self.stages,"frontend":values}));
        }
        #[cfg(not(any(test, feature = "qa-devtools")))]
        let _ = frontend;
    }
}

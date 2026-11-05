use super::*;

pub(super) fn visible_bounds(app: &tauri::AppHandle, fallback: Rect) -> Rect {
    #[cfg(windows)]
    unsafe {
        use ::windows::Win32::{
            Foundation::HWND, Graphics::Gdi::*, UI::WindowsAndMessaging::GetWindowRect,
        };
        if let Some(window) = app.get_webview_window(BAR) {
            if let Ok(handle) = window.hwnd() {
                let hwnd = HWND(handle.0 as isize);
                let mut outer = Default::default();
                let mut bounds = Default::default();
                let region = CreateRectRgn(0, 0, 0, 0);
                if GetWindowRect(hwnd, &mut outer).is_ok()
                    && GetWindowRgn(hwnd, region).0 > 1
                    && GetRgnBox(region, &mut bounds).0 > 1
                {
                    let _ = DeleteObject(region);
                    let pad = window_shape::EDGE_FRINGE;
                    return Rect {
                        x: outer.left + bounds.left + pad,
                        y: outer.top + bounds.top + pad,
                        // CreateRoundRectRgn excludes its last coordinate; GetRgnBox
                        // already reports the resulting extent, without that +1.
                        width: (bounds.right - bounds.left - pad * 2).max(1) as u32,
                        height: (bounds.bottom - bounds.top - pad * 2).max(1) as u32,
                    };
                }
                let _ = DeleteObject(region);
            }
        }
    }
    fallback
}
fn clip(app: &tauri::AppHandle, bounds: Rect, canvas: Rect) -> Result<(), String> {
    #[cfg(windows)]
    unsafe {
        use ::windows::Win32::{Foundation::HWND, Graphics::Gdi::*};
        let window = app.get_webview_window(BAR).ok_or("file-search:window")?;
        let hwnd = HWND(window.hwnd().map_err(|_| "file-search:window")?.0 as isize);
        let x = bounds.x - canvas.x;
        let y = bounds.y - canvas.y;
        let region = window_shape::region(x, y, bounds.width, bounds.height, bounds.height as i32);
        if region.0 == 0 {
            return Err("file-search:window".into());
        }
        if SetWindowRgn(hwnd, region, true) == 0 {
            let _ = DeleteObject(region);
            return Err("file-search:window".into());
        }
    }
    #[cfg(not(windows))]
    let _ = (app, bounds, canvas);
    Ok(())
}
// Match the frontend cubic-bezier(.18,.88,.24,1); native hit area follows the
// visible capsule without resizing the WebView or sending per-frame IPC.
fn ease(x: f64) -> f64 {
    let (mut low, mut high) = (0.0, 1.0);
    for _ in 0..14 {
        let t = (low + high) / 2.0;
        let v = 0.54 * (1.0 - t) * (1.0 - t) * t + 0.72 * (1.0 - t) * t * t + t * t * t;
        if v < x {
            low = t;
        } else {
            high = t;
        }
    }
    let t = (low + high) / 2.0;
    2.64 * (1.0 - t) * (1.0 - t) * t + 3.0 * (1.0 - t) * t * t + t * t * t
}
pub(super) fn fade_results_out(app: &tauri::AppHandle, generation: u64) {
    let host = app.clone();
    let reduced = lock(&app.state::<FileSearchState>().inner).context["reducedMotion"]
        .as_bool()
        .unwrap_or(false);
    tauri::async_runtime::spawn(async move {
        if !reduced {
            tokio::time::sleep(std::time::Duration::from_millis(140)).await;
        }
        let _ = on_main(&host, move |app| {
            let state = app.state::<FileSearchState>();
            if state.generation.load(Ordering::Acquire) == generation
                && !lock(&state.inner).expanded
            {
                if let Some(card) = app.get_webview_window(RESULTS) {
                    hide_one(&card)?;
                }
            }
            Ok(())
        })
        .await;
    });
}
pub(super) fn begin(
    app: &tauri::AppHandle,
    generation: u64,
    from: Rect,
    to: Rect,
    canvas: Rect,
) -> Result<(), String> {
    #[cfg(windows)]
    if let Some(window) = app.get_webview_window(BAR) {
        let hwnd = ::windows::Win32::Foundation::HWND(
            window.hwnd().map_err(|_| "file-search:window")?.0 as isize,
        );
        crate::platform::window_shadow::configure(hwnd, 28, Some(false))
            .map_err(|_| "file-search:window")?;
    }
    let reduced = lock(&app.state::<FileSearchState>().inner).context["reducedMotion"]
        .as_bool()
        .unwrap_or(false);
    clip(app, if reduced { to } else { from }, canvas)?;
    let host = app.clone();
    tauri::async_runtime::spawn(async move {
        let start = std::time::Instant::now();
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(16)).await;
            let elapsed = start.elapsed().as_secs_f64();
            let finished = reduced || elapsed >= 0.32;
            let t = if finished { 1.0 } else { ease(elapsed / 0.32) };
            let mix = |a: f64, b: f64| (a + (b - a) * t).round();
            let rect = Rect {
                x: mix(from.x as f64, to.x as f64) as i32,
                y: mix(from.y as f64, to.y as f64) as i32,
                width: mix(from.width as f64, to.width as f64).max(1.0) as u32,
                height: mix(from.height as f64, to.height as f64).max(1.0) as u32,
            };
            let result = on_main(&host, move |app| {
                let state = app.state::<FileSearchState>();
                if state.generation.load(Ordering::Acquire) != generation || !allowed(&state) {
                    return Ok(false);
                }
                if finished {
                    apply(&app, generation, false)?;
                    if let Some(w) = app.get_webview_window(BAR) {
                        let _ = w.emit("file-search-settled", generation);
                    }
                } else {
                    clip(&app, rect, canvas)?;
                }
                Ok(true)
            })
            .await;
            if finished || !matches!(result, Ok(true)) {
                break;
            }
        }
    });
    Ok(())
}

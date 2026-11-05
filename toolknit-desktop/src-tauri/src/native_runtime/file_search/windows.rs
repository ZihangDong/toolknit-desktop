use super::*;
use geometry::{Layout, Rect};
use tauri::{PhysicalPosition, Position, WebviewUrl, WebviewWindowBuilder};
#[cfg(not(windows))]
use tauri::{PhysicalSize, Size};
#[path = "window_animation.rs"]
mod animation;
#[cfg(windows)]
#[path = "window_shape.rs"]
mod window_shape;
#[cfg(windows)]
#[path = "window_chrome.rs"]
mod window_chrome;

pub(super) async fn on_main<T: Send + 'static>(
    app: &tauri::AppHandle,
    f: impl FnOnce(tauri::AppHandle) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let host = app.clone();
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(f(host));
    })
    .map_err(|_| "file-search:window")?;
    rx.await.map_err(|_| "file-search:window")?
}
fn area(app: &tauri::AppHandle, anchor: Option<Rect>) -> Result<(Rect, f64, String), String> {
    #[cfg(test)]
    if std::env::var_os("TOOLKNIT_FILE_SEARCH_ISOLATED").is_some()
        && std::env::var_os("TOOLKNIT_FILE_SEARCH_VISUAL").is_none()
    {
        return Ok((
            Rect {
                x: -30000,
                y: -30000,
                width: 1200,
                height: 800,
            },
            1.0,
            "isolated-test".into(),
        ));
    }
    let point = anchor
        .map(|a| {
            (
                a.x as f64 + a.width as f64 / 2.0,
                a.y as f64 + a.height as f64 / 2.0,
            )
        })
        .or_else(|| app.cursor_position().ok().map(|p| (p.x, p.y)))
        .unwrap_or((0.0, 0.0));
    let monitors = app.available_monitors().map_err(|_| "file-search:window")?;
    let monitor = monitors
        .iter()
        .min_by_key(|m| {
            let a = m.work_area();
            let x = point.0.clamp(
                a.position.x as f64,
                a.position.x as f64 + a.size.width as f64,
            );
            let y = point.1.clamp(
                a.position.y as f64,
                a.position.y as f64 + a.size.height as f64,
            );
            ((x - point.0).powi(2) + (y - point.1).powi(2)) as u64
        })
        .ok_or("file-search:window")?;
    let a = monitor.work_area();
    Ok((
        Rect {
            x: a.position.x,
            y: a.position.y,
            width: a.size.width,
            height: a.size.height,
        },
        monitor.scale_factor(),
        monitor.name().cloned().unwrap_or_default(),
    ))
}
fn resolve(app: &tauri::AppHandle, expanded: bool) -> Result<Layout, String> {
    let state = app.state::<FileSearchState>();
    let s = lock(&state.inner);
    let mut anchor = s.anchor;
    if anchor.is_none() {
        if let Some(saved) = &s.preferences.anchor {
            if saved.x.is_finite() && saved.y.is_finite() {
                if let Some(m) = app
                    .available_monitors()
                    .ok()
                    .and_then(|ms| ms.into_iter().find(|m| m.name() == Some(&saved.monitor)))
                {
                    let a = m.work_area();
                    anchor = Some(Rect {
                        x: a.position.x + (saved.x.clamp(0.0, 1.0) * a.size.width as f64) as i32,
                        y: a.position.y + (saved.y.clamp(0.0, 1.0) * a.size.height as f64) as i32,
                        ..Rect::default()
                    });
                }
            }
        }
    }
    drop(s);
    let (a, scale, _) = area(app, anchor)?;
    Ok(geometry::layout(a, scale, anchor, expanded))
}
fn shape(
    window: &tauri::WebviewWindow,
    bounds: Rect,
    radius: f64,
    shadow: bool,
) -> Result<(), String> {
    #[cfg(windows)]
    unsafe {
        use ::windows::Win32::{
            Foundation::HWND,
            Graphics::Gdi::{DeleteObject, SetWindowRgn},
            UI::WindowsAndMessaging::{SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER},
        };
        let hwnd = HWND(window.hwnd().map_err(|_| "file-search:window")?.0 as isize);
        SetWindowPos(
            hwnd,
            HWND::default(),
            bounds.x,
            bounds.y,
            bounds.width as i32,
            bounds.height as i32,
            SWP_NOACTIVATE | SWP_NOZORDER,
        )
        .map_err(|_| "file-search:window")?;
        let scale = window.scale_factor().map_err(|_| "file-search:window")?;
        let d = (radius * scale * 2.0).round() as i32;
        let region = window_shape::region(0, 0, bounds.width, bounds.height, d);
        if region.0 == 0 {
            return Err("file-search:window".into());
        }
        if SetWindowRgn(hwnd, region, true) == 0 {
            let _ = DeleteObject(region);
            return Err("file-search:window".into());
        }
        crate::platform::window_shadow::configure(hwnd, radius as u32, Some(shadow))
            .map_err(|_| "file-search:window")?;
    }
    #[cfg(not(windows))]
    {
        let _ = (radius, shadow);
        window
            .set_size(Size::Physical(PhysicalSize::new(
                bounds.width,
                bounds.height,
            )))
            .map_err(|_| "file-search:window")?;
        window
            .set_position(Position::Physical(PhysicalPosition::new(
                bounds.x, bounds.y,
            )))
            .map_err(|_| "file-search:window")?;
    }
    Ok(())
}
fn show(window: &tauri::WebviewWindow, focus: bool) -> Result<(), String> {
    #[cfg(test)]
    let focus = focus
        && (std::env::var_os("TOOLKNIT_FILE_SEARCH_ISOLATED").is_none()
            || std::env::var_os("TOOLKNIT_FILE_SEARCH_VISUAL").is_some());
    if focus {
        window
            .show()
            .and_then(|_| window.set_focus())
            .map_err(|_| "file-search:window".into())
    } else {
        #[cfg(windows)]
        unsafe {
            use ::windows::Win32::{Foundation::HWND, UI::WindowsAndMessaging::*};
            SetWindowPos(
                HWND(window.hwnd().map_err(|_| "file-search:window")?.0 as isize),
                HWND::default(),
                0,
                0,
                0,
                0,
                SWP_SHOWWINDOW | SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER,
            )
            .map_err(|_| "file-search:window".into())
        }
        #[cfg(not(windows))]
        {
            window.show().map_err(|_| "file-search:window".into())
        }
    }
}
fn hide_one(window: &tauri::WebviewWindow) -> Result<(), String> {
    // Remove the visible native surface before the framework reconciles its
    // cached flags and triggers any non-client/window-style notifications.
    #[cfg(windows)]
    unsafe {
        use ::windows::Win32::{Foundation::HWND, UI::WindowsAndMessaging::*};
        SetWindowPos(HWND(window.hwnd().map_err(|_| "file-search:window")?.0 as isize),
            HWND::default(), 0, 0, 0, 0,
            SWP_HIDEWINDOW | SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOMOVE | SWP_NOSIZE)
            .map_err(|_| "file-search:window")?;
    }
    crate::platform::window_visibility::hide_on_main_thread(&window.as_ref().window())
        .map_err(|_| "file-search:window".into())
}
fn ensure(app: &tauri::AppHandle) -> Result<(), String> {
    let mut created = Vec::new();
    for (label, role, width, height) in [
        (BAR, "bar", 148.0, 48.0),
        (RESULTS, "results", 500.0, 406.0),
        (MENU, "menu", 300.0, 162.0),
    ] {
        if app.get_webview_window(label).is_some() {
            continue;
        }
        let dir = app
            .path()
            .app_config_dir()
            .map_err(|_| "file-search:window")?
            .join(format!("{label}-webview"));
        let built = WebviewWindowBuilder::new(
            app,
            label,
            WebviewUrl::App(format!("file-search.html?role={role}").into()),
        )
        .title("ToolKnit File Search")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .visible(false)
        .focused(false)
        .devtools(false)
        .data_directory(dir)
        .inner_size(width, height)
        .on_navigation(crate::platform::security::allow_webview_navigation)
        .build();
        let w = match built {
            Ok(w) => w,
            Err(_) => {
                for w in created {
                    let _: tauri::Result<()> = tauri::WebviewWindow::destroy(&w);
                }
                return Err("file-search:window".into());
            }
        };
        #[cfg(windows)]
        if window_chrome::configure(::windows::Win32::Foundation::HWND(
            w.hwnd().map_err(|_| "file-search:window")?.0 as isize,
        )).is_err() {
            let _ = w.destroy();
            for created_window in created { let _: tauri::Result<()> = tauri::WebviewWindow::destroy(&created_window); }
            return Err("file-search:window".into());
        }
        let events = w.clone();
        w.on_window_event(move |event| match event {
            tauri::WindowEvent::Focused(false) => lost_focus(&events),
            tauri::WindowEvent::Moved(_) if events.label() == BAR => moved(&events),
            tauri::WindowEvent::ScaleFactorChanged { .. } => moved(&events),
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let host = events.app_handle().clone();
                let menu = events.label() == MENU;
                tauri::async_runtime::spawn(async move {
                    if menu {
                        let _ = menu_close(&host, None).await;
                    } else {
                        let _ = hide(&host, true).await;
                    }
                });
            }
            tauri::WindowEvent::Destroyed => {
                lock(&events.state::<FileSearchState>().inner)
                    .ready
                    .remove(events.label());
                if [BAR, RESULTS].contains(&events.label()) {
                    pair_unavailable(events.app_handle());
                }
            }
            _ => {}
        });
        created.push(w);
    }
    Ok(())
}
// A missing or failed half must not leave an orphan input/results window.
// Preserve the saved enabled preference; the tool-page toggle can retry the
// pair immediately. Shutdown must never turn into an automatic recreation.
fn pair_unavailable(app: &tauri::AppHandle) {
    let state = app.state::<FileSearchState>();
    if state.stopping.load(Ordering::Acquire) {
        return;
    }
    state.generation.fetch_add(1, Ordering::AcqRel);
    {
        let mut s = lock(&state.inner);
        s.expanded = false;
        s.hidden = true;
        s.menu_token = None;
    }
    for label in [MENU, RESULTS, BAR] {
        if let Some(window) = app.get_webview_window(label) {
            let _ = hide_one(&window);
        }
    }
    notify(app);
}
fn apply(app: &tauri::AppHandle, generation: u64, focus: bool) -> Result<(), String> {
    let state = app.state::<FileSearchState>();
    if state.generation.load(Ordering::Acquire) != generation || !allowed(&state) {
        return Ok(());
    }
    let (layout, expanded, bar_ready, card_ready) = {
        let s = lock(&state.inner);
        (
            s.layout.clone().ok_or("file-search:window")?,
            s.expanded,
            s.ready.contains(BAR),
            s.ready.contains(RESULTS),
        )
    };
    state.adjusting.store(true, Ordering::Release);
    let result = (|| {
        let bar = app.get_webview_window(BAR).ok_or("file-search:window")?;
        let card = app
            .get_webview_window(RESULTS)
            .ok_or("file-search:window")?;
        shape(&bar, layout.bar, if expanded { 28.0 } else { 24.0 }, true)?;
        shape(&card, layout.card, 24.0, true)?;
        if expanded && bar_ready && card_ready {
            show(&card, false)?;
        } else {
            hide_one(&card)?;
        }
        if bar_ready {
            show(&bar, focus)?;
        }
        Ok(())
    })();
    state.adjusting.store(false, Ordering::Release);
    result
}
pub(super) async fn ready(app: &tauri::AppHandle, label: &str) -> Result<(), String> {
    let state = app.state::<FileSearchState>();
    let _transition = state.transition.lock().await;
    lock(&state.inner).ready.insert(label.to_owned());
    let generation = state.generation.load(Ordering::Acquire);
    on_main(app, move |host| {
        notify(&host);
        let result = apply(&host, generation, false).and_then(|_| show_menu(&host));
        if result.is_err() {
            pair_unavailable(&host);
        }
        result
    })
    .await
}
fn show_menu(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<FileSearchState>();
    if !allowed(&state) {
        return Ok(());
    }
    let s = lock(&state.inner);
    if s.menu_token.is_none() || !s.ready.contains(MENU) {
        return Ok(());
    }
    let anchor = s
        .layout
        .as_ref()
        .map(|l| l.bar)
        .ok_or("file-search:window")?;
    drop(s);
    let (work, scale, _) = area(app, Some(anchor))?;
    let cursor = app.cursor_position().ok();
    let bounds = geometry::clamp(
        work,
        Rect {
            x: cursor.map(|p| p.x as i32).unwrap_or(anchor.x),
            y: cursor.map(|p| p.y as i32).unwrap_or(anchor.bottom() as i32),
            width: (300.0 * scale) as u32,
            height: (162.0 * scale) as u32,
        },
    );
    let menu = app.get_webview_window(MENU).ok_or("file-search:window")?;
    shape(&menu, bounds, 16.0, true)?;
    show(&menu, true)
}
pub(super) async fn menu_open(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<FileSearchState>();
    let _guard = state.transition.lock().await;
    if !allowed(&state) {
        return Err("file-search:hidden".into());
    }
    let token = state.menu_generation.fetch_add(1, Ordering::AcqRel) + 1;
    let closing = {
        let mut s = lock(&state.inner);
        let closing = s.menu_token.is_some();
        s.menu_token = if closing { None } else { Some(token) };
        closing
    };
    let result = on_main(app, move |host| {
        ensure(&host)?;
        notify(&host);
        if closing {
            if let Some(w) = host.get_webview_window(MENU) {
                hide_one(&w)?;
            }
            Ok(())
        } else {
            show_menu(&host)
        }
    })
    .await;
    if result.is_err() {
        on_main(app, |host| {
            pair_unavailable(&host);
            Ok(())
        })
        .await?;
    }
    result
}
pub(super) async fn menu_close(app: &tauri::AppHandle, token: Option<u64>) -> Result<(), String> {
    let state = app.state::<FileSearchState>();
    let _guard = state.transition.lock().await;
    {
        let mut s = lock(&state.inner);
        if token.is_some() && s.menu_token != token {
            return Err("file-search:expired".into());
        }
        s.menu_token = None;
    }
    on_main(app, |host| {
        if let Some(w) = host.get_webview_window(MENU) {
            hide_one(&w)?;
        }
        notify(&host);
        Ok(())
    })
    .await
}
pub(super) async fn open_tool(app: &tauri::AppHandle) -> Result<(), String> {
    set_expanded(app, false, false).await?;
    on_main(app, |host| {
        super::super::show_main_window(&host);
        host.emit_to("main", "file-search-navigate", ())
            .map_err(|_| "file-search:window".into())
    })
    .await
}
pub(super) async fn set_expanded(
    app: &tauri::AppHandle,
    expanded: bool,
    focus: bool,
) -> Result<(), String> {
    transition_expanded(app, expanded, focus, None).await
}
pub(super) async fn restore_after_capture(
    app: &tauri::AppHandle,
    expanded: bool,
    capture_generation: u64,
) -> Result<(), String> {
    transition_expanded(app, expanded, false, Some(capture_generation)).await
}
async fn transition_expanded(
    app: &tauri::AppHandle,
    expanded: bool,
    focus: bool,
    expected_generation: Option<u64>,
) -> Result<(), String> {
    let state = app.state::<FileSearchState>();
    let _transition = state.transition.lock().await;
    // Recheck after acquiring the transition lock. A user collapse may have
    // completed while capture restoration was queued behind another task.
    if expected_generation
        .is_some_and(|expected| state.generation.load(Ordering::Acquire) != expected)
    {
        return Ok(());
    }
    if !allowed(&state) {
        return Err("file-search:hidden".into());
    }
    let generation = state.generation.fetch_add(1, Ordering::AcqRel) + 1;
    let layout = resolve(app, expanded)?;
    let was_expanded = {
        let mut s = lock(&state.inner);
        let old = s.expanded;
        s.expanded = expanded;
        s.anchor = Some(layout.anchor);
        s.layout = Some(layout.clone());
        old
    };
    if !expanded { let _=service::invalidate(app,1); }
    let result = on_main(app, move |host| {
        ensure(&host)?;
        let from = animation::visible_bounds(&host, layout.anchor);
        if !expanded && was_expanded {
            animation::fade_results_out(&host, generation);
            let canvas = host
                .get_webview_window(BAR)
                .and_then(|w| w.outer_position().ok())
                .map(|p| Rect {
                    x: p.x,
                    y: p.y,
                    ..from
                })
                .unwrap_or(from);
            animation::begin(&host, generation, from, layout.anchor, canvas)?;
            notify(&host);
            Ok(())
        } else {
            apply(&host, generation, focus)?;
            if expanded && !was_expanded {
                animation::begin(&host, generation, from, layout.bar, layout.bar)?;
            }
            notify(&host);
            Ok(())
        }
    })
    .await;
    if let Err(error) = result {
        on_main(app, |host| {
            pair_unavailable(&host);
            Ok(())
        })
        .await?;
        return Err(error);
    }
    Ok(())
}
pub(super) async fn hide(app: &tauri::AppHandle, until_restart: bool) -> Result<(), String> {
    let state = app.state::<FileSearchState>();
    let _transition = state.transition.lock().await;
    state.generation.fetch_add(1, Ordering::AcqRel);
    let _=service::invalidate(app,1);
    {
        let mut s = lock(&state.inner);
        if until_restart {
            s.hidden = true;
        }
        s.expanded = false;
        s.menu_token = None;
    }
    on_main(app, move |host| {
        for label in [MENU, RESULTS, BAR] {
            if let Some(w) = host.get_webview_window(label) {
                hide_one(&w)?;
            }
        }
        notify(&host);
        Ok(())
    })
    .await
}
fn group_has_focus(app: &tauri::AppHandle) -> bool {
    #[cfg(windows)]
    unsafe {
        use ::windows::Win32::UI::WindowsAndMessaging::{
            GetAncestor, GetForegroundWindow, GetWindow, GA_ROOT, GW_OWNER,
        };
        let mut hwnd = GetAncestor(GetForegroundWindow(), GA_ROOT);
        for _ in 0..8 {
            if hwnd.0 == 0 {
                return false;
            }
            if [BAR, RESULTS, MENU].iter().any(|label| {
                app.get_webview_window(label)
                    .and_then(|w| w.hwnd().ok())
                    .is_some_and(|h| h.0 as isize == hwnd.0)
            }) {
                return true;
            }
            hwnd = GetWindow(hwnd, GW_OWNER);
        }
        false
    }
    #[cfg(not(windows))]
    {
        [BAR, RESULTS, MENU].iter().any(|l| {
            app.get_webview_window(l)
                .is_some_and(|w| w.is_focused().unwrap_or(false))
        })
    }
}
fn lost_focus(window: &tauri::WebviewWindow) {
    let app = window.app_handle().clone();
    let generation = app
        .state::<FileSearchState>()
        .generation
        .load(Ordering::Acquire);
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        loop {
            let state = app.state::<FileSearchState>();
            if state.generation.load(Ordering::Acquire) != generation || !allowed(&state) {
                return;
            }
            {
                let s = lock(&state.inner);
                if !s.expanded && s.menu_token.is_none() {
                    return;
                }
            }
            if !pointer_down() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(40)).await;
        }
        if !group_has_focus(&app) {
            let _ = menu_close(&app, None).await;
            let _ = set_expanded(&app, false, false).await;
        }
    });
}
fn pointer_down() -> bool {
    #[cfg(windows)]
    unsafe {
        ::windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState(1) < 0
    }
    #[cfg(not(windows))]
    {
        false
    }
}
fn moved(window: &tauri::WebviewWindow) {
    let state = window.state::<FileSearchState>();
    if state.adjusting.load(Ordering::Acquire) || !allowed(&state) || !pointer_down() {
        return;
    }
    let revision = state.drag_generation.fetch_add(1, Ordering::AcqRel) + 1;
    let host = window.app_handle().clone();
    tauri::async_runtime::spawn(async move {
        // Move the paired card immediately while native dragging owns the pointer.
        let _ = on_main(&host, |app| {
            let state = app.state::<FileSearchState>();
            let mut s = lock(&state.inner);
            let bar = app.get_webview_window(BAR).ok_or("file-search:window")?;
            let position = bar.outer_position().map_err(|_| "file-search:window")?;
            let expanded = s.expanded;
            if let Some(l) = s.layout.as_mut() {
                let dx = position.x - l.bar.x;
                let dy = position.y - l.bar.y;
                l.bar.x = position.x;
                l.bar.y = position.y;
                l.anchor.x += dx;
                l.anchor.y += dy;
                l.card.x += dx;
                l.card.y += dy;
                if expanded {
                    if let Some(card) = app.get_webview_window(RESULTS) {
                        card.set_position(Position::Physical(PhysicalPosition::new(
                            l.card.x, l.card.y,
                        )))
                        .map_err(|_| "file-search:window")?;
                    }
                }
                let anchor = l.anchor;
                s.anchor = Some(anchor);
            }
            Ok(())
        })
        .await;
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(40)).await;
            let state = host.state::<FileSearchState>();
            if state.drag_generation.load(Ordering::Acquire) != revision || !allowed(&state) {
                return;
            }
            if !pointer_down() {
                break;
            }
        }
        let expanded = lock(&host.state::<FileSearchState>().inner).expanded;
        if settle_drag(&host, revision, expanded).await.is_err() {
            return;
        }
        let state = host.state::<FileSearchState>();
        let mut s = lock(&state.inner);
        if let Some(a) = s.anchor {
            if let Ok((work, _, monitor)) = area(&host, Some(a)) {
                s.preferences.anchor = Some(SavedAnchor {
                    monitor,
                    x: (a.x - work.x) as f64 / work.width.max(1) as f64,
                    y: (a.y - work.y) as f64 / work.height.max(1) as f64,
                });
                let _ = save_preferences(&host, &s.preferences);
            }
        }
    });
}

async fn settle_drag(app: &tauri::AppHandle, revision: u64, expanded: bool) -> Result<(), String> {
    let state = app.state::<FileSearchState>();
    let generation = state.generation.load(Ordering::Acquire);
    let target = resolve(app, expanded)?;
    let initial = lock(&state.inner)
        .layout
        .clone()
        .ok_or("file-search:window")?;
    let reduced = lock(&state.inner).context["reducedMotion"]
        .as_bool()
        .unwrap_or(false);
    let frames = if reduced { 1 } else { 13 };
    for frame in 1..=frames {
        if state.drag_generation.load(Ordering::Acquire) != revision
            || state.generation.load(Ordering::Acquire) != generation
            || !allowed(&state)
            || pointer_down()
        {
            return Err("file-search:cancelled".into());
        }
        let t = 1.0 - (1.0 - frame as f64 / frames as f64).powi(3);
        let interpolate = |a: Rect, b: Rect| Rect {
            x: (a.x as f64 + (b.x as f64 - a.x as f64) * t).round() as i32,
            y: (a.y as f64 + (b.y as f64 - a.y as f64) * t).round() as i32,
            ..a
        };
        let bar = interpolate(initial.bar, target.bar);
        let card = interpolate(initial.card, target.card);
        on_main(app, move |host| {
            let state = host.state::<FileSearchState>();
            if state.generation.load(Ordering::Acquire) != generation || !allowed(&state) {
                return Ok(());
            }
            state.adjusting.store(true, Ordering::Release);
            let result = (|| {
                for (label, rect) in [(BAR, bar), (RESULTS, card)] {
                    if let Some(window) = host.get_webview_window(label) {
                        window
                            .set_position(Position::Physical(PhysicalPosition::new(rect.x, rect.y)))
                            .map_err(|_| "file-search:window")?;
                    }
                }
                Ok(())
            })();
            state.adjusting.store(false, Ordering::Release);
            result
        })
        .await?;
        if frame < frames {
            tokio::time::sleep(std::time::Duration::from_millis(16)).await;
        }
    }
    set_expanded(app, expanded, false).await
}

pub(super) fn watch_work_area(app: &tauri::AppHandle) {
    let host = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut previous = None;
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            let state = host.state::<FileSearchState>();
            if state.stopping.load(Ordering::Acquire) {
                break;
            }
            if !allowed(&state) || pointer_down() {
                continue;
            }
            let (anchor, expanded) = {
                let s = lock(&state.inner);
                (s.anchor, s.expanded)
            };
            if let Ok((area, scale, monitor)) = area(&host, anchor) {
                let current = (area, scale, monitor);
                if previous.as_ref().is_some_and(|old| old != &current) {
                    let _ = set_expanded(&host, expanded, false).await;
                }
                previous = Some(current);
            }
        }
    });
}

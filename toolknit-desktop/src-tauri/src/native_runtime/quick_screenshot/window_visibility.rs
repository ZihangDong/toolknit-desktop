pub(super) async fn hide(window: &tauri::WebviewWindow) -> Result<(), String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let target = window.clone();
    window
        .run_on_main_thread(move || {
            let result = hide_on_main_thread(&target);
            let _ = sender.send(result);
        })
        .map_err(|_| "screenshot:window-hide-failed")?;
    receiver
        .await
        .map_err(|_| "screenshot:window-hide-failed")?
}

pub(super) fn hide_on_main_thread(window: &tauri::WebviewWindow) -> Result<(), String> {
    // Keep the framework cache hidden, then reconcile windows shown via Win32.
    window.hide().map_err(|_| "screenshot:window-hide-failed")?;
    #[cfg(windows)]
    hide_native(
        window
            .hwnd()
            .map_err(|_| "screenshot:window-hide-failed")?
            .0 as isize,
    )?;
    if window
        .is_visible()
        .map_err(|_| "screenshot:window-hide-failed")?
    {
        return Err("screenshot:window-hide-failed".into());
    }
    Ok(())
}

#[cfg(windows)]
fn hide_native(handle: isize) -> Result<(), String> {
    use windows::Win32::{
        Foundation::HWND,
        UI::WindowsAndMessaging::{
            IsWindow, IsWindowVisible, SetWindowPos, SWP_HIDEWINDOW, SWP_NOACTIVATE, SWP_NOMOVE,
            SWP_NOSIZE, SWP_NOZORDER,
        },
    };
    let window = HWND(handle);
    unsafe {
        if !IsWindow(window).as_bool() {
            return Err("screenshot:window-hide-failed".into());
        }
        SetWindowPos(
            window,
            HWND::default(),
            0,
            0,
            0,
            0,
            SWP_HIDEWINDOW | SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER,
        )
        .map_err(|_| "screenshot:window-hide-failed")?;
        if IsWindowVisible(window).as_bool() {
            return Err("screenshot:window-hide-failed".into());
        }
    }
    Ok(())
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[test]
    fn isolated_tao_window_hide_after_native_show() {
        const TEST: &str = "native_runtime::quick_screenshot::window_visibility::tests::isolated_tao_window_hide_after_native_show";
        if std::env::var_os("TOOLKNIT_VISIBILITY_ISOLATED_TEST").is_none() {
            let mut child = std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", TEST, "--test-threads=1", "--nocapture"])
                .env("TOOLKNIT_VISIBILITY_ISOLATED_TEST", "1")
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .spawn()
                .unwrap();
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
            while child.try_wait().unwrap().is_none() {
                if std::time::Instant::now() >= deadline {
                    let _ = child.kill();
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(25));
            }
            let result = child.wait_with_output().unwrap();
            assert!(
                result.status.success(),
                "{}\n{}",
                String::from_utf8_lossy(&result.stdout),
                String::from_utf8_lossy(&result.stderr)
            );
            return;
        }
        use tao::{
            event_loop::EventLoopBuilder,
            platform::windows::{EventLoopBuilderExtWindows, WindowExtWindows},
            window::WindowBuilder,
        };
        use windows::Win32::{Foundation::HWND, UI::WindowsAndMessaging::*};
        // Off-screen test windows in a child process; never read clipboard/app data.
        let event_loop = EventLoopBuilder::new().with_any_thread(true).build();
        for size in [(96, 96), (376, 760)] {
            let window = WindowBuilder::new()
                .with_visible(false)
                .with_focused(false)
                .with_decorations(false)
                .with_position(tao::dpi::PhysicalPosition::new(-32000, -32000))
                .with_inner_size(tao::dpi::LogicalSize::new(size.0, size.1))
                .build(&event_loop)
                .unwrap();
            let handle = HWND(window.hwnd());
            for iteration in 0..3 {
                unsafe {
                    SetWindowPos(
                        handle,
                        HWND::default(),
                        0,
                        0,
                        0,
                        0,
                        SWP_SHOWWINDOW | SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER,
                    )
                    .unwrap();
                }
                assert!(
                    window.is_visible(),
                    "native show iteration={iteration} style={:x}",
                    unsafe { GetWindowLongW(handle, GWL_STYLE) }
                );
                window.set_visible(false);
                assert!(
                    window.is_visible(),
                    "reproduce the stale framework cache: old hide is a no-op"
                );
                hide_native(handle.0).unwrap();
                assert!(
                    !window.is_visible(),
                    "the corrected path hides the actual OS window"
                );
                hide_native(handle.0).unwrap();
                assert!(!window.is_visible(), "repeated hide is idempotent");
            }
        }
        assert!(
            hide_native(0).is_err(),
            "invalid windows cannot report successful hiding"
        );
    }
}

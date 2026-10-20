//! Reconcile framework visibility with Windows no-activation restoration.
pub(crate) async fn hide(window: &tauri::Window) -> Result<(), String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let target = window.clone();
    window
        .run_on_main_thread(move || {
            let result = hide_on_main_thread(&target);
            let _ = sender.send(result);
        })
        .map_err(|_| "window:hide-failed")?;
    receiver.await.map_err(|_| "window:hide-failed")?
}

pub(crate) fn hide_on_main_thread(window: &tauri::Window) -> Result<(), String> {
    // Keep the framework cache hidden, then reconcile windows shown via Win32.
    window.hide().map_err(|_| "window:hide-failed")?;
    #[cfg(windows)]
    hide_native(window.hwnd().map_err(|_| "window:hide-failed")?.0 as isize)?;
    if window.is_visible().map_err(|_| "window:hide-failed")? {
        return Err("window:hide-failed".into());
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
            return Err("window:hide-failed".into());
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
        .map_err(|_| "window:hide-failed")?;
        if IsWindowVisible(window).as_bool() {
            return Err("window:hide-failed".into());
        }
    }
    Ok(())
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[test]
    fn isolated_tao_window_hide_after_native_show() {
        const TEST: &str =
            "platform::window_visibility::tests::isolated_tao_window_hide_after_native_show";
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
        use windows::Win32::System::Com::{
            CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED,
        };
        use windows::Win32::{Foundation::HWND, UI::WindowsAndMessaging::*};
        unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().unwrap();
        }
        // Off-screen test windows in a child process; never read clipboard/app data.
        let event_loop = EventLoopBuilder::new().with_any_thread(true).build();
        for size in [(96, 96), (376, 760), (1100, 700)] {
            let window = WindowBuilder::new()
                .with_visible(false)
                .with_focused(false)
                .with_decorations(false)
                .with_position(tao::dpi::PhysicalPosition::new(-32000, -32000))
                .with_inner_size(tao::dpi::LogicalSize::new(size.0, size.1))
                .build(&event_loop)
                .unwrap();
            let handle = HWND(window.hwnd());
            for iteration in 0..10 {
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
                let light_theme = iteration % 2 == 0;
                crate::platform::window_shadow::configure(handle, 18, Some(light_theme)).unwrap();
                let shadow = if light_theme {
                    let candidate = unsafe { GetWindow(handle, GW_HWNDNEXT) };
                    let mut name = [0_u16; 64];
                    let length = unsafe { GetClassNameW(candidate, &mut name) } as usize;
                    assert_eq!(
                        String::from_utf16_lossy(&name[..length]),
                        "ToolKnit.RoundedShadow"
                    );
                    assert!(unsafe { IsWindowVisible(candidate).as_bool() });
                    Some(candidate)
                } else {
                    None
                };
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
                if let Some(shadow) = shadow {
                    assert!(
                        !unsafe { IsWindowVisible(shadow).as_bool() },
                        "light-theme shadow hides with its owner"
                    );
                }
                hide_native(handle.0).unwrap();
                assert!(!window.is_visible(), "repeated hide is idempotent");
                window.set_visible(true);
                assert!(
                    window.is_visible(),
                    "framework show restores the hidden window"
                );
                window.set_visible(false);
                assert!(
                    !window.is_visible(),
                    "subsequent framework close remains usable"
                );
            }
        }
        assert!(
            hide_native(0).is_err(),
            "invalid windows cannot report successful hiding"
        );
        unsafe {
            CoUninitialize();
        }
    }
}

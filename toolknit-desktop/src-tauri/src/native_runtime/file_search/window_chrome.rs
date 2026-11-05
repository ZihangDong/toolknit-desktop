//! These small auxiliary HWNDs own their CSS animation and have no system frame.
//! Tao retains caption styles for normal borderless windows; active filter focus
//! can otherwise ask Windows/DWM to paint that frame during a transparent fade.
use std::mem::size_of;
use windows::Win32::{
    Foundation::{BOOL, HWND, LPARAM, LRESULT, WPARAM},
    Graphics::Dwm::{DwmIsCompositionEnabled, DwmSetWindowAttribute, DWMNCRP_DISABLED,
        DWMWA_NCRENDERING_POLICY, DWMWA_TRANSITIONS_FORCEDISABLED},
    UI::{Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass}, WindowsAndMessaging::*},
};
const ID: usize = 0x544b4653;
fn style(value: u32) -> u32 {
    value & !(WS_CAPTION.0 | WS_THICKFRAME.0 | WS_SYSMENU.0 | WS_MINIMIZEBOX.0 | WS_MAXIMIZEBOX.0)
}
fn ex_style(value: u32) -> u32 {
    value & !(WS_EX_WINDOWEDGE.0 | WS_EX_CLIENTEDGE.0 | WS_EX_DLGMODALFRAME.0)
}
unsafe extern "system" fn procedure(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM, _: usize, _: usize) -> LRESULT {
    match msg {
        WM_STYLECHANGING if lp.0 != 0 => {
            let change = &mut *(lp.0 as *mut STYLESTRUCT);
            if wp.0 as i32 == GWL_STYLE.0 { change.styleNew = style(change.styleNew); }
            if wp.0 as i32 == GWL_EXSTYLE.0 { change.styleNew = ex_style(change.styleNew); }
        }
        WM_NCCALCSIZE | WM_NCPAINT => return LRESULT(0),
        // Keep Tao's activation/focus notification; -1 suppresses only the
        // default non-client repaint, not the actual input/IME focus change.
        WM_NCACTIVATE => return DefSubclassProc(hwnd, msg, wp, LPARAM(-1)),
        WM_NCDESTROY => { let _ = RemoveWindowSubclass(hwnd, Some(procedure), ID); }
        _ => {}
    }
    DefSubclassProc(hwnd, msg, wp, lp)
}
pub(super) fn configure(hwnd: HWND) -> Result<(), String> {
    unsafe {
        if !SetWindowSubclass(hwnd, Some(procedure), ID, 0).as_bool() { return Err("file-search:window".into()); }
        if DwmIsCompositionEnabled().unwrap_or(BOOL(0)).as_bool() {
            let disabled = BOOL(1);
            DwmSetWindowAttribute(hwnd, DWMWA_TRANSITIONS_FORCEDISABLED, (&disabled as *const BOOL).cast(), size_of::<BOOL>() as u32)
                .map_err(|_| "file-search:window")?;
            let policy = DWMNCRP_DISABLED.0;
            DwmSetWindowAttribute(hwnd, DWMWA_NCRENDERING_POLICY, (&policy as *const i32).cast(), size_of::<i32>() as u32)
                .map_err(|_| "file-search:window")?;
        }
        SetWindowLongW(hwnd, GWL_STYLE, style(GetWindowLongW(hwnd, GWL_STYLE) as u32) as i32);
        SetWindowLongW(hwnd, GWL_EXSTYLE, ex_style(GetWindowLongW(hwnd, GWL_EXSTYLE) as u32) as i32);
        SetWindowPos(hwnd, HWND::default(), 0, 0, 0, 0,
            SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOMOVE | SWP_NOSIZE | SWP_FRAMECHANGED)
            .map_err(|_| "file-search:window")?;
    }
    Ok(())
}

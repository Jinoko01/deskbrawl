use std::ffi::c_void;

use tauri::Window;

const GWL_EXSTYLE: i32 = -20;
const SAFE_EXTENDED_STYLE: u32 = 0x0808_0020; // WS_EX_NOACTIVATE | WS_EX_LAYERED | WS_EX_TRANSPARENT
const SW_HIDE: i32 = 0;
const SW_SHOWNOACTIVATE: i32 = 4;

#[link(name = "user32")]
unsafe extern "system" {
    fn GetWindowLongW(window: *mut c_void, index: i32) -> i32;
    fn GetForegroundWindow() -> *mut c_void;
    fn ShowWindow(window: *mut c_void, command: i32) -> i32;
    fn IsWindowVisible(window: *mut c_void) -> i32;
}

pub fn verify(window: &Window) -> tauri::Result<()> {
    let hwnd = window.hwnd()?.0;
    // SAFETY: The borrowed Tauri window owns this HWND; no handle ownership is transferred.
    let safe = unsafe {
        GetWindowLongW(hwnd, GWL_EXSTYLE) as u32 & SAFE_EXTENDED_STYLE == SAFE_EXTENDED_STYLE
    };
    if !safe {
        return Err(std::io::Error::other(
            "Overlay lacks native click-through or no-activate flags",
        )
        .into());
    }
    Ok(())
}

pub fn show(window: &Window) -> tauri::Result<()> {
    verify(window)?;
    let hwnd = window.hwnd()?.0;
    // SAFETY: This is our live window on its UI thread. SW_SHOWNOACTIVATE never requests focus.
    unsafe {
        if GetForegroundWindow() == hwnd {
            return Err(std::io::Error::other("Overlay unexpectedly owns foreground focus").into());
        }
        ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        if IsWindowVisible(hwnd) == 0 || GetForegroundWindow() == hwnd {
            ShowWindow(hwnd, SW_HIDE);
            return Err(
                std::io::Error::other("Overlay could not be shown without activation").into(),
            );
        }
    }
    Ok(())
}

pub fn hide(window: &Window) -> tauri::Result<()> {
    let hwnd = window.hwnd()?.0;
    // SAFETY: The HWND is borrowed from this live Tauri window; SW_HIDE only changes visibility.
    unsafe {
        ShowWindow(hwnd, SW_HIDE);
        if IsWindowVisible(hwnd) != 0 {
            return Err(std::io::Error::other("Overlay remained visible after hiding").into());
        }
    }
    Ok(())
}

use std::ffi::c_void;

use tauri::{Manager, PhysicalPosition, PhysicalSize, Window};

const GWL_EXSTYLE: i32 = -20;
const SAFE_EXTENDED_STYLE: u32 = 0x0808_00a0; // NOACTIVATE | LAYERED | TRANSPARENT | TOOLWINDOW
const SW_HIDE: i32 = 0;
const SW_SHOWNOACTIVATE: i32 = 4;
const SW_MINIMIZE: i32 = 6;
const SW_RESTORE: i32 = 9;
const WM_HOTKEY: u32 = 0x0312;
const PLAY_HOTKEY: i32 = 1;
const MOD_NOREPEAT: u32 = 0x4000;

#[link(name = "user32")]
unsafe extern "system" {
    fn GetWindowLongW(window: *mut c_void, index: i32) -> i32;
    fn SetWindowLongW(window: *mut c_void, index: i32, value: i32) -> i32;
    fn GetForegroundWindow() -> *mut c_void;
    fn SetForegroundWindow(window: *mut c_void) -> i32;
    fn IsWindow(window: *mut c_void) -> i32;
    fn IsIconic(window: *mut c_void) -> i32;
    fn RegisterHotKey(window: *mut c_void, id: i32, modifiers: u32, key: u32) -> i32;
    fn UnregisterHotKey(window: *mut c_void, id: i32) -> i32;
    fn ShowWindow(window: *mut c_void, command: i32) -> i32;
    fn IsWindowVisible(window: *mut c_void) -> i32;
    fn DestroyWindow(window: *mut c_void) -> i32;
    fn SetWindowPos(
        window: *mut c_void,
        after: *mut c_void,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
        flags: u32,
    ) -> i32;
    fn RegisterWindowMessageW(name: *const u16) -> u32;
}

type SubclassProc =
    unsafe extern "system" fn(*mut c_void, u32, usize, isize, usize, usize) -> isize;

#[link(name = "comctl32")]
unsafe extern "system" {
    fn SetWindowSubclass(
        window: *mut c_void,
        callback: SubclassProc,
        id: usize,
        data: usize,
    ) -> i32;
    fn RemoveWindowSubclass(window: *mut c_void, callback: SubclassProc, id: usize) -> i32;
    fn DefSubclassProc(window: *mut c_void, message: u32, wparam: usize, lparam: isize) -> isize;
}

pub fn place(
    window: &Window,
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
) -> tauri::Result<()> {
    let width = i32::try_from(size.width).map_err(std::io::Error::other)?;
    let height = i32::try_from(size.height).map_err(std::io::Error::other)?;
    // SAFETY: Our HWND is live on its UI thread. Coordinates and dimensions are
    // physical monitor pixels. NOZORDER | NOACTIVATE preserves focus and stacking.
    if unsafe {
        SetWindowPos(
            window.hwnd()?.0,
            std::ptr::null_mut(),
            position.x,
            position.y,
            width,
            height,
            0x0014,
        )
    } == 0
    {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(())
}

struct DisplayWatch {
    app: tauri::AppHandle,
    taskbar_created: u32,
}

pub fn watch_display(window: &Window) -> tauri::Result<()> {
    let hwnd = window.hwnd()?.0;
    let name: Vec<u16> = "TaskbarCreated\0".encode_utf16().collect();
    // SAFETY: name is NUL terminated and remains live throughout this call.
    let taskbar_created = unsafe { RegisterWindowMessageW(name.as_ptr()) };
    if taskbar_created == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    let watch = Box::new(DisplayWatch {
        app: window.app_handle().clone(),
        taskbar_created,
    });
    let data = Box::into_raw(watch);
    // SAFETY: Installation runs on the HWND's UI thread exactly once per window.
    // Ownership transfers to the subclass only on success, ending at WM_NCDESTROY.
    if unsafe { SetWindowSubclass(hwnd, display_proc, 1, data as usize) } == 0 {
        unsafe {
            drop(Box::from_raw(data));
        }
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(())
}

unsafe extern "system" fn display_proc(
    hwnd: *mut c_void,
    message: u32,
    wparam: usize,
    lparam: isize,
    id: usize,
    data: usize,
) -> isize {
    // SAFETY: data belongs to this subclass until its WM_NCDESTROY callback;
    // callbacks are serialized on the owning UI thread, and never unwind.
    let watch = unsafe { &*(data as *const DisplayWatch) };
    if message == 0x007e
        || message == 0x02e0
        || message == watch.taskbar_created
        || (message == 0x001a && wparam == 0x002f)
        || (message == 0x0218 && (wparam == 4 || wparam == 18))
    {
        // Hide synchronously before passing a DPI/display/shell notification on.
        // Only this app's own HWND is affected; recovery requires the tray menu.
        if crate::overlay::display_changed(&watch.app) {
            unsafe {
                ShowWindow(hwnd, SW_HIDE);
                if IsWindowVisible(hwnd) != 0 && DestroyWindow(hwnd) == 0 {
                    std::process::exit(1);
                }
            }
        }
    }
    if message == 0x0082 {
        unsafe {
            RemoveWindowSubclass(hwnd, display_proc, id);
            drop(Box::from_raw(data as *mut DisplayWatch));
        }
    }
    unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
}

// The only global shortcut is registered to main's HWND, so WM_HOTKEY arrives on
// main's UI thread, and Windows grants this process foreground rights for it.
pub fn watch_play_hotkey(window: &Window) -> tauri::Result<()> {
    let hwnd = window.hwnd()?.0;
    let data = Box::into_raw(Box::new(window.app_handle().clone()));
    // SAFETY: Installation runs on main's UI thread once. Ownership of data
    // transfers to the subclass on success and ends at WM_NCDESTROY.
    if unsafe { SetWindowSubclass(hwnd, hotkey_proc, 2, data as usize) } == 0 {
        unsafe { drop(Box::from_raw(data)) };
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(())
}

// Replaces the toggle shortcut. On failure no shortcut stays registered; the
// caller decides whether to restore the previous one. Must run on main's UI thread.
pub fn register_play_hotkey(window: &Window, modifiers: u32, key: u32) -> tauri::Result<()> {
    let hwnd = window.hwnd()?.0;
    // SAFETY: hwnd is main's live HWND and this is its creating thread, as
    // RegisterHotKey requires. Unregistering an absent id is harmless.
    unsafe {
        UnregisterHotKey(hwnd, PLAY_HOTKEY);
        if RegisterHotKey(hwnd, PLAY_HOTKEY, modifiers | MOD_NOREPEAT, key) == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
    }
    Ok(())
}

// The tray fallback for when the shortcut is unavailable. Must run on main's UI thread.
pub fn toggle_play_from(window: &Window) -> tauri::Result<()> {
    let hwnd = window.hwnd()?.0;
    // SAFETY: hwnd is main's live HWND and this runs on its UI thread.
    unsafe { toggle_play(window.app_handle(), hwnd) };
    Ok(())
}

unsafe extern "system" fn hotkey_proc(
    hwnd: *mut c_void,
    message: u32,
    wparam: usize,
    lparam: isize,
    id: usize,
    data: usize,
) -> isize {
    // SAFETY: data belongs to this subclass until its WM_NCDESTROY callback;
    // callbacks are serialized on main's UI thread, and never unwind.
    let app = unsafe { &*(data as *const tauri::AppHandle) };
    if message == WM_HOTKEY && wparam == PLAY_HOTKEY as usize {
        unsafe { toggle_play(app, hwnd) };
        return 0;
    }
    if message == 0x0082 {
        unsafe {
            UnregisterHotKey(hwnd, PLAY_HOTKEY);
            RemoveWindowSubclass(hwnd, hotkey_proc, id);
            drop(Box::from_raw(data as *mut tauri::AppHandle));
        }
    }
    unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
}

// SAFETY: main is the live main HWND and this runs on its UI thread.
unsafe fn toggle_play(app: &tauri::AppHandle, main: *mut c_void) {
    if crate::overlay::focused(app) || !crate::network::play_allowed(app) {
        return;
    }
    let foreground = unsafe { GetForegroundWindow() };
    if foreground == main && crate::local_game::playing(app) {
        unsafe { return_focus_to(main, crate::local_game::take_previous(app)) };
        return;
    }
    // Remember the work window to return to; none when main was already in front.
    crate::local_game::remember_previous(
        app,
        if foreground == main {
            0
        } else {
            foreground as isize
        },
    );
    unsafe {
        if IsIconic(main) != 0 || IsWindowVisible(main) == 0 {
            ShowWindow(main, SW_RESTORE);
        }
        if SetForegroundWindow(main) == 0 {
            eprintln!("Could not focus the control window for PLAY");
            return;
        }
    }
    crate::local_game::request_play(app);
}

// SAFETY: main must be the live main HWND, called on its UI thread while it is foreground.
// previous is an untrusted handle value that may have been destroyed since; it is only
// validated and activated, never dereferenced.
unsafe fn return_focus_to(main: *mut c_void, previous: isize) {
    let target = previous as *mut c_void;
    let restored = previous != 0
        && unsafe {
            IsWindow(target) != 0
                && IsWindowVisible(target) != 0
                && SetForegroundWindow(target) != 0
        };
    if !restored {
        // Minimizing hands focus to the next window instead of keeping game input.
        unsafe { ShowWindow(main, SW_MINIMIZE) };
    }
}

// A minimized window can remain the foreground window, yet the user cannot play in it.
pub fn is_foreground(window: &Window) -> tauri::Result<bool> {
    let hwnd = window.hwnd()?.0;
    // SAFETY: hwnd is borrowed from the live Tauri window; both calls only read state.
    Ok(unsafe { GetForegroundWindow() == hwnd && IsIconic(hwnd) == 0 })
}

pub fn return_focus(window: &Window, previous: isize) -> tauri::Result<()> {
    let hwnd = window.hwnd()?.0;
    // SAFETY: Callers run on main's UI thread while main is foreground.
    unsafe { return_focus_to(hwnd, previous) };
    Ok(())
}

pub fn verify(window: &Window) -> tauri::Result<()> {
    let hwnd = window.hwnd()?.0;
    // SAFETY: The borrowed Tauri window owns this HWND; no handle ownership is transferred.
    let safe = unsafe {
        let style = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
        style & SAFE_EXTENDED_STYLE == SAFE_EXTENDED_STYLE && style & 0x0004_0000 == 0
    };
    if !safe {
        return Err(std::io::Error::other(
            "Overlay lacks native click-through or no-activate flags",
        )
        .into());
    }
    Ok(())
}

pub fn prepare(window: &Window) -> tauri::Result<()> {
    let hwnd = window.hwnd()?.0;
    // SAFETY: The live HWND belongs to this UI thread. Extended styles are 32-bit
    // values, not pointers. TOOLWINDOW and absence of APPWINDOW exclude taskbar/Alt+Tab.
    unsafe {
        let style = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
        if SetWindowLongW(hwnd, GWL_EXSTYLE, ((style & !0x0004_0000) | 0x80) as i32) == 0
            || SetWindowPos(hwnd, std::ptr::null_mut(), 0, 0, 0, 0, 0x0037) == 0
        {
            return Err(std::io::Error::last_os_error().into());
        }
    }
    verify(window)
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

use crate::drag::{DragRegions, Region};
use std::{
    cell::RefCell,
    ffi::c_void,
    sync::atomic::{AtomicU32, Ordering},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};

#[repr(C)]
struct MouseEvent {
    point: [i32; 2],
    mouse_data: u32,
    flags: u32,
    time: u32,
    extra: usize,
}

#[repr(C)]
#[derive(Default)]
struct Message {
    window: *mut c_void,
    kind: u32,
    wparam: usize,
    lparam: isize,
    time: u32,
    point: [i32; 2],
    private: u32,
}

#[link(name = "user32")]
unsafe extern "system" {
    fn SetWindowsHookExW(
        kind: i32,
        callback: unsafe extern "system" fn(i32, usize, isize) -> isize,
        module: *mut c_void,
        thread: u32,
    ) -> *mut c_void;
    fn UnhookWindowsHookEx(hook: *mut c_void) -> i32;
    fn CallNextHookEx(hook: *mut c_void, code: i32, message: usize, data: isize) -> isize;
    fn GetMessageW(message: *mut Message, window: *mut c_void, first: u32, last: u32) -> i32;
    fn PeekMessageW(
        message: *mut Message,
        window: *mut c_void,
        first: u32,
        last: u32,
        remove: u32,
    ) -> i32;
    fn PostThreadMessageW(thread: u32, kind: u32, wparam: usize, lparam: isize) -> i32;
}

#[link(name = "kernel32")]
unsafe extern "system" {
    fn GetCurrentThreadId() -> u32;
    fn GetModuleHandleW(name: *const u16) -> *mut c_void;
}

static THREAD: AtomicU32 = AtomicU32::new(0);
thread_local! {
    static CAPTURE: RefCell<Option<Capture>> = const { RefCell::new(None) };
}

struct Capture {
    app: AppHandle,
    hook: *mut c_void,
    active: Option<(Region, [i32; 2])>,
    cancelled: bool,
    last_move: Instant,
}

impl Drop for Capture {
    fn drop(&mut self) {
        // SAFETY: This message-loop thread owns the live hook and removes it once.
        unsafe { UnhookWindowsHookEx(self.hook) };
        self.app
            .state::<DragRegions>()
            .available
            .store(false, Ordering::SeqCst);
    }
}

pub fn start(app: &AppHandle) -> tauri::Result<()> {
    let app = app.clone();
    std::thread::Builder::new()
        .name("character-drag".into())
        .spawn(move || {
            if let Err(error) = run(&app) {
                eprintln!("Character drag unavailable: {error}");
            }
            THREAD.store(0, Ordering::SeqCst);
        })?;
    Ok(())
}

pub fn stop() {
    let thread = THREAD.swap(0, Ordering::SeqCst);
    if thread != 0 {
        // SAFETY: The published thread owns a message queue; WM_QUIT releases its hook.
        if unsafe { PostThreadMessageW(thread, 0x12, 0, 0) } == 0 {
            eprintln!(
                "Could not stop character drag: {}",
                std::io::Error::last_os_error()
            );
        }
    }
}

fn run(app: &AppHandle) -> std::io::Result<()> {
    let mut message = Message::default();
    // SAFETY: MSG is initialized and writable. PeekMessage creates this thread's queue.
    let thread = unsafe {
        PeekMessageW(&mut message, std::ptr::null_mut(), 0, 0, 0);
        GetCurrentThreadId()
    };
    // SAFETY: WH_MOUSE_LL runs on this dedicated pumping thread; the callback and
    // executable module remain live until Capture removes the hook at thread exit.
    let hook = unsafe { SetWindowsHookExW(14, mouse_proc, GetModuleHandleW(std::ptr::null()), 0) };
    if hook.is_null() {
        return Err(std::io::Error::last_os_error());
    }
    CAPTURE.with(|capture| {
        *capture.borrow_mut() = Some(Capture {
            app: app.clone(),
            hook,
            active: None,
            cancelled: false,
            last_move: Instant::now(),
        })
    });
    app.state::<DragRegions>()
        .available
        .store(true, Ordering::SeqCst);
    THREAD.store(thread, Ordering::SeqCst);
    loop {
        // SAFETY: MSG remains writable for this call; this thread owns no windows.
        match unsafe { GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) } {
            -1 => return Err(std::io::Error::last_os_error()),
            0 => return Ok(()),
            _ => {}
        }
    }
}

fn contains(region: &Region, point: [i32; 2]) -> bool {
    let [left, top, right, bottom] = region.rect;
    (left..=right).contains(&f64::from(point[0])) && (top..=bottom).contains(&f64::from(point[1]))
}

unsafe extern "system" fn mouse_proc(code: i32, message: usize, data: isize) -> isize {
    if code < 0 || !matches!(message, 0x200..=0x202) {
        // SAFETY: Notifications outside our left-button gesture remain unchanged.
        return unsafe { CallNextHookEx(std::ptr::null_mut(), code, message, data) };
    }
    // SAFETY: HC_ACTION provides a live MSLLHOOKSTRUCT for this callback's duration.
    let event = unsafe { &*(data as *const MouseEvent) };
    let mut notification = None;
    let consumed = CAPTURE.with(|state| {
        let mut state = state.borrow_mut();
        let Some(capture) = state.as_mut() else {
            return false;
        };
        let regions = capture.app.state::<DragRegions>();
        let Ok(regions) = regions.regions.try_lock() else {
            let consumed = capture.active.is_some();
            if message == 0x202 {
                capture.active = None;
            }
            return consumed;
        };
        let enabled = !crate::local_game::playing(&capture.app)
            && !crate::local_game::capturing(&capture.app)
            && !crate::overlay::focused(&capture.app)
            && !crate::chat::active(&capture.app);
        if message == 0x201 && capture.active.is_none() && enabled {
            if let Some(region) = regions
                .iter()
                .rev()
                .find(|region| contains(region, event.point))
            {
                capture.active = Some((region.clone(), event.point));
                capture.cancelled = false;
                notification = Some((capture.app.clone(), region.id.clone(), 0.0, 0.0, "start"));
                return true;
            }
        }
        let Some((region, origin)) = &capture.active else {
            return false;
        };
        capture.cancelled |= !enabled || !regions.iter().any(|entry| entry.id == region.id);
        let ended = message == 0x202;
        if !capture.cancelled && (ended || capture.last_move.elapsed() >= Duration::from_millis(16))
        {
            notification = Some((
                capture.app.clone(),
                region.id.clone(),
                (f64::from(event.point[0]) - f64::from(origin[0])) / region.scale,
                (f64::from(event.point[1]) - f64::from(origin[1])) / region.scale,
                if ended { "end" } else { "move" },
            ));
            capture.last_move = Instant::now();
        }
        // Finish swallowing a captured gesture even if PLAY began while the button
        // was held, so the underlying app never receives an unmatched button-up.
        if ended {
            capture.active = None;
        }
        true
    });
    if let Some((app, id, dx, dy, phase)) = notification {
        if let Err(error) = app.emit_to("overlay", "character-drag", (id, dx, dy, phase)) {
            eprintln!("Could not deliver character drag: {error}");
            crate::drag::clear(&app);
        }
    }
    // Consuming WM_MOUSEMOVE also prevents Windows from advancing the cursor.
    // Keep relative mouse motion flowing; only swallow this gesture's buttons.
    if consumed && message != 0x200 {
        1
    } else {
        // SAFETY: Mouse motion and uncaptured buttons retain the normal hook chain.
        unsafe { CallNextHookEx(std::ptr::null_mut(), code, message, data) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hit_regions_use_physical_monitor_coordinates_including_negative_origins() {
        let region = Region {
            id: "host".into(),
            rect: [-1920.0, 150.0, -1776.0, 294.0],
            scale: 1.5,
        };
        assert!(contains(&region, [-1850, 200]));
        assert!(!contains(&region, [0, 200]));
        assert!(!contains(&region, [-1850, 295]));
    }
}

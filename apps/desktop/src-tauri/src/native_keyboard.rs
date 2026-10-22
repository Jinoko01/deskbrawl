use std::{
    cell::RefCell,
    ffi::c_void,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};
use tauri::{AppHandle, Emitter};

type HookProc = unsafe extern "system" fn(i32, usize, isize) -> isize;

#[repr(C)]
struct KeyEvent {
    virtual_key: u32,
    scan: u32,
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

static GENERATION: AtomicU64 = AtomicU64::new(0);
static THREAD: Mutex<Option<u32>> = Mutex::new(None);

#[link(name = "user32")]
unsafe extern "system" {
    fn SetWindowsHookExW(
        kind: i32,
        callback: HookProc,
        module: *mut c_void,
        thread: u32,
    ) -> *mut c_void;
    fn UnhookWindowsHookEx(hook: *mut c_void) -> i32;
    fn CallNextHookEx(hook: *mut c_void, code: i32, message: usize, data: isize) -> isize;
    fn GetAsyncKeyState(key: i32) -> i16;
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

struct Capture {
    app: AppHandle,
    hook: *mut c_void,
    keys: [String; 6],
    held: [bool; 6],
}

impl Drop for Capture {
    fn drop(&mut self) {
        // SAFETY: This thread owns the installed hook, which is released exactly once.
        unsafe { UnhookWindowsHookEx(self.hook) };
    }
}

thread_local! {
    static CAPTURE: RefCell<Option<Capture>> = const { RefCell::new(None) };
}

// A dedicated message loop keeps keyboard callbacks independent of WebView/UI work.
pub fn start(app: &AppHandle) -> tauri::Result<()> {
    let keys = crate::controls::game_keys(app).map_err(std::io::Error::other)?;
    stop();
    let generation = GENERATION.load(Ordering::SeqCst);
    crate::local_game::set_capturing(app, true);
    let target = app.clone();
    if let Err(error) = std::thread::Builder::new()
        .name("game-input".into())
        .spawn(move || {
            let result = run(&target, keys, generation);
            if GENERATION.load(Ordering::SeqCst) == generation {
                if let Err(error) = result {
                    eprintln!("Game keyboard capture failed: {error}");
                }
                crate::local_game::end_play(&target);
            }
        })
    {
        crate::local_game::set_capturing(app, false);
        return Err(error.into());
    }
    Ok(())
}

pub fn stop() {
    if let Ok(mut current) = THREAD.lock() {
        GENERATION.fetch_add(1, Ordering::SeqCst);
        if let Some(thread) = current.take() {
            // SAFETY: The published thread already owns a message queue. WM_QUIT ends it.
            if unsafe { PostThreadMessageW(thread, 0x12, 0, 0) } == 0 {
                eprintln!(
                    "Could not stop game keyboard thread: {}",
                    std::io::Error::last_os_error()
                );
            }
        }
    }
}

fn run(app: &AppHandle, keys: [String; 6], generation: u64) -> std::io::Result<()> {
    let mut message = Message::default();
    // SAFETY: The initialized MSG is writable; PeekMessage creates this thread's queue.
    let thread = unsafe {
        PeekMessageW(&mut message, std::ptr::null_mut(), 0, 0, 0);
        GetCurrentThreadId()
    };
    // SAFETY: The callback and executable module outlive this hook. WH_KEYBOARD_LL
    // executes on this thread, and the thread pumps its messages until WM_QUIT.
    let hook =
        unsafe { SetWindowsHookExW(13, keyboard_proc, GetModuleHandleW(std::ptr::null()), 0) };
    if hook.is_null() {
        return Err(std::io::Error::last_os_error());
    }
    CAPTURE.with(|capture| {
        *capture.borrow_mut() = Some(Capture {
            app: app.clone(),
            hook,
            keys,
            held: [false; 6],
        });
    });
    let mut current = THREAD
        .lock()
        .map_err(|_| std::io::Error::other("Keyboard thread state unavailable"))?;
    if GENERATION.load(Ordering::SeqCst) != generation {
        return Ok(());
    }
    *current = Some(thread);
    crate::local_game::request_play(app).map_err(std::io::Error::other)?;
    drop(current);
    loop {
        // SAFETY: MSG is live for the entire call; this dedicated thread has no windows.
        let result = unsafe { GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) };
        if result <= 0 {
            return if result == 0 {
                Ok(())
            } else {
                Err(std::io::Error::last_os_error())
            };
        }
    }
}

// Use physical scan codes to match KeyboardEvent.code, including NumLock-off keys.
fn key_code(scan: u32, extended: bool) -> Option<String> {
    if extended {
        return match scan {
            0x48 => Some("ArrowUp".into()),
            0x4b => Some("ArrowLeft".into()),
            0x50 => Some("ArrowDown".into()),
            0x4d => Some("ArrowRight".into()),
            _ => None,
        };
    }
    for (index, value) in [0x52, 0x4f, 0x50, 0x51, 0x4b, 0x4c, 0x4d, 0x47, 0x48, 0x49]
        .iter()
        .enumerate()
    {
        if scan == *value {
            return Some(format!("Numpad{index}"));
        }
    }
    if (0x02..=0x0b).contains(&scan) {
        return Some(format!("Digit{}", (scan - 1) % 10));
    }
    if scan == 0x39 {
        return Some("Space".into());
    }
    for (first, row) in [(0x10, "QWERTYUIOP"), (0x1e, "ASDFGHJKL"), (0x2c, "ZXCVBNM")] {
        if let Some(letter) = scan
            .checked_sub(first)
            .and_then(|index| row.chars().nth(index as usize))
        {
            return Some(format!("Key{letter}"));
        }
    }
    None
}

unsafe extern "system" fn keyboard_proc(code: i32, message: usize, data: isize) -> isize {
    if code < 0 || !matches!(message, 0x100 | 0x101 | 0x104 | 0x105) {
        // SAFETY: Unhandled hook notifications must be forwarded unchanged.
        return unsafe { CallNextHookEx(std::ptr::null_mut(), code, message, data) };
    }
    // SAFETY: HC_ACTION supplies a valid KBDLLHOOKSTRUCT for this callback's duration.
    let event = unsafe { &*(data as *const KeyEvent) };
    let down = matches!(message, 0x100 | 0x104);
    // Preserve application/OS shortcuts, including the WORK/PLAY toggle itself.
    let modified = [0x11, 0x12, 0x5b, 0x5c]
        .iter()
        .any(|key| unsafe { GetAsyncKeyState(*key) } < 0);
    let mut notification = None;
    let mut escape = None;
    let mut chat = None;
    let consumed = CAPTURE.with(|capture| {
        let mut capture = capture.borrow_mut();
        let Some(capture) = capture.as_mut() else {
            return false;
        };
        if !crate::local_game::capturing(&capture.app) || !crate::local_game::playing(&capture.app)
        {
            return false;
        }
        if event.virtual_key == 0x1b && down && !modified {
            escape = Some(capture.app.clone());
            return true;
        }
        // Slash belongs to chat only in a connected PLAY session; WORK keeps
        // normal typing, and Shift+/ remains a question mark in other apps.
        if event.scan == 0x35
            && event.flags & 1 == 0
            && down
            && !modified
            && unsafe { GetAsyncKeyState(0x10) } >= 0
            && crate::network::chat_allowed(&capture.app)
        {
            chat = Some(capture.app.clone());
            return true;
        }
        let Some(key) = key_code(event.scan, event.flags & 1 != 0) else {
            return false;
        };
        let Some(index) = capture.keys.iter().position(|value| *value == key) else {
            return false;
        };
        if down && modified || !down && !capture.held[index] {
            return false;
        }
        if capture.held[index] != down {
            capture.held[index] = down;
            notification = Some((capture.app.clone(), key, down));
        }
        true
    });
    // Release the RefCell borrow before ending PLAY, which can immediately drop the hook.
    if let Some(app) = escape {
        crate::local_game::end_play(&app);
    }
    if let Some(app) = chat {
        crate::chat::request(&app);
    }
    if let Some((app, key, down)) = notification {
        if let Err(error) = app.emit_to("main", "local-key", (key, down)) {
            eprintln!("Could not deliver game key: {error}");
            crate::local_game::end_play(&app);
        }
    }
    if consumed {
        1
    } else {
        // SAFETY: This event was not captured and remains owned by the hook chain.
        unsafe { CallNextHookEx(std::ptr::null_mut(), code, message, data) }
    }
}

#[cfg(test)]
mod tests {
    use super::key_code;

    #[test]
    fn physical_keys_match_dom_codes_without_numlock_or_layout_dependency() {
        for (scan, extended, expected) in [
            (0x48, true, "ArrowUp"),
            (0x48, false, "Numpad8"),
            (0x4b, true, "ArrowLeft"),
            (0x4d, true, "ArrowRight"),
            (0x50, true, "ArrowDown"),
            (0x52, false, "Numpad0"),
            (0x2c, false, "KeyZ"),
            (0x2d, false, "KeyX"),
            (0x10, false, "KeyQ"),
            (0x02, false, "Digit1"),
            (0x0b, false, "Digit0"),
            (0x39, false, "Space"),
        ] {
            assert_eq!(key_code(scan, extended).as_deref(), Some(expected));
        }
        assert_eq!(key_code(0x1d, false), None);
        assert_eq!(key_code(0x38, true), None);
    }
}

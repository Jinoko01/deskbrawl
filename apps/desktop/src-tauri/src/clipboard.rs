#[cfg(not(windows))]
pub fn copy_text(_window: &tauri::Window, _text: &str) -> tauri::Result<()> {
    Err(std::io::Error::other("Windows clipboard is not supported on this platform").into())
}

#[cfg(windows)]
pub fn copy_text(window: &tauri::Window, text: &str) -> tauri::Result<()> {
    use std::ffi::c_void;
    #[link(name = "user32")]
    unsafe extern "system" {
        fn OpenClipboard(owner: *mut c_void) -> i32;
        fn CloseClipboard() -> i32;
        fn EmptyClipboard() -> i32;
        fn SetClipboardData(format: u32, memory: *mut c_void) -> *mut c_void;
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GlobalAlloc(flags: u32, bytes: usize) -> *mut c_void;
        fn GlobalLock(memory: *mut c_void) -> *mut c_void;
        fn GlobalUnlock(memory: *mut c_void) -> i32;
        fn GlobalFree(memory: *mut c_void) -> *mut c_void;
    }
    struct Memory(*mut c_void);
    impl Drop for Memory {
        fn drop(&mut self) {
            if !self.0.is_null() {
                // SAFETY: this allocation remains ours until SetClipboardData succeeds.
                unsafe {
                    GlobalFree(self.0);
                }
            }
        }
    }
    struct Clipboard;
    impl Drop for Clipboard {
        fn drop(&mut self) {
            // SAFETY: constructed only after OpenClipboard succeeds on this thread.
            unsafe {
                CloseClipboard();
            }
        }
    }
    let text: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
    let owner = window.hwnd()?.0;
    // SAFETY: moveable allocation is large enough for the UTF-16 buffer including its NUL.
    let mut memory =
        Memory(unsafe { GlobalAlloc(0x0002, text.len() * std::mem::size_of::<u16>()) });
    if memory.0.is_null() {
        return Err(std::io::Error::last_os_error().into());
    }
    // SAFETY: memory is a live GlobalAlloc handle owned by the guard.
    let target = unsafe { GlobalLock(memory.0) };
    if target.is_null() {
        return Err(std::io::Error::last_os_error().into());
    }
    // SAFETY: source and target are distinct and target holds exactly text.len() u16 values.
    unsafe {
        std::ptr::copy_nonoverlapping(text.as_ptr(), target.cast::<u16>(), text.len());
        GlobalUnlock(memory.0);
    }
    // SAFETY: owner is our live main window; all clipboard calls stay on this UI thread.
    if unsafe { OpenClipboard(owner) } == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    let _clipboard = Clipboard;
    // SAFETY: this thread owns the opened clipboard; CF_UNICODETEXT takes the moveable handle.
    if unsafe { EmptyClipboard() } == 0 || unsafe { SetClipboardData(13, memory.0) }.is_null() {
        return Err(std::io::Error::last_os_error().into());
    }
    memory.0 = std::ptr::null_mut();
    Ok(())
}

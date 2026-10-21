use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use tauri::{
    ipc::{InvokeBody, Request},
    AppHandle, Emitter, Manager, WebviewWindow, Window, WindowEvent,
};

#[derive(Default)]
pub struct LocalSession {
    ready: AtomicBool,
    // An accepted PLAY that has not ended through WORK or main losing focus.
    playing: AtomicBool,
    // The work window that had focus before the PLAY shortcut; 0 when unknown.
    previous: AtomicIsize,
}

pub fn playing(app: &AppHandle) -> bool {
    app.state::<LocalSession>().playing.load(Ordering::SeqCst)
}

pub fn remember_previous(app: &AppHandle, window: isize) {
    app.state::<LocalSession>()
        .previous
        .store(window, Ordering::SeqCst);
}

pub fn take_previous(app: &AppHandle) -> isize {
    let session = app.state::<LocalSession>();
    session.playing.store(false, Ordering::SeqCst);
    session.previous.swap(0, Ordering::SeqCst)
}

// main has just been brought to the foreground; its webview starts PLAY once focused.
pub fn request_play(app: &AppHandle) {
    if let Err(error) = app.emit_to("main", "local-play", ()) {
        eprintln!("Local play request failed: {error}");
    }
}

fn visible(app: &AppHandle) -> bool {
    app.get_webview_window("overlay")
        .and_then(|overlay| overlay.is_visible().ok())
        .unwrap_or(false)
}

pub fn on_overlay_visibility(app: &AppHandle, shown: bool) {
    if !shown {
        app.state::<LocalSession>()
            .playing
            .store(false, Ordering::SeqCst);
        if let Err(error) = app.emit_to("overlay", "local-input", "stop") {
            eprintln!("Local stop failed: {error}");
        }
    }
    let ready = shown && app.state::<LocalSession>().ready.load(Ordering::SeqCst);
    if let Err(error) = app.emit_to("main", "local-reset", ready) {
        eprintln!("Local mode reset failed: {error}");
    }
}

#[tauri::command]
pub fn local_available(window: WebviewWindow) -> Result<bool, &'static str> {
    if window.label() != "main" {
        return Err("MAIN_ONLY");
    }
    let app = window.app_handle();
    Ok(app.state::<LocalSession>().ready.load(Ordering::SeqCst) && visible(app))
}

#[tauri::command]
pub fn local_overlay_status(window: WebviewWindow, ready: bool) -> Result<(), &'static str> {
    if window.label() != "overlay" {
        return Err("OVERLAY_ONLY");
    }
    window
        .app_handle()
        .state::<LocalSession>()
        .ready
        .store(ready, Ordering::SeqCst);
    window
        .emit_to("main", "local-reset", ready && visible(window.app_handle()))
        .map_err(|_| "LOCAL_EVENT_FAILED")
}

#[tauri::command]
pub fn local_control(window: WebviewWindow, request: Request<'_>) -> Result<(), &'static str> {
    if window.label() != "main" {
        return Err("MAIN_ONLY");
    }
    let InvokeBody::Json(value) = request.body() else {
        return Err("INVALID_LOCAL_INPUT");
    };
    let fields = value.as_object().ok_or("INVALID_LOCAL_INPUT")?;
    if fields.len() > 5 {
        return Err("INVALID_LOCAL_INPUT");
    }
    let kind = fields
        .get("kind")
        .and_then(|v| v.as_str())
        .ok_or("INVALID_LOCAL_INPUT")?;
    let seq = fields
        .get("seq")
        .and_then(|v| v.as_u64())
        .ok_or("INVALID_LOCAL_INPUT")?;
    if seq == 0 || seq > 9_007_199_254_740_991 || !matches!(kind, "play" | "input" | "work") {
        return Err("INVALID_LOCAL_INPUT");
    }
    let movement = fields
        .get("movement")
        .and_then(|v| v.as_object())
        .ok_or("INVALID_LOCAL_INPUT")?;
    if movement.len() != 2 {
        return Err("INVALID_LOCAL_INPUT");
    }
    for axis in ["x", "y"] {
        if !matches!(movement.get(axis).and_then(|v| v.as_i64()), Some(-1..=1)) {
            return Err("INVALID_LOCAL_INPUT");
        }
    }
    if let Some(action) = fields.get("action") {
        if !matches!(action.as_str(), Some("melee" | "stone")) {
            return Err("INVALID_LOCAL_INPUT");
        }
    }
    // Only an explicit Esc asks to return to the work window. Other WORK exits
    // (focus loss, resets) must never move focus.
    let restore = match fields.get("restore") {
        None => false,
        Some(value) if kind == "work" && value.as_bool() == Some(true) => true,
        Some(_) => return Err("INVALID_LOCAL_INPUT"),
    };
    let app = window.app_handle();
    // Tauri's cached focus flag can lag the WebView right after the shortcut
    // activates main, so Windows asks the OS for the real foreground window.
    #[cfg(windows)]
    let focused = crate::native_windows::is_foreground(&window.as_ref().window())
        .map_err(|_| "LOCAL_FOCUS_FAILED")?;
    #[cfg(not(windows))]
    let focused = window.is_focused().map_err(|_| "LOCAL_FOCUS_FAILED")?;
    if kind != "work" {
        if !focused {
            return Err("MAIN_NOT_FOCUSED");
        }
        if !app.state::<LocalSession>().ready.load(Ordering::SeqCst) || !visible(app) {
            return Err("OVERLAY_NOT_READY");
        }
    }
    window
        .emit_to("overlay", "local-input", value.clone())
        .map_err(|_| "LOCAL_EVENT_FAILED")?;
    match kind {
        "play" => app
            .state::<LocalSession>()
            .playing
            .store(true, Ordering::SeqCst),
        "work" => {
            let previous = take_previous(app);
            if restore && focused && previous != 0 {
                #[cfg(windows)]
                crate::native_windows::return_focus(&window.as_ref().window(), previous)
                    .map_err(|_| "LOCAL_FOCUS_FAILED")?;
            }
        }
        _ => {}
    }
    Ok(())
}

// Ends PLAY because main can no longer receive game keys: input stops in the
// overlay and main's webview returns to WORK.
pub fn end_play(app: &AppHandle) {
    let session = app.state::<LocalSession>();
    session.playing.store(false, Ordering::SeqCst);
    if let Err(error) = app.emit_to("overlay", "local-input", "stop") {
        eprintln!("Local stop failed: {error}");
    }
    if let Err(error) = app.emit_to("main", "local-reset", session.ready.load(Ordering::SeqCst)) {
        eprintln!("Local mode reset failed: {error}");
    }
}

pub fn on_window_event(window: &Window, event: &WindowEvent) {
    // While Windows activates main, focus can pass through the top-level window into
    // the WebView child, so Tauri reports Focused(false) although main stays in front.
    #[cfg(windows)]
    let lost_focus = matches!(event, WindowEvent::Focused(false))
        && !crate::native_windows::is_foreground(window).unwrap_or(false);
    #[cfg(not(windows))]
    let lost_focus = matches!(event, WindowEvent::Focused(false));
    if window.label() == "main" && lost_focus {
        end_play(window.app_handle());
    }
    if window.label() == "overlay" && matches!(event, WindowEvent::Destroyed) {
        window
            .app_handle()
            .state::<LocalSession>()
            .ready
            .store(false, Ordering::SeqCst);
        if let Err(error) = window.emit_to("main", "local-reset", false) {
            eprintln!("Local reset failed: {error}");
        }
    }
}

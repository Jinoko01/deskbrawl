use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    ipc::{InvokeBody, Request},
    Emitter, Manager, WebviewWindow, Window, WindowEvent,
};

#[derive(Default)]
pub struct LocalSession {
    ready: AtomicBool,
}

#[tauri::command]
pub fn local_available(window: WebviewWindow) -> Result<bool, &'static str> {
    if window.label() != "main" {
        return Err("MAIN_ONLY");
    }
    Ok(window
        .app_handle()
        .state::<LocalSession>()
        .ready
        .load(Ordering::SeqCst))
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
        .emit_to("main", "local-reset", ready)
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
    let app = window.app_handle();
    if kind != "work" {
        if !window.is_focused().map_err(|_| "LOCAL_FOCUS_FAILED")? {
            return Err("MAIN_NOT_FOCUSED");
        }
        if !app.state::<LocalSession>().ready.load(Ordering::SeqCst) {
            return Err("OVERLAY_NOT_READY");
        }
    }
    window
        .emit_to("overlay", "local-input", value.clone())
        .map_err(|_| "LOCAL_EVENT_FAILED")
}

pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if window.label() == "main" && matches!(event, WindowEvent::Focused(false)) {
        if let Err(error) = window.emit_to("overlay", "local-input", "stop") {
            eprintln!("Local stop failed: {error}");
        }
        if let Err(error) = window.emit_to(
            "main",
            "local-reset",
            window
                .app_handle()
                .state::<LocalSession>()
                .ready
                .load(Ordering::SeqCst),
        ) {
            eprintln!("Local mode reset failed: {error}");
        }
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

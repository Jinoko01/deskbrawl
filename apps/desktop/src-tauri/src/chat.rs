use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, WebviewWindow, WebviewWindowBuilder, Window,
    WindowEvent,
};

#[derive(Default)]
pub struct ChatState {
    requested: AtomicBool,
    active: AtomicBool,
    previous: AtomicUsize,
}

pub fn active(app: &AppHandle) -> bool {
    app.state::<ChatState>().active.load(Ordering::SeqCst)
}

pub fn request(app: &AppHandle) {
    #[cfg(windows)]
    app.state::<ChatState>()
        .previous
        .store(crate::native_windows::foreground_token(), Ordering::SeqCst);
    crate::local_game::end_play(app);
    app.state::<ChatState>()
        .requested
        .store(true, Ordering::SeqCst);
    let _ = app.emit_to("main", "chat-request", ());
}

pub fn dismiss(app: &AppHandle) {
    let state = app.state::<ChatState>();
    state.requested.store(false, Ordering::SeqCst);
    if !state.active.swap(false, Ordering::SeqCst) {
        return;
    }
    let _ = app.emit_to("main", "chat-draft", ["", ""]);
    if let Some(window) = app.get_webview_window("chat") {
        #[cfg(windows)]
        crate::native_windows::restore_chat_focus(
            &window.as_ref().window(),
            state.previous.swap(0, Ordering::SeqCst),
        );
        let _ = window.hide();
    }
}

#[tauri::command]
pub async fn chat_open(window: WebviewWindow, x: f64, y: f64) -> Result<(), &'static str> {
    if window.label() != "main" {
        return Err("MAIN_ONLY");
    }
    let app = window.app_handle();
    let state = app.state::<ChatState>();
    if !state.requested.swap(false, Ordering::SeqCst)
        || !x.is_finite()
        || !y.is_finite()
        || !(0.0..=1.0).contains(&x)
        || !(0.0..=1.0).contains(&y)
        || !crate::network::chat_allowed(app)
        || crate::overlay::focused(app)
    {
        return Err("CHAT_UNAVAILABLE");
    }
    crate::local_game::end_play(app);
    let result = (|| -> tauri::Result<()> {
        let popup = match app.get_webview_window("chat") {
            Some(popup) => popup,
            None => {
                let config = app
                    .config()
                    .app
                    .windows
                    .iter()
                    .find(|config| config.label == "chat")
                    .ok_or_else(|| std::io::Error::other("Missing chat configuration"))?;
                WebviewWindowBuilder::from_config(app, config)?.build()?
            }
        };
        let monitor = popup
            .primary_monitor()?
            .ok_or_else(|| std::io::Error::other("Missing monitor"))?;
        let scale = monitor.scale_factor();
        let width = f64::from(monitor.size().width);
        let height = f64::from(monitor.size().height);
        popup.set_position(PhysicalPosition::new(
            monitor.position().x
                + (width * x - 165.0 * scale).clamp(0.0, (width - 330.0 * scale).max(0.0)) as i32,
            monitor.position().y
                + (height * y - 170.0 * scale).clamp(0.0, (height - 110.0 * scale).max(0.0)) as i32,
        ))?;
        state.active.store(true, Ordering::SeqCst);
        popup.show()?;
        popup.set_focus()?;
        popup.emit("chat-opened", ())?;
        Ok(())
    })();
    if result.is_err() {
        dismiss(app);
    }
    result.map_err(|_| "CHAT_OPEN_FAILED")
}

fn require_chat(window: &WebviewWindow) -> Result<(), &'static str> {
    if window.label() != "chat" {
        return Err("CHAT_ONLY");
    }
    if !active(window.app_handle()) {
        return Err("CHAT_CLOSED");
    }
    Ok(())
}

#[tauri::command]
pub fn chat_update(
    window: WebviewWindow,
    current: String,
    previous: String,
) -> Result<(), &'static str> {
    require_chat(&window)?;
    if [current.as_str(), previous.as_str()]
        .iter()
        .any(|line| line.encode_utf16().count() > 50 || line.chars().any(char::is_control))
    {
        return Err("INVALID_CHAT");
    }
    window
        .emit_to("main", "chat-draft", [current, previous])
        .map_err(|_| "CHAT_EVENT_FAILED")
}

#[tauri::command]
pub fn chat_close(window: WebviewWindow) -> Result<(), &'static str> {
    if window.label() != "chat" {
        return Err("CHAT_ONLY");
    }
    dismiss(window.app_handle());
    Ok(())
}

pub fn on_window_event(window: &Window, event: &WindowEvent) {
    #[cfg(windows)]
    let lost_focus = matches!(event, WindowEvent::Focused(false))
        && !crate::native_windows::is_foreground(window).unwrap_or(false);
    #[cfg(not(windows))]
    let lost_focus = matches!(event, WindowEvent::Focused(false));
    if window.label() == "chat" && (lost_focus || matches!(event, WindowEvent::Destroyed)) {
        dismiss(window.app_handle());
    }
}

use std::sync::{
    atomic::{AtomicBool, AtomicU8, Ordering},
    mpsc, Mutex,
};
use std::time::Duration;

use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem},
    tray::TrayIconBuilder,
    App, AppHandle, Emitter, Manager, WebviewWindow, WebviewWindowBuilder, Window, WindowEvent,
};

const SHOW: &str = "overlay-show";
const HIDE: &str = "overlay-hide";
const EXIT: &str = "app-exit";
const PLAY: &str = "local-play";
const REDUCE_EFFECTS: &str = "reduce-effects";
const VISIBLE: u8 = 0;
const HIDDEN: u8 = 1;
const SUSPENDED: u8 = 2;
const EXITING: u8 = 3;

struct Control {
    intent: AtomicU8,
    adjusting_bounds: AtomicBool,
    recreate_required: AtomicBool,
    preferences_loaded: AtomicBool,
    reduced_effects: AtomicBool,
    effects_menu: CheckMenuItem<tauri::Wry>,
    operation: Mutex<()>,
    status: MenuItem<tauri::Wry>,
}

pub fn setup(app: &mut App) -> tauri::Result<()> {
    let status = MenuItem::new(app, "오버레이: 준비 중", false, None::<&str>)?;
    let show = MenuItem::with_id(app, SHOW, "오버레이 표시", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, HIDE, "오버레이 숨김", true, None::<&str>)?;
    let exit = MenuItem::with_id(app, EXIT, "종료", true, None::<&str>)?;
    // Opening the tray menu already takes focus from main, so this item only starts PLAY.
    let play = MenuItem::with_id(app, PLAY, "플레이 시작", cfg!(windows), None::<&str>)?;
    // Load the saved preference on the worker, never block the UI on filesystem I/O.
    let reduced_effects = true;
    let effects_menu = CheckMenuItem::with_id(
        app,
        REDUCE_EFFECTS,
        "효과 감소",
        true,
        reduced_effects,
        None::<&str>,
    )?;
    let menu = Menu::with_items(app, &[&status, &play, &show, &hide, &effects_menu, &exit])?;
    let icon = app
        .default_window_icon()
        .ok_or_else(|| std::io::Error::other("Missing tray icon"))?
        .clone();

    TrayIconBuilder::with_id("deskbrawl")
        .icon(icon)
        .tooltip("DeskBrawl")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            SHOW => dispatch(app, VISIBLE),
            HIDE => dispatch(app, HIDDEN),
            REDUCE_EFFECTS => toggle_effects(app),
            #[cfg(windows)]
            PLAY => {
                let result = app
                    .get_webview_window("main")
                    .ok_or_else(|| std::io::Error::other("Missing main window").into())
                    .and_then(|main| {
                        crate::native_windows::toggle_play_from(&main.as_ref().window())
                    });
                if let Err(error) = result {
                    eprintln!("Tray play failed: {error}");
                }
            }
            EXIT => {
                shutdown(app);
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    app.manage(Control {
        intent: AtomicU8::new(HIDDEN),
        adjusting_bounds: AtomicBool::new(false),
        recreate_required: AtomicBool::new(false),
        preferences_loaded: AtomicBool::new(false),
        reduced_effects: AtomicBool::new(reduced_effects),
        effects_menu,
        operation: Mutex::new(()),
        status,
    });
    dispatch(app.handle(), VISIBLE);
    Ok(())
}

fn read_reduced_effects(app: &AppHandle) -> std::io::Result<bool> {
    let path = app
        .path()
        .app_config_dir()
        .map_err(std::io::Error::other)?
        .join("reduced-effects");
    match std::fs::read_to_string(path) {
        Ok(value) => match value.trim() {
            "1" => Ok(true),
            "0" => Ok(false),
            _ => Err(std::io::Error::other("Invalid effects preference")),
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error),
    }
}

fn toggle_effects(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let control = app.state::<Control>();
        let Ok(_operation) = control.operation.lock() else {
            app.exit(1);
            return;
        };
        if let Err(error) = load_preferences(&app) {
            handle(&app, Err(error));
            return;
        }
        let value = !control.reduced_effects.load(Ordering::SeqCst);
        let result = (|| -> tauri::Result<()> {
            let directory = app.path().app_config_dir()?;
            std::fs::create_dir_all(&directory)?;
            std::fs::write(
                directory.join("reduced-effects"),
                if value { "1\n" } else { "0\n" },
            )?;
            control.reduced_effects.store(value, Ordering::SeqCst);
            control.effects_menu.set_checked(value)?;
            app.emit("overlay-effects-changed", value)?;
            Ok(())
        })();
        if result.is_err() {
            // muda toggles native checkbox state before this callback runs.
            if let Err(error) = control
                .effects_menu
                .set_checked(control.reduced_effects.load(Ordering::SeqCst))
            {
                eprintln!("Could not restore effects menu: {error}");
            }
        }
        handle(&app, result);
    });
}

fn load_preferences(app: &AppHandle) -> tauri::Result<()> {
    let control = app.state::<Control>();
    if !control.preferences_loaded.swap(true, Ordering::SeqCst) {
        let value = match read_reduced_effects(app) {
            Ok(value) => value,
            Err(error) => {
                eprintln!("Could not read effects preference: {error}");
                true
            }
        };
        control.reduced_effects.store(value, Ordering::SeqCst);
        control.effects_menu.set_checked(value)?;
        app.emit("overlay-effects-changed", value)?;
    }
    Ok(())
}

fn require_overlay(window: &WebviewWindow) -> Result<(), &'static str> {
    if window.label() == "overlay" {
        Ok(())
    } else {
        Err("OVERLAY_ONLY")
    }
}

#[tauri::command]
pub fn overlay_reduced_effects(window: WebviewWindow) -> Result<bool, &'static str> {
    require_overlay(&window)?;
    Ok(window
        .app_handle()
        .state::<Control>()
        .reduced_effects
        .load(Ordering::SeqCst))
}

#[tauri::command]
pub fn preview_reduced_effects(window: WebviewWindow) -> Result<bool, &'static str> {
    if window.label() != "main" {
        return Err("MAIN_ONLY");
    }
    Ok(window
        .app_handle()
        .state::<Control>()
        .reduced_effects
        .load(Ordering::SeqCst))
}

#[tauri::command]
pub fn overlay_renderer_failed(window: WebviewWindow) -> Result<(), &'static str> {
    require_overlay(&window)?;
    // A retry must recreate the failed renderer, rather than just reveal its DOM.
    let app = window.app_handle().clone();
    app.state::<Control>()
        .recreate_required
        .store(true, Ordering::SeqCst);
    dispatch(&app, SUSPENDED);
    window.hide().map_err(|_| "OVERLAY_HIDE_FAILED")?;
    Ok(())
}

fn create(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|config| config.label == "overlay")
        .ok_or_else(|| std::io::Error::other("Missing overlay configuration"))?;

    let window = WebviewWindowBuilder::from_config(app, config)?.build()?;
    #[cfg(windows)]
    on_window_thread(&window, |window| {
        crate::native_windows::watch_display(&window.as_ref().window())
    })?;
    Ok(window)
}

fn fit_primary_monitor(window: &WebviewWindow) -> tauri::Result<()> {
    let monitor = window
        .primary_monitor()?
        .ok_or_else(|| std::io::Error::other("Primary monitor is unavailable"))?;
    validate_monitor(
        monitor.size().width,
        monitor.size().height,
        monitor.scale_factor(),
    )?;
    let position = *monitor.position();
    let size = *monitor.size();
    on_window_thread(window, move |window| {
        let control = window.app_handle().state::<Control>();
        control.adjusting_bounds.store(true, Ordering::SeqCst);
        #[cfg(windows)]
        let result = crate::native_windows::place(&window.as_ref().window(), position, size);
        #[cfg(not(windows))]
        let result = window
            .set_position(position)
            .and_then(|()| window.set_size(size));
        control.adjusting_bounds.store(false, Ordering::SeqCst);
        result
    })
}

fn validate_monitor(width: u32, height: u32, scale: f64) -> tauri::Result<()> {
    if width == 0
        || height == 0
        || width > i32::MAX as u32
        || height > i32::MAX as u32
        || !scale.is_finite()
        || scale <= 0.0
    {
        return Err(std::io::Error::other("Invalid primary monitor geometry or DPI").into());
    }
    Ok(())
}

// Configuration changes never trigger a z-order/focus reclaim loop. A tray show
// fits the hidden webview against a fresh primary-monitor measurement.
pub fn display_changed(app: &AppHandle) -> bool {
    let Some(control) = app.try_state::<Control>() else {
        return false;
    };
    if control.adjusting_bounds.load(Ordering::SeqCst) {
        return false;
    }
    // WebView2 can retain the previous monitor rasterization scale after a DPI
    // transition. Recreating on explicit recovery refreshes both HWND and WebView.
    control.recreate_required.store(true, Ordering::SeqCst);
    if control.intent.load(Ordering::SeqCst) == VISIBLE {
        dispatch(app, SUSPENDED);
    }
    true
}

// WebView2 creation and synchronous getters must not block the Windows event loop.
// Only workers take this lock; UI callbacks update intent without waiting for it.
fn dispatch(app: &AppHandle, intent: u8) {
    let control = app.state::<Control>();
    if control.intent.load(Ordering::SeqCst) == EXITING {
        return;
    }
    control.intent.store(intent, Ordering::SeqCst);
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let control = app.state::<Control>();
        let Ok(_operation) = control.operation.lock() else {
            app.exit(1);
            return;
        };
        if control.intent.load(Ordering::SeqCst) == EXITING {
            return;
        }
        let result = if control.intent.load(Ordering::SeqCst) == VISIBLE {
            request_show(&app)
        } else {
            request_hide(&app)
        };
        handle(&app, result);
    });
}

fn request_show(app: &AppHandle) -> tauri::Result<()> {
    load_preferences(app)?;
    let control = app.state::<Control>();
    if control.recreate_required.load(Ordering::SeqCst) {
        if let Some(window) = app.get_webview_window("overlay") {
            conceal(&window)?;
            SafeWindow::destroy(&window)?;
            let deadline = std::time::Instant::now() + Duration::from_secs(5);
            while app.get_webview_window("overlay").is_some() {
                if std::time::Instant::now() >= deadline {
                    return Err(std::io::Error::other("Stale renderer did not close").into());
                }
                std::thread::sleep(Duration::from_millis(10));
            }
        }
        control.recreate_required.store(false, Ordering::SeqCst);
    }
    let window = match app.get_webview_window("overlay") {
        Some(window) => window,
        None => create(app)?,
    };
    // A hide or focus-safety request received during creation takes priority.
    if app.state::<Control>().intent.load(Ordering::SeqCst) != VISIBLE {
        return request_hide(app);
    }
    fit_primary_monitor(&window)?;
    show_safely(&window)?;
    if app.state::<Control>().intent.load(Ordering::SeqCst) != VISIBLE {
        return request_hide(app);
    }
    crate::local_game::on_overlay_visibility(app, true);
    app.state::<Control>().status.set_text("오버레이: 표시 중")
}

fn request_hide(app: &AppHandle) -> tauri::Result<()> {
    crate::local_game::on_overlay_visibility(app, false);
    if let Some(window) = app.get_webview_window("overlay") {
        conceal(&window)?;
    }
    let control = app.state::<Control>();
    if control.intent.load(Ordering::SeqCst) == SUSPENDED {
        control.status.set_text("오버레이: 중지됨 — 표시로 재시도")
    } else {
        control.status.set_text("오버레이: 숨김")
    }
}

fn handle(app: &AppHandle, result: tauri::Result<()>) {
    if app.state::<Control>().intent.load(Ordering::SeqCst) == EXITING {
        return;
    }
    if let Err(error) = result {
        app.state::<Control>()
            .intent
            .store(SUSPENDED, Ordering::SeqCst);
        eprintln!("Overlay suspended: {error}");
        if let Some(window) = app.get_webview_window("overlay") {
            if let Err(error) = conceal(&window) {
                eprintln!("Could not remove unsafe overlay: {error}");
                std::process::exit(1);
            }
        }
        if let Err(error) = app
            .state::<Control>()
            .status
            .set_text("오버레이: 중지됨 — 표시로 재시도")
        {
            eprintln!("Could not report overlay failure: {error}");
            app.exit(1);
        }
    }
}

pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if window.label() != "overlay" {
        return;
    }
    match event {
        WindowEvent::Focused(true) => {
            dispatch(window.app_handle(), SUSPENDED);
            // Hide immediately instead of waiting behind an in-flight creation or show.
            let result = window.hide().and_then(|()| {
                #[cfg(windows)]
                crate::native_windows::hide(window)?;
                Ok(())
            });
            if let Err(error) = result.or_else(|_| window.destroy()) {
                eprintln!("Could not remove focused overlay: {error}");
                std::process::exit(1);
            }
        }
        WindowEvent::Destroyed => {
            let app = window.app_handle();
            let control = app.state::<Control>();
            if control.recreate_required.load(Ordering::SeqCst) {
                return;
            }
            if control
                .intent
                .compare_exchange(VISIBLE, HIDDEN, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok()
            {
                dispatch(app, HIDDEN);
            }
        }
        _ => {}
    }
}

pub fn shutdown(app: &AppHandle) {
    if let Some(control) = app.try_state::<Control>() {
        control.intent.store(EXITING, Ordering::SeqCst);
    }
}

// This boundary lets failure tests verify that no show occurs after a native setup error.
trait SafeWindow {
    fn prepare(&self) -> tauri::Result<()>;
    fn show(&self) -> tauri::Result<()>;
    fn hide(&self) -> tauri::Result<()>;
    fn destroy(&self) -> tauri::Result<()>;
}

impl SafeWindow for WebviewWindow {
    fn prepare(&self) -> tauri::Result<()> {
        on_window_thread(self, |window| {
            window.set_focusable(false)?;
            window.set_ignore_cursor_events(true)?;
            #[cfg(windows)]
            crate::native_windows::prepare(&window.as_ref().window())?;
            Ok(())
        })
    }

    fn show(&self) -> tauri::Result<()> {
        on_window_thread(self, |window| {
            if window
                .app_handle()
                .state::<Control>()
                .intent
                .load(Ordering::SeqCst)
                != VISIBLE
            {
                return Ok(());
            }
            #[cfg(windows)]
            {
                crate::native_windows::show(&window.as_ref().window())
            }
            #[cfg(not(windows))]
            {
                window.show()
            }
        })
    }

    fn hide(&self) -> tauri::Result<()> {
        on_window_thread(self, |window| {
            window.hide()?;
            #[cfg(windows)]
            crate::native_windows::hide(&window.as_ref().window())?;
            Ok(())
        })
    }

    fn destroy(&self) -> tauri::Result<()> {
        on_window_thread(self, WebviewWindow::destroy)
    }
}

fn on_window_thread(
    window: &WebviewWindow,
    action: impl FnOnce(&WebviewWindow) -> tauri::Result<()> + Send + 'static,
) -> tauri::Result<()> {
    let (sender, receiver) = mpsc::sync_channel(1);
    let target = window.clone();
    window.run_on_main_thread(move || {
        let _ = sender.send(action(&target));
    })?;
    receiver
        .recv_timeout(Duration::from_secs(5))
        .map_err(|error| std::io::Error::other(error.to_string()))?
}

fn show_safely(window: &impl SafeWindow) -> tauri::Result<()> {
    let result = (|| {
        window.prepare()?;
        window.show()?;
        Ok(())
    })();
    if result.is_err() {
        conceal(window)?;
    }
    result
}

fn conceal(window: &impl SafeWindow) -> tauri::Result<()> {
    window.hide().or_else(|_| window.destroy())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[test]
    fn monitor_geometry_rejects_unusable_dimensions_and_dpi() {
        for scale in [1.0, 1.25, 1.5, 2.0] {
            assert!(validate_monitor(3840, 2160, scale).is_ok());
        }
        assert!(validate_monitor(0, 1080, 1.0).is_err());
        assert!(validate_monitor(1920, 0, 1.0).is_err());
        assert!(validate_monitor(u32::MAX, 1080, 1.0).is_err());
        for scale in [0.0, -1.0, f64::NAN, f64::INFINITY] {
            assert!(validate_monitor(1920, 1080, scale).is_err());
        }
    }

    #[derive(Default)]
    struct FakeWindow {
        calls: RefCell<Vec<&'static str>>,
        fail: &'static [&'static str],
    }

    impl FakeWindow {
        fn call(&self, operation: &'static str) -> tauri::Result<()> {
            self.calls.borrow_mut().push(operation);
            if self.fail.contains(&operation) {
                Err(std::io::Error::other("injected native failure").into())
            } else {
                Ok(())
            }
        }
    }

    impl SafeWindow for FakeWindow {
        fn prepare(&self) -> tauri::Result<()> {
            self.call("prepare")
        }
        fn show(&self) -> tauri::Result<()> {
            self.call("show")
        }
        fn hide(&self) -> tauri::Result<()> {
            self.call("hide")
        }
        fn destroy(&self) -> tauri::Result<()> {
            self.call("destroy")
        }
    }

    #[test]
    fn native_preparation_precedes_show() {
        let window = FakeWindow::default();
        assert!(show_safely(&window).is_ok());
        assert_eq!(*window.calls.borrow(), ["prepare", "show"]);
    }

    #[test]
    fn setup_failure_never_shows_the_window() {
        let window = FakeWindow {
            fail: &["prepare"],
            ..Default::default()
        };
        assert!(show_safely(&window).is_err());
        assert_eq!(*window.calls.borrow(), ["prepare", "hide"]);
    }

    #[test]
    fn show_failure_hides_the_window() {
        let window = FakeWindow {
            fail: &["show"],
            ..Default::default()
        };
        assert!(show_safely(&window).is_err());
        assert_eq!(*window.calls.borrow(), ["prepare", "show", "hide"]);
    }

    #[test]
    fn hide_failure_destroys_the_window() {
        let window = FakeWindow {
            fail: &["hide"],
            ..Default::default()
        };
        assert!(conceal(&window).is_ok());
        assert_eq!(*window.calls.borrow(), ["hide", "destroy"]);
    }

    #[test]
    fn cleanup_failure_is_propagated_for_emergency_exit() {
        let window = FakeWindow {
            fail: &["hide", "destroy"],
            ..Default::default()
        };
        assert!(conceal(&window).is_err());
        assert_eq!(*window.calls.borrow(), ["hide", "destroy"]);
    }
}

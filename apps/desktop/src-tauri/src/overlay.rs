use std::sync::{
    atomic::{AtomicU8, Ordering},
    mpsc, Mutex,
};
use std::time::Duration;

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    App, AppHandle, Manager, WebviewWindow, WebviewWindowBuilder, Window, WindowEvent,
};

const SHOW: &str = "overlay-show";
const HIDE: &str = "overlay-hide";
const EXIT: &str = "app-exit";
const VISIBLE: u8 = 0;
const HIDDEN: u8 = 1;
const SUSPENDED: u8 = 2;
const EXITING: u8 = 3;

struct Control {
    intent: AtomicU8,
    operation: Mutex<()>,
    status: MenuItem<tauri::Wry>,
}

pub fn setup(app: &mut App) -> tauri::Result<()> {
    let status = MenuItem::new(app, "오버레이: 준비 중", false, None::<&str>)?;
    let show = MenuItem::with_id(app, SHOW, "오버레이 표시", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, HIDE, "오버레이 숨김", true, None::<&str>)?;
    let exit = MenuItem::with_id(app, EXIT, "종료", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&status, &show, &hide, &exit])?;
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
            EXIT => {
                shutdown(app);
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    app.manage(Control {
        intent: AtomicU8::new(HIDDEN),
        operation: Mutex::new(()),
        status,
    });
    dispatch(app.handle(), VISIBLE);
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

    WebviewWindowBuilder::from_config(app, config)?.build()
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
    let window = match app.get_webview_window("overlay") {
        Some(window) => window,
        None => create(app)?,
    };
    // A hide or focus-safety request received during creation takes priority.
    if app.state::<Control>().intent.load(Ordering::SeqCst) != VISIBLE {
        return request_hide(app);
    }
    show_safely(&window)?;
    if app.state::<Control>().intent.load(Ordering::SeqCst) != VISIBLE {
        return request_hide(app);
    }
    app.state::<Control>().status.set_text("오버레이: 표시 중")
}

fn request_hide(app: &AppHandle) -> tauri::Result<()> {
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
            crate::native_windows::verify(&window.as_ref().window())?;
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
    action: fn(&WebviewWindow) -> tauri::Result<()>,
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

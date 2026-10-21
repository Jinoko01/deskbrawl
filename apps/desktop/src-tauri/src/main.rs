#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Manager, WindowEvent};

mod local_game;
#[cfg(windows)]
mod native_windows;
mod overlay;

fn main() -> tauri::Result<()> {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            overlay::overlay_reduced_effects,
            overlay::overlay_renderer_failed,
            local_game::local_available,
            local_game::local_control,
            local_game::local_overlay_status
        ])
        .setup(|app| {
            app.manage(local_game::LocalSession::default());
            // A shortcut owned by another app must not block the overlay itself.
            #[cfg(windows)]
            if let Some(main) = app.get_webview_window("main") {
                if let Err(error) = native_windows::watch_play_hotkey(&main.as_ref().window()) {
                    eprintln!("Ctrl+Shift+G registration failed: {error}");
                }
            }
            overlay::setup(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            overlay::on_window_event(window, event);
            local_game::on_window_event(window, event);
            // A hidden overlay must not keep the app alive after main is closed.
            if window.label() == "main" && matches!(event, WindowEvent::Destroyed) {
                overlay::shutdown(window.app_handle());
                window.app_handle().exit(0);
            }
        })
        .run(tauri::generate_context!())
}

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Manager, WindowEvent};

mod chat;
mod clipboard;
mod controls;
mod local_game;
#[cfg(windows)]
mod native_keyboard;
#[cfg(windows)]
mod native_windows;
mod network;
mod overlay;

fn main() -> tauri::Result<()> {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(main) = app.get_webview_window("main") {
                if let Err(error) = main
                    .unminimize()
                    .and_then(|_| main.show())
                    .and_then(|_| main.set_focus())
                {
                    eprintln!("Could not show DeskBrawl: {error}");
                }
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .invoke_handler(tauri::generate_handler![
            overlay::overlay_reduced_effects,
            overlay::preview_reduced_effects,
            overlay::overlay_renderer_failed,
            overlay::focus_read,
            overlay::focus_set,
            overlay::invite_publish,
            overlay::app_exit,
            chat::chat_open,
            chat::chat_update,
            chat::chat_close,
            local_game::local_available,
            local_game::local_control,
            local_game::local_overlay_status,
            controls::local_controls,
            controls::local_set_controls,
            network::network_publish,
            network::network_read,
            network::network_bounds,
            network::credential_read,
            network::credential_write
        ])
        .setup(|app| {
            app.manage(local_game::LocalSession::default());
            app.manage(network::NetworkState::default());
            app.manage(controls::ControlState::default());
            app.manage(chat::ChatState::default());
            #[cfg(windows)]
            if let Some(main) = app.get_webview_window("main") {
                native_windows::watch_play_hotkey(&main.as_ref().window())?;
            }
            // Registration waits for the saved shortcut; a failure leaves the tray fallback.
            controls::load(app.handle());
            overlay::setup(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            overlay::on_window_event(window, event);
            local_game::on_window_event(window, event);
            chat::on_window_event(window, event);
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    overlay::request_exit(window.app_handle());
                }
            }
            // An unexpected WebView destruction must not leave an invisible app behind.
            if window.label() == "main" && matches!(event, WindowEvent::Destroyed) {
                overlay::exit_app(window.app_handle());
            }
        })
        .run(tauri::generate_context!())
}

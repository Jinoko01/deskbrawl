#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Manager, WindowEvent};

fn main() -> tauri::Result<()> {
    tauri::Builder::default()
        .on_window_event(|window, event| {
            // A hidden overlay must not keep the app alive after main is closed.
            if window.label() == "main" && matches!(event, WindowEvent::Destroyed) {
                window.app_handle().exit(0);
            }
        })
        .run(tauri::generate_context!())
}

use std::sync::{
    atomic::{AtomicU8, Ordering},
    mpsc, Mutex,
};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

// Game key order shared with the main webview: up, left, down, right, melee, stone.
const DEFAULT_KEYS: [&str; 6] = [
    "ArrowUp",
    "ArrowLeft",
    "ArrowDown",
    "ArrowRight",
    "KeyZ",
    "KeyX",
];
const DEFAULT_TOGGLE: &str = "Ctrl+Shift+KeyG";
const NAMES: [&str; 7] = ["up", "left", "down", "right", "melee", "stone", "toggle"];
const LOADING: u8 = 0;
const REGISTERED: u8 = 1;
const UNAVAILABLE: u8 = 2;

#[derive(Clone, PartialEq, Debug)]
struct Controls {
    keys: [String; 6],
    toggle: String,
}

impl Default for Controls {
    fn default() -> Self {
        Self {
            keys: DEFAULT_KEYS.map(String::from),
            toggle: DEFAULT_TOGGLE.into(),
        }
    }
}

pub struct ControlState {
    current: Mutex<Controls>,
    // Serializes saves so a file write and its shortcut registration stay paired.
    saving: Mutex<()>,
    shortcut: AtomicU8,
}

impl Default for ControlState {
    fn default() -> Self {
        Self {
            current: Mutex::new(Controls::default()),
            saving: Mutex::new(()),
            shortcut: AtomicU8::new(LOADING),
        }
    }
}

fn game_key(code: &str) -> bool {
    let single = |prefix: &str, range: std::ops::RangeInclusive<char>| {
        code.strip_prefix(prefix).is_some_and(|rest| {
            let mut chars = rest.chars();
            matches!((chars.next(), chars.next()), (Some(c), None) if range.contains(&c))
        })
    };
    single("Key", 'A'..='Z')
        || single("Digit", '0'..='9')
        || single("Numpad", '0'..='9')
        || matches!(
            code,
            "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Space"
        )
}

// Returns RegisterHotKey modifiers and virtual key. At least two modifiers, one
// of them Ctrl or Alt, keep the shortcut clear of typing and single-modifier
// OS/IDE shortcuts such as Ctrl+C or Alt+F4. The Win key is reserved by Windows.
fn shortcut(value: &str) -> Option<(u32, u32)> {
    let mut parts: Vec<&str> = value.split('+').collect();
    let key = parts.pop()?;
    let mut modifiers = 0;
    let mut count = 0;
    for (name, flag) in [("Ctrl", 0x0002), ("Alt", 0x0001), ("Shift", 0x0004)] {
        if parts.first() == Some(&name) {
            parts.remove(0);
            modifiers |= flag;
            count += 1;
        }
    }
    if !parts.is_empty() || count < 2 || modifiers & 0x0003 == 0 {
        return None;
    }
    let letter = |prefix: &str, range: std::ops::RangeInclusive<char>| {
        key.strip_prefix(prefix).and_then(|rest| {
            let mut chars = rest.chars();
            match (chars.next(), chars.next()) {
                (Some(c), None) if range.contains(&c) => Some(c as u32),
                _ => None,
            }
        })
    };
    let virtual_key = letter("Key", 'A'..='Z')
        .or_else(|| letter("Digit", '0'..='9'))
        .or_else(|| {
            key.strip_prefix('F')
                .and_then(|n| n.parse::<u32>().ok())
                .filter(|n| (1..=12).contains(n) && key.len() <= 3 && !key[1..].starts_with('0'))
                .map(|n| 0x6f + n)
        })?;
    Some((modifiers, virtual_key))
}

fn validate(keys: &[String], toggle: &str) -> Result<Controls, &'static str> {
    let keys: [String; 6] = keys.to_vec().try_into().map_err(|_| "INVALID_CONTROLS")?;
    if keys.iter().any(|key| !game_key(key)) {
        return Err("INVALID_KEY");
    }
    for (index, key) in keys.iter().enumerate() {
        if keys[..index].contains(key) {
            return Err("DUPLICATE_KEY");
        }
    }
    shortcut(toggle).ok_or("INVALID_SHORTCUT")?;
    Ok(Controls {
        keys,
        toggle: toggle.into(),
    })
}

fn serialize(controls: &Controls) -> String {
    NAMES
        .iter()
        .zip(controls.keys.iter().chain([&controls.toggle]))
        .map(|(name, value)| format!("{name}={value}\n"))
        .collect()
}

fn parse(text: &str) -> Option<Controls> {
    let mut values = Vec::new();
    for (line, name) in text.lines().zip(NAMES) {
        values.push(line.strip_prefix(name)?.strip_prefix('=')?.to_string());
    }
    if values.len() != NAMES.len() || text.lines().count() != NAMES.len() {
        return None;
    }
    let toggle = values.pop()?;
    validate(&values, &toggle).ok()
}

fn path(app: &AppHandle) -> std::io::Result<std::path::PathBuf> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(std::io::Error::other)?
        .join("controls"))
}

fn on_main(
    app: &AppHandle,
    action: impl FnOnce(&WebviewWindow) -> Result<(), &'static str> + Send + 'static,
) -> Result<(), &'static str> {
    let window = app.get_webview_window("main").ok_or("MAIN_UNAVAILABLE")?;
    let (sender, receiver) = mpsc::sync_channel(1);
    let target = window.clone();
    window
        .run_on_main_thread(move || {
            let _ = sender.send(action(&target));
        })
        .map_err(|_| "MAIN_UNAVAILABLE")?;
    receiver
        .recv_timeout(Duration::from_secs(5))
        .map_err(|_| "MAIN_UNAVAILABLE")?
}

#[cfg(windows)]
fn register(app: &AppHandle, toggle: String) -> Result<(), &'static str> {
    let (modifiers, key) = shortcut(&toggle).ok_or("INVALID_SHORTCUT")?;
    on_main(app, move |window| {
        crate::native_windows::register_play_hotkey(&window.as_ref().window(), modifiers, key)
            .map_err(|_| "SHORTCUT_IN_USE")
    })
}

#[cfg(not(windows))]
fn register(_app: &AppHandle, _toggle: String) -> Result<(), &'static str> {
    Err("SHORTCUT_UNSUPPORTED")
}

fn status(app: &AppHandle) -> &'static str {
    match app.state::<ControlState>().shortcut.load(Ordering::SeqCst) {
        LOADING => "loading",
        REGISTERED => "registered",
        _ => "unavailable",
    }
}

fn snapshot(app: &AppHandle) -> Result<(Vec<String>, &'static str), &'static str> {
    let current = app
        .state::<ControlState>()
        .current
        .lock()
        .map_err(|_| "CONTROLS_UNAVAILABLE")?
        .clone();
    let mut values = current.keys.to_vec();
    values.push(current.toggle);
    Ok((values, status(app)))
}

fn announce(app: &AppHandle) {
    match snapshot(app) {
        Ok(value) => {
            if let Err(error) = app.emit_to("main", "local-controls-changed", value) {
                eprintln!("Controls update failed: {error}");
            }
        }
        Err(error) => eprintln!("Controls update failed: {error}"),
    }
}

// Reads the saved controls on a worker, then registers the toggle shortcut.
// A shortcut owned by another app leaves the game usable through the tray menu.
pub fn load(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let controls = match path(&app).and_then(std::fs::read_to_string) {
            Ok(text) => parse(&text).unwrap_or_else(|| {
                eprintln!("Invalid controls file, using defaults");
                Controls::default()
            }),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Controls::default(),
            Err(error) => {
                eprintln!("Could not read controls: {error}");
                Controls::default()
            }
        };
        let state = app.state::<ControlState>();
        let registered = register(&app, controls.toggle.clone());
        if let Err(error) = &registered {
            eprintln!("Play shortcut registration failed: {error}");
        }
        if let Ok(mut current) = state.current.lock() {
            *current = controls;
        }
        state.shortcut.store(
            if registered.is_ok() {
                REGISTERED
            } else {
                UNAVAILABLE
            },
            Ordering::SeqCst,
        );
        announce(&app);
    });
}

#[tauri::command]
pub fn local_controls(window: WebviewWindow) -> Result<(Vec<String>, &'static str), &'static str> {
    if window.label() != "main" {
        return Err("MAIN_ONLY");
    }
    snapshot(window.app_handle())
}

#[tauri::command]
pub async fn local_set_controls(
    window: WebviewWindow,
    keys: Vec<String>,
    toggle: String,
) -> Result<(), &'static str> {
    if window.label() != "main" {
        return Err("MAIN_ONLY");
    }
    if keys.len() != 6 || keys.iter().chain([&toggle]).any(|value| value.len() > 32) {
        return Err("INVALID_CONTROLS");
    }
    let next = validate(&keys, &toggle)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<ControlState>();
        let _saving = state.saving.lock().map_err(|_| "CONTROLS_UNAVAILABLE")?;
        if state.shortcut.load(Ordering::SeqCst) == LOADING {
            return Err("CONTROLS_LOADING");
        }
        // Settings are edited in WORK only; game keys must not change under a held key.
        if crate::local_game::playing(&app) {
            return Err("PLAYING");
        }
        let previous = state
            .current
            .lock()
            .map_err(|_| "CONTROLS_UNAVAILABLE")?
            .clone();
        let was_registered = state.shortcut.load(Ordering::SeqCst) == REGISTERED;
        let reregister = next.toggle != previous.toggle || !was_registered;
        if reregister {
            if let Err(error) = register(&app, next.toggle.clone()) {
                // Keep the previous working shortcut when the new one is taken.
                if was_registered && register(&app, previous.toggle.clone()).is_err() {
                    state.shortcut.store(UNAVAILABLE, Ordering::SeqCst);
                    announce(&app);
                }
                return Err(error);
            }
            state.shortcut.store(REGISTERED, Ordering::SeqCst);
        }
        let saved = path(&app).and_then(|file| {
            if let Some(directory) = file.parent() {
                std::fs::create_dir_all(directory)?;
            }
            std::fs::write(file, serialize(&next))
        });
        if let Err(error) = saved {
            eprintln!("Could not save controls: {error}");
            if reregister {
                let restored = was_registered && register(&app, previous.toggle).is_ok();
                state.shortcut.store(
                    if restored { REGISTERED } else { UNAVAILABLE },
                    Ordering::SeqCst,
                );
                announce(&app);
            }
            return Err("SAVE_FAILED");
        }
        *state.current.lock().map_err(|_| "CONTROLS_UNAVAILABLE")? = next;
        announce(&app);
        Ok(())
    })
    .await
    .map_err(|_| "CONTROLS_UNAVAILABLE")?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keys(values: [&str; 6]) -> Vec<String> {
        values.map(String::from).to_vec()
    }

    #[test]
    fn defaults_round_trip_through_the_file_format() {
        let controls = Controls::default();
        assert_eq!(parse(&serialize(&controls)), Some(controls));
    }

    #[test]
    fn invalid_files_are_rejected() {
        let text = serialize(&Controls::default());
        assert_eq!(parse(""), None);
        assert_eq!(parse(&text.replace("KeyZ", "KeyX")), None);
        assert_eq!(parse(&text.replace("up=", "down=")), None);
        assert_eq!(parse(&format!("{text}extra=1\n")), None);
    }

    #[test]
    fn game_keys_must_be_allowed_and_unique() {
        assert!(validate(
            &keys(["KeyW", "KeyA", "KeyS", "KeyD", "KeyJ", "KeyK"]),
            DEFAULT_TOGGLE
        )
        .is_ok());
        assert!(validate(
            &keys(["Numpad8", "Numpad4", "Numpad2", "Numpad6", "Numpad7", "Numpad9"]),
            DEFAULT_TOGGLE
        )
        .is_ok());
        assert_eq!(
            validate(
                &keys([
                    "ArrowUp",
                    "ArrowLeft",
                    "ArrowDown",
                    "ArrowRight",
                    "KeyZ",
                    "KeyZ"
                ]),
                DEFAULT_TOGGLE
            ),
            Err("DUPLICATE_KEY")
        );
        for invalid in ["Escape", "Tab", "KeyAB", "Key", "F1", "ControlLeft", ""] {
            assert_eq!(
                validate(
                    &keys([
                        "ArrowUp",
                        "ArrowLeft",
                        "ArrowDown",
                        "ArrowRight",
                        "KeyZ",
                        invalid
                    ]),
                    DEFAULT_TOGGLE
                ),
                Err("INVALID_KEY"),
                "{invalid}"
            );
        }
        assert_eq!(
            validate(&keys(["ArrowUp"; 6])[..5], DEFAULT_TOGGLE),
            Err("INVALID_CONTROLS")
        );
    }

    #[test]
    fn shortcuts_need_two_modifiers_including_ctrl_or_alt() {
        assert_eq!(shortcut("Ctrl+Shift+KeyG"), Some((0x0006, 0x47)));
        assert_eq!(shortcut("Ctrl+Alt+Digit1"), Some((0x0003, 0x31)));
        assert_eq!(shortcut("Ctrl+Shift+F12"), Some((0x0006, 0x7b)));
        assert_eq!(shortcut("Alt+Shift+F1"), Some((0x0005, 0x70)));
        for invalid in [
            "Ctrl+KeyC",
            "Alt+F4",
            "Shift+KeyG",
            "KeyG",
            "Ctrl+Shift+Escape",
            "Shift+Ctrl+KeyG",
            "Ctrl+Ctrl+KeyG",
            "Ctrl+Shift+F13",
            "Ctrl+Shift+F01",
            "Ctrl+Shift+ArrowUp",
            "Win+Shift+KeyG",
        ] {
            assert_eq!(shortcut(invalid), None, "{invalid}");
        }
    }
}

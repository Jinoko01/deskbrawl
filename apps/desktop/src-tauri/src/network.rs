use std::sync::Mutex;
use tauri::{
    ipc::{InvokeBody, Request},
    Emitter, Manager, WebviewWindow,
};

pub struct NetworkState(pub Mutex<String>);
impl Default for NetworkState {
    fn default() -> Self {
        Self(Mutex::new(
            "{\"mode\":\"local\",\"snapshot\":null}".to_owned(),
        ))
    }
}

pub fn play_allowed(app: &tauri::AppHandle) -> bool {
    app.state::<NetworkState>()
        .0
        .lock()
        .ok()
        .and_then(|state| serde_json::from_str::<serde_json::Value>(&state).ok())
        .is_some_and(|state| state["mode"] != "offline" && state["mode"] != "recovering")
}

pub fn chat_allowed(app: &tauri::AppHandle) -> bool {
    app.state::<NetworkState>()
        .0
        .lock()
        .ok()
        .and_then(|state| serde_json::from_str::<serde_json::Value>(&state).ok())
        .is_some_and(|state| matches!(state["mode"].as_str(), Some("host" | "guest")))
}

#[tauri::command]
pub fn network_publish(window: WebviewWindow, request: Request<'_>) -> Result<(), &'static str> {
    if window.label() != "main" {
        return Err("MAIN_ONLY");
    }
    let InvokeBody::Json(value) = request.body() else {
        return Err("INVALID_NETWORK_STATE");
    };
    let fields = value.as_object().ok_or("INVALID_NETWORK_STATE")?;
    let mode = fields
        .get("mode")
        .and_then(|v| v.as_str())
        .ok_or("INVALID_NETWORK_STATE")?;
    if fields.len() != 2 || !matches!(mode, "local" | "host" | "guest" | "offline" | "recovering") {
        return Err("INVALID_NETWORK_STATE");
    }
    let snapshot = fields.get("snapshot").ok_or("INVALID_NETWORK_STATE")?;
    if !snapshot.is_null() {
        let world = snapshot.get("world").ok_or("INVALID_NETWORK_STATE")?;
        if snapshot.get("version").and_then(|v| v.as_u64()) != Some(2)
            || world
                .get("players")
                .and_then(|v| v.as_array())
                .is_none_or(|v| v.len() > 6)
            || world
                .get("projectiles")
                .and_then(|v| v.as_array())
                .is_none_or(|v| v.len() > 32)
            || world
                .get("effects")
                .and_then(|v| v.as_array())
                .is_none_or(|v| v.len() > 64)
        {
            return Err("INVALID_NETWORK_STATE");
        }
    }
    let message = value.to_string();
    if message.len() > 65536 {
        return Err("INVALID_NETWORK_STATE");
    }
    let changed = {
        let state = window.state::<NetworkState>();
        let mut current = state.0.lock().map_err(|_| "NETWORK_STATE_FAILED")?;
        let before: serde_json::Value =
            serde_json::from_str(&current).map_err(|_| "NETWORK_STATE_FAILED")?;
        let changed = before["mode"] != value["mode"]
            || before["snapshot"]["worldId"] != value["snapshot"]["worldId"];
        *current = message.clone();
        changed
    };
    if changed {
        crate::chat::dismiss(window.app_handle());
        crate::local_game::end_play(window.app_handle());
    }
    window
        .emit_to("overlay", "network-world", message)
        .map_err(|_| "NETWORK_EVENT_FAILED")
}

#[tauri::command]
pub fn network_read(window: WebviewWindow) -> Result<String, &'static str> {
    if window.label() != "overlay" {
        return Err("OVERLAY_ONLY");
    }
    Ok(window
        .state::<NetworkState>()
        .0
        .lock()
        .map_err(|_| "NETWORK_STATE_FAILED")?
        .clone())
}

#[tauri::command]
pub fn network_bounds(window: WebviewWindow) -> Result<Vec<f64>, &'static str> {
    if window.label() != "main" {
        return Err("MAIN_ONLY");
    }
    let monitor = window
        .primary_monitor()
        .map_err(|_| "MONITOR_FAILED")?
        .ok_or("MONITOR_FAILED")?;
    let scale = monitor.scale_factor();
    Ok(vec![
        f64::from(monitor.size().width) / scale,
        f64::from(monitor.size().height) / scale,
    ])
}

#[tauri::command]
pub async fn credential_read(window: WebviewWindow) -> Result<Option<String>, &'static str> {
    if window.label() != "main" {
        return Err("MAIN_ONLY");
    }
    let path = window
        .path()
        .app_local_data_dir()
        .map_err(|_| "CREDENTIAL_PATH_FAILED")?
        .join("device-credential.bin");
    tauri::async_runtime::spawn_blocking(move || {
        if !path.exists() {
            return Ok(None);
        }
        let bytes = std::fs::read(path).map_err(|_| "CREDENTIAL_READ_FAILED")?;
        if bytes.len() > 16384 {
            return Err("INVALID_CREDENTIAL");
        }
        let plain = protect(&bytes, false)?;
        String::from_utf8(plain)
            .map(Some)
            .map_err(|_| "INVALID_CREDENTIAL")
    })
    .await
    .map_err(|_| "CREDENTIAL_READ_FAILED")?
}

#[tauri::command]
pub async fn credential_write(
    window: WebviewWindow,
    credential: String,
) -> Result<(), &'static str> {
    if window.label() != "main" {
        return Err("MAIN_ONLY");
    }
    if credential.len() > 4096 || credential.is_empty() {
        return Err("INVALID_CREDENTIAL");
    }
    let directory = window
        .path()
        .app_local_data_dir()
        .map_err(|_| "CREDENTIAL_PATH_FAILED")?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut plain = credential.into_bytes();
        let encrypted = protect(&plain, true);
        plain.fill(0);
        let encrypted = encrypted?;
        std::fs::create_dir_all(&directory).map_err(|_| "CREDENTIAL_WRITE_FAILED")?;
        // Only protected bytes reach disk, including the temporary file.
        let temporary = directory.join("device-credential.tmp");
        std::fs::write(&temporary, encrypted).map_err(|_| "CREDENTIAL_WRITE_FAILED")?;
        std::fs::rename(temporary, directory.join("device-credential.bin"))
            .map_err(|_| "CREDENTIAL_WRITE_FAILED")
    })
    .await
    .map_err(|_| "CREDENTIAL_WRITE_FAILED")?
}

#[cfg(not(windows))]
fn protect(_bytes: &[u8], _encrypt: bool) -> Result<Vec<u8>, &'static str> {
    Err("WINDOWS_REQUIRED")
}

#[cfg(windows)]
fn protect(bytes: &[u8], encrypt: bool) -> Result<Vec<u8>, &'static str> {
    use std::ffi::c_void;
    #[repr(C)]
    struct Blob {
        len: u32,
        data: *mut u8,
    }
    #[link(name = "crypt32")]
    unsafe extern "system" {
        fn CryptProtectData(
            input: *const Blob,
            description: *const u16,
            entropy: *const Blob,
            reserved: *mut c_void,
            prompt: *mut c_void,
            flags: u32,
            output: *mut Blob,
        ) -> i32;
        fn CryptUnprotectData(
            input: *const Blob,
            description: *mut *mut u16,
            entropy: *const Blob,
            reserved: *mut c_void,
            prompt: *mut c_void,
            flags: u32,
            output: *mut Blob,
        ) -> i32;
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn LocalFree(memory: *mut c_void) -> *mut c_void;
    }
    struct ProtectedBlob(Blob);
    impl Drop for ProtectedBlob {
        fn drop(&mut self) {
            if !self.0.data.is_null() {
                // SAFETY: DPAPI returned this allocation and size. Clear before returning it to LocalFree.
                unsafe {
                    std::ptr::write_bytes(self.0.data, 0, self.0.len as usize);
                    LocalFree(self.0.data.cast());
                }
            }
        }
    }
    let input = Blob {
        len: u32::try_from(bytes.len()).map_err(|_| "INVALID_CREDENTIAL")?,
        data: bytes.as_ptr().cast_mut(),
    };
    let mut output = ProtectedBlob(Blob {
        len: 0,
        data: std::ptr::null_mut(),
    });
    // SAFETY: input references bytes for the entire call. Optional parameters are null;
    // CRYPTPROTECT_UI_FORBIDDEN prevents prompts, and output is owned by the RAII guard.
    let result = unsafe {
        if encrypt {
            CryptProtectData(
                &input,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                1,
                &mut output.0,
            )
        } else {
            CryptUnprotectData(
                &input,
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                1,
                &mut output.0,
            )
        }
    };
    if result == 0 || output.0.data.is_null() {
        return Err("CREDENTIAL_PROTECTION_FAILED");
    }
    // SAFETY: successful DPAPI call initialized output with a valid allocation of len bytes.
    Ok(unsafe { std::slice::from_raw_parts(output.0.data, output.0.len as usize) }.to_vec())
}

#[cfg(all(test, windows))]
mod tests {
    use super::protect;
    #[test]
    fn device_secret_is_protected_and_round_trips() {
        let plain = b"deskbrawl-test-device-secret";
        let encrypted = protect(plain, true).expect("protect fixture");
        assert_ne!(encrypted, plain);
        assert_eq!(
            protect(&encrypted, false).expect("unprotect fixture"),
            plain
        );
        assert!(protect(b"invalid blob", false).is_err());
    }
}

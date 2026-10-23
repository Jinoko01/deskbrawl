use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{Emitter, Manager, WebviewWindow};

#[derive(Clone)]
pub struct Region {
    pub id: String,
    pub rect: [f64; 4],
    pub scale: f64,
}

#[derive(Default)]
pub struct DragRegions {
    pub regions: Mutex<Vec<Region>>,
    pub available: AtomicBool,
}

pub fn clear(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<DragRegions>() {
        if let Ok(mut regions) = state.regions.lock() {
            regions.clear();
        }
    }
}

#[tauri::command]
pub fn overlay_drag_regions(
    window: WebviewWindow,
    regions: Vec<(String, f64, f64, f64, f64)>,
) -> Result<(), &'static str> {
    if window.label() != "overlay" {
        return Err("OVERLAY_ONLY");
    }
    let state = window.state::<DragRegions>();
    if !regions.is_empty() && !state.available.load(Ordering::SeqCst) {
        return Err("DRAG_UNAVAILABLE");
    }
    let scale = window.scale_factor().map_err(|_| "DRAG_GEOMETRY_FAILED")?;
    let origin = window
        .outer_position()
        .map_err(|_| "DRAG_GEOMETRY_FAILED")?;
    let size = window.inner_size().map_err(|_| "DRAG_GEOMETRY_FAILED")?;
    if regions.len() > 6 || !scale.is_finite() || scale <= 0.0 {
        return Err("INVALID_DRAG_REGIONS");
    }
    let mut validated = Vec::new();
    for (id, left, top, right, bottom) in regions {
        if id.is_empty()
            || id.len() > 128
            || ![left, top, right, bottom]
                .iter()
                .all(|value| value.is_finite())
            || left < 0.0
            || top < 0.0
            || right <= left
            || bottom <= top
            || right * scale > f64::from(size.width) + 1.0
            || bottom * scale > f64::from(size.height) + 1.0
            || right - left > 256.0
            || bottom - top > 256.0
        {
            return Err("INVALID_DRAG_REGIONS");
        }
        validated.push(Region {
            id,
            scale,
            rect: [
                f64::from(origin.x) + left * scale,
                f64::from(origin.y) + top * scale,
                f64::from(origin.x) + right * scale,
                f64::from(origin.y) + bottom * scale,
            ],
        });
    }
    *state.regions.lock().map_err(|_| "DRAG_STATE_FAILED")? = validated;
    Ok(())
}

#[tauri::command]
pub fn overlay_place(
    window: WebviewWindow,
    player_id: String,
    x: f64,
    y: f64,
) -> Result<(), &'static str> {
    if window.label() != "overlay" {
        return Err("OVERLAY_ONLY");
    }
    let app = window.app_handle();
    if crate::local_game::playing(app)
        || crate::local_game::capturing(app)
        || crate::overlay::focused(app)
    {
        return Err("WORK_ONLY");
    }
    let raw = app
        .state::<crate::network::NetworkState>()
        .0
        .lock()
        .map_err(|_| "NETWORK_STATE_FAILED")?
        .clone();
    let state: serde_json::Value =
        serde_json::from_str(&raw).map_err(|_| "INVALID_NETWORK_STATE")?;
    if !matches!(state["mode"].as_str(), Some("host" | "guest"))
        || state["playerId"].as_str() != Some(&player_id)
    {
        return Err("OWN_CHARACTER_ONLY");
    }
    if !x.is_finite()
        || !y.is_finite()
        || !(0.0..=16384.0).contains(&x)
        || !(0.0..=16384.0).contains(&y)
    {
        return Err("INVALID_POSITION");
    }
    app.emit_to("main", "character-place", (x, y))
        .map_err(|_| "DRAG_EVENT_FAILED")
}

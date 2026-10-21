fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "overlay_reduced_effects",
            "preview_reduced_effects",
            "overlay_renderer_failed",
            "local_available",
            "local_control",
            "local_overlay_status",
            "local_controls",
            "local_set_controls",
            "network_publish",
            "network_read",
            "network_bounds",
            "credential_read",
            "credential_write",
        ]),
    ))
    .unwrap_or_else(|error| {
        eprintln!("{error}");
        std::process::exit(1);
    });
}

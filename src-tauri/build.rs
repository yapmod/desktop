const COMMANDS: &[&str] = &[
    "open_yapin",
    "set_integrated_titlebar",
    "window_caption",
    "desktop_info",
    "desktop_update",
    "desktop_notify",
    "desktop_close_notification",
    "notification_permission",
];

fn main() {
    let manifest = tauri_build::AppManifest::new().commands(COMMANDS);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
        .expect("cannot prepare the desktop configuration");
}

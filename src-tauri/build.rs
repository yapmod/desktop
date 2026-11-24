const COMMANDS: &[&str] = &[
    "open_yapin",
    "tray_start",
    "tray_exchange",
    "tray_stop",
    "desktop_set_badge",
    "desktop_set_blur",
    "yaplay_start",
    "yaplay_exchange",
    "yaplay_stop",
    "set_integrated_titlebar",
    "window_caption",
    "desktop_info",
    "desktop_update",
    "desktop_notify",
    "desktop_close_notification",
    "notification_permission",
];

fn main() {
    for path in [
        "../plugin/src",
        "../plugin/manifest.json",
        "../scripts/build-plugin.mjs",
        "../pnpm-lock.yaml",
    ] {
        println!("cargo:rerun-if-changed={path}");
    }
    let output = std::env::var_os("OUT_DIR").expect("Cargo sets OUT_DIR");
    let status = std::process::Command::new("node")
        .arg("../scripts/build-plugin.mjs")
        .arg(output)
        .status()
        .expect("Node.js is required to build the Yapmod plugin");
    assert!(
        status.success(),
        "Plugin build failed. Run pnpm install --frozen-lockfile before building."
    );

    let manifest = tauri_build::AppManifest::new().commands(COMMANDS);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
        .expect("cannot prepare the desktop configuration");
}

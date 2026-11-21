#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bundles;
mod navigation;
mod notifications;
mod permissions;
#[cfg(target_os = "macos")]
mod popup_macos;
mod titlebar;
mod updates;
mod window;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .on_permission_request(permissions::request)
        .invoke_system(include_str!("../webview/ipc.js"))
        .plugin(notifications::native_plugin())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(titlebar::TitlebarLayout::default())
        .manage(updates::UpdateLock::default())
        .invoke_handler(tauri::generate_handler![
            window::open_yapin,
            titlebar::set_integrated_titlebar,
            titlebar::window_caption,
            updates::desktop_info,
            updates::desktop_update,
            notifications::notification_permission,
            notifications::desktop_notify,
            notifications::desktop_close_notification,
        ])
        .setup(|app| {
            app.manage(bundles::BundleStore::new(app.path().app_cache_dir()?));
            notifications::install(app.handle())?;
            window::create(app.handle())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("could not start Yapmod Desktop");
}

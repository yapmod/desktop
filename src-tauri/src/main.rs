#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod badge;
mod blur;
mod bundles;
mod navigation;
mod notifications;
mod permissions;
#[cfg(target_os = "macos")]
mod popup_macos;
mod titlebar;
mod tray;
mod updates;
mod window;
mod yaplay;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .on_permission_request(permissions::request)
        .invoke_system(include_str!("../webview/ipc.js"))
        .plugin(notifications::native_plugin())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(tray::TrayState::default())
        .manage(titlebar::TitlebarLayout::default())
        .manage(updates::UpdateLock::default())
        .invoke_handler(tauri::generate_handler![
            window::open_yapin,
            tray::tray_start,
            tray::tray_exchange,
            tray::tray_stop,
            badge::desktop_set_badge,
            blur::desktop_set_blur,
            yaplay::yaplay_start,
            yaplay::yaplay_exchange,
            yaplay::yaplay_stop,
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
            yaplay::install(app.handle());
            window::create(app.handle())?;
            if let Err(error) = tray::install(app.handle()) {
                eprintln!("Could not create the system tray: {error}");
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("could not start Yapmod Desktop")
        .run(|_app, _event| {
            #[cfg(target_os = "macos")]
            if matches!(_event, tauri::RunEvent::Reopen { .. }) {
                window::show(_app);
            }
        });
}

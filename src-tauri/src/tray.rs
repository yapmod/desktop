use tauri::{
    AppHandle,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

pub const ID: &str = "desktop-tray";

pub fn install(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let open = MenuItem::with_id(app, "tray-open", "Open Yapmod Desktop", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "tray-quit", "Quit Yapmod Desktop", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &separator, &quit])?;
    let icon = app
        .default_window_icon()
        .ok_or("The app icon is unavailable")?;
    TrayIconBuilder::with_id(ID)
        .icon(icon.clone())
        .tooltip("Yapmod Desktop")
        .menu(&menu)
        .show_menu_on_left_click(!cfg!(target_os = "windows"))
        .on_menu_event(|app, event| match event.id.as_ref() {
            "tray-open" => crate::window::show(app),
            "tray-quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if cfg!(target_os = "windows")
                && matches!(
                    event,
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    }
                )
            {
                crate::window::show(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

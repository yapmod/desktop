use tauri::{Webview, Window};

#[cfg(target_os = "macos")]
fn apply(window: &Window, enabled: bool) -> Result<bool, String> {
    use window_vibrancy::{NSVisualEffectMaterial, apply_vibrancy, clear_vibrancy};
    if enabled {
        clear_vibrancy(window).map_err(|error| error.to_string())?;
        apply_vibrancy(window, NSVisualEffectMaterial::Sidebar, None, None)
    } else {
        clear_vibrancy(window).map(|_| ())
    }
    .map(|()| true)
    .map_err(|error| error.to_string())
}

#[cfg(target_os = "windows")]
fn apply(window: &Window, enabled: bool) -> Result<bool, String> {
    if enabled {
        window_vibrancy::apply_acrylic(window, None)
    } else {
        window_vibrancy::clear_acrylic(window)
    }
    .map(|()| true)
    .map_err(|error| error.to_string())
}

#[cfg(target_os = "linux")]
fn apply(window: &Window, enabled: bool) -> Result<bool, String> {
    use gtk::{gdk, prelude::*};
    let top = window.gtk_window().map_err(|error| error.to_string())?;
    let surface = WidgetExt::window(&top).ok_or("Window is unavailable.")?;
    let Ok(screen) = surface.screen().downcast::<gdkx11::X11Screen>() else {
        return Ok(false);
    };
    let hint = gdk::Atom::intern("_KDE_NET_WM_BLUR_BEHIND_REGION");
    if !screen.supports_net_wm_hint(&hint) {
        return Ok(false);
    }
    if enabled {
        gdk::property_change(
            &surface,
            &hint,
            &gdk::Atom::intern("CARDINAL"),
            32,
            gdk::PropMode::Replace,
            gdk::ChangeData::ULongs(&[]),
        );
    } else {
        gdk::property_delete(&surface, &hint);
    }
    Ok(true)
}

#[tauri::command]
pub async fn desktop_set_blur(webview: Webview, enabled: bool) -> Result<bool, String> {
    if webview.label() != "yapin"
        || webview.window().label() != "main"
        || !webview
            .url()
            .is_ok_and(|url| crate::navigation::is_yapin(&url))
    {
        return Err("Background blur requires the main Yapin window.".into());
    }
    let window = webview.window();
    let (send, receive) = tokio::sync::oneshot::channel();
    webview
        .run_on_main_thread(move || {
            let _ = send.send(apply(&window, enabled));
        })
        .map_err(|error| error.to_string())?;
    receive.await.map_err(|error| error.to_string())?
}

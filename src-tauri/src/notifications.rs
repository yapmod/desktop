use std::{
    collections::VecDeque,
    sync::Mutex,
    time::{Duration, Instant},
};

use tauri::{
    AppHandle, Manager, RunEvent, Runtime, Webview,
    plugin::{PermissionState, Plugin, TauriPlugin},
    webview::PageLoadPayload,
};
use tauri_plugin_notification::NotificationExt;

// The upstream plugin also installs a Web Notification polyfill in every
// webview. Yapmod supplies one through its origin-scoped client plugin.
// Forward the upstream native lifecycle while Tauri's default Plugin methods
// keep both initialization scripts and direct plugin IPC absent.
struct NativeNotifications<R: Runtime>(TauriPlugin<R>);

impl<R: Runtime> Plugin<R> for NativeNotifications<R> {
    fn name(&self) -> &'static str {
        self.0.name()
    }

    fn initialize(
        &mut self,
        app: &AppHandle<R>,
        config: serde_json::Value,
    ) -> Result<(), Box<dyn std::error::Error>> {
        self.0.initialize(app, config)
    }

    fn on_page_load(&mut self, webview: &Webview<R>, payload: &PageLoadPayload<'_>) {
        self.0.on_page_load(webview, payload);
    }

    fn on_event(&mut self, app: &AppHandle<R>, event: &RunEvent) {
        self.0.on_event(app, event);
    }
}

pub fn native_plugin<R: Runtime>() -> impl Plugin<R> {
    NativeNotifications(tauri_plugin_notification::init())
}

#[derive(Default)]
struct NotificationBudget(Mutex<VecDeque<Instant>>);

impl NotificationBudget {
    fn admit(&self) -> Result<(), String> {
        let now = Instant::now();
        let mut recent = self.0.lock().map_err(|_| "Notifications unavailable")?;
        recent.retain(|time| now.duration_since(*time) < Duration::from_secs(10));
        if recent.len() >= 12 {
            return Err("Too many notifications".into());
        }
        recent.push_back(now);
        Ok(())
    }
}

fn check_source(webview: &Webview) -> Result<(), String> {
    if webview.label() == "yapin"
        && webview
            .url()
            .is_ok_and(|url| crate::navigation::is_yapin(&url))
    {
        Ok(())
    } else {
        Err("Notifications require the Yapin window".into())
    }
}

#[tauri::command]
pub async fn notification_permission(
    webview: Webview,
    app: AppHandle,
    request: bool,
) -> Result<&'static str, String> {
    check_source(&webview)?;
    let notifications = app.notification();
    let state = if request {
        notifications.request_permission()
    } else {
        notifications.permission_state()
    }
    .map_err(|error| error.to_string())?;
    Ok(match state {
        PermissionState::Granted => "granted",
        PermissionState::Denied => "denied",
        _ => "default",
    })
}

#[tauri::command]
pub async fn desktop_notify(
    webview: Webview,
    app: AppHandle,
    id: i32,
    title: String,
    body: String,
) -> Result<(), String> {
    check_source(&webview)?;
    if id <= 0 || title.trim().is_empty() || title.len() > 512 || body.len() > 4096 {
        return Err("Invalid notification content".into());
    }
    let notifications = app.notification();
    if notifications
        .permission_state()
        .map_err(|error| error.to_string())?
        != PermissionState::Granted
    {
        return Err("Notifications are disabled".into());
    }
    if crate::tray::notifications_snoozed(&app) {
        return Ok(());
    }
    app.state::<NotificationBudget>().admit()?;
    // Freedesktop notification bodies may be interpreted as markup.
    #[cfg(target_os = "linux")]
    let body = body
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");
    notifications
        .builder()
        .id(id)
        .title(title)
        .body(body)
        .show()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn desktop_close_notification(
    webview: Webview,
    app: AppHandle,
    id: i32,
) -> Result<(), String> {
    check_source(&webview)?;
    if id <= 0 {
        return Err("Invalid notification id".into());
    }
    app.notification()
        .remove_active(vec![id])
        .map_err(|error| error.to_string())
}

pub fn install(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    app.manage(NotificationBudget::default());
    let handle = app.clone();
    app.notification().on_action(move |action| {
        if action.action_id() != "tap" {
            return;
        }
        let (Some(notification), Some(webview)) = (action.notification(), handle.get_webview("yapin")) else {
            return;
        };
        crate::window::show(&handle);
        if check_source(&webview).is_ok() {
            let _ = webview.set_focus();
            let id = notification.id();
            // Only the integer id crosses back to the page. The originating document
            // owns the click handler and forgets it when the notification closes.
            let _ = webview.eval(format!(
                "window.dispatchEvent(new CustomEvent('yapmod:desktop-notification-click', {{ detail: {id} }}))"
            ));
        }
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_notifications_do_not_inject_scripts_into_webviews() {
        let plugin = native_plugin::<tauri::Wry>();
        assert!(plugin.initialization_script().is_none());
        assert!(plugin.initialization_script_2().is_none());
    }
}

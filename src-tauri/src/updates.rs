use serde::Serialize;
use std::time::Duration;
use tauri::{AppHandle, Manager, Webview};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_updater::UpdaterExt;
use tokio::sync::Mutex;

#[derive(Default)]
pub struct UpdateLock(Mutex<()>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopInfo {
    version: String,
    platform: &'static str,
    updater_available: bool,
}

fn is_configured(app: &AppHandle) -> bool {
    let Some(config) = app.config().plugins.0.get("updater") else {
        return false;
    };
    let signed = config["pubkey"].as_str().is_some_and(|key| !key.is_empty())
        && config["endpoints"]
            .as_array()
            .is_some_and(|urls| !urls.is_empty());
    // System package managers own .deb installations.
    #[cfg(target_os = "linux")]
    if app.env().appimage.is_none() {
        return false;
    }
    signed
}

#[tauri::command]
pub fn desktop_info(app: AppHandle) -> DesktopInfo {
    DesktopInfo {
        version: app.package_info().version.to_string(),
        platform: std::env::consts::OS,
        updater_available: is_configured(&app),
    }
}

#[tauri::command]
pub async fn desktop_update(
    app: AppHandle,
    webview: Webview,
    install: bool,
) -> Result<Option<String>, String> {
    if !is_configured(&app) {
        return Err("This installation uses manual or system updates.".into());
    }
    let lock = app.state::<UpdateLock>();
    let _guard = lock
        .0
        .try_lock()
        .map_err(|_| "An update check is already in progress.")?;
    let updater = app
        .updater_builder()
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    if install {
        let dialog = app
            .dialog()
            .message(format!(
                "Install Yapmod Desktop {} and restart the application?",
                update.version
            ))
            .title("Yapmod Desktop")
            .parent(&webview.window())
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Install and restart".into(),
                "Later".into(),
            ));
        let (tx, rx) = tokio::sync::oneshot::channel();
        dialog.show(move |ok| {
            let _ = tx.send(ok);
        });
        if rx.await.unwrap_or(false) {
            update
                .download_and_install(|_, _| {}, || {})
                .await
                .map_err(|e| e.to_string())?;
            app.restart();
        }
    }
    Ok(Some(update.version))
}

#[cfg(test)]
mod tests {
    #[test]
    fn local_build_has_a_valid_updater_config_without_release_keys() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let updater: tauri_plugin_updater::Config =
            serde_json::from_value(config["plugins"]["updater"].clone()).unwrap();
        assert!(updater.pubkey.is_empty() && updater.endpoints.is_empty());
    }
}

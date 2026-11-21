use tauri::{
    AppHandle, Manager, Webview,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

pub const ID: &str = "desktop-tray";

use serde::{Deserialize, Serialize};
use std::{
    sync::Mutex,
    time::{Duration, Instant},
};

#[derive(Clone, Default, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CallState {
    available: bool,
    channel_id: Option<String>,
    server_id: Option<String>,
    muted: bool,
    deafened: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reply {
    actions: Vec<crate::yaplay::Action>,
    open_settings: bool,
}

#[derive(Default)]
struct State {
    session: String,
    seen: Option<Instant>,
    call: CallState,
    actions: Vec<crate::yaplay::Action>,
    open_settings: bool,
    snooze_until: Option<Instant>,
}
impl State {
    fn live(&self) -> bool {
        self.seen
            .is_some_and(|seen| seen.elapsed() < Duration::from_secs(5))
    }
    fn snoozed(&self) -> bool {
        self.snooze_until
            .is_some_and(|until| until > Instant::now())
    }
    fn exchange(&mut self, session: &str, call: CallState) -> Result<Reply, String> {
        if self.session != session || session.is_empty() {
            return Err("Tray session expired".into());
        }
        if !self.live()
            || self.call.channel_id != call.channel_id
            || self.call.server_id != call.server_id
        {
            self.actions.clear();
        }
        self.call = call;
        self.seen = Some(Instant::now());
        Ok(Reply {
            actions: std::mem::take(&mut self.actions),
            open_settings: std::mem::take(&mut self.open_settings),
        })
    }
    fn clear(&mut self) {
        self.session.clear();
        self.seen = None;
        self.call = CallState::default();
        self.actions.clear();
        self.open_settings = false;
    }
}
#[derive(Default)]
pub struct TrayState(Mutex<State>);

fn check_source(webview: &Webview) -> Result<(), String> {
    if webview.label() == "yapin"
        && webview
            .url()
            .is_ok_and(|url| crate::navigation::is_yapin(&url))
    {
        Ok(())
    } else {
        Err("Tray controls require the Yapin window".into())
    }
}

#[tauri::command]
pub fn tray_start(webview: Webview, app: AppHandle, session: String) -> Result<(), String> {
    check_source(&webview)?;
    if session.is_empty() || session.len() > 64 {
        return Err("Invalid tray session".into());
    }
    let state = app.state::<TrayState>();
    let mut state = state.0.lock().map_err(|_| "Tray unavailable")?;
    state.clear();
    state.session = session;
    state.seen = Some(Instant::now());
    Ok(())
}

#[tauri::command]
pub fn tray_exchange(
    webview: Webview,
    app: AppHandle,
    session: String,
    call: CallState,
) -> Result<Reply, String> {
    check_source(&webview)?;
    if [&call.channel_id, &call.server_id].iter().any(|id| {
        id.as_ref()
            .is_some_and(|id| id.is_empty() || id.len() > 256)
    }) {
        return Err("Invalid tray call".into());
    }
    let state = app.state::<TrayState>();
    let mut state = state.0.lock().map_err(|_| "Tray unavailable")?;
    state.exchange(&session, call)
}

#[tauri::command]
pub fn tray_stop(webview: Webview, app: AppHandle, session: String) -> Result<(), String> {
    check_source(&webview)?;
    let state = app.state::<TrayState>();
    let mut state = state.0.lock().map_err(|_| "Tray unavailable")?;
    if state.session == session {
        state.clear();
    }
    Ok(())
}

pub fn reset(app: &AppHandle) {
    if let Ok(mut state) = app.state::<TrayState>().0.lock() {
        state.clear();
    }
}
pub fn notifications_snoozed(app: &AppHandle) -> bool {
    app.state::<TrayState>()
        .0
        .lock()
        .is_ok_and(|state| state.snoozed())
}

pub fn install(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let open = MenuItem::with_id(app, "tray-open", "Open Yapmod Desktop", true, None::<&str>)?;
    let status = MenuItem::with_id(
        app,
        "tray-status",
        "Call controls unavailable",
        false,
        None::<&str>,
    )?;
    let mute = MenuItem::with_id(app, "tray-mute", "Mute microphone", false, None::<&str>)?;
    let deafen = MenuItem::with_id(app, "tray-deafen", "Deafen", false, None::<&str>)?;
    let settings = MenuItem::with_id(
        app,
        "tray-settings",
        "Desktop settings…",
        false,
        None::<&str>,
    )?;
    let snooze = MenuItem::with_id(
        app,
        "tray-snooze",
        "Snooze desktop notifications (1 hour)",
        true,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "tray-quit", "Quit Yapmod Desktop", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &open, &settings, &separator, &status, &mute, &deafen, &snooze, &quit,
        ],
    )?;
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
            "tray-mute" | "tray-deafen" | "tray-settings" | "tray-snooze" => {
                if let Ok(mut state) = app.state::<TrayState>().0.lock() {
                    match event.id.as_ref() {
                        "tray-snooze" => {
                            state.snooze_until = if state.snoozed() {
                                None
                            } else {
                                Some(Instant::now() + Duration::from_secs(3600))
                            }
                        }
                        "tray-settings" if state.live() => {
                            state.open_settings = true;
                            crate::window::show(app);
                        }
                        "tray-mute"
                            if state.live()
                                && state.call.available
                                && state.call.channel_id.is_some()
                                && !state.call.deafened =>
                        {
                            let muted = !state.call.muted;
                            if state.actions.is_empty() {
                                state.actions.push(crate::yaplay::Action::SetMute { muted });
                            }
                        }
                        "tray-deafen"
                            if state.live()
                                && state.call.available
                                && state.call.channel_id.is_some() =>
                        {
                            let deafened = !state.call.deafened;
                            if state.actions.is_empty() {
                                state
                                    .actions
                                    .push(crate::yaplay::Action::SetDeafen { deafened });
                            }
                        }
                        _ => {}
                    }
                }
            }
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
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut previous = None;
        loop {
            tokio::time::sleep(Duration::from_millis(250)).await;
            let view = handle
                .state::<TrayState>()
                .0
                .lock()
                .ok()
                .map(|state| (state.live(), state.call.clone(), state.snoozed()));
            if view == previous {
                continue;
            }
            previous = view.clone();
            let Some((live, call, snoozed)) = view else {
                continue;
            };
            let in_call = live && call.available && call.channel_id.is_some();
            let label = if !live || !call.available {
                "Call controls unavailable"
            } else if !in_call {
                "Not in a call"
            } else if call.deafened {
                "In a call — deafened"
            } else if call.muted {
                "In a call — microphone muted"
            } else {
                "In a call — microphone on"
            };
            let _ = status.set_text(label);
            let _ = mute.set_text(if in_call && call.muted {
                "Unmute microphone"
            } else {
                "Mute microphone"
            });
            let _ = mute.set_enabled(in_call && !call.deafened);
            let _ = deafen.set_text(if in_call && call.deafened {
                "Undeafen"
            } else {
                "Deafen"
            });
            let _ = deafen.set_enabled(in_call);
            let _ = settings.set_enabled(live);
            let _ = snooze.set_text(if snoozed {
                "Resume desktop notifications"
            } else {
                "Snooze desktop notifications (1 hour)"
            });
            if let Some(tray) = handle.tray_by_id(ID) {
                let _ = tray.set_tooltip(Some(format!(
                    "Yapmod Desktop — {label}{}",
                    if snoozed {
                        " — notifications snoozed"
                    } else {
                        ""
                    }
                )));
            }
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::yaplay::Action;

    fn active() -> State {
        State {
            session: "current".into(),
            seen: Some(Instant::now()),
            call: CallState {
                available: true,
                channel_id: Some("room".into()),
                ..Default::default()
            },
            ..Default::default()
        }
    }

    #[test]
    fn controls_are_consumed_once_and_never_cross_calls_or_expired_leases() {
        let mut state = active();
        state.actions.push(Action::SetMute { muted: true });
        assert!(state.exchange("old", state.call.clone()).is_err());
        assert_eq!(
            state
                .exchange("current", state.call.clone())
                .unwrap()
                .actions
                .len(),
            1
        );
        assert!(
            state
                .exchange("current", state.call.clone())
                .unwrap()
                .actions
                .is_empty()
        );
        state.actions.push(Action::SetDeafen { deafened: true });
        let other = CallState {
            channel_id: Some("other".into()),
            ..state.call.clone()
        };
        assert!(state.exchange("current", other).unwrap().actions.is_empty());
        state.actions.push(Action::SetMute { muted: true });
        state.seen = Some(Instant::now() - Duration::from_secs(6));
        assert!(!state.live());
        assert!(
            state
                .exchange("current", state.call.clone())
                .unwrap()
                .actions
                .is_empty()
        );
    }

    #[test]
    fn snooze_survives_page_cleanup_but_expires() {
        let mut state = active();
        state.snooze_until = Some(Instant::now() + Duration::from_secs(3600));
        state.open_settings = true;
        state.actions.push(Action::SetMute { muted: true });
        state.clear();
        assert!(state.snoozed());
        assert!(!state.live());
        assert!(!state.open_settings);
        assert!(state.actions.is_empty());
        assert!(state.exchange("current", CallState::default()).is_err());
        state.snooze_until = Some(Instant::now() - Duration::from_secs(1));
        assert!(!state.snoozed());
    }
}

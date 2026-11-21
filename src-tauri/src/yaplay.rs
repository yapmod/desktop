use std::time::{Duration, Instant};

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tauri::{Manager, Webview};
use tokio::sync::Mutex;
use tokio_tungstenite::{
    MaybeTlsStream, WebSocketStream, connect_async_with_config,
    tungstenite::{Message, protocol::WebSocketConfig},
};

type Socket = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;
const DEADLINE: Duration = Duration::from_secs(2);
const EMPTY: &str = r#"{"type":"voice_state","in_call":false,"members":[]}"#;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Member {
    id: String,
    name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    avatar_url: Option<String>,
    color: [u8; 3],
    speaking: bool,
    muted: bool,
    is_self: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Snapshot {
    in_call: bool,
    members: Vec<Member>,
    muted: bool,
    deafened: bool,
}
impl Snapshot {
    fn validate(&self) -> Result<(), String> {
        if self.members.len() > 4096
            || (!self.in_call && (!self.members.is_empty() || self.muted || self.deafened))
        {
            return Err("Invalid Yaplay call state".into());
        }
        let mut ids = std::collections::HashSet::new();
        for member in &self.members {
            if member.id.is_empty()
                || member.id.len() > 128
                || member.name.len() > 512
                || member.avatar_url.as_ref().is_some_and(|value| {
                    value.len() > 2048
                        || !tauri::Url::parse(value).is_ok_and(|url| {
                            url.scheme() == "https"
                                && url.host_str().is_some()
                                && url.username().is_empty()
                                && url.password().is_none()
                        })
                })
                || !ids.insert(&member.id)
            {
                return Err("Invalid Yaplay member".into());
            }
        }
        if serde_json::to_vec(self).map_err(|e| e.to_string())?.len() > 1024 * 1024 - 1024 {
            return Err("Yaplay state is too large".into());
        }
        Ok(())
    }
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Action {
    SetMute { muted: bool },
    SetDeafen { deafened: bool },
    LeaveCall {},
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Notice {
    title: String,
    body: String,
}
#[derive(Serialize)]
pub struct Reply {
    connected: bool,
    actions: Vec<Action>,
}

struct Connection {
    session: String,
    port: u16,
    socket: Option<Socket>,
    last: Option<Snapshot>,
    retry: Instant,
    seen: Instant,
}
#[derive(Default)]
pub struct Yaplay(Mutex<Option<Connection>>);

fn source(webview: &Webview) -> Result<(), String> {
    if webview.label() == "yapin"
        && webview
            .url()
            .is_ok_and(|url| crate::navigation::is_yapin(&url))
    {
        Ok(())
    } else {
        Err("Yaplay requires the Yapin window".into())
    }
}
async fn clear(connection: &mut Connection) {
    if let Some(mut socket) = connection.socket.take() {
        let _ = tokio::time::timeout(DEADLINE, async {
            socket.send(Message::Text(EMPTY.into())).await?;
            socket.close(None).await
        })
        .await;
    }
    connection.last = None;
}

#[tauri::command]
pub async fn yaplay_start(
    webview: Webview,
    state: tauri::State<'_, Yaplay>,
    session: String,
    port: u16,
) -> Result<(), String> {
    source(&webview)?;
    if port == 0 || session.is_empty() || session.len() > 64 {
        return Err("Invalid Yaplay session or port".into());
    }
    let mut guard = state.0.lock().await;
    if let Some(old) = guard.as_mut() {
        clear(old).await;
    }
    *guard = Some(Connection {
        session,
        port,
        socket: None,
        last: None,
        retry: Instant::now(),
        seen: Instant::now(),
    });
    Ok(())
}
#[tauri::command]
pub async fn yaplay_stop(
    webview: Webview,
    state: tauri::State<'_, Yaplay>,
    session: String,
) -> Result<(), String> {
    source(&webview)?;
    let mut guard = state.0.lock().await;
    if guard.as_ref().is_some_and(|c| c.session == session) {
        if let Some(c) = guard.as_mut() {
            clear(c).await;
        }
        *guard = None;
    }
    Ok(())
}
#[tauri::command]
pub async fn yaplay_exchange(
    webview: Webview,
    state: tauri::State<'_, Yaplay>,
    session: String,
    snapshot: Snapshot,
    notices: Vec<Notice>,
) -> Result<Reply, String> {
    source(&webview)?;
    snapshot.validate()?;
    if notices.len() > 5
        || notices
            .iter()
            .any(|n| n.title.len() > 512 || n.body.len() > 4096)
    {
        return Err("Invalid Yaplay notifications".into());
    }
    let mut guard = state.0.lock().await;
    let connection = guard
        .as_mut()
        .filter(|c| c.session == session)
        .ok_or("Yaplay session expired")?;
    connection.seen = Instant::now();
    match exchange(connection, snapshot, notices).await {
        Ok(reply) => Ok(reply),
        Err(_) => {
            connection.socket = None;
            connection.last = None;
            connection.retry = Instant::now() + DEADLINE;
            Ok(Reply {
                connected: false,
                actions: vec![],
            })
        }
    }
}
async fn exchange(
    c: &mut Connection,
    snapshot: Snapshot,
    notices: Vec<Notice>,
) -> Result<Reply, String> {
    if c.socket.is_none() {
        if Instant::now() < c.retry {
            return Ok(Reply {
                connected: false,
                actions: vec![],
            });
        }
        // Only Rust constructs the destination. No page-provided hosts, paths or redirects.
        let config = WebSocketConfig::default()
            .max_message_size(Some(4096))
            .max_frame_size(Some(4096));
        let (mut socket, _) = tokio::time::timeout(
            DEADLINE,
            connect_async_with_config(format!("ws://127.0.0.1:{}", c.port), Some(config), true),
        )
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
        send(
            &mut socket,
            r#"{"type":"hello","version":1,"controls":true}"#.into(),
        )
        .await?;
        c.socket = Some(socket);
        c.last = None;
    }
    let socket = c.socket.as_mut().unwrap();
    if c.last.as_ref() != Some(&snapshot) {
        send(socket, serde_json::json!({"type":"voice_state","in_call":snapshot.in_call,"members":snapshot.members}).to_string()).await?;
        send(
            socket,
            serde_json::json!({"type":"mic_state","muted":snapshot.muted}).to_string(),
        )
        .await?;
        send(
            socket,
            serde_json::json!({"type":"deafen_state","deafened":snapshot.deafened}).to_string(),
        )
        .await?;
        c.last = Some(snapshot);
    }
    for notice in notices {
        send(
            socket,
            serde_json::json!({"type":"notification","title":notice.title,"body":notice.body})
                .to_string(),
        )
        .await?;
    }
    let mut actions = Vec::new();
    for _ in 0..8 {
        match tokio::time::timeout(Duration::from_millis(1), socket.next()).await {
            Ok(Some(Ok(Message::Text(text)))) => {
                if let Ok(action) = serde_json::from_str::<Action>(&text) {
                    actions.push(action);
                }
            }
            Ok(Some(Ok(Message::Ping(_)))) => {
                socket.flush().await.map_err(|e| e.to_string())?;
            }
            Ok(Some(Ok(Message::Close(_)))) | Ok(None) => return Err("Yaplay disconnected".into()),
            Ok(Some(Err(error))) => return Err(error.to_string()),
            Err(_) => break,
            _ => {}
        }
    }
    Ok(Reply {
        connected: true,
        actions,
    })
}
async fn send(socket: &mut Socket, text: String) -> Result<(), String> {
    tokio::time::timeout(DEADLINE, socket.send(Message::Text(text.into())))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

pub fn install(app: &tauri::AppHandle) {
    app.manage(Yaplay::default());
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            let state = app.state::<Yaplay>();
            let mut guard = state.0.lock().await;
            // Reloads, crashes and abandoned documents cannot leave a stale roster indefinitely.
            if guard
                .as_ref()
                .is_some_and(|c| c.seen.elapsed() > Duration::from_secs(5))
            {
                if let Some(c) = guard.as_mut() {
                    clear(c).await;
                }
                *guard = None;
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::TcpListener;
    use tokio_tungstenite::accept_async;

    fn snapshot() -> Snapshot {
        Snapshot {
            in_call: true,
            members: vec![Member {
                id: "self".into(),
                name: "You".into(),
                avatar_url: Some("https://example.com/avatar.png".into()),
                color: [10, 20, 30],
                speaking: true,
                muted: false,
                is_self: true,
            }],
            muted: false,
            deafened: false,
        }
    }
    #[test]
    fn validates_state_and_rejects_arbitrary_commands() {
        let mut state = snapshot();
        assert!(state.validate().is_ok());
        state.members.push(state.members[0].clone());
        assert!(state.validate().is_err());
        state.members.clear();
        state.in_call = false;
        state.deafened = true;
        assert!(state.validate().is_err());
        for text in [
            r#"{"type":"invoke","command":"open_url"}"#,
            r#"{"type":"set_mute","muted":"true"}"#,
            r#"{"type":"leave_call","url":"https://example.com"}"#,
        ] {
            assert!(serde_json::from_str::<Action>(text).is_err());
        }
        assert!(serde_json::from_str::<Action>(r#"{"type":"set_mute","muted":true}"#).is_ok());
    }
    #[test]
    fn avatars_are_optional_https_and_support_full_rosters() {
        let mut state = snapshot();
        for value in [
            "http://example.com/a",
            "file:///tmp/a",
            "https://user:pass@example.com/a",
            "not a url",
        ] {
            state.members[0].avatar_url = Some(value.into());
            assert!(state.validate().is_err());
        }
        state.members[0].avatar_url = Some(format!("https://example.com/{}", "a".repeat(2030)));
        assert!(state.validate().is_err());
        state.members[0].avatar_url = None;
        assert!(state.validate().is_ok());
        let json = serde_json::to_string(&state).unwrap();
        assert!(!json.contains("avatar_url"));
        assert_eq!(serde_json::from_str::<Snapshot>(&json).unwrap(), state);
        state.members[0].avatar_url = Some(format!("https://example.com/{}", "a".repeat(1900)));
        state.members = (0..500)
            .map(|id| {
                let mut member = state.members[0].clone();
                member.id = id.to_string();
                member
            })
            .collect();
        assert!(state.validate().is_ok());
    }
    #[tokio::test]
    async fn websocket_replays_state_receives_controls_and_clears_on_stop() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let (ready, received) = tokio::sync::oneshot::channel();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = accept_async(stream).await.unwrap();
            let mut messages = Vec::new();
            for _ in 0..5 {
                let text = socket.next().await.unwrap().unwrap().into_text().unwrap();
                messages.push(serde_json::from_str::<serde_json::Value>(&text).unwrap());
            }
            let contract: serde_json::Value =
                serde_json::from_str(include_str!("../../plugin/test/fixtures/yaplay-v1.json"))
                    .unwrap();
            assert_eq!(serde_json::json!(messages), contract["outgoing"]);
            for action in contract["controls"].as_array().unwrap() {
                socket
                    .send(Message::Text(action.to_string().into()))
                    .await
                    .unwrap();
            }
            ready.send(()).unwrap();
            let text = socket.next().await.unwrap().unwrap().into_text().unwrap();
            assert_eq!(text, EMPTY);
            let _ = socket.next().await;
        });
        let mut c = Connection {
            session: "test".into(),
            port,
            socket: None,
            last: None,
            retry: Instant::now(),
            seen: Instant::now(),
        };
        let first = exchange(
            &mut c,
            snapshot(),
            vec![Notice {
                title: "Hi".into(),
                body: "Body".into(),
            }],
        )
        .await
        .unwrap();
        assert!(first.connected);
        received.await.unwrap();
        let second = exchange(&mut c, snapshot(), vec![]).await.unwrap();
        let actions: Vec<_> = first.actions.iter().chain(&second.actions).collect();
        let contract: serde_json::Value =
            serde_json::from_str(include_str!("../../plugin/test/fixtures/yaplay-v1.json"))
                .unwrap();
        assert_eq!(serde_json::to_value(actions).unwrap(), contract["controls"]);
        clear(&mut c).await;
        tokio::time::timeout(DEADLINE, server)
            .await
            .unwrap()
            .unwrap();
        assert!(c.socket.is_none() && c.last.is_none());
    }
    #[tokio::test]
    async fn reconnect_resends_current_state_without_replaying_notifications() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            for attempt in 0..2 {
                let (stream, _) = listener.accept().await.unwrap();
                let mut socket = accept_async(stream).await.unwrap();
                let count = if attempt == 0 { 5 } else { 4 };
                let mut types = Vec::new();
                for _ in 0..count {
                    let text = socket.next().await.unwrap().unwrap().into_text().unwrap();
                    let message: serde_json::Value = serde_json::from_str(&text).unwrap();
                    types.push(message["type"].as_str().unwrap().to_owned());
                }
                assert_eq!(
                    &types[..4],
                    &["hello", "voice_state", "mic_state", "deafen_state"]
                );
                if attempt == 1 {
                    let text = socket.next().await.unwrap().unwrap().into_text().unwrap();
                    assert_eq!(text, EMPTY);
                    let _ = socket.next().await;
                }
            }
        });
        let mut c = Connection {
            session: "test".into(),
            port,
            socket: None,
            last: None,
            retry: Instant::now(),
            seen: Instant::now(),
        };
        let _ = exchange(
            &mut c,
            snapshot(),
            vec![Notice {
                title: "Once".into(),
                body: "".into(),
            }],
        )
        .await;
        // Simulate a transport loss while retaining the previous state cache.
        c.socket = None;
        c.retry = Instant::now();
        let reply = exchange(&mut c, snapshot(), vec![]).await.unwrap();
        assert!(reply.connected);
        clear(&mut c).await;
        tokio::time::timeout(DEADLINE, server)
            .await
            .unwrap()
            .unwrap();
    }
}

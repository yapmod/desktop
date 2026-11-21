# Yaplay integration

Yaplay is an optional built-in integration inside `client:yapmod-desktop`, configured at **Settings → Yapmod → Desktop → Yaplay**. It has no separate plugin registration or settings page. **Connect to Yaplay** is off by default. The existing desktop plugin stores `yaplayEnabled` and `yaplayPort` alongside its other preferences, and uses the official Yapmod builder, shared UI, and disposal hooks.

A native capability check reports an update requirement on older hosts. The compatible `plugins-v1` update channel remains unchanged. `pnpm dev` builds and loads the local client and locally compiled desktop plugin together, so signed plugin updates cannot hide local settings changes.

## Yapin adapter

Yapin currently exposes no public voice API through the Yapmod SDK. `plugin/src/yaplay/host.ts` discovers already-loaded Turbopack exports by shape, without hard-coded module numbers or network interception. It reads the store’s `voice`, `voiceMembers`, `speaking`, and `profiles`, and uses Yapin’s display-name, role-color, and public image URL helpers. Profile pictures respect server-specific avatar overrides; relative premade image URLs are resolved against Yapin. Only public HTTPS URLs without credentials, at most 2,048 bytes long, reach Yaplay. Missing or invalid images use its initials fallback. It never forwards auth tokens, message histories, audio, or arbitrary store fields.

Changes are coalesced within 50 ms. Idle polling every 250 ms receives controls and renews the native session. Only the current channel roster is sent; the local member is included if Yapin has not yet added it. Mute and deafen use Yapin’s own actions, and the overlay displays the resulting state. Device permissions, stage restrictions, and other Yapin rules still apply. Notification forwarding uses the desktop notification adapter and follows which notifications Yapin creates; it does not scrape all chat messages.

The adapter depends on Yapin internals. If its module runtime or store changes, the settings report the failure and the native session expires instead of retaining a stale roster. Test this adapter after upstream changes.

## Native boundary

Only the approved `yapin` WebView can invoke `yaplay_start`, `yaplay_exchange`, and `yaplay_stop`. Rust constructs `ws://127.0.0.1:<port>` itself. The page cannot select hosts, paths, or redirects. Serde rejects unknown fields, incorrect types, and out-of-range RGB components; extra validation bounds rosters, IDs, text, and total serialized state. Notifications are bounded and not replayed after reconnecting. Current voice/mic/deafen state is replayed on every successful connection.

Each activation has a session ID; stopping an old activation cannot close its replacement. Missing heartbeats expire the session after five seconds. Shutdown sends an empty roster before closing when possible. A control-capable Yaplay server also clears its owning client’s state on disconnect.

## Wire protocol

The existing `voice_state`, `mic_state`, `deafen_state`, and `notification` JSON messages are unchanged. On connection the desktop sends:

```json
{"type":"hello","version":1,"controls":true}
```

New Yaplay builds return only these commands to the latest negotiated control client:

```json
{"type":"set_mute","muted":true}
{"type":"set_deafen","deafened":true}
{"type":"leave_call"}
```

Rust validates these commands before returning them to the plugin. There is no arbitrary invocation or script execution command. Controls are not replayed after disconnection. A batch is discarded if the user changes calls or the configured port while the native exchange is pending. Store changes during an exchange remain queued for the next tick. Yaplay does not optimistically modify its call state; subsequent state messages are the confirmation. Old receivers can ignore the hello message and continue displaying state. The loopback server has no pairing/authentication layer, matching Yaplay’s existing protocol.

## Verification

JavaScript tests cover store discovery, roster mapping, action dispatch, and toggling the integration and disposing the desktop plugin. Native tests use real local WebSockets to check state delivery, validation, command reception, and cleanup. Yaplay tests check negotiation and confirmed state updates.

Live inspection and a compiled-plugin run with a test transport on November 21, 2026 joined Yapmod’s `coding-together` channel and verified its roster, deafen/undeafen, and leave-call action. The automation browser had microphone permission denied: an unmute request correctly left the reported state muted. Both development executables start successfully; native window automation could not attach to the unbundled debug executable. A complete two-app UI check, audio transmission, and speaking activity with a second participant still require a microphone-enabled manual call.


## Yaplay 1.2 compatibility audit — November 21, 2026

Reviewed the merged GPUI migration (ilyeshdz/yaplay PR #6, head `fb79db6184090062f61518a7f149af59089f3fd3`) and the subsequent 1.2.0 release PR #7. The release changes only version metadata and the changelog. The local Yaplay checkout contains the exact feature PR head, including negotiated controls; it requires no additional server behavior change for this integration. Both checkouts now have identical v1 protocol fixtures: the desktop asserts its actual outgoing messages and incoming controls against the fixture, and Yaplay exercises that contract through its real WebSocket handler.

| Feature | Integration behavior | Verification |
| --- | --- | --- |
| Full roster, local user, names and colors | Publishes the entire current call; no client-side display truncation | Adapter and native WebSocket tests |
| Profile pictures | Optional `avatar_url`, including server overrides and premade images | Live Yapin resolver inspection, adapter mapping and native validation/serialization tests |
| Speaking priority, self visibility and overflow | Sends `speaking` and `is_self`; Yaplay applies its saved display preferences | Yaplay roster and appearance tests |
| Appearance settings and live preview | Owned by Yaplay; require no extra protocol messages | Saved settings round-trip and range/capacity tests; visual preview not manually verified |
| Mute, deafen and leave | Negotiates v1 controls, invokes host actions and publishes confirmed state | Host action and WebSocket negotiation tests |
| Notifications | Forwards the notifications created by Yapin | Native transmission and Yaplay notification preference tests |
| Reconnect and cleanup | Replays current state, drops old notices, clears disconnected roster | Native reconnect and Yaplay ownership/cleanup tests |
| Stale control requests | Stops on disposal and rejects responses for a different call or port | Compiled desktop plugin lifecycle/call-switch test |

The desktop native boundary allows up to 4,096 members within a serialized state budget just below Yaplay's 1 MiB frame limit. Image download failures remain subject to Yaplay's own image size/format restrictions and fall back to initials. No additional appearance-control API is advertised: those settings belong to Yaplay itself. Full two-app native UI/audio verification remains subject to the limitations above.

<div align="center">
  <img src="docs/images/banner.svg" width="870" alt="Yapmod" />
  <h1>Yapmod Desktop</h1>
  <p>Use Yapin with your Yapmod plugins and system notifications on macOS, Windows, and Linux.</p>
  <p>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL%20v3-blue" alt="GPL v3 license" /></a>
    <img src="https://img.shields.io/badge/Tauri-2-24C8DB" alt="Tauri 2" />
    <a href="https://github.com/yapmod/desktop/releases"><img src="https://img.shields.io/github/downloads/yapmod/desktop/total" alt="Total release asset downloads" /></a>
  </p>
</div>

## Signing in

Open the app and sign in to Yapin. The app remembers your session on this computer and loads the Yapmod client and desktop plugin in the same window. [Yapin](https://www.yapin.gg/?auth=in) · [Yapmod client](https://github.com/yapmod/client)

Yapin provides the sign-in form and available sign-in methods. Google sign-in depends on the provider's support for embedded browsers. Yapin does not document a way to transfer a chat session from the system browser into a third-party app. [Yapin authentication](https://www.yapin.gg/developers#login-with-yapper) · [Google OAuth policies](https://developers.google.com/identity/protocols/oauth2/policies#use-secure-browsers)

The main window has a minimum content size of 560 × 420 logical pixels. Sign-in popups can be as small as 360 × 400. On smaller displays, the opening size and minimum fit the available work area.

## Microphone and camera permissions

On macOS and Windows, Yapin's microphone and camera requests use the WebView's permission prompts and respect system privacy settings. Access is requested when Yapin needs a device, not when the desktop app starts. The browser may remember an earlier permission decision. New media requests from the local shell, sign-in popups, and pages outside Yapin are denied.

If system access was denied, check **System Settings → Privacy & Security → Microphone / Camera** on macOS, or **Settings → Privacy & security → Microphone / Camera** on Windows, including access for desktop apps. Restart the app after changing system permissions.

This permission handling does not establish full voice/video call compatibility. Linux calling remains unsupported; a future Linux release may bundle CEF to provide Chromium's WebRTC implementation.

## Settings and updates

Closing the main window keeps Yapmod Desktop running in the system tray so it can receive notifications. Use the tray menu to **Open Yapmod Desktop** or **Quit Yapmod Desktop**. On Windows, clicking the tray icon also opens the window; on macOS, the Dock icon restores it. Linux requires a desktop environment with AppIndicator support. If the tray cannot be created, closing the window exits the app.

The tray menu also shows your call and microphone status, with **Mute microphone** / **Unmute microphone** and **Deafen** / **Undeafen** controls. These work without enabling Yaplay. Microphone controls are disabled while deafened; undeafen first. Controls become unavailable when the desktop plugin is disabled, the page stops responding, or Yapin’s voice integration cannot be discovered.

Choose **Snooze desktop notifications (1 hour)** to temporarily suppress new system alerts, or **Resume desktop notifications** to end the snooze early. Snoozing survives page reloads, ends when the app quits, and does not change Yapin’s notification preferences or Yaplay overlay alerts.

Open **Settings → Yapmod → Desktop** to manage notifications, see the installed versions, or check for an app update. Enable **Launch at login** to open Yapmod Desktop automatically when you sign in to this computer. The setting is off on a fresh installation. Yapin controls which messages trigger alerts. Clicking a notification takes you back to the conversation when the OS delivers the click and the originating page is still open.

| Component | How it updates |
| --- | --- |
| Desktop app | Supported release builds check the update manifest from Desktop settings and verify the downloaded package's signature. Confirm the installation to restart the app with the update. |
| Yapmod client | When Yapin loads, the app fetches the latest stable release from `yapmod/client` and checks its SHA-256 digest against the one published by GitHub. If GitHub is unavailable, the app uses the cached copy. |
| Desktop plugin | A copy ships with the app. Release builds can load a signed update from the `plugins-v1` channel. |
| Community plugins | Use the Yapmod client's plugin manager to install, configure, and update them. |

The first client download requires a connection to GitHub. If the download fails and the cache is empty, you can still use Yapin and retry from the notice on the page. Local development works without signing keys. The release workflow configures the app and plugin update channels.

## Development

Install Node.js 24 or later, pnpm, stable Rust, and the Tauri prerequisites for your OS. The `packageManager` field in `package.json` pins the pnpm version. macOS uses WebKit and Xcode, Windows uses WebView2 and the MSVC build tools, and Linux uses WebKitGTK 4.1. [Install pnpm](https://pnpm.io/installation) · [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

```sh
pnpm install --frozen-lockfile
pnpm dev
```

| Command | Result |
| --- | --- |
| `pnpm build:plugin` | Compiles the TypeScript and Solid JSX desktop plugin with the Yapmod builder. |
| `pnpm test` | Runs the JavaScript and Rust tests for client startup, IPC, and desktop integration. |
| `pnpm build` | Builds the application and installers for the current platform. |
| `pnpm tauri build --bundles app` | Builds the macOS app bundle without creating a disk image. |

Local packages are written to `src-tauri/target/release/bundle/`. Once you sign in, Yapin’s existing top bar displays the Yapmod logo and name. Mac window controls sit on its left and Windows caption buttons sit on its right. Linux uses the system window frame. The macOS disk image includes the original Yapmod artwork.

Public releases use a public GitHub repository and a free Tauri signing key pair for updates. The Mac build machine applies an ad hoc signature to the app. The Windows NSIS installer ships without a publisher certificate. Gatekeeper or SmartScreen may show a warning when opening a download for the first time.

[Release guide](docs/release.md) · [Changelog](CHANGELOG.md) · [Maintenance instructions](AGENTS.md)

## License and artwork

Yapmod Desktop is licensed under GPL-3.0. The rounded app icon uses the official Yapmod SVG mark. Its pink background follows the original icon artwork. The banner and disk image background come from revision `b90b674` of the original project. [License](LICENSE) · [SVG mark](https://github.com/yapmod/client/blob/a8b2b0c8c183f7ae26033934119b77f72624f2e9/apps/docs/public/logo.svg) · [Banner](https://github.com/ilyeshdz/yapmod/blob/b90b6740334ef35fefee44c9da0c518c4f575535/images/banner.png) · [Icons](https://github.com/ilyeshdz/yapmod/tree/b90b6740334ef35fefee44c9da0c518c4f575535/src-tauri/icons) · [Disk image background](https://github.com/ilyeshdz/yapmod/blob/b90b6740334ef35fefee44c9da0c518c4f575535/src-tauri/dmgly/assets/dmg-background.png)

<p align="center">Yapmod Desktop is an independent Yapin community project.</p>

## Yaplay overlay

Open **Settings → Yapmod → Desktop → Yaplay** and turn on **Connect to Yaplay**. Start [Yaplay](https://github.com/ilyeshdz/yaplay) with its overlay enabled. Both apps use port **8080** by default; enter Yaplay’s port in Desktop settings if you changed it.

The built-in integration forwards your current call roster, display names, speaking activity, mute/deafen state, and notifications created by the desktop notification adapter. The Rust host owns the local WebSocket connection. With a control-capable Yaplay build, its buttons can mute, deafen, or leave your current Yapin call. Older Yaplay versions still display state. Turning off the integration clears the overlay roster and disconnects.

See [the integration notes](docs/yaplay.md) for the protocol, validation, and current testing limitations.

## Local client development

`pnpm dev` first builds the sibling `../client` checkout, then launches the desktop with that local client bundle and the locally compiled desktop integration. Install the client checkout’s dependencies first with `pnpm install --frozen-lockfile`. Set `YAPMOD_CLIENT_DIR` to use a different checkout. Run `pnpm dev` again after editing client source to rebuild it; this command does not start a client watcher.

The bundle override is limited to debug builds. Development sessions use the bundled desktop integration rather than downloaded plugin updates; release builds retain the verified release/cache flow.

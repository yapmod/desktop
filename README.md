<div align="center">
  <img src="docs/images/banner.svg" width="870" alt="Yapmod" />
  <h1>Yapmod Desktop</h1>
  <p>Use Yapin with your Yapmod plugins and system notifications on macOS, Windows, and Linux.</p>
  <p>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL%20v3-blue" alt="GPL v3 license" /></a>
    <img src="https://img.shields.io/badge/Tauri-2-24C8DB" alt="Tauri 2" />
  </p>
</div>

## Signing in

Open the app and sign in to Yapin. The app remembers your session on this computer and loads the Yapmod client and desktop plugin in the same window. [Yapin](https://www.yapin.gg/?auth=in) · [Yapmod client](https://github.com/yapmod/client)

Yapin provides the sign-in form and available sign-in methods. Google sign-in depends on the provider's support for embedded browsers. Yapin does not document a way to transfer a chat session from the system browser into a third-party app. [Yapin authentication](https://www.yapin.gg/developers#login-with-yapper) · [Google OAuth policies](https://developers.google.com/identity/protocols/oauth2/policies#use-secure-browsers)

## Settings and updates

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

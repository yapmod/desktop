# Maintaining Yapmod Desktop

Communicate with users and contributors in English. Use English for documentation, interface text, error messages, code comments, and release notes.

Yapmod Desktop opens `https://www.yapin.gg/?auth=in`. Yapin handles sign-in and stores the session in the WebView profile. The desktop app loads the official `yapmod-client.js` bundle. The web extension shows how to integrate the public client API. [Client](https://github.com/yapmod/client) · [Web extension](https://github.com/yapmod/web)

## Repository layout

| Path | Responsibility |
| --- | --- |
| `shell/` | Fallback title bar, shared caption controls, loading state, and connection recovery. Plain HTML, CSS, and JavaScript. |
| `src-tauri/src/window.rs`, `navigation.rs` | Native window, WebView sizing, allowed origins, sign-in windows, and bundle injection on page load. |
| `src-tauri/src/bundles.rs` | Release resolution, download size limits, integrity checks, and atomic writes to `bundles-v1/` in the app cache. |
| `runtime/titlebar.js`, `runtime/titlebar.css`, `src-tauri/src/titlebar.rs` | Brand the existing Yapin header, attach window controls, and switch the WebView between the integrated and fallback layouts. |
| `runtime/ipc.js` | Sends JSON commands through the WebView's native message channel. |
| `runtime/bootstrap.js` | Starts the client and registers the plugin once per top-level document. |
| `runtime/plugins/desktop.js` | Standalone JavaScript expression that receives the client and native bridge. The bundled plugin and signed plugin update share this source. |
| `src-tauri/src/notifications.rs`, `updates.rs` | System notifications, notification clicks, and application update checks and installation. |
| `src-tauri/capabilities/`, `src-tauri/build.rs` | Per-WebView IPC permissions and declarations for the commands they cover. |
| `.github/workflows/`, `scripts/release*` | Cross-platform builds, update signatures, manifests, and publishing. |

## Changing the integration

The `main` window contains the local `shell` WebView and the remote `yapin` WebView. Sign-in popups share their opener's browser context and have no desktop capabilities. Run the bundle only in the top-level document on the two approved Yapin HTTPS origins. If Yapin changes domains, update the Rust navigation rules, IPC transport, bootstrap, connection recovery notice, and capabilities together.

On signed-in pages, use Yapin's existing `.app > .topbar` and `.topbar-brand` for the desktop caption. Preserve its theme, row height, and interactive children. When that row is visible, the remote WebView starts at the top of the window. Use the local caption during loading, sign-in, and layouts without a visible header. Linux keeps its system window frame.

Declare each new Tauri command in the Rust handler and in `build.rs`, then grant its permission to the WebView that needs it. Keep download and update URLs in native code. Desktop commands exchange JSON. The transport registered with `Builder::invoke_system` uses native messaging from the first call. Tauri checks the invocation key, origin, and WebView capability.

Yapin owns sign-in data. WebKit checks navigation for child frames as well as top-level documents. Allow its inline frames and use exact Google domains for regional account redirects. The list in `src-tauri/assets/google-domains.txt` comes from Google's published list with one leading dot removed per line. These hosts receive no desktop permissions. [Google domain list](https://www.google.com/supported_domains)

Register the native notification backend without its global JavaScript polyfill. The client plugin installs the Web Notifications adapter on Yapin. Google sign-in windows and embedded authentication frames must retain their browser-provided APIs.

The desktop plugin uses `registerClientPlugin`, `api.settings.registerSection`, the client's UI components, and its storage API. Keep the plugin ID `client:yapmod-desktop` stable to preserve preferences. Test cleanup by disabling and re-enabling the plugin. Compatible installations share the `plugins-v1` update channel. Create a new channel for incompatible changes to the native bridge.

The editable icon is `shell/yapmod.svg`. The shell and signed-in header use it directly. After editing it, run `npm run tauri -- icon shell/yapmod.svg --output <temporary-directory>` and copy the matching desktop PNG, ICO, and ICNS files into `src-tauri/icons/`.

## Verifying a change

```sh
npm ci
npm test
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Run the network test to verify that the app downloads the published client and can read it back from the cache.

```sh
cargo test --locked --manifest-path src-tauri/Cargo.toml resolves_live_client -- --ignored
```

After changing window or authentication behavior, run `npm run dev`. Sign in with a test account, restart the app to verify the session persists, and open **Settings → Yapmod → Desktop**. For Google sign-in, check that clicking the sign-in button opens a popup and that it returns control to Yapin. Check both the popup and the main Yapin console for requests to `ipc://localhost`. Check that the signed-in window has one branded title bar, that the next row begins immediately below it, and that the sign-in screen retains working window controls. On the affected OS, test minimizing, maximizing, resizing, and closing the window. With the app in the background, receive a message and click its notification. After packaging changes, build the package and open the installer.

## Publishing

Run `scripts/release.py prepare` to synchronize npm and Cargo versions and their lockfiles. Record user-visible changes under `## Unreleased` in `CHANGELOG.md`. A stable `vX.Y.Z` tag builds the installers and publishes the manifest after signature verification. The **Publish desktop plugin** workflow can release the plugin independently. See the release guide for GitHub key configuration and recovery procedures. [Release guide](docs/release.md)

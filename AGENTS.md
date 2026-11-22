# Maintaining Yapmod Desktop

Communicate with users and contributors in English. Use English for documentation, interface text, error messages, code comments, and release notes.

Yapmod Desktop opens `https://www.yapin.gg/?auth=in`. Yapin handles sign-in and stores the session in the WebView profile. The desktop app loads the official `yapmod-client.js` bundle. The web extension shows how to integrate the public client API. [Client](https://github.com/yapmod/client) · [Web extension](https://github.com/yapmod/web)

## Repository layout

| Path | Responsibility |
| --- | --- |
| `shell/` | Fallback title bar, shared caption controls, loading state, and connection recovery. Plain HTML, CSS, and JavaScript. |
| `src-tauri/src/window.rs`, `navigation.rs` | Native window, WebView sizing, allowed origins, sign-in windows, and bundle injection on page load. |
| `src-tauri/src/bundles.rs` | Release resolution, download size limits, integrity checks, and atomic writes to `bundles-v1/` in the app cache. |
| `src-tauri/webview/titlebar.js`, `src-tauri/webview/titlebar.css`, `src-tauri/src/titlebar.rs` | Brand the existing Yapin header, attach window controls, and switch the WebView between the integrated and fallback layouts. |
| `src-tauri/webview/ipc.js` | Sends JSON commands through the WebView's native message channel. |
| `src-tauri/webview/bootstrap.js` | Starts the client and registers the plugin once per top-level document. |
| `plugin/src/`, `plugin/manifest.json` | TypeScript and Solid JSX for the Desktop settings and native notifications. |
| `scripts/build-plugin.mjs` | Builds the SDK expression and wraps it for the desktop v1 registration API. Cargo and the signed plugin workflow use the same build script. |
| `src-tauri/src/notifications.rs`, `updates.rs` | System notifications, notification clicks, and application update checks and installation. |
| `src-tauri/capabilities/`, `src-tauri/build.rs` | Per-WebView IPC permissions and declarations for the commands they cover. |
| `.github/workflows/`, `scripts/release*` | Cross-platform builds, update signatures, manifests, and publishing. |

## Changing the integration

The `main` window contains the local `shell` WebView and the remote `yapin` WebView. Sign-in popups share their opener's browser context and have no desktop capabilities. Run the bundle only in the top-level document on the two approved Yapin HTTPS origins. If Yapin changes domains, update the Rust navigation rules, IPC transport, bootstrap, connection recovery notice, and capabilities together.

On signed-in pages, use Yapin's existing `.app > .topbar` and `.topbar-brand` for the desktop caption. Preserve its theme, row height, and interactive children. When that row is visible, the remote WebView starts at the top of the window. Use the local caption during loading, sign-in, and layouts without a visible header. Linux keeps its system window frame.

Declare each new Tauri command in the Rust handler and in `build.rs`, then grant its permission to the WebView that needs it. Keep download and update URLs in native code. Desktop commands exchange JSON. The transport registered with `Builder::invoke_system` uses native messaging from the first call. Tauri checks the invocation key, origin, and WebView capability.

Yapin owns sign-in data. WebKit checks navigation for child frames as well as top-level documents. Allow its inline frames and use exact Google domains for regional account redirects. The list in `src-tauri/assets/google-domains.txt` comes from Google's published list with one leading dot removed per line. These hosts receive no desktop permissions. [Google domain list](https://www.google.com/supported_domains)

Register the native notification backend without its global JavaScript polyfill. The client plugin installs the Web Notifications adapter on Yapin. Google sign-in windows and embedded authentication frames must retain their browser-provided APIs.

Author the desktop plugin in `plugin/src/index.tsx` using the lifecycle and shared imports from the official starter. Use `@yapmod/ui`, Solid JSX, and `yapmod.storage` for preferences. Run `pnpm typecheck` and `pnpm build:plugin` to validate the package. The registration wrapper supplies the client’s API to the compiled plugin. [Official starter](https://github.com/yapmod/plugin-starter) Keep the plugin ID `client:yapmod-desktop` stable to preserve preferences. Test cleanup by disabling and re-enabling the plugin. Compatible installations share the `plugins-v1` update channel. Create a new channel for incompatible changes to the native bridge.

The editable icon is `shell/yapmod.svg`. The shell and signed-in header use it directly. After editing it, run `pnpm tauri icon shell/yapmod.svg --output <temporary-directory>` and copy the matching desktop PNG, ICO, and ICNS files into `src-tauri/icons/`.

## Verifying a change

```sh
pnpm install --frozen-lockfile
pnpm test
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Run the network test to verify that the app downloads the published client and can read it back from the cache.

```sh
cargo test --locked --manifest-path src-tauri/Cargo.toml resolves_live_client -- --ignored
```

After changing window or authentication behavior, run `pnpm dev`. Sign in with a test account, restart the app to verify the session persists, and open **Settings → Yapmod → Desktop**. For Google sign-in, check that clicking the sign-in button opens a popup and that it returns control to Yapin. Check both the popup and the main Yapin console for requests to `ipc://localhost`. Check that the signed-in window has one branded title bar, that the next row begins immediately below it, and that the sign-in screen retains working window controls. On the affected OS, test minimizing, maximizing, resizing, and closing the window. With the app in the background, receive a message and click its notification. After packaging changes, build the package and open the installer.

## Publishing

Write user-facing changes under `## [Unreleased]` in `CHANGELOG.md` in the same PR as product changes. Use `### Added`, `### Changed`, `### Fixed`, or `### Removed` and inline links. Conventional Commit PR titles select version bumps. Release Please maintains one rolling release PR, synchronizes package.json and both Cargo version files, and moves the authored notes under a version heading. Merge that PR to build and publish signed installers, then announce on Yapin. Do not bump versions or push release tags manually. Correct notes through ordinary PRs against main, since the release branch refreshes automatically. Docs, tests, and tooling-only PRs do not require notes. The desktop plugin retains its independent manual channel. See [the release guide](docs/release.md) for setup and recovery.

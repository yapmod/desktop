# Releasing Yapmod Desktop

Host releases in a public GitHub repository so installed apps can download updates without an access token. The workflow reads the repository name from `GITHUB_REPOSITORY`. The Yapmod client follows stable releases of `yapmod/client` on its own schedule.

Pull requests and pushes to `main` run formatting and tests on Linux. A version tag triggers the macOS, Windows, and Linux installer builds.

## Direct distribution

Releases use GitHub, Tauri's free signing tools, and a project-owned minisign key pair. This setup requires no paid Apple or Microsoft developer account.

On macOS, Tauri applies an ad hoc signature (`signingIdentity: "-"`) to the universal app bundle, including its Apple Silicon binary. CI mounts the finished disk image and runs `codesign --verify --strict --deep` on the app inside. The app ships without an Apple Developer ID or notarization. Gatekeeper may ask for an additional confirmation on first launch. [Opening an app on Mac](https://support.apple.com/en-us/102445)

On Windows, the NSIS installer ships without an Authenticode signature. SmartScreen may display a warning the first time a downloaded installer runs. [Microsoft Defender SmartScreen](https://learn.microsoft.com/en-us/windows/security/operating-system-security/virus-and-threat-protection/microsoft-defender-smartscreen/)

## One-time setup

Generate the updater key pair on your computer. Choose a password when prompted and save it in your password manager. Back up the private key before releasing the app. Installed copies trust the corresponding public key.

```sh
pnpm install --frozen-lockfile
mkdir -p ~/.tauri
pnpm tauri signer generate -w ~/.tauri/yapmod-desktop.key
```

Set these repository-level Actions values using GitHub CLI. The first two commands read the key files directly. Enter the same password at the hidden prompt for the third command.

```sh
gh variable set TAURI_UPDATER_PUBLIC_KEY --repo yapmod/desktop < ~/.tauri/yapmod-desktop.key.pub
gh secret set TAURI_SIGNING_PRIVATE_KEY --repo yapmod/desktop < ~/.tauri/yapmod-desktop.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo yapmod/desktop
```

You can also enter the values under **Settings → Secrets and variables → Actions**. Put the public key under **Variables**, and the private key and password under **Secrets**. The workflows use the repository's automatic GitHub token to publish releases. [Repository Actions settings](https://github.com/yapmod/desktop/settings/secrets/actions)

Once **Checks** passes on `main` and the signing values are in place, tag the commit you intend to ship.

```sh
git tag v1.0.0
git push origin refs/tags/v1.0.0
```

## Publishing a stable release

The first release uses the tag `v1.0.0`, and its notes are already in the changelog. For later releases, add user-facing changes under `## Unreleased`. From the project root, use Python 3.11 or later to prepare the next version. Review the diff before tagging.

```sh
python3 scripts/release.py prepare 1.0.1
git diff
git add CHANGELOG.md package.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore(release): v1.0.1"
git tag v1.0.1
git push --atomic origin HEAD refs/tags/v1.0.1
```

The script updates the app version in `package.json`, `Cargo.toml`, and `Cargo.lock`, then moves the unreleased notes under the new version. Tauri reads its version from `package.json`.

On a `vX.Y.Z` tag, **Release desktop** runs the tests, builds the packages on each OS, and signs the updates. The publish job verifies each signature with the configured public key and assembles a single `latest.json` manifest. The GitHub Release becomes public once all files have been uploaded.

| Platform | First installation | Subsequent updates |
| --- | --- | --- |
| macOS Intel and Apple Silicon | Universal DMG | Universal app archive via the updater |
| Windows x64 | NSIS installer | NSIS installer verified by the Tauri updater |
| Linux x64 (AppImage) | AppImage | Signed AppImage via the updater |
| Linux x64 (Debian) | `.deb` package | Install the new package with the system package manager |

The updater reads `https://github.com/yapmod/desktop/releases/latest/download/latest.json` and checks the downloaded package against the signature in the manifest. [Tauri updater](https://v2.tauri.app/plugin/updater/)

If a job fails, fix the cause and rerun the affected jobs. Uploads can resume on an existing draft release. To correct a public release, publish a higher version with its own notes and tag.

## Publishing the desktop plugin

Merge changes to `plugin/src/` or `plugin/manifest.json` into the default branch, then select **Actions → Publish desktop plugin → Run workflow** on that branch. The job type-checks the plugin, runs the Yapmod builder and JavaScript tests, then signs and verifies `plugin/dist/desktop-plugins.js`. Cargo embeds the same registration artifact when building the desktop app. It uploads that file and `desktop-plugins.js.sig` to the `plugins-v1` GitHub prerelease. The release notes identify the source commit. The app version can stay the same.

Each publication replaces both assets. GitHub must allow asset changes on this prerelease. If an upload is interrupted, rerun the workflow to restore a matching plugin and signature. Preserve the v1 plugin contract for installed apps. For an incompatible native API change, create a separate channel and ship an app version that supports it.

## Checking the macOS disk image

CI uses `dmgbuild` to write the Finder layout directly into the disk image. It reads the dimensions, background, and icon positions from `bundle.macOS.dmg` in the Tauri configuration. To reproduce the build locally, run these commands from the project root with uv installed. [uv documentation](https://docs.astral.sh/uv/)

```sh
pnpm tauri build --bundles app
uv run --script scripts/release-dmg.py \
  "src-tauri/target/release/bundle/macos/Yapmod Desktop.app" \
  "src-tauri/target/release/bundle/dmg/Yapmod-Desktop.dmg"
```

The script verifies the image with `hdiutil verify`. Open it in Finder to check the background and the positions of the app and the Applications shortcut. [dmgbuild](https://github.com/dmgbuild/dmgbuild)

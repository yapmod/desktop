# Releasing Yapmod Desktop

Host releases in a public GitHub repository so installed apps can download updates without an access token. The workflow reads the repository name from `GITHUB_REPOSITORY`. The Yapmod client follows stable releases of `yapmod/client` on its own schedule.

Pull requests and pushes to `main` run formatting and tests on Linux. Merging the rolling release PR triggers the macOS, Windows, and Linux installer builds.

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

Enable **Settings → Actions → General → Allow GitHub Actions to create and approve pull requests**. Require **Format and test** in branch protection. The built-in token opens the release PR and explicitly dispatches its checks and publishing workflows.

Set the repository secret `YAPIN_RELEASE_WEBHOOK_URL` to the same webhook used by `yapmod/client`, and the variable `YAPIN_RELEASE_ROLE_ID` to the Yapmod role ID. Only that role is pinged.

## Publishing a stable release

1. Write concise user-facing bullets under `## [Unreleased]` in `CHANGELOG.md` in each product PR. Group them under Added, Changed, Fixed, or Removed and use inline links. Source changes require changed notes in CI; docs, tests, and tooling-only PRs do not.
2. Squash-merge with a Conventional Commit title: `fix:` selects a patch, `feat:` a minor, and `!` or `BREAKING CHANGE:` a major.
3. Release Please refreshes one release PR with the accumulated hand-written notes. Review its versions, notes, and checks, then merge when ready to ship.
4. The workflow creates a stable tag and draft release, dispatches **Release desktop**, and publishes only after all installers and signatures have been verified and uploaded. A successful publication announces the release on Yapin.

Automation updates `package.json`, `src-tauri/Cargo.toml`, and the desktop package in `src-tauri/Cargo.lock` together. Tauri reads its version from `package.json`. It moves notes beneath a version/date heading without generating prose and leaves an empty Unreleased section. Empty notes produce no release. Edit notes through ordinary PRs against main; direct edits to the release branch are overwritten on refresh. Published notes come from the changelog at the approved tag.

A version/date heading records the version approved by a merged release PR; it does not prove that installers are public. Check the GitHub release status. An empty Unreleased section is valid while that approved version is building or waiting for recovery.

If a release PR was merged but no tag or draft was created, inspect the Release Please logs before retrying. If the approved commit itself needs a fix (including a failing test), do not publish or retag that commit. Remove `autorelease: pending` from the superseded merged PR, then restore its notes to Unreleased and the package, Cargo, and manifest versions to the last published version in a repair PR. Merge the repair and let Release Please prepare a fresh release PR for the still-unpublished version. Merge that new proposal to publish the corrected source. Never use this recovery for a version that is already public.

The migration starts from the existing `v1.1.0` tag and includes the current Unreleased entries in the next proposal. Merging the migration only opens that proposal; it does not publish installers. The independently published `plugins-v1` prerelease is excluded from desktop announcements.

The pinned Release Please library runs the local `manual-node` strategy. Do not use its stock action or CLI, which would omit the custom notes and Cargo updates.

| Platform | First installation | Subsequent updates |
| --- | --- | --- |
| macOS Intel and Apple Silicon | Universal DMG | Universal app archive via the updater |
| Windows x64 | NSIS installer | NSIS installer verified by the Tauri updater |
| Linux x64 (AppImage) | AppImage | Signed AppImage via the updater |
| Linux x64 (Debian) | `.deb` package | Install the new package with the system package manager |

The updater reads `https://github.com/yapmod/desktop/releases/latest/download/latest.json` and checks the downloaded package against the signature in the manifest. [Tauri updater](https://v2.tauri.app/plugin/updater/)

If a job fails, rerun it or dispatch **Release desktop** from `main` with the existing tag:

```sh
gh workflow run desktop.yml --ref main -f tag=v1.2.0
```

Use the failed release’s actual tag. The workflow checks out that tag, verifies it belongs to `main`, and checks the version and release manifest. Already-public releases are skipped; drafts can resume. To correct a public release, publish a higher version through the release PR.

Publishing with `GITHUB_TOKEN` does not trigger release events, so the publisher explicitly calls **Announce release on Yapin**. Manual publication is covered by the release event. If announcement delivery fails, rerun that job; to resend, dispatch the announcement workflow with the published tag. Resending posts another message. Delivery failures do not roll back the release. Notes are shortened at complete lines to fit the message limit, with a link to the full release.

If checks were not dispatched, run **Checks** on the release branch. If proposal creation fails, correct permissions and rerun **Release Please** on main.

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

## Release announcement design

Published stable releases send a short, branded embed with a non-empty role mention and two buttons: downloads and the release notes website. Notes are excerpted at complete lines within 650 characters. A local PNG generator uses the project's logo, colors, and Geist fonts; no image-generation service is needed. The banner is stored on the dedicated `release-banners` branch and linked through a commit-pinned raw GitHub URL so Yapin can proxy it.

The announcement job needs `contents: write` for its image branch. It reuses the Actions run ID as the webhook nonce: retries within ten minutes do not post duplicates. A new manual workflow run intentionally sends another message. After a timeout outside that window, check the channel before retrying.

Install banner tooling with `npm ci --prefix .github/announcement`. Generate a local PNG with `node .github/announcement/banner.mjs releases.json banner.png`, passing a JSON array of stable release objects.

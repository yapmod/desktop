# Changelog

## Unreleased

### Changed

- Run tests on pull requests and main, and build installers on release tags.
- Use Ubuntu's public archive for Linux CI packaging dependencies.
- Use pnpm for local development, CI, and release tooling (#2).

## v1.0.0

- Open Yapin in a persistent desktop window with Google sign-in and independently updated Yapmod client releases.
- Use Yapin’s existing signed-in header for the rounded Yapmod icon and title. Integrate native macOS traffic lights and Windows caption buttons. Keep the system window frame on Linux.
- Add desktop settings and native notifications through the Yapmod plugin API.
- Use the WebView’s native message channel for desktop commands and keep sign-in frames isolated from desktop permissions.
- Build a universal macOS disk image, a Windows x64 installer, and Linux x64 AppImage and Debian packages.
- Verify signatures for desktop app and plugin updates with a project-owned Tauri key.

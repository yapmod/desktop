# Changelog

## [Unreleased]

### Added

- Adjust [background transparency and blur](README.md) in **Settings → Yapmod → Desktop → Appearance** with the [shared Yapmod slider](https://github.com/yapmod/client/pull/124), without fading text, images, or dialogs. Blur follows the system effect where supported.

### Changed

- [Yaplay 1.6](https://github.com/ilyeshdz/yaplay/releases/tag/v1.6.0) now shows Yapmod Desktop by name and offers overlay controls and shortcuts for the voice actions available in Yapin.

## [1.2.1] — 2026-11-23

### Fixed

- Allow the packaged macOS app to request microphone and camera access for Yapin calls.

## [1.2.0] — 2026-11-22

### Added

- Expand the system tray with live call and microphone status, mute/deafen controls, and a one-hour desktop notification snooze. Call controls work independently of Yaplay.
- Restore Yapin unread-count badges on the macOS Dock, supported Linux launchers, and Windows taskbar. Counts clear when read or navigating away and are capped at 99.
- Enable file downloads from Yapin and show a native Save dialog to choose the filename and destination.

### Changed

- Releases now use a rolling release PR with hand-written notes and announce published desktop updates on Yapin.

## v1.1.0

### Desktop

- Keep Yapmod Desktop running in the system tray when closing its window. Use the tray menu to reopen the app or quit; notification clicks and the macOS Dock also restore the window.
- Ask for microphone and camera access through the browser permission flow on macOS and Windows. Block new media requests from the local shell, sign-in windows, and pages outside Yapin. Linux calling support remains unavailable.
- Enable the built-in Yaplay integration in Desktop settings for live call rosters, speaking indicators, notifications, and overlay mute, deafen, and leave-call controls. The native bridge connects to Yaplay on localhost and reconnects automatically.
- Support Yaplay 1.2 profile pictures, including server avatars, and discard delayed overlay controls after switching calls.

### Development

- Build and load the local Yapmod client before starting `pnpm dev`.

## v1.0.0

### Desktop

- Sign in to Yapin, including with Google, and keep your session between launches. The app loads the latest stable Yapmod client and can reuse a verified cached copy.
- Use Yapin’s existing header with the rounded Yapmod icon, native macOS traffic lights, and Windows caption buttons. Linux uses its system window frame.
- Open **Settings → Yapmod → Desktop** to manage native notifications, enable **Launch at login**, or check for app updates. Launch at login is off by default (#1).
- Resize the main window and sign-in popups on compact displays while keeping their controls accessible (#3).

### Installation and updates

- Download a universal macOS disk image, a Windows x64 installer, or a Linux x64 AppImage or Debian package.
- The app verifies signed desktop updates and can receive independent signed updates to its bundled TypeScript and Solid JSX plugin (#4).
- The desktop bridge uses native WebView messaging. Google sign-in windows and embedded authentication frames retain their own browser APIs.

### Development

- Use pnpm for development, testing, and releases (#2).
- Pull requests and pushes to main run formatting and tests. Release tags build the installers, with Linux packaging dependencies downloaded from Ubuntu’s public archive.

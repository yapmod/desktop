# Changelog

## Unreleased

- Build and load the local Yapmod client before starting `pnpm dev`.

- Support Yaplay 1.2 profile pictures, including server avatars, and discard delayed overlay controls after switching calls.

- Add an optional Yaplay integration in Desktop settings for live call rosters, speaking indicators, notifications, and overlay mute, deafen, and leave-call controls. The native bridge connects to Yaplay on localhost and reconnects automatically.

- Ask for microphone and camera access through the browser permission flow on macOS and Windows. Block new media requests from the local shell, sign-in windows, and pages outside Yapin. Linux calling support remains unavailable.
- Keep Yapmod Desktop running in the system tray when closing its window. Use the tray menu to reopen the app or quit; notification clicks and the macOS Dock also restore the window.

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

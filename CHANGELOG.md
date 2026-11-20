# Changelog

## Unreleased

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

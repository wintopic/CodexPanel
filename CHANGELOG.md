# Changelog

## v3.0.13 - 2026-07-03

- Improved Windows frameless window corner rendering.
- Made the WebView/window background transparent so the visible shell owns the rounded edge.
- Added slightly more spacing around the core controls.

## v3.0.12 - 2026-07-03

- Added a Windows-only frameless desktop window.
- Added custom title-bar drag area with minimize and close controls.
- Kept the desktop window fixed-size with maximise unavailable.

## v3.0.11 - 2026-07-02

- Kept the remote composer usable while a Codex thread is running.
- Added queued send as the default running-state submit mode.
- Added guide submit from Ctrl+Enter and the mobile guide button.
- Improved mobile keyboard restore behavior so the composer settles back to the bottom.

## v3.0.5 - 2026-07-02

- Renamed and cleaned the project as `CodexPanel`.
- Added a compact fixed-size Tauri 2 desktop control panel for Windows.
- Replaced old project branding and icons with the CodexPanel icon set.
- Added Rust-managed Node sidecar startup for the local service.
- Added working desktop service controls for `start`, `stop`, and `restart`.
- Added Windows process-tree cleanup so stopping the service releases the local port.
- Kept remote control in the browser/mobile UI while the desktop panel stays local.
- Removed packaged secrets; remote key and Cloudflare URL remain user-provided runtime config.
- Added GitHub Actions Windows release packaging on `main` updates.

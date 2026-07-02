# Changelog

## v3.0.10 - 2026-07-02

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

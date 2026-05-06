# Changelog

All notable changes to FlipperUI are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres (roughly) to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) while pre-1.0.

## [Unreleased]

### Added
- Added a GitHub bug-report issue template with required reproduction context and environment fields.
- Added a GitHub feature-request issue template with workflow, area, and transport-scoped prompts.
- Added issue-template config enabling blank issues.
- GitHub Sponsors metadata via `.github/FUNDING.yml` with Buy Me a Coffee support.

### Changed
- README updates now include an unsigned-build disclaimer and a macOS quarantine-removal troubleshooting command.
- README clone URL example now uses `https://github.com/fuckmaz/FlipperUI.git`.
- README now includes a maintainer sign-off line and a Stargazers-over-time chart section.
- Backfilled and expanded `CHANGELOG.md` release history for versions `0.3.0` through `0.3.5`, including updated compare/release links.

### Fixed
- Dashboard battery voltage display now converts millivolts to volts in `BatteryCard` to avoid incorrectly scaled voltage values.

## [0.3.5] — 2026-05-05

### Added
- OS notifications for completed library scans, transfers, and unexpected device disconnects, with a Settings toggle.
- Tauri notification plugin wiring across frontend and backend.
- More polished first-release README content and GitHub-facing project presentation.
- Release screenshot asset for the dashboard preview.

### Changed
- Refactored frontend/backend code structure for readability and maintainability.
- Polished the Screen Stream and GIF recorder UI.
- Replaced text-heavy Connect/Disconnect controls with compact icon controls.
- Standardized CI artifact names for macOS, Windows, and Linux bundles.
- Gated the native app menu to macOS so Windows does not render an unwanted gray menu strip below the title bar.

### Fixed
- Improved session-management formatting and error handling.
- Windows menu-bar appearance now follows the in-app dark UI more cleanly.

## [0.3.4] — 2026-04-30

### Added
- Global Search for indexed library entries and the currently loaded File Explorer directory.
- Search result routing into Apps, Sub-GHz, Infrared, NFC, RFID, BadUSB, and Files.
- Windows CI bundle builds and uploaded build artifacts for macOS, Windows, and Linux.

### Changed
- Global Search now expands/collapses from the header, includes a close control, and keeps the header layout tighter.
- Increased the default main-window height to improve dense dashboard and library layouts.

### Fixed
- Windows USB serial connection handling.
- USB auto-connect loop on Windows by adding a cooldown after failed automatic connection attempts.
- Error banner placement so connection and runtime errors are visible in the main layout.

## [0.3.3] — 2026-04-30

### Added
- RFID / 125 kHz library with recursive scanning, metadata parsing, filtering, caching, upload, download, rename, and delete flows.
- Sub-GHz favorites with star toggles and a starred-only filter.
- Modified-time columns across library tables.
- Sorting by modification time for library rows.
- Shared formatting and path helpers for library views.

### Changed
- DevicePanel now shows a battery percentage chip with a progress bar.
- Dashboard links to the detailed Device Info view directly.
- Device Info was removed from the primary side rail to keep navigation focused.
- Library upload flows no longer trigger an unnecessary full refresh after upload.

### Fixed
- BatteryChip display for firmware variants that report battery fields under different key names.
- TypeScript and cross-platform path issues affecting macOS and Windows builds.
- BLE auto-reconnect behavior after connection breaks.

## [0.3.2] — 2026-04-28

### Added
- Visual bezel/backlight border around the Screen Stream canvas to better match the physical Flipper display.
- DevicePanel battery chip with live percentage and charging state.
- Dashboard quick link into the detailed Device Info page.

### Changed
- Adjusted default app height for a better first-run layout.
- Removed an unused dashboard spinner asset.

### Fixed
- BLE screen-view reliability, including control-command queuing during active streaming.
- Screen input handling during rapid controls and long-press style interactions.

## [0.3.1] — 2026-04-27

### Added
- BLE auto-reconnect after unexpected connection breaks or failures.
- Persisted connection type so the app remembers USB vs BLE between launches.
- On-device Settings UI backed by files under `/int`.
- File Explorer internal/external storage toggle.

### Changed
- Redesigned the DevicePanel info bar for clearer connected-device status.
- BLE scan and connection logic received another round of reliability improvements.

### Fixed
- BLE screen-stream framing and reader issues.
- Race conditions between screen streaming and control commands.
- Storage command teardown behavior while screen streaming is active.

## [0.3.0] — 2026-04-24

### Added
- Dashboard view with device overview, firmware, battery, storage, and library status.
- Command Palette for quick navigation and device actions.
- Drag-in uploads in the File Explorer, including folder hover targeting and a drop overlay.
- Drag-to-Finder export hooks for library rows.
- System tray / menubar icon with Show/Hide/Quit controls.
- macOS Dock visibility setting for menubar-style usage.
- Splashscreen window flow and delayed main-window reveal.
- ESLint configuration and initial CI workflow.
- First structured `CHANGELOG.md`.

### Changed
- README expanded with feature list, quick start, architecture notes, and troubleshooting.
- Settings gained tray, dock, and scan-path controls.
- File Browser upload/download behavior was tightened around progress and cancellation.

### Fixed
- BLE `read_exact` is now atomic with no partial consumption on timeout, fixing intermittent protobuf decode failures when messages span notifications.
- CLI startup now stops an active screen stream before entering CLI mode.
- Several storage and RPC paths now handle active screen streaming more safely.

## [0.2.3] — 2026-04-23

### Added
- iOS-style USB/BLE transport toggle in the Device panel. USB auto-connect is suppressed while BLE is selected.
- Shared `ScanProgressBar` component with an indeterminate animation for the pre-first-event dead zone.
- Live `<datalist>` autocompletion on Settings paths (excluded dirs, extra roots) via the new `useDirectorySuggestions` hook.

### Changed
- BLE scan duration bumped from 1.8 s to 10 s so slower-advertising devices show up reliably.
- Library-scan command boilerplate collapsed into a shared `run_library_scan` helper; subghz / ir / nfc / badusb command modules reduced to ~25 lines each.

## [0.2.2] — 2026-04-22

### Added
- BadUSB library: scanning, filtering, preview modal, per-device cache.
- `FilePreviewModal` for inspecting script contents before write.
- `LibraryTable`, `LibraryToolbar`, and BadUSB-specific icons.

## [0.2.0] — 2026-04-21

### Added
- BLE transport — file browser and library operations work over Bluetooth LE. CLI-over-BLE is not supported.

## [0.1.2]

### Added
- SubGHz, Infrared, and NFC libraries with metadata parsing and per-device caching.
- Dedicated System Info pane (firmware, hardware UID, battery, storage).
- Screen Stream and CLI promoted to top-level nav items.

### Fixed
- Stability and performance improvements across the board.

## [0.1.1]

### Added
- Screen streaming with keyboard controls.
- CLI implementation over serial.
- Screen recorder + GIF export (60 s cap, 2-color palette).
- Developer diagnostics panel — 500-entry ring buffer of TX/RX frames with time, direction, command id, kind, byte count, and status.
- Settings pane with version, credit, and entry point to Developer diagnostics.
- Custom macOS menu bar (FlipperUI / Edit / Window submenus; Cmd+, → Settings).
- New 1024×1024 app icon generated via `tauri icon`.
- Bundle copyright "in love -maz" on the About dialog.

### Fixed
- Screen-stream freeze when holding a button — input events now route through an mpsc channel consumed by the reader thread, serializing writes and reads on one thread and eliminating the mutex starvation that corrupted frame framing.
- Stale "connected" UI after an unrecoverable reader error — Rust tears down the client and emits `flipper-disconnected`; `App.tsx` flips the UI accordingly.

## [0.1.0] — Initial commits

- Dark theme.
- Basic file browser and device info.
- Initial Tauri v2 scaffolding.

[Unreleased]: https://github.com/fuckmaz/FlipperUI/compare/v0.3.5...HEAD
[0.3.5]: https://github.com/fuckmaz/FlipperUI/releases/tag/v0.3.5
[0.3.4]: https://github.com/fuckmaz/FlipperUI/commit/93b85cc
[0.3.3]: https://github.com/fuckmaz/FlipperUI/commit/fc62325
[0.3.2]: https://github.com/fuckmaz/FlipperUI/commit/7116d52
[0.3.1]: https://github.com/fuckmaz/FlipperUI/commit/5114ac9
[0.3.0]: https://github.com/fuckmaz/FlipperUI/commit/bf4b916
[0.2.3]: https://github.com/fuckmaz/FlipperUI/commit/d319662
[0.2.2]: https://github.com/fuckmaz/FlipperUI/commit/f06153f
[0.2.0]: https://github.com/fuckmaz/FlipperUI/commit/0eadc2e
[0.1.2]: https://github.com/fuckmaz/FlipperUI/commit/044abd8
[0.1.1]: https://github.com/fuckmaz/FlipperUI/commit/8cc675a
[0.1.0]: https://github.com/fuckmaz/FlipperUI/commit/88af77c

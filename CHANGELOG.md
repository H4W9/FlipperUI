# Changelog

All notable changes to FlipperUI are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres (roughly) to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) while pre-1.0.

## [Unreleased]

### Added
- Drag-to-Finder export from every library row (SubGHz, Infrared, NFC, BadUSB, Apps). Shared `useExportDrag` hook underpins both the library rows and the existing File Browser drag.
- Improved README with features list, quick-start, architecture diagram, and troubleshooting.
- This CHANGELOG.

### Fixed
- BLE `read_exact` is now atomic — no partial consumption on timeout. Fixes the intermittent "Protobuf decode error: invalid tag value: 0" that surfaced during BLE screen streaming when a frame spanned multiple notifications.

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

[Unreleased]: https://github.com/your-fork/FlipperUI/compare/v0.2.3...HEAD
[0.2.3]: https://github.com/your-fork/FlipperUI/releases/tag/v0.2.3
[0.2.2]: https://github.com/your-fork/FlipperUI/releases/tag/v0.2.2
[0.2.0]: https://github.com/your-fork/FlipperUI/releases/tag/v0.2.0
[0.1.2]: https://github.com/your-fork/FlipperUI/releases/tag/v0.1.2
[0.1.1]: https://github.com/your-fork/FlipperUI/releases/tag/v0.1.1

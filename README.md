# FlipperUI

A fast, lightweight qFlipper alternative for the Flipper Zero. Built with Tauri v2 — native Rust backend, React frontend, ~15 MB installer.

![version](https://img.shields.io/badge/version-0.3.0-FF8300)
![license](https://img.shields.io/badge/license-TBD-lightgrey)
![platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-blue)

> ⚠️ **Pre-release.** API and UI are still changing. Tested primarily on macOS.

## Features

- **File browser** — breadcrumb nav, upload / download / rename / delete / mkdir, drag-and-drop between Finder and the device, virtualized for large folders.
- **Libraries** — dedicated, scannable views for SubGHz, Infrared, NFC, BadUSB, and installed apps. Metadata parsed out of each file format. Per-device offline cache so scans survive disconnect.
- **Live screen streaming** — 128 × 64 frames mirrored from the device in real-time with keyboard controls and GIF recording (60 s cap, 2-color palette).
- **CLI terminal** — full Flipper CLI over serial with history, Ctrl+C, and output streaming.
- **Device info** — firmware, battery, storage, hardware UID, plus a reboot control.
- **Two transports** — USB serial at 230 400 baud (default), or BLE for file and library operations (CLI over BLE is not supported).
- **Developer diagnostics** — in-app ring buffer of TX/RX protobuf frames with field-level inspection for protocol debugging.
- **Settings** — excluded / extra scan roots with live directory autocompletion.

## Prerequisites

- **Node.js** 18 or newer, with `npm`
- **Rust** stable toolchain via `rustup`
- **Tauri v2 platform prerequisites** — see [v2.tauri.app/start/prerequisites](https://v2.tauri.app/start/prerequisites/) (Xcode Command Line Tools on macOS; `build-essential` and `webkit2gtk-4.1-dev` on Linux; Visual Studio Build Tools on Windows)

No system `protoc` is required — the build script vendors its own copy via `protoc-bin-vendored`.

## Quick start

```bash
git clone https://github.com/<your-fork>/FlipperUI.git
cd FlipperUI
npm install
npm run tauri dev
```

The first run compiles the Rust backend; subsequent runs hot-reload the frontend and rebuild the backend only on `.rs` changes.

## Commands

```bash
# Development — Vite hot-reload frontend, Rust rebuild on .rs change
npm run tauri dev

# Production bundle — platform installer in src-tauri/target/release/bundle/
npm run tauri build

# Frontend-only Vite server (no Tauri, limited usefulness)
npm run dev

# Type-check frontend (no emit)
npx tsc --noEmit

# Run Rust unit tests
cd src-tauri && cargo test
```

## Architecture

```
┌────────────────────────┐        ┌────────────────────────┐
│   React (Zustand)      │  IPC   │   Rust (Tauri v2)      │
│   src/                 │◀──────▶│   src-tauri/src/       │
│                        │  JSON  │                        │
│   - components/        │        │   - commands/          │
│   - store/             │        │   - flipper/           │
│   - hooks/             │        │     · framing.rs       │
│   - lib/tauri.ts       │        │     · storage.rs       │
└────────────────────────┘        │     · gui.rs           │
         │                        │     · ble/             │
         │   screen-frame,        │   - state.rs (AppState)│
         │   cli-output,          │                        │
         │   upload-progress      └─────────┬──────────────┘
         │   events                         │
                                            │ serial (230400 8N1)
                                            ▼
                                  ┌────────────────────────┐
                                  │   Flipper Zero         │
                                  │   protobuf RPC over    │
                                  │   varint-framed serial │
                                  └────────────────────────┘
```

- **Frontend:** React 18 + Zustand (single store at `src/store/useFlipperStore.ts`) + Tailwind CSS v4, built with Vite.
- **Backend:** Tauri v2 Rust. All serial I/O happens in `spawn_blocking` so the main thread never stalls on the port.
- **Protocol:** Protobuf messages (generated at build time by `prost-build`) wrapped in varint-length frames. See `src-tauri/src/flipper/framing.rs`.
- **IPC payload shape:** Binary crosses the boundary as **base64**; long-running operations (file transfer, CLI, screen stream) emit Tauri events instead of returning from the invoke.

For the full walkthrough — connection modes, async patterns, and Tauri v2 gotchas — see [CLAUDE.md](CLAUDE.md).

## Troubleshooting

**"Port is busy" or connection times out (USB)**
- Another app (qFlipper, serial monitor, Arduino IDE) is holding the port. Close it and reconnect.
- On macOS, replug the cable — the `cu.usbmodem*` device name occasionally sticks.

**BLE: "device not found" after pairing**
- Pair the Flipper in your OS's Bluetooth settings first. `btleplug` cannot initiate pairing.
- Scan is currently bounded at 10 s. If your Flipper advertises slowly, trigger a rescan.

**CLI doesn't work over BLE**
- Not supported. Switch the transport toggle to USB for CLI.

**Screen stream drops with "Protobuf decode error"**
- The BLE transport recently got an atomicity fix for this; make sure you're on v0.2.3+. If it still occurs on USB, open an issue with the log output.

**"CLI mode active" error on any RPC call**
- The device is still in CLI mode. Use **Stop CLI** or reconnect.

**Uploads silently finish but files don't appear**
- Flipper rejects writes to `/int` over RPC; target `/ext` paths.

## Contributing

Issues and PRs welcome. Please run `npx tsc --noEmit` and `cargo test` before opening a PR. The project hasn't set up CI or linting yet — that's on the roadmap.

## License

TBD.

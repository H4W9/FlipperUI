# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

FlipperUI is a Tauri v2 desktop app — a qFlipper replacement focused on file browsing for the Flipper Zero. The frontend is React + Zustand + TailwindCSS v4, built with Vite. The backend is Rust and communicates with the Flipper over a serial port using the Flipper RPC protocol (protobuf over varint-framed serial at 230400 baud).

## Commands

```bash
# Development (hot-reload frontend + Rust rebuild on change)
npm run tauri dev

# Production build
npm run tauri build

# Frontend only (no Tauri, limited usefulness)
npm run dev

# Run Rust unit tests
cd src-tauri && cargo test

# Type-check frontend
npx tsc --noEmit
```

There is no linter configured. No test framework on the frontend.

## Architecture

### Rust Backend (`src-tauri/src/`)

**`state.rs`** — `AppState` is the single shared state managed by Tauri. It holds:
- `client: Arc<Mutex<Option<FlipperClient>>>` — the connected serial device
- `mode: Arc<Mutex<ConnectionMode>>` — either `Rpc` or `Cli`
- `cli_reader_active`, `transfer_cancelled`, `screen_stream_active` — `Arc<AtomicBool>` flags for background thread coordination
- `input_event_tx: Mutex<Option<mpsc::Sender>>` — channel for routing button presses through the screen reader thread

**`flipper/`** — Protocol implementation:
- `framing.rs` — varint-prefixed protobuf frame encode/decode over `dyn SerialPort`
- `session.rs` — RPC session handshake, ping, device info, power info, reboot
- `storage.rs` — all file operations (list, stat, read, write, mkdir, delete, rename, info, timestamp, tar_extract). Read/write support cancellation via `Arc<AtomicBool>` and progress callbacks.
- `cli.rs` — switches the device out of RPC into CLI mode; spawns a reader thread that emits Tauri events
- `gui.rs` — screen streaming; spawns a reader thread emitting `screen-frame` Tauri events with base64 RGBA data
- `client.rs` — `FlipperClient` struct wrapping the serial port with an auto-incrementing command ID

**`commands/`** — Tauri `#[tauri::command]` async handlers that bridge `invoke()` calls to the flipper module. All commands that touch the serial port use `tauri::async_runtime::spawn_blocking` to avoid blocking the main thread. The `with_client` helper in `commands/storage.rs` guards every RPC call: it rejects calls while in CLI mode and **tears down the connection on any error** (forcing the user to reconnect).

**Protobuf bindings** (`pb_*` modules in `lib.rs`) are generated at build time by `prost-build` from `.proto` files. The build script (`build.rs`) uses `protoc-bin-vendored` so no system protoc is needed.

### Frontend (`src/`)

**`store/useFlipperStore.ts`** — single Zustand store for all UI state: connection, file browser, transfer progress, CLI history (capped at 5000 lines), screen viewer visibility.

**`lib/tauri.ts`** — all `invoke()` calls in one place, typed. **Tauri v2 uses `import { invoke } from "@tauri-apps/api/core"`** — not `@tauri-apps/api/tauri`.

**`types/flipper.ts`** — shared TypeScript types mirroring Rust structs.

**Components:**
- `DevicePanel/` — port selection, connect/disconnect, device info display
- `FileBrowser/` — directory listing with breadcrumb nav, toolbar (upload/download/mkdir/delete/rename), virtualized file list
- `CliPanel/` — terminal-style CLI backed by `cli_start`/`cli_send`/`cli_stop` commands and `cli-output` Tauri events
- `ScreenViewer/` — floating overlay showing live screen frames from `screen-frame` Tauri events

### IPC Conventions

- File data crosses the Tauri IPC boundary as **base64 strings** (binary can't be passed directly).
- Long-running operations (file read/write, screen stream, CLI) run on background Rust threads and communicate progress/output via **Tauri events** (not command return values).
- `cancel_transfer` sets `AppState.transfer_cancelled` atomically; storage read/write check it between chunks.
- CLI and screen streaming use separate `AtomicBool` flags (`cli_reader_active`, `screen_stream_active`) to stop their reader threads.

### Connection Modes

The device can only be in one mode at a time:
- **RPC mode** (default): protobuf commands via `with_client()`
- **CLI mode**: raw serial text; entered via `cli_start`, exited via `cli_stop` which re-enters RPC

`with_client()` returns `FlipperError::CliModeActive` if called while in CLI mode. Any RPC error tears down the client so the user must reconnect.

### Tauri v2 Async Patterns

- **All serial I/O commands must be `async` + `spawn_blocking`.** Sync `#[tauri::command]` functions run on the main thread in Tauri v2, freezing the UI during serial I/O.
- **`State<'_, AppState>` is not `Send`** — extract `Arc::clone(&state.field)` before the `spawn_blocking` closure boundary.
- **Never hold a `MutexGuard` across `.await`** — it breaks the `Send` bound required by Tauri's command dispatch. Scope guards in a block before any `.await`.
- **Screen reader loop uses a channel for input events** (`input_event_tx`) — `send_input_event` routes through the reader thread to avoid mutex contention and interleaved protobuf responses.
- **Reader thread port timeout**: screen reader uses 100ms (not the default 5s) to minimize mutex hold time. Restored to 5s on exit.

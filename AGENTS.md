# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project overview
- FlipperUI is a Tauri v2 desktop app with:
  - React + Vite + TypeScript frontend in `src/`
  - Rust backend in `src-tauri/` that talks to Flipper Zero over serial RPC
- Current scope from `README.md`: primarily a Flipper file explorer.

## Common commands
Run from repository root unless noted.

- Install dependencies:
  - `npm install`
- Frontend-only development server:
  - `npm run dev`
- Full desktop app in development (Vite + Tauri):
  - `npm run tauri dev`
- Frontend production build:
  - `npm run build`
- Desktop bundle build:
  - `npm run tauri build`

### Rust backend commands
- Check backend crate:
  - `cargo check --manifest-path src-tauri/Cargo.toml`
- Run backend tests:
  - `cargo test --manifest-path src-tauri/Cargo.toml`
- Run a single Rust test (example):
  - `cargo test --manifest-path src-tauri/Cargo.toml varint_roundtrip -- --exact`
- Optional linting:
  - `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`

### TypeScript checks
- No dedicated `lint` or `test` npm scripts are currently defined.
- `npm run build` runs `tsc` first, so it is the primary TypeScript correctness check.

## Architecture map (high-level)
### Frontend composition and state
- `src/App.tsx` composes:
  - `DevicePanel` (serial port discovery + connect/disconnect)
  - `FileBrowser` (file explorer UI)
  - `CliPanel` (terminal-like commands over storage APIs)
- Shared UI/application state is centralized in `src/store/useFlipperStore.ts` (Zustand).

### Frontend/backend API boundary
- Tauri invoke wrappers are centralized in `src/lib/tauri.ts`; prefer extending this layer over direct `invoke` calls in UI components.
- Shared data contracts are represented in `src/types/flipper.ts` and mirror Rust serde structs in `src-tauri/src/commands/`.

### Storage flow
- `src/hooks/useStorage.ts` is the orchestration point for file operations:
  - calls Rust storage commands via `src/lib/tauri.ts`
  - handles local dialogs/filesystem through Tauri plugins
  - converts bytes to/from base64
  - listens for `upload-progress` and `download-progress` Tauri events
- Both `FileBrowser` and `CliPanel` depend on these storage APIs; storage changes affect both workflows.

### Rust backend layering
- Tauri entrypoint and command registration: `src-tauri/src/lib.rs`
- Command handlers:
  - `src-tauri/src/commands/device.rs`
  - `src-tauri/src/commands/storage.rs`
- Shared connected-client state: `src-tauri/src/state.rs` (`Mutex<Option<FlipperClient>>`)
- `with_client(...)` in `commands/storage.rs` enforces exclusive client access and drops the connection on command errors (forcing reconnect).

### Flipper protocol internals
- `src-tauri/src/flipper/session.rs`: serial session handshake and device-info retrieval
- `src-tauri/src/flipper/framing.rs`: varint length framing + protobuf read/write
- `src-tauri/src/flipper/storage.rs`: RPC storage operations, chunked writes, streamed reads
- Protobuf code generation:
  - generated modules are included in `src-tauri/src/lib.rs`
  - generation logic is in `src-tauri/build.rs` from `src-tauri/proto/*.proto`

## Important implementation details to preserve
- Tauri v2 invoke import path is `@tauri-apps/api/core` (`src/lib/tauri.ts`).
- Tauri build wiring in `src-tauri/tauri.conf.json`:
  - `beforeDevCommand`: `npm run dev`
  - `devUrl`: `http://localhost:1420`
  - `beforeBuildCommand`: `npm run build`
- Vite is configured for Tauri development in `vite.config.ts`:
  - strict dev port `1420`
  - ignore `src-tauri/**` in watch
- RPC session startup command in Rust intentionally uses carriage return (`\r`) for `start_rpc_session`; changing this can break handshake.

# FlipperUI

A fast, lightweight qFlipper alternative for the Flipper Zero, built with Tauri v2.

**Features:** file browser with drag-and-drop, CLI terminal, live screen streaming, device info and battery status, reboot control.

## Prerequisites

- **Node.js** (v18+) and **npm**
- **Rust** toolchain (`rustup` — stable channel)
- **Tauri v2 prerequisites** — see [Tauri Getting Started](https://v2.tauri.app/start/prerequisites/) for your platform (Xcode CLT on macOS, build-essential + webkit2gtk on Linux, etc.)

## Development

```bash
# Install frontend dependencies
npm install

# Run the full desktop app (Vite hot-reload + Rust rebuild on change)
npm run tauri dev

# Frontend-only dev server (no Tauri backend — limited usefulness)
npm run dev
```

## Build

```bash
# Production build (creates platform installer in src-tauri/target/release/bundle/)
npm run tauri build
```

## Testing

```bash
# Type-check frontend
npx tsc --noEmit

# Run Rust unit tests
cd src-tauri && cargo test
```

## Architecture

- **Frontend:** React + Zustand + Tailwind CSS v4, built with Vite
- **Backend:** Rust (Tauri v2), communicates with Flipper Zero over serial (protobuf RPC at 230400 baud)
- **IPC:** File data crosses the boundary as base64. Long operations use Tauri events for progress/streaming.

See [CLAUDE.md](CLAUDE.md) for detailed architecture documentation.

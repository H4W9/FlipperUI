/**
 * Typed wrappers over Tauri v2's invoke API.
 * IMPORTANT: In Tauri v2, invoke is imported from "@tauri-apps/api/core", not "@tauri-apps/api/tauri".
 */
import { invoke } from "@tauri-apps/api/core";
import type { DeviceInfo, FileEntry, PortInfo, StorageInfo } from "../types/flipper";

// ── Device commands ────────────────────────────────────────────────────────

export const listPorts = (): Promise<PortInfo[]> =>
  invoke<PortInfo[]>("list_ports");

export const connect = (port: string): Promise<DeviceInfo> =>
  invoke<DeviceInfo>("connect", { port });

export const disconnect = (): Promise<void> =>
  invoke<void>("disconnect");

// ── Storage commands ───────────────────────────────────────────────────────

export const storageList = (path: string): Promise<FileEntry[]> =>
  invoke<FileEntry[]>("storage_list", { path });

export const storageStat = (path: string): Promise<FileEntry> =>
  invoke<FileEntry>("storage_stat", { path });

/**
 * Read a file from the Flipper. Returns base64-encoded bytes.
 * Decode with: Uint8Array.from(atob(result), c => c.charCodeAt(0))
 */
export const storageRead = (path: string): Promise<string> =>
  invoke<string>("storage_read", { path });

/**
 * Write a file to the Flipper. `data` must be base64-encoded.
 * Encode with: btoa(String.fromCharCode(...new Uint8Array(buffer)))
 */
export const storageWrite = (path: string, data: string): Promise<void> =>
  invoke<void>("storage_write", { path, data });

export const storageMkdir = (path: string): Promise<void> =>
  invoke<void>("storage_mkdir", { path });

export const storageDelete = (path: string, recursive: boolean): Promise<void> =>
  invoke<void>("storage_delete", { path, recursive });

export const storageRename = (oldPath: string, newPath: string): Promise<void> =>
  invoke<void>("storage_rename", { oldPath, newPath });

export const storageInfo = (path: string): Promise<StorageInfo> =>
  invoke<StorageInfo>("storage_info", { path });

export const storageTimestamp = (path: string): Promise<number> =>
  invoke<number>("storage_timestamp", { path });

export const storageTarExtract = (tarPath: string, outPath: string): Promise<void> =>
  invoke<void>("storage_tar_extract", { tarPath, outPath });

/** Cancel an in-progress file transfer (upload or download). */
export const cancelTransfer = (): Promise<void> =>
  invoke<void>("cancel_transfer");

// ── Device extended commands ──────────────────────────────────────────────

export const powerInfo = (): Promise<Record<string, string>> =>
  invoke<Record<string, string>>("power_info");

export const reboot = (mode: number): Promise<void> =>
  invoke<void>("reboot", { mode });

// ── CLI commands ──────────────────────────────────────────────────────────

// ── Screen streaming commands ───────────────────────────────────────────

/** Start streaming the Flipper's screen. Emits "screen-frame" events with base64 RGBA data. */
export const screenStreamStart = (): Promise<void> =>
  invoke<void>("screen_stream_start");

/** Stop streaming the Flipper's screen. */
export const screenStreamStop = (): Promise<void> =>
  invoke<void>("screen_stream_stop");

// ── CLI commands ──────────────────────────────────────────────────────

/** Enter CLI mode: stops RPC session and starts streaming serial output. */
export const cliStart = (): Promise<void> =>
  invoke<void>("cli_start");

/** Send a text command to the Flipper CLI. */
export const cliSend = (input: string): Promise<void> =>
  invoke<void>("cli_send", { input });

/** Leave CLI mode and re-enter RPC mode. */
export const cliStop = (): Promise<void> =>
  invoke<void>("cli_stop");

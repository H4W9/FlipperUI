/**
 * Typed wrappers over Tauri v2's invoke API.
 * IMPORTANT: In Tauri v2, invoke is imported from "@tauri-apps/api/core", not "@tauri-apps/api/tauri".
 */
import { invoke } from "@tauri-apps/api/core";
import type { DeviceInfo, FileEntry, PortInfo } from "../types/flipper";

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

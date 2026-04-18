/**
 * Typed wrappers over Tauri v2's invoke API.
 * IMPORTANT: In Tauri v2, invoke is imported from "@tauri-apps/api/core", not "@tauri-apps/api/tauri".
 */
import { invoke } from "@tauri-apps/api/core";
import type { DeviceInfo, FileEntry, PortInfo, StorageInfo } from "../types/flipper";
import { getCliCleanupPromise } from "../components/CliPanel/CliPanel";

// Helper to await any in-progress CLI cleanup before making RPC calls
async function awaitCliCleanup(): Promise<void> {
  const promise = getCliCleanupPromise();
  if (promise) {
    await promise;
  }
}

// ── Device commands ────────────────────────────────────────────────────────

export const listPorts = (): Promise<PortInfo[]> =>
  invoke<PortInfo[]>("list_ports");

export const connect = (port: string): Promise<DeviceInfo> =>
  invoke<DeviceInfo>("connect", { port });

export const disconnect = (): Promise<void> =>
  invoke<void>("disconnect");

// ── Storage commands ───────────────────────────────────────────────────────

export const storageList = async (path: string): Promise<FileEntry[]> => {
  await awaitCliCleanup();
  return invoke<FileEntry[]>("storage_list", { path });
};

export const storageStat = async (path: string): Promise<FileEntry> => {
  await awaitCliCleanup();
  return invoke<FileEntry>("storage_stat", { path });
};

/**
 * Read a file from the Flipper. Returns base64-encoded bytes.
 * Decode with: Uint8Array.from(atob(result), c => c.charCodeAt(0))
 */
export const storageRead = async (path: string): Promise<string> => {
  await awaitCliCleanup();
  return invoke<string>("storage_read", { path });
};

/**
 * Write a file to the Flipper. `data` must be base64-encoded.
 * Encode with: btoa(String.fromCharCode(...new Uint8Array(buffer)))
 */
export const storageWrite = async (path: string, data: string): Promise<void> => {
  await awaitCliCleanup();
  return invoke<void>("storage_write", { path, data });
};

export const storageMkdir = async (path: string): Promise<void> => {
  await awaitCliCleanup();
  return invoke<void>("storage_mkdir", { path });
};

export const storageDelete = async (path: string, recursive: boolean): Promise<void> => {
  await awaitCliCleanup();
  return invoke<void>("storage_delete", { path, recursive });
};

export const storageRename = async (oldPath: string, newPath: string): Promise<void> => {
  await awaitCliCleanup();
  return invoke<void>("storage_rename", { old_path: oldPath, new_path: newPath });
};

export const storageInfo = async (path: string): Promise<StorageInfo> => {
  await awaitCliCleanup();
  return invoke<StorageInfo>("storage_info", { path });
};

export const storageTimestamp = async (path: string): Promise<number> => {
  await awaitCliCleanup();
  return invoke<number>("storage_timestamp", { path });
};

export const storageTarExtract = async (tarPath: string, outPath: string): Promise<void> => {
  await awaitCliCleanup();
  return invoke<void>("storage_tar_extract", { tar_path: tarPath, out_path: outPath });
};

/** Cancel an in-progress file transfer (upload or download). */
export const cancelTransfer = (): Promise<void> =>
  invoke<void>("cancel_transfer");

// ── Device extended commands ──────────────────────────────────────────────

export const powerInfo = (): Promise<Record<string, string>> =>
  invoke<Record<string, string>>("power_info");

export const reboot = (mode: number): Promise<void> =>
  invoke<void>("reboot", { mode });

// ── Screen streaming commands ───────────────────────────────────────────

/** Start streaming the Flipper's screen. Emits "screen-frame" events with base64 RGBA data. */
export const screenStreamStart = (): Promise<void> =>
  invoke<void>("screen_stream_start");

/** Stop streaming the Flipper's screen. */
export const screenStreamStop = (): Promise<void> =>
  invoke<void>("screen_stream_stop");

/**
 * Send a button input event to the Flipper.
 * key: 0=UP 1=DOWN 2=RIGHT 3=LEFT 4=OK 5=BACK
 * inputType: 0=PRESS 1=RELEASE 2=SHORT 3=LONG 4=REPEAT
 */
export const sendInputEvent = (key: number, inputType: number): Promise<void> =>
  invoke<void>("send_input_event", { key, input_type: inputType });

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

// ── Diagnostics ─────────────────────────────────────────────────────────

export interface DiagEntry {
  ts_ms: number;
  dir: "Tx" | "Rx";
  command_id: number;
  command_status: number;
  has_next: boolean;
  content_kind: string;
  payload_bytes: number;
}

export const diagEnable = (on: boolean): Promise<void> =>
  invoke<void>("diag_enable", { on });

export const diagEntries = (): Promise<DiagEntry[]> =>
  invoke<DiagEntry[]>("diag_entries");

export const diagClear = (): Promise<void> =>
  invoke<void>("diag_clear");

export const diagIsEnabled = (): Promise<boolean> =>
  invoke<boolean>("diag_is_enabled");

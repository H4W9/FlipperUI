/**
 * Typed wrappers over Tauri v2's invoke API.
 * IMPORTANT: In Tauri v2, invoke is imported from "@tauri-apps/api/core", not "@tauri-apps/api/tauri".
 */
import { invoke } from "@tauri-apps/api/core";
import type { DeviceInfo, FileEntry, PortInfo, StorageInfo } from "../types/flipper";
import type { SubGhzEntry } from "../types/subghz";
import type { IrEntry } from "../types/infrared";
import type { NfcEntry } from "../types/nfc";
import type { AppEntry } from "../types/apps";
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

// ── BLE device commands ────────────────────────────────────────────────────

export interface BleDevice {
  id: string;
  name: string;
  rssi: number | null;
  paired: boolean;
}

/** Discover Flipper devices over BLE. Runs a ~1.8s scan. */
export const listBleDevices = (): Promise<BleDevice[]> =>
  invoke<BleDevice[]>("list_ble_devices");

/** Connect to a Flipper over BLE using an id from {@link listBleDevices}. */
export const connectBleDevice = (id: string, name?: string): Promise<DeviceInfo> =>
  invoke<DeviceInfo>("connect_ble_device", { id, name: name ?? null });

/** Which transport backs the active connection — `null` when disconnected. */
export const connectionKind = (): Promise<"serial" | "ble" | null> =>
  invoke<"serial" | "ble" | null>("connection_kind");

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

/** Full key/value map from RPC system.device_info — much richer than DeviceInfo. */
export const deviceInfoAll = (): Promise<Record<string, string>> =>
  invoke<Record<string, string>>("device_info_all");

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

// ── App control (launch/exit Flipper apps) ──────────────────────────────

/** Launch a Flipper app by name with optional CLI-style args. */
export const appStart = async (name: string, args: string): Promise<void> => {
  await awaitCliCleanup();
  return invoke<void>("app_start", { name, args });
};

/** Exit the currently running Flipper app. */
export const appExit = async (): Promise<void> => {
  await awaitCliCleanup();
  return invoke<void>("app_exit");
};

/**
 * Begin Sub-GHz replay via the full RPC flow (Start → LoadFile → ButtonPress).
 * TX continues until {@link subghzTxStop} is called. Mirrors the iOS app.
 */
export const subghzTxStart = async (path: string): Promise<void> => {
  await awaitCliCleanup();
  return invoke<void>("subghz_tx_start", { path });
};

/** Stop an in-progress Sub-GHz replay (ButtonRelease + AppExit). */
export const subghzTxStop = async (): Promise<void> => {
  await awaitCliCleanup();
  return invoke<void>("subghz_tx_stop");
};

// ── Sub-GHz library ──────────────────────────────────────────────────────

/**
 * Scan a directory recursively for .sub files, parse their headers, and
 * return the list. Emits "subghz-scan-progress" events as it works.
 *
 * `cached` — optional list of previously-parsed entries (from the on-disk
 * cache). When supplied, files whose mtime hasn't changed are reused from
 * cache instead of being re-read over serial.
 */
export const subghzScan = async (
  root: string,
  excludedDirs: string[],
  cached?: SubGhzEntry[],
): Promise<SubGhzEntry[]> => {
  await awaitCliCleanup();
  return invoke<SubGhzEntry[]>("subghz_scan", {
    root,
    excluded_dirs: excludedDirs,
    cached: cached ?? null,
  });
};

/** Abort an in-progress SubGhz library scan. */
export const subghzCancelScan = (): Promise<void> =>
  invoke<void>("subghz_cancel_scan");

// ── Infrared library ────────────────────────────────────────────────────

/**
 * Scan a directory recursively for .ir files, parse their signal blocks,
 * and return the list. Emits "infrared-scan-progress" events as it works.
 */
export const infraredScan = async (
  root: string,
  excludedDirs: string[],
  cached?: IrEntry[],
): Promise<IrEntry[]> => {
  await awaitCliCleanup();
  return invoke<IrEntry[]>("infrared_scan", {
    root,
    excluded_dirs: excludedDirs,
    cached: cached ?? null,
  });
};

/** Abort an in-progress Infrared library scan. */
export const infraredCancelScan = (): Promise<void> =>
  invoke<void>("infrared_cancel_scan");

// ── NFC library ─────────────────────────────────────────────────────────

/**
 * Scan a directory recursively for `.nfc` files, parse their headers, and
 * return the list. Emits "nfc-scan-progress" events as it works.
 */
export const nfcScan = async (
  root: string,
  excludedDirs: string[],
  cached?: NfcEntry[],
): Promise<NfcEntry[]> => {
  await awaitCliCleanup();
  return invoke<NfcEntry[]>("nfc_scan", {
    root,
    excluded_dirs: excludedDirs,
    cached: cached ?? null,
  });
};

/** Abort an in-progress NFC library scan. */
export const nfcCancelScan = (): Promise<void> =>
  invoke<void>("nfc_cancel_scan");

// ── Apps library ────────────────────────────────────────────────────────

/**
 * Scan one or more roots recursively for `.fap` files and return a parsed
 * list. Emits "apps-scan-progress" events as it works.
 *
 * Pass previously-parsed entries as `cached` to skip re-reading files whose
 * mtime hasn't moved.
 */
export const appsScan = async (
  roots: string[],
  excludedDirs: string[],
  cached?: AppEntry[],
): Promise<AppEntry[]> => {
  await awaitCliCleanup();
  return invoke<AppEntry[]>("apps_scan", {
    roots,
    excluded_dirs: excludedDirs,
    cached: cached ?? null,
  });
};

/** Abort an in-progress App library scan. */
export const appsCancelScan = (): Promise<void> =>
  invoke<void>("apps_cancel_scan");

/**
 * Read a .fap and extract its embedded 10x10 icon. Returns base64-encoded
 * raw XBM bytes (32-byte slot; first 20 bytes are the bitmap), or null if
 * the file has no embedded icon.
 */
export const appsReadIcon = async (path: string): Promise<string | null> => {
  await awaitCliCleanup();
  return invoke<string | null>("apps_read_icon", { path });
};

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

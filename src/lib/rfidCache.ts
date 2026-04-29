/**
 * On-disk cache for the RFID library scan, keyed by device UID.
 * Mirrors `nfcCache.ts`.
 */
import { LazyStore } from "@tauri-apps/plugin-store";
import type { RfidEntry } from "../types/rfid";

const STORE_FILE = "rfid-cache.json";

interface DeviceCache {
  scannedAt: number;
  entries: RfidEntry[];
}

type CacheMap = Record<string, DeviceCache>;

const store = new LazyStore(STORE_FILE, {
  defaults: {},
  autoSave: true,
});

const ROOT_KEY = "cache";

async function readAll(): Promise<CacheMap> {
  return (await store.get<CacheMap>(ROOT_KEY)) ?? {};
}

export async function loadRfidCache(uid: string): Promise<DeviceCache | null> {
  const all = await readAll();
  return all[uid] ?? null;
}

export async function saveRfidCache(
  uid: string,
  entries: RfidEntry[],
): Promise<void> {
  const all = await readAll();
  all[uid] = { scannedAt: Date.now(), entries };
  await store.set(ROOT_KEY, all);
}

export async function clearRfidCache(uid?: string): Promise<void> {
  if (!uid) {
    await store.set(ROOT_KEY, {});
    return;
  }
  const all = await readAll();
  delete all[uid];
  await store.set(ROOT_KEY, all);
}

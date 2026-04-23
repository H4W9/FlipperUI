/**
 * On-disk cache for the BadUSB library scan, keyed by device UID.
 * Mirrors `nfcCache.ts`.
 */
import { LazyStore } from "@tauri-apps/plugin-store";
import type { BadUsbEntry } from "../types/badusb";

const STORE_FILE = "badusb-cache.json";

interface DeviceCache {
  scannedAt: number;
  entries: BadUsbEntry[];
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

export async function loadBadUsbCache(uid: string): Promise<DeviceCache | null> {
  const all = await readAll();
  return all[uid] ?? null;
}

export async function saveBadUsbCache(
  uid: string,
  entries: BadUsbEntry[],
): Promise<void> {
  const all = await readAll();
  all[uid] = { scannedAt: Date.now(), entries };
  await store.set(ROOT_KEY, all);
}

export async function clearBadUsbCache(uid?: string): Promise<void> {
  if (!uid) {
    await store.set(ROOT_KEY, {});
    return;
  }
  const all = await readAll();
  delete all[uid];
  await store.set(ROOT_KEY, all);
}

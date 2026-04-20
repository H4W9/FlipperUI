/**
 * On-disk cache for the NFC library scan, keyed by device UID.
 * Mirrors `infraredCache.ts`.
 */
import { LazyStore } from "@tauri-apps/plugin-store";
import type { NfcEntry } from "../types/nfc";

const STORE_FILE = "nfc-cache.json";

interface DeviceCache {
  scannedAt: number;
  entries: NfcEntry[];
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

export async function loadNfcCache(uid: string): Promise<DeviceCache | null> {
  const all = await readAll();
  return all[uid] ?? null;
}

export async function saveNfcCache(
  uid: string,
  entries: NfcEntry[],
): Promise<void> {
  const all = await readAll();
  all[uid] = { scannedAt: Date.now(), entries };
  await store.set(ROOT_KEY, all);
}

export async function clearNfcCache(uid?: string): Promise<void> {
  if (!uid) {
    await store.set(ROOT_KEY, {});
    return;
  }
  const all = await readAll();
  delete all[uid];
  await store.set(ROOT_KEY, all);
}

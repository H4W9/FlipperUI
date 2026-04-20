/**
 * On-disk cache for the Infrared library scan, keyed by device UID.
 * Mirrors `subghzCache.ts` — see that file for the rationale.
 */
import { LazyStore } from "@tauri-apps/plugin-store";
import type { IrEntry } from "../types/infrared";

const STORE_FILE = "infrared-cache.json";

interface DeviceCache {
  scannedAt: number;
  entries: IrEntry[];
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

export async function loadInfraredCache(uid: string): Promise<DeviceCache | null> {
  const all = await readAll();
  return all[uid] ?? null;
}

export async function saveInfraredCache(
  uid: string,
  entries: IrEntry[],
): Promise<void> {
  const all = await readAll();
  all[uid] = { scannedAt: Date.now(), entries };
  await store.set(ROOT_KEY, all);
}

export async function clearInfraredCache(uid?: string): Promise<void> {
  if (!uid) {
    await store.set(ROOT_KEY, {});
    return;
  }
  const all = await readAll();
  delete all[uid];
  await store.set(ROOT_KEY, all);
}

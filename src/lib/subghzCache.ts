/**
 * On-disk cache for the Sub-GHz library scan, keyed by device UID.
 *
 * Backed by tauri-plugin-store at `subghz-cache.json`. Each device's cache
 * holds the full list of parsed .sub entries (with mtime) from the last
 * successful scan. The library view loads the cache on mount for instant
 * render, and passes cached entries into the Rust scan so only files whose
 * mtime has moved get re-read over serial.
 *
 * The cache is intentionally *not* mirrored in-memory the way `settings.ts`
 * is — reads/writes are rare (view mount + scan completion) and we want the
 * disk to be the source of truth across reloads.
 */
import { LazyStore } from "@tauri-apps/plugin-store";
import type { SubGhzEntry } from "../types/subghz";

const STORE_FILE = "subghz-cache.json";

interface DeviceCache {
  scannedAt: number;
  entries: SubGhzEntry[];
  /** Starred entry paths. Survives re-scans. */
  favorites?: string[];
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

/** Load the cached scan for a device UID, or `null` if never scanned. */
export async function loadSubghzCache(uid: string): Promise<DeviceCache | null> {
  const all = await readAll();
  return all[uid] ?? null;
}

/** Persist scan results for the given device UID. Preserves favorites. */
export async function saveSubghzCache(
  uid: string,
  entries: SubGhzEntry[],
): Promise<void> {
  const all = await readAll();
  const prev = all[uid];
  all[uid] = {
    scannedAt: Date.now(),
    entries,
    favorites: prev?.favorites ?? [],
  };
  await store.set(ROOT_KEY, all);
}

/** Persist favorites for the given device UID. Preserves entries/scannedAt. */
export async function saveSubghzFavorites(
  uid: string,
  favorites: string[],
): Promise<void> {
  const all = await readAll();
  const prev = all[uid];
  all[uid] = {
    scannedAt: prev?.scannedAt ?? 0,
    entries: prev?.entries ?? [],
    favorites,
  };
  await store.set(ROOT_KEY, all);
}

/** Drop the cache entry for a specific UID (or all if omitted). */
export async function clearSubghzCache(uid?: string): Promise<void> {
  if (!uid) {
    await store.set(ROOT_KEY, {});
    return;
  }
  const all = await readAll();
  delete all[uid];
  await store.set(ROOT_KEY, all);
}

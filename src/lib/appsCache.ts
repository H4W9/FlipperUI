import { LazyStore } from "@tauri-apps/plugin-store";
import type { AppEntry, AppIconEntry } from "../types/apps";

const STORE_FILE = "apps-cache.json";

export interface DeviceCache {
  scannedAt: number;
  entries: AppEntry[];
  /** Icons keyed by .fap path. Separate from entries so re-scans don't wipe them. */
  icons: Record<string, AppIconEntry>;
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

export async function loadAppsCache(uid: string): Promise<DeviceCache | null> {
  const all = await readAll();
  const raw = all[uid];
  if (!raw) return null;
  // Back-compat: older caches lack the icons field.
  return { scannedAt: raw.scannedAt, entries: raw.entries, icons: raw.icons ?? {} };
}

export async function saveAppsCache(
  uid: string,
  entries: AppEntry[],
  icons?: Record<string, AppIconEntry>,
): Promise<void> {
  const all = await readAll();
  const existing = all[uid];
  all[uid] = {
    scannedAt: Date.now(),
    entries,
    icons: icons ?? existing?.icons ?? {},
  };
  await store.set(ROOT_KEY, all);
}

export async function saveAppIcons(
  uid: string,
  icons: Record<string, AppIconEntry>,
): Promise<void> {
  const all = await readAll();
  const existing = all[uid];
  if (!existing) return; // No entries yet — nothing to attach icons to.
  all[uid] = { ...existing, icons };
  await store.set(ROOT_KEY, all);
}

export async function clearAppsCache(uid?: string): Promise<void> {
  if (!uid) {
    await store.set(ROOT_KEY, {});
    return;
  }
  const all = await readAll();
  delete all[uid];
  await store.set(ROOT_KEY, all);
}

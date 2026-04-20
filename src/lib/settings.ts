/**
 * Persisted application settings, backed by tauri-plugin-store.
 *
 * Settings live in a single key ("app") inside settings.json under the
 * platform's app-config dir (managed by the plugin). Reads are cached; writes
 * fan out to in-memory subscribers so React components can re-render without
 * re-hitting the store.
 */
import { LazyStore } from "@tauri-apps/plugin-store";

export interface AppSettings {
  /** ISO 639-1 code. Currently a stub — i18n strings aren't wired yet. */
  language: string;
  subghz: {
    /** Absolute Flipper paths excluded from the SubGhz library scan. */
    excludedDirs: string[];
  };
  infrared: {
    /** Absolute Flipper paths excluded from the Infrared library scan. */
    excludedDirs: string[];
  };
  nfc: {
    /** Absolute Flipper paths excluded from the NFC library scan. */
    excludedDirs: string[];
  };
  apps: {
    /** Absolute Flipper paths excluded from the App library scan. */
    excludedDirs: string[];
    /** Additional absolute Flipper paths scanned beyond the default /ext/apps. */
    extraDirs: string[];
  };
}

export const DEFAULT_SETTINGS: AppSettings = {
  language: "en",
  subghz: { excludedDirs: [] },
  infrared: { excludedDirs: [] },
  nfc: { excludedDirs: [] },
  apps: { excludedDirs: [], extraDirs: [] },
};

export type SettingsPatch = {
  language?: string;
  subghz?: {
    excludedDirs?: string[];
  };
  infrared?: {
    excludedDirs?: string[];
  };
  nfc?: {
    excludedDirs?: string[];
  };
  apps?: {
    excludedDirs?: string[];
    extraDirs?: string[];
  };
};

const STORE_FILE = "settings.json";
const STORE_KEY = "app";

const store = new LazyStore(STORE_FILE, {
  defaults: { [STORE_KEY]: DEFAULT_SETTINGS as unknown as Record<string, unknown> },
  autoSave: true,
});

let cached: AppSettings | null = null;
const listeners = new Set<(s: AppSettings) => void>();

export async function loadSettings(): Promise<AppSettings> {
  if (cached) return cached;
  const raw = await store.get<Partial<AppSettings>>(STORE_KEY);
  cached = mergeWithDefaults(raw ?? {});
  return cached;
}

export async function updateSettings(patch: SettingsPatch): Promise<AppSettings> {
  const current = await loadSettings();
  const next: AppSettings = {
    language: patch.language ?? current.language,
    subghz: {
      excludedDirs: patch.subghz?.excludedDirs ?? current.subghz.excludedDirs,
    },
    infrared: {
      excludedDirs: patch.infrared?.excludedDirs ?? current.infrared.excludedDirs,
    },
    nfc: {
      excludedDirs: patch.nfc?.excludedDirs ?? current.nfc.excludedDirs,
    },
    apps: {
      excludedDirs: patch.apps?.excludedDirs ?? current.apps.excludedDirs,
      extraDirs: patch.apps?.extraDirs ?? current.apps.extraDirs,
    },
  };
  await store.set(STORE_KEY, next);
  cached = next;
  listeners.forEach((cb) => cb(next));
  return next;
}

export function subscribeSettings(cb: (s: AppSettings) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function mergeWithDefaults(raw: Partial<AppSettings>): AppSettings {
  return {
    language: raw.language ?? DEFAULT_SETTINGS.language,
    subghz: {
      excludedDirs:
        raw.subghz?.excludedDirs ?? DEFAULT_SETTINGS.subghz.excludedDirs,
    },
    infrared: {
      excludedDirs:
        raw.infrared?.excludedDirs ?? DEFAULT_SETTINGS.infrared.excludedDirs,
    },
    nfc: {
      excludedDirs:
        raw.nfc?.excludedDirs ?? DEFAULT_SETTINGS.nfc.excludedDirs,
    },
    apps: {
      excludedDirs:
        raw.apps?.excludedDirs ?? DEFAULT_SETTINGS.apps.excludedDirs,
      extraDirs: raw.apps?.extraDirs ?? DEFAULT_SETTINGS.apps.extraDirs,
    },
  };
}

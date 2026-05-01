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
  rfid: {
    /** Absolute Flipper paths excluded from the 125 kHz RFID library scan. */
    excludedDirs: string[];
  };
  badusb: {
    /** Absolute Flipper paths excluded from the BadUSB library scan. */
    excludedDirs: string[];
  };
  apps: {
    /** Absolute Flipper paths excluded from the App library scan. */
    excludedDirs: string[];
    /** Additional absolute Flipper paths scanned beyond the default /ext/apps. */
    extraDirs: string[];
  };
  tray: {
    /** When true, show the system-tray / menubar icon. */
    enabled: boolean;
    /** macOS only: when true and tray is enabled, hide the app from the Dock. */
    hideDockIcon: boolean;
    /** When true, render the tray icon as a flat monochrome glyph that adopts
     * the menubar's foreground color (template image on macOS). */
    monochromeIcon: boolean;
  };
  notifications: {
    /** Master switch for OS notifications (library scans, transfers,
     * disconnects). When false, no notifications are shown. */
    enabled: boolean;
  };
  connection: {
    /** Last-used transport. Restored on app launch. */
    transport: "usb" | "ble";
    /** Last-used USB serial port path. Restored on app launch when present. */
    lastPort: string | null;
    /** Last-connected BLE peripheral id. Used as the auto-reconnect target. */
    lastBleId: string | null;
    /** Display name for the last-connected BLE peripheral. */
    lastBleName: string | null;
  };
}

export const DEFAULT_SETTINGS: AppSettings = {
  language: "en",
  subghz: { excludedDirs: [] },
  infrared: { excludedDirs: [] },
  nfc: { excludedDirs: [] },
  rfid: { excludedDirs: [] },
  badusb: { excludedDirs: [] },
  apps: { excludedDirs: [], extraDirs: [] },
  tray: { enabled: true, hideDockIcon: false, monochromeIcon: false },
  notifications: { enabled: true },
  connection: { transport: "usb", lastPort: null, lastBleId: null, lastBleName: null },
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
  rfid?: {
    excludedDirs?: string[];
  };
  badusb?: {
    excludedDirs?: string[];
  };
  apps?: {
    excludedDirs?: string[];
    extraDirs?: string[];
  };
  tray?: {
    enabled?: boolean;
    hideDockIcon?: boolean;
    monochromeIcon?: boolean;
  };
  notifications?: {
    enabled?: boolean;
  };
  connection?: {
    transport?: "usb" | "ble";
    lastPort?: string | null;
    lastBleId?: string | null;
    lastBleName?: string | null;
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
    rfid: {
      excludedDirs: patch.rfid?.excludedDirs ?? current.rfid.excludedDirs,
    },
    badusb: {
      excludedDirs: patch.badusb?.excludedDirs ?? current.badusb.excludedDirs,
    },
    apps: {
      excludedDirs: patch.apps?.excludedDirs ?? current.apps.excludedDirs,
      extraDirs: patch.apps?.extraDirs ?? current.apps.extraDirs,
    },
    tray: {
      enabled: patch.tray?.enabled ?? current.tray.enabled,
      hideDockIcon: patch.tray?.hideDockIcon ?? current.tray.hideDockIcon,
      monochromeIcon:
        patch.tray?.monochromeIcon ?? current.tray.monochromeIcon,
    },
    notifications: {
      enabled:
        patch.notifications?.enabled ?? current.notifications.enabled,
    },
    connection: {
      transport: patch.connection?.transport ?? current.connection.transport,
      lastPort:
        patch.connection?.lastPort !== undefined
          ? patch.connection.lastPort
          : current.connection.lastPort,
      lastBleId:
        patch.connection?.lastBleId !== undefined
          ? patch.connection.lastBleId
          : current.connection.lastBleId,
      lastBleName:
        patch.connection?.lastBleName !== undefined
          ? patch.connection.lastBleName
          : current.connection.lastBleName,
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
    rfid: {
      excludedDirs:
        raw.rfid?.excludedDirs ?? DEFAULT_SETTINGS.rfid.excludedDirs,
    },
    badusb: {
      excludedDirs:
        raw.badusb?.excludedDirs ?? DEFAULT_SETTINGS.badusb.excludedDirs,
    },
    apps: {
      excludedDirs:
        raw.apps?.excludedDirs ?? DEFAULT_SETTINGS.apps.excludedDirs,
      extraDirs: raw.apps?.extraDirs ?? DEFAULT_SETTINGS.apps.extraDirs,
    },
    tray: {
      enabled: raw.tray?.enabled ?? DEFAULT_SETTINGS.tray.enabled,
      hideDockIcon:
        raw.tray?.hideDockIcon ?? DEFAULT_SETTINGS.tray.hideDockIcon,
      monochromeIcon:
        raw.tray?.monochromeIcon ?? DEFAULT_SETTINGS.tray.monochromeIcon,
    },
    notifications: {
      enabled:
        raw.notifications?.enabled ?? DEFAULT_SETTINGS.notifications.enabled,
    },
    connection: {
      transport:
        raw.connection?.transport ?? DEFAULT_SETTINGS.connection.transport,
      lastPort:
        raw.connection?.lastPort ?? DEFAULT_SETTINGS.connection.lastPort,
      lastBleId:
        raw.connection?.lastBleId ?? DEFAULT_SETTINGS.connection.lastBleId,
      lastBleName:
        raw.connection?.lastBleName ?? DEFAULT_SETTINGS.connection.lastBleName,
    },
  };
}

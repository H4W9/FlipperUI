/**
 * Thin wrapper around tauri-plugin-notification.
 *
 * Each notification belongs to a category; categories the user has disabled
 * in Settings are dropped silently. Categories not surfaced in Settings
 * (currently `"transfer"`) are always allowed subject to OS permission.
 * Permission is requested lazily on first use and cached for the rest of the
 * process. All sends are best-effort — failures (e.g. user denied permission,
 * plugin missing on a non-desktop platform) silently no-op so call sites
 * don't have to wrap every notify in try/catch.
 */
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  subscribeSettings,
  type AppSettings,
} from "./settings";

export type NotificationCategory =
  | "libraryScan"
  | "deviceDisconnected"
  | "transfer";

let settings: AppSettings = DEFAULT_SETTINGS;
let permissionState: "unknown" | "granted" | "denied" = "unknown";

loadSettings()
  .then((s) => {
    settings = s;
  })
  .catch(() => {});
subscribeSettings((s) => {
  settings = s;
});

function categoryAllowed(category: NotificationCategory): boolean {
  switch (category) {
    case "libraryScan":
      return settings.notifications.libraryScansFinished;
    case "deviceDisconnected":
      return settings.notifications.deviceDisconnected;
    case "transfer":
      // No user-facing toggle for transfer notifications — they ride only
      // on the OS-level permission check below.
      return true;
  }
}

async function ensurePermission(): Promise<boolean> {
  if (permissionState === "granted") return true;
  if (permissionState === "denied") return false;
  try {
    const granted = await isPermissionGranted();
    if (granted) {
      permissionState = "granted";
      return true;
    }
    const result = await requestPermission();
    permissionState = result === "granted" ? "granted" : "denied";
    return permissionState === "granted";
  } catch {
    permissionState = "denied";
    return false;
  }
}

export async function notify(
  category: NotificationCategory,
  title: string,
  body?: string,
): Promise<void> {
  if (!categoryAllowed(category)) return;
  if (!(await ensurePermission())) return;
  try {
    sendNotification({ title, body });
  } catch {
    /* best-effort */
  }
}

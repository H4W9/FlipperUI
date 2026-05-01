/**
 * Thin wrapper around tauri-plugin-notification.
 *
 * Gates every send on the persisted `notifications.enabled` setting and the
 * OS-level permission. Permission is requested lazily on first use and cached
 * for the rest of the process. All sends are best-effort — failures (e.g. user
 * denied permission, plugin missing on a non-desktop platform) silently no-op
 * so call sites don't have to wrap every notify in try/catch.
 */
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { loadSettings, subscribeSettings } from "./settings";

let enabled = true;
let permissionState: "unknown" | "granted" | "denied" = "unknown";

loadSettings()
  .then((s) => {
    enabled = s.notifications.enabled;
  })
  .catch(() => {});
subscribeSettings((s) => {
  enabled = s.notifications.enabled;
});

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

export async function notify(title: string, body?: string): Promise<void> {
  if (!enabled) return;
  if (!(await ensurePermission())) return;
  try {
    sendNotification({ title, body });
  } catch {
    /* best-effort */
  }
}

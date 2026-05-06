import { DEFAULT_SETTINGS, loadSettings } from "./settings";
import { syncClock } from "./tauri";

export async function syncClockOnConnectIfEnabled(): Promise<boolean> {
  const settings = await loadSettings().catch(() => DEFAULT_SETTINGS);
  if (!settings.connection.syncClockOnConnect) return false;
  await syncClock();
  return true;
}

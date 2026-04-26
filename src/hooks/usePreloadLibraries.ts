import { useEffect } from "react";
import { useFlipperStore } from "../store/useFlipperStore";
import { loadSubghzCache } from "../lib/subghzCache";
import { loadInfraredCache } from "../lib/infraredCache";
import { loadNfcCache } from "../lib/nfcCache";
import { loadBadUsbCache } from "../lib/badusbCache";
import { loadAppsCache } from "../lib/appsCache";

/**
 * Hydrate the five library entry lists from their per-device on-disk caches
 * the moment a device connects. Without this, the Dashboard's library counts
 * read 0 until the user actually navigates to each library view (which is
 * what triggers cache load for that library).
 *
 * Each library view runs its own cache-load effect on `deviceUid` change —
 * those effects overwrite with the same data, so this preload is purely
 * additive and safe.
 */
export function usePreloadLibraries(): void {
  const deviceUid = useFlipperStore((s) => s.deviceInfo?.hardware_uid ?? null);
  const setSubghz = useFlipperStore((s) => s.setSubghzEntries);
  const setIr = useFlipperStore((s) => s.setIrEntries);
  const setNfc = useFlipperStore((s) => s.setNfcEntries);
  const setBadUsb = useFlipperStore((s) => s.setBadUsbEntries);
  const setApps = useFlipperStore((s) => s.setAppEntries);

  useEffect(() => {
    if (!deviceUid) return;
    let cancelled = false;
    Promise.all([
      loadSubghzCache(deviceUid).catch(() => null),
      loadInfraredCache(deviceUid).catch(() => null),
      loadNfcCache(deviceUid).catch(() => null),
      loadBadUsbCache(deviceUid).catch(() => null),
      loadAppsCache(deviceUid).catch(() => null),
    ]).then(([subghz, ir, nfc, badusb, apps]) => {
      if (cancelled) return;
      if (subghz) setSubghz(subghz.entries);
      if (ir) setIr(ir.entries);
      if (nfc) setNfc(nfc.entries);
      if (badusb) setBadUsb(badusb.entries);
      if (apps) setApps(apps.entries);
    });
    return () => {
      cancelled = true;
    };
  }, [deviceUid, setSubghz, setIr, setNfc, setBadUsb, setApps]);
}

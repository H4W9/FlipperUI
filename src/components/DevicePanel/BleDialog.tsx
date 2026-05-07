import { useEffect, useRef, useState } from "react";
import { Bluetooth, Signal, RefreshCw } from "lucide-react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  startBleScan,
  stopBleScan,
  connectBleDevice,
  type BleDevice,
} from "../../lib/tauri";
import { Spinner } from "../ui/Spinner";
import { useFlipperStore } from "../../store/useFlipperStore";
import { updateSettings } from "../../lib/settings";
import { syncClockOnConnectIfEnabled } from "../../lib/clockSync";

interface BleDialogProps {
  onClose: () => void;
}

function rssiBars(rssi: number | null): string {
  if (rssi == null) return "—";
  if (rssi >= -55) return "●●●●";
  if (rssi >= -65) return "●●●○";
  if (rssi >= -75) return "●●○○";
  if (rssi >= -85) return "●○○○";
  return "○○○○";
}

function sortDevices(list: BleDevice[]): BleDevice[] {
  return [...list].sort((a, b) => {
    if (a.paired !== b.paired) return a.paired ? -1 : 1;
    return (b.rssi ?? -999) - (a.rssi ?? -999);
  });
}

export function BleDialog({ onClose }: BleDialogProps) {
  const [devices, setDevices] = useState<BleDevice[]>([]);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);

  const setConnecting = useFlipperStore((s) => s.setConnecting);
  const setConnected = useFlipperStore((s) => s.setConnected);
  const setStoreError = useFlipperStore((s) => s.setError);

  // Holds the most recent map of devices keyed by id, so the listener can
  // merge updates without depending on a setState closure (which would race
  // when many ble-scan-device events fire in quick succession).
  const devicesRef = useRef<Map<string, BleDevice>>(new Map());

  const start = async () => {
    setError(null);
    setScanning(true);
    try {
      await startBleScan();
    } catch (e) {
      setError(String(e));
      setScanning(false);
    }
  };

  const stop = async () => {
    try {
      await stopBleScan();
    } catch {
      // Ignore — backend will emit ble-scan-stopped regardless
    }
  };

  const reset = () => {
    devicesRef.current = new Map();
    setDevices([]);
  };

  // Subscribe to live discovery events, kick off the scan, and tear everything down on unmount.
  useEffect(() => {
    let unlistenDevice: UnlistenFn | null = null;
    let unlistenStopped: UnlistenFn | null = null;
    let cancelled = false;

    (async () => {
      const u1 = await listen<BleDevice>("ble-scan-device", (e) => {
        const d = e.payload;
        const map = devicesRef.current;
        const existing = map.get(d.id);
        // Merge so a stale "no RSSI" update doesn't blow away a fresh value.
        const merged: BleDevice = existing
          ? {
              ...existing,
              ...d,
              rssi: d.rssi ?? existing.rssi,
              paired: existing.paired || d.paired,
            }
          : d;
        map.set(d.id, merged);
        setDevices(sortDevices(Array.from(map.values())));
      });
      if (cancelled) { u1(); return; }
      unlistenDevice = u1;

      const u2 = await listen("ble-scan-stopped", () => {
        setScanning(false);
      });
      if (cancelled) { u2(); return; }
      unlistenStopped = u2;

      if (!cancelled) await start();
    })();

    return () => {
      cancelled = true;
      unlistenDevice?.();
      unlistenStopped?.();
      // Best-effort: stop the backend scan when the dialog closes.
      void stopBleScan().catch(() => {});
    };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleConnect = async (device: BleDevice) => {
    // Connecting needs exclusive use of the BLE adapter — pause discovery.
    await stop();
    setConnectingId(device.id);
    setConnecting(true);
    setStoreError(null);
    try {
      const info = await connectBleDevice(device.id, device.name);
      let clockError: string | null = null;
      try {
        await syncClockOnConnectIfEnabled();
      } catch (e) {
        clockError = `Clock sync failed: ${e instanceof Error ? e.message : String(e)}`;
      }
      setConnected(info, "ble");
      if (clockError) setStoreError(clockError);
      void updateSettings({
        connection: { lastBleId: device.id, lastBleName: device.name },
      }).catch(() => {});
      onClose();
    } catch (e) {
      const msg = String(e);
      setError(msg);
      setStoreError(msg);
      setConnecting(false);
      setConnectingId(null);
    }
  };

  const handleRescan = async () => {
    await stop();
    reset();
    await start();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-panel border border-border-subtle rounded-lg shadow-2xl p-5 max-w-md w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-primary flex items-center gap-2">
            <Bluetooth size={14} className="text-accent" />
            Connect via BLE
          </h3>
          {scanning ? (
            <span
              className="flex items-center gap-1.5 text-xs text-secondary px-2 py-1"
              role="status"
              aria-live="polite"
            >
              <Spinner size={12} />
              <span>Scanning…</span>
            </span>
          ) : (
            <button
              onClick={handleRescan}
              disabled={connectingId !== null}
              className="flex items-center gap-1.5 text-xs text-secondary hover:text-primary disabled:opacity-40 px-2 py-1 rounded transition-colors"
              title="Rescan"
            >
              <RefreshCw size={12} />
              <span>Rescan</span>
            </button>
          )}
        </div>

        <p className="text-xs text-secondary mb-3">
          Pair the Flipper in your OS Bluetooth settings first. BLE supports
          files, screen, and apps — but not CLI. Devices appear as they're
          discovered; the scan runs until you connect or close the dialog.
        </p>

        {error && (
          <div className="text-xs text-danger bg-danger/10 border border-danger/30 rounded px-2 py-1.5 mb-3">
            {error}
          </div>
        )}

        <div className="max-h-64 overflow-y-auto rounded border border-border-subtle divide-y divide-border-subtle">
          {scanning && devices.length === 0 && (
            <div className="flex items-center gap-2 p-3 text-xs text-secondary">
              <Spinner size={13} />
              Looking for Flippers…
            </div>
          )}
          {!scanning && devices.length === 0 && !error && (
            <div className="p-3 text-xs text-muted">
              No Flipper devices found. Make sure Bluetooth is enabled on the
              Flipper (Settings → Bluetooth) and that it has been paired in
              macOS Bluetooth settings.
            </div>
          )}
          {devices.map((d) => {
            const busy = connectingId === d.id;
            return (
              <button
                key={d.id}
                onClick={() => handleConnect(d)}
                disabled={connectingId !== null}
                className="w-full flex items-center gap-3 p-2.5 text-left hover:bg-elevated disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Bluetooth
                  size={14}
                  className={d.paired ? "text-success" : "text-muted"}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-primary truncate">{d.name}</div>
                  <div className="text-[11px] text-muted truncate">
                    {d.paired ? "paired" : "not paired"} · {d.id}
                  </div>
                </div>
                <span
                  className="flex items-center gap-1 text-xs text-secondary tabular-nums"
                  title={d.rssi != null ? `RSSI ${d.rssi} dBm` : "no RSSI"}
                >
                  <Signal size={12} />
                  {rssiBars(d.rssi)}
                </span>
                {busy && <Spinner size={13} />}
              </button>
            );
          })}
        </div>

        <div className="flex justify-end mt-4">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded bg-surface text-secondary hover:text-primary hover:bg-elevated transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

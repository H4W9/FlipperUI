import { useEffect, useState } from "react";
import { Bluetooth, RefreshCw, Signal } from "lucide-react";
import { listBleDevices, connectBleDevice, type BleDevice } from "../../lib/tauri";
import { Spinner } from "../ui/Spinner";
import { useFlipperStore } from "../../store/useFlipperStore";

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

export function BleDialog({ onClose }: BleDialogProps) {
  const [devices, setDevices] = useState<BleDevice[]>([]);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);

  const { setConnecting, setConnected, setError: setStoreError } = useFlipperStore();

  const scan = async () => {
    setScanning(true);
    setError(null);
    try {
      const result = await listBleDevices();
      // Sort: paired first, then by RSSI (strongest signal first).
      result.sort((a, b) => {
        if (a.paired !== b.paired) return a.paired ? -1 : 1;
        return (b.rssi ?? -999) - (a.rssi ?? -999);
      });
      setDevices(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setScanning(false);
    }
  };

  // Scan exactly once on mount. `onClose` is an inline arrow in the parent, so
  // depending on it here would re-run this effect (and re-scan) on every parent
  // render — which, combined with a 2 s port poll, turns into a continuous scan
  // loop even while a BLE session is already active.
  useEffect(() => {
    scan();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleConnect = async (device: BleDevice) => {
    setConnectingId(device.id);
    setConnecting(true);
    setStoreError(null);
    try {
      const info = await connectBleDevice(device.id, device.name);
      setConnected(info, "ble");
      onClose();
    } catch (e) {
      const msg = String(e);
      setError(msg);
      setStoreError(msg);
      setConnecting(false);
      setConnectingId(null);
    }
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
            Connect over Bluetooth
          </h3>
          <button
            onClick={scan}
            disabled={scanning || connectingId !== null}
            className="text-muted hover:text-primary disabled:opacity-40 p-1 rounded transition-colors"
            title="Rescan"
          >
            {scanning ? <Spinner size={14} /> : <RefreshCw size={14} />}
          </button>
        </div>

        <p className="text-xs text-secondary mb-3">
          Pair the Flipper in your OS Bluetooth settings first. BLE supports
          files, screen, and apps — but not CLI.
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
              Scanning…
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

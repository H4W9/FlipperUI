import { useEffect, useState } from "react";
import { Usb, RefreshCw, Power, Battery, HardDrive } from "lucide-react";
import { connect, disconnect, listPorts, powerInfo, storageInfo, reboot } from "../../lib/tauri";
import { useFlipperStore } from "../../store/useFlipperStore";
import { Spinner } from "../ui/Spinner";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function DevicePanel() {
  const {
    ports,
    selectedPort,
    deviceInfo,
    isConnected,
    isConnecting,
    setPorts,
    setSelectedPort,
    setConnecting,
    setConnected,
    setError,
  } = useFlipperStore();

  const [batteryCharge, setBatteryCharge] = useState<string | null>(null);
  const [batteryCharging, setBatteryCharging] = useState(false);
  const [sdTotal, setSdTotal] = useState<number | null>(null);
  const [sdFree, setSdFree] = useState<number | null>(null);

  // Track the last-connected port for auto-reconnect
  const [lastConnectedPort, setLastConnectedPort] = useState<string | null>(null);

  // Poll for port changes every 2 seconds + auto-reconnect
  useEffect(() => {
    const poll = async () => {
      try {
        const p = await listPorts();
        setPorts(p);

        const state = useFlipperStore.getState();

        // Auto-select first Flipper port if none selected
        if (!state.selectedPort) {
          const flipper = p.find((x) => x.is_flipper);
          if (flipper) {
            setSelectedPort(flipper.name);
          }
        }

        // Auto-reconnect: if we were connected, port disappeared, and now it's back
        if (!state.isConnected && !state.isConnecting && lastConnectedPort) {
          const portBack = p.find((x) => x.name === lastConnectedPort);
          if (portBack) {
            setSelectedPort(lastConnectedPort);
            setConnecting(true);
            setError(null);
            try {
              const info = await connect(lastConnectedPort);
              setConnected(info);
            } catch {
              setConnecting(false);
              // Port appeared but connection failed — stop retrying
              setLastConnectedPort(null);
            }
          }
        }

        // Detect disconnection: port disappeared while connected
        if (state.isConnected && state.selectedPort) {
          const stillPresent = p.some((x) => x.name === state.selectedPort);
          if (!stillPresent) {
            try { await disconnect(); } catch { /* ignore */ }
            setConnected(null);
            // lastConnectedPort stays set so we auto-reconnect when it returns
          }
        }
      } catch {
        // Ignore poll errors
      }
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, [setPorts, setSelectedPort, setConnecting, setConnected, setError, lastConnectedPort]);

  // Fetch power + storage info after connection
  useEffect(() => {
    if (!isConnected) {
      setBatteryCharge(null);
      setBatteryCharging(false);
      setSdTotal(null);
      setSdFree(null);
      return;
    }

    const fetchInfo = async () => {
      try {
        const pi = await powerInfo();
        setBatteryCharge(pi["charge"] ?? null);
        setBatteryCharging(pi["charging"] === "true");
      } catch {
        // Power info may not be available on all firmware
      }
      try {
        const si = await storageInfo("/ext");
        setSdTotal(si.total_space);
        setSdFree(si.free_space);
      } catch {
        // Storage info may fail if no SD card
      }
    };

    fetchInfo();
    const id = setInterval(fetchInfo, 30000); // refresh every 30s
    return () => clearInterval(id);
  }, [isConnected]);

  const handleConnect = async () => {
    if (!selectedPort) return;
    setConnecting(true);
    setError(null);
    try {
      const info = await connect(selectedPort);
      setConnected(info);
      setLastConnectedPort(selectedPort);
    } catch (e: unknown) {
      setError(String(e));
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setLastConnectedPort(null); // don't auto-reconnect after manual disconnect
    try {
      await disconnect();
    } catch {
      // Ignore disconnect errors
    }
    setConnected(null);
  };

  const handleReboot = async () => {
    // Keep lastConnectedPort so we auto-reconnect after reboot
    try {
      await reboot(0); // 0 = normal OS reboot
    } catch {
      // Expected — device disconnects immediately
    }
    setConnected(null);
  };

  const sdUsedPct =
    sdTotal && sdFree != null
      ? Math.round(((sdTotal - sdFree) / sdTotal) * 100)
      : null;

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-panel border-b border-flipper shrink-0">
      {/* Icon */}
      <Usb size={18} className="text-accent shrink-0" />

      {/* Title */}
      <span className="font-semibold text-sm text-white">FlipperUI</span>

      <div className="w-px h-4 bg-elevated mx-1" />

      {/* Port selector */}
      <select
        value={selectedPort ?? ""}
        onChange={(e) => setSelectedPort(e.target.value || null)}
        disabled={isConnected || isConnecting}
        className="bg-surface text-primary text-sm border border-elevated rounded px-2 py-1 disabled:opacity-50 focus:outline-none focus:border-accent"
      >
        <option value="">Select port…</option>
        {ports.map((p) => (
          <option key={p.name} value={p.name}>
            {p.name}
            {p.is_flipper ? " (Flipper)" : ""}
          </option>
        ))}
      </select>

      {/* Connect / Disconnect button */}
      {!isConnected ? (
        <button
          onClick={handleConnect}
          disabled={!selectedPort || isConnecting}
          className="flex items-center gap-1.5 px-3 py-1 text-sm bg-accent-dim hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-white rounded transition-colors"
        >
          {isConnecting ? <Spinner size={13} /> : null}
          {isConnecting ? "Connecting…" : "Connect"}
        </button>
      ) : (
        <button
          onClick={handleDisconnect}
          className="px-3 py-1 text-sm bg-elevated hover:bg-muted text-primary rounded transition-colors"
        >
          Disconnect
        </button>
      )}

      {/* Device info */}
      {deviceInfo && (
        <div className="flex items-center gap-3 ml-1 text-xs text-secondary">
          <span className="w-2 h-2 rounded-full bg-success shrink-0" />
          {deviceInfo.hardware_name && (
            <span className="text-primary">{deviceInfo.hardware_name}</span>
          )}
          {deviceInfo.firmware_version && (
            <span>fw {deviceInfo.firmware_version}</span>
          )}
          {deviceInfo.firmware_build_date && (
            <span className="text-muted">({deviceInfo.firmware_build_date})</span>
          )}

          {/* Battery */}
          {batteryCharge != null && (
            <span className="flex items-center gap-1" title={`Battery: ${batteryCharge}%${batteryCharging ? " (charging)" : ""}`}>
              <Battery size={12} className={batteryCharging ? "text-success" : "text-secondary"} />
              <span>{batteryCharge}%</span>
            </span>
          )}

          {/* SD card space */}
          {sdTotal != null && sdFree != null && (
            <span
              className="flex items-center gap-1"
              title={`SD: ${formatBytes(sdTotal - sdFree)} used / ${formatBytes(sdTotal)} total (${formatBytes(sdFree)} free)`}
            >
              <HardDrive size={12} />
              <span>{sdUsedPct}%</span>
              <div className="w-14 h-1.5 bg-elevated rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${(sdUsedPct ?? 0) > 90 ? "bg-danger" : "bg-accent-hover"}`}
                  style={{ width: `${sdUsedPct}%` }}
                />
              </div>
            </span>
          )}

          {/* Reboot button */}
          <button
            onClick={handleReboot}
            className="p-1 text-muted hover:text-accent rounded transition-colors"
            title="Reboot device"
          >
            <Power size={12} />
          </button>
        </div>
      )}

      {/* Spacer + refresh icon */}
      <div className="flex-1" />
      <button
        onClick={async () => {
          const p = await listPorts().catch(() => []);
          setPorts(p);
        }}
        className="text-muted hover:text-primary p-1 rounded transition-colors"
        title="Refresh ports"
      >
        <RefreshCw size={14} />
      </button>
    </div>
  );
}

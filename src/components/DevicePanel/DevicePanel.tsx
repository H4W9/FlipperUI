import { useEffect, useState } from "react";
import { Usb, Power, BatteryLow, BatteryMedium, BatteryFull, BatteryWarning, Zap, HardDrive, Bluetooth, Signal, SignalLow, SignalMedium, SignalHigh } from "lucide-react";
import { connect, disconnect, listPorts, powerInfo, storageInfo, reboot, ping } from "../../lib/tauri";
import { useFlipperStore } from "../../store/useFlipperStore";
import { Spinner } from "../ui/Spinner";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { BleDialog } from "./BleDialog";

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
  const [latency, setLatency] = useState<number | null>(null);

  // Track whether the user manually disconnected — suppresses auto-connect
  // until the device is physically unplugged and re-plugged.
  const [userDisconnected, setUserDisconnected] = useState(false);
  const [showRebootConfirm, setShowRebootConfirm] = useState(false);
  const [showBleDialog, setShowBleDialog] = useState(false);
  const [transport, setTransport] = useState<"usb" | "ble">("usb");

  // Poll for port changes every 2 seconds + auto-connect
  useEffect(() => {
    const poll = async () => {
      try {
        const p = await listPorts();
        setPorts(p);

        const state = useFlipperStore.getState();
        const flipper = p.find((x) => x.is_flipper);

        // Auto-select first Flipper port if none selected
        if (!state.selectedPort && flipper) {
          setSelectedPort(flipper.name);
        }

        // Clear userDisconnected when no Flipper ports are present
        // (device was physically unplugged)
        if (!flipper && userDisconnected) {
          setUserDisconnected(false);
        }

        // Auto-connect: Flipper detected, not connected, not connecting,
        // user hasn't manually disconnected, and USB transport is selected
        if (transport === "usb" && flipper && !state.isConnected && !state.isConnecting && !userDisconnected) {
          const port = state.selectedPort ?? flipper.name;
          setSelectedPort(port);
          setConnecting(true);
          setError(null);
          try {
            const info = await connect(port);
            setConnected(info, "serial");
          } catch {
            setConnecting(false);
          }
        }

        // Detect disconnection: USB port disappeared while connected via serial.
        // BLE sessions are torn down by the backend (flipper-disconnected event),
        // so the port-presence check must not run when the active transport
        // isn't serial.
        if (
          state.isConnected &&
          state.connectionKind === "serial" &&
          state.selectedPort
        ) {
          const stillPresent = p.some((x) => x.name === state.selectedPort);
          if (!stillPresent) {
            try { await disconnect(); } catch { /* ignore */ }
            setConnected(null);
            // userDisconnected stays false so we auto-reconnect when it returns
          }
        }
      } catch {
        // Ignore poll errors
      }
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, [setPorts, setSelectedPort, setConnecting, setConnected, setError, userDisconnected, transport]);

  // Fetch power + storage info after connection
  useEffect(() => {
    if (!isConnected) {
      setBatteryCharge(null);
      setBatteryCharging(false);
      setSdTotal(null);
      setSdFree(null);
      setLatency(null);
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

  // Poll ping latency for connection-quality indicator.
  useEffect(() => {
    if (!isConnected) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const ms = await ping();
        if (!cancelled) setLatency(ms);
      } catch {
        if (!cancelled) setLatency(null);
      }
    };
    tick();
    const id = setInterval(tick, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [isConnected]);

  const handleConnect = async () => {
    if (!selectedPort) return;
    setUserDisconnected(false);
    setConnecting(true);
    setError(null);
    try {
      const info = await connect(selectedPort);
      setConnected(info, "serial");
    } catch (e: unknown) {
      setError(String(e));
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setUserDisconnected(true); // suppress auto-connect until re-plug
    try {
      await disconnect();
    } catch {
      // Ignore disconnect errors
    }
    setConnected(null);
  };

  const handleReboot = async () => {
    // userDisconnected stays false so we auto-reconnect after reboot
    try {
      await reboot(0); // 0 = normal OS reboot
    } catch {
      // Expected — device disconnects immediately
    }
    setConnected(null);
    setShowRebootConfirm(false);
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

      {/* Transport toggle (USB / BLE) */}
      <div className="flex items-center gap-2 select-none">
        <Usb
          className={`w-3.5 h-3.5 ${transport === "usb" ? "text-primary" : "text-muted"}`}
          aria-label="USB"
        />
        <button
          type="button"
          role="switch"
          aria-checked={transport === "ble"}
          aria-label="Toggle connection transport"
          onClick={() => setTransport(transport === "usb" ? "ble" : "usb")}
          disabled={isConnected || isConnecting}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            transport === "ble" ? "bg-accent" : "bg-elevated"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${
              transport === "ble" ? "translate-x-[18px]" : "translate-x-[2px]"
            }`}
          />
        </button>
        <Bluetooth
          className={`w-3.5 h-3.5 ${transport === "ble" ? "text-primary" : "text-muted"}`}
          aria-label="BLE"
        />
      </div>

      {/* Port selector (USB only) */}
      {transport === "usb" && (
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
            </option>
          ))}
        </select>
      )}

      {/* Connect / Disconnect button */}
      {!isConnected ? (
        transport === "usb" ? (
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
            onClick={() => setShowBleDialog(true)}
            disabled={isConnecting}
            className="flex items-center gap-1.5 px-3 py-1 text-sm bg-accent-dim hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-white rounded transition-colors"
          >
            {isConnecting ? <Spinner size={13} /> : null}
            {isConnecting ? "Connecting…" : "Connect"}
          </button>
        )
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
        <div className="flex items-center gap-2 ml-1 text-xs">
          {/* Status pill: pulsing dot + device name + fw */}
          <div
            className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-surface border border-elevated"
            title={
              deviceInfo.firmware_build_date
                ? `Built ${deviceInfo.firmware_build_date}`
                : undefined
            }
          >
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
            </span>
            {deviceInfo.hardware_name && (
              <span className="text-primary font-medium">{deviceInfo.hardware_name}</span>
            )}
            {deviceInfo.firmware_version && (
              <span className="text-muted tabular-nums">{deviceInfo.firmware_version}</span>
            )}
          </div>

          {/* Battery chip */}
          {batteryCharge != null && (
            <BatteryChip charge={Number(batteryCharge)} charging={batteryCharging} />
          )}

          {/* Signal/latency chip */}
          <SignalChip latencyMs={latency} transport={transport} />

          {/* SD card chip */}
          {sdTotal != null && sdFree != null && (
            <div
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface border border-elevated text-secondary"
              title={`SD: ${formatBytes(sdTotal - sdFree)} used / ${formatBytes(sdTotal)} total (${formatBytes(sdFree)} free)`}
            >
              <HardDrive size={12} className="text-muted" />
              <span className="tabular-nums">{sdUsedPct}%</span>
              <div className="w-12 h-1 bg-elevated rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    (sdUsedPct ?? 0) > 90 ? "bg-danger" : "bg-accent-hover"
                  }`}
                  style={{ width: `${sdUsedPct}%` }}
                />
              </div>
            </div>
          )}

          {/* Reboot button */}
          <button
            onClick={() => setShowRebootConfirm(true)}
            className="ml-1 p-1.5 text-muted hover:text-accent hover:bg-elevated rounded-full transition-colors"
            title="Reboot device"
          >
            <Power size={13} />
          </button>
        </div>
      )}

      <div className="flex-1" />

      {showRebootConfirm && (
        <ConfirmDialog
          title="Reboot Device"
          message="The Flipper Zero will restart. It will auto-reconnect when it comes back."
          confirmLabel="Reboot"
          destructive
          onConfirm={handleReboot}
          onCancel={() => setShowRebootConfirm(false)}
        />
      )}

      {showBleDialog && <BleDialog onClose={() => setShowBleDialog(false)} />}
    </div>
  );
}

function BatteryChip({ charge, charging }: { charge: number; charging: boolean }) {
  const Icon =
    charge <= 15
      ? BatteryWarning
      : charge <= 35
      ? BatteryLow
      : charge <= 75
      ? BatteryMedium
      : BatteryFull;
  const color =
    charge <= 15
      ? "text-danger"
      : charge <= 35
      ? "text-warning"
      : "text-success";
  return (
    <div
      className="relative flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface border border-elevated text-secondary"
      title={`Battery: ${charge}%${charging ? " (charging)" : ""}`}
    >
      <span className="relative inline-flex">
        <Icon size={13} className={color} />
        {charging && (
          <Zap
            size={9}
            className="absolute -top-0.5 -right-1 text-warning fill-warning"
          />
        )}
      </span>
      <span className="tabular-nums">{charge}%</span>
    </div>
  );
}

function SignalChip({
  latencyMs,
  transport,
}: {
  latencyMs: number | null;
  transport: "usb" | "ble";
}) {
  const Icon =
    latencyMs == null
      ? Signal
      : latencyMs < 50
      ? SignalHigh
      : latencyMs < 150
      ? SignalMedium
      : SignalLow;
  const color =
    latencyMs == null
      ? "text-muted"
      : latencyMs < 50
      ? "text-success"
      : latencyMs < 150
      ? "text-warning"
      : "text-danger";
  const label = latencyMs == null ? "—" : `${latencyMs} ms`;
  return (
    <div
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface border border-elevated text-secondary"
      title={`${transport.toUpperCase()} link: ${label} round-trip`}
    >
      <Icon size={13} className={color} />
      <span className="tabular-nums">{label}</span>
    </div>
  );
}

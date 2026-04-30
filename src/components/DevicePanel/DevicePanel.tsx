import { useEffect, useRef, useState } from "react";
import { Usb, Power, BatteryLow, BatteryMedium, BatteryFull, BatteryWarning, Zap, HardDrive, Bluetooth, Signal, SignalLow, SignalMedium, SignalHigh } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { connect, connectBleDevice, disconnect, listPorts, powerInfo, storageInfo, reboot, ping } from "../../lib/tauri";
import { useFlipperStore } from "../../store/useFlipperStore";
import { loadSettings, subscribeSettings, updateSettings } from "../../lib/settings";
import { Spinner } from "../ui/Spinner";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { BleDialog } from "./BleDialog";
import { GlobalSearch } from "../GlobalSearch/GlobalSearch";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function DevicePanel() {
  const ports = useFlipperStore((s) => s.ports);
  const selectedPort = useFlipperStore((s) => s.selectedPort);
  const deviceInfo = useFlipperStore((s) => s.deviceInfo);
  const isConnected = useFlipperStore((s) => s.isConnected);
  const isConnecting = useFlipperStore((s) => s.isConnecting);
  const setPorts = useFlipperStore((s) => s.setPorts);
  const setSelectedPort = useFlipperStore((s) => s.setSelectedPort);
  const setConnecting = useFlipperStore((s) => s.setConnecting);
  const setConnected = useFlipperStore((s) => s.setConnected);
  const setError = useFlipperStore((s) => s.setError);

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
  // BLE auto-reconnect target (id + display name). Set after every successful
  // BLE connect (manual or auto), and hydrated from persisted settings on mount
  // so a fresh app launch can resume where the last session left off.
  const bleTargetRef = useRef<{ id: string; name: string | null } | null>(null);
  const [reconnectAttempt, setReconnectAttempt] = useState<number | null>(null);
  // Hydrate transport + last-used port from persisted settings on first mount.
  // Until this resolves, settings-driven port auto-select is suppressed so the
  // poll loop can't snap to an arbitrary first port before we know the
  // preferred one.
  const [settingsHydrated, setSettingsHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadSettings()
      .then((s) => {
        if (cancelled) return;
        setTransport(s.connection.transport);
        if (s.connection.lastPort) {
          const state = useFlipperStore.getState();
          if (!state.selectedPort) setSelectedPort(s.connection.lastPort);
        }
        if (s.connection.lastBleId) {
          bleTargetRef.current = {
            id: s.connection.lastBleId,
            name: s.connection.lastBleName,
          };
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setSettingsHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, [setSelectedPort]);

  // Keep `bleTargetRef` in sync with persisted settings — BleDialog writes
  // lastBleId/lastBleName when it connects, so this is how we pick that up
  // without reaching across components.
  useEffect(() => {
    return subscribeSettings((s) => {
      bleTargetRef.current = s.connection.lastBleId
        ? { id: s.connection.lastBleId, name: s.connection.lastBleName }
        : null;
    });
  }, []);

  const handleTransportChange = (next: "usb" | "ble") => {
    setTransport(next);
    void updateSettings({ connection: { transport: next } }).catch(() => {});
  };

  const handleSelectPort = (port: string | null) => {
    setSelectedPort(port);
    void updateSettings({ connection: { lastPort: port } }).catch(() => {});
  };

  // Poll for port changes every 2 seconds + auto-connect
  useEffect(() => {
    if (!settingsHydrated) return;
    const poll = async () => {
      try {
        const p = await listPorts();
        setPorts(p);

        const state = useFlipperStore.getState();
        const flipper = p.find((x) => x.is_flipper);

        // Auto-select first Flipper port if none selected. The persisted
        // lastPort has already been applied in the hydrate effect, so if
        // selectedPort is still null at this point either there was no stored
        // port or the stored port isn't currently present.
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
  }, [setPorts, setSelectedPort, setConnecting, setConnected, setError, userDisconnected, transport, settingsHydrated]);

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
        // Firmware versions vary on the key name — newer builds use
        // `charge_level`, older ones use `charge`. Same for current/charging
        // (older "charging"=="true", newer report a positive `battery_current`).
        const charge = pi["charge_level"] ?? pi["charge"] ?? null;
        setBatteryCharge(charge);
        const currentMa = Number(
          pi["battery_current"] ?? pi["current_gauge"] ?? pi["current"] ?? "0",
        );
        setBatteryCharging(
          pi["charging"] === "true" || (Number.isFinite(currentMa) && currentMa > 5),
        );
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

  // Mirror device state into the system-tray flyout menu so users see
  // connection status + battery without opening the window. The tray rebuilds
  // its menu on every push, so we only call when one of the inputs changes.
  useEffect(() => {
    const charge =
      batteryCharge != null && Number.isFinite(Number(batteryCharge))
        ? Math.max(0, Math.min(100, Math.round(Number(batteryCharge))))
        : null;
    void invoke("update_tray_status", {
      status: {
        connected: isConnected,
        deviceName: deviceInfo?.hardware_name ?? null,
        firmwareVersion: deviceInfo?.firmware_version ?? null,
        batteryCharge: charge,
        batteryCharging,
      },
    }).catch(() => {});
  }, [isConnected, deviceInfo, batteryCharge, batteryCharging]);

  // Successful connect clears the manual-disconnect flag, so the next
  // unexpected drop is eligible for auto-reconnect again.
  useEffect(() => {
    if (isConnected && userDisconnected) setUserDisconnected(false);
  }, [isConnected, userDisconnected]);

  // BLE auto-reconnect. When the BLE link drops without an explicit user
  // disconnect, retry the last-known peripheral with exponential backoff.
  // USB has its own auto-reconnect via the port-poll loop above (it reconnects
  // when the serial port reappears), so this only runs for BLE.
  useEffect(() => {
    if (transport !== "ble") return;
    let cancelled = false;
    let timer: number | undefined;

    const attempt = async (n: number) => {
      // Bail conditions checked on every attempt — userDisconnected can flip
      // mid-backoff if the user clicks Disconnect, and we don't want to
      // reconnect after that.
      const target = bleTargetRef.current;
      const state = useFlipperStore.getState();
      if (cancelled || userDisconnected || !target) {
        setReconnectAttempt(null);
        return;
      }
      if (state.isConnected || state.isConnecting) {
        setReconnectAttempt(null);
        return;
      }

      setReconnectAttempt(n);
      setConnecting(true);
      try {
        const info = await connectBleDevice(target.id, target.name ?? undefined);
        if (cancelled) return;
        setConnected(info, "ble");
        setReconnectAttempt(null);
        setError(null);
      } catch {
        if (cancelled) return;
        setConnecting(false);
        // 5 attempts with 1s, 2s, 4s, 8s, 16s backoff. After that we stop and
        // let the user retry manually — endless retries on a truly offline
        // device just spam the BLE adapter.
        if (n >= 5) {
          setReconnectAttempt(null);
          setError("BLE auto-reconnect gave up after 5 attempts");
          return;
        }
        const delay = 1000 * 2 ** n;
        timer = window.setTimeout(() => void attempt(n + 1), delay);
      }
    };

    let unlisten: (() => void) | undefined;
    listen<string>("flipper-disconnected", () => {
      if (cancelled) return;
      // Only kick off reconnect when this is an unexpected drop (the user
      // didn't click Disconnect) and we have a peripheral to reconnect to.
      if (userDisconnected) return;
      if (!bleTargetRef.current) return;
      // First retry after 1s — gives the BLE stack a moment to free the
      // peripheral handle before we redial.
      timer = window.setTimeout(() => void attempt(1), 1000);
    }).then((u) => {
      if (cancelled) u();
      else unlisten = u;
    });

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      unlisten?.();
      setReconnectAttempt(null);
    };
  }, [transport, userDisconnected, setConnected, setConnecting, setError]);

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
          onClick={() => handleTransportChange(transport === "usb" ? "ble" : "usb")}
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
          onChange={(e) => handleSelectPort(e.target.value || null)}
          disabled={isConnected || isConnecting}
          className="bg-surface text-primary text-sm border border-elevated rounded px-2 py-1 disabled:opacity-50 focus:outline-none focus:border-accent"
        >
          <option value="">Select port…</option>
          {ports.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name.startsWith("/dev/") ? p.name.slice(5) : p.name}
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
            {reconnectAttempt != null
              ? `Reconnecting… (${reconnectAttempt}/5)`
              : isConnecting
              ? "Connecting…"
              : "Connect"}
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

          {/* Signal/latency chip */}
          <SignalChip latencyMs={latency} transport={transport} />

          {/* Battery chip */}
          {batteryCharge != null && (
            <BatteryChip charge={Number(batteryCharge)} charging={batteryCharging} />
          )}

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

      <GlobalSearch />

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
  const iconColor =
    charge <= 15
      ? "text-danger"
      : charge <= 35
      ? "text-warning"
      : "text-success";
  const barColor =
    charge <= 15
      ? "bg-danger"
      : charge <= 35
      ? "bg-warning"
      : "bg-success";
  const pct = Math.max(0, Math.min(100, Math.round(charge)));
  return (
    <div
      className="relative flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface border border-elevated text-secondary"
      title={`Battery: ${charge}%${charging ? " (charging)" : ""}`}
    >
      <span className="relative inline-flex">
        <Icon size={13} className={iconColor} />
        {charging && (
          <Zap
            size={9}
            className="absolute -top-0.5 -right-1 text-warning fill-warning"
          />
        )}
      </span>
      <span className="tabular-nums">{pct}%</span>
      <div className="w-12 h-1 bg-elevated rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
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

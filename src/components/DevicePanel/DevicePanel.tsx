import { useEffect } from "react";
import { Usb, RefreshCw } from "lucide-react";
import { connect, disconnect, listPorts } from "../../lib/tauri";
import { useFlipperStore } from "../../store/useFlipperStore";
import { Spinner } from "../ui/Spinner";

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

  // Poll for port changes every 2 seconds
  useEffect(() => {
    const poll = async () => {
      try {
        const p = await listPorts();
        setPorts(p);
        // Auto-select first Flipper port if none selected
        useFlipperStore.setState((s) => {
          if (!s.selectedPort) {
            const flipper = p.find((x) => x.is_flipper);
            return flipper ? { selectedPort: flipper.name } : {};
          }
          return {};
        });
      } catch {
        // Ignore poll errors
      }
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, [setPorts]);

  const handleConnect = async () => {
    if (!selectedPort) return;
    setConnecting(true);
    setError(null);
    try {
      const info = await connect(selectedPort);
      setConnected(info);
    } catch (e: unknown) {
      setError(String(e));
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnect();
    } catch {
      // Ignore disconnect errors
    }
    setConnected(null);
  };

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-zinc-900 border-b border-zinc-700 shrink-0">
      {/* Icon */}
      <Usb size={18} className="text-orange-400 shrink-0" />

      {/* Title */}
      <span className="font-semibold text-sm text-white">FlipperUI</span>

      <div className="w-px h-4 bg-zinc-600 mx-1" />

      {/* Port selector */}
      <select
        value={selectedPort ?? ""}
        onChange={(e) => setSelectedPort(e.target.value || null)}
        disabled={isConnected || isConnecting}
        className="bg-zinc-800 text-zinc-200 text-sm border border-zinc-600 rounded px-2 py-1 disabled:opacity-50 focus:outline-none focus:border-orange-500"
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
          className="flex items-center gap-1.5 px-3 py-1 text-sm bg-orange-600 hover:bg-orange-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded transition-colors"
        >
          {isConnecting ? <Spinner size={13} /> : null}
          {isConnecting ? "Connecting…" : "Connect"}
        </button>
      ) : (
        <button
          onClick={handleDisconnect}
          className="px-3 py-1 text-sm bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded transition-colors"
        >
          Disconnect
        </button>
      )}

      {/* Device info */}
      {deviceInfo && (
        <div className="flex items-center gap-2 ml-1 text-xs text-zinc-400">
          <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
          {deviceInfo.hardware_name && (
            <span className="text-zinc-300">{deviceInfo.hardware_name}</span>
          )}
          {deviceInfo.firmware_version && (
            <span>fw {deviceInfo.firmware_version}</span>
          )}
        </div>
      )}

      {/* Spacer + refresh icon */}
      <div className="flex-1" />
      <button
        onClick={async () => {
          const p = await listPorts().catch(() => []);
          setPorts(p);
        }}
        className="text-zinc-500 hover:text-zinc-300 p-1 rounded transition-colors"
        title="Refresh ports"
      >
        <RefreshCw size={14} />
      </button>
    </div>
  );
}

import { RefreshCw, Search, X, Usb } from "lucide-react";
import { useFlipperStore } from "../../store/useFlipperStore";
import { ScanProgressBar } from "../ui/ScanProgressBar";
import { formatRelative } from "../../lib/format";

interface Props {
  kinds: string[];
  kindFilter: string | null;
  onKindFilterChange: (k: string | null) => void;
  query: string;
  onQueryChange: (q: string) => void;
  onRefresh: () => void;
  onCancel: () => void;
  total: number;
  filtered: number;
  lastScannedAt: number | null;
  isConnected: boolean;
}

export function LibraryToolbar({
  kinds,
  kindFilter,
  onKindFilterChange,
  query,
  onQueryChange,
  onRefresh,
  onCancel,
  total,
  filtered,
  lastScannedAt,
  isConnected,
}: Props) {
  const scanning = useFlipperStore((s) => s.badusbScanning);
  const progress = useFlipperStore((s) => s.badusbProgress);

  const refreshDisabled = scanning || !isConnected;
  const refreshTitle = !isConnected
    ? "Connect a Flipper to scan"
    : scanning
      ? "Scanning…"
      : lastScannedAt
        ? `Re-scan /ext/badusb + /ext/badkb (last scan ${formatRelative(lastScannedAt)})`
        : "Scan /ext/badusb + /ext/badkb";

  return (
    <header className="shrink-0 border-b border-border-subtle bg-panel">
      <div className="flex items-center gap-2 px-3 py-2">
        <Usb size={14} className="text-accent" />
        <h2 className="text-xs font-medium text-primary">BadUSB Library</h2>
        <span className="text-[11px] text-dim">/ext/badusb · /ext/badkb</span>
        <div className="flex-1" />
        <span className="text-[11px] text-muted">
          {filtered === total
            ? `${total} scripts`
            : `${filtered} / ${total} scripts`}
          {lastScannedAt && !scanning && (
            <span className="text-dim ml-1.5" title={new Date(lastScannedAt).toLocaleString()}>
              · cached {formatRelative(lastScannedAt)}
            </span>
          )}
        </span>
        {scanning ? (
          <button
            onClick={onCancel}
            className="flex items-center gap-1 px-2 py-1 text-[11px] text-secondary hover:text-primary border border-border-subtle rounded hover:bg-surface/60"
            title="Cancel scan"
          >
            <X size={11} />
            Cancel
          </button>
        ) : (
          <button
            onClick={onRefresh}
            disabled={refreshDisabled}
            title={refreshTitle}
            className="flex items-center gap-1 px-2 py-1 text-[11px] text-secondary hover:text-primary border border-border-subtle rounded hover:bg-surface/60 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RefreshCw size={11} />
            Refresh
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 px-3 pb-2">
        <div className="relative flex-1 max-w-xs">
          <Search
            size={12}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-dim pointer-events-none"
          />
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search script, comment, path…"
            className="w-full bg-surface border border-border-subtle rounded pl-7 pr-2 py-1 text-xs text-primary placeholder:text-dim focus:outline-none focus:border-accent"
          />
        </div>
        <select
          value={kindFilter ?? ""}
          onChange={(e) => onKindFilterChange(e.target.value || null)}
          className="bg-surface border border-border-subtle rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-accent"
        >
          <option value="">All kinds</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {kindLabel(k)}
            </option>
          ))}
        </select>
      </div>

      {scanning && progress && <ScanProgressBar progress={progress} />}
    </header>
  );
}

function kindLabel(kind: string): string {
  if (kind === "usb") return "BadUSB";
  if (kind === "kb") return "BadKB";
  return kind;
}

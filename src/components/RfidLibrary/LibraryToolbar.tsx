import { RefreshCw, Search, Upload, X, RadioTower } from "lucide-react";
import { useFlipperStore } from "../../store/useFlipperStore";
import { ScanProgressBar } from "../ui/ScanProgressBar";

interface Props {
  keyTypes: string[];
  keyTypeFilter: string | null;
  onKeyTypeFilterChange: (t: string | null) => void;
  query: string;
  onQueryChange: (q: string) => void;
  onRefresh: () => void;
  onCancel: () => void;
  onUpload: () => void;
  uploadingCount: number;
  total: number;
  filtered: number;
  lastScannedAt: number | null;
  isConnected: boolean;
}

export function LibraryToolbar({
  keyTypes,
  keyTypeFilter,
  onKeyTypeFilterChange,
  query,
  onQueryChange,
  onRefresh,
  onCancel,
  onUpload,
  uploadingCount,
  total,
  filtered,
  lastScannedAt,
  isConnected,
}: Props) {
  const scanning = useFlipperStore((s) => s.rfidScanning);
  const progress = useFlipperStore((s) => s.rfidProgress);

  const refreshTitle = !isConnected
    ? "Connect a Flipper to scan"
    : scanning
      ? "Scanning…"
      : lastScannedAt
        ? `Re-scan /ext/lfrfid (last scan ${formatRelative(lastScannedAt)})`
        : "Scan /ext/lfrfid";
  const uploading = uploadingCount > 0;
  const uploadDisabled = scanning || uploading || !isConnected;
  const uploadTitle = !isConnected
    ? "Connect a Flipper to upload .rfid files"
    : "Upload .rfid files";

  return (
    <header className="shrink-0 border-b border-border-subtle bg-panel">
      <div className="flex items-center gap-2 px-3 py-2">
        <RadioTower size={14} className="text-accent" />
        <h2 className="text-xs font-medium text-primary">RFID Library</h2>
        <span className="text-[11px] text-dim">/ext/lfrfid</span>
        <div className="flex-1" />
        <span className="text-[11px] text-muted">
          {filtered === total ? `${total} keys` : `${filtered} / ${total} keys`}
          {lastScannedAt && !scanning && (
            <span
              className="text-dim ml-1.5"
              title={new Date(lastScannedAt).toLocaleString()}
            >
              · cached {formatRelative(lastScannedAt)}
            </span>
          )}
        </span>
        <button
          onClick={onUpload}
          disabled={uploadDisabled}
          title={uploadTitle}
          className="flex items-center gap-1 px-2 py-1 text-[11px] text-secondary hover:text-primary border border-border-subtle rounded hover:bg-surface/60 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Upload size={11} />
          {uploading ? `Uploading ${uploadingCount}…` : "Upload"}
        </button>
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
            disabled={scanning || uploading || !isConnected}
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
            placeholder="Search key, data, path…"
            className="w-full bg-surface border border-border-subtle rounded pl-7 pr-2 py-1 text-xs text-primary placeholder:text-dim focus:outline-none focus:border-accent"
          />
        </div>
        <select
          value={keyTypeFilter ?? ""}
          onChange={(e) => onKeyTypeFilterChange(e.target.value || null)}
          className="bg-surface border border-border-subtle rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-accent"
        >
          <option value="">All types</option>
          {keyTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      {scanning && progress && <ScanProgressBar progress={progress} />}
    </header>
  );
}

function formatRelative(ts: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

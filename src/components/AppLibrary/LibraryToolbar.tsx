import { LayoutGrid, RefreshCw, Search, Upload, X } from "lucide-react";
import { useFlipperStore } from "../../store/useFlipperStore";
import { ScanProgressBar } from "../ui/ScanProgressBar";
import { formatRelative } from "../../lib/format";

interface Props {
  roots: string[];
  categories: string[];
  categoryFilter: string | null;
  onCategoryFilterChange: (c: string | null) => void;
  query: string;
  onQueryChange: (q: string) => void;
  onRefresh: () => void;
  onCancel: () => void;
  onUpload: () => void;
  installingCount: number;
  total: number;
  filtered: number;
  lastScannedAt: number | null;
}

export function LibraryToolbar({
  roots,
  categories,
  categoryFilter,
  onCategoryFilterChange,
  query,
  onQueryChange,
  onRefresh,
  onCancel,
  onUpload,
  installingCount,
  total,
  filtered,
  lastScannedAt,
}: Props) {
  const scanning = useFlipperStore((s) => s.appsScanning);
  const progress = useFlipperStore((s) => s.appsProgress);

  const rootsLabel = roots.join(", ");
  const refreshTitle = scanning
    ? "Scanning…"
    : lastScannedAt
      ? `Re-scan (last scan ${formatRelative(lastScannedAt)})`
      : "Scan";
  const installing = installingCount > 0;

  return (
    <header className="shrink-0 border-b border-border-subtle bg-panel">
      <div className="flex items-center gap-2 px-3 py-2">
        <LayoutGrid size={14} className="text-accent" />
        <h2 className="text-xs font-medium text-primary">App Library</h2>
        <span
          className="text-[11px] text-dim truncate max-w-[40%]"
          title={rootsLabel}
        >
          {rootsLabel}
        </span>
        <div className="flex-1" />
        <span className="text-[11px] text-muted">
          {filtered === total ? `${total} apps` : `${filtered} / ${total} apps`}
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
          disabled={scanning || installing}
          title="Install .fap files"
          className="flex items-center gap-1 px-2 py-1 text-[11px] text-secondary hover:text-primary border border-border-subtle rounded hover:bg-surface/60 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Upload size={11} />
          {installing ? `Installing ${installingCount}…` : "Install"}
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
            disabled={scanning || installing}
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
            placeholder="Search app, category, path…"
            className="w-full bg-surface border border-border-subtle rounded pl-7 pr-2 py-1 text-xs text-primary placeholder:text-dim focus:outline-none focus:border-accent"
          />
        </div>
        <select
          value={categoryFilter ?? ""}
          onChange={(e) => onCategoryFilterChange(e.target.value || null)}
          className="bg-surface border border-border-subtle rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-accent"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {scanning && progress && <ScanProgressBar progress={progress} />}
    </header>
  );
}

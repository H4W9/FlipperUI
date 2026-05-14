import { useEffect, useMemo, useState } from "react";
import type { PrewalkDirStat } from "../../lib/tauri";
import { formatSize } from "../../lib/format";

interface LibraryPreScanModalProps {
  flagged: PrewalkDirStat[];
  /** Called when the user clicks Scan. Excluded paths are the checked rows. */
  onScan: (excludedToAdd: string[]) => void;
  /** Called when the user clicks Skip — scan runs with no new exclusions. */
  onSkip: () => void;
  /** Called when the user closes (Esc / X / backdrop) — scan is aborted. */
  onCancel: () => void;
}

/** 254 — matches the Rust-side `MAX_DIR_ENTRIES`. */
const DENSE_THRESHOLD = 254;

export function LibraryPreScanModal({
  flagged,
  onScan,
  onSkip,
  onCancel,
}: LibraryPreScanModalProps) {
  // Sort heaviest first so the most worth-excluding rows surface at the top.
  const rows = useMemo(() => {
    return [...flagged].sort((a, b) => {
      const sizeA = a.largest_file?.size ?? 0;
      const sizeB = b.largest_file?.size ?? 0;
      if (sizeB !== sizeA) return sizeB - sizeA;
      return b.entry_count - a.entry_count;
    });
  }, [flagged]);

  const [checked, setChecked] = useState<Set<string>>(new Set());

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);

  function toggle(path: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function toggleAll() {
    setChecked((prev) =>
      prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.path)),
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onCancel}
    >
      <div
        className="bg-panel border border-border-subtle rounded-lg shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-5 pb-3">
          <div>
            <h3 className="text-sm font-semibold text-primary">
              Heavy directories found
            </h3>
            <p className="text-xs text-secondary mt-1 leading-relaxed">
              These directories may slow down the scan. Check any you want to
              exclude from this and future scans.
            </p>
          </div>
          <button
            onClick={onCancel}
            aria-label="Close"
            className="text-secondary hover:text-primary transition-colors ml-3"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M3 3L11 11M11 3L3 11"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="px-5 pb-2 flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-wide text-secondary">
            {rows.length} {rows.length === 1 ? "directory" : "directories"}
          </span>
          <button
            onClick={toggleAll}
            className="text-[11px] text-secondary hover:text-primary transition-colors"
          >
            {checked.size === rows.length ? "Clear all" : "Select all"}
          </button>
        </div>

        <ul className="flex-1 overflow-y-auto px-3 pb-3 space-y-1">
          {rows.map((row) => {
            const isChecked = checked.has(row.path);
            const reasons: string[] = [];
            if (row.entry_count >= DENSE_THRESHOLD) {
              reasons.push(`${row.entry_count} entries`);
            }
            if (row.largest_file) {
              reasons.push(
                `${formatSize(row.largest_file.size)} · ${row.largest_file.name}`,
              );
            }
            return (
              <li key={row.path}>
                <label
                  className={`flex items-center gap-3 px-3 py-2 rounded cursor-pointer transition-colors ${
                    isChecked
                      ? "bg-flipper/10 hover:bg-flipper/15"
                      : "hover:bg-elevated"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggle(row.path)}
                    className="accent-flipper"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-primary font-mono truncate">
                      {row.path}
                    </div>
                    <div className="text-[11px] text-secondary mt-0.5 truncate">
                      {reasons.join("  ·  ")}
                    </div>
                  </div>
                </label>
              </li>
            );
          })}
        </ul>

        <div className="border-t border-border-subtle p-4 flex items-center justify-end gap-2">
          <button
            onClick={onSkip}
            className="px-3 py-1.5 text-xs rounded bg-surface text-secondary hover:text-primary hover:bg-elevated transition-colors"
          >
            Skip
          </button>
          <button
            onClick={() => onScan([...checked])}
            className="px-3 py-1.5 text-xs rounded font-medium bg-flipper text-black hover:bg-flipper/80 transition-colors"
          >
            Scan
            {checked.size > 0 && (
              <span className="ml-1.5 opacity-70">
                (exclude {checked.size})
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Display-format helpers shared across library views.
 */

/**
 * Render a byte count as `B` / `KB` / `MB` with one decimal where it adds
 * useful resolution. Returns `"—"` for zero/negative/non-finite values.
 */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Short relative-time label ("just now" / "Nm ago" / "Nh ago" / "Nd ago").
 * Used for cache-age and last-scanned timestamps in library toolbars.
 */
export function formatRelative(ts: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

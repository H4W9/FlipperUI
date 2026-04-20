export interface AppEntry {
  path: string;
  name: string;
  /** Parent directory name relative to scan root (e.g. "Tools"). */
  category: string | null;
  size: number;
  /** Root this entry was scanned under (e.g. "/ext/apps"). */
  root: string;
  /** File modification time (epoch seconds) from the last scan. */
  mtime: number | null;
}

export interface AppScanProgress {
  scanned: number;
  total: number;
  current_path: string;
}

/**
 * Cached icon for a single app. `icon` is base64-encoded raw XBM bytes
 * (32-byte slot; first 20 used for a 10x10 bitmap), or `null` when we
 * tried to extract and confirmed the app ships without one (so the
 * fetcher doesn't retry on every mount).
 *
 * `mtime` is copied from the AppEntry at fetch time — when the entry's
 * mtime advances past this, the cached icon is invalidated.
 */
export interface AppIconEntry {
  icon: string | null;
  mtime: number | null;
}

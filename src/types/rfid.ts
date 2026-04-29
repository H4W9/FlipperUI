export interface RfidEntry {
  path: string;
  name: string;
  /** Protocol family ("EM4100", "H10301", "Indala26", …) or null. */
  key_type: string | null;
  /** Hex payload as written by stock firmware, e.g. "12 34 56 78 90". */
  data: string | null;
  size: number;
  /** File modification time (epoch seconds) from the last scan. */
  mtime: number | null;
}

export interface RfidScanProgress {
  scanned: number;
  total: number;
  current_path: string;
}

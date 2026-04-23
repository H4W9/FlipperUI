export interface BadUsbEntry {
  path: string;
  name: string;
  /** "usb" for /ext/badusb, "kb" for /ext/badkb. */
  kind: string;
  line_count: number;
  /** Leading REM/# comment line, if any — shown as a blurb in the library table. */
  comment: string | null;
  size: number;
  /** File modification time (epoch seconds) from the last scan. */
  mtime: number | null;
}

export interface BadUsbScanProgress {
  scanned: number;
  total: number;
  current_path: string;
}

export interface NfcEntry {
  path: string;
  name: string;
  /** "UID", "Mifare Classic", "Mifare Ultralight", "NTAG213", etc. */
  device_type: string | null;
  uid: string | null;
  atqa: string | null;
  sak: string | null;
  /** Only populated for Mifare Classic / Ultralight — e.g. "1K", "4K". */
  mifare_type: string | null;
  size: number;
  /** File modification time (epoch seconds) from the last scan. */
  mtime: number | null;
}

export interface NfcScanProgress {
  scanned: number;
  total: number;
  current_path: string;
}

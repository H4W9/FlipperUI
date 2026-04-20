export interface Coordinates {
  lat: number;
  lon: number;
}

export interface SubGhzEntry {
  path: string;
  name: string;
  frequency: number | null;
  preset: string | null;
  protocol: string | null;
  bit: number | null;
  te: number | null;
  key: string | null;
  /** OOK / FM / Unknown — derived from `preset`. */
  modulation: string | null;
  coordinates: Coordinates | null;
  /** True if the file contains a RAW_Data section (full waveform capture). */
  has_raw: boolean;
  /**
   * File modification time (epoch seconds) from the last scan. Used by the
   * on-disk cache to skip re-reading files whose mtime hasn't moved.
   */
  mtime: number | null;
}

export interface ScanProgress {
  scanned: number;
  total: number;
  current_path: string;
}

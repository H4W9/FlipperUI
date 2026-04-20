export interface IrSignal {
  name: string;
  /** "parsed" or "raw" — matches the `type:` key in .ir files. */
  kind: string;
  protocol: string | null;
  address: string | null;
  command: string | null;
  frequency: number | null;
  duty_cycle: number | null;
}

export interface IrEntry {
  path: string;
  name: string;
  signals: IrSignal[];
  /** File modification time (epoch seconds) from the last scan. */
  mtime: number | null;
}

export interface IrScanProgress {
  scanned: number;
  total: number;
  current_path: string;
}

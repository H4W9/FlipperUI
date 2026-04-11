// TypeScript types mirroring Rust serde serialization of generated protobuf types.

export interface PortInfo {
  name: string;
  is_flipper: boolean;
  vid: number | null;
  pid: number | null;
  manufacturer: string | null;
}

export interface DeviceInfo {
  port: string;
  hardware_name: string | null;
  hardware_version: string | null;
  firmware_version: string | null;
  firmware_build_date: string | null;
}

/** Matches commands/storage.rs FileEntry */
export interface FileEntry {
  /** 0 = file, 1 = directory */
  file_type: number;
  name: string;
  size: number;
  md5sum: string;
}

export interface StorageInfo {
  total_space: number;
  free_space: number;
}

//! Sub-GHz library scanning and .sub-file parsing.
//!
//! Walks `/ext/subghz` (or any root) recursively, reads each `.sub` file via
//! the Storage RPC, and parses Flipper's simple `Key: Value` text format into
//! a typed [`SubGhzEntry`]. Excluded paths are skipped during the walk so we
//! never hit the device for files the user doesn't want indexed.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::error::{FlipperError, Result};
use crate::flipper::client::FlipperClient;
use crate::flipper::storage;

/// Coordinates extracted from a .sub file (manual annotations or capture-with-GPS plugins).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Coordinates {
    pub lat: f64,
    pub lon: f64,
}

/// Parsed metadata for a single .sub file. All header fields are optional —
/// RAW captures don't have Bit/Key/TE; some captures omit Protocol or Preset.
/// `mtime` is set by the scan after a successful `storage_timestamp` — the
/// frontend uses it to invalidate cache entries on re-scan.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SubGhzEntry {
    pub path: String,
    pub name: String,
    pub frequency: Option<u32>,
    pub preset: Option<String>,
    pub protocol: Option<String>,
    pub bit: Option<u32>,
    pub te: Option<u32>,
    pub key: Option<String>,
    /// Derived from the preset string (OOK / FM / unknown).
    pub modulation: Option<String>,
    pub coordinates: Option<Coordinates>,
    /// Whether the file contains a RAW_Data section (full waveform capture).
    pub has_raw: bool,
    /// File modification time from `storage_timestamp` (epoch seconds).
    #[serde(default)]
    pub mtime: Option<u32>,
}

/// Progress callback fired after each parsed file. `scanned` ≤ `total`.
pub type ScanProgress<'a> = &'a mut dyn FnMut(u32, u32, &str);

/// Recursively scan `root` for .sub files, parse them, and return the list.
///
/// `excluded` are absolute paths under `root` to skip entirely. `cached` is a
/// map of previously-parsed entries keyed by absolute path; for each path we
/// re-discover on disk, we check `storage_timestamp` and reuse the cached
/// entry when the mtime matches — avoiding a full `storage_read` round-trip.
/// `cancelled` is checked between files so the caller can abort cleanly.
pub fn scan_library(
    client: &mut FlipperClient,
    root: &str,
    excluded: &[String],
    cached: &HashMap<String, SubGhzEntry>,
    cancelled: &Arc<AtomicBool>,
    on_progress: ScanProgress,
) -> Result<Vec<SubGhzEntry>> {
    let mut paths: Vec<String> = Vec::new();
    walk_dir(client, root, excluded, &mut paths)?;

    let total = paths.len() as u32;
    let mut entries = Vec::with_capacity(paths.len());
    let dummy_cancel = Arc::new(AtomicBool::new(false));

    for (idx, path) in paths.iter().enumerate() {
        if cancelled.load(Ordering::Relaxed) {
            return Err(FlipperError::TransferCancelled);
        }
        on_progress(idx as u32, total, path);

        // Cheap path first: if we have a cached entry for this file and its
        // mtime hasn't moved, reuse it without re-reading the file body.
        let current_mtime = storage::storage_timestamp(client, path).ok();
        if let (Some(mtime), Some(cached_entry)) = (current_mtime, cached.get(path)) {
            if cached_entry.mtime == Some(mtime) {
                let mut hit = cached_entry.clone();
                hit.mtime = Some(mtime);
                entries.push(hit);
                continue;
            }
        }

        // Cache miss (new file, mtime changed, or timestamp failed): do the
        // full read + parse. `storage_read` failures are non-fatal — a locked
        // or missing file is skipped so one bad entry can't break the scan.
        let bytes = match storage::storage_read(client, path, |_, _| {}, &dummy_cancel) {
            Ok(b) => b,
            Err(e) => {
                tracing::warn!(?e, %path, "skipping unreadable .sub file");
                continue;
            }
        };

        let text = String::from_utf8_lossy(&bytes);
        let name = file_basename(path).to_string();
        let mut entry = parse_sub(path, &name, &text);
        entry.mtime = current_mtime;
        entries.push(entry);
    }

    on_progress(total, total, "");
    Ok(entries)
}

fn walk_dir(
    client: &mut FlipperClient,
    dir: &str,
    excluded: &[String],
    out: &mut Vec<String>,
) -> Result<()> {
    if is_excluded(dir, excluded) {
        return Ok(());
    }
    let files = storage::storage_list(client, dir)?;
    for f in files {
        let child = join_path(dir, &f.name);
        // pb_storage::FileType::Dir = 1 in the firmware enum.
        if f.r#type == 1 {
            walk_dir(client, &child, excluded, out)?;
        } else if has_sub_extension(&f.name) && !is_excluded(&child, excluded) {
            out.push(child);
        }
    }
    Ok(())
}

fn is_excluded(path: &str, excluded: &[String]) -> bool {
    excluded.iter().any(|ex| {
        let ex = ex.trim_end_matches('/');
        path == ex || path.starts_with(&format!("{ex}/"))
    })
}

fn has_sub_extension(name: &str) -> bool {
    name.len() >= 4 && name[name.len() - 4..].eq_ignore_ascii_case(".sub")
}

fn join_path(parent: &str, child: &str) -> String {
    if parent.ends_with('/') {
        format!("{parent}{child}")
    } else {
        format!("{parent}/{child}")
    }
}

fn file_basename(path: &str) -> &str {
    path.rsplit_once('/').map(|(_, b)| b).unwrap_or(path)
}

/// Parse a .sub file's text body into a [`SubGhzEntry`].
/// Public so unit tests in this file (and future tooling) can hit it directly.
pub fn parse_sub(path: &str, name: &str, text: &str) -> SubGhzEntry {
    let mut frequency = None;
    let mut preset = None;
    let mut protocol = None;
    let mut bit = None;
    let mut te = None;
    let mut key = None;
    let mut has_raw = false;
    let mut lat_explicit: Option<f64> = None;
    let mut lon_explicit: Option<f64> = None;
    let mut coord_pair_fallback: Option<(f64, f64)> = None;

    for line in text.lines() {
        let Some((k, v)) = line.split_once(':') else {
            continue;
        };
        let k = k.trim();
        let v = v.trim();
        if v.is_empty() {
            continue;
        }
        match k {
            "Frequency" => frequency = v.parse::<u32>().ok(),
            "Preset" => preset = Some(v.to_string()),
            "Protocol" => protocol = Some(v.to_string()),
            "Bit" => bit = v.parse::<u32>().ok(),
            "TE" => te = v.parse::<u32>().ok(),
            "Key" => key = Some(v.to_string()),
            "RAW_Data" => has_raw = true,
            "Latitude" | "Lat" => lat_explicit = parse_first_float(v),
            "Longitude" | "Lon" | "Lng" => lon_explicit = parse_first_float(v),
            // Single-line coord fields — Note/Comment/GPS/Coordinates may carry "lat,lon".
            "GPS" | "Coordinates" | "Coords" | "Note" | "Comment" | "Location"
                if coord_pair_fallback.is_none() =>
            {
                coord_pair_fallback = parse_coord_pair(v);
            }
            _ => {}
        }
    }

    let coordinates = match (lat_explicit, lon_explicit) {
        (Some(lat), Some(lon)) if valid_coord(lat, lon) => Some(Coordinates { lat, lon }),
        _ => coord_pair_fallback
            .filter(|(lat, lon)| valid_coord(*lat, *lon))
            .map(|(lat, lon)| Coordinates { lat, lon }),
    };

    let modulation = preset
        .as_deref()
        .map(modulation_from_preset)
        .map(String::from);

    SubGhzEntry {
        path: path.to_string(),
        name: name.to_string(),
        frequency,
        preset,
        protocol,
        bit,
        te,
        key,
        modulation,
        coordinates,
        has_raw,
        mtime: None,
    }
}

/// Map a Flipper preset string to a coarse modulation label.
fn modulation_from_preset(preset: &str) -> &'static str {
    let p = preset.to_ascii_lowercase();
    if p.contains("ook") {
        "OOK"
    } else if p.contains("fm") {
        "FM"
    } else {
        "Unknown"
    }
}

fn parse_first_float(s: &str) -> Option<f64> {
    // Strip a trailing N/S/E/W suffix if present (e.g. "48.8584 N").
    let cleaned = s.trim().trim_end_matches(|c: char| {
        c.eq_ignore_ascii_case(&'N')
            || c.eq_ignore_ascii_case(&'S')
            || c.eq_ignore_ascii_case(&'E')
            || c.eq_ignore_ascii_case(&'W')
            || c.is_whitespace()
    });
    cleaned.split_whitespace().next()?.parse::<f64>().ok()
}

/// Parse the first two floats out of a string, separated by comma/space/semicolon.
fn parse_coord_pair(s: &str) -> Option<(f64, f64)> {
    let mut floats = s
        .split(|c: char| c == ',' || c == ';' || c.is_whitespace())
        .filter_map(|tok| tok.trim().parse::<f64>().ok());
    Some((floats.next()?, floats.next()?))
}

fn valid_coord(lat: f64, lon: f64) -> bool {
    (-90.0..=90.0).contains(&lat) && (-180.0..=180.0).contains(&lon) && !(lat == 0.0 && lon == 0.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_standard_keyfile() {
        let text = "\
Filetype: Flipper SubGhz Key File
Version: 1
Frequency: 433920000
Preset: FuriHalSubGhzPresetOok650Async
Protocol: Princeton
Bit: 24
Key: 00 00 00 00 00 AB CD EF
TE: 400
";
        let e = parse_sub("/ext/subghz/foo.sub", "foo.sub", text);
        assert_eq!(e.frequency, Some(433_920_000));
        assert_eq!(e.preset.as_deref(), Some("FuriHalSubGhzPresetOok650Async"));
        assert_eq!(e.protocol.as_deref(), Some("Princeton"));
        assert_eq!(e.bit, Some(24));
        assert_eq!(e.te, Some(400));
        assert_eq!(e.modulation.as_deref(), Some("OOK"));
        assert!(!e.has_raw);
        assert!(e.coordinates.is_none());
    }

    #[test]
    fn parses_raw_capture() {
        let text = "Filetype: Flipper SubGhz RAW File\nFrequency: 868350000\nPreset: FuriHalSubGhzPresetFmDev2_38Async\nProtocol: RAW\nRAW_Data: 100 -200 100 -200\n";
        let e = parse_sub("/ext/subghz/r.sub", "r.sub", text);
        assert_eq!(e.protocol.as_deref(), Some("RAW"));
        assert_eq!(e.modulation.as_deref(), Some("FM"));
        assert!(e.has_raw);
        assert!(e.bit.is_none());
    }

    #[test]
    fn extracts_explicit_coords() {
        let text = "Frequency: 433920000\nLatitude: 48.8584\nLongitude: 2.2945\n";
        let e = parse_sub("/p", "n", text);
        let c = e.coordinates.expect("coords parsed");
        assert!((c.lat - 48.8584).abs() < 1e-6);
        assert!((c.lon - 2.2945).abs() < 1e-6);
    }

    #[test]
    fn extracts_pair_from_note_field() {
        let text = "Frequency: 433920000\nNote: GPS 48.8584, 2.2945 - eiffel\n";
        let e = parse_sub("/p", "n", text);
        let c = e.coordinates.expect("coords parsed from note");
        assert!((c.lat - 48.8584).abs() < 1e-6);
        assert!((c.lon - 2.2945).abs() < 1e-6);
    }

    #[test]
    fn rejects_invalid_coords() {
        let text = "Latitude: 999\nLongitude: 0\n";
        let e = parse_sub("/p", "n", text);
        assert!(e.coordinates.is_none());
    }

    #[test]
    fn excluded_path_logic() {
        let excluded = vec!["/ext/subghz/private".to_string()];
        assert!(is_excluded("/ext/subghz/private", &excluded));
        assert!(is_excluded("/ext/subghz/private/x.sub", &excluded));
        assert!(!is_excluded("/ext/subghz/public/x.sub", &excluded));
        assert!(!is_excluded("/ext/subghz/private2", &excluded));
    }
}

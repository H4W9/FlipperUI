//! NFC library scanning and `.nfc`-file parsing.
//!
//! Walks `/ext/nfc` recursively, reads each `.nfc` file via the Storage RPC,
//! and parses Flipper's text key-value header into a typed [`NfcEntry`].
//!
//! Stock firmware serializes `.nfc` files as:
//!
//! ```text
//! Filetype: Flipper NFC device
//! Version: 4
//! Device type: Mifare Classic
//! UID: 04 AA BB CC DD EE FF
//! ATQA: 00 44
//! SAK: 08
//! Mifare Classic type: 1K
//! # ...block data follows
//! ```
//!
//! We only read the header — the block/page payload can be 1KB+ and isn't
//! useful for the library view (the file size covers that need).

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::error::{FlipperError, Result};
use crate::flipper::client::FlipperClient;
use crate::flipper::storage;

/// Parsed metadata for a single `.nfc` file.
///
/// `device_type` is the high-level technology reported by stock firmware —
/// "UID", "Mifare Ultralight", "Mifare Classic", "Mifare DESFire",
/// "NTAG21x", "Bank card", etc. The `mifare_type` sub-field is only
/// populated for Mifare Classic files (e.g. "1K" / "4K") since that's the
/// only family where the capacity is encoded separately from the top-level
/// device type.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NfcEntry {
    pub path: String,
    pub name: String,
    pub device_type: Option<String>,
    pub uid: Option<String>,
    pub atqa: Option<String>,
    pub sak: Option<String>,
    pub mifare_type: Option<String>,
    pub size: u32,
    #[serde(default)]
    pub mtime: Option<u32>,
}

/// Progress callback fired after each parsed file. `scanned` ≤ `total`.
pub type ScanProgress<'a> = &'a mut dyn FnMut(u32, u32, &str);

/// Recursively scan `root` for `.nfc` files, parse them, and return the list.
/// Mirrors [`crate::flipper::infrared::scan_library`] — mtime-based cache
/// hits skip re-reads over serial.
pub fn scan_library(
    client: &mut FlipperClient,
    root: &str,
    excluded: &[String],
    cached: &HashMap<String, NfcEntry>,
    cancelled: &Arc<AtomicBool>,
    on_progress: ScanProgress,
) -> Result<Vec<NfcEntry>> {
    let mut files: Vec<(String, u32)> = Vec::new();
    walk_dir(client, root, excluded, &mut files)?;

    let total = files.len() as u32;
    let mut entries = Vec::with_capacity(files.len());
    let dummy_cancel = Arc::new(AtomicBool::new(false));

    for (idx, (path, size)) in files.iter().enumerate() {
        if cancelled.load(Ordering::Relaxed) {
            return Err(FlipperError::TransferCancelled);
        }
        on_progress(idx as u32, total, path);

        let current_mtime = storage::storage_timestamp(client, path).ok();
        if let (Some(mtime), Some(cached_entry)) = (current_mtime, cached.get(path)) {
            if cached_entry.mtime == Some(mtime) && cached_entry.size == *size {
                let mut hit = cached_entry.clone();
                hit.mtime = Some(mtime);
                hit.size = *size;
                entries.push(hit);
                continue;
            }
        }

        let bytes = match storage::storage_read(client, path, |_, _| {}, &dummy_cancel) {
            Ok(b) => b,
            Err(e) => {
                tracing::warn!(?e, %path, "skipping unreadable .nfc file");
                continue;
            }
        };

        let text = String::from_utf8_lossy(&bytes);
        let name = file_basename(path).to_string();
        let mut entry = parse_nfc(path, &name, &text);
        entry.size = *size;
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
    out: &mut Vec<(String, u32)>,
) -> Result<()> {
    if is_excluded(dir, excluded) {
        return Ok(());
    }
    let files = storage::storage_list(client, dir)?;
    for f in files {
        let child = join_path(dir, &f.name);
        if f.r#type == 1 {
            walk_dir(client, &child, excluded, out)?;
        } else if has_nfc_extension(&f.name) && !is_excluded(&child, excluded) {
            out.push((child, f.size));
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

fn has_nfc_extension(name: &str) -> bool {
    name.len() >= 4 && name[name.len() - 4..].eq_ignore_ascii_case(".nfc")
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

/// Parse a `.nfc` file's text header. Stops scanning once we've seen the
/// keys we care about — block data can be KBs and we don't need it for
/// library rows.
pub fn parse_nfc(path: &str, name: &str, text: &str) -> NfcEntry {
    let mut entry = NfcEntry {
        path: path.to_string(),
        name: name.to_string(),
        device_type: None,
        uid: None,
        atqa: None,
        sak: None,
        mifare_type: None,
        size: 0,
        mtime: None,
    };

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let Some((k, v)) = trimmed.split_once(':') else {
            continue;
        };
        let k = k.trim();
        let v = v.trim();
        if v.is_empty() {
            continue;
        }

        // Key matching is case-insensitive — firmware capitalizes "Device type"
        // vs "UID" inconsistently and community forks drift further.
        let kl = k.to_ascii_lowercase();
        match kl.as_str() {
            "device type" => entry.device_type = Some(v.to_string()),
            "uid" => entry.uid = Some(v.to_string()),
            "atqa" => entry.atqa = Some(v.to_string()),
            "sak" => entry.sak = Some(v.to_string()),
            "mifare classic type" | "mifare ultralight type" => {
                entry.mifare_type = Some(v.to_string());
            }
            _ => {}
        }

        // Early exit once we've collected everything the library needs and
        // we're about to enter the Block/Page data region. Those can add
        // hundreds of lines to parse through for no gain.
        if kl.starts_with("block ") || kl.starts_with("page ") {
            break;
        }
    }

    entry
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_mifare_classic_header() {
        let text = "\
Filetype: Flipper NFC device
Version: 4
# Nfc device type can be UID, Mifare Ultralight, Mifare Classic, Bank card
Device type: Mifare Classic
# UID, ATQA and SAK are common for all formats
UID: 04 AA BB CC DD EE FF
ATQA: 00 44
SAK: 08
# Mifare Classic specific data
Mifare Classic type: 1K
Data format version: 2
Block 0: 04 AA BB CC DD EE FF 08 04 00 01 64 00 00 00 00
";
        let e = parse_nfc("/ext/nfc/card.nfc", "card.nfc", text);
        assert_eq!(e.device_type.as_deref(), Some("Mifare Classic"));
        assert_eq!(e.uid.as_deref(), Some("04 AA BB CC DD EE FF"));
        assert_eq!(e.atqa.as_deref(), Some("00 44"));
        assert_eq!(e.sak.as_deref(), Some("08"));
        assert_eq!(e.mifare_type.as_deref(), Some("1K"));
    }

    #[test]
    fn parses_ntag_header() {
        let text = "\
Filetype: Flipper NFC device
Version: 4
Device type: NTAG213
UID: 04 01 02 03 04 05 06
ATQA: 00 44
SAK: 00
Page 0: 04 01 02 03
";
        let e = parse_nfc("/ext/nfc/tag.nfc", "tag.nfc", text);
        assert_eq!(e.device_type.as_deref(), Some("NTAG213"));
        assert_eq!(e.uid.as_deref(), Some("04 01 02 03 04 05 06"));
        assert!(e.mifare_type.is_none());
    }

    #[test]
    fn missing_fields_are_none() {
        let text = "Filetype: Flipper NFC device\nVersion: 4\n";
        let e = parse_nfc("/p", "n", text);
        assert!(e.device_type.is_none());
        assert!(e.uid.is_none());
        assert!(e.atqa.is_none());
        assert!(e.sak.is_none());
    }

    #[test]
    fn case_insensitive_keys() {
        let text = "device type: UID\nuid: DE AD BE EF\n";
        let e = parse_nfc("/p", "n", text);
        assert_eq!(e.device_type.as_deref(), Some("UID"));
        assert_eq!(e.uid.as_deref(), Some("DE AD BE EF"));
    }

    #[test]
    fn nfc_extension_match() {
        assert!(has_nfc_extension("foo.nfc"));
        assert!(has_nfc_extension("foo.NFC"));
        assert!(!has_nfc_extension("foo.nf"));
        assert!(!has_nfc_extension("nfc"));
        assert!(has_nfc_extension("a.nfc"));
    }

    #[test]
    fn excluded_path_logic() {
        let excluded = vec!["/ext/nfc/private".to_string()];
        assert!(is_excluded("/ext/nfc/private", &excluded));
        assert!(is_excluded("/ext/nfc/private/x.nfc", &excluded));
        assert!(!is_excluded("/ext/nfc/public/x.nfc", &excluded));
    }
}

//! Pre-scan directory size/density walk.
//!
//! Runs before a real library scan to surface directories that are likely to
//! make the scan slow or hostile: the Flipper FatFS exposes a per-directory
//! entry-count ceiling around 254, and individual files past ~1 MiB read very
//! slowly over BLE. The frontend uses the flagged set to ask the user which
//! directories to exclude before kicking off the full scan.
//!
//! This module only issues `StorageList` calls — no file contents are read.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::Serialize;

use crate::error::{FlipperError, Result};
use crate::flipper::client::FlipperClient;
use crate::flipper::library_walk::{self, ScanProgress};
use crate::flipper::storage;

/// Directory direct-children cap on the Flipper FatFS. Stock firmware
/// degrades sharply once a directory crosses this; 254 is the common ceiling
/// reported on qFlipper and the Flipper Zero docs.
pub const MAX_DIR_ENTRIES: u32 = 254;
/// File-size threshold for flagging a directory because of an outsized child.
/// 1 MiB picks up the rare-but-painful BadUSB scripts, large `.fap`s, and
/// experimental Sub-GHz captures without flooding the modal with mundane files.
pub const LARGE_FILE_BYTES: u64 = 1_048_576;

/// One row in the prewalk result. A single directory may be flagged for one
/// or both reasons (entry count, or having a >1 MiB file inside it).
#[derive(Clone, Debug, Serialize)]
pub struct DirStat {
    pub path: String,
    pub entry_count: u32,
    /// Largest file directly inside this directory (None when the dir has no
    /// files, only subdirs).
    pub largest_file: Option<LargestFile>,
}

#[derive(Clone, Debug, Serialize)]
pub struct LargestFile {
    pub name: String,
    pub size: u64,
}

/// Walk every root recursively, collecting one [`DirStat`] per directory.
/// Subtrees matching `excluded` are skipped entirely.
pub fn prewalk(
    client: &mut FlipperClient,
    roots: &[&str],
    excluded: &[String],
    cancelled: &Arc<AtomicBool>,
    on_progress: ScanProgress,
) -> Result<Vec<DirStat>> {
    let mut out = Vec::new();
    let mut visited: u32 = 0;
    for root in roots {
        walk(
            client,
            root,
            excluded,
            cancelled,
            &mut visited,
            on_progress,
            &mut out,
        )?;
    }
    on_progress(visited, visited, "");
    Ok(out)
}

/// Filter a full prewalk result down to the rows the modal cares about.
pub fn flagged(stats: Vec<DirStat>) -> Vec<DirStat> {
    stats
        .into_iter()
        .filter(|s| {
            s.entry_count >= MAX_DIR_ENTRIES
                || s.largest_file
                    .as_ref()
                    .is_some_and(|f| f.size > LARGE_FILE_BYTES)
        })
        .collect()
}

fn walk(
    client: &mut FlipperClient,
    dir: &str,
    excluded: &[String],
    cancelled: &Arc<AtomicBool>,
    visited: &mut u32,
    on_progress: ScanProgress,
    out: &mut Vec<DirStat>,
) -> Result<()> {
    if cancelled.load(Ordering::Relaxed) {
        return Err(FlipperError::TransferCancelled);
    }
    if library_walk::is_excluded(dir, excluded) {
        return Ok(());
    }

    // `storage_list` here can legitimately fail when a root doesn't exist on
    // this device (e.g. a user with no /ext/nfc folder). Treat the directory
    // as empty rather than aborting the whole prewalk.
    let files = match storage::storage_list(client, dir) {
        Ok(f) => f,
        Err(e) => {
            tracing::warn!(?e, %dir, "prewalk: skipping unreadable directory");
            return Ok(());
        }
    };

    *visited = visited.saturating_add(1);
    on_progress(*visited, 0, dir);

    let mut entry_count: u32 = 0;
    let mut largest: Option<LargestFile> = None;
    let mut subdirs: Vec<String> = Vec::new();

    for f in &files {
        entry_count = entry_count.saturating_add(1);
        if f.r#type == 1 {
            // Subdirectory — recurse later (after we've recorded this dir's stats).
            match library_walk::join_path(dir, &f.name) {
                Ok(child) => subdirs.push(child),
                Err(e) => {
                    tracing::warn!(?e, %dir, name = %f.name, "prewalk: invalid child name");
                }
            }
        } else {
            let size = f.size as u64;
            if largest.as_ref().is_none_or(|cur| size > cur.size) {
                largest = Some(LargestFile {
                    name: f.name.clone(),
                    size,
                });
            }
        }
    }

    out.push(DirStat {
        path: dir.to_string(),
        entry_count,
        largest_file: largest,
    });

    for child in subdirs {
        walk(
            client,
            &child,
            excluded,
            cancelled,
            visited,
            on_progress,
            out,
        )?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir(path: &str, entry_count: u32, largest_size: Option<u64>) -> DirStat {
        DirStat {
            path: path.to_string(),
            entry_count,
            largest_file: largest_size.map(|size| LargestFile {
                name: "x".to_string(),
                size,
            }),
        }
    }

    #[test]
    fn flagged_picks_dense_dirs() {
        let stats = vec![
            dir("/a", MAX_DIR_ENTRIES, None),
            dir("/b", MAX_DIR_ENTRIES - 1, None),
        ];
        let out = flagged(stats);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].path, "/a");
    }

    #[test]
    fn flagged_picks_large_file_dirs() {
        let stats = vec![
            dir("/a", 5, Some(LARGE_FILE_BYTES + 1)),
            dir("/b", 5, Some(LARGE_FILE_BYTES)),
            dir("/c", 5, None),
        ];
        let out = flagged(stats);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].path, "/a");
    }

    #[test]
    fn flagged_picks_dirs_meeting_either_condition() {
        let stats = vec![
            dir("/dense", MAX_DIR_ENTRIES + 10, Some(100)),
            dir("/heavy", 3, Some(LARGE_FILE_BYTES * 4)),
            dir("/quiet", 10, Some(1024)),
        ];
        let out = flagged(stats);
        assert_eq!(out.len(), 2);
        assert!(out.iter().any(|s| s.path == "/dense"));
        assert!(out.iter().any(|s| s.path == "/heavy"));
    }
}

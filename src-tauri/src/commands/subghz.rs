use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::error::{FlipperError, Result};
use crate::flipper::subghz::{self, SubGhzEntry};
use crate::state::{AppState, ConnectionMode};

fn validate_root(path: &str) -> Result<()> {
    if path.contains("..") {
        return Err(FlipperError::Session(
            "Path traversal (..) is not allowed".into(),
        ));
    }
    if !path.starts_with("/ext") && !path.starts_with("/int") && !path.starts_with("/any") {
        return Err(FlipperError::Session(
            "Path must start with /ext, /int, or /any".into(),
        ));
    }
    Ok(())
}

#[derive(Serialize, Clone)]
struct ScanProgress<'a> {
    scanned: u32,
    total: u32,
    current_path: &'a str,
}

/// Recursively scan a directory for .sub files and parse their headers.
///
/// `cached` is an optional list of previously-parsed entries (with mtime)
/// from the frontend's on-disk cache. When supplied, files whose mtime
/// hasn't moved are reused from cache instead of being re-read over serial.
///
/// Emits `subghz-scan-progress` events with `{ scanned, total, current_path }`
/// after each file. Returns the full list once the walk completes (or
/// `TransferCancelled` if the frontend called [`subghz_cancel_scan`]).
#[tauri::command(rename_all = "snake_case")]
pub async fn subghz_scan(
    root: String,
    excluded_dirs: Vec<String>,
    cached: Option<Vec<SubGhzEntry>>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Vec<SubGhzEntry>> {
    let client_mutex = Arc::clone(&state.client);
    let mode_mutex = Arc::clone(&state.mode);
    let cancelled = Arc::clone(&state.subghz_scan_cancelled);
    cancelled.store(false, Ordering::Relaxed);

    tauri::async_runtime::spawn_blocking(move || {
        validate_root(&root)?;
        {
            let mode = mode_mutex.lock().unwrap();
            if *mode == ConnectionMode::Cli {
                return Err(FlipperError::CliModeActive);
            }
        }
        let mut guard = client_mutex.lock().unwrap();
        let client = guard.as_mut().ok_or(FlipperError::NotConnected)?;

        let cached_map: HashMap<String, SubGhzEntry> = cached
            .unwrap_or_default()
            .into_iter()
            .map(|e| (e.path.clone(), e))
            .collect();

        let mut on_progress = |scanned: u32, total: u32, current: &str| {
            let _ = app.emit(
                "subghz-scan-progress",
                ScanProgress {
                    scanned,
                    total,
                    current_path: current,
                },
            );
        };

        subghz::scan_library(
            client,
            &root,
            &excluded_dirs,
            &cached_map,
            &cancelled,
            &mut on_progress,
        )
    })
    .await
    .map_err(|e| FlipperError::Internal(e.to_string()))?
}

/// Abort an in-progress SubGhz library scan.
/// The scan loop checks the flag between files and returns `TransferCancelled`.
#[tauri::command]
pub fn subghz_cancel_scan(state: State<AppState>) -> Result<()> {
    state.subghz_scan_cancelled.store(true, Ordering::Relaxed);
    Ok(())
}

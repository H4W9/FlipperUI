use std::sync::atomic::Ordering;
use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::commands::library_scan::run_library_scan;
use crate::error::{FlipperError, Result};
use crate::flipper::subghz::{self, SubGhzEntry};
use crate::state::AppState;

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
        run_library_scan(
            client_mutex,
            mode_mutex,
            cancelled,
            app,
            &[&root],
            "subghz-scan-progress",
            cached,
            |e| e.path.clone(),
            |client, cached_map, cancelled, on_progress| {
                subghz::scan_library(
                    client,
                    &root,
                    &excluded_dirs,
                    cached_map,
                    cancelled,
                    on_progress,
                )
            },
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

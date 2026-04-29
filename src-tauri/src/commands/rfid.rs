use std::sync::atomic::Ordering;
use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::commands::library_scan::run_library_scan;
use crate::error::{FlipperError, Result};
use crate::flipper::rfid::{self, RfidEntry};
use crate::state::{AppState, ConnectionMode};

/// Recursively scan a directory for `.rfid` files and parse their headers.
/// Emits `rfid-scan-progress` events as it works.
#[tauri::command(rename_all = "snake_case")]
pub async fn rfid_scan(
    root: String,
    excluded_dirs: Vec<String>,
    cached: Option<Vec<RfidEntry>>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Vec<RfidEntry>> {
    let client_mutex = Arc::clone(&state.client);
    let mode_mutex = Arc::clone(&state.mode);
    let cancelled = Arc::clone(&state.rfid_scan_cancelled);
    cancelled.store(false, Ordering::Relaxed);

    tauri::async_runtime::spawn_blocking(move || {
        run_library_scan(
            client_mutex,
            mode_mutex,
            cancelled,
            app,
            &[&root],
            "rfid-scan-progress",
            cached,
            |e| e.path.clone(),
            |client, cached_map, cancelled, on_progress| {
                rfid::scan_library(
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

#[tauri::command]
pub fn rfid_cancel_scan(state: State<AppState>) -> Result<()> {
    state.rfid_scan_cancelled.store(true, Ordering::Relaxed);
    Ok(())
}

/// Parse a specific list of `.rfid` paths without walking the library.
#[tauri::command(rename_all = "snake_case")]
pub async fn rfid_parse_paths(
    paths: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Vec<RfidEntry>> {
    let client_mutex = Arc::clone(&state.client);
    let mode_mutex = Arc::clone(&state.mode);

    tauri::async_runtime::spawn_blocking(move || {
        {
            let mode = mode_mutex.lock().unwrap();
            if *mode == ConnectionMode::Cli {
                return Err(FlipperError::CliModeActive);
            }
        }
        let mut guard = client_mutex.lock().unwrap();
        let client = guard.as_mut().ok_or(FlipperError::NotConnected)?;
        rfid::parse_paths(client, &paths)
    })
    .await
    .map_err(|e| FlipperError::Internal(e.to_string()))?
}

use std::sync::atomic::Ordering;
use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::commands::library_scan::run_library_scan;
use crate::error::{FlipperError, Result};
use crate::flipper::nfc::{self, NfcEntry};
use crate::state::AppState;

/// Recursively scan a directory for `.nfc` files and parse their headers.
/// Emits `nfc-scan-progress` events as it works.
#[tauri::command(rename_all = "snake_case")]
pub async fn nfc_scan(
    root: String,
    excluded_dirs: Vec<String>,
    cached: Option<Vec<NfcEntry>>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Vec<NfcEntry>> {
    let client_mutex = Arc::clone(&state.client);
    let mode_mutex = Arc::clone(&state.mode);
    let cancelled = Arc::clone(&state.nfc_scan_cancelled);
    cancelled.store(false, Ordering::Relaxed);

    tauri::async_runtime::spawn_blocking(move || {
        run_library_scan(
            client_mutex,
            mode_mutex,
            cancelled,
            app,
            &[&root],
            "nfc-scan-progress",
            cached,
            |e| e.path.clone(),
            |client, cached_map, cancelled, on_progress| {
                nfc::scan_library(
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
pub fn nfc_cancel_scan(state: State<AppState>) -> Result<()> {
    state.nfc_scan_cancelled.store(true, Ordering::Relaxed);
    Ok(())
}

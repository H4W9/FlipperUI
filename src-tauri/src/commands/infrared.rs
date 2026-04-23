use std::sync::atomic::Ordering;
use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::commands::library_scan::run_library_scan;
use crate::error::{FlipperError, Result};
use crate::flipper::infrared::{self, IrEntry};
use crate::state::AppState;

/// Recursively scan a directory for .ir files and parse their signal blocks.
/// Emits `infrared-scan-progress` events as it works.
#[tauri::command(rename_all = "snake_case")]
pub async fn infrared_scan(
    root: String,
    excluded_dirs: Vec<String>,
    cached: Option<Vec<IrEntry>>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Vec<IrEntry>> {
    let client_mutex = Arc::clone(&state.client);
    let mode_mutex = Arc::clone(&state.mode);
    let cancelled = Arc::clone(&state.ir_scan_cancelled);
    cancelled.store(false, Ordering::Relaxed);

    tauri::async_runtime::spawn_blocking(move || {
        run_library_scan(
            client_mutex,
            mode_mutex,
            cancelled,
            app,
            &[&root],
            "infrared-scan-progress",
            cached,
            |e| e.path.clone(),
            |client, cached_map, cancelled, on_progress| {
                infrared::scan_library(
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
pub fn infrared_cancel_scan(state: State<AppState>) -> Result<()> {
    state.ir_scan_cancelled.store(true, Ordering::Relaxed);
    Ok(())
}

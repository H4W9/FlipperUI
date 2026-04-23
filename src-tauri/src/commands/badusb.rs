use std::sync::atomic::Ordering;
use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::commands::library_scan::run_library_scan;
use crate::error::{FlipperError, Result};
use crate::flipper::badusb::{self, BadUsbEntry};
use crate::state::AppState;

/// Recursively scan `/ext/badusb` and `/ext/badkb` for `.txt` Duckyscript
/// files, parse their line counts + leading comments, and return the combined
/// list. Emits `badusb-scan-progress` events as it works.
#[tauri::command(rename_all = "snake_case")]
pub async fn badusb_scan(
    usb_root: String,
    kb_root: String,
    excluded_dirs: Vec<String>,
    cached: Option<Vec<BadUsbEntry>>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Vec<BadUsbEntry>> {
    let client_mutex = Arc::clone(&state.client);
    let mode_mutex = Arc::clone(&state.mode);
    let cancelled = Arc::clone(&state.badusb_scan_cancelled);
    cancelled.store(false, Ordering::Relaxed);

    tauri::async_runtime::spawn_blocking(move || {
        run_library_scan(
            client_mutex,
            mode_mutex,
            cancelled,
            app,
            &[&usb_root, &kb_root],
            "badusb-scan-progress",
            cached,
            |e| e.path.clone(),
            |client, cached_map, cancelled, on_progress| {
                let roots: &[(&str, &str)] =
                    &[(usb_root.as_str(), "usb"), (kb_root.as_str(), "kb")];
                badusb::scan_library(
                    client,
                    roots,
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
pub fn badusb_cancel_scan(state: State<AppState>) -> Result<()> {
    state.badusb_scan_cancelled.store(true, Ordering::Relaxed);
    Ok(())
}

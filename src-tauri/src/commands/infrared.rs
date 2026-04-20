use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::error::{FlipperError, Result};
use crate::flipper::infrared::{self, IrEntry};
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
        validate_root(&root)?;
        {
            let mode = mode_mutex.lock().unwrap();
            if *mode == ConnectionMode::Cli {
                return Err(FlipperError::CliModeActive);
            }
        }
        let mut guard = client_mutex.lock().unwrap();
        let client = guard.as_mut().ok_or(FlipperError::NotConnected)?;

        let cached_map: HashMap<String, IrEntry> = cached
            .unwrap_or_default()
            .into_iter()
            .map(|e| (e.path.clone(), e))
            .collect();

        let mut on_progress = |scanned: u32, total: u32, current: &str| {
            let _ = app.emit(
                "infrared-scan-progress",
                ScanProgress {
                    scanned,
                    total,
                    current_path: current,
                },
            );
        };

        infrared::scan_library(
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

#[tauri::command]
pub fn infrared_cancel_scan(state: State<AppState>) -> Result<()> {
    state.ir_scan_cancelled.store(true, Ordering::Relaxed);
    Ok(())
}

use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::error::{FlipperError, Result};
use crate::flipper::badusb::{self, BadUsbEntry};
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
        validate_root(&usb_root)?;
        validate_root(&kb_root)?;
        {
            let mode = mode_mutex.lock().unwrap();
            if *mode == ConnectionMode::Cli {
                return Err(FlipperError::CliModeActive);
            }
        }
        let mut guard = client_mutex.lock().unwrap();
        let client = guard.as_mut().ok_or(FlipperError::NotConnected)?;

        let cached_map: HashMap<String, BadUsbEntry> = cached
            .unwrap_or_default()
            .into_iter()
            .map(|e| (e.path.clone(), e))
            .collect();

        let mut on_progress = |scanned: u32, total: u32, current: &str| {
            let _ = app.emit(
                "badusb-scan-progress",
                ScanProgress {
                    scanned,
                    total,
                    current_path: current,
                },
            );
        };

        let roots: &[(&str, &str)] = &[(usb_root.as_str(), "usb"), (kb_root.as_str(), "kb")];
        badusb::scan_library(
            client,
            roots,
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
pub fn badusb_cancel_scan(state: State<AppState>) -> Result<()> {
    state.badusb_scan_cancelled.store(true, Ordering::Relaxed);
    Ok(())
}

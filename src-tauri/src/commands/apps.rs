use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::error::{FlipperError, Result};
use crate::flipper::apps::{self, AppEntry};
use crate::flipper::{fap_icon, storage};
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

/// Scan one or more roots for `.fap` files and return a parsed list.
/// Emits `apps-scan-progress` events as it works.
#[tauri::command(rename_all = "snake_case")]
pub async fn apps_scan(
    roots: Vec<String>,
    excluded_dirs: Vec<String>,
    cached: Option<Vec<AppEntry>>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Vec<AppEntry>> {
    let client_mutex = Arc::clone(&state.client);
    let mode_mutex = Arc::clone(&state.mode);
    let cancelled = Arc::clone(&state.apps_scan_cancelled);
    cancelled.store(false, Ordering::Relaxed);

    tauri::async_runtime::spawn_blocking(move || {
        for r in &roots {
            validate_root(r)?;
        }
        {
            let mode = mode_mutex.lock().unwrap();
            if *mode == ConnectionMode::Cli {
                return Err(FlipperError::CliModeActive);
            }
        }
        let mut guard = client_mutex.lock().unwrap();
        let client = guard.as_mut().ok_or(FlipperError::NotConnected)?;

        let cached_map: HashMap<String, AppEntry> = cached
            .unwrap_or_default()
            .into_iter()
            .map(|e| (e.path.clone(), e))
            .collect();

        let mut on_progress = |scanned: u32, total: u32, current: &str| {
            let _ = app.emit(
                "apps-scan-progress",
                ScanProgress {
                    scanned,
                    total,
                    current_path: current,
                },
            );
        };

        apps::scan_library(
            client,
            &roots,
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
pub fn apps_cancel_scan(state: State<AppState>) -> Result<()> {
    state.apps_scan_cancelled.store(true, Ordering::Relaxed);
    Ok(())
}

/// Read a `.fap` and extract its embedded 10x10 icon, returned as
/// base64-encoded raw XBM bytes (32-byte icon slot; only the first 20 are
/// the 10x10 bitmap, the rest is padding).
///
/// Returns `Ok(None)` when the file has no embedded icon (or the manifest
/// can't be located) — the UI then falls back to the placeholder glyph.
#[tauri::command(rename_all = "snake_case")]
pub async fn apps_read_icon(path: String, state: State<'_, AppState>) -> Result<Option<String>> {
    if !path.to_lowercase().ends_with(".fap") {
        return Err(FlipperError::Session("Not a .fap file".into()));
    }

    let client_mutex = Arc::clone(&state.client);
    let mode_mutex = Arc::clone(&state.mode);
    // Use a local (unshared) cancel flag so a user-initiated transfer-cancel
    // in the File Browser doesn't kill icon prefetches, and vice versa.
    let cancelled = Arc::new(AtomicBool::new(false));

    tauri::async_runtime::spawn_blocking(move || {
        {
            let mode = mode_mutex.lock().unwrap();
            if *mode == ConnectionMode::Cli {
                return Err(FlipperError::CliModeActive);
            }
        }
        let mut guard = client_mutex.lock().unwrap();
        let client = guard.as_mut().ok_or(FlipperError::NotConnected)?;

        let bytes = storage::storage_read(client, &path, |_, _| {}, &cancelled)?;
        let icon = fap_icon::extract(&bytes)
            .map(|d| base64::engine::general_purpose::STANDARD.encode(d.icon));
        Ok(icon)
    })
    .await
    .map_err(|e| FlipperError::Internal(e.to_string()))?
}

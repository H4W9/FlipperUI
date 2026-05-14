//! Tauri command for the pre-scan directory size/density walk.
//!
//! Frontend flow: each library view calls `library_prewalk` first; if the
//! returned list is non-empty the user picks dirs to add to the persistent
//! exclusion list, then the real scan starts. See
//! [`crate::flipper::library_prewalk`] for the walker itself.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::error::{FlipperError, Result};
use crate::flipper::library_prewalk::{self, DirStat};
use crate::state::{AppState, ConnectionMode};

/// Which library the prewalk is being run for. Used purely to route to the
/// existing per-library cancel flag — the prewalk itself is library-agnostic.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PrewalkLibrary {
    Subghz,
    Infrared,
    Nfc,
    Rfid,
    Badusb,
}

#[derive(Serialize, Clone)]
struct PrewalkProgressEvent<'a> {
    visited: u32,
    current_path: &'a str,
}

/// Walk `roots` recursively, returning only the directories that crossed the
/// entry-count or large-file thresholds. Emits `library-prewalk-progress`
/// events so the UI can show motion during slow (BLE) walks.
#[tauri::command(rename_all = "snake_case")]
pub async fn library_prewalk(
    library: PrewalkLibrary,
    roots: Vec<String>,
    excluded_dirs: Vec<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Vec<DirStat>> {
    let client_mutex = Arc::clone(&state.client);
    let mode_mutex = Arc::clone(&state.mode);
    let cancelled = cancel_flag_for(library, &state);
    cancelled.store(false, Ordering::Relaxed);

    tauri::async_runtime::spawn_blocking(move || {
        prewalk_blocking(client_mutex, mode_mutex, cancelled, app, roots, excluded_dirs)
    })
    .await
    .map_err(|e| FlipperError::Internal(e.to_string()))?
}

fn prewalk_blocking(
    client_mutex: Arc<Mutex<Option<crate::flipper::client::FlipperClient>>>,
    mode_mutex: Arc<Mutex<ConnectionMode>>,
    cancelled: Arc<AtomicBool>,
    app: AppHandle,
    roots: Vec<String>,
    excluded_dirs: Vec<String>,
) -> Result<Vec<DirStat>> {
    for root in &roots {
        crate::commands::path::validate_path(root)?;
    }
    {
        let mode = mode_mutex.lock().unwrap();
        if *mode == ConnectionMode::Cli {
            return Err(FlipperError::CliModeActive);
        }
    }

    let mut guard = client_mutex.lock().unwrap();
    let client = guard.as_mut().ok_or(FlipperError::NotConnected)?;

    let mut on_progress = |visited: u32, _total: u32, current: &str| {
        let _ = app.emit(
            "library-prewalk-progress",
            PrewalkProgressEvent {
                visited,
                current_path: current,
            },
        );
    };

    let root_refs: Vec<&str> = roots.iter().map(String::as_str).collect();
    let stats = library_prewalk::prewalk(
        client,
        &root_refs,
        &excluded_dirs,
        &cancelled,
        &mut on_progress,
    )?;
    Ok(library_prewalk::flagged(stats))
}

fn cancel_flag_for(library: PrewalkLibrary, state: &State<AppState>) -> Arc<AtomicBool> {
    match library {
        PrewalkLibrary::Subghz => Arc::clone(&state.subghz_scan_cancelled),
        PrewalkLibrary::Infrared => Arc::clone(&state.ir_scan_cancelled),
        PrewalkLibrary::Nfc => Arc::clone(&state.nfc_scan_cancelled),
        PrewalkLibrary::Rfid => Arc::clone(&state.rfid_scan_cancelled),
        PrewalkLibrary::Badusb => Arc::clone(&state.badusb_scan_cancelled),
    }
}

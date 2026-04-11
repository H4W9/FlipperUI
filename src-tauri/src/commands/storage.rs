use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::error::{FlipperError, Result};
use crate::flipper::client::FlipperClient;
use crate::flipper::storage;
use crate::pb_storage;
use crate::state::{AppState, ConnectionMode};

/// Mirror of pb_storage::File for the frontend, with base64-encoded data.
#[derive(Serialize, Deserialize)]
pub struct FileEntry {
    /// 0 = file, 1 = directory
    pub file_type: i32,
    pub name: String,
    pub size: u32,
    pub md5sum: String,
}

impl From<pb_storage::File> for FileEntry {
    fn from(f: pb_storage::File) -> Self {
        FileEntry {
            file_type: f.r#type,
            name: f.name,
            size: f.size,
            md5sum: f.md5sum,
        }
    }
}

/// Run a closure with exclusive access to the connected FlipperClient.
/// Rejects the call if the device is in CLI mode.
/// Tears down the connection on any error so the user must reconnect.
fn with_client<T>(
    state: &State<AppState>,
    f: impl FnOnce(&mut FlipperClient) -> Result<T>,
) -> Result<T> {
    {
        let mode = state.mode.lock().unwrap();
        if *mode == ConnectionMode::Cli {
            return Err(FlipperError::CliModeActive);
        }
    }
    let mut guard = state.client.lock().unwrap();
    let client = guard.as_mut().ok_or(FlipperError::NotConnected)?;
    match f(client) {
        Ok(v) => Ok(v),
        Err(e) => {
            *guard = None; // tear down on error; force reconnect
            Err(e)
        }
    }
}

#[tauri::command]
pub fn storage_list(path: String, state: State<AppState>) -> Result<Vec<FileEntry>> {
    with_client(&state, |c| {
        storage::storage_list(c, &path).map(|files| files.into_iter().map(FileEntry::from).collect())
    })
}

#[tauri::command]
pub fn storage_stat(path: String, state: State<AppState>) -> Result<FileEntry> {
    with_client(&state, |c| {
        storage::storage_stat(c, &path).map(FileEntry::from)
    })
}

/// Read a file from the Flipper. Returns base64-encoded bytes to avoid
/// JSON number-array overhead for large files.
/// Emits `"download-progress"` events (u32 0–100) to the frontend after each chunk.
#[tauri::command]
pub fn storage_read(path: String, state: State<AppState>, app: AppHandle) -> Result<String> {
    let cancelled = state.transfer_cancelled.clone();
    cancelled.store(false, std::sync::atomic::Ordering::Relaxed);
    with_client(&state, |c| {
        let data = storage::storage_read(c, &path, |received, total| {
            let pct = if total > 0 { (received * 100 / total) as u32 } else { 0 };
            let _ = app.emit("download-progress", pct);
        }, &cancelled)?;
        Ok(base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &data))
    })
}

/// Write a file to the Flipper. `data` is base64-encoded.
/// Emits `"upload-progress"` events (u32 0–100) to the frontend after each chunk.
#[tauri::command]
pub fn storage_write(
    path: String,
    data: String,
    state: State<AppState>,
    app: AppHandle,
) -> Result<()> {
    let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, data)
        .map_err(|e| FlipperError::Session(format!("base64 decode error: {e}")))?;

    let cancelled = state.transfer_cancelled.clone();
    cancelled.store(false, std::sync::atomic::Ordering::Relaxed);
    with_client(&state, |c| {
        storage::storage_write(c, &path, &bytes, |sent, total| {
            let pct = (sent * 100 / total) as u32;
            let _ = app.emit("upload-progress", pct);
        }, &cancelled)
    })
}

#[tauri::command]
pub fn storage_mkdir(path: String, state: State<AppState>) -> Result<()> {
    with_client(&state, |c| storage::storage_mkdir(c, &path))
}

#[tauri::command]
pub fn storage_delete(
    path: String,
    recursive: bool,
    state: State<AppState>,
) -> Result<()> {
    with_client(&state, |c| storage::storage_delete(c, &path, recursive))
}

/// Rename (or move) a file/directory on the Flipper.
/// Both `old_path` and `new_path` must be absolute paths on the same storage.
#[tauri::command]
pub fn storage_rename(
    old_path: String,
    new_path: String,
    state: State<AppState>,
) -> Result<()> {
    with_client(&state, |c| storage::storage_rename(c, &old_path, &new_path))
}

/// Storage space info for a path (e.g. "/ext" or "/int").
#[derive(Serialize, Deserialize)]
pub struct StorageInfo {
    pub total_space: u64,
    pub free_space: u64,
}

#[tauri::command]
pub fn storage_info(path: String, state: State<AppState>) -> Result<StorageInfo> {
    with_client(&state, |c| {
        let (total, free) = storage::storage_info(c, &path)?;
        Ok(StorageInfo {
            total_space: total,
            free_space: free,
        })
    })
}

/// Get the modification timestamp of a file (Unix epoch seconds).
#[tauri::command]
pub fn storage_timestamp(path: String, state: State<AppState>) -> Result<u32> {
    with_client(&state, |c| storage::storage_timestamp(c, &path))
}

/// Cancel an in-progress transfer (read or write).
/// Sets the `transfer_cancelled` flag; the next loop iteration of storage_read/write checks it.
#[tauri::command]
pub fn cancel_transfer(state: State<AppState>) -> Result<()> {
    state
        .transfer_cancelled
        .store(true, std::sync::atomic::Ordering::Relaxed);
    Ok(())
}

/// Extract a .tar archive on the Flipper.
#[tauri::command]
pub fn storage_tar_extract(
    tar_path: String,
    out_path: String,
    state: State<AppState>,
) -> Result<()> {
    with_client(&state, |c| storage::storage_tar_extract(c, &tar_path, &out_path))
}

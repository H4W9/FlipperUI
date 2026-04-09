use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::error::{FlipperError, Result};
use crate::flipper::client::FlipperClient;
use crate::flipper::storage;
use crate::pb_storage;
use crate::state::AppState;

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
/// Tears down the connection on any error so the user must reconnect.
fn with_client<T>(
    state: &State<AppState>,
    f: impl FnOnce(&mut FlipperClient) -> Result<T>,
) -> Result<T> {
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
#[tauri::command]
pub fn storage_read(path: String, state: State<AppState>) -> Result<String> {
    with_client(&state, |c| {
        let data = storage::storage_read(c, &path)?;
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

    with_client(&state, |c| {
        storage::storage_write(c, &path, &bytes, |sent, total| {
            let pct = (sent * 100 / total) as u32;
            let _ = app.emit("upload-progress", pct);
        })
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

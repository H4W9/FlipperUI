use std::sync::{Arc, Mutex};

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

/// Validate that a Flipper storage path is safe (no traversal, must be absolute).
fn validate_path(path: &str) -> Result<()> {
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

/// Run a closure with exclusive access to the connected FlipperClient.
/// Rejects the call if the device is in CLI mode.
///
/// Errors are split into two classes:
/// - **Fatal** (transport/framing-level): Serial/Io/Decode/Encode. The wire
///   state is unrecoverable, so the client is dropped and the user must
///   reconnect. The screen reader (if running) will pick up the cleared mutex
///   on its next iteration and emit `flipper-disconnected`.
/// - **Transient** (protocol-level): Rpc/Timeout/UnexpectedResponse/Session/
///   etc. The connection is still healthy; the request just didn't go through.
///   Surface the error to the caller without touching the client. This is
///   crucial during an active screen stream — a single failed `power_info` or
///   `storage_info` poll used to nuke the entire connection and the stream.
fn with_client<T>(
    mode_mutex: &Arc<Mutex<ConnectionMode>>,
    client_mutex: &Arc<Mutex<Option<FlipperClient>>>,
    f: impl FnOnce(&mut FlipperClient) -> Result<T>,
) -> Result<T> {
    {
        let mode = mode_mutex.lock().unwrap();
        if *mode == ConnectionMode::Cli {
            return Err(FlipperError::CliModeActive);
        }
    }
    let mut guard = client_mutex.lock().unwrap();
    let client = guard.as_mut().ok_or(FlipperError::NotConnected)?;
    match f(client) {
        Ok(v) => Ok(v),
        Err(e) => {
            if is_fatal_transport_error(&e) {
                tracing::warn!("with_client tearing down connection: {e}");
                *guard = None;
            } else {
                tracing::debug!("with_client transient error (connection kept): {e}");
            }
            Err(e)
        }
    }
}

/// True for errors that mean the byte-stream/framing is unrecoverable.
/// Anything else (RPC status errors, timeouts, validation) leaves the
/// connection healthy.
fn is_fatal_transport_error(e: &FlipperError) -> bool {
    match e {
        FlipperError::Serial(_) => true,
        FlipperError::Io(io) => io.kind() != std::io::ErrorKind::TimedOut,
        FlipperError::Decode(_) | FlipperError::Encode(_) => true,
        _ => false,
    }
}

#[tauri::command]
pub async fn storage_list(path: String, state: State<'_, AppState>) -> Result<Vec<FileEntry>> {
    let client_mutex = Arc::clone(&state.client);
    let mode_mutex = Arc::clone(&state.mode);

    tauri::async_runtime::spawn_blocking(move || {
        validate_path(&path)?;
        with_client(&mode_mutex, &client_mutex, |c| {
            storage::storage_list(c, &path)
                .map(|files| files.into_iter().map(FileEntry::from).collect())
        })
    })
    .await
    .map_err(|e| FlipperError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn storage_stat(path: String, state: State<'_, AppState>) -> Result<FileEntry> {
    let client_mutex = Arc::clone(&state.client);
    let mode_mutex = Arc::clone(&state.mode);

    tauri::async_runtime::spawn_blocking(move || {
        validate_path(&path)?;
        with_client(&mode_mutex, &client_mutex, |c| {
            storage::storage_stat(c, &path).map(FileEntry::from)
        })
    })
    .await
    .map_err(|e| FlipperError::Internal(e.to_string()))?
}

/// Read a file from the Flipper. Returns base64-encoded bytes to avoid
/// JSON number-array overhead for large files.
/// Emits `"download-progress"` events (u32 0–100) to the frontend after each chunk.
#[tauri::command]
pub async fn storage_read(
    path: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<String> {
    let client_mutex = Arc::clone(&state.client);
    let mode_mutex = Arc::clone(&state.mode);
    let cancelled = Arc::clone(&state.transfer_cancelled);
    cancelled.store(false, std::sync::atomic::Ordering::Relaxed);

    tauri::async_runtime::spawn_blocking(move || {
        validate_path(&path)?;
        with_client(&mode_mutex, &client_mutex, |c| {
            let data = storage::storage_read(
                c,
                &path,
                |received, total| {
                    let pct = (received * 100)
                        .checked_div(total)
                        .map(|v| v as u32)
                        .unwrap_or(0);
                    let _ = app.emit("download-progress", pct);
                },
                &cancelled,
            )?;
            Ok(base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                &data,
            ))
        })
    })
    .await
    .map_err(|e| FlipperError::Internal(e.to_string()))?
}

/// Write a file to the Flipper. `data` is base64-encoded.
/// Emits `"upload-progress"` events (u32 0–100) to the frontend after each chunk.
#[tauri::command]
pub async fn storage_write(
    path: String,
    data: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<()> {
    let client_mutex = Arc::clone(&state.client);
    let mode_mutex = Arc::clone(&state.mode);
    let cancelled = Arc::clone(&state.transfer_cancelled);
    cancelled.store(false, std::sync::atomic::Ordering::Relaxed);

    tauri::async_runtime::spawn_blocking(move || {
        validate_path(&path)?;
        let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, data)
            .map_err(|e| FlipperError::Session(format!("base64 decode error: {e}")))?;

        with_client(&mode_mutex, &client_mutex, |c| {
            storage::storage_write(
                c,
                &path,
                &bytes,
                |sent, total| {
                    let pct = (sent * 100 / total) as u32;
                    let _ = app.emit("upload-progress", pct);
                },
                &cancelled,
            )
        })
    })
    .await
    .map_err(|e| FlipperError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn storage_mkdir(path: String, state: State<'_, AppState>) -> Result<()> {
    let client_mutex = Arc::clone(&state.client);
    let mode_mutex = Arc::clone(&state.mode);

    tauri::async_runtime::spawn_blocking(move || {
        validate_path(&path)?;
        with_client(&mode_mutex, &client_mutex, |c| {
            storage::storage_mkdir(c, &path)
        })
    })
    .await
    .map_err(|e| FlipperError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn storage_delete(
    path: String,
    recursive: bool,
    state: State<'_, AppState>,
) -> Result<()> {
    let client_mutex = Arc::clone(&state.client);
    let mode_mutex = Arc::clone(&state.mode);

    tauri::async_runtime::spawn_blocking(move || {
        validate_path(&path)?;
        with_client(&mode_mutex, &client_mutex, |c| {
            storage::storage_delete(c, &path, recursive)
        })
    })
    .await
    .map_err(|e| FlipperError::Internal(e.to_string()))?
}

/// Rename (or move) a file/directory on the Flipper.
/// Both `old_path` and `new_path` must be absolute paths on the same storage.
#[tauri::command(rename_all = "snake_case")]
pub async fn storage_rename(
    old_path: String,
    new_path: String,
    state: State<'_, AppState>,
) -> Result<()> {
    let client_mutex = Arc::clone(&state.client);
    let mode_mutex = Arc::clone(&state.mode);

    tauri::async_runtime::spawn_blocking(move || {
        validate_path(&old_path)?;
        validate_path(&new_path)?;
        with_client(&mode_mutex, &client_mutex, |c| {
            storage::storage_rename(c, &old_path, &new_path)
        })
    })
    .await
    .map_err(|e| FlipperError::Internal(e.to_string()))?
}

/// Storage space info for a path (e.g. "/ext" or "/int").
#[derive(Serialize, Deserialize)]
pub struct StorageInfo {
    pub total_space: u64,
    pub free_space: u64,
}

#[tauri::command]
pub async fn storage_du(path: String, state: State<'_, AppState>) -> Result<u64> {
    let client_mutex = Arc::clone(&state.client);
    let mode_mutex = Arc::clone(&state.mode);

    tauri::async_runtime::spawn_blocking(move || {
        validate_path(&path)?;
        with_client(&mode_mutex, &client_mutex, |c| {
            storage::storage_du(c, &path)
        })
    })
    .await
    .map_err(|e| FlipperError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn storage_info(path: String, state: State<'_, AppState>) -> Result<StorageInfo> {
    let client_mutex = Arc::clone(&state.client);
    let mode_mutex = Arc::clone(&state.mode);

    tauri::async_runtime::spawn_blocking(move || {
        validate_path(&path)?;
        with_client(&mode_mutex, &client_mutex, |c| {
            let (total, free) = storage::storage_info(c, &path)?;
            Ok(StorageInfo {
                total_space: total,
                free_space: free,
            })
        })
    })
    .await
    .map_err(|e| FlipperError::Internal(e.to_string()))?
}

/// Get the modification timestamp of a file (Unix epoch seconds).
#[tauri::command]
pub async fn storage_timestamp(path: String, state: State<'_, AppState>) -> Result<u32> {
    let client_mutex = Arc::clone(&state.client);
    let mode_mutex = Arc::clone(&state.mode);

    tauri::async_runtime::spawn_blocking(move || {
        validate_path(&path)?;
        with_client(&mode_mutex, &client_mutex, |c| {
            storage::storage_timestamp(c, &path)
        })
    })
    .await
    .map_err(|e| FlipperError::Internal(e.to_string()))?
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
#[tauri::command(rename_all = "snake_case")]
pub async fn storage_tar_extract(
    tar_path: String,
    out_path: String,
    state: State<'_, AppState>,
) -> Result<()> {
    let client_mutex = Arc::clone(&state.client);
    let mode_mutex = Arc::clone(&state.mode);

    tauri::async_runtime::spawn_blocking(move || {
        validate_path(&tar_path)?;
        validate_path(&out_path)?;
        with_client(&mode_mutex, &client_mutex, |c| {
            storage::storage_tar_extract(c, &tar_path, &out_path)
        })
    })
    .await
    .map_err(|e| FlipperError::Internal(e.to_string()))?
}

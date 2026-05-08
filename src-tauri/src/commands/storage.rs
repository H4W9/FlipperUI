use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::commands::client::with_client;
use crate::commands::path::validate_path;
use crate::error::{FlipperError, Result};
use crate::flipper::client::FlipperClient;
use crate::flipper::storage;
use crate::pb_storage;
use crate::state::AppState;

fn join_remote(dir: &str, name: &str) -> String {
    if dir.ends_with('/') {
        format!("{dir}{name}")
    } else {
        format!("{dir}/{name}")
    }
}

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

/// Read a remote Flipper file and persist it directly to a local filesystem
/// path. This avoids base64-encoding the payload through the webview.
#[tauri::command(rename_all = "snake_case")]
pub async fn storage_read_to_local(
    path: String,
    local_path: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<()> {
    let client_mutex = Arc::clone(&state.client);
    let mode_mutex = Arc::clone(&state.mode);
    let cancelled = Arc::clone(&state.transfer_cancelled);
    cancelled.store(false, std::sync::atomic::Ordering::Relaxed);

    tauri::async_runtime::spawn_blocking(move || {
        validate_path(&path)?;
        let data = with_client(&mode_mutex, &client_mutex, |c| {
            storage::storage_read(
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
            )
        })?;
        std::fs::write(local_path, data)?;
        Ok(())
    })
    .await
    .map_err(|e| FlipperError::Internal(e.to_string()))?
}

/// Read a local filesystem path and upload it directly to the Flipper without
/// base64-encoding the payload through the webview.
#[tauri::command(rename_all = "snake_case")]
pub async fn storage_write_from_local(
    path: String,
    local_path: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<()> {
    let client_mutex = Arc::clone(&state.client);
    let mode_mutex = Arc::clone(&state.mode);
    let cancelled = Arc::clone(&state.transfer_cancelled);
    cancelled.store(false, std::sync::atomic::Ordering::Relaxed);

    tauri::async_runtime::spawn_blocking(move || {
        validate_path(&path)?;
        let bytes = std::fs::read(local_path)?;
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

/// Sum the byte size of every file under `path`, recursively. Used as the
/// denominator for whole-folder download progress.
fn sum_tree_bytes(client: &mut FlipperClient, path: &str) -> Result<u64> {
    let mut total: u64 = 0;
    let mut queue: Vec<String> = vec![path.to_string()];
    while let Some(dir) = queue.pop() {
        let entries = storage::storage_list(client, &dir)?;
        for e in entries {
            let sub = join_remote(&dir, &e.name);
            if e.r#type == 1 {
                queue.push(sub);
            } else {
                total = total.saturating_add(e.size as u64);
            }
        }
    }
    Ok(total)
}

/// Download `remote_dir` into `local_dir` recursively. `local_dir` is the
/// fully-resolved destination — directory contents land directly inside it,
/// not under a wrapper folder. The wrapper is created by the caller so that
/// behaviour is explicit at the command boundary.
fn download_dir_recursive(
    client: &mut FlipperClient,
    remote_dir: &str,
    local_dir: &Path,
    total_bytes: u64,
    bytes_done: &mut u64,
    on_progress: &dyn Fn(u64, u64),
    cancelled: &Arc<AtomicBool>,
) -> Result<()> {
    if cancelled.load(Ordering::Relaxed) {
        return Err(FlipperError::TransferCancelled);
    }
    std::fs::create_dir_all(local_dir)?;
    let entries = storage::storage_list(client, remote_dir)?;
    for e in entries {
        if cancelled.load(Ordering::Relaxed) {
            return Err(FlipperError::TransferCancelled);
        }
        let remote_sub = join_remote(remote_dir, &e.name);
        let local_sub = local_dir.join(&e.name);
        if e.r#type == 1 {
            download_dir_recursive(
                client,
                &remote_sub,
                &local_sub,
                total_bytes,
                bytes_done,
                on_progress,
                cancelled,
            )?;
        } else {
            let start = *bytes_done;
            let file_size = e.size as u64;
            let data = storage::storage_read(
                client,
                &remote_sub,
                |received, _| {
                    let cumulative = start.saturating_add(received as u64);
                    on_progress(cumulative.min(total_bytes), total_bytes);
                },
                cancelled,
            )?;
            std::fs::write(&local_sub, &data)?;
            *bytes_done = bytes_done.saturating_add(file_size);
            on_progress(*bytes_done, total_bytes);
        }
    }
    Ok(())
}

/// Recursively download a Flipper directory to a local destination.
///
/// `local_path` is the full destination folder; the caller is responsible for
/// appending the source directory's name (so picking `~/Downloads` for `apps`
/// passes `~/Downloads/apps` here). The folder is created if missing; existing
/// files at colliding paths are overwritten.
///
/// Emits `"download-progress"` events as `u32` percentages (0-100) computed
/// against the pre-walked total byte count, so the bar advances smoothly
/// across many files.
#[tauri::command(rename_all = "snake_case")]
pub async fn storage_read_dir_to_local(
    path: String,
    local_path: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<()> {
    let client_mutex = Arc::clone(&state.client);
    let mode_mutex = Arc::clone(&state.mode);
    let cancelled = Arc::clone(&state.transfer_cancelled);
    cancelled.store(false, Ordering::Relaxed);

    tauri::async_runtime::spawn_blocking(move || {
        validate_path(&path)?;
        let local_root = PathBuf::from(local_path);
        with_client(&mode_mutex, &client_mutex, |c| {
            let total_bytes = sum_tree_bytes(c, &path)?;
            // Emit 0% up front so the bar shows even before the first chunk
            // arrives (the pre-walk is fast but not instant on big trees).
            let _ = app.emit("download-progress", 0u32);

            let mut bytes_done: u64 = 0;
            let on_progress = |done: u64, total: u64| {
                let pct = done
                    .saturating_mul(100)
                    .checked_div(total)
                    .map(|v| v.min(100) as u32)
                    .unwrap_or(100);
                let _ = app.emit("download-progress", pct);
            };

            download_dir_recursive(
                c,
                &path,
                &local_root,
                total_bytes,
                &mut bytes_done,
                &on_progress,
                &cancelled,
            )?;

            // Empty folders: ensure final 100% lands so the UI clears cleanly.
            let _ = app.emit("download-progress", 100u32);
            Ok(())
        })
    })
    .await
    .map_err(|e| FlipperError::Internal(e.to_string()))?
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

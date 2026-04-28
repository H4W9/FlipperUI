use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use crate::error::{FlipperError, Result};
use crate::flipper::client::FlipperClient;
use crate::flipper::framing::{read_response, write_message};
use crate::flipper::session::check_response;
use crate::pb;
use crate::pb::main::Content;
use crate::pb_storage;

const WRITE_CHUNK_SIZE: usize = 8192; // 8 KB — larger chunks reduce RPC overhead

/// Send a single request and read one response, validating command_id + status.
fn send_single(client: &mut FlipperClient, content: Content) -> Result<pb::Main> {
    let id = client.next_command_id();
    let req = pb::Main {
        command_id: id,
        command_status: 0,
        has_next: false,
        content: Some(content),
    };
    write_message(&mut *client.transport, &req)?;
    let resp = read_response(&mut *client.transport)?;
    check_response(&resp, id)?;
    Ok(resp)
}

/// List the contents of a directory on the Flipper.
pub fn storage_list(client: &mut FlipperClient, path: &str) -> Result<Vec<pb_storage::File>> {
    let id = client.next_command_id();
    let req = pb::Main {
        command_id: id,
        command_status: 0,
        has_next: false,
        content: Some(Content::StorageListRequest(pb_storage::ListRequest {
            path: path.to_string(),
            include_md5: false,
            filter_max_size: 0,
        })),
    };
    write_message(&mut *client.transport, &req)?;

    let mut files = Vec::new();
    loop {
        let msg = read_response(&mut *client.transport)?;
        check_response(&msg, id)?;
        if let Some(Content::StorageListResponse(r)) = msg.content {
            files.extend(r.file);
        }
        if !msg.has_next {
            break;
        }
    }
    Ok(files)
}

/// Get metadata for a file or directory.
pub fn storage_stat(client: &mut FlipperClient, path: &str) -> Result<pb_storage::File> {
    let resp = send_single(
        client,
        Content::StorageStatRequest(pb_storage::StatRequest {
            path: path.to_string(),
        }),
    )?;
    match resp.content {
        Some(Content::StorageStatResponse(r)) => r.file.ok_or(FlipperError::UnexpectedResponse),
        _ => Err(FlipperError::UnexpectedResponse),
    }
}

/// Read a file from the Flipper, returning its contents as bytes.
///
/// `on_progress(bytes_received, total_bytes)` is called after each chunk is received,
/// so the caller can report progress upstream (e.g. via Tauri events).
/// `cancelled` is checked between chunks — if set, the transfer aborts early.
pub fn storage_read<F>(
    client: &mut FlipperClient,
    path: &str,
    on_progress: F,
    cancelled: &Arc<AtomicBool>,
) -> Result<Vec<u8>>
where
    F: Fn(usize, usize),
{
    // Stat first to get total size for progress reporting
    let total_size = storage_stat(client, path)
        .map(|f| f.size as usize)
        .unwrap_or(0);

    let id = client.next_command_id();
    let req = pb::Main {
        command_id: id,
        command_status: 0,
        has_next: false,
        content: Some(Content::StorageReadRequest(pb_storage::ReadRequest {
            path: path.to_string(),
        })),
    };
    write_message(&mut *client.transport, &req)?;

    let mut data = Vec::new();
    loop {
        if cancelled.load(Ordering::Relaxed) {
            // Drain remaining response frames so the protocol stays in sync
            loop {
                let drain = read_response(&mut *client.transport)?;
                if !drain.has_next {
                    break;
                }
            }
            return Err(FlipperError::TransferCancelled);
        }

        let msg = read_response(&mut *client.transport)?;
        check_response(&msg, id)?;
        match msg.content {
            Some(Content::StorageReadResponse(r)) => {
                let file = r.file.ok_or(FlipperError::UnexpectedResponse)?;
                data.extend_from_slice(&file.data);
                if total_size > 0 {
                    on_progress(data.len(), total_size);
                }
            }
            _ => return Err(FlipperError::UnexpectedResponse),
        }
        if !msg.has_next {
            break;
        }
    }
    Ok(data)
}

/// Write data to a file on the Flipper.
/// Large files are split into 8KB chunks, each sent as a separate protobuf frame
/// with the same command_id. has_next=true on all but the final frame.
///
/// `on_progress(chunks_sent, total_chunks)` is called after each chunk is written to the
/// serial port, so the caller can report progress upstream (e.g. via Tauri events).
/// `cancelled` is checked between chunks — if set, the transfer aborts early.
pub fn storage_write<F>(
    client: &mut FlipperClient,
    path: &str,
    data: &[u8],
    on_progress: F,
    cancelled: &Arc<AtomicBool>,
) -> Result<()>
where
    F: Fn(usize, usize),
{
    let id = client.next_command_id();

    // Ensure at least one frame is sent even for empty files
    let chunks: Vec<&[u8]> = if data.is_empty() {
        vec![&[]]
    } else {
        data.chunks(WRITE_CHUNK_SIZE).collect()
    };
    let total = chunks.len();

    for (i, chunk) in chunks.iter().enumerate() {
        if cancelled.load(Ordering::Relaxed) {
            // Send a final empty chunk to close the write stream cleanly
            let abort_frame = pb::Main {
                command_id: id,
                command_status: 0,
                has_next: false,
                content: Some(Content::StorageWriteRequest(pb_storage::WriteRequest {
                    path: path.to_string(),
                    file: Some(pb_storage::File {
                        r#type: 0,
                        name: String::new(),
                        size: 0,
                        data: Vec::new(),
                        md5sum: String::new(),
                    }),
                })),
            };
            write_message(&mut *client.transport, &abort_frame)?;
            let _ = read_response(&mut *client.transport); // read the response
                                                           // Delete the incomplete file
            let _ = storage_delete(client, path, false);
            return Err(FlipperError::TransferCancelled);
        }

        let is_last = i == total - 1;
        let frame = pb::Main {
            command_id: id,
            command_status: 0,
            has_next: !is_last,
            content: Some(Content::StorageWriteRequest(pb_storage::WriteRequest {
                path: path.to_string(),
                file: Some(pb_storage::File {
                    r#type: 0, // FileType::File
                    name: String::new(),
                    size: 0,
                    data: chunk.to_vec(),
                    md5sum: String::new(),
                }),
            })),
        };
        write_message(&mut *client.transport, &frame)?;
        on_progress(i + 1, total);
    }

    // Device responds once with Empty after receiving all chunks
    let resp = read_response(&mut *client.transport)?;
    check_response(&resp, id)?;
    Ok(())
}

/// Rename or move a file/directory on the Flipper.
pub fn storage_rename(client: &mut FlipperClient, old_path: &str, new_path: &str) -> Result<()> {
    send_single(
        client,
        Content::StorageRenameRequest(pb_storage::RenameRequest {
            old_path: old_path.to_string(),
            new_path: new_path.to_string(),
        }),
    )?;
    Ok(())
}

/// Create a directory on the Flipper.
pub fn storage_mkdir(client: &mut FlipperClient, path: &str) -> Result<()> {
    send_single(
        client,
        Content::StorageMkdirRequest(pb_storage::MkdirRequest {
            path: path.to_string(),
        }),
    )?;
    Ok(())
}

/// Delete a file or directory on the Flipper.
pub fn storage_delete(client: &mut FlipperClient, path: &str, recursive: bool) -> Result<()> {
    send_single(
        client,
        Content::StorageDeleteRequest(pb_storage::DeleteRequest {
            path: path.to_string(),
            recursive,
        }),
    )?;
    Ok(())
}

/// Recursively sum the size of all files under `path`. Useful for reporting
/// usage of the `/int` namespace, which on modern Flipper firmware is aliased
/// onto the SD card (so `storage_info("/int")` returns the SD card's total/free,
/// not the internal namespace's actual footprint).
pub fn storage_du(client: &mut FlipperClient, path: &str) -> Result<u64> {
    let mut queue: Vec<String> = vec![path.to_string()];
    let mut total: u64 = 0;
    while let Some(dir) = queue.pop() {
        // A missing `/int` (pre-alias firmware, or SD ejected) should surface
        // as zero usage, not a hard error.
        let entries = match storage_list(client, &dir) {
            Ok(v) => v,
            Err(FlipperError::Rpc { .. }) => continue,
            Err(e) => return Err(e),
        };
        for e in entries {
            // FileType::DIR = 1 in the protobuf.
            if e.r#type == 1 {
                let sub = if dir.ends_with('/') {
                    format!("{dir}{}", e.name)
                } else {
                    format!("{dir}/{}", e.name)
                };
                queue.push(sub);
            } else {
                total = total.saturating_add(e.size as u64);
            }
        }
    }
    Ok(total)
}

/// Get storage space info (total/free bytes) for a storage path (e.g. "/ext" or "/int").
pub fn storage_info(client: &mut FlipperClient, path: &str) -> Result<(u64, u64)> {
    let resp = send_single(
        client,
        Content::StorageInfoRequest(pb_storage::InfoRequest {
            path: path.to_string(),
        }),
    )?;
    match resp.content {
        Some(Content::StorageInfoResponse(r)) => Ok((r.total_space, r.free_space)),
        _ => Err(FlipperError::UnexpectedResponse),
    }
}

/// Get the modification timestamp of a file (Unix epoch seconds).
pub fn storage_timestamp(client: &mut FlipperClient, path: &str) -> Result<u32> {
    let resp = send_single(
        client,
        Content::StorageTimestampRequest(pb_storage::TimestampRequest {
            path: path.to_string(),
        }),
    )?;
    match resp.content {
        Some(Content::StorageTimestampResponse(r)) => Ok(r.timestamp),
        _ => Err(FlipperError::UnexpectedResponse),
    }
}

/// Extract a .tar archive on the Flipper's filesystem.
pub fn storage_tar_extract(
    client: &mut FlipperClient,
    tar_path: &str,
    out_path: &str,
) -> Result<()> {
    send_single(
        client,
        Content::StorageTarExtractRequest(pb_storage::TarExtractRequest {
            tar_path: tar_path.to_string(),
            out_path: out_path.to_string(),
        }),
    )?;
    Ok(())
}

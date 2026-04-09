use crate::error::{FlipperError, Result};
use crate::flipper::client::FlipperClient;
use crate::flipper::framing::{read_message, write_message};
use crate::flipper::session::check_response;
use crate::pb;
use crate::pb::main::Content;
use crate::pb_storage;

const WRITE_CHUNK_SIZE: usize = 512;

/// Send a single request and read one response, validating command_id + status.
fn send_single(client: &mut FlipperClient, content: Content) -> Result<pb::Main> {
    let id = client.next_command_id();
    let req = pb::Main {
        command_id: id,
        command_status: 0,
        has_next: false,
        content: Some(content),
    };
    write_message(&mut *client.port, &req)?;
    let resp = read_message(&mut *client.port)?;
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
    write_message(&mut *client.port, &req)?;

    let mut files = Vec::new();
    loop {
        let msg = read_message(&mut *client.port)?;
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
        Some(Content::StorageStatResponse(r)) => {
            r.file.ok_or(FlipperError::UnexpectedResponse)
        }
        _ => Err(FlipperError::UnexpectedResponse),
    }
}

/// Read a file from the Flipper, returning its contents as bytes.
pub fn storage_read(client: &mut FlipperClient, path: &str) -> Result<Vec<u8>> {
    let id = client.next_command_id();
    let req = pb::Main {
        command_id: id,
        command_status: 0,
        has_next: false,
        content: Some(Content::StorageReadRequest(pb_storage::ReadRequest {
            path: path.to_string(),
        })),
    };
    write_message(&mut *client.port, &req)?;

    let mut data = Vec::new();
    loop {
        let msg = read_message(&mut *client.port)?;
        check_response(&msg, id)?;
        match msg.content {
            Some(Content::StorageReadResponse(r)) => {
                let file = r.file.ok_or(FlipperError::UnexpectedResponse)?;
                data.extend_from_slice(&file.data);
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
/// Large files are split into 512-byte chunks, each sent as a separate protobuf frame
/// with the same command_id. has_next=true on all but the final frame.
///
/// `on_progress(chunks_sent, total_chunks)` is called after each chunk is written to the
/// serial port, so the caller can report progress upstream (e.g. via Tauri events).
pub fn storage_write<F>(
    client: &mut FlipperClient,
    path: &str,
    data: &[u8],
    on_progress: F,
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
        write_message(&mut *client.port, &frame)?;
        on_progress(i + 1, total);
    }

    // Device responds once with Empty after receiving all chunks
    let resp = read_message(&mut *client.port)?;
    check_response(&resp, id)?;
    Ok(())
}

/// Rename or move a file/directory on the Flipper.
pub fn storage_rename(
    client: &mut FlipperClient,
    old_path: &str,
    new_path: &str,
) -> Result<()> {
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

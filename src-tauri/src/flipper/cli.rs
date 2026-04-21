use std::time::Duration;

use crate::error::{FlipperError, Result};
use crate::flipper::client::FlipperClient;
use crate::flipper::framing::{read_message, write_message};
use crate::pb;
use crate::pb::main::Content;

const CLI_READ_TIMEOUT: Duration = Duration::from_millis(50);
const NORMAL_TIMEOUT: Duration = Duration::from_secs(5);
const DRAIN_TIMEOUT: Duration = Duration::from_millis(50);

/// Exit the protobuf RPC session and return the device to its text-based CLI.
///
/// Sends a `StopSession` RPC message, reads the acknowledgment, drains any
/// trailing bytes, and sets the port to a short read timeout suitable for
/// the CLI reader thread's polling loop.
pub fn enter_cli_mode(client: &mut FlipperClient) -> Result<()> {
    let id = client.next_command_id();
    let msg = pb::Main {
        command_id: id,
        command_status: 0,
        has_next: false,
        content: Some(Content::StopSession(pb::StopSession {})),
    };
    write_message(&mut *client.transport, &msg)?;

    let _ = read_message(&mut *client.transport);

    client.transport.set_timeout(DRAIN_TIMEOUT)?;
    let mut drain_buf = [0u8; 256];
    loop {
        match client.transport.read(&mut drain_buf) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
    }

    client.transport.set_timeout(CLI_READ_TIMEOUT)?;
    Ok(())
}

/// Leave the text CLI and re-enter protobuf RPC mode.
///
/// Drains any pending CLI output, sends `start_rpc_session\r`,
/// waits for the `\n` acknowledgment, and restores the normal timeout.
pub fn exit_cli_mode(client: &mut FlipperClient) -> Result<()> {
    client.transport.set_timeout(DRAIN_TIMEOUT)?;
    let mut drain_buf = [0u8; 256];
    loop {
        match client.transport.read(&mut drain_buf) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
    }

    client.transport.set_timeout(NORMAL_TIMEOUT)?;
    client.transport.write_all(b"start_rpc_session\r")?;
    client.transport.flush()?;

    let mut byte = [0u8; 1];
    loop {
        match client.transport.read(&mut byte) {
            Ok(1) if byte[0] == b'\n' => break,
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::TimedOut => {
                return Err(FlipperError::Session(
                    "Timed out waiting for RPC session acknowledgment".into(),
                ));
            }
            Err(e) => return Err(e.into()),
        }
    }

    Ok(())
}

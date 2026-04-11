use std::time::Duration;

use crate::error::{FlipperError, Result};
use crate::flipper::client::FlipperClient;
use crate::flipper::framing::{read_message, write_message};
use crate::pb;
use crate::pb::main::Content;

const CLI_READ_TIMEOUT: Duration = Duration::from_millis(50);
const NORMAL_TIMEOUT: Duration = Duration::from_secs(5);
const DRAIN_TIMEOUT: Duration = Duration::from_millis(200);

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
    write_message(&mut *client.port, &msg)?;

    // Read the response — the device confirms and exits RPC mode.
    // This may fail if the device drops out of RPC immediately, so we
    // treat a timeout or decode error as acceptable.
    let _ = read_message(&mut *client.port);

    // Drain any trailing protobuf/text bytes
    client.port.set_timeout(DRAIN_TIMEOUT)?;
    let mut drain_buf = [0u8; 256];
    loop {
        match client.port.read(&mut drain_buf) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
    }

    // Set short timeout for the CLI reader thread's polling loop
    client.port.set_timeout(CLI_READ_TIMEOUT)?;
    Ok(())
}

/// Leave the text CLI and re-enter protobuf RPC mode.
///
/// Drains any pending CLI output, sends `start_rpc_session\r`,
/// waits for the `\n` acknowledgment, and restores the normal timeout.
pub fn exit_cli_mode(client: &mut FlipperClient) -> Result<()> {
    // Drain pending CLI output
    client.port.set_timeout(DRAIN_TIMEOUT)?;
    let mut drain_buf = [0u8; 256];
    loop {
        match client.port.read(&mut drain_buf) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
    }

    // Send the RPC session start command
    client.port.set_timeout(NORMAL_TIMEOUT)?;
    client.port.write_all(b"start_rpc_session\r")?;
    client.port.flush()?;

    // Wait for the device to acknowledge with a newline
    let mut byte = [0u8; 1];
    loop {
        match client.port.read(&mut byte) {
            Ok(1) if byte[0] == b'\n' => break,
            Ok(_) => {} // consume echoed characters
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

use std::collections::HashMap;
use std::time::Duration;

use crate::error::{FlipperError, Result};
use crate::flipper::client::FlipperClient;
use crate::flipper::framing::{read_message, write_message};
use crate::pb;
use crate::pb::main::Content;
use crate::pb_system;

const SESSION_CMD: &[u8] = b"start_rpc_session\r";
const NORMAL_TIMEOUT: Duration = Duration::from_secs(5);
const DRAIN_TIMEOUT: Duration = Duration::from_millis(200);

/// Open a serial port, perform the RPC session handshake, and return a connected client.
pub fn open_session(port_name: &str) -> Result<FlipperClient> {
    let port = serialport::new(port_name, 230400)
        .timeout(DRAIN_TIMEOUT)
        .open()?;

    let mut client = FlipperClient::new(port);

    // Drain any pending CLI text (prompt, log lines, etc.)
    let mut drain_buf = [0u8; 256];
    loop {
        match client.port.read(&mut drain_buf) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
    }

    // Switch to normal timeout for the session handshake
    client.port.set_timeout(NORMAL_TIMEOUT)?;

    // Send RPC session start command (CR only — the Flipper CLI expects \r not \r\n)
    client.port.write_all(SESSION_CMD)?;
    client.port.flush()?;

    // Wait for the device to acknowledge with a newline.
    // The serial port already has NORMAL_TIMEOUT set, so read() will return
    // TimedOut if no bytes arrive within 5 seconds — no manual deadline needed.
    let mut byte = [0u8; 1];
    loop {
        match client.port.read(&mut byte) {
            Ok(1) if byte[0] == b'\n' => break,
            Ok(_) => {} // consume echoed characters, \r, etc.
            Err(e) if e.kind() == std::io::ErrorKind::TimedOut => {
                return Err(FlipperError::Session(
                    "Timed out waiting for RPC session acknowledgment".into(),
                ));
            }
            Err(e) => return Err(e.into()),
        }
    }

    Ok(client)
}

/// Send a ping and verify the device responds correctly.
pub fn ping(client: &mut FlipperClient) -> Result<()> {
    let id = client.next_command_id();
    let req = pb::Main {
        command_id: id,
        command_status: 0,
        has_next: false,
        content: Some(Content::SystemPingRequest(pb_system::PingRequest {
            data: vec![0xDE, 0xAD, 0xBE, 0xEF],
        })),
    };
    write_message(&mut *client.port, &req)?;
    let resp = read_message(&mut *client.port)?;
    check_response(&resp, id)?;
    Ok(())
}

/// Retrieve device info key-value pairs from the Flipper.
pub fn get_device_info(client: &mut FlipperClient) -> Result<HashMap<String, String>> {
    let id = client.next_command_id();
    let req = pb::Main {
        command_id: id,
        command_status: 0,
        has_next: false,
        content: Some(Content::SystemDeviceInfoRequest(
            pb_system::DeviceInfoRequest {},
        )),
    };
    write_message(&mut *client.port, &req)?;

    let mut info = HashMap::new();
    loop {
        let msg = read_message(&mut *client.port)?;
        check_response(&msg, id)?;
        if let Some(Content::SystemDeviceInfoResponse(r)) = msg.content {
            info.insert(r.key, r.value);
        }
        if !msg.has_next {
            break;
        }
    }
    Ok(info)
}

/// Validate that a response belongs to the expected command and has OK status.
/// Every RPC call site should use this instead of bare status checks.
pub fn check_response(msg: &pb::Main, expected_id: u32) -> Result<()> {
    if msg.command_id != expected_id {
        return Err(FlipperError::UnexpectedResponse);
    }
    if msg.command_status != 0 {
        return Err(FlipperError::Rpc {
            status: msg.command_status,
            command_id: expected_id,
        });
    }
    Ok(())
}

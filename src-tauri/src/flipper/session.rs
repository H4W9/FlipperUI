use std::collections::HashMap;

use crate::error::{FlipperError, Result};
use crate::flipper::client::FlipperClient;
use crate::flipper::framing::{read_response, write_message};
use crate::flipper::transport::SerialTransport;
use crate::flipper::{SERIAL_TIMEOUT_DRAIN, SERIAL_TIMEOUT_NORMAL};
use crate::pb;
use crate::pb::main::Content;
use crate::pb_system;

const SESSION_CMD: &[u8] = b"start_rpc_session\r";

/// Open a serial port, perform the RPC session handshake, and return a connected client.
pub fn open_session(port_name: &str) -> Result<FlipperClient> {
    let port = serialport::new(port_name, 230400)
        .timeout(SERIAL_TIMEOUT_DRAIN)
        .open()?;

    let mut transport: Box<dyn crate::flipper::transport::Transport> =
        Box::new(SerialTransport::new(port));

    // Drain any pending CLI text (prompt, log lines, etc.)
    let mut drain_buf = [0u8; 256];
    loop {
        match transport.read(&mut drain_buf) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
    }

    // Switch to normal timeout for the session handshake
    transport.set_timeout(SERIAL_TIMEOUT_NORMAL)?;

    // Send RPC session start command (CR only — the Flipper CLI expects \r not \r\n)
    transport.write_all(SESSION_CMD)?;
    transport.flush()?;

    // Wait for the device to acknowledge with a newline.
    // The transport already has SERIAL_TIMEOUT_NORMAL set, so read() will return
    // TimedOut if no bytes arrive within 5 seconds — no manual deadline needed.
    let mut byte = [0u8; 1];
    loop {
        match transport.read(&mut byte) {
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

    Ok(FlipperClient::new(transport))
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
    write_message(&mut *client.transport, &req)?;
    let resp = read_response(&mut *client.transport)?;
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
    write_message(&mut *client.transport, &req)?;

    let mut info = HashMap::new();
    loop {
        let msg = read_response(&mut *client.transport)?;
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

/// Get power/battery info from the Flipper. Returns key-value pairs
/// (e.g. "charge", "health", "voltage", "current", "temperature").
pub fn get_power_info(client: &mut FlipperClient) -> Result<HashMap<String, String>> {
    let id = client.next_command_id();
    let req = pb::Main {
        command_id: id,
        command_status: 0,
        has_next: false,
        content: Some(Content::SystemPowerInfoRequest(
            pb_system::PowerInfoRequest {},
        )),
    };
    write_message(&mut *client.transport, &req)?;

    let mut info = HashMap::new();
    loop {
        let msg = read_response(&mut *client.transport)?;
        check_response(&msg, id)?;
        if let Some(Content::SystemPowerInfoResponse(r)) = msg.content {
            info.insert(r.key, r.value);
        }
        if !msg.has_next {
            break;
        }
    }
    Ok(info)
}

/// Reboot the Flipper Zero.
/// mode: 0 = OS (normal), 1 = DFU, 2 = UPDATE
pub fn reboot(client: &mut FlipperClient, mode: i32) -> Result<()> {
    let id = client.next_command_id();
    let req = pb::Main {
        command_id: id,
        command_status: 0,
        has_next: false,
        content: Some(Content::SystemRebootRequest(pb_system::RebootRequest {
            mode,
        })),
    };
    write_message(&mut *client.transport, &req)?;
    // Device reboots immediately — no response expected.
    // The serial port will disconnect.
    Ok(())
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

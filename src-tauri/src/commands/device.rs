use std::sync::atomic::Ordering;

use serde::{Deserialize, Serialize};
use tauri::State;

use std::collections::HashMap;

use crate::error::{FlipperError, Result};
use crate::flipper::session;
use crate::state::{AppState, ConnectionMode};

#[derive(Serialize, Deserialize)]
pub struct PortInfo {
    pub name: String,
    pub is_flipper: bool,
    pub vid: Option<u16>,
    pub pid: Option<u16>,
    pub manufacturer: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct DeviceInfo {
    pub port: String,
    pub hardware_name: Option<String>,
    pub hardware_version: Option<String>,
    pub firmware_version: Option<String>,
    pub firmware_build_date: Option<String>,
}

/// List all available serial ports, marking Flipper Zeros by VID/PID.
#[tauri::command]
pub fn list_ports() -> Result<Vec<PortInfo>> {
    let ports = serialport::available_ports()?;
    Ok(ports
        .into_iter()
        .map(|p| {
            let (vid, pid, manufacturer, is_flipper) = match &p.port_type {
                serialport::SerialPortType::UsbPort(usb) => {
                    // Flipper Zero: VID 0x0483 (STMicroelectronics), PID 0x5740 (Virtual COM Port)
                    let is_f = usb.vid == 0x0483 && usb.pid == 0x5740;
                    (
                        Some(usb.vid),
                        Some(usb.pid),
                        usb.manufacturer.clone(),
                        is_f,
                    )
                }
                _ => (None, None, None, false),
            };
            PortInfo {
                name: p.port_name,
                is_flipper,
                vid,
                pid,
                manufacturer,
            }
        })
        .collect())
}

/// Open a connection to the Flipper Zero on the given port.
#[tauri::command]
pub fn connect(port: String, state: State<AppState>) -> Result<DeviceInfo> {
    // Clean up any previous sessions
    state.cli_reader_active.store(false, Ordering::Relaxed);
    state.screen_stream_active.store(false, Ordering::Relaxed);
    {
        let mut mode = state.mode.lock().unwrap();
        *mode = ConnectionMode::Rpc;
    }

    let mut guard = state.client.lock().unwrap();
    // Drop any existing connection first
    *guard = None;

    let mut client = session::open_session(&port)?;
    let info_map = session::get_device_info(&mut client).unwrap_or_default();
    *guard = Some(client);

    Ok(DeviceInfo {
        port,
        hardware_name: info_map.get("hardware_name").cloned(),
        hardware_version: info_map.get("hardware_ver").cloned(),
        firmware_version: info_map.get("software_version").cloned(),
        firmware_build_date: info_map.get("software_build_date").cloned(),
    })
}

/// Close the current connection to the Flipper Zero.
#[tauri::command]
pub fn disconnect(state: State<AppState>) -> Result<()> {
    // Stop any running CLI reader or screen stream thread
    state.cli_reader_active.store(false, Ordering::Relaxed);
    state.screen_stream_active.store(false, Ordering::Relaxed);
    {
        let mut mode = state.mode.lock().unwrap();
        *mode = ConnectionMode::Rpc;
    }
    let mut guard = state.client.lock().unwrap();
    *guard = None; // Drop closes the serial port
    Ok(())
}

/// Get power/battery info from the Flipper.
/// Returns a key-value map (e.g. "charge", "voltage", "current", "temperature").
#[tauri::command]
pub fn power_info(state: State<AppState>) -> Result<HashMap<String, String>> {
    let mode = state.mode.lock().unwrap();
    if *mode == ConnectionMode::Cli {
        return Err(FlipperError::CliModeActive);
    }
    drop(mode);

    let mut guard = state.client.lock().unwrap();
    let client = guard.as_mut().ok_or(FlipperError::NotConnected)?;
    session::get_power_info(client)
}

/// Reboot the Flipper Zero.
/// mode: 0 = OS (normal reboot), 1 = DFU, 2 = UPDATE
#[tauri::command]
pub fn reboot(mode: i32, state: State<AppState>) -> Result<()> {
    let conn_mode = state.mode.lock().unwrap();
    if *conn_mode == ConnectionMode::Cli {
        return Err(FlipperError::CliModeActive);
    }
    drop(conn_mode);

    let mut guard = state.client.lock().unwrap();
    let client = guard.as_mut().ok_or(FlipperError::NotConnected)?;
    let result = session::reboot(client, mode);
    // Device reboots immediately — drop the client since port is gone
    *guard = None;
    result
}

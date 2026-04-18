use std::sync::atomic::Ordering;
use std::sync::Arc;

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

/// List serial ports that belong to a Flipper Zero.
/// Filters ports to only those with "usbmodemflip" in the port name.
#[tauri::command]
pub fn list_ports() -> Result<Vec<PortInfo>> {
    // Note: list_ports is kept synchronous because serialport::available_ports()
    // is typically fast (~10-50ms). If this becomes a bottleneck, we can move it
    // to spawn_blocking later.
    let ports = serialport::available_ports()?;
    Ok(ports
        .into_iter()
        .filter_map(|p| {
            // Only include ports with "usbmodemflip" in the name
            if !p.port_name.to_lowercase().contains("usbmodemflip") {
                return None;
            }
            let (vid, pid, manufacturer) = match &p.port_type {
                serialport::SerialPortType::UsbPort(usb) => {
                    (Some(usb.vid), Some(usb.pid), usb.manufacturer.clone())
                }
                _ => (None, None, None),
            };
            Some(PortInfo {
                name: p.port_name,
                is_flipper: true,
                vid,
                pid,
                manufacturer,
            })
        })
        .collect())
}

/// Open a connection to the Flipper Zero on the given port.
#[tauri::command]
pub async fn connect(port: String, state: State<'_, AppState>) -> Result<DeviceInfo> {
    let client_mutex = Arc::clone(&state.client);
    let mode_mutex = Arc::clone(&state.mode);
    let cli_reader_active = Arc::clone(&state.cli_reader_active);
    let screen_stream_active = Arc::clone(&state.screen_stream_active);
    let input_event_tx = Arc::clone(&state.input_event_tx);

    tauri::async_runtime::spawn_blocking(move || {
        // Clean up any previous sessions
        cli_reader_active.store(false, Ordering::Relaxed);
        screen_stream_active.store(false, Ordering::Relaxed);
        *input_event_tx.lock().unwrap() = None;
        {
            let mut mode = mode_mutex.lock().unwrap();
            *mode = ConnectionMode::Rpc;
        }

        let mut guard = client_mutex.lock().unwrap();
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
    })
    .await
    .map_err(|e| FlipperError::Internal(e.to_string()))?
}

/// Close the current connection to the Flipper Zero.
#[tauri::command]
pub async fn disconnect(state: State<'_, AppState>) -> Result<()> {
    let client_mutex = Arc::clone(&state.client);
    let mode_mutex = Arc::clone(&state.mode);
    let cli_reader_active = Arc::clone(&state.cli_reader_active);
    let screen_stream_active = Arc::clone(&state.screen_stream_active);
    let input_event_tx = Arc::clone(&state.input_event_tx);

    tauri::async_runtime::spawn_blocking(move || {
        // Stop any running CLI reader or screen stream thread
        cli_reader_active.store(false, Ordering::Relaxed);
        screen_stream_active.store(false, Ordering::Relaxed);
        *input_event_tx.lock().unwrap() = None;
        {
            let mut mode = mode_mutex.lock().unwrap();
            *mode = ConnectionMode::Rpc;
        }
        let mut guard = client_mutex.lock().unwrap();
        *guard = None; // Drop closes the serial port
        Ok(())
    })
    .await
    .map_err(|e| FlipperError::Internal(e.to_string()))?
}

/// Get power/battery info from the Flipper.
/// Returns a key-value map (e.g. "charge", "voltage", "current", "temperature").
#[tauri::command]
pub async fn power_info(state: State<'_, AppState>) -> Result<HashMap<String, String>> {
    let client_mutex = Arc::clone(&state.client);
    let mode_mutex = Arc::clone(&state.mode);

    tauri::async_runtime::spawn_blocking(move || {
        let mode = mode_mutex.lock().unwrap();
        if *mode == ConnectionMode::Cli {
            return Err(FlipperError::CliModeActive);
        }
        drop(mode);

        let mut guard = client_mutex.lock().unwrap();
        let client = guard.as_mut().ok_or(FlipperError::NotConnected)?;
        session::get_power_info(client)
    })
    .await
    .map_err(|e| FlipperError::Internal(e.to_string()))?
}

/// Reboot the Flipper Zero.
/// mode: 0 = OS (normal reboot), 1 = DFU, 2 = UPDATE
#[tauri::command]
pub async fn reboot(mode: i32, state: State<'_, AppState>) -> Result<()> {
    let client_mutex = Arc::clone(&state.client);
    let mode_mutex = Arc::clone(&state.mode);

    tauri::async_runtime::spawn_blocking(move || {
        let conn_mode = mode_mutex.lock().unwrap();
        if *conn_mode == ConnectionMode::Cli {
            return Err(FlipperError::CliModeActive);
        }
        drop(conn_mode);

        let mut guard = client_mutex.lock().unwrap();
        let client = guard.as_mut().ok_or(FlipperError::NotConnected)?;
        let result = session::reboot(client, mode);
        // Device reboots immediately — drop the client since port is gone
        *guard = None;
        result
    })
    .await
    .map_err(|e| FlipperError::Internal(e.to_string()))?
}

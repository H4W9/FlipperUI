use std::sync::atomic::Ordering;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use std::collections::HashMap;

use crate::error::{FlipperError, Result};
use crate::flipper::ble::{connection::connect_ble, scanner};
use crate::flipper::session;
use crate::flipper::transport::TransportKind;
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
    /// STM32 unique ID — stable per device, used as the cache key for
    /// per-device state like the Sub-GHz library index.
    pub hardware_uid: Option<String>,
    pub firmware_version: Option<String>,
    pub firmware_build_date: Option<String>,
}

/// Flipper Zero's USB VID/PID — the device exposes itself as a STM32 virtual
/// COM port. Used as the cross-platform identifier so we don't auto-connect to
/// random Bluetooth virtual ports, modems, or vendor serial dongles.
const FLIPPER_USB_VID: u16 = 0x0483;
const FLIPPER_USB_PID: u16 = 0x5740;

/// List serial ports, marking Flipper Zero ports via USB VID/PID. On macOS we
/// additionally drop non-Flipper ports entirely (the `usbmodemflip*` naming
/// gives us a stable filter), since the picker on macOS is Flipper-only and
/// surfacing the system's other tty devices is just noise. On Windows / Linux
/// we keep every port in the list but only mark the Flipper as connectable —
/// auto-connect logic on the frontend keys off `is_flipper`, so a stray COM
/// port can't trigger a connection retry loop.
#[tauri::command]
pub fn list_ports() -> Result<Vec<PortInfo>> {
    // Note: list_ports is kept synchronous because serialport::available_ports()
    // is typically fast (~10-50ms). If this becomes a bottleneck, we can move it
    // to spawn_blocking later.
    let ports = serialport::available_ports()?;
    Ok(ports
        .into_iter()
        .filter_map(|p| {
            let (vid, pid, manufacturer) = match &p.port_type {
                serialport::SerialPortType::UsbPort(usb) => {
                    (Some(usb.vid), Some(usb.pid), usb.manufacturer.clone())
                }
                _ => (None, None, None),
            };
            let is_flipper = matches!((vid, pid), (Some(FLIPPER_USB_VID), Some(FLIPPER_USB_PID)));

            // Belt-and-braces fallback: some macOS USB stacks return the port
            // without a populated VID/PID on first enumeration, so accept the
            // historical name-based match as a fallback there.
            let is_flipper = is_flipper
                || (cfg!(target_os = "macos")
                    && p.port_name.to_lowercase().contains("usbmodemflip"));

            // On macOS, hide non-Flipper ports outright to keep the picker
            // clean. On Windows / Linux we keep them visible but un-flipped
            // — the user can still see what's plugged in, but auto-connect
            // won't target them.
            if cfg!(target_os = "macos") && !is_flipper {
                return None;
            }

            Some(PortInfo {
                name: p.port_name,
                is_flipper,
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
    let ble_cancel_tx = Arc::clone(&state.ble_cancel_tx);

    tauri::async_runtime::spawn_blocking(move || {
        // Clean up any previous sessions
        cli_reader_active.store(false, Ordering::Relaxed);
        screen_stream_active.store(false, Ordering::Relaxed);
        *input_event_tx.lock().unwrap() = None;
        if let Some(tx) = ble_cancel_tx.lock().unwrap().take() {
            let _ = tx.send(());
        }
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
            hardware_uid: info_map.get("hardware_uid").cloned(),
            firmware_version: info_map.get("software_version").cloned(),
            firmware_build_date: info_map.get("software_build_date").cloned(),
        })
    })
    .await
    .map_err(|e| FlipperError::Internal(e.to_string()))?
}

/// List discoverable Flipper Zero devices over BLE.
#[tauri::command]
pub async fn list_ble_devices() -> Result<Vec<scanner::BleDevice>> {
    tauri::async_runtime::spawn_blocking(scanner::list_ble_devices_blocking)
        .await
        .map_err(|e| FlipperError::Internal(e.to_string()))?
}

/// Start a live BLE scan that emits `ble-scan-device` events as Flipper
/// peripherals are seen, until the matching `stop_ble_scan` is called. Calling
/// this while a scan is already running is a no-op.
#[tauri::command]
pub async fn start_ble_scan(app: AppHandle, state: State<'_, AppState>) -> Result<()> {
    let cancel = Arc::clone(&state.ble_scan_active);
    // swap returns the previous value — if true, a scan is already running and
    // we leave it alone (the second start would be racing the first on the same
    // adapter's event stream).
    if cancel.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(e) = scanner::live_scan_blocking(app_handle, cancel) {
            tracing::warn!("BLE live scan ended with error: {e}");
        }
    });
    Ok(())
}

/// Stop the live BLE scan started by `start_ble_scan`. Idempotent.
#[tauri::command]
pub async fn stop_ble_scan(state: State<'_, AppState>) -> Result<()> {
    state.ble_scan_active.store(false, Ordering::Relaxed);
    Ok(())
}

/// Open a BLE connection to the Flipper Zero identified by `id` (from `list_ble_devices`).
#[tauri::command]
pub async fn connect_ble_device(
    id: String,
    name: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<DeviceInfo> {
    let client_mutex = Arc::clone(&state.client);
    let mode_mutex = Arc::clone(&state.mode);
    let cli_reader_active = Arc::clone(&state.cli_reader_active);
    let screen_stream_active = Arc::clone(&state.screen_stream_active);
    let input_event_tx = Arc::clone(&state.input_event_tx);
    let ble_cancel_tx = Arc::clone(&state.ble_cancel_tx);

    tauri::async_runtime::spawn_blocking(move || {
        // Clean up any previous session
        cli_reader_active.store(false, Ordering::Relaxed);
        screen_stream_active.store(false, Ordering::Relaxed);
        *input_event_tx.lock().unwrap() = None;
        if let Some(tx) = ble_cancel_tx.lock().unwrap().take() {
            let _ = tx.send(());
        }
        {
            let mut mode = mode_mutex.lock().unwrap();
            *mode = ConnectionMode::Rpc;
        }
        {
            let mut guard = client_mutex.lock().unwrap();
            *guard = None;
        }

        let (mut client, cancel_tx) = connect_ble(id, app)?;
        let info_map = session::get_device_info(&mut client).unwrap_or_default();

        {
            let mut guard = client_mutex.lock().unwrap();
            *guard = Some(client);
        }
        *ble_cancel_tx.lock().unwrap() = Some(cancel_tx);

        Ok(DeviceInfo {
            port: name.unwrap_or_else(|| "BLE".into()),
            hardware_name: info_map.get("hardware_name").cloned(),
            hardware_version: info_map.get("hardware_ver").cloned(),
            hardware_uid: info_map.get("hardware_uid").cloned(),
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
    let ble_cancel_tx = Arc::clone(&state.ble_cancel_tx);

    tauri::async_runtime::spawn_blocking(move || {
        // Stop any running CLI reader or screen stream thread
        cli_reader_active.store(false, Ordering::Relaxed);
        screen_stream_active.store(false, Ordering::Relaxed);
        *input_event_tx.lock().unwrap() = None;
        // Signal the BLE notification task to exit (if this is a BLE session).
        if let Some(tx) = ble_cancel_tx.lock().unwrap().take() {
            let _ = tx.send(());
        }
        {
            let mut mode = mode_mutex.lock().unwrap();
            *mode = ConnectionMode::Rpc;
        }
        let mut guard = client_mutex.lock().unwrap();
        *guard = None; // Drop closes serial port or BLE transport
        Ok(())
    })
    .await
    .map_err(|e| FlipperError::Internal(e.to_string()))?
}

/// Return the kind of the active connection ("serial" | "ble"), or `None` if not connected.
#[tauri::command]
pub async fn connection_kind(state: State<'_, AppState>) -> Result<Option<TransportKind>> {
    let client_mutex = Arc::clone(&state.client);
    tauri::async_runtime::spawn_blocking(move || {
        let guard = client_mutex.lock().unwrap();
        Ok(guard.as_ref().map(|c| c.kind()))
    })
    .await
    .map_err(|e| FlipperError::Internal(e.to_string()))?
}

/// Get the full device info map from the Flipper — every key/value pair
/// the firmware exposes (hardware_*, firmware_*, radio_*, etc.). Much richer
/// than the subset we squeeze into [`DeviceInfo`] on connect.
#[tauri::command]
pub async fn device_info_all(state: State<'_, AppState>) -> Result<HashMap<String, String>> {
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
        session::get_device_info(client)
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

/// Ping the device and return the round-trip latency in milliseconds.
#[tauri::command]
pub async fn ping(state: State<'_, AppState>) -> Result<u32> {
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
        let started = std::time::Instant::now();
        session::ping(client)?;
        Ok(started.elapsed().as_millis().min(u32::MAX as u128) as u32)
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

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::Result;
use crate::flipper::session;
use crate::state::AppState;

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
    let mut guard = state.client.lock().unwrap();
    *guard = None; // Drop closes the serial port
    Ok(())
}

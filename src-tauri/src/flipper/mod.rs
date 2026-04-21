pub mod app;
pub mod apps;
pub mod ble;
pub mod cli;
pub mod client;
pub mod diag;
pub mod fap_icon;
pub mod framing;
pub mod gui;
pub mod infrared;
pub mod nfc;
pub mod session;
pub mod storage;
pub mod subghz;
pub mod transport;

use std::time::Duration;

/// Normal serial port timeout for RPC commands.
pub const SERIAL_TIMEOUT_NORMAL: Duration = Duration::from_secs(5);
/// Short timeout for draining leftover bytes from the serial port.
pub const SERIAL_TIMEOUT_DRAIN: Duration = Duration::from_millis(200);
/// Short timeout for screen reader thread to minimize mutex hold time.
pub const SERIAL_TIMEOUT_SCREEN: Duration = Duration::from_millis(100);

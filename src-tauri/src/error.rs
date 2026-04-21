use thiserror::Error;

#[derive(Debug, Error)]
pub enum FlipperError {
    #[error("Serial port error: {0}")]
    Serial(#[from] serialport::Error),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Protobuf decode error: {0}")]
    Decode(#[from] prost::DecodeError),

    #[error("Protobuf encode error: {0}")]
    Encode(#[from] prost::EncodeError),

    #[error("Device not connected")]
    NotConnected,

    #[error("RPC error (status={status}) on command {command_id}")]
    Rpc { status: i32, command_id: u32 },

    #[error("Timeout waiting for device response")]
    Timeout,

    #[error("Unexpected response from device")]
    UnexpectedResponse,

    #[error("Session startup failed: {0}")]
    Session(String),

    #[error("Device is in CLI mode — disconnect terminal first")]
    CliModeActive,

    #[error("BLE pairing required — pair the Flipper in your OS Bluetooth settings and try again ({0})")]
    BlePairingRequired(String),

    #[error("Operation not supported over BLE — connect via USB")]
    BleUnsupported,

    #[error("Transfer cancelled")]
    TransferCancelled,

    #[error("Internal error: {0}")]
    Internal(String),
}

// serde::Serialize is required so FlipperError can be returned from #[tauri::command]
impl serde::Serialize for FlipperError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, FlipperError>;

use std::sync::atomic::AtomicBool;
use std::sync::{mpsc, Arc, Mutex};

use crate::flipper::client::FlipperClient;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionMode {
    Rpc,
    Cli,
}

/// Shared slot holding the current screen-stream input-event sender (if the
/// reader thread is running). Cleared by the reader when it exits and by
/// connect/disconnect for safety.
pub type InputEventTx = Arc<Mutex<Option<mpsc::Sender<(i32, i32)>>>>;

pub struct AppState {
    /// The connected Flipper client. Wrapped in Arc so background threads
    /// can share access without holding a reference to the full AppState.
    pub client: Arc<Mutex<Option<FlipperClient>>>,
    pub mode: Arc<Mutex<ConnectionMode>>,
    /// Signals the CLI reader thread to stop.
    pub cli_reader_active: Arc<AtomicBool>,
    /// Signals an in-progress transfer (read/write) to abort.
    pub transfer_cancelled: Arc<AtomicBool>,
    /// Signals the screen stream reader thread to stop.
    pub screen_stream_active: Arc<AtomicBool>,
    /// Signals an in-progress SubGhz library scan to abort.
    pub subghz_scan_cancelled: Arc<AtomicBool>,
    /// Signals an in-progress Infrared library scan to abort.
    pub ir_scan_cancelled: Arc<AtomicBool>,
    /// Signals an in-progress App library scan to abort.
    pub apps_scan_cancelled: Arc<AtomicBool>,
    /// Signals an in-progress NFC library scan to abort.
    pub nfc_scan_cancelled: Arc<AtomicBool>,
    /// Channel for sending input events through the screen reader thread,
    /// avoiding mutex contention between send_input_event and the reader loop.
    /// `Arc` so both the Tauri command handler and the reader thread can hold
    /// a reference — the reader clears this slot when it exits.
    pub input_event_tx: InputEventTx,
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

impl AppState {
    pub fn new() -> Self {
        Self {
            client: Arc::new(Mutex::new(None)),
            mode: Arc::new(Mutex::new(ConnectionMode::Rpc)),
            cli_reader_active: Arc::new(AtomicBool::new(false)),
            transfer_cancelled: Arc::new(AtomicBool::new(false)),
            screen_stream_active: Arc::new(AtomicBool::new(false)),
            subghz_scan_cancelled: Arc::new(AtomicBool::new(false)),
            ir_scan_cancelled: Arc::new(AtomicBool::new(false)),
            apps_scan_cancelled: Arc::new(AtomicBool::new(false)),
            nfc_scan_cancelled: Arc::new(AtomicBool::new(false)),
            input_event_tx: Arc::new(Mutex::new(None)),
        }
    }
}

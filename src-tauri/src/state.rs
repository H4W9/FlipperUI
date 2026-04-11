use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use crate::flipper::client::FlipperClient;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionMode {
    Rpc,
    Cli,
}

pub struct AppState {
    /// The connected Flipper client. Wrapped in Arc so the CLI reader thread
    /// can share access without holding a reference to the full AppState.
    pub client: Arc<Mutex<Option<FlipperClient>>>,
    pub mode: Mutex<ConnectionMode>,
    /// Signals the CLI reader thread to stop.
    pub cli_reader_active: Arc<AtomicBool>,
    /// Signals an in-progress transfer (read/write) to abort.
    pub transfer_cancelled: Arc<AtomicBool>,
    /// Signals the screen stream reader thread to stop.
    pub screen_stream_active: Arc<AtomicBool>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            client: Arc::new(Mutex::new(None)),
            mode: Mutex::new(ConnectionMode::Rpc),
            cli_reader_active: Arc::new(AtomicBool::new(false)),
            transfer_cancelled: Arc::new(AtomicBool::new(false)),
            screen_stream_active: Arc::new(AtomicBool::new(false)),
        }
    }
}

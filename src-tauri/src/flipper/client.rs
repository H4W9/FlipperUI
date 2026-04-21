use std::sync::atomic::{AtomicU32, Ordering};

use crate::flipper::transport::{Transport, TransportKind};

pub struct FlipperClient {
    pub transport: Box<dyn Transport>,
    next_id: AtomicU32,
}

impl FlipperClient {
    pub fn new(transport: Box<dyn Transport>) -> Self {
        Self {
            transport,
            next_id: AtomicU32::new(1),
        }
    }

    /// Returns a monotonically increasing command ID, skipping 0.
    pub fn next_command_id(&self) -> u32 {
        loop {
            let id = self.next_id.fetch_add(1, Ordering::Relaxed);
            if id != 0 {
                return id;
            }
        }
    }

    /// Which transport backs this client — Serial or BLE.
    pub fn kind(&self) -> TransportKind {
        self.transport.kind()
    }
}

use std::sync::atomic::{AtomicU32, Ordering};
use serialport::SerialPort;

pub struct FlipperClient {
    pub port: Box<dyn SerialPort>,
    next_id: AtomicU32,
}

impl FlipperClient {
    pub fn new(port: Box<dyn SerialPort>) -> Self {
        Self {
            port,
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
}

use std::io;
use std::time::Duration;

use serde::{Deserialize, Serialize};

/// A byte-oriented, blocking, framed-protocol-agnostic transport to the Flipper.
///
/// All methods are blocking and honor the timeout set by [`Transport::set_timeout`].
/// Reads return `io::ErrorKind::TimedOut` on deadline miss (matching serialport
/// semantics so existing reader loops need no changes). Permanent disconnection
/// surfaces as `io::ErrorKind::BrokenPipe`.
pub trait Transport: Send {
    /// Read exactly `buf.len()` bytes or return `TimedOut` / `BrokenPipe`.
    fn read_exact(&mut self, buf: &mut [u8]) -> io::Result<()>;

    /// Short read: copy up to `buf.len()` bytes, returning how many were written.
    /// Used by byte-drain / byte-by-byte handshake loops (e.g. `session::open_session`).
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize>;

    /// Write every byte. On BLE this respects peer-side flow-control.
    fn write_all(&mut self, buf: &[u8]) -> io::Result<()>;

    /// Flush buffered writes. On BLE this waits for backpressure to drain.
    fn flush(&mut self) -> io::Result<()>;

    /// Set the blocking timeout applied to subsequent read calls.
    fn set_timeout(&mut self, dur: Duration) -> io::Result<()>;

    /// Which physical transport backs this — used by upper layers for feature gating.
    fn kind(&self) -> TransportKind;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TransportKind {
    Serial,
    Ble,
}

/// Adapter wrapping `Box<dyn serialport::SerialPort>` in the [`Transport`] trait.
pub struct SerialTransport {
    pub port: Box<dyn serialport::SerialPort>,
}

impl SerialTransport {
    pub fn new(port: Box<dyn serialport::SerialPort>) -> Self {
        Self { port }
    }
}

impl Transport for SerialTransport {
    fn read_exact(&mut self, buf: &mut [u8]) -> io::Result<()> {
        std::io::Read::read_exact(&mut self.port, buf)
    }

    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        std::io::Read::read(&mut self.port, buf)
    }

    fn write_all(&mut self, buf: &[u8]) -> io::Result<()> {
        std::io::Write::write_all(&mut self.port, buf)
    }

    fn flush(&mut self) -> io::Result<()> {
        std::io::Write::flush(&mut self.port)
    }

    fn set_timeout(&mut self, dur: Duration) -> io::Result<()> {
        self.port.set_timeout(dur).map_err(io::Error::other)
    }

    fn kind(&self) -> TransportKind {
        TransportKind::Serial
    }
}

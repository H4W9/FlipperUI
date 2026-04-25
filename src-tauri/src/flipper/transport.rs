use std::collections::VecDeque;
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

    /// Push bytes back so the next `read_exact` / `read` returns them first.
    /// Used by the framing layer to roll back a partial read on mid-frame
    /// timeout — without it, a varint byte popped before the timeout would
    /// be lost, desyncing the protobuf framing.
    fn unread(&mut self, bytes: &[u8]);

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
    /// Bytes pushed back via `unread` — drained before any new port read.
    pushback: VecDeque<u8>,
}

impl SerialTransport {
    pub fn new(port: Box<dyn serialport::SerialPort>) -> Self {
        Self {
            port,
            pushback: VecDeque::new(),
        }
    }
}

impl Transport for SerialTransport {
    fn read_exact(&mut self, buf: &mut [u8]) -> io::Result<()> {
        // Drain pushback first.
        let mut filled = 0;
        while filled < buf.len() {
            let Some(b) = self.pushback.pop_front() else {
                break;
            };
            buf[filled] = b;
            filled += 1;
        }
        if filled == buf.len() {
            return Ok(());
        }
        // Read the rest from the port. If we time out partway, push the
        // bytes we did get back into pushback so the caller can roll back
        // cleanly — std `Read::read_exact` would silently drop them.
        let start = filled;
        while filled < buf.len() {
            match std::io::Read::read(&mut self.port, &mut buf[filled..]) {
                Ok(0) => {
                    return Err(io::Error::new(
                        io::ErrorKind::UnexpectedEof,
                        "serial port returned 0 bytes",
                    ));
                }
                Ok(n) => filled += n,
                Err(e) => {
                    if filled > start {
                        self.pushback.extend(buf[start..filled].iter().copied());
                    }
                    return Err(e);
                }
            }
        }
        Ok(())
    }

    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if !self.pushback.is_empty() {
            let take = buf.len().min(self.pushback.len());
            for slot in &mut buf[..take] {
                *slot = self.pushback.pop_front().unwrap();
            }
            return Ok(take);
        }
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

    fn unread(&mut self, bytes: &[u8]) {
        // Prepend so the original byte order is preserved on next read.
        for b in bytes.iter().rev() {
            self.pushback.push_front(*b);
        }
    }

    fn kind(&self) -> TransportKind {
        TransportKind::Serial
    }
}

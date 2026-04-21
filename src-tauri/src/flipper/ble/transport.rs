//! BLE implementation of the [`Transport`] trait.
//!
//! Bridges btleplug's async model into the synchronous byte-oriented shape
//! [`framing`](crate::flipper::framing) expects. Notifications from the TX
//! characteristic are appended into a [`RxBuffer`] guarded by a `Mutex +
//! Condvar`; blocking `read_exact` pops bytes and `wait_timeout`s when empty.
//! Writes chunk payloads to MTU-size pieces and honor the OVERFLOW
//! characteristic's flow-control counter.

use std::collections::VecDeque;
use std::io;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use btleplug::api::{Characteristic, Peripheral as _, WriteType};
use btleplug::platform::Peripheral;

use crate::flipper::ble::runtime::BLE_RT;
use crate::flipper::transport::{Transport, TransportKind};

/// Shared receive-side buffer. The notification task pushes into it; the
/// synchronous reader pops from it, waiting on the condvar when empty.
pub(crate) struct RxBuffer {
    pub bytes: VecDeque<u8>,
    pub closed: bool,
    pub close_reason: Option<String>,
}

pub(crate) struct RxShared {
    pub inner: Mutex<RxBuffer>,
    pub cv: Condvar,
}

impl RxShared {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            inner: Mutex::new(RxBuffer {
                bytes: VecDeque::new(),
                closed: false,
                close_reason: None,
            }),
            cv: Condvar::new(),
        })
    }

    /// Called by the notification task when the peer disconnects.
    pub fn close(&self, reason: impl Into<String>) {
        let mut g = self.inner.lock().unwrap();
        if !g.closed {
            g.closed = true;
            g.close_reason = Some(reason.into());
        }
        self.cv.notify_all();
    }

    /// Called by the notification task when fresh bytes arrive.
    pub fn push(&self, bytes: &[u8]) {
        let mut g = self.inner.lock().unwrap();
        g.bytes.extend(bytes);
        self.cv.notify_all();
    }
}

/// Cap outgoing writes at this many bytes per chunk to stay safely below most
/// negotiated BLE MTUs without probing. Larger chunks are re-fragmented.
const MAX_WRITE_LEN: usize = 160;
/// How long to wait for the firmware's RX buffer to have room for the next
/// chunk. If we blow past this, something is wrong (peer paused, stuck thread).
const FLOW_WAIT_TIMEOUT: Duration = Duration::from_secs(5);
/// Poll interval while spinning on the flow-control counter.
const FLOW_POLL_INTERVAL: Duration = Duration::from_millis(10);

pub struct BleTransport {
    pub(crate) peripheral: Peripheral,
    pub(crate) rx_char: Characteristic,
    pub(crate) rx: Arc<RxShared>,
    pub(crate) overflow: Arc<AtomicU32>,
    pub(crate) timeout: Duration,
}

impl BleTransport {
    pub(crate) fn new(
        peripheral: Peripheral,
        rx_char: Characteristic,
        rx: Arc<RxShared>,
        overflow: Arc<AtomicU32>,
    ) -> Self {
        Self {
            peripheral,
            rx_char,
            rx,
            overflow,
            timeout: Duration::from_secs(5),
        }
    }

    /// Block until the firmware's RX buffer has at least `needed` free bytes.
    /// `self.overflow` is kept as a running estimate: seeded on connect by an
    /// explicit characteristic read, overwritten by FLOW_CTRL notifications,
    /// and decremented locally after each write. It counts FREE bytes, not
    /// pending ones.
    fn wait_free(&self, needed: u32) -> io::Result<()> {
        let deadline = Instant::now() + FLOW_WAIT_TIMEOUT;
        loop {
            let free = self.overflow.load(Ordering::SeqCst);
            if free >= needed {
                return Ok(());
            }
            if Instant::now() >= deadline {
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    format!(
                        "BLE flow control: need {needed} bytes, only {free} free after {:?}",
                        FLOW_WAIT_TIMEOUT
                    ),
                ));
            }
            std::thread::sleep(FLOW_POLL_INTERVAL);
        }
    }
}

impl Transport for BleTransport {
    fn read_exact(&mut self, buf: &mut [u8]) -> io::Result<()> {
        let deadline = Instant::now() + self.timeout;
        let mut filled = 0;
        let mut g = self.rx.inner.lock().unwrap();
        while filled < buf.len() {
            while g.bytes.is_empty() && !g.closed {
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    return Err(io::Error::new(io::ErrorKind::TimedOut, "BLE read timeout"));
                }
                let (ng, wr) = self.rx.cv.wait_timeout(g, remaining).unwrap();
                g = ng;
                if wr.timed_out() && g.bytes.is_empty() && !g.closed {
                    return Err(io::Error::new(io::ErrorKind::TimedOut, "BLE read timeout"));
                }
            }
            if g.closed && g.bytes.is_empty() {
                let reason = g
                    .close_reason
                    .clone()
                    .unwrap_or_else(|| "BLE transport closed".into());
                return Err(io::Error::new(io::ErrorKind::BrokenPipe, reason));
            }
            let take = (buf.len() - filled).min(g.bytes.len());
            for slot in &mut buf[filled..filled + take] {
                *slot = g.bytes.pop_front().unwrap();
            }
            filled += take;
        }
        Ok(())
    }

    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if buf.is_empty() {
            return Ok(0);
        }
        let deadline = Instant::now() + self.timeout;
        let mut g = self.rx.inner.lock().unwrap();
        while g.bytes.is_empty() && !g.closed {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(io::Error::new(io::ErrorKind::TimedOut, "BLE read timeout"));
            }
            let (ng, wr) = self.rx.cv.wait_timeout(g, remaining).unwrap();
            g = ng;
            if wr.timed_out() && g.bytes.is_empty() && !g.closed {
                return Err(io::Error::new(io::ErrorKind::TimedOut, "BLE read timeout"));
            }
        }
        if g.closed && g.bytes.is_empty() {
            let reason = g
                .close_reason
                .clone()
                .unwrap_or_else(|| "BLE transport closed".into());
            return Err(io::Error::new(io::ErrorKind::BrokenPipe, reason));
        }
        let take = buf.len().min(g.bytes.len());
        for slot in &mut buf[..take] {
            *slot = g.bytes.pop_front().unwrap();
        }
        Ok(take)
    }

    fn write_all(&mut self, buf: &[u8]) -> io::Result<()> {
        for piece in buf.chunks(MAX_WRITE_LEN) {
            let n = piece.len() as u32;
            self.wait_free(n)?;
            BLE_RT
                .block_on(self.peripheral.write(
                    &self.rx_char,
                    piece,
                    WriteType::WithoutResponse,
                ))
                .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;
            // Optimistically deduct from our local free-bytes estimate. The
            // firmware will correct us with a FLOW_CTRL notification when it
            // actually consumes the bytes; saturating_sub guards against a
            // concurrent notification race where the notification lowered our
            // value below `n` between wait_free and here.
            let _ = self.overflow.fetch_update(
                Ordering::SeqCst,
                Ordering::SeqCst,
                |v| Some(v.saturating_sub(n)),
            );
        }
        Ok(())
    }

    fn flush(&mut self) -> io::Result<()> {
        // Writes are WriteType::WithoutResponse and there's no OS-level buffer
        // to flush. Flow-control waiting happens per-chunk inside write_all.
        Ok(())
    }

    fn set_timeout(&mut self, dur: Duration) -> io::Result<()> {
        self.timeout = dur;
        Ok(())
    }

    fn kind(&self) -> TransportKind {
        TransportKind::Ble
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rxbuffer_accumulates_across_pushes() {
        let rx = RxShared::new();
        rx.push(&[1, 2, 3]);
        rx.push(&[4, 5]);
        let g = rx.inner.lock().unwrap();
        assert_eq!(g.bytes.iter().copied().collect::<Vec<u8>>(), vec![1, 2, 3, 4, 5]);
    }

    #[test]
    fn rxbuffer_close_sets_flag_once() {
        let rx = RxShared::new();
        rx.close("boom");
        rx.close("second");
        let g = rx.inner.lock().unwrap();
        assert!(g.closed);
        assert_eq!(g.close_reason.as_deref(), Some("boom"));
    }
}

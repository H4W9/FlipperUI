use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::pb;

/// Keep the last N frames so the log can't grow without bound while the app
/// runs with diagnostics on. 500 entries covers roughly 15 s of screen stream
/// traffic, which is long enough to investigate a misbehaving exchange.
const RING_CAP: usize = 500;

static ENABLED: AtomicBool = AtomicBool::new(false);
static BUFFER: OnceLock<Mutex<VecDeque<DiagEntry>>> = OnceLock::new();

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum Direction {
    Tx,
    Rx,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagEntry {
    pub ts_ms: u64,
    pub dir: Direction,
    pub command_id: u32,
    pub command_status: i32,
    pub has_next: bool,
    pub content_kind: String,
    pub payload_bytes: usize,
}

fn buffer() -> &'static Mutex<VecDeque<DiagEntry>> {
    BUFFER.get_or_init(|| Mutex::new(VecDeque::with_capacity(RING_CAP)))
}

pub fn is_enabled() -> bool {
    ENABLED.load(Ordering::Relaxed)
}

pub fn set_enabled(on: bool) {
    ENABLED.store(on, Ordering::Relaxed);
    if !on {
        clear();
    }
}

pub fn clear() {
    if let Ok(mut b) = buffer().lock() {
        b.clear();
    }
}

pub fn snapshot() -> Vec<DiagEntry> {
    buffer()
        .lock()
        .map(|b| b.iter().cloned().collect())
        .unwrap_or_default()
}

/// Log a frame. Called from the framing layer; a no-op when disabled. The
/// enabled check is cheap (atomic load) so leaving the call sites in hot paths
/// is fine.
pub fn log(dir: Direction, msg: &pb::Main, payload_bytes: usize) {
    if !is_enabled() {
        return;
    }
    let ts_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let content_kind = content_kind(msg);
    let entry = DiagEntry {
        ts_ms,
        dir,
        command_id: msg.command_id,
        command_status: msg.command_status,
        has_next: msg.has_next,
        content_kind,
        payload_bytes,
    };
    if let Ok(mut b) = buffer().lock() {
        if b.len() == RING_CAP {
            b.pop_front();
        }
        b.push_back(entry);
    }
}

/// Short human label for the Content variant, e.g. "StorageListRequest".
/// Derived from the Debug repr so it automatically tracks new protobuf
/// variants as the `.proto` files evolve.
fn content_kind(msg: &pb::Main) -> String {
    let Some(c) = &msg.content else {
        return String::new();
    };
    let dbg = format!("{c:?}");
    // Debug renders as e.g. `StorageListRequest(StorageListRequest { ... })` —
    // take the identifier before the first `(`.
    match dbg.find('(') {
        Some(i) => dbg[..i].to_string(),
        None => dbg,
    }
}

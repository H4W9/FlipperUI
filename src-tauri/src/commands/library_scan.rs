use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::error::{FlipperError, Result};
use crate::flipper::client::FlipperClient;
use crate::state::ConnectionMode;

/// Shared path-validation used by every library scan command.
/// Rejects traversal (`..`) and roots outside the Flipper's virtual FS.
fn validate_root(path: &str) -> Result<()> {
    if path.contains("..") {
        return Err(FlipperError::Session(
            "Path traversal (..) is not allowed".into(),
        ));
    }
    if !path.starts_with("/ext") && !path.starts_with("/int") && !path.starts_with("/any") {
        return Err(FlipperError::Session(
            "Path must start with /ext, /int, or /any".into(),
        ));
    }
    Ok(())
}

#[derive(Serialize, Clone)]
struct ScanProgressEvent<'a> {
    scanned: u32,
    total: u32,
    current_path: &'a str,
}

/// Runs the shared pre-scan boilerplate for every per-library Tauri command
/// (subghz / infrared / nfc / badusb / apps / future libraries):
///
/// 1. Validates every root path.
/// 2. Gates the scan on RPC mode (returns `CliModeActive` otherwise).
/// 3. Acquires the client mutex and unwraps the `Option<FlipperClient>`.
/// 4. Builds a `HashMap` of cached entries keyed by `key_of`.
/// 5. Wraps `app.emit(progress_event, …)` in an `FnMut` the library walker can call.
/// 6. Delegates to `scan`, which owns the library-specific walk.
///
/// Must be called from inside `spawn_blocking` — it takes a std mutex lock.
#[allow(clippy::too_many_arguments)]
pub fn run_library_scan<E, F>(
    client_mutex: Arc<Mutex<Option<FlipperClient>>>,
    mode_mutex: Arc<Mutex<ConnectionMode>>,
    cancelled: Arc<AtomicBool>,
    app: AppHandle,
    roots: &[&str],
    progress_event: &'static str,
    cached: Option<Vec<E>>,
    key_of: fn(&E) -> String,
    scan: F,
) -> Result<Vec<E>>
where
    F: FnOnce(
        &mut FlipperClient,
        &HashMap<String, E>,
        &Arc<AtomicBool>,
        &mut dyn FnMut(u32, u32, &str),
    ) -> Result<Vec<E>>,
{
    for root in roots {
        validate_root(root)?;
    }
    {
        let mode = mode_mutex.lock().unwrap();
        if *mode == ConnectionMode::Cli {
            return Err(FlipperError::CliModeActive);
        }
    }
    let mut guard = client_mutex.lock().unwrap();
    let client = guard.as_mut().ok_or(FlipperError::NotConnected)?;

    let cached_map: HashMap<String, E> = cached
        .unwrap_or_default()
        .into_iter()
        .map(|e| (key_of(&e), e))
        .collect();

    let mut on_progress = |scanned: u32, total: u32, current: &str| {
        let _ = app.emit(
            progress_event,
            ScanProgressEvent {
                scanned,
                total,
                current_path: current,
            },
        );
    };

    scan(client, &cached_map, &cancelled, &mut on_progress)
}

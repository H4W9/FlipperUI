use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use base64::Engine;
use tauri::{AppHandle, Emitter, State};

use crate::error::{FlipperError, Result};
use crate::flipper::gui;
use crate::state::{AppState, ConnectionMode};

/// Start the screen stream. Spawns a background thread that reads frames
/// and emits them as `"screen-frame"` events (base64-encoded RGBA, 128x64).
#[tauri::command]
pub fn screen_stream_start(state: State<AppState>, app: AppHandle) -> Result<()> {
    // Must be in RPC mode
    {
        let mode = state.mode.lock().unwrap();
        if *mode == ConnectionMode::Cli {
            return Err(FlipperError::CliModeActive);
        }
    }

    // Check if already streaming
    if state.screen_stream_active.load(Ordering::Relaxed) {
        return Ok(());
    }

    // Start the stream
    {
        let mut guard = state.client.lock().unwrap();
        let client = guard.as_mut().ok_or(FlipperError::NotConnected)?;
        gui::start_screen_stream(client)?;
    }

    state.screen_stream_active.store(true, Ordering::Relaxed);

    let active = Arc::clone(&state.screen_stream_active);
    let client_mutex = Arc::clone(&state.client);

    std::thread::spawn(move || {
        screen_reader_loop(active, client_mutex, app);
    });

    Ok(())
}

/// Stop the screen stream.
#[tauri::command]
pub fn screen_stream_stop(state: State<AppState>) -> Result<()> {
    if !state.screen_stream_active.load(Ordering::Relaxed) {
        return Ok(());
    }

    state.screen_stream_active.store(false, Ordering::Relaxed);

    // Give the reader thread time to exit
    std::thread::sleep(Duration::from_millis(100));

    // Send stop command
    {
        let mut guard = state.client.lock().unwrap();
        if let Some(ref mut client) = *guard {
            let _ = gui::stop_screen_stream(client);
        }
    }

    Ok(())
}

/// Background loop that reads screen frames and emits them.
fn screen_reader_loop(
    active: Arc<AtomicBool>,
    client_mutex: Arc<std::sync::Mutex<Option<crate::flipper::client::FlipperClient>>>,
    app: AppHandle,
) {
    use crate::flipper::framing::read_message;
    use crate::pb::main::Content;

    loop {
        if !active.load(Ordering::Relaxed) {
            break;
        }

        let frame_data = {
            let mut guard = client_mutex.lock().unwrap();
            if let Some(ref mut client) = *guard {
                match read_message(&mut *client.port) {
                    Ok(msg) => {
                        let has_next = msg.has_next;
                        let data = if let Some(Content::GuiScreenFrame(frame)) = msg.content {
                            Some((frame.data, frame.orientation))
                        } else {
                            None
                        };
                        Some((data, has_next))
                    }
                    Err(crate::error::FlipperError::Io(ref e))
                        if e.kind() == std::io::ErrorKind::TimedOut =>
                    {
                        None
                    }
                    Err(_) => {
                        active.store(false, Ordering::Relaxed);
                        break;
                    }
                }
            } else {
                break;
            }
        };

        match frame_data {
            Some((Some((data, _orientation)), _has_next)) => {
                // Convert XBM to RGBA (orange on black for Flipper theme)
                let rgba = gui::xbm_to_rgba(&data, 0xFF8300, 0x000000);
                let b64 = base64::engine::general_purpose::STANDARD.encode(&rgba);
                let _ = app.emit("screen-frame", &b64);
            }
            Some((None, has_next)) => {
                if !has_next {
                    active.store(false, Ordering::Relaxed);
                    break;
                }
            }
            None => {
                // Timeout, continue
                std::thread::sleep(Duration::from_millis(5));
            }
        }
    }
}

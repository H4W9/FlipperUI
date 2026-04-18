use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Emitter, State};

use crate::error::{FlipperError, Result};
use crate::flipper::{cli, client::FlipperClient};
use crate::state::{AppState, ConnectionMode};

/// Enter CLI mode: stop the RPC session and start a reader thread that
/// emits `"cli-output"` events for every chunk of text the Flipper sends.
///
/// This is intentionally synchronous — the working serial I/O is brief and
/// spawn_blocking introduces issues with poll(POLLOUT) on macOS USB CDC.
#[tauri::command]
pub fn cli_start(state: State<AppState>, app: AppHandle) -> Result<()> {
    // Check mode
    {
        let mode = state.mode.lock().unwrap();
        if *mode == ConnectionMode::Cli {
            return Ok(());
        }
    }

    // Stop screen stream if active — it conflicts with CLI mode
    if state.screen_stream_active.swap(false, Ordering::SeqCst) {
        tracing::info!("CLI: stopping active screen stream before entering CLI");
        // Clear input event channel
        let mut tx_guard = state.input_event_tx.lock().unwrap();
        *tx_guard = None;
    }

    // Enter CLI mode on the serial port
    {
        let mut guard = state.client.lock().unwrap();
        let client = guard.as_mut().ok_or(FlipperError::NotConnected)?;
        cli::enter_cli_mode(client)?;
    }

    // Update mode
    {
        let mut mode = state.mode.lock().unwrap();
        *mode = ConnectionMode::Cli;
    }

    // Activate the reader thread
    state.cli_reader_active.store(true, Ordering::Relaxed);

    let active = Arc::clone(&state.cli_reader_active);
    let client_mutex = Arc::clone(&state.client);

    std::thread::spawn(move || {
        cli_reader_loop(active, client_mutex, app);
    });

    Ok(())
}

/// Send a text command to the Flipper CLI.
/// The command is written as raw bytes followed by `\r`.
#[tauri::command]
pub fn cli_send(input: String, state: State<AppState>) -> Result<()> {
    {
        let mode = state.mode.lock().unwrap();
        if *mode != ConnectionMode::Cli {
            return Err(FlipperError::Session("Not in CLI mode".into()));
        }
    }

    let mut guard = state.client.lock().unwrap();
    let client = guard.as_mut().ok_or(FlipperError::NotConnected)?;
    let cmd = format!("{}\r", input);
    client.port.write_all(cmd.as_bytes())?;
    client.port.flush()?;

    Ok(())
}

/// Leave CLI mode: stop the reader thread and re-enter RPC mode.
/// Kept async because exit_cli_mode involves serial I/O that can take a few seconds.
#[tauri::command]
pub async fn cli_stop(state: State<'_, AppState>) -> Result<()> {
    let client_mutex = Arc::clone(&state.client);
    let mode_mutex = Arc::clone(&state.mode);
    let cli_reader_active = Arc::clone(&state.cli_reader_active);

    tauri::async_runtime::spawn_blocking(move || -> Result<()> {
        // Signal the reader thread to stop
        cli_reader_active.store(false, Ordering::SeqCst);

        // Check if we're actually in CLI mode
        {
            let mode = mode_mutex.lock().unwrap();
            if *mode != ConnectionMode::Cli {
                return Ok(());
            }
        }

        // Re-enter RPC mode
        let exit_result = {
            let mut guard = client_mutex.lock().unwrap();
            let client = match guard.as_mut() {
                Some(c) => c,
                None => {
                    let mut mode = mode_mutex.lock().unwrap();
                    *mode = ConnectionMode::Rpc;
                    return Ok(());
                }
            };

            match cli::exit_cli_mode(client) {
                Ok(()) => Ok(()),
                Err(e) => {
                    tracing::error!("CLI: exit_cli_mode failed: {}, tearing down connection", e);
                    *guard = None;
                    Err(e)
                }
            }
        };

        // Always reset mode to Rpc
        {
            let mut mode = mode_mutex.lock().unwrap();
            *mode = ConnectionMode::Rpc;
        }

        exit_result
    })
    .await
    .map_err(|e| FlipperError::Internal(e.to_string()))?
}

/// Background loop that reads from the serial port and emits text as events.
fn cli_reader_loop(
    active: Arc<AtomicBool>,
    client_mutex: Arc<Mutex<Option<FlipperClient>>>,
    app: AppHandle,
) {
    let mut buf = [0u8; 1024];

    loop {
        if !active.load(Ordering::Relaxed) {
            break;
        }

        let result = {
            let mut guard = client_mutex.lock().unwrap();
            if let Some(ref mut client) = *guard {
                match client.port.read(&mut buf) {
                    Ok(n) if n > 0 => Some(Ok(n)),
                    Ok(_) => None,
                    Err(e) if e.kind() == std::io::ErrorKind::TimedOut => None,
                    Err(e) => Some(Err(e)),
                }
            } else {
                break;
            }
        };

        match result {
            Some(Ok(n)) => {
                let text = String::from_utf8_lossy(&buf[..n]).to_string();
                let _ = app.emit("cli-output", &text);
            }
            Some(Err(_)) => {
                let _ = app.emit(
                    "cli-output",
                    "\r\n[serial error — device disconnected]\r\n",
                );
                active.store(false, Ordering::Relaxed);
                break;
            }
            None => {}
        }

        std::thread::sleep(Duration::from_millis(10));
    }
}

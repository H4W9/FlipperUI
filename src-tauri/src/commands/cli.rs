use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Emitter, State};

use crate::error::{FlipperError, Result};
use crate::flipper::{cli, client::FlipperClient};
use crate::state::{AppState, ConnectionMode};

/// Enter CLI mode: stop the RPC session and start a reader thread that
/// emits `"cli-output"` events for every chunk of text the Flipper sends.
#[tauri::command]
pub fn cli_start(state: State<AppState>, app: AppHandle) -> Result<()> {
    // Check mode
    {
        let mode = state.mode.lock().unwrap();
        if *mode == ConnectionMode::Cli {
            return Ok(()); // already in CLI mode
        }
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

    // Clone what the reader thread needs
    let active = Arc::clone(&state.cli_reader_active);
    let client_mutex = Arc::clone(&state.client);

    std::thread::spawn(move || {
        cli_reader_loop(active, client_mutex, app);
    });

    Ok(())
}

/// Send a text command to the Flipper CLI.
/// The command is written as raw bytes followed by `\r`.
/// The Flipper echoes the input and sends its response, which the reader
/// thread picks up and emits as `"cli-output"` events.
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
#[tauri::command]
pub fn cli_stop(state: State<AppState>) -> Result<()> {
    // Signal the reader thread to stop
    state.cli_reader_active.store(false, Ordering::Relaxed);

    // Give the reader thread time to exit (it has a 50ms port timeout + 10ms sleep)
    std::thread::sleep(Duration::from_millis(150));

    // Re-enter RPC mode
    {
        let mut guard = state.client.lock().unwrap();
        let client = guard.as_mut().ok_or(FlipperError::NotConnected)?;
        cli::exit_cli_mode(client)?;
    }

    // Update mode
    {
        let mut mode = state.mode.lock().unwrap();
        *mode = ConnectionMode::Rpc;
    }

    Ok(())
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
                // Client gone — exit
                break;
            }
        };

        match result {
            Some(Ok(n)) => {
                let text = String::from_utf8_lossy(&buf[..n]).to_string();
                let _ = app.emit("cli-output", &text);
            }
            Some(Err(_)) => {
                // Serial error — device likely disconnected
                let _ = app.emit(
                    "cli-output",
                    "\r\n[serial error — device disconnected]\r\n",
                );
                active.store(false, Ordering::Relaxed);
                break;
            }
            None => {
                // No data available — brief sleep to avoid busy-spinning
            }
        }

        std::thread::sleep(Duration::from_millis(10));
    }
}

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use crate::error::{FlipperError, Result};
use crate::flipper::client::FlipperClient;
use crate::flipper::framing::{read_message, write_message};
use crate::pb;
use crate::pb::main::Content;
use crate::pb_gui;

/// Send StartScreenStreamRequest. The Flipper will begin streaming ScreenFrame
/// messages with `has_next=true` until we send StopScreenStreamRequest.
pub fn start_screen_stream(client: &mut FlipperClient) -> Result<u32> {
    let id = client.next_command_id();
    let req = pb::Main {
        command_id: id,
        command_status: 0,
        has_next: false,
        content: Some(Content::GuiStartScreenStreamRequest(
            pb_gui::StartScreenStreamRequest {},
        )),
    };
    write_message(&mut *client.port, &req)?;
    Ok(id)
}

/// Send StopScreenStreamRequest.
pub fn stop_screen_stream(client: &mut FlipperClient) -> Result<()> {
    let id = client.next_command_id();
    let req = pb::Main {
        command_id: id,
        command_status: 0,
        has_next: false,
        content: Some(Content::GuiStopScreenStreamRequest(
            pb_gui::StopScreenStreamRequest {},
        )),
    };
    write_message(&mut *client.port, &req)?;
    // Drain any pending frames
    while let Ok(msg) = read_message(&mut *client.port) {
        if !msg.has_next {
            break;
        }
    }
    Ok(())
}

/// Read screen frames in a loop, calling `on_frame` for each XBM frame received.
/// Runs until `active` is set to false.
pub fn read_screen_frames<F>(
    client: &mut FlipperClient,
    active: &Arc<AtomicBool>,
    mut on_frame: F,
) -> Result<()>
where
    F: FnMut(&[u8], i32), // (xbm_data, orientation)
{
    loop {
        if !active.load(Ordering::Relaxed) {
            break;
        }

        match read_message(&mut *client.port) {
            Ok(msg) => {
                if let Some(Content::GuiScreenFrame(frame)) = msg.content {
                    on_frame(&frame.data, frame.orientation);
                }
                // If has_next is false, stream ended
                if !msg.has_next {
                    break;
                }
            }
            Err(FlipperError::Io(ref e))
                if e.kind() == std::io::ErrorKind::TimedOut =>
            {
                // Timeout — just loop again
                continue;
            }
            Err(_) => {
                break;
            }
        }
    }
    Ok(())
}

/// Send a single input event to the Flipper (key press/release/short/long).
/// key: InputKey enum value (UP=0, DOWN=1, RIGHT=2, LEFT=3, OK=4, BACK=5)
/// input_type: InputType enum value (PRESS=0, RELEASE=1, SHORT=2, LONG=3, REPEAT=4)
pub fn send_input_event(client: &mut FlipperClient, key: i32, input_type: i32) -> Result<()> {
    let id = client.next_command_id();
    let req = pb::Main {
        command_id: id,
        command_status: 0,
        has_next: false,
        content: Some(Content::GuiSendInputEventRequest(
            pb_gui::SendInputEventRequest {
                key,
                r#type: input_type,
            },
        )),
    };
    write_message(&mut *client.port, &req)?;
    Ok(())
}

/// Convert Flipper screen data (1-bit per pixel, 128x64) to RGBA pixels.
///
/// The Flipper sends the raw u8g2 tile buffer: 8 pages of 128 bytes, where each
/// byte packs 8 vertical pixels of one column (bit 0 = top row of the page,
/// bit 7 = bottom row). So for pixel (x, y): `byte = (y/8)*128 + x`, `bit = y%8`.
/// This matches qFlipper's screenstreamer decoder.
pub fn xbm_to_rgba(data: &[u8], fg: u32, bg: u32) -> Vec<u8> {
    let width = 128;
    let height = 64;
    let mut rgba = vec![0u8; width * height * 4];

    let fg_r = ((fg >> 16) & 0xff) as u8;
    let fg_g = ((fg >> 8) & 0xff) as u8;
    let fg_b = (fg & 0xff) as u8;
    let bg_r = ((bg >> 16) & 0xff) as u8;
    let bg_g = ((bg >> 8) & 0xff) as u8;
    let bg_b = (bg & 0xff) as u8;

    for y in 0..height {
        for x in 0..width {
            let byte_idx = (y / 8) * width + x;
            let bit_idx = y % 8;
            let pixel_on = if byte_idx < data.len() {
                (data[byte_idx] >> bit_idx) & 1 == 1
            } else {
                false
            };

            let idx = (y * width + x) * 4;
            if pixel_on {
                rgba[idx] = fg_r;
                rgba[idx + 1] = fg_g;
                rgba[idx + 2] = fg_b;
            } else {
                rgba[idx] = bg_r;
                rgba[idx + 1] = bg_g;
                rgba[idx + 2] = bg_b;
            }
            rgba[idx + 3] = 255; // alpha
        }
    }

    rgba
}

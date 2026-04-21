use crate::error::Result;
use crate::flipper::client::FlipperClient;
use crate::flipper::framing::{read_message, write_message};
use crate::flipper::session::check_response;
use crate::pb;
use crate::pb::main::Content;
use crate::pb_app;

/// Launch a Flipper application by name with optional args.
///
/// For Sub-GHz replay via RPC, launch with empty args and then drive the
/// transmission with [`app_load_file`] + [`app_button_press`] +
/// [`app_button_release`] (this is what the official iOS/Android apps do).
pub fn app_start(client: &mut FlipperClient, name: &str, args: &str) -> Result<()> {
    let id = client.next_command_id();
    let req = pb::Main {
        command_id: id,
        command_status: 0,
        has_next: false,
        content: Some(Content::AppStartRequest(pb_app::StartRequest {
            name: name.to_string(),
            args: args.to_string(),
        })),
    };
    write_message(&mut *client.transport, &req)?;
    let resp = read_message(&mut *client.transport)?;
    check_response(&resp, id)?;
    Ok(())
}

/// Exit the currently running Flipper application.
pub fn app_exit(client: &mut FlipperClient) -> Result<()> {
    let id = client.next_command_id();
    let req = pb::Main {
        command_id: id,
        command_status: 0,
        has_next: false,
        content: Some(Content::AppExitRequest(pb_app::AppExitRequest {})),
    };
    write_message(&mut *client.transport, &req)?;
    let resp = read_message(&mut *client.transport)?;
    check_response(&resp, id)?;
    Ok(())
}

/// Load a file into the currently-running app via RPC.
/// For Sub-GHz, this is the .sub key/RAW file path to transmit.
pub fn app_load_file(client: &mut FlipperClient, path: &str) -> Result<()> {
    let id = client.next_command_id();
    let req = pb::Main {
        command_id: id,
        command_status: 0,
        has_next: false,
        content: Some(Content::AppLoadFileRequest(pb_app::AppLoadFileRequest {
            path: path.to_string(),
        })),
    };
    write_message(&mut *client.transport, &req)?;
    let resp = read_message(&mut *client.transport)?;
    check_response(&resp, id)?;
    Ok(())
}

/// Press a button in the current app's RPC interface.
/// For Sub-GHz with a loaded file, args="" triggers the default "send" action.
pub fn app_button_press(client: &mut FlipperClient, args: &str) -> Result<()> {
    let id = client.next_command_id();
    let req = pb::Main {
        command_id: id,
        command_status: 0,
        has_next: false,
        content: Some(Content::AppButtonPressRequest(pb_app::AppButtonPressRequest {
            args: args.to_string(),
            index: 0,
        })),
    };
    write_message(&mut *client.transport, &req)?;
    let resp = read_message(&mut *client.transport)?;
    check_response(&resp, id)?;
    Ok(())
}

/// Release the previously-pressed button. Ends an in-progress Sub-GHz TX.
pub fn app_button_release(client: &mut FlipperClient) -> Result<()> {
    let id = client.next_command_id();
    let req = pb::Main {
        command_id: id,
        command_status: 0,
        has_next: false,
        content: Some(Content::AppButtonReleaseRequest(
            pb_app::AppButtonReleaseRequest {},
        )),
    };
    write_message(&mut *client.transport, &req)?;
    let resp = read_message(&mut *client.transport)?;
    check_response(&resp, id)?;
    Ok(())
}

pub mod error;
pub mod state;
pub mod flipper;
pub mod commands;

// Include prost-generated protobuf bindings.
// pb.rs references all other packages, so they must all be declared here.
pub mod pb_app {
    include!(concat!(env!("OUT_DIR"), "/pb_app.rs"));
}
pub mod pb_desktop {
    include!(concat!(env!("OUT_DIR"), "/pb_desktop.rs"));
}
pub mod pb_gpio {
    include!(concat!(env!("OUT_DIR"), "/pb_gpio.rs"));
}
pub mod pb_gui {
    include!(concat!(env!("OUT_DIR"), "/pb_gui.rs"));
}
pub mod pb_property {
    include!(concat!(env!("OUT_DIR"), "/pb_property.rs"));
}
pub mod pb_storage {
    include!(concat!(env!("OUT_DIR"), "/pb_storage.rs"));
}
pub mod pb_system {
    include!(concat!(env!("OUT_DIR"), "/pb_system.rs"));
}
pub mod pb {
    include!(concat!(env!("OUT_DIR"), "/pb.rs"));
}

use state::AppState;
use tauri::menu::{AboutMetadataBuilder, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::Emitter;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize logging
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .with(tracing_subscriber::fmt::layer())
        .init();
    
    tracing::info!("FlipperUI starting up");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_drag::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(AppState::new())
        .setup(|app| {
            // Custom app-menu with a "Settings…" item (Cmd+,). Clicking it
            // emits "open-settings" so the frontend can open the dialog.
            // We also reconstruct the standard Edit + Window submenus so
            // Cut/Copy/Paste and Minimize/Close keep working — replacing the
            // default menu drops those unless we add them back.
            let about_meta = AboutMetadataBuilder::new()
                .name(Some("FlipperUI"))
                .version(Some(env!("CARGO_PKG_VERSION")))
                .copyright(Some("in love -maz"))
                .build();

            let settings = MenuItemBuilder::with_id("settings", "Settings…")
                .accelerator("CmdOrCtrl+,")
                .build(app)?;

            let app_submenu = SubmenuBuilder::new(app, "FlipperUI")
                .item(&PredefinedMenuItem::about(
                    app,
                    Some("About FlipperUI"),
                    Some(about_meta),
                )?)
                .separator()
                .item(&settings)
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;

            let edit_submenu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            let window_submenu = SubmenuBuilder::new(app, "Window")
                .minimize()
                .separator()
                .close_window()
                .build()?;

            let menu = MenuBuilder::new(app)
                .items(&[&app_submenu, &edit_submenu, &window_submenu])
                .build()?;
            app.set_menu(menu)?;

            app.on_menu_event(|app, event| {
                if event.id().as_ref() == "settings" {
                    let _ = app.emit("open-settings", ());
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::device::list_ports,
            commands::device::connect,
            commands::device::disconnect,
            commands::device::list_ble_devices,
            commands::device::connect_ble_device,
            commands::device::connection_kind,
            commands::storage::storage_list,
            commands::storage::storage_stat,
            commands::storage::storage_read,
            commands::storage::storage_write,
            commands::storage::storage_mkdir,
            commands::storage::storage_delete,
            commands::storage::storage_rename,
            commands::storage::storage_info,
            commands::storage::storage_timestamp,
            commands::storage::storage_tar_extract,
            commands::storage::cancel_transfer,
            commands::device::power_info,
            commands::device::device_info_all,
            commands::device::reboot,
            commands::cli::cli_start,
            commands::cli::cli_send,
            commands::cli::cli_stop,
            commands::gui::screen_stream_start,
            commands::gui::screen_stream_stop,
            commands::gui::send_input_event,
            commands::diag::diag_enable,
            commands::diag::diag_entries,
            commands::diag::diag_clear,
            commands::diag::diag_is_enabled,
            commands::app::app_start,
            commands::app::app_exit,
            commands::app::subghz_tx_start,
            commands::app::subghz_tx_stop,
            commands::subghz::subghz_scan,
            commands::subghz::subghz_cancel_scan,
            commands::infrared::infrared_scan,
            commands::infrared::infrared_cancel_scan,
            commands::nfc::nfc_scan,
            commands::nfc::nfc_cancel_scan,
            commands::apps::apps_scan,
            commands::apps::apps_cancel_scan,
            commands::apps::apps_read_icon,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

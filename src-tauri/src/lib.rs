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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::device::list_ports,
            commands::device::connect,
            commands::device::disconnect,
            commands::storage::storage_list,
            commands::storage::storage_stat,
            commands::storage::storage_read,
            commands::storage::storage_write,
            commands::storage::storage_mkdir,
            commands::storage::storage_delete,
            commands::storage::storage_rename,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

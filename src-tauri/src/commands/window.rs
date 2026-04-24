//! Window-lifecycle commands.

use tauri::{AppHandle, Manager};

/// Close the splash window and reveal the main window.
///
/// Called by the frontend once it has mounted and the first render is visible.
/// Tolerates the splash window already being gone (e.g. on HMR reloads) and
/// treats missing windows as a no-op rather than an error.
#[tauri::command]
pub fn close_splashscreen(app: AppHandle) {
    if let Some(splash) = app.get_webview_window("splashscreen") {
        let _ = splash.close();
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
}

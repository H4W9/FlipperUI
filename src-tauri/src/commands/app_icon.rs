//! Tauri commands backing the App Icon chooser in Settings.
//!
//! The frontend persists `appearance.appIcon` in `settings.json` and then
//! invokes `set_app_icon` here to apply the choice live. On startup,
//! `lib.rs` calls `apply_app_icon` directly — this module is just the
//! command surface.

use tauri::AppHandle;

use crate::app_icon::{self, VariantDescriptor};
use crate::error::FlipperError;

/// Return the catalogue of icon variants for the chooser UI.
///
/// Called once when the Settings pane mounts. Cheap — runs base64 encoding
/// over a few static PNGs.
#[tauri::command]
pub fn app_icon_variants() -> Vec<VariantDescriptor> {
    app_icon::variants()
}

/// Apply the named variant to all live windows and (on macOS) the Dock.
///
/// Returns the canonical id that was applied. The frontend uses the return
/// value to confirm the swap; if the input id was unknown, the response
/// will read `default` so the UI can correct itself.
#[tauri::command]
pub fn set_app_icon(app: AppHandle, variant: String) -> Result<String, FlipperError> {
    if !app_icon::is_known(&variant) {
        return Err(FlipperError::Internal(format!(
            "unknown app-icon variant: {variant}"
        )));
    }
    let applied = app_icon::apply_app_icon(&app, &variant)?;
    Ok(applied.to_string())
}

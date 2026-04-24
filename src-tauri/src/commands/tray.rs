//! Runtime toggles for the system-tray icon and (on macOS) the dock icon.
//!
//! The frontend persists these preferences via `tauri-plugin-store` and then
//! calls into here to apply them. The tray is created at startup by default;
//! these commands add the ability to remove/re-install it and to switch the
//! macOS activation policy between `Regular` (normal dock presence) and
//! `Accessory` (no dock icon, menubar-only style).

use tauri::AppHandle;

use crate::{install_tray, TRAY_ID};

/// Show or hide the system-tray icon. Idempotent: toggling to the current
/// state is a no-op.
#[tauri::command]
pub fn set_tray_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    if enabled {
        // `remove_tray_by_id` returns None if no tray exists with that id, so
        // we can't use its presence to know whether to install — instead we
        // rely on `install_tray` being fine to call when none exists.
        if app.tray_by_id(TRAY_ID).is_none() {
            install_tray(&app).map_err(|e| e.to_string())?;
        }
    } else {
        let _ = app.remove_tray_by_id(TRAY_ID);
    }
    Ok(())
}

/// Toggle the macOS dock icon. On non-macOS platforms this is a no-op so the
/// frontend can call it unconditionally.
#[tauri::command]
pub fn set_dock_visible(app: AppHandle, visible: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let policy = if visible {
            tauri::ActivationPolicy::Regular
        } else {
            tauri::ActivationPolicy::Accessory
        };
        app.set_activation_policy(policy)
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, visible);
    }
    Ok(())
}

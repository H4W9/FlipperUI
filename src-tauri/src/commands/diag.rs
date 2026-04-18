use crate::error::Result;
use crate::flipper::diag;

#[tauri::command]
pub fn diag_enable(on: bool) -> Result<()> {
    diag::set_enabled(on);
    Ok(())
}

#[tauri::command]
pub fn diag_entries() -> Result<Vec<diag::DiagEntry>> {
    Ok(diag::snapshot())
}

#[tauri::command]
pub fn diag_clear() -> Result<()> {
    diag::clear();
    Ok(())
}

#[tauri::command]
pub fn diag_is_enabled() -> Result<bool> {
    Ok(diag::is_enabled())
}

//! Process-wide Tokio runtime for btleplug.
//!
//! btleplug is async; the rest of FlipperUI runs on blocking threads dispatched
//! from `tauri::async_runtime::spawn_blocking`. Keeping a dedicated multi-thread
//! runtime here lets blocking callers `BLE_RT.block_on(async { ... })` without
//! risk of deadlocking on Tauri's own async runtime.

use btleplug::api::Manager as _;
use btleplug::platform::{Adapter, Manager};
use once_cell::sync::Lazy;
use tokio::runtime::{Builder, Runtime};
use tokio::sync::OnceCell;

use crate::error::{FlipperError, Result};

pub static BLE_RT: Lazy<Runtime> = Lazy::new(|| {
    Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .thread_name("ble-rt")
        .build()
        .expect("failed to build BLE tokio runtime")
});

/// Process-wide BLE adapter, created on first use. Reused across scans and
/// connects so the adapter's peripheral cache — populated when
/// `list_ble_devices` runs — is still there when the user picks a device and
/// we resolve the id in `connect_ble`. Creating a fresh Manager per call
/// produces a fresh (empty) cache and makes the connect path rely entirely on
/// catching another advertisement within its scan window.
static ADAPTER: OnceCell<Adapter> = OnceCell::const_new();

pub async fn shared_adapter() -> Result<Adapter> {
    ADAPTER
        .get_or_try_init(|| async {
            let manager = Manager::new()
                .await
                .map_err(|e| FlipperError::Internal(format!("BLE error: {e}")))?;
            let adapters = manager
                .adapters()
                .await
                .map_err(|e| FlipperError::Internal(format!("BLE error: {e}")))?;
            adapters
                .into_iter()
                .next()
                .ok_or_else(|| FlipperError::Internal("No BLE adapter available".into()))
        })
        .await
        .cloned()
}

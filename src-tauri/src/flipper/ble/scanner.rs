//! BLE device discovery.
//!
//! Runs a short (~1.8 s) scan, filters peripherals by the Flipper Serial service
//! UUID or a `"Flipper "` name prefix, and returns a list of discoverable entries
//! tagged with RSSI and a best-effort `paired` flag derived from cached services.

use std::time::Duration;

use btleplug::api::{Central, CentralEvent, Peripheral as _, ScanFilter};
use futures::StreamExt;

use crate::error::{FlipperError, Result};
use crate::flipper::ble::{
    runtime::{shared_adapter, BLE_RT},
    ADVERTISED_SERVICE, SERIAL_SERVICE,
};

/// A BLE device the user could connect to.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct BleDevice {
    /// Peripheral ID in btleplug's string form — opaque to the frontend but
    /// stable for the lifetime of the adapter/session.
    pub id: String,
    pub name: String,
    pub rssi: Option<i16>,
    /// Heuristic: true iff the peripheral has cached services (implying the OS
    /// has completed bonding and service discovery at least once).
    pub paired: bool,
}

fn map_btle_err(err: impl std::fmt::Display) -> FlipperError {
    FlipperError::Internal(format!("BLE error: {err}"))
}

/// Scan for Flipper devices for ~1.8 s and return what's discoverable.
/// Returns an empty list on systems with no BLE adapter.
pub async fn list_ble_devices() -> Result<Vec<BleDevice>> {
    // No adapter on this host (e.g. Bluetooth disabled, VM without passthrough)
    // is not an error — the UI renders an empty list and prompts the user.
    let Ok(adapter) = shared_adapter().await else {
        return Ok(vec![]);
    };

    // Drain pending events, start an unfiltered scan, wait a bit, then enumerate
    // peripherals. btleplug caches properties so the subsequent `properties()`
    // call returns whatever was seen during the scan.
    //
    // We intentionally do NOT pass a service-UUID ScanFilter: Flipper Zero does
    // not include the Serial service UUID in its primary advertisement — it's
    // only visible after connecting and doing service discovery. On macOS
    // CoreBluetooth a UUID-filtered scan would therefore return zero hits.
    let mut events = adapter.events().await.map_err(map_btle_err)?;
    adapter
        .start_scan(ScanFilter::default())
        .await
        .map_err(map_btle_err)?;

    // Pump events for ~10s — this lets btleplug's caches populate and gives
    // slower-advertising devices a chance to show up.
    let deadline = tokio::time::Instant::now() + Duration::from_millis(10_000);
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            break;
        }
        match tokio::time::timeout(remaining, events.next()).await {
            Ok(Some(CentralEvent::DeviceDiscovered(_))) => {}
            Ok(Some(CentralEvent::DeviceUpdated(_))) => {}
            Ok(Some(_)) => {}
            Ok(None) => break,
            Err(_) => break, // timeout reached
        }
    }

    let _ = adapter.stop_scan().await;

    let peripherals = adapter.peripherals().await.map_err(map_btle_err)?;
    tracing::info!("BLE scan saw {} peripheral(s)", peripherals.len());
    let mut out = Vec::new();
    for p in peripherals {
        let props = match p.properties().await {
            Ok(Some(pr)) => pr,
            _ => {
                tracing::debug!("BLE skip {:?}: no properties", p.id());
                continue;
            }
        };
        let name = props.local_name.clone().unwrap_or_default();
        // Primary match: the 16-bit `0x3083` service UUID that Flipper Zero
        // includes in its advertisement data (expanded via the BT base UUID).
        let matches_advertised = props.services.iter().any(|s| *s == ADVERTISED_SERVICE);
        // Secondary match: the custom Serial service UUID. Not present in the
        // advertisement — only populated in `props.services` once the OS has
        // bonded and cached a service discovery. Treat its presence as a
        // "paired" hint.
        let matches_serial = props.services.iter().any(|s| *s == SERIAL_SERVICE);
        // Tertiary: case-insensitive name heuristic for bonded peripherals
        // where CoreBluetooth returns a cached name even without ad-data.
        let name_looks_like_flipper = name.to_lowercase().contains("flipper");
        tracing::info!(
            "BLE candidate id={} name={:?} services={} rssi={:?} adv=0x3083:{} serial:{} name:{}",
            p.id(),
            name,
            props.services.len(),
            props.rssi,
            matches_advertised,
            matches_serial,
            name_looks_like_flipper,
        );
        if !matches_advertised && !matches_serial && !name_looks_like_flipper {
            continue;
        }
        out.push(BleDevice {
            id: p.id().to_string(),
            name: if name.is_empty() {
                "Flipper (unknown)".into()
            } else {
                name
            },
            rssi: props.rssi,
            // `paired` drives the green icon and sort order in the dialog.
            // Cached SERIAL_SERVICE is a strong signal the OS has bonded
            // already; seeing just 0x3083 only means the device is in range.
            paired: matches_serial,
        });
    }
    tracing::info!("BLE scan returning {} Flipper candidate(s)", out.len());
    Ok(out)
}

/// Blocking wrapper — safe to call from `spawn_blocking` contexts.
pub fn list_ble_devices_blocking() -> Result<Vec<BleDevice>> {
    BLE_RT.block_on(list_ble_devices())
}

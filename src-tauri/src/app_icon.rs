//! Runtime app-icon variants.
//!
//! Holds the catalogue of icon variants the user can switch between in
//! Settings, and the cross-platform plumbing to apply a chosen variant to
//! all live Tauri windows plus — on macOS — the Dock via AppKit.
//!
//! Adding a new variant: drop the source PNG under `icons/<name>/icon.png`,
//! rerun `cargo run --features icon-gen --bin gen_app_icons` to produce
//! sized PNGs (or hand-author them), then add a `Variant` entry below.

use tauri::image::Image;
use tauri::{AppHandle, Manager};
use tauri_plugin_store::StoreExt;

use crate::error::FlipperError;

/// Filename of the persisted-settings store. Mirrors `STORE_FILE` in
/// `src/lib/settings.ts`. The Rust side reads the saved variant during the
/// setup hook so the OS picks up the chosen icon at launch — without a brief
/// flash of the default orange before the frontend can re-apply it.
const STORE_FILE: &str = "settings.json";

/// Top-level key under which all settings live (matches `STORE_KEY`).
const STORE_KEY: &str = "app";

pub const VARIANT_DEFAULT: &str = "default";
pub const VARIANT_DARK: &str = "dark";

/// Bytes for each variant's primary icon (the largest pre-rendered size).
/// We keep just one resolution per variant — `tauri::image::Image` decodes the
/// PNG once at startup and all callers share the resulting bitmap; `set_icon`
/// scales as needed for the platform's icon slots.
const DEFAULT_ICON_PNG: &[u8] = include_bytes!("../icons/128x128@2x.png");
const DARK_ICON_PNG: &[u8] = include_bytes!("../icons/dark/128x128@2x.png");

/// Public-facing description of a single icon choice. Mirrored on the
/// frontend by `AppIconVariant` in `lib/tauri.ts`.
#[derive(Debug, Clone, serde::Serialize)]
pub struct VariantDescriptor {
    /// Stable identifier persisted in settings.json. Adding new variants
    /// must not change existing ids.
    pub id: &'static str,
    /// Short human-readable name shown next to the thumbnail.
    pub label: &'static str,
    /// Base64-encoded PNG bytes for the chooser thumbnail. Encoded in Rust
    /// so the frontend doesn't need filesystem access to the bundled icons.
    pub png_base64: String,
}

/// Internal table backing the public list. Order here = order rendered in
/// the chooser, so `default` stays first.
struct Variant {
    id: &'static str,
    label: &'static str,
    png: &'static [u8],
}

const VARIANTS: &[Variant] = &[
    Variant {
        id: VARIANT_DEFAULT,
        label: "Default",
        png: DEFAULT_ICON_PNG,
    },
    Variant {
        id: VARIANT_DARK,
        label: "Dark",
        png: DARK_ICON_PNG,
    },
];

/// Return the list of variants for the chooser UI. Cheap to call: the PNG
/// bytes are static and base64 encoding runs O(n) over ~20 KB.
pub fn variants() -> Vec<VariantDescriptor> {
    use base64::Engine;
    let engine = base64::engine::general_purpose::STANDARD;
    VARIANTS
        .iter()
        .map(|v| VariantDescriptor {
            id: v.id,
            label: v.label,
            png_base64: engine.encode(v.png),
        })
        .collect()
}

/// Look up the embedded PNG bytes for a variant id. Falls back to the default
/// variant when the id is unknown — this keeps the app launchable even if
/// settings.json holds a stale variant from a removed plugin / older build.
fn png_for(id: &str) -> &'static [u8] {
    VARIANTS
        .iter()
        .find(|v| v.id == id)
        .map(|v| v.png)
        .unwrap_or(DEFAULT_ICON_PNG)
}

/// True when `id` matches a known variant. The frontend should reject
/// unknown ids before calling `apply_app_icon`, but we double-check here so
/// the command surface can return a clean error.
pub fn is_known(id: &str) -> bool {
    VARIANTS.iter().any(|v| v.id == id)
}

/// Apply the named variant to every visible piece of the app:
///
/// - all webview windows get `set_icon` (drives the Windows taskbar icon and
///   the title-bar icon on Linux; a no-op visually on macOS where windows
///   don't show icons)
/// - on macOS only, the Dock icon is swapped via
///   `NSApplication.setApplicationIconImage_`
///
/// Returns the variant id that was actually applied — the input verbatim
/// when valid, or `default` after a fallback.
pub fn apply_app_icon(app: &AppHandle, id: &str) -> Result<&'static str, FlipperError> {
    // Resolve to a canonical &'static str up-front. This serves both as the
    // return value and as a copy-friendly id we can move into the macOS
    // dispatch closure without lifetime juggling.
    let canonical: &'static str = VARIANTS
        .iter()
        .find(|v| v.id == id)
        .map(|v| v.id)
        .unwrap_or_else(|| {
            tracing::warn!("unknown app-icon variant '{id}', falling back to default");
            VARIANT_DEFAULT
        });
    let png = png_for(canonical);
    let image = Image::from_bytes(png)
        .map_err(|e| FlipperError::Internal(format!("decode app-icon PNG: {e}")))?;

    for window in app.webview_windows().values() {
        if let Err(e) = window.set_icon(image.clone()) {
            // Window-icon failures are non-fatal: the Dock is the more visible
            // surface on macOS, and a stale window icon just means the next
            // launch will fix it. Log and keep going.
            tracing::warn!("set_icon failed for window '{}': {e}", window.label());
        }
    }

    // Windows taskbar icon — Tauri's `set_icon` above handles the title-bar
    // icon (ICON_SMALL) but does not reliably update the taskbar (ICON_BIG).
    // We create an HICON from the PNG pixels and send WM_SETICON explicitly.
    #[cfg(target_os = "windows")]
    {
        if let Err(e) = apply_taskbar_icon(app, png) {
            tracing::warn!("taskbar-icon apply failed: {e}");
        }
    }

    // macOS Dock icon must be set on the AppKit main thread.
    // - Setup hook: already on main → `run_on_main_thread` posts onto the
    //   event loop and runs before the window becomes visible.
    // - Tauri commands: dispatched off-thread → `run_on_main_thread` hops
    //   us back onto AppKit's main queue.
    // Either way the actual setApplicationIconImage_ call happens on the
    // right thread, and we don't block the caller.
    //
    // Two writes happen here:
    //   1. setApplicationIconImage_ — the *running* process's Dock tile.
    //   2. NSWorkspace setIcon:forFile: — a Finder custom icon attached to
    //      the .app bundle. This is what the Dock launcher and Finder show
    //      *before* the process starts and *after* it exits. Writing it
    //      removes the brief "default-icon flash" during launch/quit.
    //
    // For the default variant, the bundle write clears any prior custom
    // icon so the bundled built-in .icns shows again — matching what a
    // fresh install looks like.
    #[cfg(target_os = "macos")]
    {
        let variant_id: &'static str = canonical;
        let dispatch_result = app.run_on_main_thread(move || {
            if let Err(e) = apply_dock_icon(png) {
                tracing::warn!("dock-icon apply failed: {e}");
            }
            // Bundle-icon write is best-effort: if the .app is on a
            // read-only volume or the user moved it to /Applications
            // without admin rights, we degrade to runtime-only swap.
            if allow_bundle_icon_write() {
                if let Err(e) = apply_bundle_icon(png, variant_id) {
                    tracing::info!("bundle-icon apply skipped: {e}");
                }
            }
        });
        if let Err(e) = dispatch_result {
            tracing::warn!("dock-icon dispatch failed: {e}");
        }
    }

    Ok(canonical)
}

#[cfg(target_os = "macos")]
fn allow_bundle_icon_write() -> bool {
    matches!(
        std::env::var("FLIPPERUI_ALLOW_BUNDLE_ICON_WRITE").as_deref(),
        Ok("1" | "true" | "TRUE" | "yes" | "YES")
    )
}

#[cfg(target_os = "macos")]
fn apply_dock_icon(png: &[u8]) -> Result<(), FlipperError> {
    use objc2::rc::autoreleasepool;
    use objc2::AnyThread;
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::{MainThreadMarker, NSData};

    // setApplicationIconImage: must be called on the main thread; Tauri's
    // setup hook and Tauri commands invoked via spawn-on-main both run there.
    let mtm = MainThreadMarker::new().ok_or_else(|| {
        FlipperError::Internal("apply_dock_icon called off the main thread".into())
    })?;

    autoreleasepool(|_| {
        let data = NSData::with_bytes(png);
        let image = NSImage::initWithData(NSImage::alloc(), &data)
            .ok_or_else(|| FlipperError::Internal("NSImage::initWithData returned nil".into()))?;
        let app = NSApplication::sharedApplication(mtm);
        unsafe { app.setApplicationIconImage(Some(&image)) };
        Ok(())
    })
}

#[cfg(not(target_os = "macos"))]
#[allow(dead_code)]
fn apply_dock_icon(_png: &[u8]) -> Result<(), FlipperError> {
    Ok(())
}

/// Create an HICON from RGBA pixel data and send `WM_SETICON` with
/// `ICON_BIG` to every Tauri window, which updates the taskbar icon.
///
/// Tauri's `window.set_icon` only sets `ICON_SMALL` reliably on Windows,
/// leaving the taskbar showing the executable's embedded icon.
#[cfg(target_os = "windows")]
fn apply_taskbar_icon(app: &AppHandle, png: &[u8]) -> Result<(), FlipperError> {
    use windows::Win32::Foundation::{LPARAM, WPARAM};
    use windows::Win32::Graphics::Gdi::{
        CreateBitmap, CreateDIBSection, DeleteObject, GetDC, ReleaseDC, BITMAPINFO,
        BITMAPINFOHEADER, DIB_RGB_COLORS, RGBQUAD,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateIconIndirect, SendMessageW, ICONINFO, ICON_BIG, WM_SETICON,
    };

    let image = Image::from_bytes(png)
        .map_err(|e| FlipperError::Internal(format!("decode app-icon PNG: {e}")))?;

    let width = image.width() as i32;
    let height = image.height() as i32;
    let rgba = image.rgba();

    // Windows DIBs expect BGRA pixel order.
    let mut bgra = rgba.to_vec();
    for pixel in bgra.chunks_exact_mut(4) {
        pixel.swap(0, 2);
    }

    unsafe {
        let hdc = GetDC(None);

        let mut bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                biHeight: -height, // negative = top-down DIB
                biPlanes: 1,
                biBitCount: 32,
                ..Default::default()
            },
            bmiColors: [RGBQUAD::default(); 1],
        };

        let mut bits: *mut std::ffi::c_void = std::ptr::null_mut();
        let color_bmp = CreateDIBSection(Some(hdc), &bmi, DIB_RGB_COLORS, &mut bits, None, 0)
            .map_err(|e| {
                ReleaseDC(None, hdc);
                FlipperError::Internal(format!("CreateDIBSection: {e}"))
            })?;
        std::ptr::copy_nonoverlapping(bgra.as_ptr(), bits as *mut u8, bgra.len());

        let mask_bmp = CreateBitmap(width, height, 1, 1, None);

        let icon_info = ICONINFO {
            fIcon: true.into(),
            xHotspot: 0,
            yHotspot: 0,
            hbmMask: mask_bmp,
            hbmColor: color_bmp,
        };

        let hicon = CreateIconIndirect(&icon_info).map_err(|e| {
            let _ = DeleteObject(color_bmp.into());
            let _ = DeleteObject(mask_bmp.into());
            ReleaseDC(None, hdc);
            FlipperError::Internal(format!("CreateIconIndirect: {e}"))
        })?;

        let _ = DeleteObject(color_bmp.into());
        let _ = DeleteObject(mask_bmp.into());
        ReleaseDC(None, hdc);

        for window in app.webview_windows().values() {
            if let Ok(hwnd) = window.hwnd() {
                SendMessageW(
                    hwnd,
                    WM_SETICON,
                    Some(WPARAM(ICON_BIG as usize)),
                    Some(LPARAM(hicon.0 as isize)),
                );
            }
        }

        // Intentionally leak the HICON — the OS references the handle for
        // the taskbar tile, and icon changes are rare user actions.

        Ok(())
    }
}

/// Write a Finder custom icon onto the running `.app` bundle so the Dock
/// launcher and Finder show the chosen icon *before* our process starts and
/// *after* it exits — eliminating the "default-icon flash" the runtime-only
/// override leaves behind.
///
/// For the default variant we pass `nil` to NSWorkspace.setIcon, which
/// removes any prior custom icon and falls back to the bundle's built-in
/// `.icns`. Same end result, no leftover override.
///
/// This is best-effort: bundles on read-only volumes (some `/Applications`
/// installs without admin rights, signed App Store builds) reject the write.
/// We surface those as `Err` so the caller can log; runtime-only swap still
/// works in those cases.
#[cfg(target_os = "macos")]
fn apply_bundle_icon(png: &[u8], variant_id: &str) -> Result<(), FlipperError> {
    use objc2::rc::autoreleasepool;
    use objc2::AnyThread;
    use objc2_app_kit::{NSImage, NSWorkspace, NSWorkspaceIconCreationOptions};
    use objc2_foundation::{NSBundle, NSData, NSString};

    autoreleasepool(|_| {
        let bundle = NSBundle::mainBundle();
        let bundle_path: objc2::rc::Retained<NSString> = bundle.bundlePath();
        let path_str = bundle_path.to_string();

        // `npm run tauri dev` runs the bare executable, not a `.app`.
        // Setting an icon on `target/debug/flipperui` does nothing useful
        // — skip without erroring so dev mode stays clean.
        if !path_str.ends_with(".app") {
            return Err(FlipperError::Internal(format!(
                "not a .app bundle: {path_str}"
            )));
        }

        let workspace = NSWorkspace::sharedWorkspace();

        // For the default variant, clear any prior custom icon. Passing
        // `None` to setIcon makes the bundle fall back to its built-in
        // .icns — the cleanest "back to normal" state.
        let image = if variant_id == VARIANT_DEFAULT {
            None
        } else {
            let data = NSData::with_bytes(png);
            Some(
                NSImage::initWithData(NSImage::alloc(), &data).ok_or_else(|| {
                    FlipperError::Internal("NSImage::initWithData returned nil".into())
                })?,
            )
        };

        let success = workspace.setIcon_forFile_options(
            image.as_deref(),
            &bundle_path,
            NSWorkspaceIconCreationOptions(0),
        );
        if !success {
            return Err(FlipperError::Internal(format!(
                "NSWorkspace setIcon returned false for {path_str} (bundle may be read-only)"
            )));
        }
        Ok(())
    })
}

#[cfg(not(target_os = "macos"))]
#[allow(dead_code)]
fn apply_bundle_icon(_png: &[u8], _variant_id: &str) -> Result<(), FlipperError> {
    Ok(())
}

/// Read the saved variant from `settings.json` so it can be applied during
/// the setup hook. Returns `default` for any failure mode (missing file,
/// unparseable JSON, missing key, unknown variant) — none of which should
/// block app launch.
pub fn load_saved_variant(app: &AppHandle) -> &'static str {
    let store = match app.store(STORE_FILE) {
        Ok(s) => s,
        Err(e) => {
            tracing::debug!("app-icon: store unavailable, using default ({e})");
            return VARIANT_DEFAULT;
        }
    };
    let Some(root) = store.get(STORE_KEY) else {
        return VARIANT_DEFAULT;
    };
    let id = root
        .get("appearance")
        .and_then(|a| a.get("appIcon"))
        .and_then(|v| v.as_str());
    match id {
        Some(id) if is_known(id) => VARIANTS
            .iter()
            .find(|v| v.id == id)
            .map(|v| v.id)
            .unwrap_or(VARIANT_DEFAULT),
        Some(other) => {
            tracing::warn!("app-icon: unknown saved variant '{other}', using default");
            VARIANT_DEFAULT
        }
        None => VARIANT_DEFAULT,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn variants_include_default_and_dark() {
        let ids: Vec<&str> = VARIANTS.iter().map(|v| v.id).collect();
        assert!(ids.contains(&VARIANT_DEFAULT));
        assert!(ids.contains(&VARIANT_DARK));
    }

    #[test]
    fn variants_have_unique_ids() {
        let mut seen = std::collections::HashSet::new();
        for v in VARIANTS {
            assert!(seen.insert(v.id), "duplicate variant id: {}", v.id);
        }
    }

    #[test]
    fn default_is_first_for_chooser_ordering() {
        assert_eq!(VARIANTS[0].id, VARIANT_DEFAULT);
    }

    #[test]
    fn variant_descriptors_round_trip_to_base64() {
        use base64::Engine;
        let engine = base64::engine::general_purpose::STANDARD;
        let descriptors = variants();
        assert_eq!(descriptors.len(), VARIANTS.len());
        for (descriptor, source) in descriptors.iter().zip(VARIANTS.iter()) {
            let decoded = engine.decode(&descriptor.png_base64).expect("valid base64");
            assert_eq!(decoded.as_slice(), source.png);
        }
    }

    #[test]
    fn unknown_id_falls_back_to_default() {
        assert_eq!(png_for("nope-not-a-real-variant"), DEFAULT_ICON_PNG);
        assert!(!is_known("nope-not-a-real-variant"));
    }

    #[test]
    fn embedded_pngs_decode_as_images() {
        for v in VARIANTS {
            let img = tauri::image::Image::from_bytes(v.png)
                .unwrap_or_else(|e| panic!("variant {}: {e}", v.id));
            assert!(img.width() > 0 && img.height() > 0);
        }
    }
}

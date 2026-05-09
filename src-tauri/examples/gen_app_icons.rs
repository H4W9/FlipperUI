//! One-shot generator for dark-mode app-icon PNGs.
//!
//! Walks every PNG under `icons/` named in `SOURCE_FILES`, recolours each
//! warm orange-y pixel into a near-black tone while preserving alpha and
//! whites/greys, and writes the result to `icons/dark/<same-name>.png`.
//!
//! Run after editing the source orange icons, or after adding a new size:
//!
//! ```text
//! cargo run --features icon-gen --example gen_app_icons
//! ```
//!
//! Re-running is idempotent — it overwrites the destination files.

use std::fs;
use std::path::{Path, PathBuf};

use image::{ImageReader, RgbaImage};

/// Files that get a dark-mode counterpart. These are the icons referenced at
/// runtime via `include_bytes!` in `app_icon.rs`. Bundled-only formats
/// (`icon.icns`, `icon.ico`, Square*Logo for Windows tiles) are not regenerated
/// here — the dark variant is applied in-process via `window.set_icon`, so the
/// bundled binaries don't need a dark replica.
const SOURCE_FILES: &[&str] = &[
    "32x32.png",
    "64x64.png",
    "128x128.png",
    "128x128@2x.png",
    "icon.png",
];

/// Replacement colour for the orange. Almost-black, intentionally a touch off
/// pure `#000000` so it does not look like a missing/cleared icon on dark
/// macOS / Windows backgrounds.
const DARK_R: u8 = 0x0A;
const DARK_G: u8 = 0x0A;
const DARK_B: u8 = 0x0A;

fn main() {
    let manifest_dir = env_var("CARGO_MANIFEST_DIR");
    let src_dir: PathBuf = Path::new(&manifest_dir).join("icons");
    let dst_dir: PathBuf = src_dir.join("dark");
    fs::create_dir_all(&dst_dir).expect("create dark icons dir");

    for name in SOURCE_FILES {
        let src = src_dir.join(name);
        let dst = dst_dir.join(name);
        recolour(&src, &dst).unwrap_or_else(|err| {
            eprintln!("failed to process {}: {err}", src.display());
            std::process::exit(1);
        });
        println!("dark-icon: {} -> {}", src.display(), dst.display());
    }
}

fn env_var(name: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| {
        // Fallback for `cargo run` invocations where the env var is missing
        // — assume the binary was launched from the crate root.
        ".".to_string()
    })
}

fn recolour(src: &Path, dst: &Path) -> Result<(), String> {
    let img = ImageReader::open(src)
        .map_err(|e| format!("open {}: {e}", src.display()))?
        .decode()
        .map_err(|e| format!("decode {}: {e}", src.display()))?;
    let mut rgba: RgbaImage = img.to_rgba8();

    for px in rgba.pixels_mut() {
        let [r, g, b, a] = px.0;
        if a == 0 {
            continue;
        }
        if is_orange(r, g, b) {
            // Preserve original luminance so anti-aliased pixels along edges
            // smoothly fade out. We scale the dark replacement by how strongly
            // the source pixel was "filled" relative to peak orange.
            let intensity = r as u32; // R dominates orange; gives a clean ramp.
            let scale = intensity.min(255) as f32 / 255.0;
            px.0 = [
                (DARK_R as f32 * scale).round() as u8,
                (DARK_G as f32 * scale).round() as u8,
                (DARK_B as f32 * scale).round() as u8,
                a,
            ];
        }
        // White / grey / other pixels (text glyphs, anti-aliased white) pass
        // through untouched.
    }

    rgba.save(dst)
        .map_err(|e| format!("write {}: {e}", dst.display()))
}

/// Heuristic for "this pixel is part of the FlipperUI orange brand fill".
///
/// The default icon is two-tone (orange `#FF8200`-ish + white) on a transparent
/// background. We treat any pixel where the red channel clearly dominates,
/// blue is low, and the pixel is not nearly grey/white as orange. This
/// catches anti-aliased edges as well as the solid fill, while leaving white
/// glyphs and any future neutral details alone.
fn is_orange(r: u8, g: u8, b: u8) -> bool {
    // Reject near-white / near-grey: if min channel is high or channels are
    // close together, it is not the orange we want to swap.
    let min = r.min(g).min(b);
    let max = r.max(g).max(b);
    if min as u16 + 30 > max as u16 {
        // low chroma — grey-ish
        return false;
    }
    if min > 200 {
        // very bright across all channels — white-ish
        return false;
    }
    // Orange shape: R > G > B with R clearly above B.
    r > g && g >= b && (r as i32 - b as i32) > 60
}

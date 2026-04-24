//! Extract the 10x10 icon from a Flipper `.fap` (ELF) file's `.fapmeta` section.
//!
//! `.fap` files are ELF binaries with an embedded manifest section named
//! `.fapmeta`. The manifest starts with a 4-byte magic (0x52474448) followed
//! by a version-dependent struct. Across firmware revisions the exact field
//! layout shifts, but every layout contains the same two adjacent fields:
//! a 32-byte null-padded ASCII app name, followed by a 32-byte icon buffer
//! (only the first 20 bytes are used for a 10x10 XBM-style bitmap; the rest
//! is padding).
//!
//! Rather than hardcode a single struct layout, we scan the section for a
//! plausible name/icon adjacency and return the 32-byte icon slot. This is
//! resilient across manifest versions without needing to track every revision.
//!
//! The returned bytes are XBM-format (u8g2 convention used by Flipper canvas):
//! row-major, 2 bytes per row for 10 pixels, bit 0 = leftmost pixel.

use object::{Object, ObjectSection};

const MANIFEST_MAGIC: u32 = 0x5247_4448;
const NAME_LEN: usize = 32;
const ICON_LEN: usize = 32;

/// Extracted icon data + the app name discovered alongside it. Name is
/// useful for future manifest-aware UI but the current integration only
/// needs the bitmap.
#[derive(Debug, Clone)]
pub struct FapIconData {
    pub icon: [u8; ICON_LEN],
    pub name: String,
}

/// Parse a `.fap` (ELF) and return its embedded icon, if any.
///
/// Returns `None` if:
/// * the bytes aren't a valid ELF
/// * there's no `.fapmeta` section
/// * the manifest magic doesn't match
/// * no plausible name/icon adjacency is found
/// * the icon region is entirely zeros (app ships without an icon)
pub fn extract(fap_bytes: &[u8]) -> Option<FapIconData> {
    let obj = object::File::parse(fap_bytes).ok()?;
    let section = obj.section_by_name(".fapmeta")?;
    let data = section.uncompressed_data().ok()?;

    if data.len() < 8 + NAME_LEN + ICON_LEN {
        return None;
    }
    let magic = u32::from_le_bytes(data[0..4].try_into().ok()?);
    if magic != MANIFEST_MAGIC {
        return None;
    }

    // Scan offsets from 8 (past magic + version) up to the last position
    // where a full name + icon still fits. `step_by(1)` because 16-bit
    // fields can make name alignment odd across manifest versions.
    let last = data.len().saturating_sub(NAME_LEN + ICON_LEN);
    for offset in 8..=last {
        let Some(name) = try_read_name(&data[offset..offset + NAME_LEN]) else {
            continue;
        };
        let icon_start = offset + NAME_LEN;
        let icon_bytes = &data[icon_start..icon_start + ICON_LEN];
        if icon_bytes.iter().all(|&b| b == 0) {
            continue;
        }
        let mut icon = [0u8; ICON_LEN];
        icon.copy_from_slice(icon_bytes);
        return Some(FapIconData { icon, name });
    }
    None
}

/// A valid name slot is: 1..31 printable-ASCII bytes, then a null, then
/// pure null padding to the end of the 32-byte field. This rules out
/// random binary data and partially-populated struct fields that happen
/// to contain a null byte.
fn try_read_name(slice: &[u8]) -> Option<String> {
    debug_assert_eq!(slice.len(), NAME_LEN);
    let first_null = slice.iter().position(|&b| b == 0)?;
    if !(1..NAME_LEN).contains(&first_null) {
        return None;
    }
    let name = &slice[..first_null];
    if !name.iter().all(|&b| b.is_ascii_graphic() || b == b' ') {
        return None;
    }
    if slice[first_null..].iter().any(|&b| b != 0) {
        return None;
    }
    String::from_utf8(name.to_vec()).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_elf() {
        assert!(extract(b"not an elf file").is_none());
    }

    #[test]
    fn rejects_short_input() {
        assert!(extract(&[0u8; 10]).is_none());
    }

    #[test]
    fn name_validator_accepts_padded_name() {
        let mut slice = [0u8; 32];
        slice[..4].copy_from_slice(b"Test");
        assert_eq!(try_read_name(&slice).as_deref(), Some("Test"));
    }

    #[test]
    fn name_validator_rejects_trailing_garbage() {
        let mut slice = [0u8; 32];
        slice[..4].copy_from_slice(b"Test");
        slice[10] = 0xff;
        assert!(try_read_name(&slice).is_none());
    }

    #[test]
    fn name_validator_rejects_empty_name() {
        let slice = [0u8; 32];
        assert!(try_read_name(&slice).is_none());
    }

    #[test]
    fn name_validator_rejects_unterminated_name() {
        let slice = [b'A'; 32];
        assert!(try_read_name(&slice).is_none());
    }

    #[test]
    fn name_validator_rejects_non_printable() {
        let mut slice = [0u8; 32];
        slice[0] = 0x01;
        slice[1] = 0x02;
        assert!(try_read_name(&slice).is_none());
    }
}

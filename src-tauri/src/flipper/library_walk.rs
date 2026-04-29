//! Path / extension / exclusion helpers shared by every per-library scanner.
//!
//! Each `flipper/<lib>.rs` (nfc, rfid, infrared, subghz, badusb, apps) used to
//! carry near-identical copies of these. Centralising them here means a fix to
//! the path-rebuild or exclusion semantics lands in one place — and adding the
//! next library doesn't grow the duplication count.

/// Progress callback fired after each parsed file. `scanned` ≤ `total`.
/// Re-exported under the same alias each scanner already used so call sites
/// don't need to change.
pub type ScanProgress<'a> = &'a mut dyn FnMut(u32, u32, &str);

/// True if `path` is `excluded` itself or sits underneath an `excluded`
/// entry. Trailing slashes on entries are tolerated.
pub fn is_excluded(path: &str, excluded: &[String]) -> bool {
    excluded.iter().any(|ex| {
        let ex = ex.trim_end_matches('/');
        path == ex || path.starts_with(&format!("{ex}/"))
    })
}

/// Case-insensitive extension match. `ext_with_dot` must include the leading
/// dot (e.g. `".nfc"`, `".rfid"`).
pub fn has_extension_ci(name: &str, ext_with_dot: &str) -> bool {
    name.len() >= ext_with_dot.len()
        && name[name.len() - ext_with_dot.len()..].eq_ignore_ascii_case(ext_with_dot)
}

/// Concatenate `parent` and `child` with exactly one `/` between them.
pub fn join_path(parent: &str, child: &str) -> String {
    if parent.ends_with('/') {
        format!("{parent}{child}")
    } else {
        format!("{parent}/{child}")
    }
}

/// Last path segment, mirroring POSIX `basename`. Falls back to the whole
/// string when there is no `/`.
pub fn file_basename(path: &str) -> &str {
    path.rsplit_once('/').map(|(_, b)| b).unwrap_or(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn excluded_self_and_descendants() {
        let excluded = vec!["/ext/foo".to_string()];
        assert!(is_excluded("/ext/foo", &excluded));
        assert!(is_excluded("/ext/foo/bar", &excluded));
        assert!(!is_excluded("/ext/foobar", &excluded));
        assert!(!is_excluded("/ext/other", &excluded));
    }

    #[test]
    fn extension_match_is_case_insensitive() {
        assert!(has_extension_ci("a.nfc", ".nfc"));
        assert!(has_extension_ci("A.NFC", ".nfc"));
        assert!(has_extension_ci("file.RFID", ".rfid"));
        assert!(!has_extension_ci("a.nf", ".nfc"));
        assert!(!has_extension_ci("nfc", ".nfc"));
    }

    #[test]
    fn join_path_handles_trailing_slash() {
        assert_eq!(join_path("/ext/nfc", "x.nfc"), "/ext/nfc/x.nfc");
        assert_eq!(join_path("/ext/nfc/", "x.nfc"), "/ext/nfc/x.nfc");
    }

    #[test]
    fn basename_strips_directory() {
        assert_eq!(file_basename("/ext/nfc/x.nfc"), "x.nfc");
        assert_eq!(file_basename("x.nfc"), "x.nfc");
    }
}

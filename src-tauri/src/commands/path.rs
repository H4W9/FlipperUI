use crate::error::{FlipperError, Result};

/// Roots accepted by the Flipper firmware's storage namespace.
const VALID_ROOTS: [&str; 3] = ["/ext", "/int", "/any"];

/// Validate that a Flipper storage path is safe.
///
/// Rules:
/// - Must be exactly one of `VALID_ROOTS` or live below it (so `/ext` and
///   `/ext/foo` pass, but `/extABC` does not — `starts_with("/ext")` would
///   accept that, which is the bug the centralized helper closes).
/// - No path component may be exactly `..` (anchored on `/` boundaries, so
///   benign names like `foo..bar` are not falsely rejected).
pub fn validate_path(path: &str) -> Result<()> {
    if path.split('/').any(|c| c == "..") {
        return Err(FlipperError::Session(
            "Path traversal (..) is not allowed".into(),
        ));
    }
    let ok = VALID_ROOTS
        .iter()
        .any(|root| path == *root || path.starts_with(&format!("{root}/")));
    if !ok {
        return Err(FlipperError::Session(
            "Path must start with /ext, /int, or /any".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_valid_roots_and_subpaths() {
        for p in [
            "/ext",
            "/int",
            "/any",
            "/ext/foo",
            "/int/a/b/c.txt",
            "/any/x",
        ] {
            assert!(validate_path(p).is_ok(), "should accept {p}");
        }
    }

    #[test]
    fn rejects_lookalike_roots() {
        for p in ["/extABC", "/intra", "/anywhere", "/ex", "/", ""] {
            assert!(validate_path(p).is_err(), "should reject {p}");
        }
    }

    #[test]
    fn rejects_traversal() {
        for p in ["/ext/../foo", "/ext/foo/..", "/ext/..", "/../ext"] {
            assert!(validate_path(p).is_err(), "should reject {p}");
        }
    }

    #[test]
    fn allows_dotdot_in_filenames() {
        // Real edge case: filenames with `..` inside (not as a component) should pass.
        assert!(validate_path("/ext/foo..bar").is_ok());
        assert!(validate_path("/ext/.../baz").is_ok());
    }
}

//! SHA-256 digests as the format writes them, and a library's pack digest.

use sha2::{Digest, Sha256};

/// `sha256:` and the hex digest of `bytes`.
pub(crate) fn file_digest(bytes: &[u8]) -> String {
    let mut text = String::with_capacity(71);
    text.push_str("sha256:");
    for byte in Sha256::digest(bytes) {
        text.push(char::from(HEX[usize::from(byte >> 4)]));
        text.push(char::from(HEX[usize::from(byte & 0x0F)]));
    }
    text
}

const HEX: &[u8; 16] = b"0123456789abcdef";

/// The order JavaScript's default sort gives strings: by UTF-16 code unit.
pub(crate) fn utf16_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

/// A library's pack digest: the SHA-256 of one line per file, `<path> <digest>\n`, sorted by
/// path, over the rules file and everything under `components/`, as `packContentDigest` writes
/// it. `files` holds exactly those files.
pub(crate) fn pack_digest<'a>(files: impl IntoIterator<Item = (&'a str, &'a [u8])>) -> String {
    let mut files: Vec<(&str, &[u8])> = files.into_iter().collect();
    files.sort_by(|(a, _), (b, _)| utf16_cmp(a, b));
    let mut lines = String::new();
    for (path, bytes) in files {
        lines.push_str(path);
        lines.push(' ');
        lines.push_str(&file_digest(bytes));
        lines.push('\n');
    }
    file_digest(lines.as_bytes())
}

//! The identical digest's normalisation, version 1 (records host specification, section 8.1).
//!
//! Two match values are identical when their normalised forms are equal, byte for byte. The
//! tables are `unicode-normalization`'s and `caseless`'s, both pinned exactly in this crate's
//! manifest: a change of either is a new [`NORMALISATION_VERSION`](super::NORMALISATION_VERSION)
//! and a rebuild of every lane.

use sha2::{Digest, Sha256};
use unicode_normalization::UnicodeNormalization;

/// `text` in the form the identical digest is taken over:
///
/// 1. NFKC.
/// 2. Unicode default case folding.
/// 3. NFKC again, since folding can denormalise.
/// 4. Each run of characters for which [`char::is_whitespace`] holds becomes one U+0020.
/// 5. Leading and trailing U+0020 are removed.
#[must_use]
pub fn normalise(text: &str) -> String {
    let composed: String = text.nfkc().collect();
    let folded = caseless::default_case_fold_str(&composed);
    let mut out = String::with_capacity(folded.len());
    // A space is owed when whitespace was seen after the first kept character; it is written
    // only before the next kept one, so nothing leads and nothing trails.
    let mut owed = false;
    for c in folded.nfkc() {
        if c.is_whitespace() {
            owed = !out.is_empty();
        } else {
            if owed {
                out.push(' ');
                owed = false;
            }
            out.push(c);
        }
    }
    out
}

/// The match digest of `text`: the SHA-256 of its normalised form's UTF-8, or `None` when that
/// form is empty. A value with no digest is identical to nothing.
#[must_use]
pub fn match_digest(text: &str) -> Option<[u8; 32]> {
    let normalised = normalise(text);
    if normalised.is_empty() {
        None
    } else {
        Some(Sha256::digest(normalised.as_bytes()).into())
    }
}

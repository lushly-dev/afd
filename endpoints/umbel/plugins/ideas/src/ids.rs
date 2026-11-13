//! Ids and sending twice (specification, section 4.5).
//!
//! An id is drawn with the `random` grant: two draws, 48 bits of each, as 24 hexadecimal digits,
//! so no id is derived from a statement. A write that takes `idempotencyKey` derives its ids
//! instead from `sha256(effective principal || 0x00 || command || 0x00 || key || 0x00 || index)`,
//! the first 24 hexadecimal digits, and puts each new record with `Expect::Absent`: a conflict on
//! that put is a replay.

use sha2::{Digest, Sha256};
use umbel_sdk::Cx;
use umbel_sdk::Outcome;

use crate::{Call, fail};

/// The most characters of an idempotency key.
pub(crate) const MAX_KEY_CHARS: usize = 256;

/// 24 hexadecimal digits from two draws of 48 bits each.
pub(crate) fn drawn(cx: &Cx) -> Result<String, Outcome> {
    let mut hex = String::with_capacity(24);
    for _ in 0..2 {
        let draw = cx.random().map_err(|error| fail::host(&error))?;
        // `random` is in [0, 1); 2^48 of it is an integer below 2^48.
        let bits = (draw * 281_474_976_710_656.0) as u64 & 0xffff_ffff_ffff;
        hex.push_str(&format!("{bits:012x}"));
    }
    Ok(hex)
}

/// 24 hexadecimal digits derived from the call's idempotency key and an item's index.
pub(crate) fn derived(call: &Call, key: &str, index: usize) -> String {
    let mut hash = Sha256::new();
    hash.update(call.principal.as_bytes());
    hash.update([0]);
    hash.update(call.command.as_bytes());
    hash.update([0]);
    hash.update(key.as_bytes());
    hash.update([0]);
    hash.update(index.to_string().as_bytes());
    hex(&hash.finalize())[..24].to_owned()
}

/// The digest of an idempotency key as an idea's `seen` keeps it: of the principal, the command
/// and the key, so a key reused by another caller or command is another key.
pub(crate) fn key_digest(call: &Call, key: &str) -> String {
    let mut hash = Sha256::new();
    hash.update(call.principal.as_bytes());
    hash.update([0]);
    hash.update(call.command.as_bytes());
    hash.update([0]);
    hash.update(key.as_bytes());
    format!("sha256:{}", hex(&hash.finalize()))
}

/// Check an `idempotencyKey`: 1 to 256 characters with no control character.
pub(crate) fn check_key(key: Option<&str>) -> Result<Option<&str>, Outcome> {
    match key {
        None => Ok(None),
        Some(key)
            if !key.is_empty()
                && key.chars().count() <= MAX_KEY_CHARS
                && !key.chars().any(char::is_control) =>
        {
            Ok(Some(key))
        }
        Some(_) => Err(fail::invalid(
            "idempotencyKey",
            "must be 1 to 256 characters with no control character",
        )),
    }
}

/// Lowercase hexadecimal.
pub(crate) fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Whether `id` is `<prefix>` and 24 lowercase hexadecimal digits.
pub(crate) fn is_id(id: &str, prefix: &str) -> bool {
    id.strip_prefix(prefix).is_some_and(|rest| {
        rest.len() == 24
            && rest
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    })
}

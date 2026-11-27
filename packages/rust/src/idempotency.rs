//! Idempotency keys (`spec/idempotency.md`): what a command declares about repeats, the key a
//! caller sends, its form (K2) and the keys a batch or pipeline derives from it (K4).
//!
//! These are the shared definitions. The Rust engine does not yet validate or deliver keys, and
//! has no idempotency step ([#2676](https://github.com/lushly-dev/afd/issues/2676)).

use std::collections::HashMap;
use std::fmt;

use serde::{Deserialize, Serialize};

use crate::errors::{error_codes, CommandError};

/// The `_meta` key a caller sends an idempotency key in (K1).
pub const AFD_IDEMPOTENCY_KEY_META_KEY: &str = "dev.afd/idempotencyKey";

/// What a command declares about repeating a call (D1 to D5).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[non_exhaustive]
#[serde(rename_all = "kebab-case")]
pub enum IdempotencySupport {
    /// `natural`: a repeat leaves the same state as one call (a set, a delete by id).
    Natural,
    /// `keyed`: a repeat that carries the same key and input is safe.
    Keyed,
}

impl IdempotencySupport {
    /// The wire spelling: `natural` or `keyed`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Natural => "natural",
            Self::Keyed => "keyed",
        }
    }
}

impl fmt::Display for IdempotencySupport {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Whether `value` is one of the declared values, `natural` or `keyed`.
pub fn is_idempotency_support(value: &str) -> bool {
    matches!(value, "natural" | "keyed")
}

/// Whether `value` is a key a caller may send (K2): 1 to 200 characters, each one of
/// `A-Z a-z 0-9 . _ ~ -`. A derived key, which holds `:`, is not.
pub fn is_idempotency_key(value: &str) -> bool {
    (1..=200).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'~' | b'-'))
}

/// A request whose items or steps run under derived keys (K4).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum IdempotencyRequestKind {
    /// An `afd-batch`: item `i` runs under `<key>:<i>`.
    Batch,
    /// An `afd-pipe`: step `i` runs under `<key>:step:<i>`.
    Pipeline,
}

/// The key the item or step at 0-based `index` of a batch or pipeline runs under, when the
/// request carried `base` (K4).
pub fn derive_idempotency_key(base: &str, kind: IdempotencyRequestKind, index: usize) -> String {
    match kind {
        IdempotencyRequestKind::Batch => format!("{base}:{index}"),
        IdempotencyRequestKind::Pipeline => format!("{base}:step:{index}"),
    }
}

/// The `VALIDATION_ERROR` for a key that is not of K2's form.
pub fn invalid_idempotency_key_error() -> CommandError {
    let mut details = HashMap::new();
    details.insert("field".to_string(), serde_json::json!("idempotencyKey"));
    details.insert(
        "meta".to_string(),
        serde_json::json!(AFD_IDEMPOTENCY_KEY_META_KEY),
    );
    CommandError::new(error_codes::VALIDATION_ERROR, "The idempotency key is not valid")
        .with_suggestion(format!(
            "Send _meta[\"{AFD_IDEMPOTENCY_KEY_META_KEY}\"] as a string of 1 to 200 characters, each one of A-Z a-z 0-9 . _ ~ -, or leave it out"
        ))
        .with_retryable(false)
        .with_details(details)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_key_form_and_derived_keys() {
        assert!(is_idempotency_key("Order-2026.11_26~retry1"));
        assert!(is_idempotency_key(&"k".repeat(200)));
        assert!(!is_idempotency_key(&"k".repeat(201)));
        for bad in ["", "a:b", "a b", "a/b", "café"] {
            assert!(!is_idempotency_key(bad), "{bad}");
        }
        assert_eq!(
            derive_idempotency_key("k1", IdempotencyRequestKind::Batch, 12),
            "k1:12"
        );
        assert_eq!(
            derive_idempotency_key("k1", IdempotencyRequestKind::Pipeline, 3),
            "k1:step:3"
        );
    }

    #[test]
    fn declarations_and_the_error() {
        assert!(is_idempotency_support("natural") && is_idempotency_support("keyed"));
        assert!(!is_idempotency_support("always"));
        assert_eq!(IdempotencySupport::Keyed.to_string(), "keyed");
        let error = invalid_idempotency_key_error();
        assert_eq!(error.code, error_codes::VALIDATION_ERROR);
        assert_eq!(error.retryable, Some(false));
        assert!(error.suggestion.is_some());
        assert_eq!(
            error
                .details
                .and_then(|details| details.get("meta").cloned()),
            Some(serde_json::json!(AFD_IDEMPOTENCY_KEY_META_KEY))
        );
        assert_eq!(
            invalid_idempotency_key_error()
                .details
                .and_then(|details| details.get("field").cloned()),
            Some(serde_json::json!("idempotencyKey"))
        );
    }
}

//! Idempotency keys (`spec/idempotency.md`): what a command declares about repeats, the key a
//! caller sends, its form (K2) and the keys a batch or pipeline derives from it (K4), and the
//! engine's step that answers a repeat of a `keyed` call from a store (S1 to S13).
//!
//! - **The declaration** is [`CommandDefinition::with_idempotency`](crate::CommandDefinition::with_idempotency).
//! - **The key** travels on [`CommandContext::idempotency_key`](crate::CommandContext::idempotency_key)
//!   (in process, [`CommandContext::with_idempotency_key`](crate::CommandContext::with_idempotency_key)
//!   or [`DirectClient::call_with_idempotency_key`](crate::DirectClient::call_with_idempotency_key)),
//!   and over MCP in
//!   `_meta["dev.afd/idempotencyKey"]` or the meta-tools' `meta` argument. The registry checks
//!   its form (K2) before middleware runs, gives it to the handler (K3), derives a key for each
//!   batch item and pipeline step (K4), and starts a nested call without it (K6).
//! - **The step** is [`CommandRegistry::set_idempotency`](crate::CommandRegistry::set_idempotency)
//!   with [`IdempotencyOptions`] and an [`IdempotencyStore`]. It builds without any feature.
//!   The engine drops a call at its deadline (S7, `drops`): the reservation is then live until its
//!   lease runs out, and never settled after that.

use std::collections::HashMap;
use std::fmt;

use serde::{Deserialize, Serialize};

use crate::errors::{error_codes, CommandError, Recovery};

pub(crate) mod key;
pub(crate) mod step;
mod store;

pub use step::{
    check_idempotency_options, IdempotencyOptions, DEFAULT_IDEMPOTENCY_LEASE_MS,
    DEFAULT_IDEMPOTENCY_TTL_MS,
};
pub use store::{
    IdempotencyRecord, IdempotencyRecordState, IdempotencyReservation, IdempotencyReserveOutcome,
    IdempotencySettlement, IdempotencyStore, InMemoryIdempotencyStore,
};

/// The result metadata member a replayed result carries (S9): the engine's, never a handler's.
pub const IDEMPOTENT_REPLAY_KEY: &str = "idempotentReplay";

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

fn meta_details() -> HashMap<String, serde_json::Value> {
    HashMap::from([(
        "meta".to_string(),
        serde_json::json!(AFD_IDEMPOTENCY_KEY_META_KEY),
    )])
}

/// `IDEMPOTENCY_KEY_REUSED` (S5): the key is held for a call with another input.
pub(crate) fn key_reused_error() -> CommandError {
    CommandError::new(
        error_codes::IDEMPOTENCY_KEY_REUSED,
        "This idempotency key is already held for a call with another input",
    )
    .with_suggestion(
        "Use a new idempotency key for a different call. Reuse a key only to repeat the same call with the same input.",
    )
    .with_retryable(false)
    .with_recovery(Recovery::stop())
    .with_details(meta_details())
}

/// `IDEMPOTENCY_IN_PROGRESS` (S5): an earlier call with this key and digest still runs.
pub(crate) fn in_progress_error() -> CommandError {
    CommandError::new(
        error_codes::IDEMPOTENCY_IN_PROGRESS,
        "An earlier call with this idempotency key and input is still running",
    )
    .with_suggestion(
        "Repeat the call shortly with the same idempotency key: it then gets the earlier call's result.",
    )
    .with_retryable(true)
    .with_recovery(Recovery::retry(Some(1000)).expect("a delay of 1000 ms is valid"))
    .with_details(meta_details())
}

/// `OUTCOME_UNKNOWN` from the step (S6, S7).
pub(crate) fn outcome_unknown_error() -> CommandError {
    CommandError::new(
        error_codes::OUTCOME_UNKNOWN,
        "An earlier call with this idempotency key and input started, and nobody can say whether it was applied",
    )
    .with_suggestion(
        "Check whether the change was made. If the call is still wanted, send it with a new idempotency key.",
    )
    .with_retryable(false)
    .with_recovery(Recovery::external())
    .with_details(meta_details())
}

/// S3's refusal of a caller the server cannot tell apart.
pub(crate) fn unidentified_callers_error() -> CommandError {
    CommandError::new(
        error_codes::UNAUTHORIZED,
        "This server cannot tell its callers apart, so it does not answer repeats from its idempotency store",
    )
    .with_suggestion(
        "Nothing ran. Call again without the idempotency key, or the server's operator configures authorization, or declares that the server's context hook identifies every caller (IdempotencyOptions::with_callers_identified_by_hook).",
    )
    .with_retryable(false)
}

/// M8's internal error, whose message names no one (S3).
pub(crate) fn internal_principal_error() -> CommandError {
    CommandError::new(error_codes::INTERNAL_ERROR, "Internal error")
        .with_suggestion("Nothing ran. Tell the server's operator; calling again will not help.")
        .with_retryable(false)
}

/// The refusal of a keyed call whose reservation the store could not make: nothing ran.
pub(crate) fn store_failed_error() -> CommandError {
    CommandError::new(
        error_codes::INTERNAL_ERROR,
        "The idempotency store could not reserve the key",
    )
    .with_suggestion("Nothing ran. Repeat the call shortly with the same idempotency key.")
    .with_retryable(true)
    .with_details(meta_details())
}

/// `VALIDATION_ERROR` for an input with no canonical form, which a key cannot cover (S4).
pub(crate) fn input_not_canonical_error(command: &str) -> CommandError {
    let mut details = meta_details();
    details.insert(
        "reason".to_string(),
        serde_json::json!("input-not-canonical"),
    );
    CommandError::new(
        error_codes::VALIDATION_ERROR,
        format!(
            "The input of '{}' has no canonical JSON form, so an idempotency key cannot cover it",
            crate::commands::truncate_name(command)
        ),
    )
    .with_suggestion(
        "Send plain JSON input (no integer beyond 2^53), or call without an idempotency key.",
    )
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

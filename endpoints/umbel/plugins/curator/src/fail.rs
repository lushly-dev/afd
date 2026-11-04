//! Failures as AFD results (section 11.3). No message, suggestion or detail ever holds a memory
//! record's text, subject or tags, or a document's text (D67): only codes, ids and counts.

use serde_json::json;
use umbel_sdk::{HostError, Outcome, failure};

/// `CURATOR_INVALID` for a bad field. `what` names the rule, never the value.
pub(crate) fn invalid(what: &str) -> Outcome {
    failure(
        "CURATOR_INVALID",
        &format!("the input was refused: {what}"),
        "Fix the field the message names and run the command again; curator-guide lists every field.",
    )
}

/// The failure for a call that resolved no space.
pub(crate) fn no_space() -> Outcome {
    failure(
        "SPACE_NOT_FOUND",
        "the call resolved no space",
        "Pass `space`, or set default_space in umbel.toml.",
    )
}

/// `CURATOR_PRINCIPAL_UNKNOWN`: a caller with no effective principal has no curator records, and
/// no candidate id can be derived for it (step 4, amendment 4).
pub(crate) fn no_principal() -> Outcome {
    failure(
        "CURATOR_PRINCIPAL_UNKNOWN",
        "the caller has no principal, so it has no candidates or curator records",
        "Call as an actor with an id, or on behalf of a person; the command line is always human:<principal.local_id>.",
    )
}

/// `CURATOR_PACK_INVALID` (section 11.3): the settle pack does not read, or names `transcript`.
pub(crate) fn pack_invalid(reason: &str) -> Outcome {
    failure(
        "CURATOR_PACK_INVALID",
        &format!("the settle pack does not load: {reason}"),
        "Fix data/settle.toml in spaces/<space>/packs/curator/settle/, or remove the override to use the default.",
    )
}

/// `CURATOR_MODEL_UNAVAILABLE` (section 8.5, owner decision 3): no model drafts in phase 4.
pub(crate) fn model_unavailable() -> Outcome {
    failure(
        "CURATOR_MODEL_UNAVAILABLE",
        "a model is configured for the curator, and no model drafts or extracts in phase 4",
        "Remove [plugins.curator.config.model] from umbel.toml; drafts are the fixed rendering.",
    )
}

/// `CURATOR_TARGET_UNCONFIGURED` (section 11.3): the space has no usable target. `reason` is
/// `unconfigured`, `collection-missing`, `not-markdown` or `collection-unknown` (the `content`
/// grant withheld; step 4, amendment 1).
pub(crate) fn target_unconfigured(reason: &str, message: &str) -> Outcome {
    failure(
        "CURATOR_TARGET_UNCONFIGURED",
        &format!("the space has no usable curator target: {message}"),
        "Name a markdown collection of the space as [plugins.curator.config.spaces.<space>] collection (and prefix), the same target [plugins.knowledge.config.drafters.<instance>.targets.<space>] names, and do not deny the curator's content grant.",
    )
    .with_error_details(json!({ "reason": reason }))
}

/// `CURATOR_CANDIDATE_NOT_FOUND` (section 11.3): absent, or not the caller's, alike.
pub(crate) fn candidate_not_found() -> Outcome {
    failure(
        "CURATOR_CANDIDATE_NOT_FOUND",
        "no candidate of yours has that id in this space",
        "List your candidates with curator-candidates; ids change when a record with a lower id joins the group.",
    )
}

/// `CURATOR_PROMOTE_NOT_ALLOWED` (section 11.3). `reason` names the rule, never the content:
/// `not-a-person`, `not-own`, `content-hash` or `status`.
pub(crate) fn promote_not_allowed(reason: &str, message: &str) -> Outcome {
    failure(
        "CURATOR_PROMOTE_NOT_ALLOWED",
        &format!("the candidate may not be promoted: {message}"),
        "Promote only a candidate curator-candidates lists as needs-promotion whose records are all your own, with the contentHash it prints.",
    )
    .with_error_details(json!({ "reason": reason }))
}

/// The failure for a host service refusing.
pub(crate) fn host(error: &HostError) -> Outcome {
    let message = error.to_string();
    match error {
        HostError::Busy(_) => failure(
            "STORE_BUSY",
            &message,
            "Another process holds the store; run the command again shortly.",
        )
        .with_retryable(true),
        HostError::Corrupt(_) => failure("STORE_CORRUPT", &message, "Run store-check."),
        HostError::Io(_) => failure(
            "STORE_IO",
            &message,
            "Check the disk and the permissions of the workspace's state directory.",
        ),
        HostError::NotGranted(_) => failure(
            "PLUGIN_GRANT_DENIED",
            &message,
            "Enable the curator plugin with its grants in umbel.toml, and allow records_write for this space.",
        ),
        HostError::KeysMissing => failure(
            "MEMORY_KEYS_MISSING",
            &message,
            "Restore memory.keys beside memory.sqlite3 from your separate copy; run umbel doctor.",
        ),
        HostError::KeysMismatch => failure(
            "MEMORY_KEYS_MISMATCH",
            &message,
            "Put back the memory.keys that belongs to this memory.sqlite3; run umbel doctor.",
        ),
        HostError::Conflict { .. } => failure(
            "CURATOR_CONFLICT",
            "a curator record changed while it was written",
            "Run the command again.",
        )
        .with_retryable(true),
        _ => failure("CURATOR_FAILED", &message, "Run store-check and try again."),
    }
}

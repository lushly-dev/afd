//! Failures and warnings (specification, section 12). Every code is AFD's catalog's. `details`
//! hold ids, field names, counts and enums only: a statement, a reason or a question is never in
//! a message, a suggestion, a detail or a log line.

use serde_json::{Value, json};
use umbel_sdk::{HostError, Outcome, failure};

/// The suggestion for a field that breaks a rule.
const FIX: &str = "Fix the field named in details.field and send the call again; ideas-guide lists the types, standings and limits.";

/// `VALIDATION_ERROR` for a field that breaks a rule. `rule` names the rule, never the value.
pub(crate) fn invalid(field: &str, rule: &str) -> Outcome {
    failure(
        "VALIDATION_ERROR",
        &format!("the field `{field}` {rule}"),
        FIX,
    )
    .with_error_details(json!({ "field": field }))
}

/// `VALIDATION_ERROR` for the item `index` of a list.
pub(crate) fn invalid_item(list: &str, index: usize, field: &str, rule: &str) -> Outcome {
    failure(
        "VALIDATION_ERROR",
        &format!("{list}[{index}].{field} {rule}"),
        FIX,
    )
    .with_error_details(json!({ "field": format!("{list}[{index}].{field}"), "index": index }))
}

/// `VALIDATION_ERROR` for a type the pack lacks, listing the valid ones.
pub(crate) fn invalid_type(field: &str, valid: &[String]) -> Outcome {
    failure(
        "VALIDATION_ERROR",
        &format!("the field `{field}` names a type the store does not have"),
        "Use one of the types in details.valid; ideas-guide lists them all with what each means.",
    )
    .with_error_details(json!({ "field": field, "valid": valid }))
}

/// `VALIDATION_ERROR` for a pack fault: a deployer's, naming the file and the key.
pub(crate) fn pack(file: &str, key: &str, rule: &str) -> Outcome {
    failure(
        "VALIDATION_ERROR",
        &format!("the vocabulary pack's {file} is not usable: `{key}` {rule}"),
        "Tell the operator: the space's vocabulary pack needs fixing (see the plugin's README), or remove the space's override to use the default pack.",
    )
    .with_error_details(json!({ "reason": "pack", "file": file, "key": key }))
}

/// `NOT_FOUND`: one answer for an idea that does not exist and one the caller may not read.
pub(crate) fn not_found(ids: &[String]) -> Outcome {
    failure(
        "NOT_FOUND",
        &format!("{} idea(s) were not found", ids.len()),
        "Call ideas-find, or ideas-review-show for a review.",
    )
    .with_error_details(json!({ "ids": ids }))
}

/// A command declared for a later step.
pub(crate) fn not_implemented(command: &str) -> Outcome {
    failure(
        "NOT_IMPLEMENTED",
        &format!("{command} is not served yet in this version of the ideas plugin"),
        "Call ideas-guide for what this store serves now.",
    )
}

/// A command the manifest does not declare.
pub(crate) fn unknown_command(command: &str) -> Outcome {
    failure(
        "COMMAND_NOT_FOUND",
        &format!("the ideas plugin has no command `{command}`"),
        "Call ideas-guide for the commands of this store.",
    )
}

/// The call has no space: every command declares one.
pub(crate) fn no_space() -> Outcome {
    failure(
        "VALIDATION_ERROR",
        "the call has no space",
        "Pass space, or set the workspace's default space.",
    )
    .with_error_details(json!({ "field": "space" }))
}

/// The prefix of a host error's message: its code, for the errors the records host
/// specification names (section 13).
fn host_code(message: &str) -> Option<&str> {
    let code = message.split(':').next()?.trim();
    (code.starts_with("RECORD_") || code.starts_with("STORE_")).then_some(code)
}

/// A host error, as the plugin answers it (section 12). The host's message is never passed on:
/// only its code, in `details.host`.
pub(crate) fn host(error: &HostError) -> Outcome {
    match error {
        HostError::Invalid(message) | HostError::NotGranted(message) => {
            let code = host_code(message);
            match code {
                Some("RECORD_LANE_STALE") => failure(
                    "SERVICE_UNAVAILABLE",
                    "the store's record lane is being rebuilt",
                    "Retry once after a few seconds; if it persists, ask the operator to run umbel store-records-reindex",
                )
                .with_retryable(true)
                .with_error_details(json!({ "host": "RECORD_LANE_STALE" })),
                Some("RECORD_QUERY_TOO_BROAD") => failure(
                    "SERVICE_UNAVAILABLE",
                    "the store holds more than a ranked read reads",
                    "The store is past its matching size; find by type or recency, and tell the operator",
                )
                .with_error_details(json!({ "host": "RECORD_QUERY_TOO_BROAD" })),
                Some(
                    host @ ("RECORD_DECISION_NOT_GATED" | "RECORD_DECISION_NOT_THE_PERSON"),
                ) => failure(
                    "FORBIDDEN",
                    "the host refused a decision on standing",
                    "Have the space's person confirm it on the review page or at a terminal",
                )
                .with_error_details(json!({ "host": host })),
                Some(host) => failure(
                    "SERVICE_UNAVAILABLE",
                    "the host refused a record operation",
                    "Tell the operator; details.host names the host's code.",
                )
                .with_error_details(json!({ "host": host })),
                None if matches!(error, HostError::NotGranted(_)) => failure(
                    "FORBIDDEN",
                    "the ideas plugin does not hold a grant this call needs for this space",
                    "Enable the ideas plugin with its grants in umbel.toml: records_write allowed for the space.",
                )
                .with_error_details(json!({ "host": "NOT_GRANTED" })),
                None => failure(
                    "INTERNAL_ERROR",
                    "the host refused a record operation",
                    "Tell the operator.",
                ),
            }
        }
        HostError::Busy(_) => failure(
            "SERVICE_UNAVAILABLE",
            "the store is busy",
            "Retry once after a few seconds.",
        )
        .with_retryable(true)
        .with_error_details(json!({ "host": "STORE_BUSY" })),
        HostError::Conflict { .. } => failure(
            "CONFLICT",
            "a record changed while the call was writing it",
            "Send the call again.",
        )
        .with_retryable(true),
        _ => failure(
            "INTERNAL_ERROR",
            "the store failed",
            "Retry; if it persists, tell the operator to run umbel store-check.",
        ),
    }
}

/// Adds `CONTENT_FLAGGED` when a returned wording was flagged by the host's scan.
pub(crate) fn warn_flagged(outcome: Outcome, count: usize) -> Outcome {
    if count == 0 {
        return outcome;
    }
    outcome.with_warning_details(
        "CONTENT_FLAGGED",
        &format!("{count} returned wording(s) matched the instruction or hidden-text scan"),
        json!({ "count": count }),
    )
}

/// Adds `MATCH_UNAVAILABLE` with the host's code (7.1, step 3).
pub(crate) fn warn_match_unavailable(outcome: Outcome, error: &HostError) -> Outcome {
    let code = match error {
        HostError::Invalid(message) | HostError::NotGranted(message) => {
            host_code(message).unwrap_or("HOST_ERROR").to_owned()
        }
        HostError::Busy(_) => "STORE_BUSY".to_owned(),
        _ => "HOST_ERROR".to_owned(),
    };
    outcome.with_warning_details(
        "MATCH_UNAVAILABLE",
        "the ideas were captured without candidates: the host's match failed",
        json!({ "host": code }),
    )
}

/// The flags of a host scan, as wire names.
pub(crate) fn flag_names(flags: &[umbel_store::memory::MemoryFlag]) -> Value {
    json!(flags.iter().map(|flag| flag.as_str()).collect::<Vec<_>>())
}

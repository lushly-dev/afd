//! `memory-confirm` (section 8.7, owner decision 2, D88): a person at a terminal vouches for one of
//! their own records, which writes version n+1 with authority `person` and the envelope's
//! `confirmation`. `confirm = "require-human"` shows the fixed prompt and refuses `--yes`,
//! `--approve` and every surface but the CLI; the host also requires authority `person`; the store
//! checks the owner, the record's state and the hash the person was shown.

use serde::Deserialize;
use serde_json::{Value, json};
use umbel_sdk::{Cx, HostError, Outcome, failure, success};
use umbel_store::Authority;
use umbel_store::memory::{Confirm, check_memory_id};

use crate::fail;
use crate::pipeline::{Call, effective_principal};
use crate::remember::{event_labels, stored};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Input {
    #[serde(default)]
    #[allow(dead_code)]
    space: Option<String>,
    id: String,
    content_hash: String,
}

pub(crate) fn run(input: &Value, cx: &Cx) -> Outcome {
    match confirm(input, cx) {
        Ok(outcome) | Err(outcome) => outcome,
    }
}

/// `sha256:` and 16 to 64 lowercase hex digits, or the hex alone: what `memory-show` printed.
fn hash_shape(text: &str) -> bool {
    let hex = text.strip_prefix("sha256:").unwrap_or(text);
    (16..=64).contains(&hex.len()) && hex.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

fn not_allowed(reason: &str) -> Outcome {
    failure(
        "MEMORY_CONFIRM_NOT_ALLOWED",
        &format!("the record may not be confirmed: {reason}"),
        "Confirm only your own unflagged records that a person has not already vouched for. To vouch for anything else, remember it again in your own words at a terminal.",
    )
}

/// Why the store refused: the record as the caller reads it, named by the first rule it breaks.
fn refusal(cx: &Cx, space: &str, id: &str) -> Outcome {
    let me = effective_principal(cx.call());
    let current = cx
        .memory_history(space, id)
        .ok()
        .and_then(|mut versions| versions.pop());
    let Some(current) = current else {
        return not_allowed("it cannot be read");
    };
    if me.as_deref() != Some(current.scope.principal.as_str()) {
        return not_allowed(
            "it is another principal's record; confirming another person's record waits for verified identity (phase 5)",
        );
    }
    if !current.flags.is_empty() {
        return not_allowed("it is flagged by the scan, and a flagged record is never pushed");
    }
    match current.authority() {
        Some(Authority::Transcript) => {
            not_allowed("it is a captured transcript window, which is not a statement")
        }
        Some(Authority::Person) => not_allowed("it already has authority person"),
        _ => not_allowed("the store refused it"),
    }
}

fn confirm(input: &Value, cx: &Cx) -> Result<Outcome, Outcome> {
    let input: Input = serde_json::from_value(input.clone())
        .map_err(|_| fail::invalid("the input does not match memory-confirm's schema"))?;
    if check_memory_id(&input.id).is_err() {
        return Err(fail::invalid("id is mem- and 24 lowercase hex digits"));
    }
    if !hash_shape(&input.content_hash) {
        return Err(fail::invalid(
            "contentHash is the value memory-show printed, at least its first 16 hex digits",
        ));
    }
    let call = Call::open(cx)?;
    let request = Confirm {
        id: input.id.clone(),
        at: call.now,
        by: call.principal.clone(),
        content_hash: input.content_hash,
        trace_id: None,
        assurance: None,
    };
    let meta = match cx.memory_confirm(&call.space, request) {
        Ok(meta) => meta,
        // Amendment 3 of step 2: a hash prefix that does not match is `Conflict`, a record that
        // may not be confirmed `Invalid`.
        Err(HostError::Conflict { .. }) => {
            return Err(failure(
                "MEMORY_CONFIRM_MISMATCH",
                "the contentHash does not match the record's text",
                "Read the record again with memory-show and pass the contentHash it prints; the record may have changed since.",
            ));
        }
        Err(HostError::Invalid(text)) if !text.starts_with("MEMORY_") => {
            return Err(refusal(cx, &call.space, &input.id));
        }
        Err(error) => return Err(fail::host(&error)),
    };
    let record = stored(cx, &call.space, &meta.id);
    Ok(success(json!({
        "id": meta.id,
        "recordVersion": meta.record_version,
        "authority": "person",
    }))
    .with_metadata(
        "dev.umbel/record",
        json!({ "kind": "memory", "id": meta.id, "version": meta.record_version }),
    )
    .with_metadata(
        "dev.umbel/provenance",
        event_labels(
            record.as_ref(),
            &call.principal,
            None,
            &crate::hygiene::Counts::default(),
        ),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_hash_is_at_least_sixteen_hex_digits() {
        assert!(hash_shape("sha256:0123456789abcdef"));
        assert!(hash_shape("0123456789abcdef0123"));
        assert!(!hash_shape("sha256:0123456789abcde"));
        assert!(!hash_shape("sha256:0123456789ABCDEF"));
        assert!(!hash_shape(&"a".repeat(65)));
    }
}

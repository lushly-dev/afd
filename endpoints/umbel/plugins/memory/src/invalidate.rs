//! `memory-invalidate` (section 8.6): close a record's validity at `at` by writing a new version.
//! The host checks section 6.3 (authority first, then ownership) and sets `by` and the clock; the
//! store refuses an `at` not after `validFrom` or after now, and a stale `expectVersion`.

use serde::Deserialize;
use serde_json::{Value, json};
use umbel_sdk::{Cx, Outcome, success};
use umbel_store::memory::{
    Invalidate, InvalidationReason, MAX_INVALIDATION_NOTE_CHARS, check_memory_id, format_instant,
};

use crate::fail;
use crate::hygiene::Counts;
use crate::pipeline::{self, Call};
use crate::remember::{event_labels, stored};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Input {
    #[serde(default)]
    #[allow(dead_code)]
    space: Option<String>,
    id: String,
    at: Option<String>,
    reason: String,
    note: Option<String>,
    expect_version: Option<u32>,
}

pub(crate) fn run(input: &Value, cx: &Cx) -> Outcome {
    match invalidate(input, cx) {
        Ok(outcome) | Err(outcome) => outcome,
    }
}

fn reason(text: &str) -> Option<InvalidationReason> {
    Some(match text {
        "wrong" => InvalidationReason::Wrong,
        "outdated" => InvalidationReason::Outdated,
        "duplicate" => InvalidationReason::Duplicate,
        "other" => InvalidationReason::Other,
        _ => return None,
    })
}

fn invalidate(input: &Value, cx: &Cx) -> Result<Outcome, Outcome> {
    let input: Input = serde_json::from_value(input.clone())
        .map_err(|_| fail::invalid("the input does not match memory-invalidate's schema"))?;
    if check_memory_id(&input.id).is_err() {
        return Err(fail::invalid("id is mem- and 24 lowercase hex digits"));
    }
    let reason = reason(&input.reason)
        .ok_or_else(|| fail::invalid("reason is wrong, outdated, duplicate or other"))?;
    let call = Call::open(cx)?;
    let at = input
        .at
        .as_deref()
        .map(|t| pipeline::parse_time("at", t))
        .transpose()?
        .unwrap_or(call.now);
    // The note runs through the mask and the scan, as a record's text does (section 8.6).
    let mut masked = Counts::default();
    let mut flagged = false;
    let note = match input.note {
        Some(note) => {
            if note.contains('\0') || note.chars().count() > MAX_INVALIDATION_NOTE_CHARS {
                return Err(fail::invalid(
                    "note is at most 500 characters with no NUL character",
                ));
            }
            let (clean, counts) = call.hygiene.mask(&note);
            masked.add(&counts);
            if clean.chars().count() > MAX_INVALIDATION_NOTE_CHARS {
                return Err(fail::invalid(
                    "note is too long once its secrets are masked",
                ));
            }
            let scan = umbel_scan::scan_content(&clean);
            flagged = scan.is_instruction_like() || scan.has_hidden_text();
            Some(clean)
        }
        None => None,
    };
    let request = Invalidate {
        id: input.id.clone(),
        at: call.now,
        valid_until: at,
        by: call.principal.clone(),
        reason,
        note,
        expect_version: input.expect_version,
        trace_id: None,
    };
    let meta = cx
        .memory_invalidate(&call.space, request)
        .map_err(|error| fail::host(&error))?;
    let mut outcome = success(json!({
        "id": meta.id,
        "recordVersion": meta.record_version,
        "validUntil": meta.valid_until.map(format_instant),
    }));
    if flagged {
        outcome = outcome.with_warning(
            "CONTENT_FLAGGED",
            "the note matched the injection or hidden-text scan; it is kept on the invalidated version, which is never pushed",
        );
    }
    if !masked.is_empty() {
        outcome = outcome.with_warning_details(
            "SECRETS_MASKED",
            &masked.summary(),
            json!({ "redactions": masked.to_json() }),
        );
    }
    let record = stored(cx, &call.space, &meta.id);
    Ok(outcome
        .with_metadata(
            "dev.umbel/record",
            json!({ "kind": "memory", "id": meta.id, "version": meta.record_version }),
        )
        .with_metadata(
            "dev.umbel/provenance",
            event_labels(record.as_ref(), &call.principal, None, &masked),
        ))
}

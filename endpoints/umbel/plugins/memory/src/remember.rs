//! `memory-remember` (section 8.2): one fact, run through the write pipeline and written in one
//! batch. The result never repeats the text.

use serde::Deserialize;
use serde_json::{Value, json};
use umbel_sdk::{Cx, MemoryPath, MemoryWriteRequest, Outcome, success};
use umbel_store::memory::{EntryState, MemoryReceipt, format_instant};
use umbel_store::{
    DerivedFrom, MemoryBatch, MemoryClass, MemoryRecord, Origin, Sensitivity, Source,
};

use crate::fail;
use crate::hygiene::Counts;
use crate::pipeline::{self, Call, Draft, Prepared};

/// The most text `memory-remember` takes (section 4): 16 KiB.
pub(crate) const MAX_REMEMBER_TEXT_BYTES: usize = 16 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Input {
    #[serde(default)]
    #[allow(dead_code)]
    space: Option<String>,
    class: String,
    subject: String,
    text: String,
    #[serde(default)]
    tags: Vec<String>,
    project: Option<String>,
    session: Option<String>,
    share: Option<String>,
    sensitivity: Option<Sensitivity>,
    valid_from: Option<String>,
    valid_until: Option<String>,
    ttl_days: Option<u32>,
    confidence: Option<f64>,
    origin: Option<Origin>,
    sources: Option<Vec<Source>>,
    derived_from: Option<Vec<DerivedFrom>>,
    constraints: Option<Vec<String>>,
    #[serde(default)]
    supersedes: Vec<String>,
    idempotency_key: Option<String>,
}

pub(crate) fn run(input: &Value, cx: &Cx) -> Outcome {
    match remember(input, cx) {
        Ok(outcome) | Err(outcome) => outcome,
    }
}

fn remember(input: &Value, cx: &Cx) -> Result<Outcome, Outcome> {
    let input: Input = serde_json::from_value(input.clone())
        .map_err(|_| fail::invalid("the input does not match memory-remember's schema"))?;
    let class = MemoryClass::parse(&input.class)
        .ok_or_else(|| fail::invalid("class is episodic, semantic or procedural"))?;
    if input.origin == Some(Origin::Unspecified) {
        return Err(fail::invalid(
            "origin is user-stated, agent-inferred or document-derived",
        ));
    }
    if let Some(key) = &input.idempotency_key
        && (key.is_empty() || key.chars().count() > 256 || key.chars().any(char::is_control))
    {
        return Err(fail::invalid(
            "idempotencyKey is 1 to 256 characters with no control character",
        ));
    }
    let call = Call::open(cx)?;
    let mut draft = Draft::new(class, input.subject, input.text);
    draft.tags = input.tags;
    draft.project = input.project;
    draft.session = input.session;
    draft.sensitivity = input.sensitivity.unwrap_or(Sensitivity::Internal);
    draft.valid_from = input
        .valid_from
        .as_deref()
        .map(|t| pipeline::parse_time("validFrom", t))
        .transpose()?;
    draft.valid_until = input
        .valid_until
        .as_deref()
        .map(|t| pipeline::parse_time("validUntil", t))
        .transpose()?;
    draft.ttl_days = input.ttl_days;
    draft.confidence = input.confidence;
    draft.origin = input.origin.unwrap_or(Origin::Unspecified);
    draft.sources = input.sources;
    draft.derived_from = input.derived_from;
    draft.constraints = input.constraints;
    draft.supersedes = input.supersedes;
    let session = draft.session.clone();
    let prepared = call.prepare(draft, 0, pipeline::draw(cx)?, MAX_REMEMBER_TEXT_BYTES)?;
    let Prepared {
        write,
        flags,
        masked,
    } = prepared;
    let request = MemoryWriteRequest {
        path: MemoryPath::Remember,
        share: input.share,
        batch: MemoryBatch {
            idempotency: input.idempotency_key,
            capture_key: None,
            at: call.now,
            quota: call.policy.quota(),
            retention: call.policy.retention(),
            entries: vec![write],
        },
    };
    let receipt = cx
        .memory_write(&call.space, request)
        .map_err(|error| fail::host(&error))?;
    Ok(result(cx, &call, &receipt, class, &flags, &masked, session))
}

/// What the receipt says, the warnings, and the event's record and envelope labels.
fn result(
    cx: &Cx,
    call: &Call,
    receipt: &MemoryReceipt,
    class: MemoryClass,
    flags: &[umbel_store::MemoryFlag],
    masked: &Counts,
    session: Option<String>,
) -> Outcome {
    let Some(entry) = receipt.entries.first() else {
        return fail::invalid("the write returned no record");
    };
    let state = if receipt.replayed {
        "replayed"
    } else {
        match entry.state {
            EntryState::Created => "created",
            EntryState::Observed => "observed",
        }
    };
    let mut outcome = success(json!({
        "id": entry.id,
        "recordVersion": entry.record_version,
        "state": state,
        "class": class.as_str(),
        "expiresAt": format_instant(entry.expires_at),
        "flags": pipeline::flag_names(flags),
        "redactions": masked.to_json(),
        "verification": "unverified",
    }));
    if !flags.is_empty() {
        outcome = outcome.with_warning(
            "CONTENT_FLAGGED",
            "the record matched the injection or hidden-text scan: it is stored and returned with its label on recall, and never pushed",
        );
    }
    if !masked.is_empty() {
        outcome = outcome.with_warning_details(
            "SECRETS_MASKED",
            &masked.summary(),
            json!({ "redactions": masked.to_json() }),
        );
    }
    let stored = stored(cx, &call.space, &entry.id);
    outcome
        .with_metadata(
            "dev.umbel/record",
            json!({ "kind": "memory", "id": entry.id, "version": entry.record_version }),
        )
        .with_metadata(
            "dev.umbel/provenance",
            event_labels(stored.as_ref(), &call.principal, session, masked),
        )
}

/// The record as the caller now reads it, for the event's labels: the host decided its access,
/// authority and origin.
pub(crate) fn stored(cx: &Cx, space: &str, id: &str) -> Option<MemoryRecord> {
    cx.memory_history(space, id).ok()?.pop()
}

/// The labels an event carries for a memory write (section 8.10): the record's access, origin,
/// sensitivity and validity, the input's session, and what was masked. Never text: the host also
/// nulls the sealed fields. A record that cannot be read back is labeled private to the caller.
pub(crate) fn event_labels(
    record: Option<&MemoryRecord>,
    principal: &str,
    session: Option<String>,
    masked: &Counts,
) -> Value {
    let private = vec![format!("principal:{principal}")];
    let mut labels = json!({
        "session": session,
        "access": record.map_or(private, |r| r.access.tokens().to_vec()),
        "sensitivity": record.map_or(json!("internal"), |r| json!(r.sensitivity)),
    });
    if let Some(record) = record {
        labels["origin"] = json!(record.provenance.origin);
        labels["validFrom"] = json!(format_instant(record.valid_from));
        labels["validUntil"] = json!(record.valid_until.map(format_instant));
        if let Some(confidence) = record.provenance.confidence {
            labels["confidence"] = json!(confidence);
        }
    }
    if let Some(redactions) = masked.redactions() {
        labels["redactions"] = json!(redactions);
    }
    labels
}

//! `memory-import` (section 8.9): a harness's memory files, as the adapter read them, written as
//! one batch with path `Import`, so their authority is `import` whoever calls (section 3.3) and
//! they are private unless a sharing writer passes `share` (section 3.2).
//!
//! There is no idempotency key, so no digest of content is kept: an entry already live becomes an
//! observation, and a repeated import adds only those. The plugin reads no file: the adapter reads
//! the directory and splits it into calls (section 10.5).

use serde::Deserialize;
use serde_json::{Value, json};
use umbel_sdk::{Cx, MemoryPath, MemoryWriteRequest, Outcome, success};
use umbel_store::memory::{EntryState, MAX_MEMORY_BATCH, MemoryReceipt};
use umbel_store::{ByAt, MemoryBatch, MemoryClass, Origin, Source};

use crate::capture::{MAX_CAPTURE_BYTES, MAX_ENTRY_BYTES, name_like, relative};
use crate::fail;
use crate::hygiene::Counts;
use crate::pipeline::{self, Call, Draft};
use crate::remember::{event_labels, stored};

/// The most characters of an entry's `path`.
const MAX_PATH_CHARS: usize = 1024;
/// The most characters of `generated.by`.
const MAX_BY_CHARS: usize = 256;

/// The fixed suggestion of every import (section 8.9): Umbel's forget cannot reach the source.
const SOURCE_REMAINS: &str = "The files you imported are still where they were: a memory-forget in Umbel cannot reach them, and importing them again after a forget writes new records. Remove or move the source files if Umbel is to hold the only copy.";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Generated {
    by: String,
    at: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Entry {
    class: String,
    subject: String,
    text: String,
    #[serde(default)]
    tags: Vec<String>,
    path: String,
    generated: Option<Generated>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Input {
    #[serde(default)]
    #[allow(dead_code)]
    space: Option<String>,
    harness: String,
    project: Option<String>,
    entries: Vec<Entry>,
    share: Option<String>,
}

pub(crate) fn run(input: &Value, cx: &Cx) -> Outcome {
    match import(input, cx) {
        Ok(outcome) | Err(outcome) => outcome,
    }
}

/// An entry's `path`: relative, one line, at most 1024 characters.
fn path_ok(path: &str) -> bool {
    relative(path) && path.chars().count() <= MAX_PATH_CHARS && !path.chars().any(char::is_control)
}

fn draft(entry: Entry, harness: &str, project: Option<&String>) -> Result<Draft, Outcome> {
    let class = MemoryClass::parse(&entry.class)
        .ok_or_else(|| fail::invalid("an entry's class is episodic, semantic or procedural"))?;
    if !path_ok(&entry.path) {
        return Err(fail::invalid(
            "an entry's path is relative, one line and at most 1024 characters",
        ));
    }
    let generated = match entry.generated {
        Some(generated) => {
            let by_chars = generated.by.chars().count();
            if by_chars == 0
                || by_chars > MAX_BY_CHARS
                || generated.by.chars().any(char::is_control)
            {
                return Err(fail::invalid(
                    "generated.by is 1 to 256 characters on one line",
                ));
            }
            let at = pipeline::parse_time("generated.at", &generated.at)?;
            Some(ByAt {
                by: generated.by,
                at: umbel_store::memory::format_instant(at),
            })
        }
        None => None,
    };
    let mut draft = Draft::new(class, entry.subject, entry.text);
    draft.tags = entry.tags;
    draft.project = project.cloned();
    // Read out of a harness's file: never a person's word at a terminal (section 8.2).
    draft.origin = Origin::DocumentDerived;
    draft.sources = Some(vec![Source {
        resource: format!("harness:{harness}/{}", entry.path),
        id: None,
        title: None,
        author: None,
        last_modified: None,
    }]);
    draft.generated = generated;
    Ok(draft)
}

fn import(input: &Value, cx: &Cx) -> Result<Outcome, Outcome> {
    let bytes = serde_json::to_string(input).map_or(usize::MAX, |text| text.len());
    if bytes > MAX_CAPTURE_BYTES {
        return Err(fail::invalid(
            "an import takes at most 1 MiB; the adapter splits a directory into calls",
        ));
    }
    let input: Input = serde_json::from_value(input.clone())
        .map_err(|_| fail::invalid("the input does not match memory-import's schema"))?;
    if !name_like(&input.harness, 64) {
        return Err(fail::invalid(
            "harness is a lowercase letter, then at most 63 lowercase letters, digits or dashes",
        ));
    }
    if input.entries.is_empty() || input.entries.len() > MAX_MEMORY_BATCH {
        return Err(fail::invalid("an import holds 1 to 256 entries"));
    }
    if input.entries.iter().any(|e| e.text.len() > MAX_ENTRY_BYTES) {
        return Err(fail::invalid(
            "an entry holds at most 64 KiB; the adapter splits a larger file into parts",
        ));
    }
    let call = Call::open(cx)?;
    if let Some(project) = &input.project {
        call.check_label("project", project)?;
    }
    let entries = input.entries.len();
    let mut writes = Vec::with_capacity(entries);
    let mut masked = Counts::default();
    let mut flagged = 0u64;
    for (ordinal, entry) in input.entries.into_iter().enumerate() {
        let draft = draft(entry, &input.harness, input.project.as_ref())?;
        let ordinal = u32::try_from(ordinal).unwrap_or(u32::MAX);
        let prepared = call.prepare(draft, ordinal, pipeline::draw(cx)?, MAX_ENTRY_BYTES)?;
        masked.add(&prepared.masked);
        if !prepared.flags.is_empty() {
            flagged += 1;
        }
        writes.push(prepared.write);
    }
    let request = MemoryWriteRequest {
        path: MemoryPath::Import,
        share: input.share,
        batch: MemoryBatch {
            // No idempotency key: nothing that digests the content is kept (section 8.9).
            idempotency: None,
            capture_key: None,
            at: call.now,
            quota: call.policy.quota(),
            retention: call.policy.retention(),
            entries: writes,
        },
    };
    let receipt = cx
        .memory_write(&call.space, request)
        .map_err(|error| fail::host(&error))?;
    Ok(result(cx, &call, &receipt, flagged, &masked))
}

fn result(cx: &Cx, call: &Call, receipt: &MemoryReceipt, flagged: u64, masked: &Counts) -> Outcome {
    let count = |state: EntryState| receipt.entries.iter().filter(|e| e.state == state).count();
    let records: Vec<&str> = receipt.entries.iter().map(|e| e.id.as_str()).collect();
    let mut outcome = success(json!({
        "created": count(EntryState::Created),
        "observed": count(EntryState::Observed),
        "flagged": flagged,
        "redactions": masked.to_json(),
        "records": records,
        "verification": "unverified",
    }))
    .with_suggestion(SOURCE_REMAINS);
    if flagged > 0 {
        outcome = outcome.with_warning(
            "CONTENT_FLAGGED",
            &format!(
                "{flagged} entries matched the injection or hidden-text scan: stored and returned with their label on recall, never pushed or exported"
            ),
        );
    }
    if !masked.is_empty() {
        outcome = outcome.with_warning_details(
            "SECRETS_MASKED",
            &masked.summary(),
            json!({ "redactions": masked.to_json() }),
        );
    }
    // The event's labels are the call's, not one record's: the access set the host gave every
    // entry, read back from the first (section 8.10).
    let first = receipt
        .entries
        .first()
        .and_then(|entry| stored(cx, &call.space, &entry.id));
    let mut labels = event_labels(first.as_ref(), &call.principal, None, masked);
    if let Some(map) = labels.as_object_mut() {
        for key in ["validFrom", "validUntil", "confidence"] {
            map.remove(key);
        }
    }
    labels["origin"] = json!("document-derived");
    let mut outcome = outcome.with_metadata("dev.umbel/provenance", labels);
    if let Some(to) = receipt.to_rev {
        outcome = outcome.with_metadata(
            "dev.umbel/record",
            json!({ "kind": "memory-import", "id": call.trace, "version": to }),
        );
    }
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_path_is_relative_and_one_line() {
        assert!(path_ok("feedback_tests.md"));
        assert!(path_ok("notes.md#p2"));
        assert!(!path_ok("/home/ada/notes.md"));
        assert!(!path_ok("a\nb.md"));
        assert!(!path_ok(&"a".repeat(1025)));
    }
}

//! `memory-capture` (section 8.3): one window of a harness session, by the capture contract
//! version 1 (section 10.1), written as one batch with path `Capture`, so it is private and its
//! authority is `transcript` from a person's CLI or library call and `agent` from anything else.

use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use umbel_sdk::{Cx, MemoryPath, MemoryWriteRequest, Outcome, success};
use umbel_store::memory::{EntryState, MAX_MEMORY_BATCH, MemoryReceipt, derive_memory_id};
use umbel_store::{MemoryBatch, MemoryClass, Origin, Source};

use crate::fail;
use crate::hygiene::Counts;
use crate::pipeline::{self, Call, Draft};
use crate::remember::{event_labels, stored};

/// The most input one call takes, as canonical JSON: 1 MiB.
const MAX_CAPTURE_BYTES: usize = 1024 * 1024;
/// The most text one entry takes: 64 KiB.
const MAX_ENTRY_BYTES: usize = 64 * 1024;
/// The harness events a capture names (section 10.1).
const EVENTS: [&str; 5] = ["tool-use", "stop", "pre-compact", "session-end", "manual"];
/// The most characters of a subject.
const SUBJECT_CHARS: usize = 256;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Harness {
    name: String,
    version: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Episode {
    subject: String,
    text: String,
    started_at: Option<String>,
    part: Option<u64>,
    turns: Option<[u64; 2]>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Decision {
    subject: String,
    text: String,
    rationale: Option<String>,
    origin: Option<Origin>,
    constraints: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Artifact {
    kind: String,
    resource: String,
    title: Option<String>,
    summary: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Contract {
    version: u32,
    #[serde(default)]
    #[allow(dead_code)]
    space: Option<String>,
    harness: Harness,
    event: String,
    session: Option<String>,
    project: Option<String>,
    idempotency_key: String,
    capture_key: Option<String>,
    window: Option<u64>,
    #[serde(default)]
    episodes: Vec<Episode>,
    #[serde(default)]
    decisions: Vec<Decision>,
    #[serde(default)]
    artifacts: Vec<Artifact>,
}

pub(crate) fn run(input: &Value, cx: &Cx) -> Outcome {
    match capture(input, cx) {
        Ok(outcome) | Err(outcome) => outcome,
    }
}

/// Where a window came from: `harness:<name>/<session>#w<window>.p<part>.t<first>-<last>`, each
/// part present only when the contract gave it.
fn harness_source(contract: &Contract, part: Option<u64>, turns: Option<[u64; 2]>) -> Source {
    let mut resource = format!(
        "harness:{}/{}",
        contract.harness.name,
        contract.session.as_deref().unwrap_or_default()
    );
    let mut anchor = String::new();
    if let Some(window) = contract.window {
        anchor.push_str(&format!("w{window}"));
    }
    if let Some(part) = part {
        anchor.push_str(&format!(
            "{}p{part}",
            if anchor.is_empty() { "" } else { "." }
        ));
    }
    if let Some([first, last]) = turns {
        anchor.push_str(&format!(
            "{}t{first}-{last}",
            if anchor.is_empty() { "" } else { "." }
        ));
    }
    if !anchor.is_empty() {
        resource.push('#');
        resource.push_str(&anchor);
    }
    Source {
        resource,
        id: None,
        title: contract.harness.version.clone(),
        author: None,
        last_modified: None,
    }
}

/// A relative path or a URL, never an absolute path (section 10.1).
fn relative(resource: &str) -> bool {
    let bytes = resource.as_bytes();
    let drive = bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'/' | b'\\');
    !resource.is_empty() && !resource.starts_with(['/', '\\']) && !drive && !resource.contains('\0')
}

/// `^[a-z][a-z0-9-]{0,max-1}$`: a harness name or an artifact kind.
fn name_like(text: &str, max: usize) -> bool {
    let mut bytes = text.bytes();
    bytes.next().is_some_and(|b| b.is_ascii_lowercase())
        && text.len() <= max
        && bytes.all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// The first `max` characters of `text`.
fn cut(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}

fn drafts(contract: &Contract, now: i64) -> Result<Vec<Draft>, Outcome> {
    let base = |class, subject: String, text: String| {
        let mut draft = Draft::new(class, subject, text);
        draft.project = contract.project.clone();
        draft.session = contract.session.clone();
        draft
    };
    let mut drafts = Vec::new();
    for episode in &contract.episodes {
        let mut draft = base(
            MemoryClass::Episodic,
            episode.subject.clone(),
            episode.text.clone(),
        );
        draft.tags = vec!["episode".into()];
        draft.origin = Origin::AgentInferred;
        draft.sources = Some(vec![harness_source(contract, episode.part, episode.turns)]);
        draft.valid_from = Some(match &episode.started_at {
            Some(at) => pipeline::parse_time("startedAt", at)?,
            None => now,
        });
        drafts.push(draft);
    }
    for decision in &contract.decisions {
        let mut text = decision.text.clone();
        if let Some(rationale) = decision.rationale.as_deref().filter(|r| !r.is_empty()) {
            text.push_str("\n\nRationale: ");
            text.push_str(rationale);
        }
        let mut draft = base(MemoryClass::Semantic, decision.subject.clone(), text);
        draft.tags = vec!["decision".into()];
        draft.origin = match decision.origin {
            Some(Origin::UserStated) => Origin::UserStated,
            _ => Origin::AgentInferred,
        };
        draft.constraints = decision.constraints.clone().filter(|c| !c.is_empty());
        draft.sources = Some(vec![harness_source(contract, None, None)]);
        drafts.push(draft);
    }
    for artifact in &contract.artifacts {
        if !relative(&artifact.resource) {
            return Err(fail::invalid(
                "an artifact's resource is a relative path or a URL, never an absolute path",
            ));
        }
        let title = artifact.title.clone().filter(|t| !t.is_empty());
        let subject = cut(
            title.as_deref().unwrap_or(&artifact.resource),
            SUBJECT_CHARS,
        );
        // No bytes of the artifact: its summary, or nothing.
        let text = artifact.summary.clone().unwrap_or_default();
        let mut draft = base(MemoryClass::Episodic, subject, text);
        draft.tags = vec!["artifact".into(), format!("artifact:{}", artifact.kind)];
        draft.origin = Origin::AgentInferred;
        draft.sources = Some(vec![Source {
            resource: artifact.resource.clone(),
            id: None,
            title,
            author: None,
            last_modified: None,
        }]);
        drafts.push(draft);
    }
    Ok(drafts)
}

fn capture(input: &Value, cx: &Cx) -> Result<Outcome, Outcome> {
    // The hard caps refuse the whole call, before anything else.
    let bytes = serde_json::to_string(input).map_or(usize::MAX, |text| text.len());
    if bytes > MAX_CAPTURE_BYTES {
        return Err(fail::capture_too_large("the input is over 1 MiB"));
    }
    let contract: Contract = serde_json::from_value(input.clone())
        .map_err(|_| fail::invalid("the input does not match the capture contract, version 1"))?;
    if contract.version != 1 {
        return Err(fail::invalid("the capture contract's version is 1"));
    }
    if !EVENTS.contains(&contract.event.as_str()) {
        return Err(fail::invalid(
            "event is tool-use, stop, pre-compact, session-end or manual",
        ));
    }
    let entries = contract.episodes.len() + contract.decisions.len() + contract.artifacts.len();
    if entries > MAX_MEMORY_BATCH {
        return Err(fail::capture_too_large("more than 256 entries"));
    }
    if entries == 0 {
        return Err(fail::invalid(
            "a capture holds at least one episode, decision or artifact",
        ));
    }
    // The patterns the host's schema subset cannot state (section 10.1).
    if !name_like(&contract.harness.name, 64) {
        return Err(fail::invalid(
            "harness.name is a lowercase letter, then at most 63 lowercase letters, digits or dashes",
        ));
    }
    if contract.artifacts.iter().any(|a| !name_like(&a.kind, 32)) {
        return Err(fail::invalid(
            "an artifact's kind is a lowercase letter, then at most 31 lowercase letters, digits or dashes",
        ));
    }
    let call = Call::open(cx)?;
    for (what, label) in [
        ("project", &contract.project),
        ("session", &contract.session),
    ] {
        if let Some(label) = label {
            call.check_label(what, label)?;
        }
    }
    if contract.idempotency_key.is_empty()
        || contract.idempotency_key.chars().count() > 256
        || contract.idempotency_key.chars().any(char::is_control)
    {
        return Err(fail::invalid(
            "idempotencyKey is 1 to 256 characters with no control character",
        ));
    }
    let drafts = drafts(&contract, call.now)?;
    if drafts.iter().any(|d| d.text.len() > MAX_ENTRY_BYTES) {
        return Err(fail::capture_too_large("an entry holds more than 64 KiB"));
    }
    let mut writes = Vec::with_capacity(drafts.len());
    let mut masked = Counts::default();
    let mut flagged = 0u64;
    for (ordinal, draft) in drafts.into_iter().enumerate() {
        let ordinal = u32::try_from(ordinal).unwrap_or(u32::MAX);
        let prepared = call.prepare(draft, ordinal, pipeline::draw(cx)?, MAX_ENTRY_BYTES)?;
        masked.add(&prepared.masked);
        if !prepared.flags.is_empty() {
            flagged += 1;
        }
        writes.push(prepared.write);
    }
    let request = MemoryWriteRequest {
        path: MemoryPath::Capture,
        share: None,
        batch: MemoryBatch {
            idempotency: Some(contract.idempotency_key.clone()),
            capture_key: contract.capture_key.clone(),
            at: call.now,
            quota: call.policy.quota(),
            retention: call.policy.retention(),
            entries: writes,
        },
    };
    let receipt = cx
        .memory_write(&call.space, request)
        .map_err(|error| fail::host(&error))?;
    let capture_id = capture_id(&call, &receipt, pipeline::draw(cx)?);
    Ok(result(
        cx,
        &call,
        &contract,
        &receipt,
        &capture_id,
        entries,
        flagged,
        &masked,
    ))
}

/// `cap-` and 24 hex digits. Derived from the first record's id, which a replay returns again, so
/// a replay answers the same capture id (step 5, amendment 3); a refused capture, which wrote
/// nothing, gets one made as a record id is.
fn capture_id(call: &Call, receipt: &MemoryReceipt, draw: u64) -> String {
    let hex = match receipt.entries.first() {
        Some(first) => {
            let digest = Sha256::digest(format!("umbel-capture\0{}", first.id).as_bytes());
            digest[..12].iter().map(|b| format!("{b:02x}")).collect()
        }
        None => derive_memory_id(&call.space, &call.trace, u32::MAX, call.now, draw)
            .trim_start_matches("mem-")
            .to_owned(),
    };
    format!("cap-{hex}")
}

#[allow(clippy::too_many_arguments)]
fn result(
    cx: &Cx,
    call: &Call,
    contract: &Contract,
    receipt: &MemoryReceipt,
    capture_id: &str,
    entries: usize,
    flagged: u64,
    masked: &Counts,
) -> Outcome {
    let count = |state: EntryState| {
        if receipt.replayed {
            0
        } else {
            receipt.entries.iter().filter(|e| e.state == state).count()
        }
    };
    let refused = if receipt.refused.is_some() {
        entries
    } else {
        0
    };
    let replayed = if receipt.replayed {
        receipt.entries.len()
    } else {
        0
    };
    let records: Vec<&str> = receipt
        .entries
        .iter()
        .take(MAX_MEMORY_BATCH)
        .map(|e| e.id.as_str())
        .collect();
    let mut outcome = success(json!({
        "captureId": capture_id,
        "created": count(EntryState::Created),
        "observed": count(EntryState::Observed),
        "replayed": replayed,
        "refused": refused,
        "flagged": flagged,
        "redactions": masked.to_json(),
        "records": records,
    }));
    if flagged > 0 {
        outcome = outcome.with_warning(
            "CONTENT_FLAGGED",
            &format!(
                "{flagged} entries matched the injection or hidden-text scan: stored and returned with their label on recall, never pushed"
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
    let first = receipt
        .entries
        .first()
        .and_then(|entry| stored(cx, &call.space, &entry.id));
    let mut labels = event_labels(
        first.as_ref(),
        &call.principal,
        contract.session.clone(),
        masked,
    );
    // The window's labels, not one record's.
    for key in ["origin", "validFrom", "validUntil", "confidence"] {
        if let Some(map) = labels.as_object_mut() {
            map.remove(key);
        }
    }
    labels["origin"] = json!("agent-inferred");
    let mut outcome = outcome.with_metadata("dev.umbel/provenance", labels);
    if let Some(to) = receipt.to_rev {
        outcome = outcome.with_metadata(
            "dev.umbel/record",
            json!({ "kind": "capture", "id": capture_id, "version": to }),
        );
    }
    outcome
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    /// `capture.v1.json` reduced to the host's schema subset, as the input schema was made.
    fn reduce(value: &Value) -> Value {
        match value {
            Value::Object(map) => {
                if let (Some(Value::Array(alternatives)), 1) = (map.get("oneOf"), map.len()) {
                    let mut merged = serde_json::Map::new();
                    let types: Vec<Value> =
                        alternatives.iter().map(|a| a["type"].clone()).collect();
                    merged.insert("type".into(), Value::Array(types));
                    for alternative in alternatives {
                        for (key, item) in alternative.as_object().into_iter().flatten() {
                            if key != "type" {
                                merged.insert(key.clone(), item.clone());
                            }
                        }
                    }
                    return reduce(&Value::Object(merged));
                }
                Value::Object(
                    map.iter()
                        .filter(|(key, _)| {
                            !["pattern", "not", "$id", "$schema"].contains(&key.as_str())
                        })
                        .map(|(key, item)| (key.clone(), reduce(item)))
                        .collect(),
                )
            }
            Value::Array(items) => Value::Array(items.iter().map(reduce).collect()),
            other => other.clone(),
        }
    }

    #[test]
    fn the_input_schema_is_the_capture_contract_in_the_hosts_subset() {
        let contract: Value =
            serde_json::from_str(include_str!("../../../schemas/capture.v1.json")).unwrap();
        let mut input: Value =
            serde_json::from_str(include_str!("../schemas/memory-capture.input.json")).unwrap();
        let mut expected = reduce(&contract);
        for key in ["title", "description"] {
            input.as_object_mut().unwrap().remove(key);
            expected.as_object_mut().unwrap().remove(key);
        }
        assert_eq!(
            input, expected,
            "regenerate schemas/memory-capture.input.json"
        );
    }

    #[test]
    fn names_and_kinds_follow_the_contracts_pattern() {
        assert!(name_like("claude-code", 64));
        assert!(!name_like("Claude", 64));
        assert!(!name_like("", 64));
        assert!(!name_like(&"a".repeat(33), 32));
    }

    #[test]
    fn an_absolute_path_is_not_a_resource() {
        assert!(relative("src/deploy.rs"));
        assert!(relative("https://example.com/x"));
        assert!(!relative("/etc/passwd"));
        assert!(!relative("\\\\server\\share"));
        assert!(!relative("C:\\Users"));
        assert!(!relative("c:/x"));
    }
}

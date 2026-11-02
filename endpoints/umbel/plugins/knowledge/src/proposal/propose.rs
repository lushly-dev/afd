//! `knowledge-propose` (specification section 9.1): validate, scan, diff and store a proposal as
//! `pending`. The same key with the same change returns the existing proposal; the same key with
//! another change is `PROPOSAL_KEY_REUSED`.

use serde_json::{Value, json};
use umbel_okf::{Ingest, Kind, analyze, document_id};
use umbel_scan::scan_content;
use umbel_sdk::{CollectionInfo, Cx, HostError, Outcome, failure, success};
use umbel_store::{ContentHash, Document, Expect};

use super::area::{self, Area};
use super::common::{self, Caller, Parts, Target};
use super::diff;
use super::model::{
    Change, Op, Policy, Proposal, Proposer, State, Verification, change_hash, proposal_id,
};
use crate::fail;

/// The default largest file when the `content` grant is withheld and the collection's own limit
/// is unknown.
const DEFAULT_MAX_FILE: u64 = 1024 * 1024;

pub(crate) fn run(input: &Value, cx: &mut Cx) -> Outcome {
    let cx: &Cx = cx;
    let caller = match Caller::new(cx) {
        Ok(caller) => caller,
        Err(outcome) => return outcome,
    };
    match propose(&caller, input) {
        Ok(outcome) | Err(outcome) => outcome,
    }
}

fn invalid(reason: &str) -> Outcome {
    failure(
        "PROPOSAL_INVALID",
        &format!("the proposal was refused: {reason}"),
        "Fix the proposal and submit it again; knowledge-propose's input schema lists every field.",
    )
}

fn host(error: &HostError) -> Outcome {
    match error {
        HostError::TooLarge(_) => too_large(),
        other => fail::host(other),
    }
}

fn too_large() -> Outcome {
    failure(
        "PROPOSAL_TOO_LARGE",
        "the proposal, with its content and its diff, does not fit a record (2 MiB)",
        "Propose a smaller file, or split the change into several documents.",
    )
}

/// What the input says, checked.
struct Submission {
    key: String,
    change: Change,
    rationale: String,
    evidence: Vec<Value>,
    confidence: Option<f64>,
    run: Option<String>,
}

fn parse(input: &Value) -> Result<Submission, Outcome> {
    let key = input
        .get("idempotency_key")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if key.is_empty() || key.chars().count() > 128 || key.chars().any(char::is_control) {
        return Err(invalid("idempotency_key is 1 to 128 printable characters"));
    }
    let rationale = input
        .get("rationale")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if rationale.trim().is_empty() || rationale.chars().count() > 4000 {
        return Err(invalid("rationale is 1 to 4000 characters"));
    }
    let evidence = input
        .get("evidence")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if evidence.is_empty() || evidence.len() > 32 {
        return Err(invalid("evidence is 1 to 32 entries"));
    }
    for entry in &evidence {
        let kind = entry
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let reference = entry.get("ref").and_then(Value::as_str).unwrap_or_default();
        let excerpt_ok = entry
            .get("excerpt")
            .and_then(Value::as_str)
            .is_none_or(|text| text.chars().count() <= 1000);
        let hash_ok = entry
            .get("contentHash")
            .and_then(Value::as_str)
            .is_none_or(|hash| ContentHash::parse(hash).is_ok());
        let allowed = entry.as_object().is_some_and(|map| {
            map.keys()
                .all(|name| matches!(name.as_str(), "kind" | "ref" | "contentHash" | "excerpt"))
        });
        if !matches!(kind, "document" | "url" | "text" | "record")
            || reference.is_empty()
            || !excerpt_ok
            || !hash_ok
            || !allowed
        {
            return Err(invalid(
                "an evidence entry needs a kind (document, url, text or record) and a ref, and may carry a contentHash and an excerpt of at most 1000 characters",
            ));
        }
    }
    let confidence = match input.get("confidence") {
        None | Some(Value::Null) => None,
        Some(value) => match value.as_f64() {
            Some(number) if (0.0..=1.0).contains(&number) => Some(number),
            _ => return Err(invalid("confidence is a number from 0 to 1")),
        },
    };
    let run = input.get("run").and_then(Value::as_str).map(str::to_owned);
    if run.as_ref().is_some_and(|run| run.chars().count() > 128) {
        return Err(invalid("run is at most 128 characters"));
    }
    let change: Change = input
        .get("change")
        .cloned()
        .and_then(|value| serde_json::from_value(value).ok())
        .ok_or_else(|| {
            invalid("change needs an op (create, update, deprecate or verify) and a doc")
        })?;
    Ok(Submission {
        key: key.to_owned(),
        change,
        rationale: rationale.to_owned(),
        evidence,
        confidence,
        run,
    })
}

/// The change's shape against its op.
fn check_shape(change: &Change) -> Result<(), Outcome> {
    let has_base = change.base_hash.is_some();
    match change.op {
        Op::Create => {
            if has_base || change.content.is_none() {
                return Err(invalid("a create has content and no baseHash"));
            }
        }
        Op::Update => {
            if !has_base || change.content.is_none() {
                return Err(invalid("an update has content and the baseHash you read"));
            }
        }
        Op::Deprecate | Op::Verify => {
            if !has_base || change.content.is_some() {
                return Err(invalid(
                    "a deprecate or verify has the baseHash you read and no content",
                ));
            }
        }
    }
    if let Some(hash) = &change.base_hash
        && ContentHash::parse(hash).is_err()
    {
        return Err(invalid("baseHash is sha256:<64 hex>"));
    }
    if change.op != Op::Deprecate && change.superseded_by.is_some() {
        return Err(invalid("supersededBy belongs to a deprecate"));
    }
    if change.op != Op::Verify && change.verification.is_some() {
        return Err(invalid("verification belongs to a verify"));
    }
    if let Some(Verification {
        stale_after: Some(stale),
        ..
    }) = &change.verification
        && !umbel_okf::frontmatter::is_datetime_with_offset(stale)
    {
        return Err(invalid(
            "staleAfter is an absolute datetime with a UTC offset",
        ));
    }
    if let Some(note) = change.verification.as_ref().and_then(|v| v.note.as_ref())
        && note.chars().count() > 1000
    {
        return Err(invalid("a verification note is at most 1000 characters"));
    }
    Ok(())
}

/// The file path of a markdown document id, or why the id cannot be proposed.
pub(crate) fn file_path(doc: &str) -> Result<(String, String), Outcome> {
    let Some((collection, path)) = doc.split_once('/') else {
        return Err(invalid("doc is <collection>/<path>"));
    };
    let file = format!("{path}.md");
    match document_id(collection, &file, Kind::Markdown) {
        Ok(id) if id == doc => {}
        _ => return Err(invalid("doc is not a valid document id")),
    }
    let name = file.rsplit('/').next().unwrap_or(&file);
    if matches!(name, "index.md" | "log.md") {
        return Err(invalid("index.md and log.md are reserved files"));
    }
    Ok((collection.to_owned(), file))
}

pub(crate) fn propose(caller: &Caller<'_>, input: &Value) -> Result<Outcome, Outcome> {
    let cx = caller.cx;
    let submission = parse(input)?;
    check_shape(&submission.change)?;
    let id = proposal_id(&caller.space, &caller.actor.text(), &submission.key);
    let hash = change_hash(
        &submission.change,
        &submission.rationale,
        &submission.evidence,
    );

    // An idempotent retry comes first: it must not depend on what changed since.
    if let Some((existing, _)) = common::get(caller, &id).map_err(|e| host(&e))? {
        if existing.change_hash == hash {
            return Ok(shown(&existing, false, None));
        }
        return Err(failure(
            "PROPOSAL_KEY_REUSED",
            "that idempotency key was used for a different change; the earlier proposal is unchanged",
            "Use a new idempotency_key for a new change.",
        ));
    }

    let change = &submission.change;
    let (collection, file) = file_path(&change.doc)?;
    let areas = area::load(cx)?;
    let Some(area) = area::governing(&areas, &caller.space, &change.doc) else {
        return Err(failure(
            "PROPOSAL_NO_AREA",
            "no area governs that document",
            "Declare an area for its collection in [plugins.knowledge.config.areas] in umbel.toml.",
        ));
    };

    let info = collection_info(cx, &caller.space, &collection);
    if let Some(info) = &info
        && info.kind != "markdown"
    {
        return Err(invalid("only markdown collections take proposals"));
    }
    let existing = cx
        .doc_get(&caller.space, &change.doc)
        .map_err(|e| host(&e))?;

    let (old_text, target) = match change.op {
        Op::Create => {
            if existing.is_some() {
                return Err(conflict("the document already exists", None));
            }
            let Some(info) = &info else {
                return Err(unavailable());
            };
            let tokens = caller.tokens().map_err(|e| host(&e))?;
            if !info.access.iter().any(|token| tokens.contains(token)) {
                return Err(fail::document_not_found());
            }
            (String::new(), Target::of_collection(info))
        }
        _ => {
            let Some(document) = existing else {
                return Err(fail::document_not_found());
            };
            if Some(document.write.content_hash.as_str()) != change.base_hash.as_deref() {
                return Err(conflict(
                    "baseHash is not the document's current hash",
                    Some(document.write.content_hash.as_str()),
                ));
            }
            let target = Target {
                access: document.write.access.tokens().to_vec(),
                sensitivity: document.write.sensitivity,
            };
            (text_of(&document), target)
        }
    };

    let limit = info
        .as_ref()
        .map_or(DEFAULT_MAX_FILE, |info| info.max_file_bytes);
    let mut flags = Vec::new();
    let new_text = match change.op {
        Op::Create | Op::Update => {
            let text = change.content.clone().unwrap_or_default();
            if text.len() as u64 > limit {
                return Err(invalid(
                    "content is larger than the collection's max_file_bytes",
                ));
            }
            let default_type = info
                .as_ref()
                .map_or("document", |info| info.default_type.as_str());
            let analysis = analyze(&Ingest::new(
                text.as_bytes(),
                &file,
                Kind::Markdown,
                default_type,
            ))
            .map_err(|problem| {
                failure(
                    "FRONTMATTER_INVALID",
                    &format!("the proposed file does not read: {}", problem.reason()),
                    "Fix the frontmatter: one YAML mapping between --- lines, no tags, anchors or aliases.",
                )
            })?;
            if matches!(analysis.access, umbel_okf::frontmatter::Declared::Invalid) {
                return Err(invalid(
                    "the file's access key is not a list of valid tokens",
                ));
            }
            note_scan(&mut flags, &scan_content(&text));
            text
        }
        Op::Deprecate => {
            if let Some(by) = &change.superseded_by {
                note_scan(&mut flags, &scan_content(by));
            }
            super::apply::rewritten(&old_text, change, "human:<approver>", "<at approval>")
                .map_err(|why| invalid(&why))?
        }
        Op::Verify => {
            if let Some(note) = change.verification.as_ref().and_then(|v| v.note.as_ref()) {
                note_scan(&mut flags, &scan_content(note));
            }
            super::apply::rewritten(&old_text, change, "human:<approver>", "<at approval>")
                .map_err(|why| invalid(&why))?
        }
    };
    note_scan(&mut flags, &scan_content(&submission.rationale));
    for entry in &submission.evidence {
        if let Some(excerpt) = entry.get("excerpt").and_then(Value::as_str) {
            note_scan(&mut flags, &scan_content(excerpt));
        }
    }
    flags.sort();
    flags.dedup();

    check_evidence(caller, &submission.evidence)?;

    let diff = diff::unified(&file, &old_text, &new_text, change.op == Op::Create);
    let origin = caller.origin();
    let provenance = json!({
        "version": 1,
        "origin": origin,
        "space": caller.space,
        "plugin": "knowledge",
        "agent": if caller.is_human() { Value::Null } else { serde_json::to_value(&caller.actor).unwrap_or(Value::Null) },
        "principal": caller.principal,
        "session": submission.run,
        "traceId": cx.call().trace_id,
        "observedAt": caller.now,
        "validFrom": null,
        "validUntil": null,
        "confidence": submission.confidence,
        "authority": null,
        "sources": [{ "resource": format!("/{}", change.doc) }],
        "generated": null,
        "contentHash": hash,
        "derivedFrom": null,
        "access": target.access,
        "sensitivity": target.sensitivity,
    });
    let proposal = Proposal {
        version: 1,
        id: id.clone(),
        idempotency_key: submission.key,
        change_hash: hash.clone(),
        space: caller.space.clone(),
        area: area.id.clone(),
        state: State::Pending,
        change: submission.change,
        diff,
        rationale: submission.rationale,
        evidence: submission.evidence,
        provenance,
        policy: policy_of(area),
        exception: None,
        proposer: Proposer {
            actor: caller.actor.clone(),
            principal: caller.principal.clone(),
            run: submission.run.clone(),
        },
        confidence: submission.confidence,
        decision: None,
        result: None,
        flags: flags.clone(),
        created_at: caller.now.clone(),
        updated_at: caller.now.clone(),
    };
    if !common::fits_record(&proposal.to_value()) {
        return Err(too_large());
    }
    let record_hash =
        ContentHash::of(umbel_store::canonical_json(&proposal.to_value()).as_bytes()).to_string();
    let envelope = common::envelope(
        caller,
        Parts {
            origin,
            target,
            session: submission.run,
            confidence: submission.confidence,
            doc: proposal.change.doc.clone(),
            content_hash: Some(record_hash),
            derived_from: None,
        },
    );
    let meta = match common::save(caller, &proposal, envelope.clone(), Expect::Absent) {
        Ok(meta) => meta,
        Err(HostError::Conflict { .. }) => {
            return Err(failure(
                "PROPOSAL_CONFLICT",
                "a proposal with that id exists but the caller cannot read it",
                "Use a new idempotency_key.",
            ));
        }
        Err(error) => return Err(host(&error)),
    };
    let mut outcome = shown(&proposal, true, Some(meta.rev))
        .with_metadata(
            "dev.umbel/record",
            json!({ "kind": "proposal", "id": id, "version": meta.rev }),
        )
        .with_metadata("dev.umbel/provenance", common::provenance_meta(&envelope));
    if !flags.is_empty() {
        outcome = flagged(outcome, &flags);
    }
    Ok(outcome)
}

/// The `CONTENT_FLAGGED` warning, naming flags and no text.
pub(crate) fn flagged(outcome: Outcome, flags: &[String]) -> Outcome {
    outcome.with_warning_details(
        "CONTENT_FLAGGED",
        "the proposed text matches the write scan; an approver sees the flags",
        json!({ "flags": flags }),
    )
}

fn shown(proposal: &Proposal, created: bool, rev: Option<u64>) -> Outcome {
    let mut data = json!({
        "created": created,
        "proposal": common::summary(proposal),
    });
    if let Some(rev) = rev {
        data["rev"] = json!(rev);
    }
    success(data).with_reasoning(&format!(
        "{} proposal {} for `{}`, {}.",
        if created {
            "Stored"
        } else {
            "Found the existing"
        },
        proposal.id,
        proposal.change.doc,
        proposal.state.name()
    ))
}

pub(crate) fn policy_of(area: &Area) -> Policy {
    Policy {
        area: area.id.clone(),
        version: area.policy_version(),
        rule: "person".to_owned(),
    }
}

fn note_scan(flags: &mut Vec<String>, scan: &umbel_scan::ContentScan) {
    if scan.is_instruction_like() {
        flags.push("instruction-like".to_owned());
    }
    if scan.has_hidden_text() {
        flags.push("hidden-text".to_owned());
    }
}

fn conflict(why: &str, current: Option<&str>) -> Outcome {
    let message = match current {
        Some(current) => {
            format!("the proposal conflicts with the document: {why} (it is now {current})")
        }
        None => format!("the proposal conflicts with the document: {why}"),
    };
    failure(
        "PROPOSAL_CONFLICT",
        &message,
        "Read the document again with knowledge-open or knowledge-describe and propose against its current hash.",
    )
}

pub(crate) fn unavailable() -> Outcome {
    failure(
        "PROPOSAL_APPLY_UNAVAILABLE",
        "this instance holds no `content` grant, so it cannot learn the collection's settings or apply a proposal",
        "Enable the knowledge plugin's content, content_write and documents_write grants and allow the write grants for the space in umbel.toml.",
    )
}

/// The collection's settings when the `content` grant is held.
pub(crate) fn collection_info(cx: &Cx, space: &str, collection: &str) -> Option<CollectionInfo> {
    cx.content_collections(space)
        .ok()?
        .into_iter()
        .find(|info| info.id == collection)
}

pub(crate) fn text_of(document: &Document) -> String {
    String::from_utf8_lossy(&document.write.bytes).into_owned()
}

/// A `document` evidence entry must name a readable document and its current hash; the answer is
/// the same for an absent document, an unreadable one and a stale hash.
fn check_evidence(caller: &Caller<'_>, evidence: &[Value]) -> Result<(), Outcome> {
    for entry in evidence {
        if entry.get("kind").and_then(Value::as_str) != Some("document") {
            continue;
        }
        let reference = entry.get("ref").and_then(Value::as_str).unwrap_or_default();
        let wanted = entry.get("contentHash").and_then(Value::as_str);
        let current = caller
            .cx
            .doc_get(&caller.space, reference)
            .map_err(|e| host(&e))?;
        let ok = match (current, wanted) {
            (Some(document), Some(wanted)) => document.write.content_hash.as_str() == wanted,
            _ => false,
        };
        if !ok {
            return Err(failure(
                "PROPOSAL_EVIDENCE_INVALID",
                "a document evidence entry must name a readable document and its current contentHash",
                "Read the document again and cite its current contentHash, or cite it as text.",
            ));
        }
    }
    Ok(())
}

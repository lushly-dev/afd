//! Deciding a proposal and applying it (specification sections 9.2 and 9.3): `knowledge-approve`,
//! `knowledge-reject` and `knowledge-verify`, all CLI-only, all for a person at a terminal.
//!
//! Approving is a short sequence, each step safe to run again: check the current file against the
//! proposal's `baseHash`, record the decision (`approved`), write the file through the `content`
//! grant with a compare-and-set on its hash, put the document with the proposal as its lineage,
//! record `applied`. A run that stops between steps is resumed by running approve again; it skips
//! what is already done. The file replace and the hash check are not atomic against a writer
//! outside Umbel; Umbel's own writers are serialised by the document store's compare-and-set.
//!
//! Approve never indexes: an indexer applies changes in revision order and approve must not wait
//! on its lock, so the result says `indexed: false` and search reports `INDEX_STALE` until the
//! next `knowledge-index` or `knowledge-refresh`.

use serde_json::{Value, json};
use umbel_okf::frontmatter::split;
use umbel_okf::rewrite_keys;
use umbel_sdk::{Cx, HostError, Outcome, failure, success};
use umbel_store::{ContentHash, Expect, Origin, Record, canonical_json};

use super::area::{self, Area};
use super::common::{self, Caller};
use super::document::{self, Inherit};
use super::model::{Change, Decision, Op, Proposal, State};
use super::propose::{self, file_path, unavailable};
use crate::fail;

fn host(error: &HostError) -> Outcome {
    match error {
        HostError::TooLarge(_) => failure(
            "PROPOSAL_TOO_LARGE",
            "the proposal does not fit a record (2 MiB)",
            "Propose a smaller file.",
        ),
        other => fail::host(other),
    }
}

/// The frontmatter keys a deprecate or a verify writes, applied to `old_text`; `by` and `at` are
/// the verifying person and time. Every other byte of the file stays as it was.
///
/// # Errors
/// Why the file cannot be rewritten (a sentence naming no content).
pub(crate) fn rewritten(
    old_text: &str,
    change: &Change,
    by: &str,
    at: &str,
) -> Result<String, String> {
    let keys: Vec<(&str, Value)> = match change.op {
        Op::Deprecate => {
            let mut keys = vec![("status", json!("deprecated"))];
            if let Some(next) = &change.superseded_by {
                keys.push(("superseded_by", json!(next)));
            }
            keys
        }
        Op::Verify => {
            let mut verified = verified_list(old_text)?;
            verified.push(json!({ "by": by, "at": at }));
            let mut keys = vec![("verified", Value::Array(verified))];
            if let Some(stale) = change
                .verification
                .as_ref()
                .and_then(|v| v.stale_after.as_ref())
            {
                keys.push(("stale_after", json!(stale)));
            }
            keys
        }
        Op::Create | Op::Update => return Err("only a deprecate or a verify rewrites keys".into()),
    };
    rewrite_keys(old_text, &keys).map_err(|error| error.to_string())
}

/// The file's `verified` entries as a list (a single mapping is a one-element list, as OKF
/// allows).
fn verified_list(text: &str) -> Result<Vec<Value>, String> {
    let parts = split(text.as_bytes()).map_err(|problem| problem.to_string())?;
    Ok(match parts.fields.and_then(|mut f| f.remove("verified")) {
        Some(Value::Array(items)) => items,
        Some(entry @ Value::Object(_)) => vec![entry],
        _ => Vec::new(),
    })
}

/// Whether the file already holds what a deprecate or a verify decided at `at` by `by` writes.
fn effect_present(text: &str, change: &Change, by: &str, at: &str) -> bool {
    let Ok(parts) = split(text.as_bytes()) else {
        return false;
    };
    let fields = parts.fields.unwrap_or_default();
    match change.op {
        Op::Deprecate => {
            fields.get("status") == Some(&json!("deprecated"))
                && change
                    .superseded_by
                    .as_ref()
                    .is_none_or(|next| fields.get("superseded_by") == Some(&json!(next)))
        }
        Op::Verify => verified_list(text).unwrap_or_default().iter().any(|entry| {
            entry.get("by") == Some(&json!(by)) && entry.get("at") == Some(&json!(at))
        }),
        Op::Create | Op::Update => false,
    }
}

/// A proposal and the area that governs it, for a caller who may decide it.
struct Gate {
    proposal: Proposal,
    record: Record,
    area: Area,
}

fn not_approver(why: &str) -> Outcome {
    failure(
        "PROPOSAL_APPROVER_NOT_ALLOWED",
        &format!("the caller may not decide this proposal: {why}"),
        "Ask an approver of the area to decide it; approvers are listed in [plugins.knowledge.config.areas.<id>] in umbel.toml.",
    )
}

/// The checks every decision shares: a person, the proposal readable by that person (so the
/// decision never shows what they may not read), the area's approvers.
fn gate(caller: &Caller<'_>, id: &str) -> Result<Gate, Outcome> {
    if !caller.is_human() || caller.actor.id.is_none() {
        return Err(not_approver(
            "only a person at a terminal decides a proposal",
        ));
    }
    let Some((proposal, record)) = common::get(caller, id).map_err(|e| host(&e))? else {
        return Err(common::not_found());
    };
    let areas = area::load(caller.cx)?;
    let area = area::by_id(&areas, &proposal.area)
        .or_else(|| area::governing(&areas, &proposal.space, &proposal.change.doc))
        .cloned()
        .ok_or_else(|| {
            failure(
                "PROPOSAL_NO_AREA",
                "no area governs that document any more",
                "Declare an area for its collection in [plugins.knowledge.config.areas] in umbel.toml.",
            )
        })?;
    let tokens = caller.tokens().map_err(|e| host(&e))?;
    // The proposal record carries its target's access set, so reading it proved the approver may
    // read the target; check the target itself too, as the document may have changed since.
    match proposal.change.op {
        Op::Create => {
            let (collection, _) = proposal.split_doc().unwrap_or_default();
            let Some(info) = propose::collection_info(caller.cx, &caller.space, collection) else {
                return Err(unavailable());
            };
            if !info.access.iter().any(|token| tokens.contains(token)) {
                return Err(common::not_found());
            }
        }
        _ => {
            let readable = caller
                .cx
                .doc_get(&caller.space, &proposal.change.doc)
                .map_err(|e| host(&e))?;
            if readable.is_none() {
                return Err(common::not_found());
            }
        }
    }
    if !area.admits(&tokens) {
        return Err(not_approver("it is not among the area's approvers"));
    }
    Ok(Gate {
        proposal,
        record,
        area,
    })
}

pub(crate) fn approve(input: &Value, cx: &mut Cx) -> Outcome {
    let cx: &Cx = cx;
    let caller = match Caller::new(cx) {
        Ok(caller) => caller,
        Err(outcome) => return outcome,
    };
    let id = input
        .get("proposal")
        .and_then(Value::as_str)
        .unwrap_or_default();
    match approve_inner(&caller, id) {
        Ok(outcome) | Err(outcome) => outcome,
    }
}

fn approve_inner(caller: &Caller<'_>, id: &str) -> Result<Outcome, Outcome> {
    let Gate {
        proposal,
        record,
        area,
    } = gate(caller, id)?;
    if !matches!(proposal.state, State::Pending | State::Approved) {
        return Err(common::wrong_state(
            &proposal,
            "only a pending proposal, or an approved one whose apply stopped, is approved",
        ));
    }
    // A verification is the approver's own attestation, not a change someone else wrote
    // (decision D63): applying one's own is not self-approval.
    let same_actor =
        caller.actor.text() == proposal.proposer.actor.text() && proposal.change.op != Op::Verify;
    let exception = if same_actor {
        if !area.allow_self_approval {
            return Err(failure(
                "PROPOSAL_SELF_APPROVAL",
                "the area does not let an actor approve its own proposal",
                "Ask another approver of the area, or set allow_self_approval for the area in umbel.toml.",
            ));
        }
        Some("self-approval".to_owned())
    } else {
        None
    };
    apply(caller, proposal, record, &area, exception)
}

/// Record the decision if it is not recorded, then write the file, the document and `applied`.
fn apply(
    caller: &Caller<'_>,
    mut proposal: Proposal,
    record: Record,
    area: &Area,
    exception: Option<String>,
) -> Result<Outcome, Outcome> {
    let cx = caller.cx;
    let space = &caller.space;
    let (collection, file) = file_path(&proposal.change.doc)?;
    let info = propose::collection_info(cx, space, &collection);
    let current: Option<Vec<u8>> = match cx.content_read(space, &collection, &file) {
        Ok(bytes) => Some(bytes),
        Err(HostError::NotFound(_)) => None,
        Err(HostError::NotGranted(_)) => return Err(unavailable()),
        Err(error) => return Err(host(&error)),
    };
    let current_hash = current
        .as_ref()
        .map(|bytes| ContentHash::of(bytes).to_string());

    // Who decided and when: a resumed apply keeps the first decision, so the same bytes result.
    let (by, at) = match (&proposal.state, &proposal.decision) {
        (State::Approved, Some(decision)) => (decision.by.text(), decision.at.clone()),
        _ => (caller.actor.text(), caller.now.clone()),
    };
    let change = proposal.change.clone();
    let text_now = current
        .as_deref()
        .map(|bytes| String::from_utf8_lossy(bytes).into_owned());

    // What the file must become, and whether it already is.
    let (target, already): (Vec<u8>, bool) = match change.op {
        Op::Create | Op::Update => {
            let wanted = change.content.clone().unwrap_or_default().into_bytes();
            let done = current_hash.as_deref() == Some(ContentHash::of(&wanted).as_str());
            (wanted, done)
        }
        Op::Deprecate | Op::Verify => {
            if text_now
                .as_deref()
                .is_some_and(|text| effect_present(text, &change, &by, &at))
            {
                (current.clone().unwrap_or_default(), true)
            } else if let Some(text) = &text_now {
                let new = rewritten(text, &change, &by, &at).map_err(|why| {
                    failure(
                        "PROPOSAL_APPLY_FAILED",
                        &format!("the file cannot be rewritten: {why}"),
                        "Fix the document's frontmatter, then propose again.",
                    )
                })?;
                (new.into_bytes(), false)
            } else {
                (Vec::new(), false)
            }
        }
    };
    if !already {
        let ready = match change.op {
            Op::Create => current.is_none(),
            _ => current_hash.is_some() && current_hash == change.base_hash,
        };
        if !ready {
            return Err(failure(
                "PROPOSAL_CONFLICT",
                "the file is not the one the proposal was made against; nothing was changed",
                "Read the document again and propose against its current hash.",
            ));
        }
    }

    // Step 1: record the decision.
    let (mut meta_hash, mut last_rev) = (record.content_hash.to_string(), record.rev);
    if proposal.state == State::Pending {
        proposal.state = State::Approved;
        proposal.decision = Some(Decision {
            by: caller.actor.clone(),
            principal: caller.principal.clone(),
            at: caller.now.clone(),
            reason: None,
            trace_id: caller.cx.call().trace_id.clone(),
            proposer_kind: proposal.proposer.actor.kind.clone(),
        });
        proposal.exception = exception;
        proposal.policy = propose::policy_of(area);
        proposal.updated_at = caller.now.clone();
        let meta = save_next(caller, &proposal, &record)?;
        (meta_hash, last_rev) = (meta.content_hash.to_string(), meta.rev);
    }

    // Step 2: the file.
    if !already {
        let expect = match change.op {
            Op::Create => Expect::Absent,
            _ => Expect::Hash(
                ContentHash::parse(&current_hash.clone().unwrap_or_default()).map_err(|_| {
                    failure(
                        "PROPOSAL_CONFLICT",
                        "the file has no hash",
                        "Propose again.",
                    )
                })?,
            ),
        };
        match cx.content_replace(space, &collection, &file, &target, expect) {
            Ok(_) => {}
            Err(HostError::Conflict { .. }) => {
                return Err(apply_failed(
                    caller,
                    &mut proposal,
                    &meta_hash,
                    "the file changed while the proposal was applied",
                ));
            }
            Err(HostError::NotGranted(_)) => return Err(unavailable()),
            Err(error) => return Err(host(&error)),
        }
    }
    let final_hash = ContentHash::of(&target);

    // Step 3: the document.
    let default_type = info
        .as_ref()
        .map_or("document", |info| info.default_type.as_str())
        .to_owned();
    let doc_origin = if proposal.proposer.actor.kind == "human" {
        Origin::UserStated
    } else {
        Origin::AgentInferred
    };
    let mut written = None;
    for _ in 0..2 {
        let stored = cx
            .doc_get(space, &proposal.change.doc)
            .map_err(|e| host(&e))?;
        if let Some(stored) = &stored
            && stored.write.content_hash == final_hash
        {
            written = Some((
                stored.rev,
                stored.write.access.tokens().to_vec(),
                stored.write.sensitivity,
            ));
            break;
        }
        let inherit = match (&stored, &info) {
            (Some(stored), _) => Inherit::of_document(stored),
            (None, Some(info)) => Inherit::of_collection(info),
            (None, None) => return Err(unavailable()),
        };
        let write = document::build(
            &proposal,
            target.clone(),
            &file,
            &default_type,
            &inherit,
            &meta_hash,
            doc_origin,
        )
        .map_err(|problem| match problem {
            document::Problem::Frontmatter(reason) => failure(
                "FRONTMATTER_INVALID",
                &format!("the applied file does not read: {reason}"),
                "Fix the proposal's content and propose again.",
            ),
            document::Problem::Access => failure(
                "PROPOSAL_INVALID",
                "the file's access key is not a list of valid tokens",
                "Fix the access key and propose again.",
            ),
        })?;
        let access = write.access.tokens().to_vec();
        let sensitivity = write.sensitivity;
        let expect = stored.as_ref().map_or(Expect::Absent, |stored| {
            Expect::Hash(stored.write.content_hash.clone())
        });
        match cx.doc_put(space, write, expect) {
            Ok(put) => {
                written = Some((put.rev, access, sensitivity));
                break;
            }
            Err(HostError::Conflict { .. }) => {}
            Err(HostError::NotGranted(_)) => return Err(unavailable()),
            Err(error) => return Err(host(&error)),
        }
    }
    let Some((doc_rev, doc_access, doc_sensitivity)) = written else {
        return Err(apply_failed(
            caller,
            &mut proposal,
            &meta_hash,
            "the document store changed while the proposal was applied",
        ));
    };

    // Step 4: applied.
    proposal.state = State::Applied;
    proposal.result = Some(json!({
        "rev": doc_rev,
        "contentHash": final_hash.to_string(),
        "path": file,
    }));
    proposal.updated_at = caller.now.clone();
    let applied_record = Record {
        content_hash: ContentHash::parse(&meta_hash)
            .map_err(|e| fail::host(&HostError::Corrupt(e.to_string())))?,
        rev: last_rev,
        ..record
    };
    let meta = save_next(caller, &proposal, &applied_record)?;
    let mut envelope = applied_record.envelope.clone();
    envelope.origin = Origin::UserStated;
    envelope.access.clone_from(&doc_access);
    envelope.sensitivity = Some(doc_sensitivity);
    envelope.content_hash = Some(final_hash.to_string());
    envelope.confidence = None;
    envelope.derived_from = None;
    let outcome = success(json!({
        "applied": true,
        "indexed": false,
        "proposal": common::summary(&proposal),
        "document": { "id": proposal.change.doc, "rev": doc_rev, "contentHash": final_hash.to_string() },
        "nextStep": "knowledge-refresh",
    }))
    .with_reasoning(&format!(
        "Applied proposal {} to `{}` at revision {doc_rev}; the index is behind until knowledge-refresh runs.",
        proposal.id, proposal.change.doc
    ))
    .with_metadata(
        "dev.umbel/record",
        json!({ "kind": "proposal", "id": proposal.id, "version": meta.rev }),
    )
    .with_metadata("dev.umbel/provenance", common::provenance_meta(&envelope));
    Ok(outcome)
}

/// Save `proposal` over `record`'s version with the next envelope, compare-and-set.
fn save_next(
    caller: &Caller<'_>,
    proposal: &Proposal,
    record: &Record,
) -> Result<umbel_store::RecordMeta, Outcome> {
    let mut envelope = record.envelope.clone();
    envelope.origin = Origin::UserStated;
    envelope.observed_at.clone_from(&caller.now);
    envelope.derived_from = None;
    envelope.content_hash =
        Some(ContentHash::of(canonical_json(&proposal.to_value()).as_bytes()).to_string());
    common::save(
        caller,
        proposal,
        envelope,
        Expect::Hash(record.content_hash.clone()),
    )
    .map_err(|error| match error {
        HostError::Conflict { .. } => failure(
            "PROPOSAL_CONFLICT",
            "another process decided or changed the proposal at the same time; nothing more was done",
            "Look at the proposal with knowledge-proposal-show and run the command again if it is still pending.",
        ),
        other => host(&other),
    })
}

/// Note that an apply failed on the proposal (state `approved`, so approve can resume) and answer.
fn apply_failed(
    caller: &Caller<'_>,
    proposal: &mut Proposal,
    meta_hash: &str,
    why: &str,
) -> Outcome {
    proposal.result = Some(json!({ "error": why }));
    proposal.updated_at.clone_from(&caller.now);
    if let Ok(Some((_, record))) = common::get(caller, &proposal.id) {
        let _ = save_next(caller, proposal, &record);
    }
    let _ = meta_hash;
    failure(
        "PROPOSAL_CONFLICT",
        &format!("{why}; the proposal stays approved and can be applied again"),
        "Check the document, then run knowledge-approve again to resume, or reject the proposal.",
    )
}

pub(crate) fn reject(input: &Value, cx: &mut Cx) -> Outcome {
    let cx: &Cx = cx;
    let caller = match Caller::new(cx) {
        Ok(caller) => caller,
        Err(outcome) => return outcome,
    };
    let id = input
        .get("proposal")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let reason = input
        .get("reason")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if reason.trim().is_empty() || reason.chars().count() > 2000 {
        return failure(
            "PROPOSAL_REASON_REQUIRED",
            "a rejection carries a reason of 1 to 2000 characters",
            "Say why: the curator reads the reason on its next run.",
        );
    }
    match reject_inner(&caller, id, reason) {
        Ok(outcome) | Err(outcome) => outcome,
    }
}

fn reject_inner(caller: &Caller<'_>, id: &str, reason: &str) -> Result<Outcome, Outcome> {
    let Gate {
        mut proposal,
        record,
        area,
    } = gate(caller, id)?;
    if proposal.state != State::Pending {
        return Err(common::wrong_state(
            &proposal,
            "only a pending proposal is rejected",
        ));
    }
    proposal.state = State::Rejected;
    proposal.decision = Some(Decision {
        by: caller.actor.clone(),
        principal: caller.principal.clone(),
        at: caller.now.clone(),
        reason: Some(reason.to_owned()),
        trace_id: caller.cx.call().trace_id.clone(),
        proposer_kind: proposal.proposer.actor.kind.clone(),
    });
    proposal.policy = propose::policy_of(&area);
    proposal.updated_at.clone_from(&caller.now);
    let meta = save_next(caller, &proposal, &record)?;
    let mut envelope = record.envelope.clone();
    envelope.origin = Origin::UserStated;
    envelope.content_hash = Some(meta.content_hash.to_string());
    Ok(success(json!({
        "rejected": true,
        "proposal": common::summary(&proposal),
    }))
    .with_reasoning(&format!("Rejected proposal {}.", proposal.id))
    .with_metadata(
        "dev.umbel/record",
        json!({ "kind": "proposal", "id": proposal.id, "version": meta.rev }),
    )
    .with_metadata("dev.umbel/provenance", common::provenance_meta(&envelope)))
}

/// Apply a proposal the caller just submitted as their own verification: no self-approval
/// exception, because a verification is the approver's attestation, not a change someone else
/// wrote (D63).
pub(crate) fn apply_own(
    caller: &Caller<'_>,
    proposal: Proposal,
    record: Record,
    area: &Area,
) -> Result<Outcome, Outcome> {
    apply(caller, proposal, record, area, None)
}

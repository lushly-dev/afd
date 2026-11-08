//! `knowledge-propose-batch` (phase 4 specification, sections 3.2, 9.1 and 11.2; D91, D103): up
//! to 50 proposals and 50 withdrawals in one call, with a result per item.
//!
//! A call that is no pipeline step has `drafter: null`: an ordinary batch by its caller, each
//! item `knowledge-propose`'s validation, and any drafter's claim (memory evidence, a memory
//! `derivedFrom`, a `conflictSet`, a `drafter` object) or withdrawal is `PROPOSAL_EVIDENCE_INVALID`
//! for its item. A step attested to an instance `drafters` does not list is
//! `PROPOSAL_DRAFTER_NOT_ALLOWED` for the whole call. A listed drafter's proposals carry the
//! host's attestation as their `drafter` and are `agent-inferred`; every claim beyond it is
//! verified against the memory store (each source read once per batch, under the caller's reader
//! filter) and the fixed rendering before it is stored ([`super::checks`]): a mismatch is
//! `PROPOSAL_DRAFT_MISMATCH`, and a claim this instance cannot verify is
//! `PROPOSAL_DRAFT_UNVERIFIABLE`. A drafted proposal for a document, or a memory source, that
//! already has an open proposal is `PROPOSAL_ALREADY_OPEN`, alternatives of one conflict set apart.
//!
//! Withdrawals run first, then the `erased` notice (the memory records the drafter saw erased,
//! whose drafts are redacted in every state but applied), so a draft replacing a withdrawn one is
//! not refused as already open.
//! After a redaction the batch runs a reporting checkpoint and says whether the removed bytes are
//! gone (`checkpoint: "clean"`) or wait for a later one (`"pending"`, with the warning
//! `PROPOSAL_REDACTION_PENDING`).

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Map, Value, json};
use umbel_sdk::{Cx, Outcome, PipelineAttestation, WalCheckpoint, failure, success};

use umbel_store::DerivedFrom;

use super::attest;
use super::checks::{self, Draftable, Member};
use super::common::{self, Caller};
use super::model::{Change, Drafter, KIND, MODE_SCHEDULED, Proposal, memory_sources};
use super::propose::{self, Drafted, Submitted};
use super::redact;
use super::sources::Sources;
use crate::fail;

/// The most proposals, and the most withdrawals, one batch takes.
pub(crate) const MAX_ITEMS: usize = 50;
/// The most distinct memory sources one batch cites (each is read once per batch, section 3.2).
pub(crate) const MAX_SOURCES: usize = 400;
/// The input keys only a drafter may send, beyond `knowledge-propose`'s.
const DRAFTER_KEYS: [&str; 3] = ["drafter", "conflictSet", "derivedFrom"];
/// The records read from the store at a time when collecting the open proposals.
const PAGE: u32 = 100;

pub(crate) fn run(input: &Value, cx: &mut Cx) -> Outcome {
    let cx: &Cx = cx;
    let caller = match Caller::new(cx) {
        Ok(caller) => caller,
        Err(outcome) => return outcome,
    };
    match batch(&caller, input) {
        Ok(outcome) | Err(outcome) => outcome,
    }
}

fn too_large(what: &str) -> Outcome {
    failure(
        "PROPOSAL_BATCH_TOO_LARGE",
        &format!("the batch is too large: {what}"),
        "Send at most 50 proposals, 50 withdrawals and 400 distinct memory sources per batch; split the rest into later batches.",
    )
}

fn list<'a>(input: &'a Value, key: &str) -> Result<&'a [Value], Outcome> {
    match input.get(key) {
        None | Some(Value::Null) => Ok(&[]),
        Some(Value::Array(items)) => Ok(items),
        Some(_) => Err(failure(
            "PROPOSAL_INVALID",
            &format!("the batch was refused: {key} is a list"),
            "Pass proposals, and withdraw if any, as lists.",
        )),
    }
}

fn batch(caller: &Caller<'_>, input: &Value) -> Result<Outcome, Outcome> {
    let cx = caller.cx;
    let attestation = attest::accepted(cx)?;
    let proposals = list(input, "proposals")?;
    let withdrawals = list(input, "withdraw")?;
    if proposals.len() > MAX_ITEMS {
        return Err(too_large(&format!(
            "{} proposals, more than {MAX_ITEMS}",
            proposals.len()
        )));
    }
    if withdrawals.len() > MAX_ITEMS {
        return Err(too_large(&format!(
            "{} withdrawals, more than {MAX_ITEMS}",
            withdrawals.len()
        )));
    }
    let sources: BTreeSet<String> = proposals
        .iter()
        .filter_map(|item| item.get("evidence").and_then(Value::as_array))
        .flat_map(|evidence| memory_sources(evidence))
        .collect();
    if sources.len() > MAX_SOURCES {
        return Err(too_large(&format!(
            "{} distinct memory sources, more than {MAX_SOURCES}",
            sources.len()
        )));
    }
    let erased = erased_sources(input)?;
    if !erased.is_empty() && attestation.is_none() {
        return Err(redact::unattested());
    }
    // Each memory source is read once per batch, under the caller's reader filter.
    let memory = Sources::new(caller);

    // Withdrawals first: a draft that replaces a withdrawn one must not find it open.
    let mut withdrawn_results = Vec::with_capacity(withdrawals.len());
    let (mut withdrawn, mut redacted, mut forgotten) = (0usize, 0usize, 0u64);
    for (index, item) in withdrawals.iter().enumerate() {
        let id = item.get("proposal").cloned().unwrap_or(Value::Null);
        withdrawn_results.push(
            match redact::withdraw(caller, attestation.as_ref(), &memory, item) {
                Ok(done) => {
                    withdrawn += usize::from(done.withdrawn);
                    redacted += usize::from(done.redacted);
                    forgotten += done.forgotten;
                    json!({
                        "index": index,
                        "ok": true,
                        "withdrawn": done.withdrawn,
                        "redacted": done.redacted,
                        "proposal": common::summary(&done.proposal),
                    })
                }
                Err(outcome) => refused(index, Some(id), &outcome),
            },
        );
    }

    // Then the drafts citing an erased source, whatever their state but applied (amendment 12).
    let swept = match &attestation {
        Some(attestation) if !erased.is_empty() => {
            let swept = redact::sweep(caller, attestation, &memory, &erased)?;
            withdrawn += swept.withdrawn.len();
            redacted += swept.redacted.len();
            forgotten += swept.forgotten;
            Some(swept)
        }
        _ => None,
    };

    let mut open = match &attestation {
        Some(_) if !proposals.is_empty() => Some(Open::collect(caller)?),
        _ => None,
    };
    let mut results = Vec::with_capacity(proposals.len());
    let (mut created, mut existing) = (0usize, 0usize);
    for (index, item) in proposals.iter().enumerate() {
        match one(caller, attestation.as_ref(), &memory, open.as_ref(), item) {
            Ok(submitted) => {
                if submitted.created {
                    created += 1;
                } else {
                    existing += 1;
                }
                if let Some(open) = open.as_mut() {
                    open.add(&submitted.proposal);
                }
                let mut result = json!({
                    "index": index,
                    "ok": true,
                    "created": submitted.created,
                    "proposal": common::summary(&submitted.proposal),
                });
                if let Some(rev) = submitted.rev {
                    result["rev"] = rev;
                }
                results.push(result);
            }
            Err(outcome) => results.push(refused(index, None, &outcome)),
        }
    }

    let checkpoint = if redacted > 0 || forgotten > 0 {
        Some(match cx.truncate_wal(&caller.space) {
            Ok(WalCheckpoint::Clean) => "clean",
            Ok(WalCheckpoint::Pending) | Err(_) => "pending",
        })
    } else {
        None
    };
    let refused_count = results.len() - created - existing;
    let mut outcome = success(json!({
        "space": caller.space,
        "drafter": attestation.as_ref().map(|a| json!({
            "plugin": a.plugin, "instance": a.instance, "pipeline": a.pipeline, "run": a.run,
        })),
        "results": results,
        "withdrawals": withdrawn_results,
        "erased": swept.as_ref().map(|swept| json!({
            "sources": erased.len(),
            "redacted": swept.redacted,
            "withdrawn": swept.withdrawn,
            "refused": swept.refused,
        })),
        "counts": {
            "created": created,
            "existing": existing,
            "refused": refused_count,
            "withdrawn": withdrawn,
            "redacted": redacted,
            "withdrawalsRefused": withdrawals.len() - withdrawn_results.iter().filter(|r| r["ok"] == true).count(),
        },
        "checkpoint": checkpoint,
    }))
    .with_reasoning(&format!(
        "Stored {created} proposal(s), found {existing} already stored and refused {refused_count}; withdrew {withdrawn} and redacted {redacted}."
    ));
    if checkpoint == Some("pending") {
        outcome = outcome.with_warning(
            "PROPOSAL_REDACTION_PENDING",
            "the redacted text is gone from the proposal, but a reader holds the store's write-ahead log, which keeps the earlier bytes until a later checkpoint; run store-check once no reader holds the store",
        );
    }
    Ok(outcome)
}

/// The memory record ids of the `erased` notice: each `mem-` and 24 hex digits, at most
/// [`MAX_SOURCES`] distinct.
fn erased_sources(input: &Value) -> Result<BTreeSet<String>, Outcome> {
    let ids = list(input, "erased")?;
    let mut erased = BTreeSet::new();
    for id in ids {
        let id = id.as_str().unwrap_or_default();
        let hex = id.strip_prefix("mem-").unwrap_or_default();
        if hex.len() != 24
            || !hex
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(failure(
                "PROPOSAL_INVALID",
                "the batch was refused: an erased source is a memory record id, mem- and 24 hex digits",
                "Name the records the memory store's changes feed reported erased.",
            ));
        }
        erased.insert(id.to_owned());
    }
    if erased.len() > MAX_SOURCES {
        return Err(too_large(&format!(
            "{} erased sources, more than {MAX_SOURCES}",
            erased.len()
        )));
    }
    Ok(erased)
}

/// An item's refusal: its index, the proposal a withdrawal named, and the failure's error.
fn refused(index: usize, proposal: Option<Value>, outcome: &Outcome) -> Value {
    let mut result = json!({
        "index": index,
        "ok": false,
        "error": outcome.as_value().get("error").cloned().unwrap_or(Value::Null),
    });
    if let Some(proposal) = proposal {
        result["proposal"] = proposal;
    }
    result
}

/// One proposal of the batch.
fn one(
    caller: &Caller<'_>,
    attestation: Option<&PipelineAttestation>,
    memory: &Sources<'_, '_>,
    open: Option<&Open>,
    item: &Value,
) -> Result<Submitted, Outcome> {
    let Some(fields) = item.as_object() else {
        return Err(failure(
            "PROPOSAL_INVALID",
            "the proposal was refused: an item is an object",
            "Give each item knowledge-propose's fields.",
        ));
    };
    let (Some(attestation), Some(open)) = (attestation, open) else {
        if claims_any(fields) {
            return Err(claims_unattested());
        }
        return propose::submit(caller, item, None);
    };
    let claims = Claims::parse(fields)?;
    let mut plain: Map<String, Value> = fields.clone();
    for key in DRAFTER_KEYS {
        plain.remove(key);
    }
    let drafter = Drafter {
        plugin: attestation.plugin.clone(),
        instance: attestation.instance.clone(),
        pipeline: attestation.pipeline.clone(),
        run: attestation.run.clone(),
        mode: claims.mode,
        candidate: claims.candidate,
        promoted_by: claims.promoted_by,
    };
    let members = claims
        .conflict_set
        .as_deref()
        .map(|set| open.members(set))
        .unwrap_or_default();
    let target = attest::target(caller.cx, &attestation.instance, &caller.space);
    let draftable = Draftable {
        caller,
        attestation,
        sources: memory,
        drafter: &drafter,
        conflict_set: claims.conflict_set.as_deref(),
        derived_from: claims.derived_from.as_deref(),
        members: &members,
        target: target.as_ref(),
    };
    let verify = |submission: &propose::Submission| checks::verify(&draftable, submission);
    let already_open = |change: &Change, conflict_set: Option<&str>, evidence: &[Value]| {
        open.blocks(change, conflict_set, evidence)
    };
    propose::submit(
        caller,
        &Value::Object(plain),
        Some(Drafted {
            drafter: drafter.clone(),
            conflict_set: claims.conflict_set.clone(),
            derived_from: claims.derived_from.clone(),
            verify: &verify,
            already_open: &already_open,
        }),
    )
}

/// Whether an item claims what only a drafter may: memory evidence, a `derivedFrom`, a
/// `conflictSet` or a `drafter` object.
fn claims_any(fields: &Map<String, Value>) -> bool {
    let present = |key: &str| fields.get(key).is_some_and(|value| !value.is_null());
    present("derivedFrom")
        || present("conflictSet")
        || present("drafter")
        || fields
            .get("evidence")
            .and_then(Value::as_array)
            .is_some_and(|evidence| !memory_sources(evidence).is_empty())
}

/// A listed drafter's claims beyond `knowledge-propose`'s fields, in their shapes; section 3.2
/// verifies what they say ([`checks::verify`]).
struct Claims {
    mode: String,
    candidate: Option<String>,
    promoted_by: Option<String>,
    conflict_set: Option<String>,
    derived_from: Option<Vec<DerivedFrom>>,
}

impl Claims {
    fn parse(fields: &Map<String, Value>) -> Result<Self, Outcome> {
        let invalid = |why: &str| {
            failure(
                "PROPOSAL_INVALID",
                &format!("the proposal was refused: {why}"),
                "Fix the draft; knowledge-propose-batch's input schema lists every field.",
            )
        };
        let text = |value: Option<&Value>, what: &str| -> Result<Option<String>, Outcome> {
            match value {
                None | Some(Value::Null) => Ok(None),
                Some(Value::String(text)) => Ok(Some(text.clone())),
                Some(_) => Err(invalid(&format!("{what} is a string"))),
            }
        };
        let drafter = match fields.get("drafter") {
            None | Some(Value::Null) => Map::new(),
            Some(Value::Object(map)) => map.clone(),
            Some(_) => return Err(invalid("drafter is an object")),
        };
        if drafter
            .keys()
            .any(|key| !matches!(key.as_str(), "mode" | "candidate" | "promotedBy"))
        {
            return Err(invalid(
                "drafter carries only mode, candidate and promotedBy; the host attests the rest",
            ));
        }
        let mode =
            text(drafter.get("mode"), "drafter.mode")?.unwrap_or_else(|| MODE_SCHEDULED.to_owned());
        if !matches!(mode.as_str(), "scheduled" | "promoted") {
            return Err(invalid("drafter.mode is scheduled or promoted"));
        }
        let derived_from = match fields.get("derivedFrom") {
            None | Some(Value::Null) => None,
            Some(value) => Some(
                serde_json::from_value::<Vec<DerivedFrom>>(value.clone())
                    .map_err(|_| invalid("derivedFrom is a list of { kind, id, contentHash }"))?,
            ),
        };
        Ok(Self {
            mode,
            candidate: text(drafter.get("candidate"), "drafter.candidate")?,
            promoted_by: text(drafter.get("promotedBy"), "drafter.promotedBy")?,
            conflict_set: text(fields.get("conflictSet"), "conflictSet")?,
            derived_from,
        })
    }
}

/// A drafter's claim without an accepted attestation (phase 4 section 11.3).
fn claims_unattested() -> Outcome {
    failure(
        "PROPOSAL_EVIDENCE_INVALID",
        "memory evidence, a memory derivedFrom, a conflictSet and a drafter's claims are accepted only from an attested drafter",
        "Memory reaches proposals only through the curator's curator-run; cite other sources as document, url, text or record evidence, without drafter fields.",
    )
}

/// The open proposals the caller can read, by document and by cited memory source, for
/// `PROPOSAL_ALREADY_OPEN`.
struct Open {
    /// Each document's open proposals' conflict sets (`None` for a proposal in none).
    docs: BTreeMap<String, Vec<Option<String>>>,
    sources: BTreeSet<String>,
    /// Each conflict set's open members.
    sets: BTreeMap<String, Vec<Member>>,
}

impl Open {
    fn collect(caller: &Caller<'_>) -> Result<Self, Outcome> {
        let mut open = Self {
            docs: BTreeMap::new(),
            sources: BTreeSet::new(),
            sets: BTreeMap::new(),
        };
        let mut after: Option<String> = None;
        loop {
            let page = caller
                .cx
                .record_list(&caller.space, KIND, after.as_deref(), PAGE)
                .map_err(|error| fail::host(&error))?;
            for record in &page.items {
                if let Some(proposal) = Proposal::from_value(&record.body) {
                    open.add(&proposal);
                }
            }
            match page.next {
                Some(next) => after = Some(next),
                None => return Ok(open),
            }
        }
    }

    fn add(&mut self, proposal: &Proposal) {
        if !proposal.is_open() {
            return;
        }
        self.docs
            .entry(proposal.change.doc.clone())
            .or_default()
            .push(proposal.conflict_set.clone());
        self.sources.extend(proposal.memory_sources());
        if let Some(set) = &proposal.conflict_set {
            self.sets
                .entry(set.clone())
                .or_default()
                .push(Member::of(proposal));
        }
    }

    /// The open members of the conflict set `set`.
    fn members(&self, set: &str) -> Vec<Member> {
        self.sets.get(set).cloned().unwrap_or_default()
    }

    /// Whether a draft of `change` in `conflict_set`, citing `evidence`, is blocked: its document
    /// has an open proposal outside its conflict set, or a memory source it cites has one.
    fn blocks(&self, change: &Change, conflict_set: Option<&str>, evidence: &[Value]) -> bool {
        let document = self.docs.get(&change.doc).is_some_and(|sets| {
            sets.iter()
                .any(|set| conflict_set.is_none() || set.as_deref() != conflict_set)
        });
        document
            || memory_sources(evidence)
                .iter()
                .any(|id| self.sources.contains(id))
    }
}

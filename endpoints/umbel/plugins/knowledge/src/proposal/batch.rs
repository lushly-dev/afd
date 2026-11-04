//! `knowledge-propose-batch` (phase 4 specification, sections 3.2, 9.1 and 11.2; D91, D103): up
//! to 50 proposals and 50 withdrawals in one call, with a result per item.
//!
//! A call that is no pipeline step has `drafter: null`: an ordinary batch by its caller, each
//! item `knowledge-propose`'s validation, and any drafter's claim (memory evidence, a memory
//! `derivedFrom`, a `conflictSet`, a `drafter` object) or withdrawal is `PROPOSAL_EVIDENCE_INVALID`
//! for its item. A step attested to an instance `drafters` does not list is
//! `PROPOSAL_DRAFTER_NOT_ALLOWED` for the whole call. A listed drafter's proposals carry the
//! host's attestation as their `drafter` and are `agent-inferred`; every claim beyond it is
//! verified against the memory store and the fixed rendering, and until that verification exists
//! (step 3c) a claim it would check is refused with `PROPOSAL_DRAFT_UNVERIFIABLE` (step 3b,
//! amendment 1). A drafted proposal for a document, or a memory source, that already has an open
//! proposal is `PROPOSAL_ALREADY_OPEN`, alternatives of one conflict set apart.
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

use super::attest;
use super::common::{self, Caller};
use super::model::{Change, Drafter, KIND, MODE_SCHEDULED, Op, Proposal, memory_sources};
use super::propose::{self, Drafted, Submitted};
use super::redact;
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

    // Withdrawals first: a draft that replaces a withdrawn one must not find it open.
    let mut withdrawn_results = Vec::with_capacity(withdrawals.len());
    let (mut withdrawn, mut redacted, mut forgotten) = (0usize, 0usize, 0u64);
    for (index, item) in withdrawals.iter().enumerate() {
        let id = item.get("proposal").cloned().unwrap_or(Value::Null);
        withdrawn_results.push(match redact::withdraw(caller, attestation.as_ref(), item) {
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
        });
    }

    // Then the drafts citing an erased source, whatever their state but applied (amendment 12).
    let swept = match &attestation {
        Some(attestation) if !erased.is_empty() => {
            let swept = redact::sweep(caller, attestation, &erased)?;
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
        match one(caller, attestation.as_ref(), open.as_ref(), item) {
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
                    result["rev"] = json!(rev);
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
    let claims = Claims::of(fields);
    let (Some(attestation), Some(open)) = (attestation, open) else {
        if claims.any() {
            return Err(claims_unattested());
        }
        return propose::submit(caller, item, None);
    };
    if let Some(claim) = claims.unverifiable(fields) {
        return Err(unverifiable(claim));
    }
    let mut plain: Map<String, Value> = fields.clone();
    for key in DRAFTER_KEYS {
        plain.remove(key);
    }
    let drafter = Drafter {
        plugin: attestation.plugin.clone(),
        instance: attestation.instance.clone(),
        pipeline: attestation.pipeline.clone(),
        run: attestation.run.clone(),
        mode: MODE_SCHEDULED.to_owned(),
        candidate: None,
        promoted_by: None,
    };
    let already_open = |change: &Change, evidence: &[Value]| open.blocks(change, None, evidence);
    propose::submit(
        caller,
        &Value::Object(plain),
        Some(Drafted {
            drafter,
            already_open: &already_open,
        }),
    )
}

/// What an item claims beyond `knowledge-propose`'s fields: what only a drafter may send.
struct Claims {
    memory_evidence: bool,
    derived_from: bool,
    conflict_set: bool,
    drafter: bool,
}

impl Claims {
    fn of(fields: &Map<String, Value>) -> Self {
        let present = |key: &str| fields.get(key).is_some_and(|value| !value.is_null());
        Self {
            memory_evidence: fields
                .get("evidence")
                .and_then(Value::as_array)
                .is_some_and(|evidence| !memory_sources(evidence).is_empty()),
            derived_from: present("derivedFrom"),
            conflict_set: present("conflictSet"),
            drafter: present("drafter"),
        }
    }

    fn any(&self) -> bool {
        self.memory_evidence || self.derived_from || self.conflict_set || self.drafter
    }

    /// The first claim of a listed drafter that section 3.2 verifies against the memory store or
    /// the fixed rendering, which this step cannot yet do (step 3b, amendment 1): memory evidence,
    /// a memory `derivedFrom`, a candidate, a promotion, a conflict set, and the content of a
    /// create or an update. A `scheduled` draft with other evidence widens nobody and claims no
    /// content, so its `mode` is what this plugin computes.
    fn unverifiable(&self, fields: &Map<String, Value>) -> Option<&'static str> {
        let drafter = fields.get("drafter").filter(|value| !value.is_null());
        let claims = |key: &str| {
            drafter
                .and_then(|d| d.get(key))
                .is_some_and(|v| !v.is_null())
        };
        let mode = drafter
            .and_then(|d| d.get("mode"))
            .and_then(Value::as_str)
            .unwrap_or(MODE_SCHEDULED);
        let op = fields
            .get("change")
            .and_then(|change| change.get("op"))
            .and_then(|op| serde_json::from_value::<Op>(op.clone()).ok());
        if self.memory_evidence {
            Some("memory-evidence")
        } else if self.derived_from {
            Some("derived-from")
        } else if claims("candidate") {
            Some("candidate")
        } else if mode != MODE_SCHEDULED || claims("promotedBy") {
            Some("promotion")
        } else if self.conflict_set {
            Some("conflict-set")
        } else if matches!(op, Some(Op::Create | Op::Update)) {
            Some("content")
        } else {
            None
        }
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

/// `PROPOSAL_DRAFT_UNVERIFIABLE` (step 3b, amendment 1): a listed drafter's claim that this
/// instance cannot yet verify, so it stores nothing labelled as verified. `details.claim` names
/// the claim, never the content.
fn unverifiable(claim: &str) -> Outcome {
    failure(
        "PROPOSAL_DRAFT_UNVERIFIABLE",
        "the drafter's claim cannot be verified against the memory store and the fixed rendering by this knowledge instance, so the draft is not stored",
        "Submit memory-derived drafts once knowledge verifies them (phase 4 step 3c); verify and deprecate drafts citing document, url, text or record evidence are accepted now.",
    )
    .with_error_details(json!({ "claim": claim }))
}

/// The open proposals the caller can read, by document and by cited memory source, for
/// `PROPOSAL_ALREADY_OPEN`.
struct Open {
    /// Each document's open proposals' conflict sets (`None` for a proposal in none).
    docs: BTreeMap<String, Vec<Option<String>>>,
    sources: BTreeSet<String>,
}

impl Open {
    fn collect(caller: &Caller<'_>) -> Result<Self, Outcome> {
        let mut open = Self {
            docs: BTreeMap::new(),
            sources: BTreeSet::new(),
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

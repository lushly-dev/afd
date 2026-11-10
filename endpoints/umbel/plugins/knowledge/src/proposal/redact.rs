//! A drafter's withdrawals and the redaction of a forgotten source's text (phase 4 specification,
//! section 9.1; D103): the `withdraw` items and the `erased` notice of `knowledge-propose-batch`.
//!
//! A drafter touches only its own drafts: ones whose `drafter` names the attested step's plugin
//! and instance and whose proposer is the batch's caller, since a run works for its caller. Its
//! withdrawal reasons are `source-erased`, `source-changed` and `superseded-alternative`;
//! `retracted` is a proposer's own (`knowledge-withdraw`).
//!
//! **A redaction** removes every text the draft carried and every hash of it: `change.content`
//! (so the title, which is the content's frontmatter), a verify's note, the diff, the rationale
//! (replaced by a fixed sentence), every evidence excerpt, a rejection's reason, and each memory
//! entry's copied fields, which become `{ kind, ref, erased: true }`; the change hash and the
//! envelope's `contentHash` become the redacted hash, and `derivedFrom` becomes null, in the body
//! and in the stored envelope. Then the change log forgets the hashes of the record's earlier
//! versions. The id, the document id, the idempotency key and the decision or withdrawal (who,
//! when, the outcome) stay, and `redacted` is set.
//!
//! **Every draft that was not applied is redacted** when its source is erased (step 3b, amendment
//! 12): a pending one is withdrawn by the drafter with `source-erased` and redacted; a withdrawn
//! one (by the drafter for another reason, or by its proposer), a rejected one and an approved one
//! whose apply never landed are redacted in place, keeping their state. An applied proposal is
//! never retracted (owner decision 7). A drafter reaches them in two ways: naming a draft in a
//! `withdraw` item with `redact: true`, or naming the erased memory records in `erased`, which
//! redacts each of its own drafts citing one. Both are idempotent: a redacted draft is written
//! again only if the change log still holds an earlier hash of it.
//!
//! **"Erased" is a claim, and it is checked** (step 3c): a draft is redacted for a forgotten
//! source only when the memory store, read under the caller's filter, no longer holds one of the
//! sources named (forgotten, purged or no longer readable alike), else `PROPOSAL_DRAFT_MISMATCH`
//! with `details.check = "source-erased"`. An erased record never comes back, so the check never
//! keeps forgotten text. Without the `memory` grant nothing can be checked, and a redaction only
//! removes, so it proceeds.
//!
//! The document store's connections run with `secure_delete`, and the batch checkpoints after a
//! redaction ([`super::batch`]).

use std::collections::BTreeSet;

use serde_json::{Map, Value, json};
use umbel_sdk::{HostError, Outcome, PipelineAttestation, failure};
use umbel_store::{ContentHash, Expect, Record, canonical_json};

use super::common::{self, Caller};
use super::model::{DRAFTER_REASONS, KIND, Proposal, Redacted, SOURCE_ERASED, State, Withdrawal};
use super::sources::{Sources, Unread, mismatch};
use crate::fail;

/// The rationale a redacted proposal keeps: fixed text, naming no source.
pub(crate) const REDACTED_RATIONALE: &str =
    "Redacted: a memory record this draft cited was forgotten, so its text was removed.";

/// The records read from the store at a time when sweeping for an `erased` notice.
const PAGE: u32 = 100;

/// What one withdrawal or redaction did.
pub(crate) struct Done {
    pub(crate) proposal: Proposal,
    /// Whether this call moved it to `withdrawn`.
    pub(crate) withdrawn: bool,
    /// Whether this call redacted it.
    pub(crate) redacted: bool,
    /// How many of the change log's earlier hashes of it this call removed.
    pub(crate) forgotten: u64,
}

impl Done {
    fn unchanged(proposal: Proposal) -> Self {
        Self {
            proposal,
            withdrawn: false,
            redacted: false,
            forgotten: 0,
        }
    }
}

fn invalid(why: &str) -> Outcome {
    failure(
        "PROPOSAL_INVALID",
        &format!("the withdrawal was refused: {why}"),
        "A drafter withdraws with source-erased (and redact: true), source-changed or superseded-alternative.",
    )
}

/// A withdrawal or an `erased` notice in a batch without an accepted attestation (11.3).
pub(crate) fn unattested() -> Outcome {
    failure(
        "PROPOSAL_EVIDENCE_INVALID",
        "withdrawals and erased sources in knowledge-propose-batch are accepted only from an attested drafter",
        "A proposer takes a proposal back with knowledge-withdraw; a drafter withdraws through its own pipeline.",
    )
}

fn not_drafter() -> Outcome {
    failure(
        "PROPOSAL_NOT_PROPOSER",
        "only the drafter that drafted a proposal, in a run of its proposer, may withdraw or redact it",
        "A proposer takes a proposal back with knowledge-withdraw; an approver can reject it with knowledge-reject.",
    )
}

/// Whether the store bears out the drafter's word that one of `named` is erased: at least one of
/// them is no longer held, under the caller's reader filter. Without the `memory` grant nothing
/// can be checked, and a redaction only removes text, so it holds.
fn erased_one(memory: &Sources<'_, '_>, named: &[String]) -> Result<bool, Outcome> {
    for id in named {
        match memory.read(id) {
            Ok(read) if read.exists() => {}
            Ok(_) | Err(Unread::Withheld) => return Ok(true),
            Err(Unread::Failed(outcome)) => return Err(outcome),
        }
    }
    Ok(false)
}

/// Whether `proposal` is the attested drafter's own, for the caller.
fn owns(caller: &Caller<'_>, attestation: &PipelineAttestation, proposal: &Proposal) -> bool {
    proposal
        .drafter
        .as_ref()
        .is_some_and(|drafter| drafter.is(attestation))
        && proposal.proposer.principal == caller.principal
}

/// The withdrawal `item` (`{ proposal, reason, redact? }`) by the attested drafter.
///
/// # Errors
/// `PROPOSAL_EVIDENCE_INVALID` without an attestation, `PROPOSAL_INVALID`, `PROPOSAL_NOT_FOUND`,
/// `PROPOSAL_NOT_PROPOSER`, `PROPOSAL_STATE_INVALID`, `PROPOSAL_CONFLICT` and the host's failures.
pub(crate) fn withdraw(
    caller: &Caller<'_>,
    attestation: Option<&PipelineAttestation>,
    memory: &Sources<'_, '_>,
    item: &Value,
) -> Result<Done, Outcome> {
    let Some(attestation) = attestation else {
        return Err(unattested());
    };
    let id = item
        .get("proposal")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let reason = item
        .get("reason")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let redact = item.get("redact").and_then(Value::as_bool).unwrap_or(false);
    if !DRAFTER_REASONS.contains(&reason) {
        return Err(invalid(
            "the reason is source-erased, source-changed or superseded-alternative",
        ));
    }
    if redact != (reason == SOURCE_ERASED) {
        return Err(invalid(
            "a forgotten source (source-erased) is always redacted, and only a forgotten source is",
        ));
    }
    let (mut proposal, record) = match common::get(caller, id) {
        Ok(Some(found)) => found,
        Ok(None) => return Err(common::not_found()),
        Err(error) => return Err(fail::host(&error)),
    };
    if !owns(caller, attestation, &proposal) {
        return Err(not_drafter());
    }
    if redact
        && proposal.state != State::Applied
        && proposal.redacted.is_none()
        && !erased_one(memory, &proposal.memory_sources())?
    {
        return Err(mismatch("source-erased"));
    }
    match proposal.state {
        State::Applied => Err(common::wrong_state(
            &proposal,
            "an applied proposal is never retracted",
        )),
        _ if redact => erase(caller, proposal, &record),
        State::Pending => {
            proposal.state = State::Withdrawn;
            proposal.withdrawal = Some(Withdrawal::by_drafter(reason, &caller.now));
            proposal.updated_at.clone_from(&caller.now);
            save(caller, &proposal, &record)?;
            Ok(Done {
                proposal,
                withdrawn: true,
                redacted: false,
                forgotten: 0,
            })
        }
        State::Withdrawn => Ok(Done::unchanged(proposal)),
        State::Approved | State::Rejected => Err(common::wrong_state(
            &proposal,
            "only a pending proposal is withdrawn; a decided draft is only redacted, when its source is erased",
        )),
    }
}

/// What an `erased` notice did.
#[derive(Default)]
pub(crate) struct Swept {
    /// The drafts this call redacted.
    pub(crate) redacted: Vec<String>,
    /// The pending drafts among them, which it also withdrew.
    pub(crate) withdrawn: Vec<String>,
    /// The drafts it could not redact, each with its error.
    pub(crate) refused: Vec<Value>,
    pub(crate) forgotten: u64,
}

/// The `erased` notice: redact every draft of the attested drafter, for the caller, that was not
/// applied and cites one of the memory records `erased` names.
///
/// # Errors
/// The host's failures while reading the proposals.
pub(crate) fn sweep(
    caller: &Caller<'_>,
    attestation: &PipelineAttestation,
    memory: &Sources<'_, '_>,
    erased: &BTreeSet<String>,
) -> Result<Swept, Outcome> {
    let mut swept = Swept::default();
    let mut after: Option<String> = None;
    loop {
        let page = caller
            .cx
            .record_list(&caller.space, KIND, after.as_deref(), PAGE)
            .map_err(|error| fail::host(&error))?;
        for record in &page.items {
            let Some(proposal) = Proposal::from_value(&record.body) else {
                continue;
            };
            let named: Vec<String> = proposal
                .memory_sources()
                .into_iter()
                .filter(|id| erased.contains(id))
                .collect();
            if named.is_empty()
                || proposal.state == State::Applied
                || !owns(caller, attestation, &proposal)
            {
                continue;
            }
            let id = proposal.id.clone();
            let checked = if proposal.redacted.is_some() {
                Ok(())
            } else {
                match erased_one(memory, &named) {
                    Ok(true) => Ok(()),
                    Ok(false) => Err(mismatch("source-erased")),
                    Err(outcome) => Err(outcome),
                }
            };
            match checked.and_then(|()| erase(caller, proposal, record)) {
                Ok(done) => {
                    swept.forgotten += done.forgotten;
                    if done.redacted {
                        swept.redacted.push(id.clone());
                    }
                    if done.withdrawn {
                        swept.withdrawn.push(id);
                    }
                }
                Err(outcome) => swept.refused.push(json!({
                    "proposal": id,
                    "error": outcome.as_value().get("error").cloned().unwrap_or(Value::Null),
                })),
            }
        }
        match page.next {
            Some(next) => after = Some(next),
            None => return Ok(swept),
        }
    }
}

/// Redact one of the drafter's own drafts that was not applied: a pending one is withdrawn with
/// `source-erased` first; any other keeps its state, decision and withdrawal. A redacted one is
/// left as it is, but the change log still forgets any earlier hash of it.
fn erase(caller: &Caller<'_>, mut proposal: Proposal, record: &Record) -> Result<Done, Outcome> {
    if proposal.redacted.is_some() {
        let forgotten = forget_history(caller, &proposal.id)?;
        return Ok(Done {
            forgotten,
            ..Done::unchanged(proposal)
        });
    }
    let withdrawn = proposal.state == State::Pending;
    if withdrawn {
        proposal.state = State::Withdrawn;
        proposal.withdrawal = Some(Withdrawal::by_drafter(SOURCE_ERASED, &caller.now));
    }
    proposal.updated_at.clone_from(&caller.now);
    redact_body(&mut proposal, &caller.now);
    save(caller, &proposal, record)?;
    let forgotten = forget_history(caller, &proposal.id)?;
    Ok(Done {
        proposal,
        withdrawn,
        redacted: true,
        forgotten,
    })
}

/// Store `proposal` over `record`, compare-and-set; a redacted body's envelope keeps no
/// `derivedFrom`.
fn save(caller: &Caller<'_>, proposal: &Proposal, record: &Record) -> Result<(), Outcome> {
    let mut envelope = record.envelope.clone();
    envelope.observed_at.clone_from(&caller.now);
    envelope.content_hash =
        Some(ContentHash::of(canonical_json(&proposal.to_value()).as_bytes()).to_string());
    if proposal.redacted.is_some() {
        envelope.derived_from = None;
    }
    match common::save(
        caller,
        proposal,
        envelope,
        Expect::Hash(record.content_hash.clone()),
    ) {
        Ok(_) => Ok(()),
        Err(HostError::Conflict { .. }) => Err(failure(
            "PROPOSAL_CONFLICT",
            "the proposal changed while it was being withdrawn or redacted",
            "Run the drafter again; its next run re-checks the proposal.",
        )),
        Err(error) => Err(fail::host(&error)),
    }
}

/// The change log forgets the hashes of the record's earlier versions, each a hash of a body
/// that held the forgotten text (step 3b, amendment 13).
fn forget_history(caller: &Caller<'_>, id: &str) -> Result<u64, Outcome> {
    caller
        .cx
        .record_forget_history(&caller.space, KIND, id)
        .map_err(|error| fail::host(&error))
}

/// Section 9.1's redaction of `proposal`'s body at `at`, with step 3b's amendments 6 and 12.
pub(crate) fn redact_body(proposal: &mut Proposal, at: &str) {
    proposal.change.content = None;
    if let Some(verification) = proposal.change.verification.as_mut() {
        verification.note = None;
    }
    proposal.diff = String::new();
    REDACTED_RATIONALE.clone_into(&mut proposal.rationale);
    proposal.evidence = proposal.evidence.iter().map(redacted_entry).collect();
    if let Some(decision) = proposal.decision.as_mut() {
        decision.reason = None;
        decision.reason_source = None;
    }
    let hash = super::model::redacted_hash(&proposal.id);
    proposal.change_hash.clone_from(&hash);
    if let Some(provenance) = proposal.provenance.as_object_mut() {
        provenance.insert("contentHash".to_owned(), Value::String(hash));
        provenance.insert("derivedFrom".to_owned(), Value::Null);
    }
    proposal.redacted = Some(Redacted {
        at: at.to_owned(),
        reason: SOURCE_ERASED.to_owned(),
    });
}

/// A memory entry reduced to its reference; any other entry without its excerpt.
fn redacted_entry(entry: &Value) -> Value {
    let kind = entry
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if kind == "memory" {
        return json!({ "kind": "memory", "ref": entry.get("ref").cloned().unwrap_or(Value::Null), "erased": true });
    }
    let mut kept: Map<String, Value> = entry.as_object().cloned().unwrap_or_default();
    kept.remove("excerpt");
    Value::Object(kept)
}

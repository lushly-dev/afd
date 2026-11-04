//! A drafter's withdrawals and the redaction of a forgotten source's text (phase 4 specification,
//! section 9.1; D103), the `withdraw` items of `knowledge-propose-batch`.
//!
//! A drafter withdraws only one of its own proposals: one whose `drafter` names the attested
//! step's plugin and instance and whose proposer is the batch's caller, since a run re-checks
//! only its caller's open drafts. Its reasons are `source-erased`, `source-changed` and
//! `superseded-alternative`; `retracted` is a proposer's own (`knowledge-withdraw`).
//!
//! **A redaction** is the withdrawal with `redact: true`, always for `source-erased`. It removes
//! every text the draft carried and every hash of it: `change.content` (so the title, which is the
//! content's frontmatter), a verify's note, the diff, the rationale (replaced by a fixed
//! sentence), every evidence excerpt, and each memory entry's copied fields, which become
//! `{ kind, ref, erased: true }`; the change hash and the envelope's `contentHash` become the
//! redacted hash, and `derivedFrom` becomes null, in the body and in the stored envelope. The id,
//! the document id and the idempotency key are content-free and stay. It sets `redacted`, and it
//! is idempotent: a redacted proposal is left as it is.
//!
//! A pending proposal is withdrawn and redacted at once. One the drafter already withdrew for
//! another reason (a source absent at the re-check may have been erased, which the next run's
//! feed shows) is redacted in place, its reason becoming `source-erased`. The document store's
//! connections run with `secure_delete`, and the batch checkpoints after a redaction
//! ([`super::batch`]).

use serde_json::{Map, Value, json};
use umbel_sdk::{HostError, Outcome, PipelineAttestation, failure};
use umbel_store::{ContentHash, Expect, canonical_json};

use super::common::{self, Caller};
use super::model::{DRAFTER_REASONS, Proposal, Redacted, SOURCE_ERASED, State, Withdrawal};
use crate::fail;

/// The rationale a redacted proposal keeps: fixed text, naming no source.
pub(crate) const REDACTED_RATIONALE: &str =
    "Redacted: a memory record this draft cited was forgotten, so its text was removed.";

/// What one withdrawal did.
pub(crate) struct Done {
    pub(crate) proposal: Proposal,
    /// Whether this call moved it to `withdrawn`.
    pub(crate) withdrawn: bool,
    /// Whether this call redacted it.
    pub(crate) redacted: bool,
}

fn invalid(why: &str) -> Outcome {
    failure(
        "PROPOSAL_INVALID",
        &format!("the withdrawal was refused: {why}"),
        "A drafter withdraws with source-erased (and redact: true), source-changed or superseded-alternative.",
    )
}

/// A withdrawal in a batch without an accepted attestation (phase 4 section 11.3).
pub(crate) fn unattested() -> Outcome {
    failure(
        "PROPOSAL_EVIDENCE_INVALID",
        "a withdrawal in knowledge-propose-batch is accepted only from an attested drafter",
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

/// The withdrawal `item` (`{ proposal, reason, redact? }`) by the attested drafter.
///
/// # Errors
/// `PROPOSAL_EVIDENCE_INVALID` without an attestation, `PROPOSAL_INVALID`, `PROPOSAL_NOT_FOUND`,
/// `PROPOSAL_NOT_PROPOSER`, `PROPOSAL_STATE_INVALID`, `PROPOSAL_CONFLICT` and the host's failures.
pub(crate) fn withdraw(
    caller: &Caller<'_>,
    attestation: Option<&PipelineAttestation>,
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
    let own = proposal
        .drafter
        .as_ref()
        .is_some_and(|drafter| drafter.is(attestation))
        && proposal.proposer.principal == caller.principal;
    if !own {
        return Err(not_drafter());
    }
    let by_drafter = proposal
        .withdrawal
        .as_ref()
        .is_some_and(Withdrawal::is_drafters);
    let already = proposal.redacted.is_some();
    let (withdrawn, redacted) = match (proposal.state, by_drafter) {
        (State::Pending, _) => {
            proposal.state = State::Withdrawn;
            proposal.withdrawal = Some(Withdrawal::by_drafter(reason, &caller.now));
            (true, redact)
        }
        // Idempotent: a redacted proposal stays as it is.
        (State::Withdrawn, _) if already => (false, false),
        (State::Withdrawn, true) => {
            if redact && let Some(withdrawal) = proposal.withdrawal.as_mut() {
                SOURCE_ERASED.clone_into(&mut withdrawal.reason);
            }
            (false, redact)
        }
        (State::Withdrawn, false) if !redact => (false, false),
        // Proposal record version 2 redacts only a drafter's withdrawal (step 1's schema, 9.1).
        (State::Withdrawn, false) => {
            return Err(common::wrong_state(
                &proposal,
                "its proposer withdrew it, and only a drafter's withdrawal is redacted",
            ));
        }
        _ => {
            return Err(common::wrong_state(
                &proposal,
                "only a pending proposal is withdrawn, and only a withdrawn draft is redacted; an applied proposal is never retracted",
            ));
        }
    };
    if !withdrawn && !redacted {
        return Ok(Done {
            proposal,
            withdrawn,
            redacted,
        });
    }
    proposal.updated_at.clone_from(&caller.now);
    if redacted {
        redact_body(&mut proposal, &caller.now);
    }
    let mut envelope = record.envelope.clone();
    envelope.observed_at.clone_from(&caller.now);
    envelope.content_hash =
        Some(ContentHash::of(canonical_json(&proposal.to_value()).as_bytes()).to_string());
    if redacted {
        envelope.derived_from = None;
    }
    match common::save(
        caller,
        &proposal,
        envelope,
        Expect::Hash(record.content_hash.clone()),
    ) {
        Ok(_) => Ok(Done {
            proposal,
            withdrawn,
            redacted,
        }),
        Err(HostError::Conflict { .. }) => Err(failure(
            "PROPOSAL_CONFLICT",
            "the proposal changed while it was being withdrawn",
            "Run the drafter again; its next run re-checks the proposal.",
        )),
        Err(error) => Err(fail::host(&error)),
    }
}

/// Section 9.1's redaction of `proposal`'s body at `at`.
pub(crate) fn redact_body(proposal: &mut Proposal, at: &str) {
    proposal.change.content = None;
    if let Some(verification) = proposal.change.verification.as_mut() {
        verification.note = None;
    }
    proposal.diff = String::new();
    REDACTED_RATIONALE.clone_into(&mut proposal.rationale);
    proposal.evidence = proposal.evidence.iter().map(redacted_entry).collect();
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

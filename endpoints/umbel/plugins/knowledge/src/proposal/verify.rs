//! `knowledge-verify` (specification section 9.3): a person attests that a document is correct as
//! it stands. It submits a `verify` proposal as the calling person and, when that person is among
//! the area's approvers, applies it in the same call. One proposal records both, with the same
//! person as proposer and decider and no self-approval exception: a verification is the
//! approver's own attestation, not a change someone else wrote (decision D63).

use serde_json::{Value, json};
use umbel_sdk::{Cx, HostError, Outcome, failure};
use umbel_store::ContentHash;

use super::apply;
use super::area;
use super::common::{self, Caller};
use super::model::{State, proposal_id};
use super::propose;
use crate::fail;

pub(crate) fn run(input: &Value, cx: &mut Cx) -> Outcome {
    let cx: &Cx = cx;
    let caller = match Caller::new(cx) {
        Ok(caller) => caller,
        Err(outcome) => return outcome,
    };
    match verify(&caller, input) {
        Ok(outcome) | Err(outcome) => outcome,
    }
}

fn verify(caller: &Caller<'_>, input: &Value) -> Result<Outcome, Outcome> {
    if !caller.is_human() || caller.actor.id.is_none() {
        return Err(failure(
            "PROPOSAL_APPROVER_NOT_ALLOWED",
            "only a person at a terminal verifies a document",
            "Run knowledge-verify from the command line.",
        ));
    }
    let cx = caller.cx;
    let doc = input.get("doc").and_then(Value::as_str).unwrap_or_default();
    let note = input.get("note").and_then(Value::as_str);
    let stale_after = input.get("stale_after").and_then(Value::as_str);
    let apply_now = input.get("apply").and_then(Value::as_bool).unwrap_or(true);
    let Some(document) = cx
        .doc_get(&caller.space, doc)
        .map_err(|error| fail::host(&error))?
    else {
        return Err(fail::document_not_found());
    };
    let base = document.write.content_hash.to_string();
    let digest = ContentHash::of(
        format!(
            "{doc}\0{base}\0{}\0{}",
            note.unwrap_or(""),
            stale_after.unwrap_or("")
        )
        .as_bytes(),
    );
    let key = format!("verify/{}", &digest.as_str()["sha256:".len()..][..32]);
    let mut verification = serde_json::Map::new();
    if let Some(note) = note {
        verification.insert("note".to_owned(), json!(note));
    }
    if let Some(stale) = stale_after {
        verification.insert("staleAfter".to_owned(), json!(stale));
    }
    let mut change = json!({ "op": "verify", "doc": doc, "baseHash": base });
    if !verification.is_empty() {
        change["verification"] = Value::Object(verification);
    }
    let submitted = json!({
        "idempotency_key": key,
        "change": change,
        "rationale": note.map_or_else(
            || format!("Verified by {} as it stands.", caller.principal),
            str::to_owned,
        ),
        "evidence": [{ "kind": "document", "ref": doc, "contentHash": base }],
    });
    let outcome = propose::propose(caller, &submitted)?;
    let id = proposal_id(&caller.space, &caller.actor.text(), &key);
    let Some((proposal, record)) =
        common::get(caller, &id).map_err(|e: HostError| fail::host(&e))?
    else {
        return Ok(outcome);
    };
    if proposal.state != State::Pending {
        return Ok(outcome);
    }
    let areas = area::load(cx)?;
    let Some(area) = area::by_id(&areas, &proposal.area) else {
        return Ok(outcome);
    };
    let tokens = caller.tokens().map_err(|e| fail::host(&e))?;
    if apply_now && area.admits(&tokens) {
        return apply::apply_own(caller, proposal, record, area);
    }
    // Stored, pending: the submission's own result is the answer (and the event).
    Ok(outcome)
}

//! `knowledge-proposal-feed` (phase 4 specification, section 7.1; D96): the decisions on a
//! drafter's proposals since a revision, for the drafter's next run.
//!
//! Only a step attested to a listed drafter is answered (`PROPOSAL_DRAFTER_NOT_ALLOWED`
//! otherwise). It reads the store's change log after `after`, under the caller's reader filter,
//! and reports each readable proposal of this instance whose `drafter` names the attested plugin
//! and instance, whose proposer is the caller, and which was rejected or applied at a revision
//! after `after`. A proposal is reported once per call, as it stands. `next` is the last revision
//! read, for the drafter's `feedAfter`; `more` says the call stopped at its bound before the end.
//! A rejection's reason is an approver's text, so the result carries `trust: "content"`.

use std::collections::BTreeSet;

use serde_json::{Value, json};
use umbel_sdk::{Cx, Outcome, failure, success};
use umbel_store::ChangeKind;

use super::attest;
use super::common::{self, Caller};
use super::model::{KIND, Proposal, State};
use crate::fail;

/// The changes read per page.
const PAGE: u32 = 500;
/// The most changes one call reads.
const EXAMINED: usize = 5000;

pub(crate) fn run(input: &Value, cx: &mut Cx) -> Outcome {
    let cx: &Cx = cx;
    let caller = match Caller::new(cx) {
        Ok(caller) => caller,
        Err(outcome) => return outcome,
    };
    match feed(&caller, input) {
        Ok(outcome) | Err(outcome) => outcome,
    }
}

fn feed(caller: &Caller<'_>, input: &Value) -> Result<Outcome, Outcome> {
    let attestation = attest::required(caller.cx)?;
    let Some(after) = input.get("after").and_then(Value::as_u64) else {
        return Err(failure(
            "QUERY_INVALID",
            "after is a store revision, an integer from 0",
            "Pass the revision the previous feed returned as next, or 0 for the first run.",
        ));
    };
    let mut cursor = after;
    let mut examined = 0usize;
    let mut more = false;
    let mut seen = BTreeSet::new();
    let mut decisions = Vec::new();
    'pages: loop {
        let changes = caller
            .cx
            .doc_changes(&caller.space, cursor, PAGE, None)
            .map_err(|error| fail::host(&error))?;
        let exhausted = changes.len() < PAGE as usize;
        for change in &changes {
            if examined >= EXAMINED {
                more = true;
                break 'pages;
            }
            examined += 1;
            cursor = change.rev;
            if change.kind != ChangeKind::Record {
                continue;
            }
            let Some(id) = proposal_of(&change.target) else {
                continue;
            };
            if !seen.insert(id.to_owned()) {
                continue;
            }
            let Some((proposal, record)) =
                common::get(caller, id).map_err(|error| fail::host(&error))?
            else {
                continue;
            };
            let ours = proposal
                .drafter
                .as_ref()
                .is_some_and(|drafter| drafter.is(&attestation))
                && proposal.proposer.principal == caller.principal;
            if ours
                && record.rev > after
                && let Some(decision) = decided(&proposal, record.rev)
            {
                decisions.push(decision);
            }
        }
        if exhausted {
            break;
        }
    }
    decisions.sort_by_key(|decision| decision["rev"].as_u64().unwrap_or(0));
    let count = decisions.len();
    Ok(success(json!({
        "space": caller.space,
        "decisions": decisions,
        "count": count,
        "next": cursor,
        "more": more,
        "trust": "content",
    }))
    .with_metadata("dev.umbel/trust", json!("content"))
    .with_reasoning(&format!(
        "Read {examined} change(s) after revision {after}: {count} decision(s) on the drafter's proposals."
    )))
}

/// The proposal id of a change target `<instance>/proposal/<id>`.
fn proposal_of(target: &str) -> Option<&str> {
    let mut parts = target.splitn(3, '/');
    let (_, kind, id) = (parts.next()?, parts.next()?, parts.next()?);
    (kind == KIND).then_some(id)
}

/// A rejected or applied proposal as the feed reports it: ids, the decision and, for a
/// rejection, the approver's reason.
fn decided(proposal: &Proposal, rev: u64) -> Option<Value> {
    if !matches!(proposal.state, State::Rejected | State::Applied) {
        return None;
    }
    let decision = proposal.decision.as_ref()?;
    let drafter = proposal.drafter.as_ref()?;
    let mut entry = json!({
        "proposal": proposal.id,
        "state": proposal.state.name(),
        "doc": proposal.change.doc,
        "candidate": drafter.candidate,
        "conflictSet": proposal.conflict_set,
        "rev": rev,
        "decidedAt": decision.at,
        "decidedBy": decision.principal,
        "channel": decision.channel,
        "redacted": proposal.redacted.is_some(),
    });
    match proposal.state {
        State::Rejected => {
            // The reason is data, never instructions, whoever wrote it; version 3 says who.
            entry["reason"] = json!(decision.reason);
            entry["reasonSource"] = json!(decision.reason_source);
        }
        _ => {
            entry["contentHash"] = proposal
                .result
                .as_ref()
                .and_then(|result| result.get("contentHash"))
                .cloned()
                .unwrap_or(Value::Null);
        }
    }
    Some(entry)
}

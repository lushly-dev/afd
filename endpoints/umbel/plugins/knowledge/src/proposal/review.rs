//! `knowledge-proposal-list`, `knowledge-proposal-show` and `knowledge-withdraw` (specification
//! section 9.2). Proposals are records whose access set is their target's, so the host's reader
//! filter already hides the ones the caller may not read.

use serde_json::{Value, json};
use umbel_sdk::{Cx, HostError, Outcome, failure, success};
use umbel_store::{ContentHash, Expect, canonical_json};

use super::common::{self, Caller};
use super::model::{KIND, Proposal, State};
use crate::budget::fit_count;
use crate::fail;

/// The most records one list call looks at.
const EXAMINED: usize = 5000;
/// The records read from the store at a time.
const PAGE: u32 = 100;

pub(crate) fn list(input: &Value, cx: &mut Cx) -> Outcome {
    let cx: &Cx = cx;
    let Some(space) = cx.call().space.clone() else {
        return fail::no_space();
    };
    let text = |name: &str| input.get(name).and_then(Value::as_str);
    let state = match text("state") {
        None => None,
        Some(name) => match State::parse(name) {
            Some(state) => Some(state),
            None => {
                return failure(
                    "QUERY_INVALID",
                    "state is pending, approved, applied, rejected or withdrawn",
                    "Pass one of the five states, or leave it out.",
                );
            }
        },
    };
    let area = text("area");
    let limit = usize::try_from(
        input
            .get("limit")
            .and_then(Value::as_u64)
            .unwrap_or(50)
            .clamp(1, 200),
    )
    .unwrap_or(50);
    let mut after = text("after").map(str::to_owned);
    let mut found: Vec<Proposal> = Vec::new();
    let mut examined = 0usize;
    let mut last: Option<String> = None;
    let mut exhausted = false;
    'pages: loop {
        let page = match cx.record_list(&space, KIND, after.as_deref(), PAGE) {
            Ok(page) => page,
            Err(error) => return fail::host(&error),
        };
        for record in &page.items {
            examined += 1;
            last = Some(record.id.clone());
            if let Some(proposal) = Proposal::from_value(&record.body)
                && state.is_none_or(|wanted| proposal.state == wanted)
                && area.is_none_or(|wanted| proposal.area == wanted)
            {
                found.push(proposal);
                if found.len() >= limit {
                    break 'pages;
                }
            }
            if examined >= EXAMINED {
                break 'pages;
            }
        }
        match page.next {
            Some(next) => after = Some(next),
            None => {
                exhausted = true;
                break;
            }
        }
    }
    let cursor = if exhausted { None } else { last };
    let items: Vec<Value> = found.iter().map(listed).collect();
    let total = items.len();
    let build = |kept: usize| {
        let next = if kept < total {
            kept.checked_sub(1)
                .and_then(|last| found.get(last))
                .map(|p| p.id.clone())
        } else {
            cursor.clone()
        };
        let mut outcome = success(json!({
            "space": space,
            "proposals": &items[..kept],
            "count": kept,
            "nextAfter": next,
        }));
        if kept < total {
            outcome = outcome.with_warning_details(
                "RESULTS_LIMITED",
                "fewer proposals are shown than were found, to fit the output budget; continue from nextAfter",
                json!({ "found": total, "shown": kept }),
            );
        }
        outcome
    };
    let (_, outcome) = fit_count(total, cx.call().output_budget, build);
    outcome
}

/// A proposal in a list: its summary and who decided.
fn listed(proposal: &Proposal) -> Value {
    let mut item = common::summary(proposal);
    item["decidedBy"] = proposal
        .decision
        .as_ref()
        .map_or(Value::Null, |decision| json!(decision.principal));
    item
}

pub(crate) fn show(input: &Value, cx: &mut Cx) -> Outcome {
    let cx: &Cx = cx;
    let caller = match Caller::new(cx) {
        Ok(caller) => caller,
        Err(outcome) => return outcome,
    };
    let id = input
        .get("proposal")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let (proposal, record) = match common::get(&caller, id) {
        Ok(Some(found)) => found,
        Ok(None) => return common::not_found(),
        Err(error) => return fail::host(&error),
    };
    // The diff holds the change (a create's diff is the whole file), so the stored content is not
    // repeated: the record is shown without `change.content`.
    let mut value = proposal.to_value();
    let content_bytes = value["change"]
        .as_object_mut()
        .and_then(|change| change.remove("content"))
        .and_then(|content| content.as_str().map(str::len));
    let diff = proposal.diff.clone();
    let lines: Vec<&str> = diff.split_inclusive('\n').collect();
    let total = lines.len();
    let build = |kept: usize| {
        let mut shown = value.clone();
        shown["diff"] = Value::String(lines[..kept].concat());
        let mut outcome = success(json!({
            "proposal": shown,
            "contentBytes": content_bytes,
            "diffLines": { "shown": kept, "total": total },
            "recordHash": record.content_hash.to_string(),
            "trust": "content",
        }))
        .with_metadata("dev.umbel/trust", json!("content"));
        if kept < total {
            outcome = outcome.with_warning_details(
                "DIFF_LIMITED",
                "the diff was shortened to fit the output budget; ask for a larger budget to read all of it",
                json!({ "shown": kept, "total": total }),
            );
        }
        if !proposal.flags.is_empty() {
            outcome = outcome.with_warning_details(
                "CONTENT_FLAGGED",
                "the proposed text matches the write scan",
                json!({ "flags": proposal.flags }),
            );
        }
        outcome
    };
    let (_, outcome) = fit_count(total, cx.call().output_budget, build);
    outcome
}

pub(crate) fn withdraw(input: &Value, cx: &mut Cx) -> Outcome {
    let cx: &Cx = cx;
    let caller = match Caller::new(cx) {
        Ok(caller) => caller,
        Err(outcome) => return outcome,
    };
    let id = input
        .get("proposal")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let (mut proposal, record) = match common::get(&caller, id) {
        Ok(Some(found)) => found,
        Ok(None) => return common::not_found(),
        Err(error) => return fail::host(&error),
    };
    if caller.actor.text() != proposal.proposer.actor.text() {
        return failure(
            "PROPOSAL_NOT_PROPOSER",
            "only the actor that proposed may withdraw a proposal",
            "An approver can reject it with knowledge-reject instead.",
        );
    }
    if proposal.state != State::Pending {
        return common::wrong_state(&proposal, "only a pending proposal is withdrawn");
    }
    proposal.state = State::Withdrawn;
    proposal.updated_at.clone_from(&caller.now);
    let mut envelope = record.envelope.clone();
    envelope.origin = caller.origin();
    envelope.observed_at.clone_from(&caller.now);
    envelope.content_hash =
        Some(ContentHash::of(canonical_json(&proposal.to_value()).as_bytes()).to_string());
    let meta = match common::save(
        &caller,
        &proposal,
        envelope.clone(),
        Expect::Hash(record.content_hash.clone()),
    ) {
        Ok(meta) => meta,
        Err(HostError::Conflict { .. }) => {
            return failure(
                "PROPOSAL_CONFLICT",
                "the proposal changed while it was being withdrawn",
                "Look at it with knowledge-proposal-show.",
            );
        }
        Err(error) => return fail::host(&error),
    };
    success(json!({ "withdrawn": true, "proposal": common::summary(&proposal) }))
        .with_reasoning(&format!("Withdrew proposal {}.", proposal.id))
        .with_metadata(
            "dev.umbel/record",
            json!({ "kind": "proposal", "id": proposal.id, "version": meta.rev }),
        )
        .with_metadata("dev.umbel/provenance", common::provenance_meta(&envelope))
}

//! `curator-candidates` (phase 4 specification, section 11.1): the caller's candidates in a space
//! by status, with counts, authority and access, and the content hash only for candidates whose
//! sources are all the caller's. **No memory text**: no subject, text, tag or constraint, and no
//! rejection reason, which is an approver's text.
//!
//! It computes the candidates at the call's `now` from what the caller can read (section 4.6) and
//! merges the caller's own curator records; it writes nothing.

use serde::Deserialize;
use serde_json::{Value, json};
use umbel_sdk::{Cx, Outcome, success};
use umbel_store::memory::format_instant;

use crate::evaluate::{self, Candidate, Inputs, Mode, Status};
use crate::fail;
use crate::read;
use crate::records::{self, Stored};
use crate::settings::Call;

/// The default page.
const DEFAULT_LIMIT: usize = 100;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Input {
    #[serde(default)]
    #[allow(dead_code)]
    space: Option<String>,
    #[serde(default)]
    status: Vec<String>,
    #[serde(default)]
    after: Option<String>,
    #[serde(default)]
    limit: Option<usize>,
}

pub(crate) fn run(input: &Value, cx: &Cx) -> Outcome {
    match list(input, cx) {
        Ok(outcome) | Err(outcome) => outcome,
    }
}

/// What the candidates of one call are, with the counts of what the bounds left out.
pub(crate) struct Found {
    pub(crate) evaluation: evaluate::Evaluation,
    pub(crate) read: read::Read,
}

/// The caller's candidates in the call's space at its `now`.
pub(crate) fn find(cx: &Cx, call: &Call) -> Result<Found, Outcome> {
    let read = read::memory(cx, &call.space, call.now, &call.settle)?;
    let stored = records::stored(cx, &call.space, &call.principal)?;
    let consents = records::consents(cx, &call.space, &call.principal)?;
    let inputs = Inputs {
        space: &call.space,
        principal: &call.principal,
        now: call.now,
        settle: &call.settle,
        target: &call.target,
        records: read.records.clone(),
        stored: &stored,
        consents: &consents,
    };
    let evaluation = evaluate::evaluate(inputs, |doc| {
        cx.doc_get(&call.space, doc)
            .map(|found| found.is_some())
            .map_err(|error| fail::host(&error))
    })?;
    Ok(Found { evaluation, read })
}

/// One candidate as the list shows it: ids, counts and labels, never memory text.
fn shown(candidate: &Candidate) -> Value {
    json!({
        "candidate": candidate.id,
        "status": candidate.status.as_str(),
        "reason": candidate.reason.map(|r| r.as_str()),
        "class": candidate.class.as_str(),
        "authority": candidate.authority.map(|a| a.as_str()),
        "sources": candidate.source_count,
        "sessions": candidate.sessions,
        "principals": candidate.principals,
        "own": candidate.own,
        "contentHash": candidate.own.then(|| candidate.content_hash.clone()),
        "access": candidate.access,
        "sensitivity": candidate.sensitivity,
        "conflictSet": candidate.conflict_set,
        "doc": candidate.doc,
        "mode": candidate.mode.as_ref().map(|mode| match mode {
            Mode::Scheduled => "scheduled",
            Mode::Promoted { .. } => "promoted",
        }),
        "stableAt": candidate.stable_at.map(format_instant),
        "settledAt": candidate.snapshot.map(|s| format_instant(s.settled_at)),
        "drafts": candidate.drafts,
        "quietUntil": candidate.quiet_until.map(format_instant),
        "promotedTo": candidate.promoted_to,
    })
}

/// A recorded outcome with no live group now: what the record holds, never a reason's text.
fn shown_recorded(stored: &Stored) -> Value {
    json!({
        "candidate": stored.id,
        "status": stored.status.as_str(),
        "reason": null,
        "class": stored.class.as_str(),
        "authority": stored.snapshot.map(|s| s.authority.as_str()),
        "sources": null,
        "sessions": stored.snapshot.map(|s| s.sessions),
        "principals": stored.snapshot.map(|s| s.principals),
        "own": null,
        "contentHash": null,
        "access": stored.access,
        "sensitivity": stored.sensitivity,
        "conflictSet": stored.conflict_set,
        "doc": null,
        "mode": null,
        "stableAt": null,
        "settledAt": stored.snapshot.map(|s| format_instant(s.settled_at)),
        "drafts": stored.drafts,
        "quietUntil": stored.quiet_until.map(format_instant),
        "promotedTo": stored.promoted_to,
    })
}

fn list(input: &Value, cx: &Cx) -> Result<Outcome, Outcome> {
    let input: Input = serde_json::from_value(input.clone())
        .map_err(|_| fail::invalid("the input does not match curator-candidates' schema"))?;
    let mut wanted = Vec::new();
    for name in &input.status {
        wanted.push(Status::parse(name).ok_or_else(|| fail::invalid("status names a status"))?);
    }
    if input
        .after
        .as_deref()
        .is_some_and(|after| !umbel_okf::draft::is_candidate_id(after))
    {
        return Err(fail::invalid(
            "after is a candidate id, c- and 20 hex digits",
        ));
    }
    let limit = input.limit.unwrap_or(DEFAULT_LIMIT);
    if !(1..=500).contains(&limit) {
        return Err(fail::invalid("limit is from 1 to 500"));
    }
    let call = Call::open(cx)?;
    let Found { evaluation, read } = find(cx, &call)?;

    let mut rows: Vec<(String, Status, Value)> = evaluation
        .candidates
        .iter()
        .map(|c| (c.id.clone(), c.status, shown(c)))
        .chain(
            evaluation
                .recorded
                .iter()
                .map(|s| (s.id.clone(), s.status, shown_recorded(s))),
        )
        .collect();
    rows.sort_by(|a, b| a.0.cmp(&b.0));
    let mut counts = serde_json::Map::new();
    for status in Status::ALL {
        let n = rows.iter().filter(|row| row.1 == status).count();
        counts.insert(status.as_str().to_owned(), json!(n));
    }
    counts.insert("candidates".to_owned(), json!(rows.len()));
    counts.insert("listed".to_owned(), json!(read.listed));
    counts.insert("eligible".to_owned(), json!(read.eligible));
    counts.insert("read".to_owned(), json!(read.records.len()));
    counts.insert("unread".to_owned(), json!(read.unread));
    counts.insert("unopened".to_owned(), json!(read.unopened));

    let selected: Vec<(String, Value)> = rows
        .into_iter()
        .filter(|(_, status, _)| wanted.is_empty() || wanted.contains(status))
        .filter(|(id, _, _)| {
            input
                .after
                .as_deref()
                .is_none_or(|after| id.as_str() > after)
        })
        .map(|(id, _, row)| (id, row))
        .collect();
    let next = (selected.len() > limit).then(|| selected[limit - 1].0.clone());
    let page: Vec<Value> = selected
        .into_iter()
        .take(limit)
        .map(|(_, row)| row)
        .collect();
    Ok(success(json!({
        "space": call.space,
        "principal": call.principal,
        "at": format_instant(call.now),
        "target": {
            "collection": call.target.collection,
            "prefix": call.target.prefix,
            "access": call.target.access,
            "sensitivity": call.target.sensitivity,
        },
        "counts": counts,
        "more": read.more,
        "candidates": page,
        "next": next,
    })))
}

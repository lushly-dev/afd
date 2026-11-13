//! `ideas-review-show` (specification, section 8.2): a review's staged proposals in pages, each
//! with the idea's held wording and the host's label, its parts with their counts and digests,
//! and the digest of the whole: what an agent tells the person, and the digest
//! `ideas-review-apply` needs.

use std::collections::BTreeMap;

use serde_json::{Value, json};
use umbel_sdk::{Cx, HostError, Outcome, success};
use umbel_store::lane::LaneRecord;

use super::parts::{Ideas, WHOLE, check_part, listed, select, split};
use super::{Stored, by_decide, in_review, named_or_newest, read_proposal};
use crate::label::pass;
use crate::pending::pending;
use crate::records::{PROPOSAL_PREFIX, WORDING, Wording, read, read_idea};
use crate::{Call, fail, ids, input};

/// Proposals a page: default and most.
const DEFAULT_LIMIT: u64 = 50;
const MAX_LIMIT: u64 = 200;

/// The held wording of an idea, as a review shows it: `{ id, version, statement, said,
/// standing, label, flags }`; `None` when the idea or its wording cannot be read.
pub(crate) fn held(cx: &Cx, call: &Call, idea: &str) -> Result<Option<Value>, HostError> {
    let Some(stored) = read_idea(cx, call, idea)? else {
        return Ok(None);
    };
    Ok(read(cx, call, WORDING, &stored.idea.held_id())?
        .as_ref()
        .and_then(|record| wording(record, &stored.idea.state)))
}

fn wording(record: &LaneRecord, state: &str) -> Option<Value> {
    let wording = Wording::parse(&record.record.body)?;
    let (standing, label) = pass(record.label.as_ref());
    Some(json!({
        "id": wording.idea,
        "state": state,
        "version": wording.n,
        "statement": wording.statement,
        "said": wording.said,
        "standing": standing,
        "label": label,
        "flags": fail::flag_names(&record.flags),
    }))
}

/// One decision in a line, naming the wording it is about and nothing of a statement.
fn decision_line(p: &super::Proposal) -> String {
    let idea = p.idea.as_deref().unwrap_or_default();
    let wording = match p.version {
        Some(n) => format!("{idea}.{n}"),
        None => idea.to_owned(),
    };
    match p.decide.as_str() {
        "duplicate" => format!(
            "duplicate: fold {wording} into {}",
            p.keep.as_deref().unwrap_or_default()
        ),
        "undo" => format!("undo of {}", p.target.as_deref().unwrap_or_default()),
        decide => format!("{decide} of {wording}"),
    }
}

/// What an undo's target did, in one line, and nothing of a statement.
pub(crate) fn target_summary(cx: &Cx, call: &Call, target: &str) -> Result<String, HostError> {
    if ids::is_id(target, PROPOSAL_PREFIX) {
        return Ok(match read_proposal(cx, call, target)? {
            Some(stored) if stored.proposal.decide == "undo" => {
                // Undoing an undo applies again what it undid: name each of those (C3-13).
                let undid: Vec<String> = stored
                    .proposal
                    .effect
                    .as_ref()
                    .and_then(|effect| effect.get("undid"))
                    .and_then(Value::as_array)
                    .map(|ids| {
                        ids.iter()
                            .filter_map(Value::as_str)
                            .map(str::to_owned)
                            .collect()
                    })
                    .unwrap_or_default();
                let mut again = Vec::with_capacity(undid.len());
                for id in undid.iter().rev() {
                    again.push(match read_proposal(cx, call, id)? {
                        Some(member) => decision_line(&member.proposal),
                        None => format!("a decision that cannot be read ({id})"),
                    });
                }
                format!(
                    "undo of {}, {} ({target}); applies again: {}",
                    stored.proposal.target.as_deref().unwrap_or_default(),
                    stored.proposal.state,
                    if again.is_empty() {
                        "nothing".to_owned()
                    } else {
                        again.join("; ")
                    }
                )
            }
            Some(stored) => {
                let p = &stored.proposal;
                format!("{}, {} ({target})", decision_line(p), p.state)
            }
            None => format!("a decision that cannot be read ({target})"),
        });
    }
    let applied = in_review(cx, call, target, &["applied"])?;
    let counts: BTreeMap<&str, usize> =
        applied.iter().fold(BTreeMap::new(), |mut counts, stored| {
            *counts.entry(stored.proposal.decide.as_str()).or_default() += 1;
            counts
        });
    let listed: Vec<String> = counts
        .iter()
        .map(|(decide, n)| format!("{n} {decide}"))
        .collect();
    Ok(format!(
        "every applied decision of review {target}: {}",
        if listed.is_empty() {
            "none".to_owned()
        } else {
            listed.join(", ")
        }
    ))
}

/// A proposal as a review shows it.
pub(crate) fn view(cx: &Cx, call: &Call, stored: &Stored) -> Result<Value, HostError> {
    let p = &stored.proposal;
    let mut out = json!({
        "id": p.id,
        "decide": p.decide,
        "group": p.group,
        "confidence": p.confidence,
        "reason": p.reason,
        "flags": p.flags,
        "idea": p.idea,
        "version": p.version,
        "stagedAt": p.staged_at,
        "stagedBy": stored.by,
    });
    if let Some(idea) = &p.idea {
        out["held"] = held(cx, call, idea)?.unwrap_or(Value::Null);
    }
    if p.decide == "reword" {
        out["statement"] = json!(p.statement);
    }
    if let Some(keep) = &p.keep {
        out["kept"] = held(cx, call, keep)?.unwrap_or(Value::Null);
    }
    if let Some(target) = &p.target {
        out["target"] = json!({ "id": target, "summary": target_summary(cx, call, target)? });
    }
    Ok(out)
}

/// `ideas-review-show`.
pub(crate) fn run(input: &Value, cx: &Cx, call: &Call) -> Result<Outcome, Outcome> {
    let host = |error: HostError| fail::host(&error);
    let review = named_or_newest(cx, call, input)?.review;
    let part = input::string(input, "part")?.unwrap_or(WHOLE).to_owned();
    check_part("part", &part)?;
    let limit = input::integer(input, "limit", 1, MAX_LIMIT)?.unwrap_or(DEFAULT_LIMIT) as usize;
    let start = match input::string(input, "after")? {
        Some(after) => after
            .strip_prefix("o:")
            .and_then(|n| n.parse::<usize>().ok())
            .ok_or_else(|| fail::invalid("after", "is not a cursor ideas-review-show gave"))?,
        None => 0,
    };
    let staged = in_review(cx, call, &review.id, &["staged"]).map_err(host)?;
    let total = staged.len();
    let counts = by_decide(staged.iter().map(|s| s.proposal.decide.as_str()));
    let parts = split(staged);
    let (listed_parts, whole) =
        listed(cx, call, &parts, true, &mut Ideas::read(cx)?).map_err(host)?;
    let chosen = select(&parts, &part);
    let page: Vec<&Stored> = chosen.iter().skip(start).take(limit).copied().collect();
    let next = (start + page.len() < chosen.len()).then(|| format!("o:{}", start + page.len()));
    let mut flagged = 0;
    let mut shown = Vec::with_capacity(page.len());
    for stored in page {
        if !stored.proposal.flags.is_empty() {
            flagged += 1;
        }
        shown.push(view(cx, call, stored).map_err(host)?);
    }
    let pending = pending(cx, call).map_err(host)?;
    Ok(fail::warn_flagged(
        success(json!({
            "review": review.id,
            "name": review.name,
            "state": review.state,
            "total": total,
            "counts": counts,
            "parts": listed_parts,
            "digest": whole,
            "proposals": shown,
            "next": next,
            "pending": pending,
        })),
        flagged,
    ))
}

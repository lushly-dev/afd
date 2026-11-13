//! Undo (specification, section 8.7). An `undo` names a proposal, or a review whose applied
//! proposals are undone in reverse order. Each is restored from its `effect`, and becomes
//! `undone`; one whose subject moved since (the idea's held `n`, role or state is not what the
//! effect left) is left as it is. An undo of an undo applies again each proposal it undid.
//!
//! A re-affirmation here is only what an effect says was withdrawn, or an affirm or a reword
//! applied again: a new decision row, at the undo's assurance.

use serde_json::{Value, json};
use umbel_sdk::{Cx, HostError};
use umbel_store::Origin;
use umbel_store::lane::Decision;

use super::apply::{Applied, apply_one, decide};
use super::{
    Proposal, Stored, in_review, rank, read_proposal, set_role, update_idea, write_proposal,
};
use crate::records::{PROPOSAL_PREFIX, read_idea, wording_id};
use crate::{Call, ids};

/// Apply an `undo` proposal: its effect lists what it undid and what it left.
pub(super) fn apply(
    cx: &Cx,
    call: &Call,
    p: &Proposal,
    level: &str,
    at: &str,
) -> Result<Applied, HostError> {
    let target = p.target.as_deref().unwrap_or_default();
    let mut members: Vec<Stored> = if ids::is_id(target, PROPOSAL_PREFIX) {
        match read_proposal(cx, call, target)? {
            Some(found) if found.proposal.state == "applied" => vec![found],
            _ => return Ok(Err("target-changed")),
        }
    } else {
        in_review(cx, call, target, &["applied"])?
            .into_iter()
            .filter(|stored| stored.proposal.id != p.id)
            .collect()
    };
    // Reverse order: the review's order (8.3), backwards.
    members.sort_by(|a, b| {
        (
            &a.proposal.group,
            rank(&a.proposal.decide),
            a.proposal.subject(),
        )
            .cmp(&(
                &b.proposal.group,
                rank(&b.proposal.decide),
                b.proposal.subject(),
            ))
    });
    members.reverse();
    let mut undid = Vec::new();
    let mut unchanged = Vec::new();
    for member in &members {
        if restore(cx, call, &member.proposal, level, at)? {
            let mut proposal = member.proposal.clone();
            proposal.state = "undone".to_owned();
            proposal.decided_at = Some(at.to_owned());
            proposal.decided = Some(noted(&proposal.decided, "undone", level, call));
            write_proposal(cx, call, member, &proposal, Origin::UserStated, at)?;
            undid.push(proposal.id);
        } else {
            unchanged.push(member.proposal.id.clone());
        }
    }
    if undid.is_empty() {
        return Ok(Err("target-changed"));
    }
    Ok(Ok(json!({ "undid": undid, "unchanged": unchanged })))
}

/// `decided` with `{ level, by }` of a later decision under `name`: the first decision's level
/// is kept beside it.
fn noted(decided: &Option<Value>, name: &str, level: &str, call: &Call) -> Value {
    let mut decided = decided.clone().unwrap_or_else(|| json!({}));
    if let Some(map) = decided.as_object_mut() {
        map.insert(
            name.to_owned(),
            json!({ "level": level, "by": call.principal }),
        );
    }
    decided
}

fn text<'a>(effect: &'a Value, name: &str) -> Option<&'a str> {
    effect.get(name).and_then(Value::as_str)
}

fn flag(effect: &Value, name: &str) -> bool {
    effect.get(name).and_then(Value::as_bool).unwrap_or(false)
}

/// Restore what one applied proposal did, from its effect; false when its subject moved.
fn restore(cx: &Cx, call: &Call, p: &Proposal, level: &str, at: &str) -> Result<bool, HostError> {
    let Some(effect) = p.effect.clone() else {
        return Ok(false);
    };
    if p.decide == "undo" {
        return again(cx, call, &effect, level, at);
    }
    let id = p.idea.as_deref().unwrap_or_default();
    let Some(idea) = read_idea(cx, call, id)?.map(|stored| stored.idea) else {
        return Ok(false);
    };
    match p.decide.as_str() {
        "affirm" => {
            let Some(wording) = text(&effect, "wording") else {
                return Ok(false);
            };
            if idea.state != "live" || idea.held_id() != wording {
                return Ok(false);
            }
            decide(cx, call, wording, Decision::Withdraw)?;
        }
        "decline" => {
            let Some(wording) = text(&effect, "wording") else {
                return Ok(false);
            };
            if idea.state != "declined" || idea.held_id() != wording {
                return Ok(false);
            }
            set_role(cx, call, wording, "held", at)?;
            update_idea(cx, call, id, at, |idea| {
                idea.state = "live".to_owned();
                true
            })?;
            if flag(&effect, "withdrew") {
                decide(cx, call, wording, Decision::Affirm)?;
            }
        }
        "reword" => {
            let (Some(from), Some(to)) = (
                effect.get("from").and_then(Value::as_u64),
                effect.get("to").and_then(Value::as_u64),
            ) else {
                return Ok(false);
            };
            if idea.state != "live" || idea.held != to {
                return Ok(false);
            }
            let new = wording_id(id, to);
            decide(cx, call, &new, Decision::Withdraw)?;
            set_role(cx, call, &new, "withdrawn", at)?;
            set_role(cx, call, &wording_id(id, from), "held", at)?;
            update_idea(cx, call, id, at, |idea| {
                idea.held = from;
                true
            })?;
        }
        "duplicate" => {
            let keep = text(&effect, "keep").unwrap_or_default().to_owned();
            if idea.state != "folded" || idea.into.as_deref() != Some(keep.as_str()) {
                return Ok(false);
            }
            let roles = effect
                .get("roles")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            for pair in &roles {
                if let (Some(n), Some(role)) = (
                    pair.get(0).and_then(Value::as_u64),
                    pair.get(1).and_then(Value::as_str),
                ) {
                    set_role(cx, call, &wording_id(id, n), role, at)?;
                }
            }
            update_idea(cx, call, id, at, |idea| {
                idea.state = "live".to_owned();
                idea.into = None;
                true
            })?;
            let sightings = effect.get("sightings").and_then(Value::as_u64).unwrap_or(0);
            update_idea(cx, call, &keep, at, |kept| {
                kept.sightings = kept.sightings.saturating_sub(sightings).max(1);
                true
            })?;
            if flag(&effect, "withdrew") {
                decide(cx, call, &idea.held_id(), Decision::Affirm)?;
            }
        }
        _ => return Ok(false),
    }
    Ok(true)
}

/// Undo an undo: each proposal it undid is applied again, in the order it was first applied,
/// and is `applied` again with its new effect. False when none could be.
fn again(cx: &Cx, call: &Call, effect: &Value, level: &str, at: &str) -> Result<bool, HostError> {
    let undid: Vec<String> = effect
        .get("undid")
        .and_then(Value::as_array)
        .map(|ids| {
            ids.iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default();
    let mut any = false;
    for id in undid.iter().rev() {
        let Some(member) = read_proposal(cx, call, id)? else {
            continue;
        };
        if member.proposal.state != "undone" {
            continue;
        }
        let effect = match apply_one(cx, call, &member.proposal, level, at)? {
            Ok(effect) => effect,
            // Affirmed again by other means: applied as it stands.
            Err("already") => member.proposal.effect.clone().unwrap_or(Value::Null),
            Err(_) => continue,
        };
        let mut proposal = member.proposal.clone();
        proposal.state = "applied".to_owned();
        proposal.decided_at = Some(at.to_owned());
        proposal.effect = Some(effect);
        proposal.decided = Some(noted(&proposal.decided, "again", level, call));
        write_proposal(cx, call, &member, &proposal, Origin::UserStated, at)?;
        any = true;
    }
    Ok(any)
}

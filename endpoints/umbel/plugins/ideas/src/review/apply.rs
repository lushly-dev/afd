//! `ideas-review-apply` (specification, sections 8.5 and 8.6): a part of a review, applied after
//! the person confirmed it. The host's gate ran before the handler: the person confirmed this
//! command with this input, on the page or at a terminal.
//!
//! 1. The part's digest is recomputed; another one is `CONFLICT`.
//! 2. What the person pulled out on the page is read from `CallContext.person_decision`.
//! 3. Each proposal in 8.3's order is pulled, skipped (8.6) or applied, and marked in turn.
//! 4. The review is closed when nothing in it is staged.
//!
//! **What the handler may affirm** (records host specification, 6.1): only the wordings the
//! part's `affirm` proposals name, the wordings its `reword` proposals write, and in an undo only
//! what 8.7 restores. `record_decide` is called nowhere else in the plugin but the import.
//!
//! Apply is not one transaction: the store has none across records. A failure part way stops the
//! call with the host's code; what was applied stays applied, marked, and can be undone.

use std::collections::BTreeSet;

use serde_json::{Value, json};
use umbel_sdk::{Cx, HostError, Level, Outcome, success};
use umbel_store::Origin;
use umbel_store::lane::{Decision, Standing};

use super::parts::confirmed;
use super::preview::decision_input;
use super::{
    Proposal, Stored, by_decide, close_if_empty, find_all, set_role, update_idea, write_proposal,
};
use crate::pack::Pack;
use crate::pending::{key, pending};
use crate::records::{WORDING, Wording, now, put_absent, read, read_idea, wording_id};
use crate::{Call, fail};

/// The most characters of a preview the command line shows (`src/cli/preview.rs`,
/// `MAX_PREVIEW_CHARS`), not counting line ends; `tests/review_apply.rs` holds the two equal.
pub(crate) const TERMINAL_PREVIEW_CHARS: usize = 6000;

/// How applying one proposal ended: its effect, or why it was skipped (8.6).
pub(super) type Applied = Result<Value, &'static str>;

/// Whether a wording reads affirmed to the caller.
fn affirmed(cx: &Cx, call: &Call, id: &str) -> Result<Option<bool>, HostError> {
    Ok(read(cx, call, WORDING, id)?.map(|record| {
        record
            .label
            .as_ref()
            .is_some_and(|label| label.standing == Standing::Affirmed)
    }))
}

/// Affirm or withdraw a wording, through the host's gated service only.
pub(super) fn decide(cx: &Cx, call: &Call, id: &str, decision: Decision) -> Result<(), HostError> {
    cx.record_decide(&call.space, WORDING, id, decision)
        .map(drop)
}

/// Apply one proposal (8.5's table); its effect, for its undo, or why it was skipped.
pub(super) fn apply_one(
    cx: &Cx,
    call: &Call,
    p: &Proposal,
    level: &str,
    at: &str,
) -> Result<Applied, HostError> {
    if p.decide == "undo" {
        return super::undo::apply(cx, call, p, level, at);
    }
    let id = p.idea.as_deref().unwrap_or_default();
    let Some(stored) = read_idea(cx, call, id)? else {
        return Ok(Err("not-readable"));
    };
    let idea = stored.idea;
    if idea.state != "live" || Some(idea.held) != p.version {
        return Ok(Err("idea-changed"));
    }
    let held = idea.held_id();
    let Some(was_affirmed) = affirmed(cx, call, &held)? else {
        return Ok(Err("not-readable"));
    };
    match p.decide.as_str() {
        "affirm" => {
            if was_affirmed {
                return Ok(Err("already"));
            }
            decide(cx, call, &held, Decision::Affirm)?;
            Ok(Ok(json!({ "wording": held })))
        }
        "decline" => {
            if was_affirmed {
                decide(cx, call, &held, Decision::Withdraw)?;
            }
            set_role(cx, call, &held, "declined", at)?;
            update_idea(cx, call, id, at, |idea| {
                idea.state = "declined".to_owned();
                true
            })?;
            Ok(Ok(json!({ "wording": held, "withdrew": was_affirmed })))
        }
        "reword" => reword(cx, call, p, &idea, at),
        "duplicate" => duplicate(cx, call, p, &idea, was_affirmed, at),
        _ => Ok(Err("idea-changed")),
    }
}

/// A new wording `n + 1` with the proposal's statement, held and affirmed; the old one
/// superseded. The wording affirmed is written from the proposal the person was shown (D160).
fn reword(
    cx: &Cx,
    call: &Call,
    p: &Proposal,
    idea: &crate::records::Idea,
    at: &str,
) -> Result<Applied, HostError> {
    let Some(statement) = p.statement.clone() else {
        return Ok(Err("idea-changed"));
    };
    let old_id = idea.held_id();
    let Some(old) =
        read(cx, call, WORDING, &old_id)?.and_then(|record| Wording::parse(&record.record.body))
    else {
        return Ok(Err("not-readable"));
    };
    let n = idea.wordings + 1;
    let new_id = wording_id(&idea.id, n);
    let wording = Wording {
        idea: idea.id.clone(),
        n,
        statement: statement.clone(),
        kind: old.kind,
        tags: old.tags,
        role: "held".to_owned(),
        said: "person".to_owned(),
        captured_at: at.to_owned(),
        offered: json!([]),
        proposal: Some(p.id.clone()),
    };
    let wrote = put_absent(
        cx,
        call,
        WORDING,
        &new_id,
        wording.to_json(),
        Origin::UserStated,
        at,
    )?;
    if !wrote {
        // A run of this apply that stopped part way wrote it; anything else there is not the
        // wording the person was shown, and is never affirmed.
        let found = read(cx, call, WORDING, &new_id)?
            .and_then(|record| Wording::parse(&record.record.body));
        let ours = found.is_some_and(|found| {
            found.proposal.as_deref() == Some(p.id.as_str()) && found.statement == statement
        });
        if !ours {
            return Ok(Err("idea-changed"));
        }
    }
    decide(cx, call, &new_id, Decision::Affirm)?;
    set_role(cx, call, &old_id, "superseded", at)?;
    update_idea(cx, call, &idea.id, at, |idea| {
        idea.held = n;
        idea.wordings = idea.wordings.max(n);
        true
    })?;
    Ok(Ok(json!({ "from": idea.held, "to": n, "wording": new_id })))
}

/// Fold an idea into the one kept: its wordings `folded`, its state `folded`, `into` set, and
/// the kept idea's sightings gain its own.
fn duplicate(
    cx: &Cx,
    call: &Call,
    p: &Proposal,
    idea: &crate::records::Idea,
    was_affirmed: bool,
    at: &str,
) -> Result<Applied, HostError> {
    let keep = p.keep.as_deref().unwrap_or_default();
    let Some(kept) = read_idea(cx, call, keep)? else {
        return Ok(Err("not-readable"));
    };
    if kept.idea.state != "live" {
        return Ok(Err("keep-changed"));
    }
    let mut roles: Vec<(u64, String)> =
        find_all(cx, call, WORDING, vec![key("/idea", &[idea.id.as_str()])])?
            .iter()
            .filter_map(|record| Wording::parse(&record.record.body))
            .filter(|wording| wording.idea == idea.id)
            .map(|wording| (wording.n, wording.role))
            .collect();
    roles.sort();
    if was_affirmed {
        decide(cx, call, &idea.held_id(), Decision::Withdraw)?;
    }
    for (n, role) in &roles {
        if role != "folded" {
            set_role(cx, call, &wording_id(&idea.id, *n), "folded", at)?;
        }
    }
    update_idea(cx, call, &idea.id, at, |folded| {
        folded.state = "folded".to_owned();
        folded.into = Some(keep.to_owned());
        true
    })?;
    let sightings = idea.sightings;
    update_idea(cx, call, keep, at, |kept| {
        kept.sightings += sightings;
        true
    })?;
    Ok(Ok(json!({
        "roles": roles.iter().map(|(n, role)| json!([n, role])).collect::<Vec<_>>(),
        "withdrew": was_affirmed,
        "sightings": sightings,
        "keep": keep,
        "held": idea.held,
    })))
}

/// Mark a proposal of the part as the person decided it.
#[allow(clippy::too_many_arguments)]
fn mark(
    cx: &Cx,
    call: &Call,
    stored: &Stored,
    state: &str,
    level: &str,
    at: &str,
    effect: Option<Value>,
    skipped_for: Option<&str>,
) -> Result<(), HostError> {
    let decided = |base: &Stored| {
        let mut proposal = base.proposal.clone();
        proposal.state = state.to_owned();
        proposal.decided_at = Some(at.to_owned());
        proposal.decided = Some(json!({ "level": level }));
        proposal.effect = effect.clone();
        proposal.skipped_for = skipped_for.map(str::to_owned);
        proposal
    };
    match write_proposal(cx, call, stored, &decided(stored), Origin::UserStated, at) {
        Ok(_) => Ok(()),
        // Changed while the call applied it: unstaged by an agent meanwhile. What was done is
        // marked all the same, unless another apply marked it first.
        Err(HostError::Conflict { .. }) => {
            match super::read_proposal(cx, call, &stored.proposal.id)? {
                Some(again) if matches!(again.proposal.state.as_str(), "staged" | "unstaged") => {
                    write_proposal(cx, call, &again, &decided(&again), Origin::UserStated, at)
                        .map(drop)
                }
                _ => Ok(()),
            }
        }
        Err(error) => Err(error),
    }
}

/// `ideas-review-apply`.
pub(crate) fn run(input: &Value, cx: &Cx, call: &Call) -> Result<Outcome, Outcome> {
    let host = |error: HostError| fail::host(&error);
    let context = cx.call();
    // The proof the host's decision service will ask for: a decision on the page, or a person
    // at a terminal. Without it nothing is written, not even what needs no decision row.
    let level = match &context.person_decision {
        Some(decision) => decision.level.clone(),
        None if context.person => "terminal".to_owned(),
        None => return Err(fail::not_decided_by_person()),
    };
    let excluded: BTreeSet<String> = context
        .person_decision
        .as_ref()
        .map(|decision| decision.excluded.iter().cloned().collect())
        .unwrap_or_default();
    let pack = Pack::read(cx)?;
    let (review, part, digest) = decision_input(input)?;
    let items = confirmed(cx, call, &review, &part, &digest, pack.limits.part_max)?;
    if let Some(stray) = excluded
        .iter()
        .find(|id| !items.iter().any(|s| &s.proposal.id == *id))
    {
        cx.log(
            Level::Warn,
            &format!("ideas-review-apply: the decision pulled out {stray}, not of the part"),
        );
        return Err(fail::invalid(
            "excluded",
            "names a proposal that is not of the part the person confirmed",
        ));
    }
    // At a terminal the command line shows at most `TERMINAL_PREVIEW_CHARS` of the preview and
    // cuts the rest: a part longer than that was not all read, and is refused (C3-11).
    if context.person_decision.is_none() {
        let text = super::preview::text(cx, call, &review, &part, &items).map_err(host)?;
        let shown = text.chars().filter(|c| *c != '\n').count();
        if shown > TERMINAL_PREVIEW_CHARS {
            return Err(fail::preview_too_long(shown, TERMINAL_PREVIEW_CHARS));
        }
    }
    let at = now(cx)?;
    let mut applied = Vec::new();
    let mut pulled = Vec::new();
    let mut skipped = Vec::new();
    for stored in &items {
        let p = &stored.proposal;
        if excluded.contains(&p.id) {
            mark(cx, call, stored, "pulled", &level, &at, None, None).map_err(host)?;
            pulled.push(json!({ "proposal": p.id, "idea": p.idea, "decide": p.decide }));
            continue;
        }
        match apply_one(cx, call, p, &level, &at).map_err(host)? {
            Ok(effect) => {
                mark(cx, call, stored, "applied", &level, &at, Some(effect), None).map_err(host)?;
                applied.push(p.decide.clone());
            }
            Err(reason) => {
                mark(cx, call, stored, "skipped", &level, &at, None, Some(reason)).map_err(host)?;
                skipped.push(json!({ "proposal": p.id, "reason": reason }));
            }
        }
    }
    close_if_empty(cx, call, &review, &at).map_err(host)?;
    cx.log(
        Level::Info,
        &format!(
            "ideas-review-apply: review {review}, {} applied, {} pulled, {} skipped, level {level}",
            applied.len(),
            pulled.len(),
            skipped.len()
        ),
    );
    let pending = pending(cx, call).map_err(host)?;
    Ok(success(json!({
        "review": review,
        "part": part,
        "applied": by_decide(applied.iter().map(String::as_str)),
        "pulled": pulled,
        "skipped": skipped,
        "level": level,
        "pending": pending,
    })))
}

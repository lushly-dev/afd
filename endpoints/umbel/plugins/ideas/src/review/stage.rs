//! `ideas-review-stage` (specification, section 8.1): up to `stage_max` proposals in one call,
//! each with a reason, a group and a confidence. Nothing changes until the person confirms.
//!
//! 1. Every proposal is checked, against its shape and then against the store; any fault
//!    refuses the whole call and writes nothing.
//! 2. The review: the one named, the caller's newest open one, or a new one (`"new"`).
//! 3. A proposal on an idea with one staged in the same review replaces it; one staged in
//!    another open review refuses the call with `CONFLICT`.
//! 4. The review's and each group's caps hold after the call, else `QUOTA_EXCEEDED`.
//! 5. Each proposal is put, then the ones it replaces are unstaged.
//!
//! With `idempotencyKey` the review and the proposals take ids derived from the key (4.5): a
//! call sent again finds what the first wrote, completes what it did not, and answers the whole.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Value, json};
use umbel_sdk::{Cx, HostError, Level, Outcome, success};
use umbel_store::Origin;
use umbel_store::lane::{Standing, match_digest};

use super::parts::{Ideas, is_group, listed, split};
use super::{
    DECIDES, Proposal, Review, Stored, by_decide, in_review, newest_open, read_proposal,
    read_review, scan, set_review_state, staged_on, write_proposal,
};
use crate::capture::statement_ok;
use crate::pack::Pack;
use crate::pending::{count, key, pending};
use crate::records::{
    IDEA_PREFIX, Idea, PROPOSAL, PROPOSAL_PREFIX, REVIEW, REVIEW_PREFIX, WORDING, Wording, now,
    put_absent, read, read_idea,
};
use crate::{Call, fail, ids, input};

/// The most characters of a reason.
const REASON_CHARS: usize = 200;
/// The most characters of a review's name.
const NAME_CHARS: usize = 64;

/// One proposal as the caller sent it, checked for shape.
#[derive(Debug, Clone)]
struct Draft {
    decide: String,
    idea: Option<String>,
    version: Option<u64>,
    statement: Option<String>,
    keep: Option<String>,
    target: Option<String>,
    reason: String,
    group: String,
    confidence: String,
}

impl Draft {
    /// Whether a proposal the first call wrote is this one.
    fn same_as(&self, proposal: &Proposal) -> bool {
        let digest = |s: Option<&str>| s.and_then(match_digest);
        self.decide == proposal.decide
            && self.idea == proposal.idea
            && self.keep == proposal.keep
            && self.target == proposal.target
            && digest(self.statement.as_deref()) == digest(proposal.statement.as_deref())
            && (self.version.is_none() || self.version == proposal.version)
    }
}

fn shape(index: usize, item: &Value, pack: &Pack) -> Result<Draft, Outcome> {
    let bad = |field: &str, rule: &str| fail::invalid_item("proposals", index, field, rule);
    let text = |field: &str| -> Result<Option<String>, Outcome> {
        match item.get(field) {
            None | Some(Value::Null) => Ok(None),
            Some(Value::String(text)) => Ok(Some(text.clone())),
            Some(_) => Err(bad(field, "must be a string")),
        }
    };
    let decide = text("decide")?
        .filter(|d| DECIDES.contains(&d.as_str()))
        .ok_or_else(|| {
            bad(
                "decide",
                "must be affirm, decline, reword, duplicate or undo",
            )
            .with_error_details(json!({
                "field": format!("proposals[{index}].decide"),
                "index": index,
                "valid": DECIDES,
            }))
        })?;
    let idea_id = |field: &str| -> Result<String, Outcome> {
        text(field)?
            .filter(|id| ids::is_id(id, IDEA_PREFIX))
            .ok_or_else(|| bad(field, "must name an idea by its id"))
    };
    let version = match item.get("version") {
        None | Some(Value::Null) => None,
        Some(value) => Some(
            value
                .as_u64()
                .filter(|n| *n >= 1)
                .ok_or_else(|| bad("version", "must be an integer from 1"))?,
        ),
    };
    let mut draft = Draft {
        decide: decide.clone(),
        idea: None,
        version: None,
        statement: None,
        keep: None,
        target: None,
        reason: String::new(),
        group: decide.clone(),
        confidence: "medium".to_owned(),
    };
    match decide.as_str() {
        "affirm" | "decline" | "reword" => {
            draft.idea = Some(idea_id("idea")?);
            // A decision always names a wording (the plan's decision 25).
            draft.version =
                Some(version.ok_or_else(|| bad("version", "is required: name the wording"))?);
            if decide == "reword" {
                let statement = text("statement")?.unwrap_or_default();
                if !statement_ok(&statement, pack) {
                    return Err(bad(
                        "statement",
                        &format!(
                            "must be 1 to {} characters on one line, with a word in it",
                            pack.limits.statement_chars
                        ),
                    ));
                }
                draft.statement = Some(statement);
            }
        }
        "duplicate" => {
            let idea = idea_id("idea")?;
            let keep = idea_id("keep")?;
            if idea == keep {
                return Err(bad("keep", "must name another idea than idea"));
            }
            draft.idea = Some(idea);
            draft.keep = Some(keep);
        }
        _ => {
            draft.target = Some(
                text("target")?
                    .filter(|t| ids::is_id(t, PROPOSAL_PREFIX) || ids::is_id(t, REVIEW_PREFIX))
                    .ok_or_else(|| bad("target", "must name a proposal or a review by its id"))?,
            );
        }
    }
    let reason = text("reason")?.unwrap_or_default();
    if reason.is_empty() || reason.chars().count() > REASON_CHARS || !input::one_line(&reason) {
        return Err(bad("reason", "must be 1 to 200 characters on one line"));
    }
    draft.reason = reason;
    if let Some(group) = text("group")? {
        if !is_group(&group) {
            return Err(bad("group", "must be 1 to 64 characters of a-z, 0-9 and -"));
        }
        draft.group = group;
    }
    if let Some(confidence) = text("confidence")? {
        if !matches!(confidence.as_str(), "high" | "medium" | "low") {
            return Err(bad("confidence", "must be high, medium or low"));
        }
        draft.confidence = confidence;
    }
    Ok(draft)
}

/// The ideas the checks read, each once.
#[derive(Default)]
struct Cache(BTreeMap<String, Option<Idea>>);

impl Cache {
    fn idea(&mut self, cx: &Cx, call: &Call, id: &str) -> Result<Option<Idea>, HostError> {
        if !self.0.contains_key(id) {
            let found = read_idea(cx, call, id)?.map(|stored| stored.idea);
            self.0.insert(id.to_owned(), found);
        }
        Ok(self.0[id].clone())
    }
}

/// Check a new proposal against the store (8.1's table); answers its `version`.
fn check(
    cx: &Cx,
    call: &Call,
    index: usize,
    draft: &Draft,
    cache: &mut Cache,
) -> Result<Option<u64>, Outcome> {
    let host = |error: HostError| fail::host(&error);
    let bad = |field: &str, rule: &str| fail::invalid_item("proposals", index, field, rule);
    let live = |cache: &mut Cache, field: &str, id: &str| -> Result<Idea, Outcome> {
        cache
            .idea(cx, call, id)
            .map_err(host)?
            .filter(|idea| idea.state == "live")
            .ok_or_else(|| bad(field, "must name a live idea you can read"))
    };
    match draft.decide.as_str() {
        "affirm" | "decline" | "reword" => {
            let idea = live(cache, "idea", draft.idea.as_deref().unwrap_or_default())?;
            if draft.version != Some(idea.held) {
                return Err(bad("version", "is not the idea's held wording"));
            }
            if draft.decide != "decline" {
                let held = read(cx, call, WORDING, &idea.held_id())
                    .map_err(host)?
                    .ok_or_else(|| bad("idea", "must name a live idea you can read"))?;
                if draft.decide == "affirm"
                    && held
                        .label
                        .as_ref()
                        .is_some_and(|label| label.standing == Standing::Affirmed)
                {
                    return Err(bad("version", "is affirmed already"));
                }
                if draft.decide == "reword" {
                    let old = Wording::parse(&held.record.body)
                        .and_then(|wording| match_digest(&wording.statement));
                    if old.is_some() && old == draft.statement.as_deref().and_then(match_digest) {
                        return Err(bad("statement", "says the same as the held wording"));
                    }
                }
            }
            Ok(draft.version)
        }
        "duplicate" => {
            let idea = live(cache, "idea", draft.idea.as_deref().unwrap_or_default())?;
            live(cache, "keep", draft.keep.as_deref().unwrap_or_default())?;
            Ok(Some(idea.held))
        }
        _ => {
            let target = draft.target.as_deref().unwrap_or_default();
            let applied = if ids::is_id(target, PROPOSAL_PREFIX) {
                read_proposal(cx, call, target)
                    .map_err(host)?
                    .is_some_and(|stored| stored.proposal.state == "applied")
            } else {
                count(
                    cx,
                    call,
                    PROPOSAL,
                    vec![key("/review", &[target]), key("/state", &["applied"])],
                    Vec::new(),
                )
                .map_err(host)?
                    > 0
            };
            if !applied {
                return Err(bad(
                    "target",
                    "must name an applied proposal, or a review holding one",
                ));
            }
            Ok(None)
        }
    }
}

/// `ideas-review-stage`.
pub(crate) fn run(input: &Value, cx: &Cx, call: &Call) -> Result<Outcome, Outcome> {
    let pack = Pack::read(cx)?;
    let host = |error: HostError| fail::host(&error);
    let key_given = ids::check_key(input::string(input, "idempotencyKey")?)?;
    let named = input::string(input, "review")?;
    if let Some(named) = named
        && named != "new"
        && !ids::is_id(named, REVIEW_PREFIX)
    {
        return Err(fail::invalid("review", "must be a review's id, or new"));
    }
    let name = input::string(input, "name")?;
    if let Some(name) = name
        && (name.is_empty() || name.chars().count() > NAME_CHARS || !input::one_line(name))
    {
        return Err(fail::invalid(
            "name",
            "must be 1 to 64 characters on one line",
        ));
    }
    let Some(list) = input.get("proposals").and_then(Value::as_array) else {
        return Err(fail::invalid("proposals", "must be an array of proposals"));
    };
    if list.is_empty() || list.len() as u64 > pack.limits.stage_max {
        return Err(fail::invalid(
            "proposals",
            &format!("must hold 1 to {} proposals", pack.limits.stage_max),
        ));
    }

    // 1. Shape, and no idea or target twice in one call.
    let drafts = list
        .iter()
        .enumerate()
        .map(|(index, item)| shape(index, item, &pack))
        .collect::<Result<Vec<_>, _>>()?;
    let mut subjects = BTreeSet::new();
    for (index, draft) in drafts.iter().enumerate() {
        let field = if draft.idea.is_some() {
            "idea"
        } else {
            "target"
        };
        let subject = draft
            .idea
            .clone()
            .or(draft.target.clone())
            .unwrap_or_default();
        if !subjects.insert(subject) {
            return Err(fail::invalid_item(
                "proposals",
                index,
                field,
                "is named by an earlier proposal in this call",
            ));
        }
    }

    // Ids, and what a first call with the same key wrote.
    let mut pids = Vec::with_capacity(drafts.len());
    let mut first: Vec<Option<Stored>> = Vec::with_capacity(drafts.len());
    for (index, draft) in drafts.iter().enumerate() {
        let hex = match key_given {
            Some(key) => ids::derived(call, key, index),
            None => ids::drawn(cx)?,
        };
        let pid = format!("{PROPOSAL_PREFIX}{hex}");
        let found = match key_given {
            Some(_) => read_proposal(cx, call, &pid).map_err(host)?,
            None => None,
        };
        if let Some(found) = &found
            && !draft.same_as(&found.proposal)
        {
            return Err(fail::key_reused(index));
        }
        pids.push(pid);
        first.push(found);
    }
    let replayed = first.iter().any(Option::is_some);

    // 2. The review.
    let observed_at = now(cx)?;
    let existing = match first.iter().flatten().next() {
        Some(found) => Some(
            read_review(cx, call, &found.proposal.review)
                .map_err(host)?
                .ok_or_else(|| fail::review_not_found(Some(&found.proposal.review)))?,
        ),
        None => match named {
            Some("new") => None,
            Some(id) => Some(
                read_review(cx, call, id)
                    .map_err(host)?
                    .ok_or_else(|| fail::review_not_found(Some(id)))?,
            ),
            None => newest_open(cx, call).map_err(host)?,
        },
    };
    let review_id = match &existing {
        Some(stored) => stored.review.id.clone(),
        None => match key_given {
            Some(key) => format!("{REVIEW_PREFIX}{}", ids::derived_tag(call, key, "review")),
            None => format!("{REVIEW_PREFIX}{}", ids::drawn(cx)?),
        },
    };

    // 1, against the store, for the proposals not written yet; and 3, what each replaces.
    let mut cache = Cache::default();
    let staged_now = match &existing {
        Some(_) => in_review(cx, call, &review_id, &["staged"]).map_err(host)?,
        None => Vec::new(),
    };
    let mut versions = Vec::with_capacity(drafts.len());
    let mut replaces: Vec<Vec<Stored>> = Vec::with_capacity(drafts.len());
    for (index, draft) in drafts.iter().enumerate() {
        let version = match &first[index] {
            Some(found) => found.proposal.version,
            None => check(cx, call, index, draft, &mut cache)?,
        };
        versions.push(version);
        let mut replaced = Vec::new();
        match &draft.idea {
            Some(idea) => {
                for other in staged_on(cx, call, idea).map_err(host)? {
                    if other.proposal.id == pids[index] {
                        continue;
                    }
                    if other.proposal.review != review_id {
                        if first[index].is_none() {
                            return Err(fail::staged_elsewhere(index, &other.proposal.review));
                        }
                        continue;
                    }
                    replaced.push(other);
                }
            }
            None => replaced.extend(
                staged_now
                    .iter()
                    .filter(|other| {
                        other.proposal.decide == "undo"
                            && other.proposal.target == draft.target
                            && other.proposal.id != pids[index]
                    })
                    .cloned(),
            ),
        }
        replaces.push(replaced);
    }

    // 4. The caps, after the call.
    let leaving: BTreeSet<&str> = replaces
        .iter()
        .flatten()
        .map(|stored| stored.proposal.id.as_str())
        .collect();
    let mut groups: BTreeMap<String, u64> = BTreeMap::new();
    let mut total = 0u64;
    for stored in &staged_now {
        if !leaving.contains(stored.proposal.id.as_str()) && !pids.contains(&stored.proposal.id) {
            *groups.entry(stored.proposal.group.clone()).or_default() += 1;
            total += 1;
        }
    }
    for (index, draft) in drafts.iter().enumerate() {
        let staying = first[index]
            .as_ref()
            .is_none_or(|found| found.proposal.state == "staged");
        if staying {
            *groups.entry(draft.group.clone()).or_default() += 1;
            total += 1;
        }
    }
    if total > pack.limits.review_max {
        return Err(fail::review_full(pack.limits.review_max, None));
    }
    if let Some((group, _)) = groups.iter().find(|(_, n)| **n > pack.limits.part_max) {
        return Err(fail::review_full(pack.limits.part_max, Some(group)));
    }

    // 5. The writes: the review, each proposal, then what it replaces.
    match &existing {
        None => {
            let review = Review {
                id: review_id.clone(),
                state: "open".to_owned(),
                by: call.principal.clone(),
                opened_at: observed_at.clone(),
                name: name.map(str::to_owned),
            };
            put_absent(
                cx,
                call,
                REVIEW,
                &review_id,
                review.to_json(),
                Origin::AgentInferred,
                &observed_at,
            )
            .map_err(host)?;
        }
        Some(stored) if stored.review.state != "open" => {
            set_review_state(cx, call, &review_id, "open", &observed_at).map_err(host)?;
        }
        Some(_) => {}
    }
    let mut added = 0u64;
    let mut replaced_ids = Vec::new();
    let mut flagged = 0usize;
    for (index, draft) in drafts.iter().enumerate() {
        let state = match &first[index] {
            Some(found) => found.proposal.state.clone(),
            None => {
                let proposal = Proposal {
                    id: pids[index].clone(),
                    review: review_id.clone(),
                    idea: draft.idea.clone(),
                    decide: draft.decide.clone(),
                    version: versions[index],
                    statement: draft.statement.clone(),
                    keep: draft.keep.clone(),
                    target: draft.target.clone(),
                    reason: draft.reason.clone(),
                    group: draft.group.clone(),
                    confidence: draft.confidence.clone(),
                    flags: scan(
                        &[Some(draft.reason.as_str()), draft.statement.as_deref()]
                            .into_iter()
                            .flatten()
                            .collect::<Vec<_>>(),
                    ),
                    staged_at: observed_at.clone(),
                    decided_at: None,
                    state: "staged".to_owned(),
                    decided: None,
                    effect: None,
                    skipped_for: None,
                };
                if !proposal.flags.is_empty() {
                    flagged += 1;
                }
                if put_absent(
                    cx,
                    call,
                    PROPOSAL,
                    &proposal.id,
                    proposal.to_json(),
                    Origin::AgentInferred,
                    &observed_at,
                )
                .map_err(host)?
                {
                    added += 1;
                }
                "staged".to_owned()
            }
        };
        if state != "staged" {
            continue;
        }
        for old in &replaces[index] {
            let mut proposal = old.proposal.clone();
            if proposal.state != "staged" {
                continue;
            }
            proposal.state = "unstaged".to_owned();
            proposal.decided_at = Some(observed_at.clone());
            match write_proposal(
                cx,
                call,
                old,
                &proposal,
                Origin::AgentInferred,
                &observed_at,
            ) {
                Ok(_) => replaced_ids.push(proposal.id.clone()),
                // Changed since it was read: no longer staged, or unstaged by another call.
                Err(HostError::Conflict { .. }) => {}
                Err(error) => return Err(host(error)),
            }
        }
    }

    // The answer: the review as it now stands.
    let staged = in_review(cx, call, &review_id, &["staged"]).map_err(host)?;
    let counts = by_decide(staged.iter().map(|s| s.proposal.decide.as_str()));
    let staged_count = staged.len();
    let parts = split(staged);
    let (listed_parts, whole) =
        listed(cx, call, &parts, false, &mut Ideas::default()).map_err(host)?;
    cx.log(
        Level::Info,
        &format!(
            "ideas-review-stage: review {review_id}, {added} added, {} replaced, {staged_count} staged, replayed {replayed}",
            replaced_ids.len()
        ),
    );
    let pending = pending(cx, call).map_err(host)?;
    let outcome = success(json!({
        "review": review_id,
        "staged": staged_count,
        "added": added,
        "proposals": pids,
        "replaced": replaced_ids,
        "replayed": replayed,
        "parts": listed_parts,
        "digest": whole,
        "counts": counts,
        "pending": pending,
    }));
    Ok(if flagged > 0 {
        outcome.with_warning_details(
            "CONTENT_FLAGGED",
            &format!("{flagged} staged proposal(s) matched the instruction or hidden-text scan"),
            json!({ "count": flagged }),
        )
    } else {
        outcome
    })
}

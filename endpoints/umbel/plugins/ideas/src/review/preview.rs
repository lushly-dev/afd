//! `ideas-review-preview` (specification, section 8.4): what the person reads before they
//! decide a part. It reads the part as the caller, recomputes its digest, and refuses a part
//! that changed with `CONFLICT`, so a person is never asked about anything but what is applied.
//!
//! Step C3 answers the unpaged shape only, exactly `{ "preview": <text> }`, the only shape the
//! command line and the page accept before step H2: the heading, then every item's block. Step
//! C4 adds the paged shape with items for a page that sets `CallContext.preview_page`. At a
//! terminal there is nothing to pull out: the person tells the agent, which unstages.

use std::collections::BTreeSet;

use serde_json::{Value, json};
use umbel_sdk::{Cx, HostError, Outcome, success};

use super::parts::{WHOLE, check_part, confirmed};
use super::show::{held, target_summary};
use super::{DECIDES, Stored};
use crate::pack::Pack;
use crate::{Call, fail, input};

/// The input every decision names: review, part and digest.
pub(crate) fn decision_input(input: &Value) -> Result<(String, String, String), Outcome> {
    let review = input::string(input, "review")?
        .ok_or_else(|| fail::invalid("review", "is required"))?
        .to_owned();
    let part = input::string(input, "part")?
        .ok_or_else(|| fail::invalid("part", "is required"))?
        .to_owned();
    check_part("part", &part)?;
    let digest = input::string(input, "digest")?
        .ok_or_else(|| fail::invalid("digest", "is required"))?
        .to_owned();
    Ok((review, part, digest))
}

/// A held wording's quoted statement and standing, or a stand-in when it cannot be read.
fn quoted(found: Option<&Value>) -> (String, String, String) {
    match found {
        Some(held) => (
            format!("\"{}\"", held["statement"].as_str().unwrap_or_default()),
            held["standing"].as_str().unwrap_or("unknown").to_owned(),
            held["said"].as_str().unwrap_or("unknown").to_owned(),
        ),
        None => (
            "(an idea you cannot read)".to_owned(),
            "unknown".to_owned(),
            "unknown".to_owned(),
        ),
    }
}

/// One proposal's block (8.4).
pub(crate) fn item_text(cx: &Cx, call: &Call, stored: &Stored) -> Result<String, HostError> {
    let p = &stored.proposal;
    let held_of = |id: Option<&str>| -> Result<Option<Value>, HostError> {
        match id {
            Some(id) => held(cx, call, id),
            None => Ok(None),
        }
    };
    let idea = held_of(p.idea.as_deref())?;
    let (statement, standing, said) = quoted(idea.as_ref());
    let mut flagged: BTreeSet<String> = p.flags.iter().cloned().collect();
    if let Some(flags) = idea.as_ref().and_then(|h| h["flags"].as_array()) {
        flagged.extend(flags.iter().filter_map(Value::as_str).map(str::to_owned));
    }
    let body = match p.decide.as_str() {
        "affirm" => format!("AFFIRM  {statement}  ({standing}, said by {said})"),
        "decline" => format!("DECLINE {statement}  ({standing})"),
        "reword" => format!(
            "REWORD  {statement}  →  \"{}\"",
            p.statement.as_deref().unwrap_or_default()
        ),
        "duplicate" => {
            let kept = held_of(p.keep.as_deref())?;
            if let Some(flags) = kept.as_ref().and_then(|h| h["flags"].as_array()) {
                flagged.extend(flags.iter().filter_map(Value::as_str).map(str::to_owned));
            }
            let (kept_statement, kept_standing, _) = quoted(kept.as_ref());
            format!(
                "DUPLICATE  fold {statement}  into the one kept: {kept_statement} ({kept_standing})"
            )
        }
        _ => format!(
            "UNDO  {}",
            target_summary(cx, call, p.target.as_deref().unwrap_or_default())?
        ),
    };
    let mark = if flagged.is_empty() {
        String::new()
    } else {
        format!(
            "  [flagged: {}]",
            flagged.into_iter().collect::<Vec<_>>().join(", ")
        )
    };
    Ok(format!("{body}  · {} · {}{mark}", p.confidence, p.reason))
}

/// The heading: `Review <id> · part <group> · <count> decisions (<n> affirm, …)`.
fn heading(review: &str, part: &str, items: &[Stored]) -> String {
    let counts: Vec<String> = DECIDES
        .iter()
        .filter_map(|decide| {
            let n = items
                .iter()
                .filter(|s| s.proposal.decide == *decide)
                .count();
            (n > 0).then(|| format!("{n} {decide}"))
        })
        .collect();
    let part = if part == WHOLE {
        "* (the whole review)".to_owned()
    } else {
        part.to_owned()
    };
    format!(
        "Review {review} · part {part} · {} decisions ({})",
        items.len(),
        counts.join(", ")
    )
}

/// Who staged the part's proposals, from their envelopes.
fn staged_by(items: &[Stored]) -> String {
    let by: BTreeSet<String> = items
        .iter()
        .map(|s| {
            let agent = s.by["agent"]["id"].as_str();
            let principal = s.by["principal"].as_str().unwrap_or("unknown");
            match agent {
                Some(agent) => format!("{agent} for {principal}"),
                None => principal.to_owned(),
            }
        })
        .collect();
    format!(
        "Staged by {}.",
        by.into_iter().collect::<Vec<_>>().join(", ")
    )
}

/// The unpaged preview's text.
pub(crate) fn text(
    cx: &Cx,
    call: &Call,
    review: &str,
    part: &str,
    items: &[Stored],
) -> Result<String, HostError> {
    let mut lines = vec![
        heading(review, part, items),
        staged_by(items),
        "To leave one out, say so to the agent, which unstages it; then confirm the new digest."
            .to_owned(),
        "Everything applied can be undone later with an undo proposal.".to_owned(),
    ];
    let mut group: Option<&str> = None;
    for stored in items {
        if part == WHOLE && group != Some(stored.proposal.group.as_str()) {
            group = Some(stored.proposal.group.as_str());
            lines.push(String::new());
            lines.push(format!("## {}", stored.proposal.group));
        }
        lines.push(item_text(cx, call, stored)?);
    }
    Ok(lines.join("\n"))
}

/// `ideas-review-preview`.
pub(crate) fn run(input: &Value, cx: &Cx, call: &Call) -> Result<Outcome, Outcome> {
    let pack = Pack::read(cx)?;
    let (review, part, digest) = decision_input(input)?;
    let items = confirmed(cx, call, &review, &part, &digest, pack.limits.part_max)?;
    let text = text(cx, call, &review, &part, &items).map_err(|error| fail::host(&error))?;
    Ok(success(json!({ "preview": text })))
}

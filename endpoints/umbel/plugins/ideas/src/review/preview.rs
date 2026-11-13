//! `ideas-review-preview` (specification, section 8.4): what the person reads before they
//! decide a part. It reads the part as the caller, recomputes its digest, and refuses a part
//! that changed with `CONFLICT`, so a person is never asked about anything but what is applied.
//!
//! With `CallContext.preview_page` set, as the person page sets it on every render, it answers
//! page `n` in the paged shape `{ preview, page, pages, items }`: a heading, and one item a
//! proposal that the person may pull out. Pages are filled in order with whole items, at most
//! `limits.page_items` items and `limits.page_chars` characters a page, so the host never cuts
//! one. Without it, at the command line and in the host's own check before a decision is begun,
//! it answers exactly `{ "preview": <text> }`: the heading, then every item's block. At a
//! terminal there is nothing to pull out: the person tells the agent, which unstages.

use std::collections::BTreeSet;

use serde_json::{Value, json};
use umbel_sdk::{Cx, HostError, Outcome, success};

use super::parts::{WHOLE, check_part, confirmed};
use super::show::{held, target_summary};
use super::{DECIDES, Stored};
use crate::pack::{Limits, Pack};
use crate::{Call, fail, input};

/// Page 1's lines after the heading, past who staged the part: what unchecking does, and that
/// everything applied can be undone (8.4).
const PAGE_ONE_LINES: [&str; 2] = [
    "Uncheck a decision to leave it out: it is not applied, and it is recorded that you disagreed.",
    "Everything applied can be undone later with an undo proposal.",
];
/// The widest page count a heading names: the host's 200 pages, at three digits.
const WIDEST_PAGES: u32 = 999;

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

/// The characters a page shows of `text`, as the host counts them: line ends not counted.
pub(crate) fn shown(text: &str) -> usize {
    text.chars().filter(|c| *c != '\n').count()
}

/// Page `page` of `pages`'s heading: the part's heading and the page, then, on page 1 only, who
/// staged the part and [`PAGE_ONE_LINES`].
fn page_heading(part_heading: &str, by: &str, page: u32, pages: u32) -> String {
    let mut lines = vec![format!("{part_heading} · page {page} of {pages}")];
    if page == 1 {
        lines.push(by.to_owned());
        lines.extend(PAGE_ONE_LINES.iter().map(|line| (*line).to_owned()));
    }
    lines.join("\n")
}

/// The part's items laid out in pages (8.4): each page the `(id, text)` of its items, in 8.3's
/// order. A page holds whole items, at most `page_items` of them, and at most `page_chars`
/// characters with its heading, which is measured at its widest page count. In `"*"`, the first
/// item of each group on a page starts with the line `## <group>` (amendment C4-2). Every page
/// holds at least one item, so a part with none is one empty page.
pub(crate) fn layout(
    part: &str,
    part_heading: &str,
    by: &str,
    items: &[(String, String, String)],
    limits: &Limits,
) -> Vec<Vec<(String, String)>> {
    let most_items = usize::try_from(limits.page_items)
        .unwrap_or(usize::MAX)
        .max(1);
    let most_chars = usize::try_from(limits.page_chars).unwrap_or(usize::MAX);
    let budget = |page: usize| {
        let number = u32::try_from(page).unwrap_or(WIDEST_PAGES);
        let heading = page_heading(part_heading, by, number.max(1), WIDEST_PAGES);
        most_chars.saturating_sub(shown(&heading))
    };
    let mut pages: Vec<Vec<(String, String)>> = vec![Vec::new()];
    let mut used = 0usize;
    let mut group: Option<&str> = None;
    for (id, item_group, text) in items {
        let starts_group = |page: &[(String, String)], group: Option<&str>| {
            part == WHOLE && (page.is_empty() || group != Some(item_group.as_str()))
        };
        let with_heading = |text: &str, heads: bool| {
            if heads {
                format!("## {item_group}\n{text}")
            } else {
                text.to_owned()
            }
        };
        let current = pages.last().map_or(&[][..], Vec::as_slice);
        let mut entry = with_heading(text, starts_group(current, group));
        let full = current.len() >= most_items || used + shown(&entry) > budget(pages.len());
        if full && !current.is_empty() {
            pages.push(Vec::new());
            used = 0;
            entry = with_heading(text, part == WHOLE);
        }
        used += shown(&entry);
        group = Some(item_group.as_str());
        if let Some(page) = pages.last_mut() {
            page.push((id.clone(), entry));
        }
    }
    pages
}

/// Page `asked` of the part, in the paged shape.
fn paged(
    cx: &Cx,
    call: &Call,
    review: &str,
    part: &str,
    items: &[Stored],
    asked: u32,
    limits: &Limits,
) -> Result<Outcome, Outcome> {
    let texts = items
        .iter()
        .map(|stored| {
            item_text(cx, call, stored).map(|text| {
                (
                    stored.proposal.id.clone(),
                    stored.proposal.group.clone(),
                    text,
                )
            })
        })
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| fail::host(&error))?;
    let part_heading = heading(review, part, items);
    let by = staged_by(items);
    let pages = layout(part, &part_heading, &by, &texts, limits);
    let count = u32::try_from(pages.len()).unwrap_or(u32::MAX);
    let Some(page) = usize::try_from(asked)
        .ok()
        .and_then(|asked| asked.checked_sub(1))
        .and_then(|index| pages.get(index))
    else {
        return Err(fail::page_past_last(asked, count));
    };
    Ok(success(json!({
        "preview": page_heading(&part_heading, &by, asked, count),
        "page": asked,
        "pages": count,
        "items": page
            .iter()
            .map(|(id, text)| json!({ "id": id, "text": text }))
            .collect::<Vec<_>>(),
    })))
}

/// `ideas-review-preview`.
pub(crate) fn run(input: &Value, cx: &Cx, call: &Call) -> Result<Outcome, Outcome> {
    let pack = Pack::read(cx)?;
    let (review, part, digest) = decision_input(input)?;
    let items = confirmed(cx, call, &review, &part, &digest, pack.limits.part_max)?;
    if let Some(asked) = cx.call().preview_page {
        return paged(cx, call, &review, &part, &items, asked, &pack.limits);
    }
    let text = text(cx, call, &review, &part, &items).map_err(|error| fail::host(&error))?;
    Ok(success(json!({ "preview": text })))
}

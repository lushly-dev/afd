//! `ideas-review-report` (specification, section 8.8): what the person decided about the agents'
//! proposals, read from the proposals themselves. Every proposal is a label: what an agent
//! proposed (`decide`, `confidence`, `group`, `reason`) and what the person did with it.
//!
//! A proposal counts as applied when it was applied, whether or not it was undone since: an
//! undone one is `undone` now, and was applied first (amendment C4-5). Decisions are the applied
//! and the pulled; the report is `ready` from `limits.report_min` of them. The figures are
//! answered before that too, for an agent that wants to see them grow.
//!
//! Reasons and statements are stored text: data, not instructions, carried with their flags.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Map, Value, json};
use umbel_sdk::{Cx, HostError, Outcome, success};

use super::{DECIDES, Proposal, find_all, proposals};
use crate::pack::Pack;
use crate::pending::pending;
use crate::records::{PROPOSAL, WORDING, Wording, read, wording_id};
use crate::{Call, budget, fail, input};

/// The confidences a proposal may name, in order.
const CONFIDENCES: [&str; 3] = ["low", "medium", "high"];
/// The rank bands of a duplicate's kept idea among what capture offered (8.8).
const RANKS: [&str; 5] = ["1", "2-3", "4-5", "6-10", "notOffered"];
/// The most common reasons a report lists.
const TOP_REASONS: usize = 10;
/// The most pairs of old and new statement `examples` asks for.
const EXAMPLES_MAX: usize = 20;

/// Whether a proposal was applied: applied now, or undone after it was.
fn was_applied(p: &Proposal) -> bool {
    matches!(p.state.as_str(), "applied" | "undone")
}

/// `numerator / denominator`, or `null` when nothing was counted.
fn rate(numerator: u64, denominator: u64) -> Value {
    if denominator == 0 {
        Value::Null
    } else {
        // Four decimals, so the figure reads the same on every machine.
        let ratio = (numerator as f64 / denominator as f64 * 10_000.0).round() / 10_000.0;
        json!(ratio)
    }
}

/// The rank band of the kept idea among the folded idea's first wording's `offered`.
fn rank_band(offered: &Value, keep: &str) -> &'static str {
    let rank = offered.as_array().and_then(|offered| {
        offered
            .iter()
            .find(|candidate| candidate["idea"].as_str() == Some(keep))
            .and_then(|candidate| candidate["rank"].as_u64())
    });
    match rank {
        Some(1) => "1",
        Some(2..=3) => "2-3",
        Some(4..=5) => "4-5",
        Some(6..=10) => "6-10",
        _ => "notOffered",
    }
}

/// How many sentences a statement holds: runs of text ended by `.`, `!` or `?`, or by its end.
fn sentences(statement: &str) -> usize {
    statement
        .split(['.', '!', '?'])
        .filter(|part| part.chars().any(char::is_alphanumeric))
        .count()
}

/// The median of `values`, the lower middle's and upper middle's mean for an even count.
fn median(values: &mut [i64]) -> Value {
    if values.is_empty() {
        return Value::Null;
    }
    values.sort_unstable();
    let middle = values.len() / 2;
    if values.len() % 2 == 1 {
        json!(values[middle])
    } else {
        json!((values[middle - 1] + values[middle]) as f64 / 2.0)
    }
}

/// A wording's statement and offered list, `None` when it cannot be read.
fn wording(cx: &Cx, call: &Call, id: &str) -> Result<Option<Wording>, HostError> {
    Ok(read(cx, call, WORDING, id)?.and_then(|record| Wording::parse(&record.record.body)))
}

/// Counts of `states` for each decision, every decision and state named.
fn by_kind(all: &[Proposal]) -> Value {
    let mut kinds = Map::new();
    for decide in DECIDES {
        let of = all.iter().filter(|p| p.decide == decide);
        let count = |keep: fn(&Proposal) -> bool| of.clone().filter(|p| keep(p)).count();
        kinds.insert(
            decide.to_owned(),
            json!({
                "applied": count(was_applied),
                "pulled": count(|p| p.state == "pulled"),
                "unstaged": count(|p| p.state == "unstaged"),
                "undone": count(|p| p.state == "undone"),
            }),
        );
    }
    Value::Object(kinds)
}

/// Pulled over applied plus pulled, for the proposals `of` selects among `names`.
fn pulled_rates(all: &[Proposal], names: &[&str], of: impl Fn(&Proposal) -> &str) -> Value {
    let mut rates = Map::new();
    for name in names {
        let decided: Vec<&Proposal> = all
            .iter()
            .filter(|p| of(p) == *name && (was_applied(p) || p.state == "pulled"))
            .collect();
        let pulled = decided.iter().filter(|p| p.state == "pulled").count() as u64;
        rates.insert((*name).to_owned(), rate(pulled, decided.len() as u64));
    }
    Value::Object(rates)
}

/// The applied duplicates: how often the kept idea was among what capture offered the folded
/// idea, and at which rank.
fn duplicates(cx: &Cx, call: &Call, all: &[Proposal]) -> Result<Value, HostError> {
    let mut ranks: BTreeMap<&str, u64> = RANKS.iter().map(|rank| (*rank, 0)).collect();
    let mut count = 0u64;
    let mut unreadable = 0u64;
    for p in all
        .iter()
        .filter(|p| p.decide == "duplicate" && was_applied(p))
    {
        count += 1;
        let (Some(idea), Some(keep)) = (p.idea.as_deref(), p.keep.as_deref()) else {
            unreadable += 1;
            continue;
        };
        let Some(first) = wording(cx, call, &wording_id(idea, 1))? else {
            unreadable += 1;
            continue;
        };
        if let Some(n) = ranks.get_mut(rank_band(&first.offered, keep)) {
            *n += 1;
        }
    }
    let offered = count - unreadable - ranks["notOffered"];
    Ok(json!({
        "count": count,
        "offered": offered,
        "offeredRate": rate(offered, count - unreadable),
        "ranks": ranks,
        "unreadable": unreadable,
    }))
}

/// The applied rewords: count, median change in length, the share that split a statement's
/// sentences, the most frequent reasons, and with `examples` up to 20 pairs (the caller fits
/// them to the budget).
fn rewords(cx: &Cx, call: &Call, all: &[Proposal]) -> Result<(Value, Vec<Value>), HostError> {
    let mut changes = Vec::new();
    let mut split = 0u64;
    let mut unreadable = 0u64;
    let mut pairs = Vec::new();
    let mut reasons: BTreeMap<String, (u64, BTreeSet<String>)> = BTreeMap::new();
    let applied: Vec<&Proposal> = all
        .iter()
        .filter(|p| p.decide == "reword" && was_applied(p))
        .collect();
    for p in &applied {
        let reason = p.reason.trim().to_lowercase();
        let entry = reasons.entry(reason).or_default();
        entry.0 += 1;
        entry.1.extend(p.flags.iter().cloned());
        let new = p.statement.as_deref().unwrap_or_default();
        let old = match (p.idea.as_deref(), p.version) {
            (Some(idea), Some(n)) => wording(cx, call, &wording_id(idea, n))?,
            _ => None,
        };
        let Some(old) = old else {
            unreadable += 1;
            continue;
        };
        let length = |text: &str| i64::try_from(text.chars().count()).unwrap_or(i64::MAX);
        changes.push(length(new) - length(&old.statement));
        if sentences(new) > sentences(&old.statement) {
            split += 1;
        }
        if pairs.len() < EXAMPLES_MAX {
            pairs.push(json!({
                "proposal": p.id,
                "old": old.statement,
                "new": new,
                "flags": p.flags,
            }));
        }
    }
    let mut common: Vec<(String, u64, BTreeSet<String>)> = reasons
        .into_iter()
        .map(|(reason, (count, flags))| (reason, count, flags))
        .collect();
    common.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    common.truncate(TOP_REASONS);
    let read = applied.len() as u64 - unreadable;
    Ok((
        json!({
            "count": applied.len(),
            "medianLengthChange": median(&mut changes),
            "splitRate": rate(split, read),
            "unreadable": unreadable,
            "reasons": common
                .into_iter()
                .map(|(reason, count, flags)| json!({ "reason": reason, "count": count, "flags": flags }))
                .collect::<Vec<_>>(),
        }),
        pairs,
    ))
}

/// Undone over applied, for each decision.
fn undone(all: &[Proposal]) -> Value {
    let mut rates = Map::new();
    for decide in DECIDES {
        let applied: Vec<&Proposal> = all
            .iter()
            .filter(|p| p.decide == decide && was_applied(p))
            .collect();
        let undone = applied.iter().filter(|p| p.state == "undone").count() as u64;
        rates.insert(decide.to_owned(), rate(undone, applied.len() as u64));
    }
    Value::Object(rates)
}

/// `ideas-review-report`.
pub(crate) fn run(input: &Value, cx: &Cx, call: &Call) -> Result<Outcome, Outcome> {
    let host = |error: HostError| fail::host(&error);
    let pack = Pack::read(cx)?;
    let examples = input::boolean(input, "examples")?.unwrap_or(false);
    let all: Vec<Proposal> = proposals(&find_all(cx, call, PROPOSAL, Vec::new()).map_err(host)?)
        .into_iter()
        .map(|stored| stored.proposal)
        .collect();
    let applied = all.iter().filter(|p| was_applied(p)).count() as u64;
    let pulled = all.iter().filter(|p| p.state == "pulled").count() as u64;
    let decisions = applied + pulled;
    let count_applied = |decide: &str| {
        all.iter()
            .filter(|p| p.decide == decide && was_applied(p))
            .count() as u64
    };
    let declined = count_applied("decline");
    let judged = count_applied("affirm") + declined + count_applied("reword");
    let duplicates = duplicates(cx, call, &all).map_err(host)?;
    let (rewords, pairs) = rewords(cx, call, &all).map_err(host)?;
    let pending = pending(cx, call).map_err(host)?;
    let report = json!({
        "proposals": all.len(),
        "decisions": decisions,
        "applied": applied,
        "pulled": pulled,
        "ready": decisions >= pack.limits.report_min,
        "readyAt": pack.limits.report_min,
        "byKind": by_kind(&all),
        "declineRate": rate(declined, judged),
        "pulledRate": {
            "all": rate(pulled, decisions),
            "byDecide": pulled_rates(&all, &DECIDES, |p| p.decide.as_str()),
            "byConfidence": pulled_rates(&all, &CONFIDENCES, |p| p.confidence.as_str()),
        },
        "duplicates": duplicates,
        "undone": undone(&all),
        "pending": pending,
    });
    // With `examples`, as many pairs as fit the call's output budget (C1-20's pattern).
    let total = if examples { pairs.len() } else { 0 };
    let build = |kept: usize| {
        let mut rewords = rewords.clone();
        rewords["examples"] = if examples {
            Value::from(pairs[..kept].to_vec())
        } else {
            Value::Null
        };
        let mut report = report.clone();
        report["rewords"] = rewords;
        budget::limited(success(report), total - kept, "examples")
    };
    Ok(budget::fit_count(total, cx.call().output_budget, build).1)
}

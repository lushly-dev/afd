//! `ideas-match` (specification, section 7.2), and the candidates capture offers (7.1, section 6).
//!
//! A candidate is a `MatchHit` (`store/src/lane.rs:693`) serialised with the idea and `n` read from
//! its id, the hit's `text` as `statement`, `type` and `said` read from the hit's record, the
//! host's label unchanged, and the plugin's band. `identical` hits come first, then `nearest`.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Value, json};
use umbel_sdk::{Cx, HostError, Outcome, success};
use umbel_store::lane::{MAX_MATCH_K, MatchHit, MatchPage, MatchResult, RecordMatch};

use crate::bands::{Reading, band, meaning_name, reading};
use crate::label::pass;
use crate::pack::{MAX_CANDIDATES_CEILING, Pack};
use crate::pending::{key, pending};
use crate::records::{IDEA_PREFIX, WORDING, Wording, read, read_idea, split_wording_id};
use crate::{Call, budget, fail, ids, input};

/// The most statements and ids one `ideas-match` takes together.
const MAX_INPUTS: usize = 64;

/// The match capture and `ideas-match` run (6.1): held and declined wordings, `k` nearest, no
/// standing filter unless `verified_only`.
pub(crate) fn query(texts: Vec<String>, k: u64, verified_only: bool) -> RecordMatch {
    RecordMatch {
        kind: WORDING.to_owned(),
        texts,
        // One more than asked: a text's own idea, or one captured in the same call, is dropped
        // after the host answers, and the rest still fill `k`.
        k: u32::try_from(k + 1).unwrap_or(MAX_MATCH_K).min(MAX_MATCH_K),
        keys: vec![key("/role", &["held", "declined"])],
        standings: Vec::new(),
        verified_only,
        exclude: Vec::new(),
    }
}

/// The type, `said` and role of each hit's wording, read once per id.
pub(crate) struct HitBodies {
    found: BTreeMap<String, Option<Wording>>,
}

impl HitBodies {
    pub(crate) fn new() -> Self {
        Self {
            found: BTreeMap::new(),
        }
    }

    fn get(&mut self, cx: &Cx, call: &Call, id: &str) -> Result<Option<&Wording>, HostError> {
        if !self.found.contains_key(id) {
            let wording =
                read(cx, call, WORDING, id)?.and_then(|record| Wording::parse(&record.record.body));
            self.found.insert(id.to_owned(), wording);
        }
        Ok(self.found.get(id).and_then(Option::as_ref))
    }
}

/// One candidate's JSON, or `None` for a hit whose record is no longer readable.
fn candidate(
    cx: &Cx,
    call: &Call,
    bodies: &mut HitBodies,
    hit: &MatchHit,
    identical: bool,
    reading: Reading<'_>,
) -> Result<Option<Value>, HostError> {
    let Some((idea, n)) = split_wording_id(&hit.id) else {
        return Ok(None);
    };
    let idea = idea.to_owned();
    let Some(wording) = bodies.get(cx, call, &hit.id)? else {
        return Ok(None);
    };
    let (standing, label) = pass(hit.label.as_ref());
    let score = if reading.on == "fused" {
        hit.fused
    } else {
        hit.words
    };
    let band = if identical {
        "identical"
    } else {
        score.map_or("distant", |score| band(reading.bands, score))
    };
    Ok(Some(json!({
        "id": idea,
        "version": n,
        "statement": hit.text,
        "type": wording.kind,
        "said": wording.said,
        "declined": wording.role == "declined",
        "standing": standing,
        "label": label,
        "flags": fail::flag_names(&hit.flags),
        "identical": identical,
        "words": hit.words,
        "meaning": hit.meaning,
        "fused": hit.fused,
        "band": band,
    })))
}

/// The candidates of one result: identical hits first, then nearest, without the ideas in
/// `drop`, each idea once, at most `k` nearest.
pub(crate) fn candidates(
    cx: &Cx,
    call: &Call,
    bodies: &mut HitBodies,
    result: &MatchResult,
    drop: &BTreeSet<String>,
    k: u64,
    reading: Reading<'_>,
) -> Result<Vec<Value>, HostError> {
    let mut out = Vec::new();
    let mut shown: BTreeSet<String> = BTreeSet::new();
    let idea_of = |hit: &MatchHit| split_wording_id(&hit.id).map(|(idea, _)| idea.to_owned());
    for hit in &result.identical {
        let Some(idea) = idea_of(hit) else { continue };
        if drop.contains(&idea) || shown.contains(&idea) {
            continue;
        }
        if let Some(value) = candidate(cx, call, bodies, hit, true, reading)? {
            shown.insert(idea);
            out.push(value);
        }
    }
    let mut nearest = 0;
    for hit in &result.nearest {
        if nearest as u64 >= k {
            break;
        }
        let Some(idea) = idea_of(hit) else { continue };
        if drop.contains(&idea) || shown.contains(&idea) {
            continue;
        }
        if let Some(value) = candidate(cx, call, bodies, hit, false, reading)? {
            shown.insert(idea);
            out.push(value);
            nearest += 1;
        }
    }
    Ok(out)
}

/// `k`: 1 to the pack's `max_candidates`, default its `candidates`.
pub(crate) fn k_of(input: &Value, pack: &Pack) -> Result<u64, Outcome> {
    Ok(input::integer(
        input,
        "k",
        1,
        pack.matching.max_candidates.min(MAX_CANDIDATES_CEILING),
    )?
    .unwrap_or(pack.matching.candidates))
}

/// `ideas-match`.
pub(crate) fn run(input: &Value, cx: &Cx, call: &Call) -> Result<Outcome, Outcome> {
    let pack = Pack::read(cx)?;
    let statements = input::strings(input, "statements")?.unwrap_or_default();
    let idea_ids = input::strings(input, "ids")?.unwrap_or_default();
    let k = k_of(input, &pack)?;
    let verified_only = input::boolean(input, "verifiedOnly")?.unwrap_or(false);
    let total = statements.len() + idea_ids.len();
    if total == 0 || total > MAX_INPUTS {
        return Err(fail::invalid(
            "statements",
            "and ids together must hold 1 to 64 entries",
        ));
    }
    for (index, statement) in statements.iter().enumerate() {
        if statement.is_empty()
            || statement.chars().count() as u64 > pack.limits.statement_chars
            || !input::one_line(statement)
        {
            return Err(fail::invalid_item(
                "statements",
                index,
                "statement",
                &format!(
                    "must be 1 to {} characters on one line",
                    pack.limits.statement_chars
                ),
            ));
        }
    }
    // Each id's held wording is its text.
    let mut texts = statements.clone();
    let mut missing = Vec::new();
    for id in &idea_ids {
        let held = if ids::is_id(id, IDEA_PREFIX) {
            read_idea(cx, call, id)
                .map_err(|error| fail::host(&error))?
                .map(|stored| stored.idea.held_id())
        } else {
            None
        };
        let statement = match held {
            Some(held) => read(cx, call, WORDING, &held)
                .map_err(|error| fail::host(&error))?
                .and_then(|record| Wording::parse(&record.record.body))
                .map(|wording| wording.statement),
            None => None,
        };
        match statement {
            Some(statement) => texts.push(statement),
            None => missing.push(id.clone()),
        }
    }
    if !missing.is_empty() {
        return Err(fail::not_found(&missing));
    }
    let page: MatchPage = cx
        .record_match(&call.space, &query(texts, k, verified_only))
        .map_err(|error| fail::host(&error))?;
    let reading = reading(&pack.matching, &page.meaning);
    let mut bodies = HitBodies::new();
    let mut results = Vec::new();
    let mut flagged = 0;
    let mut cut = false;
    for (index, result) in page.results.iter().enumerate() {
        cut |= result.cut;
        let (subject, drop) = if index < statements.len() {
            (json!({ "statement": statements[index] }), BTreeSet::new())
        } else {
            let id = idea_ids[index - statements.len()].clone();
            (json!({ "id": id }), BTreeSet::from([id]))
        };
        let found = candidates(cx, call, &mut bodies, result, &drop, k, reading)
            .map_err(|error| fail::host(&error))?;
        flagged += found
            .iter()
            .filter(|c| c["flags"].as_array().is_some_and(|f| !f.is_empty()))
            .count();
        let mut entry = subject;
        entry["candidates"] = Value::from(found);
        results.push(entry);
    }
    let pending = pending(cx, call).map_err(|error| fail::host(&error))?;
    // Fitted to the budget by the most candidates each result keeps.
    let most = results
        .iter()
        .map(|r| r["candidates"].as_array().map_or(0, Vec::len))
        .max()
        .unwrap_or(0);
    let build = |each: usize| {
        let shown: Vec<Value> = results
            .iter()
            .map(|result| {
                let mut result = result.clone();
                if let Some(list) = result["candidates"].as_array_mut() {
                    list.truncate(each);
                }
                result
            })
            .collect();
        let omitted: usize = results
            .iter()
            .map(|r| {
                r["candidates"]
                    .as_array()
                    .map_or(0, |l| l.len().saturating_sub(each))
            })
            .sum();
        budget::limited(
            fail::warn_flagged(
                success(json!({
                    "results": shown,
                    "meaning": meaning_name(&page.meaning),
                    "bandsOn": reading.on,
                    "cut": cut,
                    "admitted": page.admitted,
                    "pending": pending,
                })),
                flagged,
            ),
            omitted,
            "candidates",
        )
    };
    Ok(budget::fit_count(most, cx.call().output_budget, build).1)
}

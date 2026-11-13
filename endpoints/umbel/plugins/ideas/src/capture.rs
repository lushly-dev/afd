//! `ideas-capture` (specification, section 7.1): many ideas in one call, each matched against
//! what is held, and none refused for what it matched.
//!
//! 1. Every item is checked; any fault refuses the call and writes nothing.
//! 2. Items with the same match digest are one: the first is captured, the rest are sightings.
//! 3. One `record_match` of every distinct statement; a failed match captures without candidates.
//! 4. An item identical to a wording of a live or declined idea is a sighting of that idea.
//! 5. Every other item becomes an idea and its first wording, held.
//!
//! With `idempotencyKey` the ids are derived from the key (4.5): a call sent again finds what
//! the first wrote, completes what it did not, and answers the whole, marked `replayed`.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Value, json};
use umbel_sdk::{Cx, HostError, Level, Outcome, success};
use umbel_store::Expect;
use umbel_store::lane::{MatchPage, match_digest};

use crate::bands::{meaning_name, reading};
use crate::label::pass;
use crate::match_::{HitBodies, candidates, k_of, query};
use crate::pack::Pack;
use crate::pending::pending;
use crate::records::{
    IDEA, IDEA_PREFIX, Idea, SEEN_MAX, StoredIdea, WORDING, Wording, now, origin_of, put,
    put_absent, read, read_idea, split_wording_id, wording_id,
};
use crate::{Call, fail, ids, input};

/// The most tags of a wording.
pub(crate) const MAX_TAGS: usize = 8;
/// The most candidates a wording keeps in `offered`.
const OFFERED_MAX: usize = 10;
/// The most times a sighting's compare-and-set write is tried.
const CAS_TRIES: usize = 5;

/// One checked item.
#[derive(Debug, Clone)]
struct Item {
    statement: String,
    kind: String,
    tags: Vec<String>,
    said: String,
    digest: [u8; 32],
}

/// Whether `tag` matches `^[a-z0-9][a-z0-9-]{0,39}$`.
pub(crate) fn is_tag(tag: &str) -> bool {
    let mut chars = tag.chars();
    chars
        .next()
        .is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        && tag.len() <= 40
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// Check a statement under 4.1's rule.
pub(crate) fn statement_ok(statement: &str, pack: &Pack) -> bool {
    let chars = statement.chars().count() as u64;
    chars >= 1
        && chars <= pack.limits.statement_chars
        && input::one_line(statement)
        && match_digest(statement).is_some()
}

fn check_items(input: &Value, pack: &Pack) -> Result<Vec<Item>, Outcome> {
    let Some(list) = input.get("ideas").and_then(Value::as_array) else {
        return Err(fail::invalid("ideas", "must be an array of ideas"));
    };
    if list.is_empty() || list.len() as u64 > pack.limits.capture_max {
        return Err(fail::invalid(
            "ideas",
            &format!("must hold 1 to {} ideas", pack.limits.capture_max),
        ));
    }
    let mut items = Vec::with_capacity(list.len());
    for (index, item) in list.iter().enumerate() {
        let statement = item.get("statement").and_then(Value::as_str).unwrap_or("");
        if !statement_ok(statement, pack) {
            return Err(fail::invalid_item(
                "ideas",
                index,
                "statement",
                &format!(
                    "must be 1 to {} characters on one line, with a word in it",
                    pack.limits.statement_chars
                ),
            ));
        }
        let kind = item.get("type").and_then(Value::as_str).unwrap_or("");
        if !pack.has_type(kind) {
            return Err(
                fail::invalid_type(&format!("ideas[{index}].type"), &pack.type_names())
                    .with_error_details(json!({
                        "field": format!("ideas[{index}].type"),
                        "index": index,
                        "valid": pack.type_names(),
                    })),
            );
        }
        let mut tags: Vec<String> = match item.get("tags") {
            None | Some(Value::Null) => Vec::new(),
            Some(Value::Array(tags)) => tags
                .iter()
                .map(|tag| tag.as_str().map(str::to_owned))
                .collect::<Option<Vec<_>>>()
                .ok_or_else(|| {
                    fail::invalid_item("ideas", index, "tags", "must hold strings only")
                })?,
            Some(_) => {
                return Err(fail::invalid_item(
                    "ideas",
                    index,
                    "tags",
                    "must be an array",
                ));
            }
        };
        tags.sort();
        tags.dedup();
        if tags.len() > MAX_TAGS || !tags.iter().all(|tag| is_tag(tag)) {
            return Err(fail::invalid_item(
                "ideas",
                index,
                "tags",
                "must hold 0 to 8 tags, each matching ^[a-z0-9][a-z0-9-]{0,39}$",
            ));
        }
        let said = match item.get("said") {
            None | Some(Value::Null) => "unknown",
            Some(Value::String(said))
                if matches!(said.as_str(), "person" | "agent" | "unknown") =>
            {
                said
            }
            Some(_) => {
                return Err(fail::invalid_item(
                    "ideas",
                    index,
                    "said",
                    "must be person, agent or unknown",
                )
                .with_error_details(json!({
                    "field": format!("ideas[{index}].said"),
                    "index": index,
                    "valid": ["person", "agent", "unknown"],
                })));
            }
        };
        items.push(Item {
            statement: statement.to_owned(),
            kind: kind.to_owned(),
            tags,
            said: said.to_owned(),
            // `statement_ok` holds that it has one.
            digest: match_digest(statement).unwrap_or_default(),
        });
    }
    Ok(items)
}

/// How a distinct item ended.
#[derive(Debug, Clone)]
enum Ended {
    /// Captured now, or by the first call of a replay.
    Captured { idea: String, replayed: bool },
    /// A sighting of an idea held before the call.
    Sighting {
        idea: String,
        version: u64,
        declined: bool,
        standing: Value,
        label: Value,
        replayed: bool,
    },
}

/// Record `count` sightings on an idea, with the key's digest, by compare-and-set.
fn record_sightings(
    cx: &Cx,
    call: &Call,
    mut stored: StoredIdea,
    count: u64,
    digest: Option<&str>,
    observed_at: &str,
) -> Result<(), HostError> {
    for _ in 0..CAS_TRIES {
        let mut idea = stored.idea.clone();
        idea.sightings += count;
        if let Some(digest) = digest {
            idea.seen.push(digest.to_owned());
            if idea.seen.len() > SEEN_MAX {
                let extra = idea.seen.len() - SEEN_MAX;
                idea.seen.drain(..extra);
            }
        }
        match put(
            cx,
            call,
            IDEA,
            &idea.id,
            idea.to_json(),
            Expect::Hash(stored.hash.clone()),
            origin_of("agent"),
            observed_at,
        ) {
            Ok(_) => return Ok(()),
            Err(HostError::Conflict { .. }) => {
                match read_idea(cx, call, &stored.idea.id)? {
                    Some(again) => stored = again,
                    None => return Ok(()),
                }
                if digest.is_some_and(|digest| stored.idea.seen.iter().any(|seen| seen == digest)) {
                    return Ok(());
                }
            }
            Err(error) => return Err(error),
        }
    }
    Err(HostError::Conflict { current: None })
}

/// `offered`: the candidates the capture returned, at most 10.
fn offered(found: &[Value]) -> Value {
    Value::from(
        found
            .iter()
            .take(OFFERED_MAX)
            .enumerate()
            .map(|(rank, candidate)| {
                json!({
                    "idea": candidate["id"],
                    "n": candidate["version"],
                    "words": candidate["words"],
                    "fused": candidate["fused"],
                    "band": candidate["band"],
                    "rank": rank + 1,
                })
            })
            .collect::<Vec<_>>(),
    )
}

/// `ideas-capture`.
pub(crate) fn run(input: &Value, cx: &Cx, call: &Call) -> Result<Outcome, Outcome> {
    let pack = Pack::read(cx)?;
    let items = check_items(input, &pack)?;
    let key = ids::check_key(input::string(input, "idempotencyKey")?)?;
    let k = k_of(input, &pack)?;
    let observed_at = now(cx)?;
    let host = |error: HostError| fail::host(&error);

    // 2. Items with the same match digest are one.
    let mut first_of: BTreeMap<[u8; 32], usize> = BTreeMap::new();
    let mut group: Vec<usize> = Vec::with_capacity(items.len());
    for (index, item) in items.iter().enumerate() {
        group.push(*first_of.entry(item.digest).or_insert(index));
    }
    let distinct: Vec<usize> = (0..items.len()).filter(|i| group[*i] == *i).collect();
    let size = |first: usize| group.iter().filter(|g| **g == first).count() as u64;

    // The ideas this call would write: derived from the key, or drawn.
    let mut own: BTreeMap<usize, String> = BTreeMap::new();
    for &index in &distinct {
        let hex = match key {
            Some(key) => ids::derived(call, key, index),
            None => ids::drawn(cx)?,
        };
        own.insert(index, format!("{IDEA_PREFIX}{hex}"));
    }
    let drop: BTreeSet<String> = own.values().cloned().collect();
    let digest = key.map(|key| ids::key_digest(call, key));

    // 3. One match of every distinct statement.
    let texts = distinct
        .iter()
        .map(|i| items[*i].statement.clone())
        .collect();
    let matched: Result<MatchPage, HostError> =
        cx.record_match(&call.space, &query(texts, k, false));
    let reading = reading(
        &pack.matching,
        &matched
            .as_ref()
            .map_or(umbel_store::lane::MeaningState::Off, |page| {
                page.meaning.clone()
            }),
    );
    let mut bodies = HitBodies::new();
    let mut found: BTreeMap<usize, Option<Vec<Value>>> = BTreeMap::new();
    for (position, &index) in distinct.iter().enumerate() {
        let list = match &matched {
            Ok(page) => match page.results.get(position) {
                Some(result) => Some(
                    candidates(cx, call, &mut bodies, result, &drop, k, reading).map_err(host)?,
                ),
                None => None,
            },
            Err(_) => None,
        };
        found.insert(index, list);
    }

    // A key sent again with other statements is not a replay: refused before anything is
    // written, so the new statements are not lost behind the first call's answer.
    if key.is_some() {
        for &index in &distinct {
            let stored = read(cx, call, WORDING, &wording_id(&own[&index], 1)).map_err(host)?;
            let first = stored
                .and_then(|record| Wording::parse(&record.record.body))
                .and_then(|wording| match_digest(&wording.statement));
            if first.is_some_and(|first| first != items[index].digest) {
                return Err(fail::key_reused(index));
            }
        }
    }

    // 4 and 5, in input order.
    let mut ended: BTreeMap<usize, Ended> = BTreeMap::new();
    for (position, &index) in distinct.iter().enumerate() {
        let item = &items[index];
        let idea_id = own[&index].clone();
        // A replay: the first call captured this item.
        if key.is_some() && read_idea(cx, call, &idea_id).map_err(host)?.is_some() {
            {
                let wording = wording_id(&idea_id, 1);
                if read(cx, call, WORDING, &wording).map_err(host)?.is_none() {
                    write_wording(
                        cx,
                        call,
                        item,
                        &idea_id,
                        found[&index].as_deref(),
                        &observed_at,
                    )
                    .map_err(host)?;
                }
                ended.insert(
                    index,
                    Ended::Captured {
                        idea: idea_id,
                        replayed: true,
                    },
                );
                continue;
            }
        }
        // A sighting of an idea held before the call.
        let identical = matched
            .as_ref()
            .ok()
            .and_then(|page| page.results.get(position))
            .map(|result| result.identical.clone())
            .unwrap_or_default();
        let mut sighted = None;
        for hit in &identical {
            let Some((other, _)) = split_wording_id(&hit.id) else {
                continue;
            };
            if drop.contains(other) {
                continue;
            }
            let Some(stored) = read_idea(cx, call, other).map_err(host)? else {
                continue;
            };
            if matches!(stored.idea.state.as_str(), "live" | "declined") {
                sighted = Some((stored, hit.clone()));
                break;
            }
        }
        if let Some((stored, hit)) = sighted {
            let replayed = digest
                .as_deref()
                .is_some_and(|digest| stored.idea.seen.iter().any(|seen| seen == digest));
            let idea = stored.idea.id.clone();
            let version = stored.idea.held;
            let declined = stored.idea.state == "declined";
            if !replayed {
                record_sightings(
                    cx,
                    call,
                    stored,
                    size(index),
                    digest.as_deref(),
                    &observed_at,
                )
                .map_err(host)?;
            }
            let (standing, label) = pass(hit.label.as_ref());
            ended.insert(
                index,
                Ended::Sighting {
                    idea,
                    version,
                    declined,
                    standing,
                    label,
                    replayed,
                },
            );
            continue;
        }
        // A new idea and its first wording.
        let idea = Idea::new(&idea_id, size(index), &observed_at);
        let wrote = put_absent(
            cx,
            call,
            IDEA,
            &idea_id,
            idea.to_json(),
            origin_of(&item.said),
            &observed_at,
        )
        .map_err(host)?;
        write_wording(
            cx,
            call,
            item,
            &idea_id,
            found[&index].as_deref(),
            &observed_at,
        )
        .map_err(host)?;
        ended.insert(
            index,
            Ended::Captured {
                idea: idea_id,
                // A keyed put that met its own id was written by a call sent at the same time.
                replayed: !wrote && key.is_some(),
            },
        );
    }

    // The answer, one entry an item.
    let mut ideas_out = Vec::with_capacity(items.len());
    let (mut captured, mut sightings, mut replayed, mut flagged) = (0u64, 0u64, false, 0usize);
    let mut labels: BTreeMap<String, (Value, Value, Value)> = BTreeMap::new();
    for (index, _) in items.iter().enumerate() {
        let first = group[index];
        let entry = match &ended[&first] {
            Ended::Captured {
                idea,
                replayed: again,
            } => {
                replayed |= *again;
                if !labels.contains_key(idea) {
                    let record = read(cx, call, WORDING, &wording_id(idea, 1)).map_err(host)?;
                    let (standing, label) = pass(record.as_ref().and_then(|r| r.label.as_ref()));
                    let flags = record
                        .as_ref()
                        .map_or(json!([]), |r| fail::flag_names(&r.flags));
                    labels.insert(idea.clone(), (standing, label, flags));
                }
                let (standing, label, flags) = labels[idea].clone();
                if first == index {
                    captured += 1;
                    if flags.as_array().is_some_and(|f| !f.is_empty()) {
                        flagged += 1;
                    }
                    let list = found[&first].clone();
                    if let Some(list) = &list {
                        flagged += list
                            .iter()
                            .filter(|c| c["flags"].as_array().is_some_and(|f| !f.is_empty()))
                            .count();
                    }
                    json!({
                        "id": idea,
                        "version": 1,
                        "outcome": if *again { "replayed" } else { "captured" },
                        "standing": standing,
                        "label": label,
                        "flags": flags,
                        "candidates": list,
                    })
                } else {
                    sightings += 1;
                    json!({
                        "id": idea,
                        "version": 1,
                        "outcome": if *again { "replayed" } else { "sighting" },
                        "standing": standing,
                        "label": label,
                        "identical": true,
                        "declined": false,
                    })
                }
            }
            Ended::Sighting {
                idea,
                version,
                declined,
                standing,
                label,
                replayed: again,
            } => {
                replayed |= *again;
                sightings += 1;
                json!({
                    "id": idea,
                    "version": version,
                    "outcome": if *again { "replayed" } else { "sighting" },
                    "standing": standing,
                    "label": label,
                    "identical": true,
                    "declined": declined,
                })
            }
        };
        ideas_out.push(entry);
    }
    cx.log(
        Level::Info,
        &format!(
            "ideas-capture: {captured} captured, {sightings} sighting(s), replayed {replayed}"
        ),
    );
    let pending = pending(cx, call).map_err(host)?;
    let mut outcome = success(json!({
        "captured": captured,
        "sightings": sightings,
        "replayed": replayed,
        "meaning": matched.as_ref().map_or("off".to_owned(), |page| meaning_name(&page.meaning)),
        "bandsOn": reading.on,
        "ideas": ideas_out,
        "pending": pending,
    }));
    if let Err(error) = &matched {
        outcome = fail::warn_match_unavailable(outcome, error);
    }
    Ok(fail::warn_flagged(outcome, flagged))
}

/// Put an item's first wording, held, with what the capture offered.
fn write_wording(
    cx: &Cx,
    call: &Call,
    item: &Item,
    idea: &str,
    found: Option<&[Value]>,
    observed_at: &str,
) -> Result<(), HostError> {
    let wording = Wording {
        idea: idea.to_owned(),
        n: 1,
        statement: item.statement.clone(),
        kind: item.kind.clone(),
        tags: item.tags.clone(),
        role: "held".to_owned(),
        said: item.said.clone(),
        captured_at: observed_at.to_owned(),
        offered: found.map_or_else(|| json!([]), offered),
        proposal: None,
    };
    put_absent(
        cx,
        call,
        WORDING,
        &wording_id(idea, 1),
        wording.to_json(),
        origin_of(&item.said),
        observed_at,
    )
    .map(drop)
}

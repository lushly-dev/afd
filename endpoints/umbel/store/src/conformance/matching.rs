//! Group `matching`: for each text, the records whose match field is identical and the nearest
//! ones by words, with their scores (records host specification, sections 8 and 15.1; D165).
//! Words only: meaning and `fused` beyond `words` join with the step that serves vectors.
//!
//! Every case reaches the backend through [`DocumentStore::match_records`] and the lane's other
//! methods alone; a backend without a record lane skips the group, as it skips `lane`. The
//! expected scores are of two kinds. The fixture's are fixed figures, computed apart from this
//! crate, and hold to four places. The others come from [`by_the_formulas`], section 8.2 read
//! over records held in memory, so a case can say what a reader's own records give and show
//! that counting any other record would give something else.
//!
//! What the cases hold above all: **a record its reader may not read, or its call does not
//! admit or excludes, changes no score, no order, no list and no `cut`**. The one refusal for
//! size is the kind's: past its bound on postings, every match of the kind is refused alike,
//! whoever asks what, so a refusal says nothing of which records hold a word. Every text is
//! invented and about gardening.

use std::collections::BTreeMap;
use std::fmt::Write as _;

use serde_json::{Value, json};

use super::lane::{AT, NO_LANE, NS, lane, no_scan, pointer, writer};
use super::{
    CaseResult, Ctx, Env, SPACE, ensure, ensure_eq, everyone, expect_err, invalid, pass, reader,
    samples, skip,
};
use crate::lane::score::{Corpus, Posting, directed, round4, score, words};
use crate::lane::{
    FindOrder, KeyFilter, LaneLimits, LaneWrite, MATCH_POOL, MAX_IDENTICAL, MAX_LANE_TEXT_BYTES,
    MAX_MATCH_EXCLUDE, MAX_MATCH_K, MAX_MATCH_TEXTS, MatchHit, MatchPage, MatchResult,
    MatchVectors, MeaningState, RecordDecl, RecordFind, RecordMatch, Standing, StandingView,
    TextQuery, match_digest,
};
use crate::memory::tokenizer::tokens;
use crate::{DocumentStore, Expect, ModelId, ReaderFilter, StoreError, canonical_json};

pub(super) const CASES: &[(&str, super::CaseFn)] = &[
    (
        "identical_under_whitespace_case_and_width_by_id_at_most_eight",
        identical_texts,
    ),
    (
        "the_words_score_of_every_fixture_pair_holds_to_four_places_in_both_orders_of_put",
        fixture_scores,
    ),
    (
        "an_empty_lane_and_a_text_with_no_token_match_nothing_near",
        empty_and_tokenless,
    ),
    (
        "exclude_leaves_a_record_out_of_both_lists_and_out_of_the_statistics",
        excluded,
    ),
    (
        "counts_are_the_same_whether_one_text_or_sixty_four_are_matched",
        one_or_many,
    ),
    (
        "key_filters_narrow_the_candidates_and_never_the_statistics",
        key_filters,
    ),
    (
        "past_its_bound_every_match_and_ranked_find_of_a_kind_is_refused_alike",
        too_broad,
    ),
    (
        "a_refusal_says_nothing_of_which_records_hold_a_word",
        refusal_holds_no_word,
    ),
    (
        "cut_only_when_the_rarest_terms_postings_pass_the_bound_after_every_clause",
        cut,
    ),
    (
        "the_pool_keeps_sixty_four_and_k_cuts_the_nearest",
        pool_and_k,
    ),
    ("ties_are_broken_by_id_in_byte_order", ties),
    (
        "a_match_refuses_what_breaks_its_rules_and_a_stale_kind",
        refusals,
    ),
    (
        "a_reader_never_sees_a_record_it_may_not_read_in_a_match",
        unreadable_never_matched,
    ),
    (
        "a_matchs_statistics_count_only_what_its_reader_may_read",
        statistics_are_the_readers,
    ),
    (
        "records_a_reader_cannot_read_change_no_match_of_its_own",
        differential,
    ),
];

const FIXTURE: &str = include_str!("../../fixtures/lane/records.json");
const ROSES: &str = "Prune roses in late winter, before the buds swell.";

/// A kind `note` without standing: a statement, matched, a second text and two keys.
fn decl() -> Result<RecordDecl, String> {
    Ok(RecordDecl {
        kind: "note".to_owned(),
        standing: false,
        text: vec![pointer("/statement")?, pointer("/why")?],
        keys: vec![pointer("/bed")?, pointer("/tags")?],
        matched: Some(0),
    })
}

/// The same declaration under another kind: a second lane in the same store.
fn other(decl: &RecordDecl, kind: &str) -> RecordDecl {
    RecordDecl {
        kind: kind.to_owned(),
        ..decl.clone()
    }
}

/// A view that admits every standing: what the host builds for a call that asks for all.
fn view() -> StandingView {
    StandingView {
        own: Vec::new(),
        command_writable: Vec::new(),
        person: Vec::new(),
        admit: vec![Standing::Unverified, Standing::Attested, Standing::Affirmed],
        levels: Vec::new(),
    }
}

fn put(
    d: &dyn DocumentStore,
    decl: &RecordDecl,
    id: &str,
    body: Value,
    access: &[&str],
) -> Result<(), String> {
    d.put_declared_record(
        NS,
        decl,
        id,
        body,
        samples::envelope(access, "match", AT),
        Expect::Any,
        LaneWrite {
            evidence: None,
            flags: Vec::new(),
            model: None,
        },
        &writer(),
    )
    .map(drop)
    .ctx("a put")
}

/// A body with a statement and a bed.
fn note(statement: &str, bed: &str) -> Value {
    json!({ "statement": statement, "bed": bed })
}

/// A match of `texts` against the kind, asking for the 20 nearest of each.
fn asking(decl: &RecordDecl, texts: &[&str]) -> RecordMatch {
    RecordMatch {
        kind: decl.kind.clone(),
        texts: texts.iter().map(|text| (*text).to_owned()).collect(),
        k: MAX_MATCH_K,
        keys: Vec::new(),
        standings: Vec::new(),
        verified_only: false,
        exclude: Vec::new(),
    }
}

fn owned(ids: &[&str]) -> Vec<String> {
    ids.iter().map(|id| (*id).to_owned()).collect()
}

fn run(
    d: &dyn DocumentStore,
    decl: &RecordDecl,
    query: &RecordMatch,
    who: &ReaderFilter,
) -> Result<MatchPage, String> {
    let page = d
        .match_records(NS, decl, query, None, &view(), who)
        .ctx("match_records")?;
    ensure_eq(
        page.results.len(),
        query.texts.len(),
        "a match answers one result a text, in order",
    )?;
    ensure_eq(
        &page.meaning,
        &MeaningState::Off,
        "a match without vectors says meaning is off",
    )?;
    for result in &page.results {
        ensure(
            result.identical.len() <= MAX_IDENTICAL,
            "a text has at most eight identical records",
        )?;
        ensure(
            result.nearest.len() <= query.k as usize,
            "a text has at most k nearest records",
        )?;
        for hit in &result.identical {
            ensure(
                hit.words.is_none() && hit.meaning.is_none() && hit.fused.is_none(),
                "an identical hit carries no score",
            )?;
        }
        for hit in &result.nearest {
            let (Some(words), Some(fused)) = (hit.words, hit.fused) else {
                return Err("a nearest hit carries its words and fused scores".to_owned());
            };
            ensure(
                hit.meaning.is_none(),
                "with no meaning served a hit carries none",
            )?;
            ensure(
                words.to_bits() == fused.to_bits(),
                "with no meaning served fused equals words",
            )?;
            ensure(
                words.is_sign_positive() && words == round4(words),
                "a score is at four places and never negative zero",
            )?;
        }
    }
    Ok(page)
}

/// One text matched alone.
fn one(
    d: &dyn DocumentStore,
    decl: &RecordDecl,
    query: &RecordMatch,
    who: &ReaderFilter,
) -> Result<MatchResult, String> {
    run(d, decl, query, who)?
        .results
        .into_iter()
        .next()
        .ok_or_else(|| "a match of one text answers one result".to_owned())
}

fn ids(hits: &[MatchHit]) -> Vec<String> {
    hits.iter().map(|hit| hit.id.clone()).collect()
}

/// Each nearest record's id and its words score as printed at four places.
pub(super) fn near(result: &MatchResult) -> Vec<(String, String)> {
    result
        .nearest
        .iter()
        .map(|hit| (hit.id.clone(), format!("{:.4}", hit.words.unwrap_or(-1.0))))
        .collect()
}

/// A result as bytes: every member of every hit, scores at four places.
fn shown(result: &MatchResult) -> String {
    let hit = |hit: &MatchHit| {
        json!({
            "id": hit.id, "rev": hit.rev, "text": hit.text,
            "flags": hit.flags.iter().map(|flag| flag.as_str()).collect::<Vec<_>>(),
            "label": hit.label.as_ref().map(crate::lane::StandingLabel::to_json),
            "words": hit.words.map(|score| format!("{score:.4}")),
            "meaning": hit.meaning.map(|score| format!("{score:.4}")),
            "fused": hit.fused.map(|score| format!("{score:.4}")),
        })
    };
    canonical_json(&json!({
        "identical": result.identical.iter().map(hit).collect::<Vec<_>>(),
        "nearest": result.nearest.iter().map(hit).collect::<Vec<_>>(),
        "cut": result.cut,
    }))
}

/// A page as bytes.
fn page_shown(page: &MatchPage) -> String {
    let results: Vec<String> = page.results.iter().map(shown).collect();
    format!(
        "{} admitted {:?} meaning {:?}",
        results.join("\n"),
        page.admitted,
        page.meaning
    )
}

/// One text as the words score sees it.
struct Terms {
    counts: BTreeMap<String, u32>,
    length: u32,
}

impl Terms {
    fn of(text: &str) -> Self {
        let mut counts: BTreeMap<String, u32> = BTreeMap::new();
        let mut length = 0;
        for token in tokens(text) {
            *counts.entry(token).or_default() += 1;
            length += 1;
        }
        Self { counts, length }
    }
}

/// `score(Q, D)` over the corpus, with `Q`'s terms in byte order.
fn score_of(corpus: &Corpus, df: &BTreeMap<&str, u64>, query: &Terms, record: &Terms) -> f64 {
    score(
        corpus,
        record.length,
        query.counts.keys().filter_map(|term| {
            let tf = record.counts.get(term).copied()?;
            let df = df.get(term.as_str()).copied()?;
            Some(Posting { df, tf })
        }),
    )
}

/// What section 8.2 gives `text`, from the formulas alone: the candidates among `records` (id
/// and match text: the records that pass every clause, the key filters included), with the
/// statistics taken over `corpus` (the records its reader may read and its call admits, without
/// the excluded ones) plus the text itself. The candidates are the records that share a term
/// with the text; the pool is the `pool` of them with the highest `directed(q, d)` at four
/// places, ties by id; and the answer is the pool by `words` at four places descending, then by
/// id, cut to `k`: each id with its words score as printed.
pub(super) fn by_the_formulas(
    text: &str,
    records: &[(String, String)],
    corpus: &[(String, String)],
    pool: usize,
    k: usize,
) -> Vec<(String, String)> {
    let query = Terms::of(text);
    let held: Vec<Terms> = corpus.iter().map(|(_, text)| Terms::of(text)).collect();
    let statistics = Corpus {
        records: held.len() as u64 + 1,
        tokens: held
            .iter()
            .map(|terms| u64::from(terms.length))
            .sum::<u64>()
            + u64::from(query.length),
    };
    let mut df: BTreeMap<&str, u64> = BTreeMap::new();
    for terms in held.iter().chain([&query]) {
        for term in terms.counts.keys() {
            *df.entry(term.as_str()).or_default() += 1;
        }
    }
    let own = score_of(&statistics, &df, &query, &query);
    let mut pooled: Vec<(&str, Terms, f64)> = records
        .iter()
        .map(|(id, text)| (id.as_str(), Terms::of(text)))
        .filter(|(_, terms)| {
            query
                .counts
                .keys()
                .any(|term| terms.counts.contains_key(term))
        })
        .map(|(id, terms)| {
            let to_record = directed(score_of(&statistics, &df, &query, &terms), own);
            (id, terms, to_record)
        })
        .collect();
    pooled.sort_by(|a, b| {
        round4(b.2)
            .total_cmp(&round4(a.2))
            .then_with(|| a.0.as_bytes().cmp(b.0.as_bytes()))
    });
    pooled.truncate(pool);
    let mut scored: Vec<(&str, f64)> = pooled
        .iter()
        .map(|(id, terms, to_record)| {
            let to_query = directed(
                score_of(&statistics, &df, terms, &query),
                score_of(&statistics, &df, terms, terms),
            );
            (*id, round4(words(*to_record, to_query)))
        })
        .collect();
    scored.sort_by(|a, b| {
        b.1.total_cmp(&a.1)
            .then_with(|| a.0.as_bytes().cmp(b.0.as_bytes()))
    });
    scored.truncate(k);
    scored
        .into_iter()
        .map(|(id, words)| (id.to_owned(), format!("{words:.4}")))
        .collect()
}

/// [`by_the_formulas`] with the lane's pool and the most a call may ask for.
fn expected(
    text: &str,
    records: &[(String, String)],
    corpus: &[(String, String)],
) -> Vec<(String, String)> {
    by_the_formulas(text, records, corpus, MATCH_POOL, MAX_MATCH_K as usize)
}

fn pairs(records: &[(&str, &str)]) -> Vec<(String, String)> {
    records
        .iter()
        .map(|(id, text)| ((*id).to_owned(), (*text).to_owned()))
        .collect()
}

fn hex(digest: [u8; 32]) -> String {
    let mut out = String::new();
    for byte in digest {
        let _ = write!(out, "{byte:02x}");
    }
    out
}

/// The fixture: its declaration and its JSON.
fn fixture() -> Result<(RecordDecl, Value), String> {
    let fixture: Value = serde_json::from_str(FIXTURE)
        .map_err(|e| format!("the lane fixture does not parse: {e}"))?;
    let declared = &fixture["declaration"];
    let pointers = |member: &str| -> Result<Vec<crate::lane::Pointer>, String> {
        declared[member]
            .as_array()
            .ok_or("the declaration lists pointers")?
            .iter()
            .map(|value| pointer(value.as_str().unwrap_or_default()))
            .collect()
    };
    let text = pointers("text")?;
    let matched = declared["match"]
        .as_str()
        .and_then(|name| text.iter().position(|pointer| pointer.as_str() == name));
    let decl = RecordDecl {
        kind: declared["kind"].as_str().unwrap_or_default().to_owned(),
        standing: declared["standing"].as_bool().unwrap_or_default(),
        text,
        keys: pointers("keys")?,
        matched,
    };
    decl.check().ctx("the fixture's declaration")?;
    Ok((decl, fixture))
}

fn strings(value: &Value) -> Vec<&str> {
    value
        .as_array()
        .map(|items| items.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default()
}

/// Put the fixture's records, in the fixture's order or the reverse.
fn put_fixture(
    d: &dyn DocumentStore,
    decl: &RecordDecl,
    fixture: &Value,
    reversed: bool,
) -> Result<(), String> {
    let mut records: Vec<&Value> = fixture["records"]
        .as_array()
        .ok_or("the fixture has records")?
        .iter()
        .collect();
    if reversed {
        records.reverse();
    }
    for record in records {
        put(
            d,
            decl,
            record["id"].as_str().unwrap_or_default(),
            record["body"].clone(),
            &strings(&record["access"]),
        )?;
    }
    Ok(())
}

fn identical_texts(env: &Env<'_>) -> CaseResult {
    let Some((s, _)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let d = &*s.stores.documents;
    let (decl, fixture) = fixture()?;
    put_fixture(d, &decl, &fixture, false)?;
    let groups = fixture["identical"]
        .as_array()
        .ok_or("the fixture has identical texts")?;
    ensure(!groups.is_empty(), "the fixture has identical texts")?;
    for group in groups {
        let digest = group["digest"].as_str().unwrap_or_default();
        let texts = strings(&group["texts"]);
        ensure(texts.len() >= 2, "a group holds several spellings")?;
        // The records of the fixture whose match field has the group's digest.
        let same: Vec<String> = fixture["records"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|record| {
                record["body"]["statement"]
                    .as_str()
                    .and_then(match_digest)
                    .is_some_and(|found| hex(found) == digest)
            })
            .filter_map(|record| record["id"].as_str().map(str::to_owned))
            .collect();
        ensure(!same.is_empty(), "a record holds the group's text")?;
        for text in &texts {
            ensure_eq(
                match_digest(text).map(hex).as_deref(),
                Some(digest),
                "the digest of a fixture text",
            )?;
            let result = one(d, &decl, &asking(&decl, &[text]), &everyone())?;
            ensure_eq(
                ids(&result.identical),
                same.clone(),
                "identical under whitespace, case and width changes",
            )?;
        }
        // All of them in one call, each with its own result.
        let page = run(d, &decl, &asking(&decl, &texts), &everyone())?;
        for result in &page.results {
            ensure_eq(ids(&result.identical), same.clone(), "each text of a call")?;
        }
    }
    // An identical hit is the record: its id, its revision, its match field and its label.
    let result = one(d, &decl, &asking(&decl, &[ROSES]), &everyone())?;
    let first = result
        .identical
        .first()
        .ok_or("the roses are identical to n1")?;
    ensure_eq(
        (first.id.as_str(), first.rev, first.text.as_str()),
        ("n1", 1, ROSES),
        "an identical hit carries the record's id, revision and match field",
    )?;
    ensure_eq(
        first.label.as_ref().map(|label| label.standing),
        Some(Standing::Unverified),
        "a standing record with no standing fact reads unverified in a hit",
    )?;
    // A value whose normalised form is empty has no digest and is identical to nothing.
    for blank in [" ", " \t\u{a0} "] {
        ensure(match_digest(blank).is_none(), "a blank text has no digest")?;
        let result = one(d, &decl, &asking(&decl, &[blank]), &everyone())?;
        ensure(
            result.identical.is_empty() && result.nearest.is_empty(),
            "a blank text is identical to nothing and near nothing",
        )?;
    }
    // At most eight, by id in byte order, whatever the order of put; under the key filters.
    for (index, id) in ["r9", "r3", "r7", "r1", "r5", "r0", "r8", "r2", "r6", "r4"]
        .iter()
        .enumerate()
    {
        let bed = if index % 2 == 0 { "east" } else { "west" };
        put(
            d,
            &decl,
            id,
            note("PRUNE roses in late winter, before the buds swell.", bed),
            &["space"],
        )?;
    }
    let result = one(d, &decl, &asking(&decl, &[ROSES]), &everyone())?;
    ensure_eq(
        ids(&result.identical),
        owned(&["n1", "r0", "r1", "r2", "r3", "r4", "r5", "r6"]),
        "the first eight by id",
    )?;
    let west = RecordMatch {
        keys: vec![KeyFilter {
            key: pointer("/bed")?,
            any: vec!["west".to_owned()],
        }],
        ..asking(&decl, &[ROSES])
    };
    ensure_eq(
        ids(&one(d, &decl, &west, &everyone())?.identical),
        owned(&["r0", "r1", "r2", "r3", "r4"]),
        "only records that pass the key filters are identical",
    )?;
    pass()
}

fn fixture_scores(env: &Env<'_>) -> CaseResult {
    for reversed in [false, true] {
        let Some((s, _)) = lane(env)? else {
            return skip(NO_LANE);
        };
        let d = &*s.stores.documents;
        let (decl, fixture) = fixture()?;
        put_fixture(d, &decl, &fixture, reversed)?;
        let rows = fixture["matches"]
            .as_array()
            .ok_or("the fixture has texts")?;
        ensure(rows.len() >= 2, "the fixture has texts to match")?;
        let mut alone = Vec::new();
        for row in rows {
            let text = row["text"].as_str().unwrap_or_default();
            let query = RecordMatch {
                exclude: owned(&strings(&row["exclude"])),
                ..asking(&decl, &[text])
            };
            let result = one(d, &decl, &query, &everyone())?;
            ensure_eq(
                ids(&result.identical),
                owned(&strings(&row["identical"])),
                "the fixture's identical records",
            )?;
            ensure(!result.cut, "the fixture is far under the gather's bound")?;
            // The fixture scores every record. A record that shares no term with the text is
            // no candidate, and the fixture has it at 0.
            let asked = Terms::of(text);
            let mut expected = Vec::new();
            for scored in row["scores"].as_array().into_iter().flatten() {
                let id = scored["id"].as_str().unwrap_or_default();
                let statement = fixture["records"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .find(|record| record["id"] == id)
                    .and_then(|record| record["body"]["statement"].as_str())
                    .ok_or("the fixture scores a record it holds")?;
                let shares = Terms::of(statement)
                    .counts
                    .keys()
                    .any(|term| asked.counts.contains_key(term));
                let score = scored["words"].as_f64().ok_or("a words score")?;
                if shares {
                    expected.push((id.to_owned(), format!("{score:.4}")));
                } else {
                    ensure_eq(
                        format!("{score:.4}"),
                        "0.0000".to_owned(),
                        "the fixture scores a record that shares no term at 0",
                    )?;
                }
            }
            ensure(!expected.is_empty(), "each fixture text has a candidate")?;
            ensure_eq(
                near(&result),
                expected,
                "the words score of every fixture pair, to four places, in the fixture's order",
            )?;
            if query.exclude.is_empty() {
                alone.push((text, shown(&result)));
            }
        }
        // The same texts in one call are answered as each was alone.
        let texts: Vec<&str> = alone.iter().map(|(text, _)| *text).collect();
        let page = run(d, &decl, &asking(&decl, &texts), &everyone())?;
        for (result, (_, before)) in page.results.iter().zip(&alone) {
            ensure_eq(&shown(result), before, "a text among others in one call")?;
        }
        // Section 8.2's worked example, as the specification prints it.
        let worked = one(
            d,
            &decl,
            &asking(
                &decl,
                &["Prune your roses in late winter before the buds swell."],
            ),
            &everyone(),
        )?;
        ensure_eq(
            near(&worked),
            vec![
                ("n1".to_owned(), "0.8304".to_owned()),
                ("n2".to_owned(), "0.6428".to_owned()),
                ("n5".to_owned(), "0.0422".to_owned()),
                ("n4".to_owned(), "0.0341".to_owned()),
            ],
            "the worked example of section 8.2",
        )?;
        let second = one(
            d,
            &decl,
            &asking(
                &decl,
                &["PRUNE ROSES  in late winter, before the buds swell."],
            ),
            &everyone(),
        )?;
        ensure_eq(
            near(&second)[..2].to_vec(),
            vec![
                ("n1".to_owned(), "1.0000".to_owned()),
                ("n2".to_owned(), "0.6714".to_owned()),
            ],
            "a text scores 1 against a record that holds it, and the worked 0.6714",
        )?;
    }
    pass()
}

fn empty_and_tokenless(env: &Env<'_>) -> CaseResult {
    let Some((s, _)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let d = &*s.stores.documents;
    let decl = decl()?;
    // An empty lane: every text has an empty result.
    let page = run(
        d,
        &decl,
        &asking(&decl, &[ROSES, "Mulch the roses."]),
        &everyone(),
    )?;
    ensure(
        page.results
            .iter()
            .all(|result| result.identical.is_empty() && result.nearest.is_empty() && !result.cut),
        "an empty lane matches nothing",
    )?;
    ensure_eq(
        page.admitted,
        vec![Standing::Unverified, Standing::Attested, Standing::Affirmed],
        "the page says what was admitted",
    )?;
    put(d, &decl, "a", note("Mulch the roses.", "north"), &["space"])?;
    put(
        d,
        &decl,
        "b",
        note("Mulch holds water.", "south"),
        &["space"],
    )?;
    // A record whose match field holds no token has a digest, and no term.
    put(d, &decl, "dots", note("...", "south"), &["space"])?;
    // A record with no match value at all: counted as a record, identical to nothing.
    put(d, &decl, "bare", json!({ "bed": "east" }), &["space"])?;
    let tokenless = one(d, &decl, &asking(&decl, &["..."]), &everyone())?;
    ensure_eq(
        (ids(&tokenless.identical), tokenless.nearest.len()),
        (owned(&["dots"]), 0),
        "a text with no token is identical by its digest and near nothing",
    )?;
    let other = one(d, &decl, &asking(&decl, &["?!"]), &everyone())?;
    ensure(
        other.identical.is_empty() && other.nearest.is_empty(),
        "another text with no token is identical to nothing",
    )?;
    // Four stored records and the text: the two that hold no term are counted, and score
    // nothing.
    let corpus = pairs(&[
        ("a", "Mulch the roses."),
        ("b", "Mulch holds water."),
        ("dots", "..."),
        ("bare", ""),
    ]);
    let mulch = one(d, &decl, &asking(&decl, &["Mulch the roses."]), &everyone())?;
    ensure_eq(
        near(&mulch),
        expected("Mulch the roses.", &corpus, &corpus),
        "a record with no term is counted in the corpus and is no candidate",
    )?;
    ensure_eq(
        near(&mulch)[0].clone(),
        ("a".to_owned(), "1.0000".to_owned()),
        "a text scores 1 against a record that holds it",
    )?;
    // A text with no token among others changes none of them.
    let page = run(
        d,
        &decl,
        &asking(&decl, &["...", "Mulch the roses.", "?!"]),
        &everyone(),
    )?;
    ensure_eq(
        shown(&page.results[1]),
        shown(&mulch),
        "a text beside texts with no token",
    )?;
    pass()
}

fn excluded(env: &Env<'_>) -> CaseResult {
    let Some((s, _)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let d = &*s.stores.documents;
    let with = decl()?;
    let without = other(&with, "without");
    let stored = "Mulch keeps the soil cool and holds water.";
    let rest = [
        ("a", "Mulch the soil in autumn."),
        ("b", "Straw mulch holds water through summer."),
        ("c", "Water the tomatoes at the base."),
        ("d", "Mulch keeps the soil cool."),
    ];
    // The same records in both kinds, and in one of them the text itself.
    for (id, statement) in rest {
        put(d, &with, id, note(statement, "south"), &["space"])?;
        put(d, &without, id, note(statement, "south"), &["space"])?;
    }
    put(d, &with, "self", note(stored, "south"), &["space"])?;
    let scored = |result: &MatchResult| (ids(&result.identical), near(result));
    let plain = one(d, &with, &asking(&with, &[stored]), &everyone())?;
    ensure_eq(
        (
            ids(&plain.identical),
            near(&plain).first().cloned(),
            plain.nearest.len(),
        ),
        (
            owned(&["self"]),
            Some(("self".to_owned(), "1.0000".to_owned())),
            5,
        ),
        "a stored text matched with itself is identical and scores 1",
    )?;
    let excluding = RecordMatch {
        exclude: owned(&["self"]),
        ..asking(&with, &[stored])
    };
    let left_out = one(d, &with, &excluding, &everyone())?;
    let never_stored = one(d, &without, &asking(&without, &[stored]), &everyone())?;
    ensure_eq(
        scored(&left_out),
        scored(&never_stored),
        "a stored text matched with itself excluded scores as if it were not stored",
    )?;
    ensure_eq(
        near(&left_out),
        expected(stored, &pairs(&rest), &pairs(&rest)),
        "and as the formulas give without it",
    )?;
    // The case has teeth: counted twice, the others score otherwise.
    let others: Vec<(String, String)> = near(&plain).into_iter().skip(1).collect();
    ensure(
        others != near(&left_out),
        "counting the stored text as well as the incoming one changes the scores",
    )?;
    // An id that names no record, and one its reader may not read, leave everything as it is.
    put(d, &with, "hidden", note(stored, "south"), &["group:other"])?;
    for ids in [
        &["nothing"][..],
        &["hidden"][..],
        &["nothing", "hidden"][..],
    ] {
        let query = RecordMatch {
            exclude: owned(ids),
            ..asking(&with, &[stored])
        };
        ensure_eq(
            shown(&one(d, &with, &query, &everyone())?),
            shown(&plain),
            "excluding what the reader does not read changes nothing",
        )?;
    }
    // Several excluded at once, repeated: out of both lists and out of the statistics.
    let several = RecordMatch {
        exclude: owned(&["self", "d", "self"]),
        ..asking(&with, &[stored])
    };
    let kept = pairs(&rest[..3]);
    ensure_eq(
        near(&one(d, &with, &several, &everyone())?),
        expected(stored, &kept, &kept),
        "every excluded record is left out of the statistics",
    )?;
    // Eight copies of the text whose ids come before `self`, all excluded: they take none of
    // the eight places an identical list has.
    let copies: Vec<String> = (0..8).map(|index| format!("copy{index}")).collect();
    for id in &copies {
        put(d, &with, id, note(stored, "south"), &["space"])?;
    }
    let query = RecordMatch {
        exclude: copies.clone(),
        ..asking(&with, &[stored])
    };
    let result = one(d, &with, &query, &everyone())?;
    ensure_eq(
        ids(&result.identical),
        owned(&["self"]),
        "excluded records take no place among the eight identical",
    )?;
    ensure_eq(
        scored(&result),
        scored(&plain),
        "and with them excluded the answer is the one before they were written",
    )?;
    pass()
}

/// Sixty-four texts about a garden, each different.
fn many_texts() -> Vec<String> {
    let subjects = [
        "roses", "tomatoes", "mulch", "straw", "soil", "water", "compost", "beans",
    ];
    let advice = [
        "want morning sun",
        "need steady watering",
        "keep the soil cool",
        "hold water through summer",
        "are pruned in late winter",
        "dislike dry roots",
        "feed the bed in spring",
        "cover the roots in autumn",
    ];
    subjects
        .iter()
        .flat_map(|subject| {
            advice
                .iter()
                .map(move |advice| format!("The {subject} {advice}."))
        })
        .collect()
}

fn one_or_many(env: &Env<'_>) -> CaseResult {
    let Some((s, _)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let d = &*s.stores.documents;
    let decl = decl()?;
    let stored = [
        ("a", "Mulch keeps the soil cool and holds water."),
        ("b", "Roses are pruned in late winter."),
        ("c", "Tomatoes need steady watering and six hours of sun."),
        ("d", "Straw mulch covers the roots in autumn."),
        ("e", "Compost feeds the soil in spring."),
        ("f", "The roses want morning sun."),
        ("g", "Beans dislike dry roots."),
    ];
    for (id, statement) in stored {
        put(d, &decl, id, note(statement, "south"), &["space"])?;
    }
    let texts = many_texts();
    ensure_eq(texts.len(), MAX_MATCH_TEXTS, "sixty-four texts")?;
    let texts: Vec<&str> = texts.iter().map(String::as_str).collect();
    let together = run(d, &decl, &asking(&decl, &texts), &everyone())?;
    let corpus = pairs(&stored);
    let mut some_identical = false;
    for (text, result) in texts.iter().zip(&together.results) {
        let alone = one(d, &decl, &asking(&decl, &[text]), &everyone())?;
        ensure_eq(
            shown(result),
            shown(&alone),
            "a text is answered the same alone and among sixty-four",
        )?;
        ensure_eq(
            near(result),
            expected(text, &corpus, &corpus),
            "and as the formulas give",
        )?;
        some_identical |= !result.identical.is_empty();
    }
    ensure(some_identical, "one of the texts is a stored one")?;
    // A text given twice in one call is answered twice, the same.
    let twice = run(
        d,
        &decl,
        &asking(&decl, &[texts[0], texts[9], texts[0]]),
        &everyone(),
    )?;
    ensure_eq(
        shown(&twice.results[0]),
        shown(&twice.results[2]),
        "a text given twice",
    )?;
    pass()
}

fn key_filters(env: &Env<'_>) -> CaseResult {
    let Some((s, _)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let d = &*s.stores.documents;
    let decl = decl()?;
    let stored = [
        ("a", "Mulch the roses in autumn.", "north", "roses"),
        ("b", "Mulch keeps the soil cool.", "south", "soil"),
        ("c", "Roses want mulch, and more mulch.", "north", "soil"),
        ("d", "Mulch holds water through summer.", "south", "roses"),
        ("e", "Water the roses at the base.", "east", "roses"),
    ];
    for (id, statement, bed, tag) in stored {
        put(
            d,
            &decl,
            id,
            json!({ "statement": statement, "bed": bed, "tags": [tag] }),
            &["space"],
        )?;
    }
    let corpus: Vec<(String, String)> = stored
        .iter()
        .map(|(id, statement, _, _)| ((*id).to_owned(), (*statement).to_owned()))
        .collect();
    let text = "Mulch the roses.";
    let whole = near(&one(d, &decl, &asking(&decl, &[text]), &everyone())?);
    ensure_eq(
        whole.clone(),
        expected(text, &corpus, &corpus),
        "without a filter",
    )?;
    let filter = |key: &str, any: &[&str]| -> Result<KeyFilter, String> {
        Ok(KeyFilter {
            key: pointer(key)?,
            any: owned(any),
        })
    };
    for (keys, passing) in [
        (vec![filter("/bed", &["north"])?], &["a", "c"][..]),
        (
            vec![filter("/bed", &["north", "east"])?],
            &["a", "c", "e"][..],
        ),
        (
            vec![
                filter("/bed", &["north", "south"])?,
                filter("/tags", &["soil"])?,
            ],
            &["b", "c"][..],
        ),
        (vec![filter("/tags", &["beans"])?], &[][..]),
    ] {
        let query = RecordMatch {
            keys,
            ..asking(&decl, &[text])
        };
        let kept: Vec<(String, String)> = whole
            .iter()
            .filter(|(id, _)| passing.contains(&id.as_str()))
            .cloned()
            .collect();
        ensure_eq(
            near(&one(d, &decl, &query, &everyone())?),
            kept,
            "a key filter keeps the records that pass, each at the score it had without it",
        )?;
    }
    pass()
}

/// How many postings these bodies give a kind of `decl`: each text field's distinct terms, a
/// record at a time. What a backend counts, from the formulas' tokens alone.
fn postings_of(decl: &RecordDecl, bodies: &[&Value]) -> u64 {
    let mut total = 0;
    for body in bodies {
        for field in &decl.text {
            if let Some(text) = field.get(body).and_then(Value::as_str) {
                let mut terms = tokens(text);
                terms.sort();
                terms.dedup();
                total += terms.len() as u64;
            }
        }
    }
    total
}

/// Finds of `decl` for `who`, each with whether it is ranked and its answer as bytes, or its
/// refusal: two ranked, one of a word only an unreadable record holds; by id, by recency, and by
/// id with a text filter.
fn found(
    d: &dyn DocumentStore,
    decl: &RecordDecl,
    who: &ReaderFilter,
) -> Result<Vec<(bool, String)>, String> {
    let mut out = Vec::new();
    for (order, text) in [
        (FindOrder::Rank, Some("mulch straw")),
        (FindOrder::Rank, Some("compost")),
        (FindOrder::Id, None),
        (FindOrder::Recent, None),
        (FindOrder::Id, Some("mulch")),
    ] {
        let query = RecordFind {
            kind: decl.kind.clone(),
            keys: Vec::new(),
            standings: Vec::new(),
            verified_only: false,
            text: text.map(|query| TextQuery {
                query: query.to_owned(),
                fields: Vec::new(),
            }),
            order,
            after: None,
            limit: 200,
            total: true,
        };
        let shown = match d.find_records(NS, decl, &query, &view(), who) {
            Ok(page) => {
                let ids: Vec<&str> = page
                    .items
                    .iter()
                    .map(|item| item.record.id.as_str())
                    .collect();
                format!("{ids:?} {:?} {}", page.total, page.cut)
            }
            Err(StoreError::LaneTooBroad { limit }) => format!("too broad past {limit}"),
            Err(error) => return Err(format!("find_records: {error}")),
        };
        out.push((order == FindOrder::Rank, shown));
    }
    Ok(out)
}

fn too_broad(env: &Env<'_>) -> CaseResult {
    let Some((s, open)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let decl = decl()?;
    let d = &*s.stores.documents;
    // Postings in both text fields; one record the reader may not read.
    let mut bodies = vec![
        ("a", note("Mulch.", "south"), "space"),
        ("b", note("Mulch straw, mulch.", "south"), "space"),
        (
            "c",
            json!({ "statement": "Straw.", "why": "It feeds the soil.", "bed": "north" }),
            "space",
        ),
        ("h", note("Compost and straw.", "south"), "group:other"),
    ];
    for (id, body, access) in &bodies {
        put(d, &decl, id, body.clone(), &[*access])?;
    }
    let total = |bodies: &[(&str, Value, &str)], decl: &RecordDecl| {
        postings_of(
            decl,
            &bodies.iter().map(|(_, body, _)| body).collect::<Vec<_>>(),
        )
    };
    let at = total(&bodies, &decl);
    let bounded = |bound: u64| {
        open(
            s.dir.path(),
            SPACE,
            LaneLimits {
                match_postings: bound,
                ..LaneLimits::default()
            },
        )
        .ctx("a store with the bound lowered")
    };
    let none = ReaderFilter::tokens(Vec::<String>::new()).ctx("a reader with no token")?;
    let readers = [
        everyone(),
        none,
        reader(&["principal:human:local"]),
        writer(),
    ];
    // Texts that name the reader's words, a hidden record's only word, no stored word, and no
    // token at all; with and without exclusions and key filters.
    let queries = [
        asking(&decl, &["mulch"]),
        asking(&decl, &["compost"]),
        asking(&decl, &["quince", "straw mulch"]),
        asking(&decl, &["..."]),
        RecordMatch {
            exclude: owned(&["a", "b", "c", "h"]),
            ..asking(&decl, &["mulch"])
        },
        RecordMatch {
            keys: vec![KeyFilter {
                key: pointer("/bed")?,
                any: vec!["east".to_owned()],
            }],
            ..asking(&decl, &["straw"])
        },
    ];
    // At the bound every call is answered, as a store with no bound answers it.
    let answers = |decl: &RecordDecl, bound: u64| -> Result<(), String> {
        let store = bounded(bound)?;
        for who in &readers {
            for query in &queries {
                let query = RecordMatch {
                    kind: decl.kind.clone(),
                    ..query.clone()
                };
                ensure_eq(
                    page_shown(&run(&*store, decl, &query, who)?),
                    page_shown(&run(d, decl, &query, who)?),
                    "at its bound a kind is matched as with none",
                )?;
            }
            ensure_eq(
                found(&*store, decl, who)?,
                found(d, decl, who)?,
                "at its bound a kind is found as with none",
            )?;
        }
        Ok(())
    };
    // Past it every call of every reader is refused alike, and a find is answered as before.
    let refuses = |decl: &RecordDecl, bound: u64| -> Result<(), String> {
        let store = bounded(bound)?;
        for who in &readers {
            for query in &queries {
                let query = RecordMatch {
                    kind: decl.kind.clone(),
                    ..query.clone()
                };
                ensure_eq(
                    store
                        .match_records(NS, decl, &query, None, &view(), who)
                        .err(),
                    Some(StoreError::LaneTooBroad { limit: bound }),
                    "past its bound every match of a kind is refused, whoever asks what",
                )?;
            }
            // A ranked find is refused alike; a find by id, by recency or with a text filter is
            // answered as with no bound.
            for ((ranked, shown), (_, free)) in found(&*store, decl, who)?
                .into_iter()
                .zip(found(d, decl, who)?)
            {
                if ranked {
                    ensure_eq(
                        shown,
                        format!("too broad past {bound}"),
                        "past its bound every ranked find of a kind is refused, whoever asks what",
                    )?;
                } else {
                    ensure_eq(
                        shown,
                        free,
                        "an unranked find is never refused for its kind's size",
                    )?;
                }
            }
        }
        Ok(())
    };
    answers(&decl, at)?;
    refuses(&decl, at - 1)?;
    refuses(&decl, 0)?;
    // The count follows each put: a record rewritten with fewer terms, and one more record its
    // reader may not read, which counts as much as one it may.
    bodies[1].1 = note("Mulch.", "south");
    put(d, &decl, "b", bodies[1].1.clone(), &["space"])?;
    ensure_eq(total(&bodies, &decl), at - 1, "the rewrite drops a posting")?;
    answers(&decl, at - 1)?;
    refuses(&decl, at - 2)?;
    bodies.push(("i", note("Quince jelly.", "north"), "group:other"));
    put(d, &decl, "i", bodies[4].1.clone(), &["group:other"])?;
    let at = total(&bodies, &decl);
    answers(&decl, at)?;
    refuses(&decl, at - 1)?;
    // And each rebuild: under the same declaration nothing moves, and under one that drops a
    // text field the kind holds that field's postings no more.
    d.reindex_records(NS, &decl, &no_scan, None, false)
        .ctx("reindex_records")?;
    answers(&decl, at)?;
    refuses(&decl, at - 1)?;
    let narrower = RecordDecl {
        text: vec![pointer("/statement")?],
        ..decl.clone()
    };
    d.reindex_records(NS, &narrower, &no_scan, None, false)
        .ctx("reindex_records under a narrower declaration")?;
    let at = total(&bodies, &narrower);
    ensure(
        at < total(&bodies, &decl),
        "the case has teeth: a field is dropped",
    )?;
    answers(&narrower, at)?;
    refuses(&narrower, at - 1)?;
    pass()
}

/// The probe of step B4's review, under the bound that replaced the work cap. A reader writes
/// many records of its own that share one word, and matches that word with another: under the
/// cap, a call was refused when the other word sat in a record the reader could not read and
/// answered when it did not. Now two kinds of one size, one with the word hidden in it and one
/// without, answer every reader alike, at the bound and past it.
fn refusal_holds_no_word(env: &Env<'_>) -> CaseResult {
    let Some((s, open)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let base = decl()?;
    let (with, without) = (other(&base, "with"), other(&base, "without"));
    let d = &*s.stores.documents;
    let pad = "Bramble bramble.";
    for kind in [&with, &without] {
        for index in 0..12 {
            put(
                d,
                kind,
                &format!("p{index:02}"),
                note(pad, "south"),
                &["principal:human:local"],
            )?;
        }
    }
    // One hidden record each, of the same number of postings: one holds `medlar`, the other
    // does not.
    put(
        d,
        &with,
        "h",
        note("Medlar jelly.", "north"),
        &["group:other"],
    )?;
    put(
        d,
        &without,
        "h",
        note("Quince jelly.", "north"),
        &["group:other"],
    )?;
    // Both kinds hold this many postings: twelve of the pad's one term, and the hidden two.
    let bodies: Vec<Value> = (0..12)
        .map(|_| note(pad, "south"))
        .chain([note("Medlar jelly.", "north")])
        .collect();
    let postings = postings_of(&base, &bodies.iter().collect::<Vec<_>>());
    let own = reader(&["principal:human:local"]);
    let none = ReaderFilter::tokens(Vec::<String>::new()).ctx("a reader with no token")?;
    let texts = ["bramble medlar", "bramble rowan", "bramble"];
    // What a call answers: each hit's id, text and score, and `cut`, or the refusal. Not a
    // hit's revision, which differs between the kinds by the order of their puts.
    let outcome = |store: &dyn DocumentStore,
                   kind: &RecordDecl,
                   who: &ReaderFilter,
                   text: &str|
     -> Result<String, String> {
        let page = match store.match_records(NS, kind, &asking(kind, &[text]), None, &view(), who) {
            Ok(page) => page,
            Err(StoreError::LaneTooBroad { limit }) => {
                return Ok(format!("too broad past {limit}"));
            }
            Err(error) => return Err(format!("match_records: {error}")),
        };
        let hits = |hits: &[MatchHit]| -> Vec<String> {
            hits.iter()
                .map(|hit| format!("{} {} {:?}", hit.id, hit.text, hit.words))
                .collect()
        };
        Ok(page
            .results
            .iter()
            .map(|result| {
                format!(
                    "identical {:?} nearest {:?} cut {}",
                    hits(&result.identical),
                    hits(&result.nearest),
                    result.cut
                )
            })
            .collect::<Vec<_>>()
            .join("\n"))
    };
    for bound in [postings, postings - 1, 12] {
        let store = open(
            s.dir.path(),
            SPACE,
            LaneLimits {
                match_postings: bound,
                ..LaneLimits::default()
            },
        )
        .ctx("a store with the bound lowered")?;
        for who in [&own, &none, &everyone()] {
            let first = outcome(&*store, &with, who, texts[0])?;
            ensure(
                (bound >= postings) != first.starts_with("too broad"),
                "answered at the bound and refused past it",
            )?;
            for text in texts {
                for kind in [&with, &without] {
                    let shown = outcome(&*store, kind, who, text)?;
                    ensure_eq(
                        shown.starts_with("too broad"),
                        first.starts_with("too broad"),
                        &format!(
                            "{text} in {}: refused or answered alike, whichever word an unreadable record holds",
                            kind.kind
                        ),
                    )?;
                    if text != texts[2] {
                        ensure_eq(
                            &shown,
                            &first,
                            &format!("{text} in {}: the same answer, word for word", kind.kind),
                        )?;
                    }
                }
            }
        }
    }
    // For a reader of the hidden records the word is there: the case has teeth.
    let theirs = outcome(d, &with, &writer(), texts[0])?;
    ensure(
        theirs.contains("Medlar jelly."),
        "the hidden record is there for those who may read it",
    )?;
    pass()
}

fn cut(env: &Env<'_>) -> CaseResult {
    let Some((s, open)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let decl = decl()?;
    // A gather bound of 3 postings: five readable records hold `mulch`, two of them `straw`.
    let limits = LaneLimits {
        gather_postings: 3,
        ..LaneLimits::default()
    };
    let d = open(s.dir.path(), SPACE, limits).ctx("a store with a gather bound of 3")?;
    let d = &*d;
    let stored = [
        ("a", "Mulch the roses.", "north"),
        ("b", "Mulch the tomatoes with straw.", "south"),
        ("c", "Mulch keeps the soil cool.", "north"),
        ("d", "Straw mulch holds water.", "south"),
        ("e", "Mulch in autumn.", "north"),
    ];
    for (id, statement, bed) in stored {
        put(d, &decl, id, note(statement, bed), &["space"])?;
    }
    let corpus: Vec<(String, String)> = stored
        .iter()
        .map(|(id, statement, _)| ((*id).to_owned(), (*statement).to_owned()))
        .collect();
    let among = |ids: &[&str]| -> Vec<(String, String)> {
        corpus
            .iter()
            .filter(|(id, _)| ids.contains(&id.as_str()))
            .cloned()
            .collect()
    };
    let south = RecordMatch {
        keys: vec![KeyFilter {
            key: pointer("/bed")?,
            any: vec!["south".to_owned()],
        }],
        ..asking(&decl, &["mulch"])
    };
    let check = |who: &ReaderFilter, what: &str| -> Result<(), String> {
        let result = one(d, &decl, &asking(&decl, &["mulch"]), who)?;
        ensure(
            result.cut,
            &format!("{what}: the rarest term passes the bound"),
        )?;
        ensure_eq(
            near(&result),
            expected("mulch", &among(&["a", "b", "c"]), &corpus),
            &format!("{what}: the bound's first postings in lane order are the candidates"),
        )?;
        let result = one(d, &decl, &asking(&decl, &["mulch straw"]), who)?;
        ensure(
            !result.cut,
            &format!("{what}: leaving a commoner term out of the gather cuts nothing"),
        )?;
        ensure_eq(
            near(&result),
            expected("mulch straw", &among(&["b", "d"]), &corpus),
            &format!("{what}: the rarer term's records are the candidates"),
        )?;
        let result = one(d, &decl, &south, who)?;
        ensure(
            !result.cut,
            &format!("{what}: a key filter brings the postings under the bound"),
        )?;
        ensure_eq(
            near(&result),
            expected("mulch", &among(&["b", "d"]), &corpus),
            &format!("{what}: every record that passes the filter is a candidate"),
        )?;
        // One text's cut is its own.
        let page = run(d, &decl, &asking(&decl, &["mulch straw", "mulch"]), who)?;
        ensure_eq(
            (page.results[0].cut, page.results[1].cut),
            (false, true),
            &format!("{what}: each text says whether its own gather was cut"),
        )?;
        Ok(())
    };
    check(&everyone(), "before")?;
    // Records the reader may not read count for nothing: not in the bound, not in the cut.
    for id in ["0", "a0", "z"] {
        put(
            d,
            &decl,
            id,
            note("Mulch and straw, mulch and straw.", "south"),
            &["group:other"],
        )?;
    }
    check(&everyone(), "beside unreadable records")?;
    // A reader of two of the mulch records is under the bound.
    for id in ["p1", "p2"] {
        put(
            d,
            &decl,
            id,
            note("Mulch the beans.", "north"),
            &["principal:human:local"],
        )?;
    }
    let own = reader(&["principal:human:local"]);
    let result = one(d, &decl, &asking(&decl, &["mulch"]), &own)?;
    ensure(
        !result.cut,
        "a reader whose own postings are under the bound is not cut",
    )?;
    ensure_eq(
        ids(&result.nearest),
        owned(&["p1", "p2"]),
        "its own records",
    )?;
    // An excluded record is out of the bound too: four mulch records are left, and still cut;
    // with two excluded, three are left and nothing is cut.
    let excluding = |ids: &[&str]| RecordMatch {
        exclude: owned(ids),
        ..asking(&decl, &["mulch"])
    };
    ensure(
        one(d, &decl, &excluding(&["a"]), &everyone())?.cut,
        "four postings pass a bound of three",
    )?;
    ensure(
        !one(d, &decl, &excluding(&["a", "c"]), &everyone())?.cut,
        "three postings do not",
    )?;
    pass()
}

fn pool_and_k(env: &Env<'_>) -> CaseResult {
    let Some((s, _)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let d = &*s.stores.documents;
    let decl = decl()?;
    // Seventy records that say `mulch` three times and one thing of their own: high in the
    // query's direction and low in their own. Six that say it once beside `soil`: lower in
    // the query's direction, and higher in theirs. And records that say neither, so `mulch`
    // is not in every record.
    let mut stored: Vec<(String, String)> = Vec::new();
    for index in 0..70 {
        stored.push((
            format!("l{index:02}"),
            format!("Mulch, mulch, mulch the bed{index}."),
        ));
    }
    for index in 0..6 {
        stored.push((format!("s{index}"), "Mulch soil.".to_owned()));
    }
    for index in 0..40 {
        stored.push((
            format!("x{index:02}"),
            format!("Water the row{index} at the base."),
        ));
    }
    for (id, statement) in &stored {
        put(d, &decl, id, note(statement, "south"), &["space"])?;
    }
    let text = "mulch";
    let full = by_the_formulas(text, &stored, &stored, MATCH_POOL, MAX_MATCH_K as usize);
    let unpooled = by_the_formulas(text, &stored, &stored, usize::MAX, MAX_MATCH_K as usize);
    ensure(
        full != unpooled && unpooled[0].0.starts_with('s') && full[0].0.starts_with('l'),
        "the case has teeth: without the pool of 64 the nearest would be other records",
    )?;
    let result = one(d, &decl, &asking(&decl, &[text]), &everyone())?;
    ensure_eq(
        near(&result),
        full.clone(),
        "the nearest are of the 64 highest in the query's direction, ties by id",
    )?;
    ensure_eq(result.nearest.len(), 20, "k cuts the pool to 20")?;
    for k in [1, 3, 19] {
        let query = RecordMatch {
            k,
            ..asking(&decl, &[text])
        };
        ensure_eq(
            near(&one(d, &decl, &query, &everyone())?),
            full[..k as usize].to_vec(),
            "a smaller k is the head of a larger one",
        )?;
    }
    pass()
}

fn ties(env: &Env<'_>) -> CaseResult {
    let Some((s, _)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let d = &*s.stores.documents;
    let decl = decl()?;
    // The same statement under ids whose byte order is not their order of put, nor a
    // case-folded or a locale's order.
    for id in ["b", "é", "a", "B", "a2", "Z", "ab"] {
        put(d, &decl, id, note("Mulch the roses.", "north"), &["space"])?;
    }
    put(d, &decl, "other", note("Mulch.", "north"), &["space"])?;
    let by_bytes = owned(&["B", "Z", "a", "a2", "ab", "b", "é"]);
    let result = one(d, &decl, &asking(&decl, &["Mulch the roses."]), &everyone())?;
    ensure_eq(
        ids(&result.identical),
        by_bytes.clone(),
        "identical records are ordered by the bytes of their ids",
    )?;
    let mut nearest = by_bytes.clone();
    nearest.push("other".to_owned());
    ensure_eq(
        ids(&result.nearest),
        nearest,
        "equal scores are ordered by the bytes of their ids",
    )?;
    ensure(
        near(&result)[..7]
            .iter()
            .all(|(_, words)| words == "1.0000"),
        "the tied records score alike",
    )?;
    // A tie at four places, between records that differ past them, is still by id.
    let near_tie = one(d, &decl, &asking(&decl, &["Mulch the bed."]), &everyone())?;
    let scores = near(&near_tie);
    for pair in scores.windows(2) {
        ensure(
            pair[0].1 > pair[1].1
                || (pair[0].1 == pair[1].1 && pair[0].0.as_bytes() < pair[1].0.as_bytes()),
            "nearest is by score descending, then by id",
        )?;
    }
    pass()
}

fn stale(error: &StoreError) -> bool {
    matches!(error, StoreError::LaneStale)
}

fn refusals(env: &Env<'_>) -> CaseResult {
    let Some((s, _)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let d = &*s.stores.documents;
    let decl = decl()?;
    put(d, &decl, "a", note("Mulch the roses.", "north"), &["space"])?;
    let base = asking(&decl, &["Mulch."]);
    let refused = |query: &RecordMatch, rule: &str| -> Result<(), String> {
        match d.match_records(NS, &decl, query, None, &view(), &everyone()) {
            Err(StoreError::Invalid(why)) if why.contains(rule) => Ok(()),
            other => Err(format!("{rule}: {other:?}")),
        }
    };
    let texts =
        |count: usize| -> Vec<String> { (0..count).map(|n| format!("Mulch {n}.")).collect() };
    refused(
        &RecordMatch {
            kind: "other".to_owned(),
            ..base.clone()
        },
        "kind is not",
    )?;
    for count in [0, MAX_MATCH_TEXTS + 1] {
        refused(
            &RecordMatch {
                texts: texts(count),
                ..base.clone()
            },
            "texts holds 1 to 64 texts",
        )?;
    }
    for text in [String::new(), "x".repeat(MAX_LANE_TEXT_BYTES + 1)] {
        refused(
            &RecordMatch {
                texts: vec!["Mulch.".to_owned(), text],
                ..base.clone()
            },
            "each text is 1 to 16384 bytes",
        )?;
    }
    for k in [0, MAX_MATCH_K + 1] {
        refused(&RecordMatch { k, ..base.clone() }, "k must be 1 to 20")?;
    }
    refused(
        &RecordMatch {
            exclude: (0..=MAX_MATCH_EXCLUDE).map(|n| format!("n{n}")).collect(),
            ..base.clone()
        },
        "exclude holds at most 64 ids",
    )?;
    refused(
        &RecordMatch {
            exclude: vec![String::new()],
            ..base.clone()
        },
        "each excluded id is a record id",
    )?;
    refused(
        &RecordMatch {
            keys: vec![KeyFilter {
                key: pointer("/statement")?,
                any: vec!["x".to_owned()],
            }],
            ..base.clone()
        },
        "is not a key pointer of the declaration",
    )?;
    refused(
        &RecordMatch {
            keys: vec![KeyFilter {
                key: pointer("/bed")?,
                any: Vec::new(),
            }],
            ..base.clone()
        },
        "holds 1 to 64 values",
    )?;
    refused(
        &RecordMatch {
            standings: vec![Standing::Affirmed],
            ..base.clone()
        },
        "a kind without standing",
    )?;
    refused(
        &RecordMatch {
            verified_only: true,
            ..base.clone()
        },
        "a kind without standing",
    )?;
    // The limits themselves are served: 64 texts of 16 KiB, k of 20, 64 excluded ids.
    let widest = RecordMatch {
        texts: (0..MAX_MATCH_TEXTS)
            .map(|n| format!("{n} {}", "mulch ".repeat(MAX_LANE_TEXT_BYTES / 6 - 1)))
            .collect(),
        exclude: (0..MAX_MATCH_EXCLUDE).map(|n| format!("n{n}")).collect(),
        ..base.clone()
    };
    ensure(
        widest
            .texts
            .iter()
            .all(|text| text.len() <= MAX_LANE_TEXT_BYTES && text.len() > MAX_LANE_TEXT_BYTES - 16),
        "the widest texts are at the limit",
    )?;
    let page = run(d, &decl, &widest, &everyone())?;
    ensure_eq(
        ids(&page.results[63].nearest),
        owned(&["a"]),
        "the widest call a match takes is answered",
    )?;
    // A refusal never holds a text.
    let long = RecordMatch {
        texts: vec!["canary".repeat(4000)],
        ..base.clone()
    };
    match d.match_records(NS, &decl, &long, None, &view(), &everyone()) {
        Err(StoreError::Invalid(why)) => {
            ensure(!why.contains("canary"), "a refusal holds no text")?
        }
        other => return Err(format!("a text past 16 KiB: {other:?}")),
    }
    // The lane is never read without a reader.
    expect_err(
        d.match_records(NS, &decl, &base, None, &view(), &ReaderFilter::derivation()),
        "a derivation read",
        invalid,
    )?;
    // Vectors join with the step that serves meaning: a match that carries them is refused,
    // and never answered as if it had carried none.
    let vectors = MatchVectors {
        model: ModelId::parse("potion@0123456789abcdef").ctx("a model id")?,
        weight: 0.5,
        vectors: vec![vec![1.0, 0.0, 0.0, 0.0]],
    };
    expect_err(
        d.match_records(NS, &decl, &base, Some(&vectors), &view(), &everyone()),
        "a match with vectors",
        invalid,
    )?;
    // A kind with no match field has nothing to match on.
    let unmatched = RecordDecl {
        kind: "plain".to_owned(),
        matched: None,
        ..decl.clone()
    };
    put(
        d,
        &unmatched,
        "a",
        note("Mulch the roses.", "north"),
        &["space"],
    )?;
    expect_err(
        d.match_records(
            NS,
            &unmatched,
            &asking(&unmatched, &["Mulch."]),
            None,
            &view(),
            &everyone(),
        ),
        "a kind with no match field",
        invalid,
    )?;
    // A stale kind is refused, as a find is, and a rebuild serves it again.
    let changed = RecordDecl {
        keys: vec![pointer("/bed")?],
        ..decl.clone()
    };
    expect_err(
        d.match_records(
            NS,
            &changed,
            &asking(&changed, &["Mulch."]),
            None,
            &view(),
            &everyone(),
        ),
        "a match under a changed declaration",
        stale,
    )?;
    d.reindex_records(NS, &changed, &no_scan, None, false)
        .ctx("reindex_records")?;
    ensure_eq(
        ids(&one(
            d,
            &changed,
            &asking(&changed, &["Mulch the roses."]),
            &everyone(),
        )?
        .identical),
        owned(&["a"]),
        "after the rebuild the kind is matched again",
    )?;
    expect_err(
        d.match_records(NS, &decl, &base, None, &view(), &everyone()),
        "a match under the declaration the rebuild replaced",
        stale,
    )?;
    pass()
}

fn unreadable_never_matched(env: &Env<'_>) -> CaseResult {
    let Some((s, _)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let d = &*s.stores.documents;
    let decl = decl()?;
    // The same words in every record; only who may read differs.
    let stored = [
        ("a", "space"),
        ("b", "group:growers"),
        ("c", "space"),
        ("d", "principal:human:local"),
        ("e", "group:growers"),
    ];
    let statement = "Mulch keeps the soil cool.";
    for (id, access) in stored {
        put(d, &decl, id, note(statement, "south"), &[access])?;
    }
    let none = ReaderFilter::tokens(Vec::<String>::new()).ctx("a reader with no token")?;
    let readers: [(&str, ReaderFilter, &[&str]); 4] = [
        ("everyone", everyone(), &["a", "c"]),
        ("a grower", reader(&["group:growers"]), &["b", "e"]),
        (
            "a grower in the space",
            reader(&["space", "group:growers"]),
            &["a", "b", "c", "e"],
        ),
        ("a reader with no token", none, &[]),
    ];
    for (who, filter, readable) in &readers {
        let own: Vec<(String, String)> = readable
            .iter()
            .map(|id| ((*id).to_owned(), statement.to_owned()))
            .collect();
        for text in [statement, "Mulch the soil.", "MULCH keeps  the soil cool."] {
            let result = one(d, &decl, &asking(&decl, &[text]), filter)?;
            ensure_eq(
                near(&result),
                expected(text, &own, &own),
                &format!("{who}: the nearest are its own records, scored over its own"),
            )?;
            let same = if text == "Mulch the soil." {
                Vec::new()
            } else {
                owned(readable)
            };
            ensure_eq(
                ids(&result.identical),
                same,
                &format!("{who}: the identical records are its own and no other"),
            )?;
        }
        // k of 1: the one hit is its own.
        let query = RecordMatch {
            k: 1,
            ..asking(&decl, &[statement])
        };
        ensure_eq(
            ids(&one(d, &decl, &query, filter)?.nearest),
            owned(&readable[..readable.len().min(1)]),
            &format!("{who}: with k of 1"),
        )?;
    }
    // Nine records the reader may not read, identical to the text, whose ids come before its
    // own: they take none of the eight places an identical list has.
    for index in 0..9 {
        put(
            d,
            &decl,
            &format!("0{index}"),
            note(statement, "south"),
            &["group:other"],
        )?;
    }
    let result = one(d, &decl, &asking(&decl, &[statement]), &everyone())?;
    ensure_eq(
        ids(&result.identical),
        owned(&["a", "c"]),
        "identical records the reader may not read take no place among its eight",
    )?;
    ensure_eq(
        ids(&result.nearest),
        owned(&["a", "c"]),
        "nor among its nearest",
    )?;
    ensure_eq(
        ids(&one(
            d,
            &decl,
            &asking(&decl, &[statement]),
            &reader(&["group:other"]),
        )?
        .identical)
        .len(),
        8,
        "their reader is given eight of them",
    )?;
    pass()
}

fn statistics_are_the_readers(env: &Env<'_>) -> CaseResult {
    let Some((s, _)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let d = &*s.stores.documents;
    let decl = decl()?;
    // Three records the reader may read and two it may not. Each statistic the hidden two
    // could move is shown apart: a hidden record that shares no term with the text moves only
    // the corpus's size and its tokens; one that shares a term moves that term's count too.
    let readable = [
        ("a", "Mulch the roses."),
        ("b", "Straw keeps the soil cool."),
        ("c", "Mulch, mulch and soil."),
    ];
    let own = pairs(&readable);
    for (id, statement) in readable {
        put(d, &decl, id, note(statement, "south"), &["space"])?;
    }
    let text = "Mulch the soil.";
    let before = near(&one(d, &decl, &asking(&decl, &[text]), &everyone())?);
    ensure_eq(
        before.clone(),
        expected(text, &own, &own),
        "the reader's own",
    )?;
    let hidden = [
        ("h1", "Tomatoes need six hours of sun and steady watering."),
        ("h2", "Mulch the soil, the soil, the soil."),
    ];
    let mut every = own.clone();
    for (id, statement) in hidden {
        put(d, &decl, id, note(statement, "south"), &["group:other"])?;
        every.push((id.to_owned(), statement.to_owned()));
        ensure(
            before != expected(text, &own, &every),
            "the case has teeth: counting this record in a statistic would change a score",
        )?;
        ensure_eq(
            near(&one(d, &decl, &asking(&decl, &[text]), &everyone())?),
            before.clone(),
            "the scores are the ones the reader's own records give",
        )?;
    }
    // A reader of all five is scored over all five.
    ensure_eq(
        near(&one(d, &decl, &asking(&decl, &[text]), &writer())?),
        expected(text, &every, &every),
        "a reader of every record is scored over every record",
    )?;
    // The hidden record that is the text itself: identical for its reader, nothing for ours.
    put(d, &decl, "h3", note(text, "south"), &["group:other"])?;
    let result = one(d, &decl, &asking(&decl, &[text]), &everyone())?;
    ensure(
        result.identical.is_empty(),
        "an identical record the reader may not read is not identical for it",
    )?;
    ensure_eq(near(&result), before, "and moves no score")?;
    ensure_eq(
        ids(&one(d, &decl, &asking(&decl, &[text]), &writer())?.identical),
        owned(&["h3"]),
        "its reader is given it",
    )?;
    pass()
}

/// Everything `who` can learn from matching: every result of a set of calls, as bytes.
fn everything(
    d: &dyn DocumentStore,
    decl: &RecordDecl,
    who: &ReaderFilter,
) -> Result<String, String> {
    let texts = [
        "Mulch.",
        "Mulch keeps the soil cool.",
        "Mulch the soil and water the roses.",
        "Water tomatoes at the base.",
        "Soil, soil and mulch: water it.",
        "Compost.",
        "...",
    ];
    let south = KeyFilter {
        key: pointer("/bed")?,
        any: vec!["south".to_owned()],
    };
    let queries = [
        asking(decl, &texts),
        RecordMatch {
            k: 1,
            ..asking(decl, &texts)
        },
        RecordMatch {
            keys: vec![south],
            ..asking(decl, &texts)
        },
        RecordMatch {
            exclude: owned(&["b", "a", "e"]),
            ..asking(decl, &texts)
        },
        asking(decl, &texts[2..3]),
    ];
    let mut out = Vec::new();
    for (index, query) in queries.iter().enumerate() {
        out.push(format!(
            "query {index}: {}",
            page_shown(&run(d, decl, query, who)?)
        ));
    }
    Ok(out.join("\n"))
}

fn differential(env: &Env<'_>) -> CaseResult {
    let Some((s, open)) = lane(env)? else {
        return skip(NO_LANE);
    };
    // Under the cap, with room: the differential holds wherever a call is answered.
    let limits = LaneLimits {
        match_postings: 2_000,
        gather_postings: 2,
        ..LaneLimits::default()
    };
    let d = open(s.dir.path(), SPACE, limits).ctx("a store with its bounds lowered")?;
    let d = &*d;
    let decl = decl()?;
    let readable = [
        ("b", "Mulch keeps the soil cool.", "south"),
        ("d", "Mulch holds water through summer.", "south"),
        ("f", "Water tomatoes at the base.", "north"),
        ("h", "Compost feeds the soil.", "south"),
        ("j", "Mulch the roses in autumn.", "north"),
    ];
    for (id, statement, bed) in readable {
        put(d, &decl, id, note(statement, bed), &["space"])?;
    }
    let before = everything(d, &decl, &everyone())?;
    ensure(
        before.contains("\"cut\":true") && before.contains("\"cut\":false"),
        "the reads hold a cut gather and an uncut one",
    )?;
    // Records the reader cannot read: between its own by id and by lane, sharing their words
    // and their keys, some of them the very texts it matches.
    let hidden = [
        ("a", "group:other"),
        ("c", "principal:human:local"),
        ("e", "group:other"),
        ("g", "group:growers"),
        ("i", "group:other"),
    ];
    for (id, access) in hidden {
        put(
            d,
            &decl,
            id,
            note("Mulch the soil and water the roses.", "south"),
            &[access],
        )?;
    }
    ensure_eq(
        everything(d, &decl, &everyone())?,
        before.clone(),
        "after records the reader cannot read are written",
    )?;
    for (id, access) in hidden {
        put(
            d,
            &decl,
            id,
            note("Soil, soil and mulch: water it.", "north"),
            &[access],
        )?;
    }
    ensure_eq(
        everything(d, &decl, &everyone())?,
        before.clone(),
        "after records the reader cannot read are changed",
    )?;
    d.reindex_records(NS, &decl, &no_scan, None, false)
        .ctx("reindex_records")?;
    ensure_eq(
        everything(d, &decl, &everyone())?,
        before.clone(),
        "after the kind is reindexed",
    )?;
    // The same reads, for a reader of the hidden records, are other reads: the case has teeth.
    let theirs = everything(d, &decl, &reader(&["space", "group:other"]))?;
    ensure(
        theirs != before && theirs.contains("Soil, soil and mulch"),
        "the unreadable records are there for those who may read them",
    )?;
    pass()
}

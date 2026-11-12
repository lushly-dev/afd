//! Group `lane`: a declared kind's records, indexed in the transaction that writes them and found
//! by key and by text (records host specification, sections 4.2, 5, 7 and 12.1; D163, D164).
//!
//! Every case reaches the backend through [`DocumentStore`]'s lane methods alone. A backend
//! without a record lane says so with `Stores::lane` and the group is skipped. Two cases need a
//! bound passed with a handful of records, so they open their store through [`LaneOpen`] with
//! [`LaneLimits`] lowered. Every text is invented and about gardening.

use std::collections::BTreeMap;
use std::panic::{AssertUnwindSafe, catch_unwind, resume_unwind};
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};

use serde_json::{Value, json};

use super::{
    CaseResult, Ctx, Env, Fresh, SPACE, conflict, ensure, ensure_eq, everyone, expect_err, invalid,
    pass, reader, samples, skip,
};
use crate::lane::score::{Corpus, Posting, round4, score};
use crate::lane::{
    DeclaredPut, FindOrder, FindPage, KeyFilter, LaneLimits, LaneRecord, LaneState, LaneWrite,
    Pointer, RecordDecl, RecordFind, Standing, StandingView, TextQuery, match_digest,
};
use crate::memory::tokenizer::tokens;
use crate::{DocumentStore, Expect, MemoryFlag, ModelId, ReaderFilter, StoreError, canonical_json};

/// Opens the document store of a space under a directory with the record lane's bounds set to
/// the given ones: how the suite passes a bound with a handful of records.
pub type LaneOpen = fn(&Path, &str, LaneLimits) -> Result<Arc<dyn DocumentStore>, StoreError>;

pub(super) const CASES: &[(&str, super::CaseFn)] = &[
    (
        "a_declared_put_writes_its_lane_and_an_undeclared_put_writes_none",
        declared_and_undeclared,
    ),
    (
        "a_later_put_keeps_the_access_set_and_an_unreadable_id_is_taken",
        access_is_kept,
    ),
    (
        "extract_refuses_naming_the_pointer_and_never_the_value",
        extract_refusals,
    ),
    (
        "a_put_is_found_by_the_next_read_on_another_handle",
        found_at_once,
    ),
    (
        "key_filters_are_any_of_within_a_key_and_all_of_across_keys",
        key_filters,
    ),
    (
        "the_three_orders_page_by_page_to_the_end_with_their_totals",
        orders_and_cursors,
    ),
    ("ids_are_ordered_by_their_bytes", ids_by_bytes),
    (
        "a_text_query_ranks_the_fixture_as_the_formulas_do",
        fixture_order,
    ),
    (
        "cut_only_when_the_rarest_terms_postings_pass_the_bound_after_every_clause",
        cut_and_too_broad,
    ),
    (
        "a_changed_declaration_refuses_every_service_and_a_rebuild_clears_it",
        changed_declaration,
    ),
    (
        "records_written_before_a_declaration_wait_for_a_rebuild",
        records_predate,
    ),
    (
        "an_undeclared_put_on_a_declared_kind_makes_it_stale",
        undeclared_put,
    ),
    (
        "a_rebuild_stopped_after_a_chunk_leaves_the_kind_stale_and_a_second_run_finishes_it",
        stopped_rebuild,
    ),
    (
        "a_reader_never_sees_a_record_it_may_not_read",
        unreadable_never_seen,
    ),
    (
        "a_ranking_counts_only_what_its_reader_may_read",
        statistics_are_the_readers,
    ),
    (
        "records_a_reader_cannot_read_change_no_read_of_its_own",
        differential,
    ),
];

pub(super) const NO_LANE: &str = "this backend has no record lane";
pub(super) const NS: &str = "notes";
pub(super) const AT: &str = "2026-11-02T10:00:00.000Z";
const FIXTURE: &str = include_str!("../../fixtures/lane/records.json");

pub(super) fn pointer(text: &str) -> Result<Pointer, String> {
    Pointer::parse(text).ctx("a pointer")
}

/// A kind `note` without standing: two text pointers, two key pointers, the first text matched.
fn decl() -> Result<RecordDecl, String> {
    Ok(RecordDecl {
        kind: "note".to_owned(),
        standing: false,
        text: vec![pointer("/statement")?, pointer("/why")?],
        keys: vec![pointer("/bed")?, pointer("/tags")?],
        matched: Some(0),
    })
}

/// A view that admits every standing: what the host builds for a call that asks for all.
fn view() -> StandingView {
    StandingView {
        own: Vec::new(),
        command_writable: Vec::new(),
        person: Vec::new(),
        admit: vec![Standing::Unverified, Standing::Attested, Standing::Affirmed],
    }
}

/// A writer that may read every record the suite writes.
pub(super) fn writer() -> ReaderFilter {
    reader(&[
        "space",
        "group:growers",
        "group:other",
        "principal:human:local",
    ])
}

pub(super) fn no_scan(_text: &str) -> Vec<MemoryFlag> {
    Vec::new()
}

/// Fresh stores, or `None` for a backend without a record lane.
pub(super) fn lane(env: &Env<'_>) -> Result<Option<(Fresh, LaneOpen)>, String> {
    let fresh = env.fresh()?;
    Ok(fresh.stores.lane.map(|open| (fresh, open)))
}

fn write(flags: &[MemoryFlag]) -> LaneWrite {
    LaneWrite {
        evidence: None,
        flags: flags.to_vec(),
        model: None,
    }
}

fn put(
    d: &dyn DocumentStore,
    decl: &RecordDecl,
    id: &str,
    body: Value,
    access: &[&str],
) -> Result<DeclaredPut, StoreError> {
    d.put_declared_record(
        NS,
        decl,
        id,
        body,
        samples::envelope(access, "lane", AT),
        Expect::Any,
        write(&[]),
        &writer(),
    )
}

/// A body with a statement, a bed and tags.
fn note(statement: &str, bed: &str, tags: &[&str]) -> Value {
    json!({ "statement": statement, "bed": bed, "tags": tags })
}

/// A find of everything of the kind, by id, counted.
fn all(decl: &RecordDecl) -> RecordFind {
    RecordFind {
        kind: decl.kind.clone(),
        keys: Vec::new(),
        standings: Vec::new(),
        verified_only: false,
        text: None,
        order: FindOrder::Id,
        after: None,
        limit: 200,
        total: true,
    }
}

pub(super) fn text(query: &str) -> Option<TextQuery> {
    Some(TextQuery {
        query: query.to_owned(),
        fields: Vec::new(),
    })
}

fn key(pointer_text: &str, any: &[&str]) -> Result<KeyFilter, String> {
    Ok(KeyFilter {
        key: pointer(pointer_text)?,
        any: any.iter().map(|value| (*value).to_owned()).collect(),
    })
}

pub(super) fn ids(page: &FindPage) -> Vec<&str> {
    page.items
        .iter()
        .map(|item| item.record.id.as_str())
        .collect()
}

fn find(
    d: &dyn DocumentStore,
    decl: &RecordDecl,
    query: &RecordFind,
    who: &ReaderFilter,
) -> Result<FindPage, String> {
    d.find_records(NS, decl, query, &view(), who)
        .ctx("find_records")
}

/// Every page of `query` at `limit` a page, by its cursors, to the end: the ids in order, each
/// page's total and whether any page was cut.
fn walk(
    d: &dyn DocumentStore,
    decl: &RecordDecl,
    query: &RecordFind,
    limit: u32,
    who: &ReaderFilter,
) -> Result<(Vec<String>, Vec<Option<u64>>), String> {
    let mut query = RecordFind {
        limit,
        after: None,
        ..query.clone()
    };
    let mut found = Vec::new();
    let mut totals = Vec::new();
    for _ in 0..1000 {
        let page = find(d, decl, &query, who)?;
        ensure(
            page.items.len() <= limit as usize,
            "a page holds at most its limit",
        )?;
        found.extend(page.items.iter().map(|item| item.record.id.clone()));
        totals.push(page.total);
        match page.next {
            Some(next) => query.after = Some(next),
            None => return Ok((found, totals)),
        }
    }
    Err("the cursors never ended".to_owned())
}

fn stale(error: &StoreError) -> bool {
    matches!(error, StoreError::LaneStale)
}

fn declared_and_undeclared(env: &Env<'_>) -> CaseResult {
    let Some((s, _)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let d = &*s.stores.documents;
    let decl = decl()?;
    let statement = "Mulch keeps the soil cool and holds water through summer.";
    let model = ModelId::parse("potion@0123456789abcdef").ctx("a model id")?;
    let done = d
        .put_declared_record(
            NS,
            &decl,
            "a",
            note(statement, "south", &["soil", "watering"]),
            samples::envelope(&["space"], "lane", AT),
            Expect::Absent,
            LaneWrite {
                evidence: None,
                flags: vec![MemoryFlag::InstructionLike],
                model: Some(model),
            },
            &writer(),
        )
        .ctx("a declared put")?;
    ensure_eq(done.meta.rev, 1, "the put takes the next revision")?;
    ensure_eq(
        done.embed,
        match_digest(statement),
        "a record with a match value and no vector of the write's model asks for one",
    )?;
    let status = d.lane_status(NS, &decl).ctx("lane_status")?;
    ensure_eq(
        status.state,
        LaneState::Ready,
        "a declared put leaves the kind ready",
    )?;
    ensure_eq(
        status.stored,
        Some(canonical_json(&decl.to_json())),
        "the store keeps the declaration",
    )?;
    ensure_eq(
        (status.records, status.unindexed, status.with_match),
        (1, 0, 1),
        "the record has its lane row",
    )?;
    ensure_eq(
        (status.affirmed, status.evidence, status.vectors.len()),
        (0, 0, 0),
        "a put writes no standing and no vector",
    )?;
    let got = d
        .read_record(NS, &decl, "a", &view(), &everyone())
        .ctx("read_record")?
        .ok_or("the record is not readable")?;
    ensure_eq(got.record.rev, 1, "the record's revision")?;
    ensure_eq(
        got.created_at.as_str(),
        AT,
        "created at the first put's time",
    )?;
    ensure_eq(
        got.flags,
        vec![MemoryFlag::InstructionLike],
        "the scan's findings are kept with the lane row",
    )?;
    ensure(got.label.is_none(), "a kind without standing has no label")?;
    let no_match = put(d, &decl, "b", json!({ "bed": "north" }), &["space"]).ctx("keys alone")?;
    ensure(
        no_match.embed.is_none(),
        "no match value and no model asks for no vector",
    )?;
    // The path an undeclared kind takes writes no lane row and no declaration row.
    d.put_record(
        NS,
        "plain",
        "p",
        note("Tomatoes need six hours of sun.", "south", &[]),
        samples::envelope(&["space"], "lane", AT),
        Expect::Absent,
    )
    .ctx("an undeclared put")?;
    let plain = RecordDecl {
        kind: "plain".to_owned(),
        ..decl.clone()
    };
    let status = d.lane_status(NS, &plain).ctx("lane_status")?;
    ensure_eq(
        (status.records, status.unindexed, status.stored),
        (1, 1, None),
        "an undeclared put writes no lane row and no declaration row",
    )?;
    // A derivation read is refused: the lane is never read without a reader.
    let derivation = ReaderFilter::derivation();
    expect_err(
        d.read_record(NS, &decl, "a", &view(), &derivation),
        "a derivation read",
        invalid,
    )?;
    expect_err(
        d.find_records(NS, &decl, &all(&decl), &view(), &derivation),
        "a derivation find",
        invalid,
    )?;
    expect_err(
        d.put_declared_record(
            NS,
            &decl,
            "c",
            json!({}),
            samples::envelope(&["space"], "lane", AT),
            Expect::Any,
            write(&[]),
            &derivation,
        ),
        "a derivation writer",
        invalid,
    )?;
    pass()
}

fn access_is_kept(env: &Env<'_>) -> CaseResult {
    let Some((s, _)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let d = &*s.stores.documents;
    let decl = decl()?;
    let first = put(
        d,
        &decl,
        "a",
        note("Prune roses in late winter.", "north", &[]),
        &["space"],
    )
    .ctx("the first put")?;
    // A later put never changes who reads a declared record, whatever its envelope says.
    put(
        d,
        &decl,
        "a",
        note("Prune roses before the buds swell.", "east", &[]),
        &["group:growers"],
    )
    .ctx("a later put")?;
    let got = d
        .read_record(NS, &decl, "a", &view(), &everyone())
        .ctx("read")?
        .ok_or("the record left its first readers")?;
    ensure_eq(
        got.record.envelope.access.clone(),
        vec!["space".to_owned()],
        "the stored envelope carries the stored access set",
    )?;
    ensure_eq(
        got.record.body["bed"].clone(),
        json!("east"),
        "the body is the later one",
    )?;
    ensure_eq(got.created_at.as_str(), AT, "the first put's time is kept")?;
    ensure(
        d.read_record(NS, &decl, "a", &view(), &reader(&["group:growers"]))
            .ctx("read")?
            .is_none(),
        "the later envelope's readers gained nothing",
    )?;
    // To a writer who may not read it the id is taken, and nothing more is said.
    let outsider = reader(&["group:other"]);
    let refused = d.put_declared_record(
        NS,
        &decl,
        "a",
        note("Roses want sun.", "north", &[]),
        samples::envelope(&["group:other"], "lane", AT),
        Expect::Any,
        write(&[]),
        &outsider,
    );
    ensure_eq(
        refused.err(),
        Some(StoreError::Conflict { current: None }),
        "an existing record the writer may not read",
    )?;
    // `expect` is a compare-and-set against the stored content hash.
    let absent = d.put_declared_record(
        NS,
        &decl,
        "a",
        note("Roses want sun.", "north", &[]),
        samples::envelope(&["space"], "lane", AT),
        Expect::Absent,
        write(&[]),
        &writer(),
    );
    expect_err(absent, "Absent against a stored record", conflict)?;
    let stale_hash = d.put_declared_record(
        NS,
        &decl,
        "a",
        note("Roses want sun.", "north", &[]),
        samples::envelope(&["space"], "lane", AT),
        Expect::Hash(first.meta.content_hash),
        write(&[]),
        &writer(),
    );
    expect_err(stale_hash, "an earlier version's hash", conflict)?;
    ensure_eq(d.head().ctx("head")?, 2, "refused puts took no revision")?;
    pass()
}

fn extract_refusals(env: &Env<'_>) -> CaseResult {
    let Some((s, _)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let d = &*s.stores.documents;
    let decl = decl()?;
    let long = "x".repeat(crate::lane::MAX_LANE_TEXT_BYTES + 1);
    let many: Vec<String> = (0..=crate::lane::MAX_KEY_VALUES)
        .map(|n| format!("tag-{n}"))
        .collect();
    let cases = [
        (json!({ "statement": 7 }), "/statement"),
        (json!({ "statement": long }), "/statement"),
        (json!({ "why": ["canary"] }), "/why"),
        (json!({ "bed": { "canary": 1 } }), "/bed"),
        (json!({ "bed": "" }), "/bed"),
        (json!({ "tags": ["soil", 3] }), "/tags"),
        (json!({ "tags": ["canary\u{1}"] }), "/tags"),
        (json!({ "tags": many }), "/tags"),
    ];
    for (body, named) in cases {
        match put(d, &decl, "a", body, &["space"]) {
            Err(StoreError::Invalid(why)) => {
                ensure(
                    why.contains(&format!("the value at {named} must be")),
                    &format!("the refusal names {named}: {why}"),
                )?;
                ensure(!why.contains("canary"), "a refusal never holds the value")?;
            }
            other => return Err(format!("{named}: expected a refusal, got {other:?}")),
        }
    }
    ensure_eq(d.head().ctx("head")?, 0, "refusals took no revision")?;
    // Absent and null are no value, at a text pointer and at a key pointer.
    put(
        d,
        &decl,
        "a",
        json!({ "statement": null, "tags": null, "other": 7 }),
        &["space"],
    )
    .ctx("absent and null values")?;
    pass()
}

fn found_at_once(env: &Env<'_>) -> CaseResult {
    let Some((s, _)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let decl = decl()?;
    let other = (env.factory)(s.dir.path(), SPACE).map_err(|e| format!("a second handle: {e}"))?;
    let (first, second) = (&*s.stores.documents, &*other.documents);
    put(
        first,
        &decl,
        "a",
        note("Water tomatoes at the base.", "south", &["tomatoes"]),
        &["space"],
    )
    .ctx("a put on the first handle")?;
    let by_text = RecordFind {
        text: text("tomatoes"),
        order: FindOrder::Rank,
        ..all(&decl)
    };
    let by_key = RecordFind {
        keys: vec![key("/tags", &["tomatoes"])?],
        ..all(&decl)
    };
    ensure_eq(
        ids(&find(second, &decl, &by_text, &everyone())?),
        vec!["a"],
        "found by words on another handle when the put returns",
    )?;
    ensure_eq(
        ids(&find(second, &decl, &by_key, &everyone())?),
        vec!["a"],
        "found by key on another handle when the put returns",
    )?;
    put(
        second,
        &decl,
        "b",
        note("Tomatoes need steady watering.", "south", &["tomatoes"]),
        &["space"],
    )
    .ctx("a put on the second handle")?;
    ensure_eq(
        ids(&find(first, &decl, &by_key, &everyone())?),
        vec!["a", "b"],
        "two captures in a row find each other",
    )?;
    ensure_eq(
        find(first, &decl, &by_text, &everyone())?.total,
        Some(2),
        "and are counted",
    )?;
    pass()
}

fn key_filters(env: &Env<'_>) -> CaseResult {
    let Some((s, _)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let d = &*s.stores.documents;
    let decl = decl()?;
    let records = [
        (
            "a",
            note(
                "Prune roses in late winter.",
                "north",
                &["roses", "pruning"],
            ),
        ),
        (
            "b",
            note("Mulch keeps the soil cool.", "south", &["soil", "watering"]),
        ),
        (
            "c",
            note(
                "Water tomatoes at the base.",
                "south",
                &["tomatoes", "watering"],
            ),
        ),
        ("d", note("Roses want morning sun.", "east", &["roses"])),
        (
            "e",
            json!({ "statement": "Compost feeds the soil.", "why": "Roses are hungry." }),
        ),
    ];
    for (id, body) in records {
        put(d, &decl, id, body, &["space"]).ctx("put")?;
    }
    let with = |keys: Vec<KeyFilter>| RecordFind { keys, ..all(&decl) };
    let found = |query: &RecordFind| -> Result<(Vec<String>, Option<u64>), String> {
        let page = find(d, &decl, query, &everyone())?;
        Ok((
            ids(&page).into_iter().map(str::to_owned).collect(),
            page.total,
        ))
    };
    let owned = |list: &[&str]| -> Vec<String> { list.iter().map(|id| (*id).to_owned()).collect() };
    ensure_eq(
        found(&with(vec![key("/bed", &["north", "east"])?]))?,
        (owned(&["a", "d"]), Some(2)),
        "any-of within a key",
    )?;
    ensure_eq(
        found(&with(vec![key("/tags", &["watering"])?]))?,
        (owned(&["b", "c"]), Some(2)),
        "a list's values are each a key value",
    )?;
    ensure_eq(
        found(&with(vec![
            key("/tags", &["roses", "watering"])?,
            key("/bed", &["south", "east"])?,
        ]))?,
        (owned(&["b", "c", "d"]), Some(3)),
        "all-of across keys",
    )?;
    ensure_eq(
        found(&with(vec![
            key("/tags", &["roses"])?,
            key("/tags", &["pruning"])?,
        ]))?,
        (owned(&["a"]), Some(1)),
        "two filters on one key must both pass",
    )?;
    ensure_eq(
        found(&with(vec![key("/bed", &["west"])?]))?,
        (Vec::new(), Some(0)),
        "a value no record holds",
    )?;
    // The text of a find under order `id` is one more filter, over the fields it names.
    let in_fields = |query: &str, fields: &[&str]| -> Result<RecordFind, String> {
        Ok(RecordFind {
            text: Some(TextQuery {
                query: query.to_owned(),
                fields: fields
                    .iter()
                    .map(|field| pointer(field))
                    .collect::<Result<_, _>>()?,
            }),
            ..all(&decl)
        })
    };
    ensure_eq(
        found(&in_fields("roses", &[])?)?,
        (owned(&["a", "d", "e"]), Some(3)),
        "no field named searches every text pointer",
    )?;
    ensure_eq(
        found(&in_fields("roses", &["/why"])?)?,
        (owned(&["e"]), Some(1)),
        "a named field alone is searched",
    )?;
    ensure_eq(
        found(&RecordFind {
            keys: vec![key("/bed", &["east"])?],
            ..in_fields("ROSE soil", &["/statement"])?
        })?,
        (owned(&["d"]), Some(1)),
        "text and keys together, the query tokenised as the records were",
    )?;
    expect_err(
        d.find_records(
            NS,
            &decl,
            &with(vec![key("/statement", &["x"])?]),
            &view(),
            &everyone(),
        ),
        "a filter on a pointer that is not a key pointer",
        invalid,
    )?;
    pass()
}

fn orders_and_cursors(env: &Env<'_>) -> CaseResult {
    let Some((s, _)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let d = &*s.stores.documents;
    let decl = decl()?;
    // Put in this order, so revisions 1 to 7; `g` then gets a later version, which moves nothing.
    let records = [
        ("d", "Mulch the roses in autumn."),
        ("a", "Roses want mulch, and more mulch."),
        ("g", "Water the tomatoes."),
        ("b", "Mulch holds water."),
        ("f", "Prune the roses."),
        ("c", "Tomatoes want sun."),
        ("e", "Mulch, mulch and mulch again for roses."),
    ];
    for (id, statement) in records {
        put(d, &decl, id, note(statement, "north", &[]), &["space"]).ctx("put")?;
    }
    put(
        d,
        &decl,
        "g",
        note("Water the tomatoes at the base.", "south", &[]),
        &["space"],
    )
    .ctx("a later version")?;
    let owned = |list: &[&str]| -> Vec<String> { list.iter().map(|id| (*id).to_owned()).collect() };
    let by_id = all(&decl);
    let by_recent = RecordFind {
        order: FindOrder::Recent,
        ..all(&decl)
    };
    let by_rank = RecordFind {
        text: text("mulch roses"),
        order: FindOrder::Rank,
        ..all(&decl)
    };
    let filtered = RecordFind {
        text: text("mulch roses"),
        ..all(&decl)
    };
    let whole = find(d, &decl, &by_rank, &everyone())?;
    let ranked: Vec<String> = ids(&whole).into_iter().map(str::to_owned).collect();
    ensure_eq(
        {
            let mut sorted = ranked.clone();
            sorted.sort();
            sorted
        },
        owned(&["a", "b", "d", "e", "f"]),
        "the candidates hold a term of the query",
    )?;
    ensure(!whole.cut, "nothing is cut under the bound")?;
    ensure(whole.next.is_none(), "one page holds every candidate")?;
    let expected = [
        (&by_id, owned(&["a", "b", "c", "d", "e", "f", "g"]), 7),
        (&by_recent, owned(&["e", "c", "f", "b", "g", "a", "d"]), 7),
        (&filtered, owned(&["a", "b", "d", "e", "f"]), 5),
        (&by_rank, ranked, 5),
    ];
    for (query, order, total) in &expected {
        for limit in [1, 2, 3, 7] {
            let (found, totals) = walk(d, &decl, query, limit, &everyone())?;
            ensure_eq(
                &found,
                order,
                &format!("order {} in pages of {limit}", query.order.as_str()),
            )?;
            ensure(
                totals.iter().all(|counted| *counted == Some(*total)),
                &format!(
                    "every page of order {} counts {total}",
                    query.order.as_str()
                ),
            )?;
        }
    }
    let uncounted = find(
        d,
        &decl,
        &RecordFind {
            total: false,
            ..by_id.clone()
        },
        &everyone(),
    )?;
    ensure(
        uncounted.total.is_none(),
        "a total is counted only when asked",
    )?;
    ensure_eq(
        uncounted.admitted,
        view().admit,
        "the page says what the view admitted",
    )?;
    // A cursor is for the order that gave it.
    let first = find(
        d,
        &decl,
        &RecordFind {
            limit: 2,
            ..by_id.clone()
        },
        &everyone(),
    )?;
    let next = first.next.ok_or("a first page of 2 of 7 has a cursor")?;
    for other in [&by_recent, &by_rank] {
        expect_err(
            d.find_records(
                NS,
                &decl,
                &RecordFind {
                    after: Some(next.clone()),
                    ..(*other).clone()
                },
                &view(),
                &everyone(),
            ),
            "a cursor of another order",
            invalid,
        )?;
    }
    for (query, what) in [
        (
            RecordFind {
                limit: 0,
                ..by_id.clone()
            },
            "a zero limit",
        ),
        (
            RecordFind {
                limit: 201,
                ..by_id.clone()
            },
            "a limit past 200",
        ),
        (
            RecordFind {
                order: FindOrder::Rank,
                ..by_id.clone()
            },
            "rank without a text",
        ),
        (
            RecordFind {
                text: text("..."),
                ..by_id.clone()
            },
            "a text with no token",
        ),
        (
            RecordFind {
                verified_only: true,
                ..by_id.clone()
            },
            "a standing filter on a kind without standing",
        ),
    ] {
        expect_err(
            d.find_records(NS, &decl, &query, &view(), &everyone()),
            what,
            invalid,
        )?;
    }
    pass()
}

fn ids_by_bytes(env: &Env<'_>) -> CaseResult {
    let Some((s, _)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let d = &*s.stores.documents;
    let decl = decl()?;
    let mut written = ["b", "B", "a", "é", "Z", "aa", "ü", "A/b", "a b"].map(str::to_owned);
    for id in &written {
        put(
            d,
            &decl,
            id,
            note("Roses want sun.", "north", &[]),
            &["space"],
        )
        .ctx("put")?;
    }
    // Rust orders strings by the bytes of their UTF-8, which is the order asked for.
    written.sort();
    for limit in [2, 200] {
        let (found, _) = walk(d, &decl, &all(&decl), limit, &everyone())?;
        ensure_eq(
            found.as_slice(),
            written.as_slice(),
            "ids in byte order, upper case first and non-ASCII last",
        )?;
    }
    for id in &written {
        let got = d
            .read_record(NS, &decl, id, &view(), &everyone())
            .ctx("read")?;
        ensure_eq(
            got.map(|record| record.record.id),
            Some(id.clone()),
            "each id reads back as itself",
        )?;
    }
    pass()
}

/// The fixture's declaration and records.
fn fixture() -> Result<(RecordDecl, Value), String> {
    let fixture: Value = serde_json::from_str(FIXTURE)
        .map_err(|e| format!("the lane fixture does not parse: {e}"))?;
    let declared = &fixture["declaration"];
    let pointers = |member: &str| -> Result<Vec<Pointer>, String> {
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

/// The order section 7 gives a ranked find of `query` over `records` (id, first revision and
/// match text), computed from the formulas alone: `score(q, d)` at four places descending, then
/// the first revision descending, then the id, over the records that share a term with it. The
/// statistics (`N`, `L` and each term's count) are taken over `corpus`, which for a store that
/// counts only what its reader may read is `records` itself.
pub(super) fn ranked_by_the_formulas(
    query: &str,
    records: &[(String, u64, String)],
    corpus: &[(String, u64, String)],
) -> Vec<String> {
    let counted = |text: &str| -> BTreeMap<String, u32> {
        let mut counts = BTreeMap::new();
        for token in tokens(text) {
            *counts.entry(token).or_default() += 1;
        }
        counts
    };
    let held: Vec<BTreeMap<String, u32>> =
        corpus.iter().map(|(_, _, text)| counted(text)).collect();
    let statistics = Corpus {
        records: corpus.len() as u64,
        tokens: held
            .iter()
            .map(|counts| u64::from(counts.values().sum::<u32>()))
            .sum(),
    };
    let asked = counted(query);
    let mut scored: Vec<(f64, u64, &str)> = records
        .iter()
        .map(|(id, created, text)| (id, created, counted(text)))
        .filter(|(_, _, terms)| asked.keys().any(|term| terms.contains_key(term)))
        .map(|(id, created, terms)| {
            let postings = asked.keys().filter_map(|term| {
                let tf = terms.get(term).copied()?;
                let df = held.iter().filter(|other| other.contains_key(term)).count() as u64;
                Some(Posting { df, tf })
            });
            let length = terms.values().sum::<u32>();
            (
                round4(score(&statistics, length, postings)),
                *created,
                id.as_str(),
            )
        })
        .collect();
    scored.sort_by(|a, b| {
        b.0.total_cmp(&a.0)
            .then_with(|| b.1.cmp(&a.1))
            .then_with(|| a.2.as_bytes().cmp(b.2.as_bytes()))
    });
    scored.into_iter().map(|(_, _, id)| id.to_owned()).collect()
}

fn fixture_order(env: &Env<'_>) -> CaseResult {
    let Some((s, _)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let d = &*s.stores.documents;
    let (decl, fixture) = fixture()?;
    let match_pointer = decl
        .match_pointer()
        .ok_or("the fixture has a match field")?;
    let mut records = Vec::new();
    for record in fixture["records"]
        .as_array()
        .ok_or("the fixture has records")?
    {
        let id = record["id"].as_str().unwrap_or_default();
        let access: Vec<&str> = record["access"]
            .as_array()
            .map(|tokens| tokens.iter().filter_map(Value::as_str).collect())
            .unwrap_or_default();
        let done = put(d, &decl, id, record["body"].clone(), &access).ctx("a fixture record")?;
        let statement = match_pointer
            .get(&record["body"])
            .and_then(Value::as_str)
            .unwrap_or_default();
        records.push((id.to_owned(), done.meta.rev, statement.to_owned()));
    }
    let matches = fixture["matches"]
        .as_array()
        .ok_or("the fixture has texts")?;
    ensure(!matches.is_empty(), "the fixture has texts to rank")?;
    for matched in matches {
        let query = matched["text"].as_str().unwrap_or_default();
        let page = find(
            d,
            &decl,
            &RecordFind {
                text: text(query),
                order: FindOrder::Rank,
                ..all(&decl)
            },
            &everyone(),
        )?;
        let expected = ranked_by_the_formulas(query, &records, &records);
        ensure_eq(
            ids(&page)
                .into_iter()
                .map(str::to_owned)
                .collect::<Vec<_>>(),
            expected.clone(),
            "a ranked find orders as the formulas do",
        )?;
        ensure_eq(
            page.total,
            Some(expected.len() as u64),
            "and counts its candidates",
        )?;
        ensure(
            expected.len() >= 2 && expected[0] == "n1" && expected[1] == "n2",
            "the fixture's two rose records lead, as in the worked example",
        )?;
        ensure(
            !expected.iter().any(|id| id == "n3"),
            "a record that shares no term is no candidate",
        )?;
        // The fixture's kind has standing; with no standing fact it reads unverified.
        ensure(
            page.items.iter().all(|item| {
                item.label
                    .as_ref()
                    .is_some_and(|label| label.standing == Standing::Unverified)
            }),
            "a standing record with no standing fact reads unverified",
        )?;
    }
    pass()
}

fn cut_and_too_broad(env: &Env<'_>) -> CaseResult {
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
    let records = [
        ("a", "Mulch the roses.", "north"),
        ("b", "Mulch the tomatoes with straw.", "south"),
        ("c", "Mulch keeps the soil cool.", "north"),
        ("d", "Straw mulch holds water.", "south"),
        ("e", "Mulch in autumn.", "north"),
    ];
    for (id, statement, bed) in records {
        put(d, &decl, id, note(statement, bed, &[]), &["space"]).ctx("put")?;
    }
    let ranked = |query: &str, keys: Vec<KeyFilter>| RecordFind {
        text: text(query),
        order: FindOrder::Rank,
        keys,
        ..all(&decl)
    };
    let sorted = |page: &FindPage| -> Vec<String> {
        let mut found: Vec<String> = ids(page).into_iter().map(str::to_owned).collect();
        found.sort();
        found
    };
    let check = |who: &ReaderFilter, what: &str| -> Result<(), String> {
        let page = find(d, &decl, &ranked("mulch", Vec::new()), who)?;
        ensure(
            page.cut,
            &format!("{what}: the rarest term passes the bound"),
        )?;
        ensure_eq(
            (sorted(&page), page.total),
            (
                vec!["a".to_owned(), "b".to_owned(), "c".to_owned()],
                Some(3),
            ),
            &format!("{what}: the bound's first postings in lane order are ranked"),
        )?;
        let page = find(d, &decl, &ranked("mulch straw", Vec::new()), who)?;
        ensure(
            !page.cut,
            &format!("{what}: leaving a commoner term out of the gather cuts nothing"),
        )?;
        ensure_eq(
            sorted(&page),
            vec!["b".to_owned(), "d".to_owned()],
            &format!("{what}: the rarer term's records are the candidates"),
        )?;
        let page = find(
            d,
            &decl,
            &ranked("mulch", vec![key("/bed", &["south"])?]),
            who,
        )?;
        ensure(
            !page.cut,
            &format!("{what}: a key filter brings the postings under the bound"),
        )?;
        ensure_eq(
            (sorted(&page), page.total),
            (vec!["b".to_owned(), "d".to_owned()], Some(2)),
            &format!("{what}: every record that passes the filter is ranked"),
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
            note("Mulch and straw, mulch and straw.", "south", &[]),
            &["group:other"],
        )
        .ctx("an unreadable record")?;
    }
    check(&everyone(), "beside unreadable records")?;
    // A reader of two of the mulch records is under the bound.
    for id in ["p1", "p2"] {
        put(
            d,
            &decl,
            id,
            note("Mulch the beans.", "north", &[]),
            &["principal:human:local"],
        )
        .ctx("a private record")?;
    }
    let own = reader(&["principal:human:local"]);
    let page = find(d, &decl, &ranked("mulch", Vec::new()), &own)?;
    ensure(
        !page.cut,
        "a reader whose own postings are under the bound is not cut",
    )?;
    ensure_eq(
        sorted(&page),
        vec!["p1".to_owned(), "p2".to_owned()],
        "its own records",
    )?;
    // The work cap counts postings read, whoever may read them: ten records hold `mulch`.
    let capped = LaneLimits {
        stat_postings: 9,
        ..LaneLimits::default()
    };
    let capped = open(s.dir.path(), SPACE, capped).ctx("a store with a cap of 9 postings")?;
    for who in [everyone(), own] {
        ensure_eq(
            capped
                .find_records(NS, &decl, &ranked("mulch", Vec::new()), &view(), &who)
                .err(),
            Some(StoreError::LaneTooBroad { limit: 9 }),
            "past the cap a ranked find is refused, whatever the reader may read",
        )?;
    }
    let under = capped
        .find_records(
            NS,
            &decl,
            &ranked("beans", Vec::new()),
            &view(),
            &everyone(),
        )
        .ctx("a query under the cap")?;
    ensure(
        under.items.is_empty(),
        "under the cap the reader's answer is its own",
    )?;
    pass()
}

fn changed_declaration(env: &Env<'_>) -> CaseResult {
    let Some((s, _)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let d = &*s.stores.documents;
    let old = decl()?;
    put(
        d,
        &old,
        "a",
        note("Prune roses in late winter.", "north", &["roses"]),
        &["space"],
    )
    .ctx("put")?;
    put(
        d,
        &old,
        "b",
        note("Water tomatoes at the base.", "south", &["tomatoes"]),
        &["group:growers"],
    )
    .ctx("put")?;
    // The same pointers in another order are another declaration.
    let new = RecordDecl {
        keys: vec![pointer("/tags")?, pointer("/bed")?],
        text: vec![pointer("/statement")?],
        ..old.clone()
    };
    let status = d.lane_status(NS, &new).ctx("lane_status")?;
    ensure_eq(
        status.state,
        LaneState::Stale,
        "a changed declaration is stale",
    )?;
    ensure_eq(
        status.stored,
        Some(canonical_json(&old.to_json())),
        "the status holds the stored declaration",
    )?;
    expect_err(
        d.read_record(NS, &new, "a", &view(), &everyone()),
        "a read under a changed declaration",
        stale,
    )?;
    expect_err(
        d.find_records(NS, &new, &all(&new), &view(), &everyone()),
        "a find under a changed declaration",
        stale,
    )?;
    expect_err(
        put(
            d,
            &new,
            "c",
            note("Roses want sun.", "east", &[]),
            &["space"],
        ),
        "a put under a changed declaration",
        stale,
    )?;
    ensure_eq(d.head().ctx("head")?, 2, "the refused put took no revision")?;
    let report = d
        .reindex_records(NS, &new, &no_scan, None, false)
        .ctx("reindex_records")?;
    ensure_eq(
        (
            report.records,
            report.unindexed,
            report.wordings_changed,
            report.superseded,
        ),
        (2, 0, 2, false),
        "the rebuild indexed both records, whose wording is now one text value and was two",
    )?;
    ensure_eq(
        (report.vectors_written, report.vectors_removed),
        (0, 0),
        "a rebuild without a model writes no vector",
    )?;
    let status = d.lane_status(NS, &new).ctx("lane_status")?;
    ensure_eq(
        status.state,
        LaneState::Ready,
        "the rebuild clears the mark",
    )?;
    ensure_eq(
        status.stored,
        Some(canonical_json(&new.to_json())),
        "and stores the declaration",
    )?;
    let by_tag = RecordFind {
        keys: vec![key("/tags", &["roses"])?],
        ..all(&new)
    };
    ensure_eq(
        ids(&find(d, &new, &by_tag, &everyone())?),
        vec!["a"],
        "keys are found under the new declaration's positions",
    )?;
    let got = d
        .read_record(NS, &new, "a", &view(), &everyone())
        .ctx("read")?
        .ok_or("the record is not readable after the rebuild")?;
    ensure_eq(
        got.created_at.as_str(),
        AT,
        "a rebuild keeps the first put's time",
    )?;
    ensure(
        d.read_record(NS, &new, "b", &view(), &everyone())
            .ctx("read")?
            .is_none(),
        "a rebuild touches no access set",
    )?;
    expect_err(
        d.read_record(NS, &old, "a", &view(), &everyone()),
        "a read under the declaration that was replaced",
        stale,
    )?;
    // With `vectors_only` the rebuild is skipped: the kind stays as it was.
    let skipped = d
        .reindex_records(NS, &old, &no_scan, None, true)
        .ctx("vectors only")?;
    ensure_eq(skipped.records, 2, "it still counts the kind's records")?;
    ensure_eq(
        d.lane_status(NS, &new).ctx("lane_status")?.state,
        LaneState::Ready,
        "vectors only rebuilds nothing",
    )?;
    pass()
}

fn records_predate(env: &Env<'_>) -> CaseResult {
    let Some((s, _)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let d = &*s.stores.documents;
    let decl = decl()?;
    let undeclared = |id: &str, body: Value, access: &[&str], at: &str| {
        d.put_record(
            NS,
            &decl.kind,
            id,
            body,
            samples::envelope(access, "lane", at),
            Expect::Any,
        )
    };
    undeclared(
        "a",
        note("Prune roses in late winter.", "north", &["roses"]),
        &["space"],
        AT,
    )
    .ctx("put_record")?;
    undeclared(
        "b",
        note("Water tomatoes at the base.", "south", &[]),
        &["group:growers"],
        AT,
    )
    .ctx("put_record")?;
    // A body the declaration refuses, and a second version of the first record, a day later.
    undeclared("c", json!({ "statement": 7 }), &["space"], AT).ctx("put_record")?;
    undeclared(
        "a",
        note("Prune roses before the buds swell.", "north", &["roses"]),
        &["space"],
        "2026-11-03T10:00:00.000Z",
    )
    .ctx("put_record")?;
    let status = d.lane_status(NS, &decl).ctx("lane_status")?;
    ensure_eq(
        (
            status.state,
            status.stored,
            status.records,
            status.unindexed,
        ),
        (LaneState::Stale, None, 3, 3),
        "records written before a declaration make it stale",
    )?;
    expect_err(
        d.find_records(NS, &decl, &all(&decl), &view(), &everyone()),
        "a find before the rebuild",
        stale,
    )?;
    expect_err(
        put(
            d,
            &decl,
            "d",
            note("Roses want sun.", "east", &[]),
            &["space"],
        ),
        "a declared put before the rebuild",
        stale,
    )?;
    let flagged = |text: &str| -> Vec<MemoryFlag> {
        if text.contains("buds") {
            vec![MemoryFlag::HiddenText]
        } else {
            Vec::new()
        }
    };
    let report = d
        .reindex_records(NS, &decl, &flagged, None, false)
        .ctx("reindex_records")?;
    ensure_eq(
        (report.records, report.unindexed, report.superseded),
        (3, 1, false),
        "a body the declaration refuses is left without lane rows and counted",
    )?;
    let status = d.lane_status(NS, &decl).ctx("lane_status")?;
    ensure_eq(
        (status.state, status.unindexed),
        (LaneState::Ready, 1),
        "the kind is ready with one record unindexed",
    )?;
    let page = find(d, &decl, &all(&decl), &everyone())?;
    ensure_eq(
        ids(&page),
        vec!["a"],
        "the readable indexed record is found",
    )?;
    let got = &page.items[0];
    ensure_eq(
        got.created_at.as_str(),
        AT,
        "created at its first put's time, from the change log",
    )?;
    ensure_eq(
        got.flags.clone(),
        vec![MemoryFlag::HiddenText],
        "the rebuild scans each text value",
    )?;
    ensure_eq(got.record.rev, 4, "the record itself is as it was")?;
    ensure(
        d.read_record(NS, &decl, "c", &view(), &everyone())
            .ctx("read")?
            .is_none(),
        "an unindexed record is not read through the lane",
    )?;
    ensure_eq(
        ids(&find(d, &decl, &all(&decl), &reader(&["group:growers"]))?),
        vec!["b"],
        "a record keeps the access set it was written with",
    )?;
    // Under order `recent` the first revision counts, not the latest.
    let recent = RecordFind {
        order: FindOrder::Recent,
        ..all(&decl)
    };
    ensure_eq(
        ids(&find(d, &decl, &recent, &writer())?),
        vec!["b", "a"],
        "recency is by the first put",
    )?;
    // A put that makes the body acceptable gives the record its lane row, still at its first put.
    put(
        d,
        &decl,
        "c",
        note("Compost feeds the soil.", "east", &[]),
        &["group:other"],
    )
    .ctx("a put on an unindexed record")?;
    let got = d
        .read_record(NS, &decl, "c", &view(), &everyone())
        .ctx("read")?
        .ok_or("the record keeps its access set and is found")?;
    ensure_eq(
        got.created_at.as_str(),
        AT,
        "created at its first put's time",
    )?;
    ensure_eq(
        ids(&find(d, &decl, &recent, &writer())?),
        vec!["c", "b", "a"],
        "and at its first revision",
    )?;
    pass()
}

fn undeclared_put(env: &Env<'_>) -> CaseResult {
    let Some((s, _)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let d = &*s.stores.documents;
    let decl = decl()?;
    put(
        d,
        &decl,
        "a",
        note("Prune roses in late winter.", "north", &[]),
        &["space"],
    )
    .ctx("put")?;
    // A plugin version that drops the declaration writes through the undeclared path.
    d.put_record(
        NS,
        &decl.kind,
        "a",
        note("Prune roses in early spring.", "north", &[]),
        samples::envelope(&["space"], "lane", AT),
        Expect::Any,
    )
    .ctx("an undeclared put on a declared kind")?;
    ensure_eq(
        d.lane_status(NS, &decl).ctx("lane_status")?.state,
        LaneState::Stale,
        "an undeclared put marks the kind stale",
    )?;
    expect_err(
        d.read_record(NS, &decl, "a", &view(), &everyone()),
        "a read after an undeclared put",
        stale,
    )?;
    expect_err(
        d.find_records(NS, &decl, &all(&decl), &view(), &everyone()),
        "a find after an undeclared put",
        stale,
    )?;
    expect_err(
        put(
            d,
            &decl,
            "b",
            note("Roses want sun.", "east", &[]),
            &["space"],
        ),
        "a declared put after an undeclared put",
        stale,
    )?;
    // An undeclared put on another kind touches nothing of this one.
    d.reindex_records(NS, &decl, &no_scan, None, false)
        .ctx("reindex_records")?;
    d.put_record(
        NS,
        "plain",
        "p",
        json!({}),
        samples::envelope(&["space"], "lane", AT),
        Expect::Any,
    )
    .ctx("an undeclared put on another kind")?;
    ensure_eq(
        d.lane_status(NS, &decl).ctx("lane_status")?.state,
        LaneState::Ready,
        "the rebuild clears the mark, and another kind's put leaves it",
    )?;
    let by_text = |query: &str| RecordFind {
        text: text(query),
        ..all(&decl)
    };
    ensure_eq(
        ids(&find(d, &decl, &by_text("spring"), &everyone())?),
        vec!["a"],
        "the rebuild indexed the wording the undeclared put wrote",
    )?;
    ensure(
        find(d, &decl, &by_text("winter"), &everyone())?
            .items
            .is_empty(),
        "and dropped the terms of the one it replaced",
    )?;
    pass()
}

fn stopped_rebuild(env: &Env<'_>) -> CaseResult {
    let Some((s, open)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let decl = decl()?;
    // Two records to a chunk, five records: the rebuild takes three chunks.
    let limits = LaneLimits {
        reindex_chunk: 2,
        ..LaneLimits::default()
    };
    let d = open(s.dir.path(), SPACE, limits).ctx("a store with a chunk of 2")?;
    for id in ["a", "b", "c", "d", "e"] {
        d.put_record(
            NS,
            &decl.kind,
            id,
            note("Mulch keeps the soil cool.", "south", &["soil"]),
            samples::envelope(&["space"], "lane", AT),
            Expect::Absent,
        )
        .ctx("put_record")?;
    }
    // The scan is called once a text value, so its third call is in the second chunk. It stops
    // the rebuild there, as a crash would: the first chunk is committed and the second is not.
    let calls = AtomicU32::new(0);
    let stopping = |_text: &str| -> Vec<MemoryFlag> {
        if calls.fetch_add(1, Ordering::SeqCst) == 2 {
            resume_unwind(Box::new("the rebuild stops here"));
        }
        Vec::new()
    };
    let stopped = catch_unwind(AssertUnwindSafe(|| {
        d.reindex_records(NS, &decl, &stopping, None, false)
    }));
    ensure(stopped.is_err(), "the rebuild stopped in its second chunk")?;
    let status = d.lane_status(NS, &decl).ctx("lane_status")?;
    ensure_eq(
        (status.state, status.records, status.unindexed),
        (LaneState::Stale, 5, 3),
        "the first chunk is whole, the rest is not written, and the kind is stale",
    )?;
    expect_err(
        d.find_records(NS, &decl, &all(&decl), &view(), &everyone()),
        "a find on a kind whose rebuild stopped",
        stale,
    )?;
    let report = d
        .reindex_records(NS, &decl, &no_scan, None, false)
        .ctx("a second run")?;
    ensure_eq(
        (report.records, report.unindexed, report.superseded),
        (5, 0, false),
        "a second run finishes it",
    )?;
    let status = d.lane_status(NS, &decl).ctx("lane_status")?;
    ensure_eq(
        (status.state, status.unindexed),
        (LaneState::Ready, 0),
        "the kind is ready",
    )?;
    let (found, _) = walk(&*d, &decl, &all(&decl), 2, &everyone())?;
    ensure_eq(found.len(), 5, "every record is found once")?;
    pass()
}

fn unreadable_never_seen(env: &Env<'_>) -> CaseResult {
    let Some((s, _)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let d = &*s.stores.documents;
    let decl = decl()?;
    // The same words and keys in every record; only who may read differs.
    let records = [
        ("a", "space"),
        ("b", "group:growers"),
        ("c", "space"),
        ("d", "principal:human:local"),
        ("e", "group:growers"),
    ];
    for (id, access) in records {
        put(
            d,
            &decl,
            id,
            note("Mulch keeps the soil cool.", "south", &["soil"]),
            &[access],
        )
        .ctx("put")?;
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
    let queries = [
        ("by id", all(&decl)),
        (
            "by key",
            RecordFind {
                keys: vec![key("/tags", &["soil"])?],
                ..all(&decl)
            },
        ),
        (
            "by text",
            RecordFind {
                text: text("mulch"),
                ..all(&decl)
            },
        ),
        (
            "ranked",
            RecordFind {
                text: text("mulch soil"),
                order: FindOrder::Rank,
                ..all(&decl)
            },
        ),
        (
            "by recency",
            RecordFind {
                order: FindOrder::Recent,
                ..all(&decl)
            },
        ),
    ];
    for (who, filter, readable) in &readers {
        for (id, _) in records {
            let got = d.read_record(NS, &decl, id, &view(), filter).ctx("read")?;
            ensure_eq(
                got.is_some(),
                readable.contains(&id),
                &format!("{who} reads {id} only when it may"),
            )?;
        }
        for (what, query) in &queries {
            // One record a page, so every cursor is a place between two records.
            let (mut found, totals) = walk(d, &decl, query, 1, filter)?;
            found.sort();
            ensure_eq(
                found,
                readable
                    .iter()
                    .map(|id| (*id).to_owned())
                    .collect::<Vec<_>>(),
                &format!("{who}, {what}: the pages hold its own records and no other"),
            )?;
            ensure(
                totals
                    .iter()
                    .all(|total| *total == Some(readable.len() as u64)),
                &format!("{who}, {what}: the total counts its own records and no other"),
            )?;
        }
    }
    pass()
}

fn statistics_are_the_readers(env: &Env<'_>) -> CaseResult {
    let Some((s, _)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let d = &*s.stores.documents;
    let decl = decl()?;
    // Three records the reader may read and two it may not, chosen so that counting the two in
    // any statistic (the corpus's size, its tokens or a term's count) changes the order of the
    // three: a ranked page carries no score, so only its order can show what was counted.
    let readable = [
        ("a", "Mulch."),
        ("b", "Straw."),
        ("c", "Mulch, mulch, soil."),
    ];
    let hidden = [
        ("h1", "Mulch soil soil soil soil soil soil soil soil."),
        ("h2", "Mulch soil soil soil soil soil soil soil soil."),
    ];
    let mut own = Vec::new();
    let mut every = Vec::new();
    for (id, statement) in readable {
        let done = put(d, &decl, id, json!({ "statement": statement }), &["space"]).ctx("put")?;
        own.push((id.to_owned(), done.meta.rev, statement.to_owned()));
    }
    every.extend(own.iter().cloned());
    for (id, statement) in hidden {
        let done = put(
            d,
            &decl,
            id,
            json!({ "statement": statement }),
            &["group:other"],
        )
        .ctx("an unreadable record")?;
        every.push((id.to_owned(), done.meta.rev, statement.to_owned()));
    }
    let query = "mulch straw";
    let expected = ranked_by_the_formulas(query, &own, &own);
    ensure(
        expected != ranked_by_the_formulas(query, &own, &every),
        "the case has teeth: counting the unreadable records would change the order",
    )?;
    let ranked = RecordFind {
        text: text(query),
        order: FindOrder::Rank,
        ..all(&decl)
    };
    let page = find(d, &decl, &ranked, &everyone())?;
    ensure_eq(
        ids(&page)
            .into_iter()
            .map(str::to_owned)
            .collect::<Vec<_>>(),
        expected,
        "the order is the one the reader's own records give",
    )?;
    ensure_eq(page.total, Some(3), "and the total is theirs")?;
    // A reader of all five is ranked over all five.
    let all_five = ranked_by_the_formulas(query, &every, &every);
    let page = find(d, &decl, &ranked, &writer())?;
    ensure_eq(
        ids(&page)
            .into_iter()
            .map(str::to_owned)
            .collect::<Vec<_>>(),
        all_five,
        "a reader of every record is ranked over every record",
    )?;
    pass()
}

/// Everything `who` can read of the kind, as bytes: each record by id, and every page of each
/// query with its cursors, totals and `cut`.
fn everything(
    d: &dyn DocumentStore,
    decl: &RecordDecl,
    read: &[&str],
    who: &ReaderFilter,
) -> Result<String, String> {
    let shown = |record: &LaneRecord| canonical_json(&record.to_json());
    let mut out = Vec::new();
    for id in read {
        let got = d.read_record(NS, decl, id, &view(), who).ctx("read")?;
        out.push(format!("read {id}: {:?}", got.as_ref().map(shown)));
    }
    let queries = [
        all(decl),
        RecordFind {
            order: FindOrder::Recent,
            ..all(decl)
        },
        RecordFind {
            keys: vec![key("/bed", &["south", "north"])?, key("/tags", &["soil"])?],
            ..all(decl)
        },
        RecordFind {
            text: text("mulch soil water"),
            ..all(decl)
        },
        RecordFind {
            text: text("mulch soil water"),
            order: FindOrder::Rank,
            ..all(decl)
        },
        RecordFind {
            text: Some(TextQuery {
                query: "roses".to_owned(),
                fields: vec![pointer("/why")?],
            }),
            order: FindOrder::Rank,
            keys: vec![key("/bed", &["south"])?],
            ..all(decl)
        },
    ];
    for (index, query) in queries.iter().enumerate() {
        for limit in [2, 200] {
            let mut query = RecordFind {
                limit,
                ..query.clone()
            };
            for page_number in 0..1000 {
                let page = find(d, decl, &query, who)?;
                out.push(format!(
                    "query {index} limit {limit} page {page_number}: {:?} next {:?} total {:?} cut {} admitted {:?}",
                    page.items.iter().map(shown).collect::<Vec<_>>(),
                    page.next,
                    page.total,
                    page.cut,
                    page.admitted,
                ));
                match page.next {
                    Some(next) => query.after = Some(next),
                    None => break,
                }
            }
        }
    }
    Ok(out.join("\n"))
}

fn differential(env: &Env<'_>) -> CaseResult {
    let Some((s, _)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let d = &*s.stores.documents;
    let decl = decl()?;
    let with_why = |statement: &str, why: &str, bed: &str, tags: &[&str]| json!({ "statement": statement, "why": why, "bed": bed, "tags": tags });
    let readable = [
        (
            "b",
            with_why(
                "Mulch keeps the soil cool.",
                "Roses dislike dry roots.",
                "south",
                &["soil"],
            ),
        ),
        (
            "d",
            with_why(
                "Mulch holds water through summer.",
                "Bare soil dries.",
                "south",
                &["soil", "watering"],
            ),
        ),
        (
            "f",
            with_why(
                "Water tomatoes at the base.",
                "Wet leaves invite blight.",
                "north",
                &["tomatoes"],
            ),
        ),
        (
            "h",
            with_why(
                "Compost feeds the soil.",
                "Roses are hungry.",
                "south",
                &["soil"],
            ),
        ),
    ];
    for (id, body) in &readable {
        put(d, &decl, id, body.clone(), &["space"]).ctx("a readable record")?;
    }
    let read = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
    let before = everything(d, &decl, &read, &everyone())?;
    // Records the reader cannot read: between its own by id, after them by revision, sharing
    // their words and their keys.
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
            with_why(
                "Mulch the soil and water the roses.",
                "Roses want mulch.",
                "south",
                &["soil", "watering"],
            ),
            &[access],
        )
        .ctx("an unreadable record")?;
    }
    ensure_eq(
        everything(d, &decl, &read, &everyone())?,
        before.clone(),
        "after records the reader cannot read are written",
    )?;
    for (id, access) in hidden {
        put(
            d,
            &decl,
            id,
            with_why(
                "Soil, soil and mulch: water it.",
                "Tomatoes and roses.",
                "north",
                &["soil", "tomatoes"],
            ),
            &[access],
        )
        .ctx("an unreadable record, changed")?;
    }
    ensure_eq(
        everything(d, &decl, &read, &everyone())?,
        before.clone(),
        "after records the reader cannot read are changed",
    )?;
    d.reindex_records(NS, &decl, &no_scan, None, false)
        .ctx("reindex_records")?;
    ensure_eq(
        everything(d, &decl, &read, &everyone())?,
        before,
        "after the kind is reindexed",
    )?;
    // The same reads, for a reader of the hidden records, are not empty: the case has teeth.
    let other = everything(d, &decl, &read, &reader(&["group:other"]))?;
    ensure(
        other.contains("Soil, soil and mulch"),
        "the unreadable records are there for those who may read them",
    )?;
    pass()
}

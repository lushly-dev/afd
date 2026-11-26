//! Group `quota`: the records write quota (D212, records host specification section 4.2). A
//! declared record is charged to its envelope's principal with its postings; a put that would
//! leave its principal past a limit it adds to is refused and writes nothing; one that keeps or
//! shrinks is admitted; a rewrite by another principal moves the charge; a rebuild sets every
//! charge again, refusing nothing and counting nothing twice; and puts by one principal at once
//! never pass its quota together, while another principal's are not held up.
//!
//! The group shares the `lane` group's backend switch: a backend without a record lane skips
//! it. Every text is invented and about gardening.

use std::sync::{Arc, Barrier};
use std::thread;

use serde_json::{Value, json};

use super::lane::{NO_LANE, NS, lane, no_scan, pointer};
use super::{CaseResult, Ctx, Env, ensure, ensure_eq, pass, reader, samples, skip};
use crate::lane::{
    LaneStatus, LaneWrite, RecordDecl, RecordMatch, RecordQuota, RecordQuotaLimit, Standing,
    StandingView, extract,
};
use crate::{DocumentStore, Expect, ReaderFilter, StoreError};

pub(super) const CASES: &[(&str, super::CaseFn)] = &[
    (
        "a_writer_past_its_record_limit_is_refused_and_another_writer_is_not",
        record_limit,
    ),
    (
        "a_writer_past_its_posting_limit_is_refused_and_may_still_shrink",
        posting_limit,
    ),
    (
        "under_a_lowered_quota_a_put_that_keeps_or_shrinks_is_admitted",
        lowered_quota,
    ),
    (
        "a_rewrite_by_another_principal_moves_the_whole_charge",
        charge_moves,
    ),
    (
        "a_rebuild_sets_every_charge_refusing_nothing_and_counting_nothing_twice",
        rebuild_charges,
    ),
    (
        "a_record_a_rebuild_leaves_without_lane_rows_releases_its_charge",
        unindexed_releases,
    ),
    (
        "puts_by_one_writer_at_once_never_pass_its_quota_together",
        concurrent_writers,
    ),
];

const AT: &str = "2026-11-26T10:00:00.000Z";
const ALICE: &str = "human:alice";
const BOB: &str = "human:bob";

/// A kind `note` without standing: one text pointer, matched, and one key.
fn decl() -> Result<RecordDecl, String> {
    Ok(RecordDecl {
        kind: "note".to_owned(),
        standing: false,
        text: vec![pointer("/statement")?],
        keys: vec![pointer("/bed")?],
        matched: Some(0),
    })
}

/// The same kind with a second text pointer: what a deployer's new plugin version declares.
fn wider() -> Result<RecordDecl, String> {
    let mut decl = decl()?;
    decl.text.push(pointer("/why")?);
    Ok(decl)
}

fn note(statement: &str) -> Value {
    json!({ "statement": statement, "bed": "south" })
}

/// What `principal` may read: its own and the space's records.
fn as_principal(principal: &str) -> ReaderFilter {
    reader(&["space", &format!("principal:{principal}")])
}

/// How many postings `body` holds under `decl`.
fn postings(decl: &RecordDecl, body: &Value) -> Result<u64, String> {
    let found = extract(decl, body).ctx("extract")?;
    Ok(found.terms.len() as u64)
}

/// A declared put of `body` as `principal`, readable by `access`, held to `quota`.
#[allow(clippy::too_many_arguments)]
fn put_as(
    d: &dyn DocumentStore,
    decl: &RecordDecl,
    principal: &str,
    id: &str,
    body: Value,
    access: &[&str],
    quota: Option<RecordQuota>,
) -> Result<(), StoreError> {
    let mut envelope = samples::envelope(access, "quota", AT);
    envelope.principal = Some(principal.to_owned());
    d.put_declared_record(
        NS,
        decl,
        id,
        body,
        envelope,
        Expect::Any,
        LaneWrite {
            evidence: None,
            flags: Vec::new(),
            model: None,
            quota,
        },
        &as_principal(principal),
    )
    .map(|_| ())
}

/// A private put as `principal`.
fn own(
    d: &dyn DocumentStore,
    decl: &RecordDecl,
    principal: &str,
    id: &str,
    statement: &str,
    quota: Option<RecordQuota>,
) -> Result<(), StoreError> {
    put_as(
        d,
        decl,
        principal,
        id,
        note(statement),
        &[&format!("principal:{principal}")],
        quota,
    )
}

fn refused_for(
    result: Result<(), StoreError>,
    limit: RecordQuotaLimit,
    what: &str,
) -> Result<(), String> {
    match result {
        Err(StoreError::RecordQuotaExceeded { limit: found }) if found == limit => Ok(()),
        other => Err(format!(
            "{what}: expected RecordQuotaExceeded {{ {limit:?} }}, got {other:?}"
        )),
    }
}

fn records_quota(records: u64) -> Option<RecordQuota> {
    Some(RecordQuota {
        records,
        postings: u64::MAX,
    })
}

fn postings_quota(postings: u64) -> Option<RecordQuota> {
    Some(RecordQuota {
        records: u64::MAX,
        postings,
    })
}

fn status(d: &dyn DocumentStore, decl: &RecordDecl) -> Result<LaneStatus, String> {
    d.lane_status(NS, decl).ctx("lane_status")
}

/// The ids of `principal`'s records that a find of everything returns.
fn readable(d: &dyn DocumentStore, decl: &RecordDecl, principal: &str) -> Result<usize, String> {
    let view = StandingView {
        own: Vec::new(),
        command_writable: Vec::new(),
        person: Vec::new(),
        admit: vec![Standing::Unverified, Standing::Attested, Standing::Affirmed],
        levels: Vec::new(),
    };
    let query = crate::lane::RecordFind {
        kind: decl.kind.clone(),
        keys: Vec::new(),
        standings: Vec::new(),
        verified_only: false,
        text: None,
        order: crate::lane::FindOrder::Id,
        after: None,
        limit: 200,
        total: true,
    };
    let page = d
        .find_records(NS, decl, &query, &view, &as_principal(principal))
        .ctx("find_records")?;
    Ok(page.items.len())
}

/// A match is served: the bound was never reached and the kind's count is whole.
fn matches(d: &dyn DocumentStore, decl: &RecordDecl, principal: &str) -> Result<(), String> {
    let view = StandingView {
        own: Vec::new(),
        command_writable: Vec::new(),
        person: Vec::new(),
        admit: vec![Standing::Unverified, Standing::Attested, Standing::Affirmed],
        levels: Vec::new(),
    };
    let query = RecordMatch {
        kind: decl.kind.clone(),
        texts: vec!["Mulch the beds in spring.".to_owned()],
        k: 5,
        keys: Vec::new(),
        standings: Vec::new(),
        verified_only: false,
        exclude: Vec::new(),
    };
    d.match_records(NS, decl, &query, None, &view, &as_principal(principal))
        .ctx("match_records")?;
    Ok(())
}

fn record_limit(env: &Env<'_>) -> CaseResult {
    let Some((s, _)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let d = &*s.stores.documents;
    let decl = decl()?;
    let quota = records_quota(2);
    own(d, &decl, ALICE, "a1", "Mulch the beds in spring.", quota).ctx("Alice's first")?;
    own(d, &decl, ALICE, "a2", "Water the beans at dawn.", quota).ctx("Alice's second")?;
    let before = status(d, &decl)?;
    refused_for(
        own(d, &decl, ALICE, "a3", "Thin the carrots in May.", quota),
        RecordQuotaLimit::Records,
        "a third record for Alice",
    )?;
    let after = status(d, &decl)?;
    ensure_eq(
        (after.records, after.postings, after.most_records),
        (before.records, before.postings, 2),
        "a refused put writes nothing: the kind's records, its postings and Alice's charge stay",
    )?;
    ensure_eq(
        readable(d, &decl, ALICE)?,
        2,
        "the refused record is not stored",
    )?;
    // Alice's limit is hers: Bob writes on.
    own(d, &decl, BOB, "b1", "Stake the tomatoes early.", quota).ctx("Bob's first")?;
    own(d, &decl, BOB, "b2", "Net the brassicas.", quota).ctx("Bob's second")?;
    // A rewrite of her own record adds no record, and is admitted.
    own(
        d,
        &decl,
        ALICE,
        "a1",
        "Mulch the beds in early spring.",
        quota,
    )
    .ctx("Alice rewrites her own record at her limit")?;
    let last = status(d, &decl)?;
    ensure_eq(
        (last.records, last.most_records),
        (4, 2),
        "four records, two for each writer",
    )?;
    matches(d, &decl, ALICE)?;
    pass()
}

fn posting_limit(env: &Env<'_>) -> CaseResult {
    let Some((s, _)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let d = &*s.stores.documents;
    let decl = decl()?;
    let short = "Mulch the beds.";
    let long = "Mulch the beds with straw, compost and shredded leaves before the dry weeks.";
    let limit = postings(&decl, &note(long))?;
    ensure(
        postings(&decl, &note(short))? < limit,
        "the short text has fewer postings",
    )?;
    let quota = postings_quota(limit);
    own(d, &decl, ALICE, "a", long, quota).ctx("a record at exactly the limit")?;
    ensure_eq(
        status(d, &decl)?.most_postings,
        limit,
        "Alice is charged its postings",
    )?;
    let before = status(d, &decl)?;
    refused_for(
        own(d, &decl, ALICE, "b", short, quota),
        RecordQuotaLimit::Postings,
        "any more postings for Alice",
    )?;
    ensure_eq(status(d, &decl)?, before, "a refused put changes no count")?;
    // Shrinking her record is admitted, and frees the postings it held.
    own(d, &decl, ALICE, "a", short, quota).ctx("Alice shrinks her record")?;
    let shrunk = postings(&decl, &note(short))?;
    ensure_eq(
        status(d, &decl)?.most_postings,
        shrunk,
        "the charge is the record's postings now",
    )?;
    // Growing it back to the limit is admitted too: it does not pass the limit.
    own(d, &decl, ALICE, "a", long, quota).ctx("Alice grows back to the limit")?;
    own(d, &decl, BOB, "b", long, quota).ctx("Bob is not held to Alice's postings")?;
    ensure_eq(
        status(d, &decl)?.postings,
        2 * limit,
        "the kind's count is the two records' postings",
    )?;
    pass()
}

fn lowered_quota(env: &Env<'_>) -> CaseResult {
    let Some((s, _)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let d = &*s.stores.documents;
    let decl = decl()?;
    for (id, text) in [
        ("a", "Mulch the beds with straw and compost."),
        ("b", "Water the beans at dawn."),
        ("c", "Thin the carrots in May."),
    ] {
        own(d, &decl, ALICE, id, text, None).ctx("a put under no quota")?;
    }
    // The deployer lowers the quota under what Alice holds.
    let held = status(d, &decl)?;
    let quota = Some(RecordQuota {
        records: 1,
        postings: 1,
    });
    refused_for(
        own(d, &decl, ALICE, "d", "Sow radishes.", quota),
        RecordQuotaLimit::Records,
        "a new record past a lowered quota",
    )?;
    refused_for(
        own(
            d,
            &decl,
            ALICE,
            "b",
            "Water the beans and the peas at dawn.",
            quota,
        ),
        RecordQuotaLimit::Postings,
        "a rewrite that grows past a lowered quota",
    )?;
    ensure_eq(
        status(d, &decl)?,
        held.clone(),
        "nothing was removed or written",
    )?;
    own(d, &decl, ALICE, "c", "Thin the carrots in May.", quota)
        .ctx("a rewrite that keeps its size")?;
    own(d, &decl, ALICE, "a", "Mulch the beds.", quota).ctx("a rewrite that shrinks")?;
    ensure(
        status(d, &decl)?.most_postings < held.most_postings,
        "the shrink is charged",
    )?;
    pass()
}

fn charge_moves(env: &Env<'_>) -> CaseResult {
    let Some((s, _)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let d = &*s.stores.documents;
    let decl = decl()?;
    let quota = records_quota(1);
    put_as(
        d,
        &decl,
        ALICE,
        "shared",
        note("Mulch the beds."),
        &["space"],
        quota,
    )
    .ctx("Alice writes a record the space may read")?;
    refused_for(
        own(d, &decl, ALICE, "a2", "Water the beans.", quota),
        RecordQuotaLimit::Records,
        "Alice at her limit",
    )?;
    // Bob rewrites it: the record is charged to Bob now, and Alice has room again.
    put_as(
        d,
        &decl,
        BOB,
        "shared",
        note("Mulch the beds with leaves and straw."),
        &["space"],
        quota,
    )
    .ctx("Bob rewrites the shared record")?;
    own(d, &decl, ALICE, "a2", "Water the beans.", quota).ctx("Alice's room came back")?;
    refused_for(
        own(d, &decl, BOB, "b2", "Stake the tomatoes.", quota),
        RecordQuotaLimit::Records,
        "Bob holds the shared record's charge",
    )?;
    ensure_eq(
        (status(d, &decl)?.records, status(d, &decl)?.most_records),
        (2, 1),
        "one record each",
    )?;
    pass()
}

fn rebuild_charges(env: &Env<'_>) -> CaseResult {
    let Some((s, _)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let d = &*s.stores.documents;
    let decl = decl()?;
    let body =
        |statement: &str, why: &str| json!({ "statement": statement, "bed": "south", "why": why });
    let first = body(
        "Mulch the beds.",
        "It keeps the soil cool through the summer heat.",
    );
    let second = body(
        "Water the beans.",
        "Dry roots split the pods before they fill.",
    );
    let held = postings(&decl, &first)? + postings(&decl, &second)?;
    let quota = postings_quota(held);
    put_as(
        d,
        &decl,
        ALICE,
        "a",
        first.clone(),
        &["principal:human:alice"],
        quota,
    )
    .ctx("Alice's first")?;
    put_as(
        d,
        &decl,
        ALICE,
        "b",
        second.clone(),
        &["principal:human:alice"],
        quota,
    )
    .ctx("Alice's second, to her limit")?;
    let before = status(d, &decl)?;
    for run in ["first", "second"] {
        d.reindex_records(NS, &decl, &no_scan, None, false)
            .ctx("reindex_records")?;
        let after = status(d, &decl)?;
        ensure_eq(
            (after.postings, after.most_postings, after.most_records),
            (before.postings, held, 2),
            &format!("the {run} rebuild sets the same charges"),
        )?;
    }
    refused_for(
        own(d, &decl, ALICE, "c", "Sow radishes.", quota),
        RecordQuotaLimit::Postings,
        "Alice is still at her limit after two rebuilds",
    )?;
    // A wider declaration gives her records more postings: the rebuild refuses nothing, and
    // her growing puts are refused until she shrinks.
    let wide = wider()?;
    let report = d
        .reindex_records(NS, &wide, &no_scan, None, false)
        .ctx("a rebuild under the wider declaration")?;
    ensure_eq(
        (report.records, report.unindexed, report.superseded),
        (2, 0, false),
        "the rebuild indexes both records",
    )?;
    let widened = postings(&wide, &first)? + postings(&wide, &second)?;
    let after = status(d, &wide)?;
    ensure_eq(
        (after.postings, after.most_postings),
        (widened, widened),
        "the rebuild charges each record its postings under the wider declaration",
    )?;
    ensure(widened > held, "the wider declaration counts more postings")?;
    refused_for(
        put_as(
            d,
            &wide,
            ALICE,
            "c",
            note("Sow radishes."),
            &["principal:human:alice"],
            quota,
        ),
        RecordQuotaLimit::Postings,
        "past her limit after the rebuild",
    )?;
    put_as(
        d,
        &wide,
        ALICE,
        "a",
        note("Mulch."),
        &["principal:human:alice"],
        quota,
    )
    .ctx("a rewrite that shrinks is admitted")?;
    pass()
}

fn unindexed_releases(env: &Env<'_>) -> CaseResult {
    let Some((s, _)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let d = &*s.stores.documents;
    let decl = decl()?;
    let quota = records_quota(1);
    own(d, &decl, ALICE, "a", "Mulch the beds.", quota).ctx("Alice's record")?;
    // An undeclared put writes a body the declaration refuses; the rebuild leaves the record
    // without lane rows, and its charge goes with them.
    let mut envelope = samples::envelope(&["principal:human:alice"], "quota", AT);
    envelope.principal = Some(ALICE.to_owned());
    d.put_record(
        NS,
        &decl.kind,
        "a",
        json!({ "statement": 7, "bed": "south" }),
        envelope,
        Expect::Any,
    )
    .ctx("an undeclared put")?;
    let report = d
        .reindex_records(NS, &decl, &no_scan, None, false)
        .ctx("reindex_records")?;
    ensure_eq(report.unindexed, 1, "the record is left without lane rows")?;
    let after = status(d, &decl)?;
    ensure_eq(
        (after.records, after.postings, after.most_records),
        (1, 0, 0),
        "the record stays, with no postings and no charge",
    )?;
    own(d, &decl, ALICE, "b", "Water the beans.", quota).ctx("Alice's room came back")?;
    pass()
}

fn concurrent_writers(env: &Env<'_>) -> CaseResult {
    let Some((s, _)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let d: Arc<dyn DocumentStore> = Arc::clone(&s.stores.documents);
    let decl = decl()?;
    const LIMIT: u64 = 3;
    const THREADS: usize = 4;
    const EACH: usize = 4;
    /// A put that meets a held lock tries again this many times before the case fails.
    const BUSY_TRIES: usize = 200;
    let quota = records_quota(LIMIT);
    // Every thread starts its puts at once, Bob's beside Alice's.
    let start = Arc::new(Barrier::new(THREADS + 1));
    let run = |principal: &'static str, thread: usize, quota: Option<RecordQuota>| {
        let d = Arc::clone(&d);
        let decl = decl.clone();
        let start = Arc::clone(&start);
        thread::spawn(move || {
            start.wait();
            (0..EACH)
                .map(|n| {
                    // Each thread its own ids: every admitted put is a new record.
                    let id = format!("{principal}-{thread}-{n}");
                    let text = format!("Mulch bed {thread} {n} with straw before the dry weeks.");
                    let mut tries = 0;
                    loop {
                        match own(&*d, &decl, principal, &id, &text, quota) {
                            Err(StoreError::Busy) if tries < BUSY_TRIES => tries += 1,
                            other => break other,
                        }
                    }
                })
                .collect::<Vec<_>>()
        })
    };
    let alice: Vec<_> = (0..THREADS).map(|t| run(ALICE, t, quota)).collect();
    let bob = run(BOB, 0, None);
    let mut admitted = 0u64;
    for handle in alice {
        for result in handle
            .join()
            .map_err(|_| "a writer thread panicked".to_owned())?
        {
            match result {
                Ok(()) => admitted += 1,
                Err(StoreError::RecordQuotaExceeded {
                    limit: RecordQuotaLimit::Records,
                }) => {}
                Err(other) => return Err(format!("an unexpected refusal: {other}")),
            }
        }
    }
    let bob = bob.join().map_err(|_| "Bob's thread panicked".to_owned())?;
    ensure(
        bob.iter().all(Result::is_ok),
        "Bob, with no quota, is admitted every time",
    )?;
    ensure_eq(
        admitted,
        LIMIT,
        "of sixteen new records at once, exactly Alice's limit is admitted",
    )?;
    let after = status(&*d, &decl)?;
    ensure_eq(
        (after.records, after.most_records),
        (LIMIT + EACH as u64, EACH as u64),
        "Alice holds her limit and Bob all of his",
    )?;
    ensure_eq(
        readable(&*d, &decl, ALICE)?,
        LIMIT as usize,
        "Alice reads hers",
    )?;
    d.reindex_records(NS, &decl, &no_scan, None, false)
        .ctx("reindex_records")?;
    ensure_eq(
        status(&*d, &decl)?.postings,
        after.postings,
        "the kind's count was whole: a rebuild that counts its rows finds the same",
    )?;
    matches(&*d, &decl, ALICE)?;
    pass()
}

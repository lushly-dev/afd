//! Group `memory_lifecycle`: expiry at its boundary, `include_expired`, `include_flagged`, sweep
//! and `remaining`, purge by invalidation and by expiry, and the purge before a write, which
//! stays when the quota refuses that write (sections 4.2 and 8.8).

use super::write::note;
use super::{MemoryEnv, T0, ada, all_flags, list_ids, list_query, recall_ids, recall_query, write};
use crate::conformance::{CaseResult, Ctx, ensure, ensure_eq, expect_err, pass, samples};
use crate::memory::{
    AsOf, DAY_MS, Invalidate, InvalidationReason, MemoryChangeKind, MemoryStore, Millis, Quota,
    ReadFlags, Retention, Sweep,
};
use crate::{MemoryClass, MemoryFlag, StoreError};

pub(super) const CASES: &[(&str, super::MemoryCaseFn)] = &[
    ("expiry_is_measured_at_now", expiry),
    ("flagged_records_need_include_flagged", flagged),
    ("a_sweep_purges_and_reports_remaining", sweep),
    (
        "purge_follows_invalidation_and_a_past_valid_until_waits",
        purge_rules,
    ),
    (
        "a_write_purges_first_and_the_purge_stays",
        purge_before_write,
    ),
];

const D: Millis = DAY_MS;

fn purged(m: &dyn MemoryStore) -> Result<usize, String> {
    Ok(m.changes(0, 1000, &ada(), None)
        .ctx("changes")?
        .iter()
        .filter(|c| c.kind == MemoryChangeKind::Purged)
        .count())
}

fn expiry(env: &MemoryEnv<'_>) -> CaseResult {
    let f = env.fresh()?;
    let m = &*f.memory;
    let id = samples::memory_id(1);
    let mut e = note(1, "expires on day ten");
    e.expires_at = T0 + 10 * D;
    write(m, T0, vec![e])?;
    let read = |now: Millis, include_expired: bool, as_of: AsOf| {
        let flags = ReadFlags {
            include_flagged: false,
            include_expired,
            now,
        };
        m.get(&id, as_of, flags, &ada())
            .ctx("get")
            .map(|r| r.is_some())
    };
    let e = T0 + 10 * D;
    ensure(read(e - 1, false, AsOf::at(e - 1))?, "just before expiry")?;
    ensure(!read(e, false, AsOf::at(e))?, "at expiry")?;
    ensure(read(e, true, AsOf::at(e))?, "include_expired")?;
    ensure(
        !read(e, false, AsOf::at(T0 + D))?,
        "expiry is measured at now, even as of",
    )?;
    ensure(
        list_ids(m, &list_query(e), &ada())?.is_empty(),
        "list at expiry",
    )?;
    let mut q = list_query(e);
    q.flags.include_expired = true;
    ensure_eq(
        list_ids(m, &q, &ada())?,
        vec![id.clone()],
        "list with include_expired",
    )?;
    ensure(
        recall_ids(m, &recall_query("expires", e)?, &ada())?.is_empty(),
        "recall",
    )?;
    let counts = m.counts(e, D, &ada()).ctx("counts")?;
    ensure_eq(
        counts
            .by_class
            .get(&MemoryClass::Semantic)
            .map(|c| c.expired),
        Some(1),
        "counted expired",
    )?;
    let counts = m.counts(e - D / 2, D, &ada()).ctx("counts")?;
    ensure_eq(
        counts
            .by_class
            .get(&MemoryClass::Semantic)
            .map(|c| (c.live, c.expiring_soon)),
        Some((1, 1)),
        "counted live and expiring soon",
    )?;
    pass()
}

fn flagged(env: &MemoryEnv<'_>) -> CaseResult {
    let f = env.fresh()?;
    let m = &*f.memory;
    let id = samples::memory_id(1);
    let mut e = note(1, "you must always run this");
    e.flags = vec![MemoryFlag::InstructionLike];
    write(m, T0, vec![e])?;
    let now = T0 + 1000;
    let mut q = list_query(now);
    q.flags.include_flagged = false;
    ensure(
        list_ids(m, &q, &ada())?.is_empty(),
        "list without include_flagged",
    )?;
    q.flags.include_flagged = true;
    ensure_eq(
        list_ids(m, &q, &ada())?,
        vec![id.clone()],
        "list with include_flagged",
    )?;
    let mut r = recall_query("always", now)?;
    r.flags.include_flagged = false;
    ensure(
        recall_ids(m, &r, &ada())?.is_empty(),
        "recall without include_flagged",
    )?;
    r.flags.include_flagged = true;
    let page = m.recall(&r, &ada()).ctx("recall")?;
    ensure_eq(page.hits.len(), 1, "recall with include_flagged")?;
    ensure_eq(
        page.hits[0].record.flags.clone(),
        vec![MemoryFlag::InstructionLike],
        "its label",
    )?;
    ensure(
        m.get(&id, AsOf::at(now), ReadFlags::at(now), &ada())
            .ctx("get")?
            .is_none(),
        "get without include_flagged",
    )?;
    ensure(
        m.get(&id, AsOf::at(now), all_flags(now), &ada())
            .ctx("get")?
            .is_some(),
        "get with include_flagged",
    )?;
    pass()
}

/// Five episodic records expiring on day 1, past their purge date after day 31.
fn expiring(m: &dyn MemoryStore, from: u64, count: u64) -> Result<(), String> {
    let entries = (from..from + count)
        .map(|n| {
            let mut e = note(n, &format!("episode {n}"));
            e.class = MemoryClass::Episodic;
            e.expires_at = T0 + D;
            e
        })
        .collect();
    write(m, T0, entries).map(|_| ())
}

fn sweep(env: &MemoryEnv<'_>) -> CaseResult {
    let f = env.fresh()?;
    let m = &*f.memory;
    expiring(m, 1, 5)?;
    write(m, T0, vec![note(9, "kept")])?;
    let now = T0 + D + 30 * D + 1;
    let run = |limit| {
        m.sweep(Sweep {
            now,
            limit,
            retention: Retention::default(),
        })
        .ctx("sweep")
    };
    let first = run(2)?;
    ensure_eq((first.purged, first.remaining), (2, 3), "the first sweep")?;
    let second = run(10)?;
    ensure_eq(
        (second.purged, second.remaining),
        (3, 0),
        "the second sweep",
    )?;
    let third = run(10)?;
    ensure_eq((third.purged, third.remaining), (0, 0), "nothing left")?;
    for n in 1..=5 {
        let id = samples::memory_id(n);
        ensure(
            m.get(&id, AsOf::at(T0), all_flags(T0), &ada())
                .ctx("get")?
                .is_none(),
            "a purged record is gone",
        )?;
        ensure(
            m.history(&id, &ada()).ctx("history")?.is_empty(),
            "and its history",
        )?;
    }
    ensure_eq(purged(m)?, 5, "five Purged changes")?;
    let erased = m
        .changes(0, 1000, &ada(), None)
        .ctx("changes")?
        .iter()
        .filter(|c| c.kind == MemoryChangeKind::Erased)
        .count();
    ensure_eq(erased, 0, "a purge is not an erase")?;
    ensure(
        m.get(
            &samples::memory_id(9),
            AsOf::at(now),
            all_flags(now),
            &ada(),
        )
        .ctx("get")?
        .is_some(),
        "a live record stays",
    )?;
    expect_err(
        m.sweep(Sweep {
            now,
            limit: 0,
            retention: Retention::default(),
        }),
        "a zero limit",
        crate::conformance::invalid,
    )?;
    pass()
}

fn purge_rules(env: &MemoryEnv<'_>) -> CaseResult {
    let f = env.fresh()?;
    let m = &*f.memory;
    let invalidated = samples::memory_id(1);
    let past = samples::memory_id(2);
    write(m, T0, vec![note(1, "invalidated soon")])?;
    let mut e = note(2, "server x until day one");
    e.valid_until = Some(T0 + D);
    e.expires_at = T0 + 400 * D;
    samples::agree(&mut e);
    write(m, T0, vec![e])?;
    m.invalidate(
        Invalidate {
            id: invalidated.clone(),
            at: T0 + D,
            valid_until: T0 + D,
            by: super::ADA.into(),
            reason: InvalidationReason::Outdated,
            note: None,
            expect_version: None,
            trace_id: None,
        },
        &ada(),
    )
    .ctx("invalidate")?;
    let sweep = |now| {
        m.sweep(Sweep {
            now,
            limit: 100,
            retention: Retention::default(),
        })
        .ctx("sweep")
    };
    let early = sweep(T0 + D + 90 * D)?;
    ensure_eq(
        early.purged,
        0,
        "not yet past the invalidation's purge date",
    )?;
    let first = sweep(T0 + D + 90 * D + 1)?;
    ensure_eq(first.purged, 1, "the invalidated record")?;
    let gone =
        |id: &str| -> Result<bool, String> { Ok(m.history(id, &ada()).ctx("history")?.is_empty()) };
    ensure(
        gone(&invalidated)?,
        "purged by its invalidation's recordedAt",
    )?;
    ensure(!gone(&past)?, "a past validUntil waits for expiry")?;
    let last = sweep(T0 + 400 * D + 90 * D + 1)?;
    ensure_eq(last.purged, 1, "purged after its expiry")?;
    ensure(gone(&past)?, "the past fact is gone")?;
    pass()
}

fn purge_before_write(env: &MemoryEnv<'_>) -> CaseResult {
    let f = env.fresh()?;
    let m = &*f.memory;
    expiring(m, 1, 20)?;
    let now = T0 + 32 * D;
    write(m, now, vec![note(100, "a write")])?;
    ensure_eq(purged(m)?, 16, "a write purges at most 16 records first")?;
    let mut batch = samples::memory_batch(now + 1, vec![note(101, "refused")]);
    batch.quota = Quota {
        stored_records: 0,
        ..Quota::unlimited()
    };
    expect_err(m.write(batch), "a write over quota", |e| {
        matches!(e, StoreError::QuotaExceeded { .. })
    })?;
    ensure_eq(purged(m)?, 20, "its purge stays")?;
    ensure(
        m.get(
            &samples::memory_id(101),
            AsOf::at(now + 1),
            all_flags(now + 1),
            &ada(),
        )
        .ctx("get")?
        .is_none(),
        "the refused write wrote nothing",
    )?;
    pass()
}

//! Group `memory_bitemporal`: the four questions of section 4.1 over a fixed timeline, both ends
//! of each half-open interval, backdated invalidation, stale clocks, supersede on time, and
//! confirmation's new version.

use super::write::note;
use super::{
    ADA, BO, MemoryEnv, T0, ada, all_flags, bo, get_at, list_ids, list_query, not_found, write,
};
use crate::conformance::{
    CaseResult, Ctx, conflict, ensure, ensure_eq, expect_err, invalid, pass, samples,
};
use crate::memory::{
    AsOf, Confirm, DAY_MS, Invalidate, InvalidationReason, MemoryChangeKind, MemoryRecord,
    MemoryStore, MemoryWrite, Millis,
};
use crate::{Authority, MemoryFlag, ReaderFilter};

pub(super) const CASES: &[(&str, super::MemoryCaseFn)] = &[
    ("the_four_questions_over_a_timeline", four_questions),
    ("each_interval_is_half_open", half_open),
    ("a_backdated_invalidation_is_checked", backdated),
    (
        "closing_keeps_the_old_version_readable_by_recorded",
        closing,
    ),
    ("a_stale_clock_is_clamped", stale_clock),
    ("a_supersede_always_succeeds_on_time", supersede_on_time),
    ("confirm_writes_a_person_version", confirm),
];

const D: Millis = DAY_MS;

fn invalidate(
    m: &dyn MemoryStore,
    id: &str,
    at: Millis,
    until: Millis,
) -> Result<crate::memory::MemoryVersionMeta, crate::StoreError> {
    m.invalidate(
        Invalidate {
            id: id.to_owned(),
            at,
            valid_until: until,
            by: ADA.into(),
            reason: InvalidationReason::Outdated,
            note: None,
            expect_version: None,
            trace_id: Some("t-invalidate".into()),
        },
        &ada(),
    )
}

/// The record matching `(valid, recorded)`, read at `now`.
fn at(
    m: &dyn MemoryStore,
    id: &str,
    valid: Millis,
    recorded: Millis,
    now: Millis,
) -> Result<Option<MemoryRecord>, String> {
    m.get(id, AsOf { valid, recorded }, all_flags(now), &ada())
        .ctx("get")
}

fn version(record: Option<MemoryRecord>) -> Option<u32> {
    record.map(|r| r.record_version)
}

fn four_questions(env: &MemoryEnv<'_>) -> CaseResult {
    let f = env.fresh()?;
    let m = &*f.memory;
    let id = samples::memory_id(1);
    write(m, T0, vec![note(1, "server x runs version one")])?;
    invalidate(m, &id, T0 + 10 * D, T0 + 6 * D).ctx("invalidate")?;
    let now = T0 + 12 * D;
    ensure_eq(
        version(at(m, &id, now, now, now)?),
        None,
        "now, as now believed",
    )?;
    ensure_eq(
        version(at(m, &id, now, T0 + 8 * D, now)?),
        Some(1),
        "what we believed on day 8 about today",
    )?;
    ensure_eq(
        version(at(m, &id, T0 + 5 * D, now, now)?),
        Some(2),
        "what we now believe held on day 5",
    )?;
    ensure_eq(
        version(at(m, &id, T0 + 7 * D, T0 + 8 * D, now)?),
        Some(1),
        "what we believed on day 8 about day 7",
    )?;
    ensure_eq(
        version(at(m, &id, T0 + 7 * D, now, now)?),
        None,
        "what we now believe about day 7",
    )?;
    let mut query = list_query(now);
    ensure(
        list_ids(m, &query, &ada())?.is_empty(),
        "list: nothing holds now",
    )?;
    query.as_of = AsOf {
        valid: T0 + 5 * D,
        recorded: now,
    };
    ensure_eq(
        list_ids(m, &query, &ada())?,
        vec![id],
        "list: day 5 as now believed",
    )?;
    pass()
}

fn half_open(env: &MemoryEnv<'_>) -> CaseResult {
    let f = env.fresh()?;
    let m = &*f.memory;
    let id = samples::memory_id(1);
    let mut entry = note(1, "valid on days one and two");
    entry.valid_from = T0 + D;
    entry.valid_until = Some(T0 + 3 * D);
    samples::agree(&mut entry);
    write(m, T0, vec![entry])?;
    invalidate(m, &id, T0 + 2 * D, T0 + 2 * D).ctx("invalidate")?;
    let now = T0 + 2 * D;
    let cases = [
        (T0 + D, T0 + D, Some(1), "validFrom is inclusive"),
        (T0 + D - 1, T0 + D, None, "before validFrom"),
        (T0 + 3 * D - 1, T0 + D, Some(1), "just before validUntil"),
        (T0 + 3 * D, T0 + D, None, "validUntil is exclusive"),
        (T0 + D, T0, Some(1), "recordedAt is inclusive"),
        (T0 + D, T0 - 1, None, "before recordedAt"),
        (T0 + D, T0 + 2 * D - 1, Some(1), "just before recordedUntil"),
        (T0 + D, T0 + 2 * D, Some(2), "recordedUntil is exclusive"),
        (
            T0 + 2 * D,
            T0 + 2 * D,
            None,
            "the new validUntil is exclusive",
        ),
    ];
    for (valid, recorded, want, what) in cases {
        ensure_eq(version(at(m, &id, valid, recorded, now)?), want, what)?;
    }
    pass()
}

fn backdated(env: &MemoryEnv<'_>) -> CaseResult {
    let f = env.fresh()?;
    let m = &*f.memory;
    let id = samples::memory_id(1);
    write(m, T0, vec![note(1, "a fact")])?;
    expect_err(
        invalidate(m, &id, T0 + 5 * D, T0),
        "T at validFrom",
        invalid,
    )?;
    expect_err(
        invalidate(m, &id, T0 + 5 * D, T0 + 6 * D),
        "T after at",
        invalid,
    )?;
    let meta = invalidate(m, &id, T0 + 5 * D, T0 + 3 * D).ctx("a backdated invalidation")?;
    ensure_eq(
        (meta.record_version, meta.valid_until, meta.recorded_at),
        (2, Some(T0 + 3 * D), T0 + 5 * D),
        "version 2",
    )?;
    let meta = invalidate(m, &id, T0 + 6 * D, T0 + 2 * D).ctx("a correction of a correction")?;
    ensure_eq(meta.record_version, 3, "version 3")?;
    let history = m.history(&id, &ada()).ctx("history")?;
    let intervals: Vec<_> = history
        .iter()
        .map(|r| {
            (
                r.record_version,
                r.recorded_at,
                r.recorded_until,
                r.valid_until,
            )
        })
        .collect();
    ensure_eq(
        intervals,
        vec![
            (1, T0, Some(T0 + 5 * D), None),
            (2, T0 + 5 * D, Some(T0 + 6 * D), Some(T0 + 3 * D)),
            (3, T0 + 6 * D, None, Some(T0 + 2 * D)),
        ],
        "each version's intervals",
    )?;
    let mut stale = Invalidate {
        id: id.clone(),
        at: T0 + 7 * D,
        valid_until: T0 + D,
        by: ADA.into(),
        reason: InvalidationReason::Wrong,
        note: None,
        expect_version: Some(2),
        trace_id: None,
    };
    expect_err(
        m.invalidate(stale.clone(), &ada()),
        "a stale expect_version",
        conflict,
    )?;
    stale.id = samples::memory_id(9);
    stale.expect_version = None;
    expect_err(
        m.invalidate(stale.clone(), &ada()),
        "an absent id",
        not_found,
    )?;
    stale.id = id;
    expect_err(m.invalidate(stale, &bo()), "an unreadable id", not_found)?;
    pass()
}

fn closing(env: &MemoryEnv<'_>) -> CaseResult {
    let f = env.fresh()?;
    let m = &*f.memory;
    let id = samples::memory_id(1);
    write(m, T0, vec![note(1, "kept as it was")])?;
    invalidate(m, &id, T0 + 2 * D, T0 + D).ctx("invalidate")?;
    let history = m.history(&id, &ada()).ctx("history")?;
    ensure_eq(history.len(), 2, "two versions")?;
    ensure_eq(
        history[0].recorded_until,
        Some(history[1].recorded_at),
        "closed at the next",
    )?;
    ensure(
        history[0].invalidation.is_none(),
        "version 1 carries no invalidation",
    )?;
    let then = at(m, &id, T0 + D / 2, T0 + D, T0 + 3 * D)?.ok_or("version 1 by recorded")?;
    ensure_eq(then.record_version, 1, "version 1")?;
    ensure_eq(then.text.as_str(), "kept as it was", "its text")?;
    let changes = m.changes(0, 100, &ada(), None).ctx("changes")?;
    ensure_eq(
        changes.iter().map(|c| c.kind).collect::<Vec<_>>(),
        vec![MemoryChangeKind::Created, MemoryChangeKind::Invalidated],
        "the changes",
    )?;
    ensure_eq(changes[1].record_version, 2, "the change names version 2")?;
    pass()
}

fn stale_clock(env: &MemoryEnv<'_>) -> CaseResult {
    let f = env.fresh()?;
    let m = &*f.memory;
    let id = samples::memory_id(1);
    write(m, T0 + 10 * D, vec![note(1, "written late")])?;
    let meta = invalidate(m, &id, T0 + 5 * D, T0 + 4 * D).ctx("invalidate with a stale clock")?;
    ensure_eq(meta.recorded_at, T0 + 10 * D, "recordedAt is clamped")?;
    for record in m.history(&id, &ada()).ctx("history")? {
        ensure(
            record
                .recorded_until
                .is_none_or(|u| u >= record.recorded_at),
            "no recorded interval is inverted",
        )?;
    }
    let changes = m.changes(0, 100, &ada(), None).ctx("changes")?;
    ensure_eq(
        changes.last().map(|c| c.at),
        Some(T0 + 10 * D),
        "changes.at is clamped",
    )?;
    pass()
}

fn supersede_on_time(env: &MemoryEnv<'_>) -> CaseResult {
    let f = env.fresh()?;
    let m = &*f.memory;
    let targets = [
        (1, "first target"),
        (2, "second target"),
        (3, "third target"),
    ];
    write(m, T0, targets.iter().map(|(n, t)| note(*n, t)).collect())?;
    let cases = [
        (1, T0 + 5 * D, T0 + 5 * D, "a future validFrom"),
        (2, T0, T0 + 1, "an equal validFrom"),
        (3, T0 - D, T0 + 1, "an earlier validFrom"),
    ];
    for (n, valid_from, want, what) in cases {
        let mut new: MemoryWrite = note(10 + n, &format!("replaces {n}"));
        new.valid_from = valid_from;
        new.supersedes = vec![samples::memory_id(n)];
        samples::agree(&mut new);
        write(m, T0 + D, vec![new]).map_err(|e| format!("{what}: {e}"))?;
        let history = m.history(&samples::memory_id(n), &ada()).ctx("history")?;
        let last = history.last().ok_or("a version")?;
        ensure_eq(last.valid_until, Some(want), what)?;
    }
    pass()
}

fn confirm(env: &MemoryEnv<'_>) -> CaseResult {
    let f = env.fresh()?;
    let m = &*f.memory;
    let id = samples::memory_id(1);
    write(m, T0, vec![note(1, "an agent's note")])?;
    let record = get_at(m, &id, T0, &ada())?.ok_or("the note")?;
    let hash = record.content_hash.as_str().to_owned();
    let request = |by: &str, hash: &str| Confirm {
        id: id.clone(),
        at: T0 + D,
        by: by.to_owned(),
        content_hash: hash.to_owned(),
        trace_id: None,
    };
    expect_err(
        m.confirm(request(ADA, &format!("sha256:{}", "0".repeat(16))), &ada()),
        "a hash that does not match",
        conflict,
    )?;
    expect_err(
        m.confirm(request(ADA, &hash[..7 + 15]), &ada()),
        "a hash prefix of 15 digits",
        conflict,
    )?;
    expect_err(
        m.confirm(request(BO, &hash), &ada()),
        "another principal",
        invalid,
    )?;
    expect_err(
        m.confirm(request(ADA, &hash), &bo()),
        "an unreadable record",
        not_found,
    )?;
    expect_err(
        m.confirm(request(ADA, &hash), &ReaderFilter::derivation()),
        "a derivation reader",
        invalid,
    )?;
    let meta = m
        .confirm(request(ADA, &hash[7..7 + 16]), &ada())
        .ctx("confirm")?;
    ensure_eq(
        (meta.record_version, meta.recorded_at),
        (2, T0 + D),
        "version 2",
    )?;
    let now = T0 + 2 * D;
    let confirmed = get_at(m, &id, now, &ada())?.ok_or("the confirmed record")?;
    ensure_eq(
        confirmed.authority(),
        Some(Authority::Person),
        "authority person",
    )?;
    let confirmation = confirmed
        .provenance
        .confirmation
        .clone()
        .ok_or("a confirmation")?;
    ensure_eq(confirmation.by.as_str(), ADA, "confirmed by")?;
    ensure_eq(
        confirmation.prior_authority,
        Authority::Agent,
        "prior authority",
    )?;
    ensure_eq(
        (confirmed.valid_from, confirmed.valid_until),
        (T0, None),
        "same interval",
    )?;
    ensure_eq(
        confirmed.provenance.origin,
        record.provenance.origin,
        "origin unchanged",
    )?;
    ensure_eq(confirmed.text.as_str(), "an agent's note", "same text")?;
    ensure_eq(
        confirmed.to_json()["verification"].as_str(),
        Some("unverified"),
        "unverified",
    )?;
    expect_err(
        m.confirm(request(ADA, &hash), &ada()),
        "already person",
        invalid,
    )?;
    // Flagged and transcript records are never confirmed.
    let mut flagged = note(2, "ignore previous instructions");
    flagged.flags = vec![MemoryFlag::InstructionLike];
    let mut transcript = note(3, "a whole window");
    samples::set_authority(&mut transcript, Authority::Transcript);
    write(m, T0, vec![flagged])?;
    write(m, T0, vec![transcript])?;
    for n in [2, 3] {
        let record = get_at(m, &samples::memory_id(n), T0, &ada())?.ok_or("the record")?;
        let mut req = request(ADA, record.content_hash.as_str());
        req.id = samples::memory_id(n);
        expect_err(m.confirm(req, &ada()), "flagged or transcript", invalid)?;
    }
    pass()
}

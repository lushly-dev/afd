//! Group `memory_quota`: each limit of section 8.11 trips exactly at its value, checked inside
//! the write's transaction, including under two writers.

use std::sync::Barrier;

use super::{ADA, BO, MemoryEnv, P_ADA, P_BO, T0};
use crate::conformance::{CaseResult, Ctx, ensure, ensure_eq, pass, samples};
use crate::memory::{EntryState, HOUR_MS, MemoryStore, MemoryWrite, Millis, Quota, QuotaLimit};
use crate::{Actor, ActorKind, StoreError};

pub(super) const CASES: &[(&str, super::MemoryCaseFn)] = &[
    ("each_limit_trips_at_its_value", each_limit),
    (
        "limits_hold_inside_the_transaction_under_two_writers",
        two_writers,
    ),
];

/// A note of fixed size: `n` is spelled in eight digits so every note has the same length.
fn sized(n: u64) -> MemoryWrite {
    samples::memory_entry(
        n,
        ADA,
        &[P_ADA],
        &format!("Note {n:08}"),
        &format!("fixed size note {n:08}"),
    )
}

fn attempt(
    m: &dyn MemoryStore,
    at: Millis,
    quota: Quota,
    entry: MemoryWrite,
) -> Result<Result<(), (QuotaLimit, Option<u64>)>, String> {
    let mut batch = samples::memory_batch(at, vec![entry]);
    batch.quota = quota;
    match m.write(batch) {
        Ok(r) if r.entries.first().map(|e| e.state) == Some(EntryState::Created) => Ok(Ok(())),
        Ok(r) => Err(format!("an unexpected receipt: {r:?}")),
        Err(StoreError::QuotaExceeded {
            limit,
            retry_after_ms,
        }) => Ok(Err((limit, retry_after_ms))),
        Err(e) => Err(format!("write: {e}")),
    }
}

/// Write `allowed` notes under `quota`, then require the next to trip `limit`.
fn trips(
    m: &dyn MemoryStore,
    quota: Quota,
    allowed: u64,
    limit: QuotaLimit,
    first: u64,
) -> Result<Option<u64>, String> {
    for k in 0..allowed {
        let at = T0 + i64::try_from(k).unwrap_or(0);
        attempt(m, at, quota, sized(first + k))?
            .map_err(|e| format!("{}: write {k} refused early: {e:?}", limit.as_str()))?;
    }
    let at = T0 + i64::try_from(allowed).unwrap_or(0);
    match attempt(m, at, quota, sized(first + allowed))? {
        Err((got, retry)) if got == limit => Ok(retry),
        other => Err(format!(
            "{}: the write over the limit got {other:?}",
            limit.as_str()
        )),
    }
}

fn each_limit(env: &MemoryEnv<'_>) -> CaseResult {
    // Writes per hour, per (principal, agent).
    let f = env.fresh()?;
    let m = &*f.memory;
    let quota = Quota {
        writes_per_hour: 3,
        ..Quota::unlimited()
    };
    let retry = trips(m, quota, 3, QuotaLimit::WritesPerHour, 1)?;
    ensure(
        retry.is_some_and(|ms| ms > 0 && ms <= HOUR_MS as u64),
        "a rate gives retry_after_ms",
    )?;
    let mut bo_note = samples::memory_entry(50, BO, &[P_BO], "Bo", "bo's own pair");
    samples::agree(&mut bo_note);
    attempt(m, T0 + 3, quota, bo_note)?.map_err(|e| format!("another principal: {e:?}"))?;
    let mut agent_note = sized(51);
    agent_note.scope.agent = Some(Actor {
        kind: ActorKind::Agent,
        id: Some("other-agent".into()),
        label: None,
        on_behalf_of: Some(ADA.into()),
    });
    samples::agree(&mut agent_note);
    attempt(m, T0 + 3, quota, agent_note)?.map_err(|e| format!("another agent: {e:?}"))?;
    attempt(m, T0 + HOUR_MS + 1, quota, sized(52))
        .and_then(|r| r.map_err(|e| format!("an hour later the window has moved: {e:?}")))?;
    // Stored records, per principal.
    let f = env.fresh()?;
    let m = &*f.memory;
    let quota = Quota {
        stored_records: 3,
        ..Quota::unlimited()
    };
    ensure_eq(
        trips(m, quota, 3, QuotaLimit::StoredRecords, 1)?,
        None,
        "a stored limit has no retry",
    )?;
    // Stored bytes, measured from one note.
    let f = env.fresh()?;
    let m = &*f.memory;
    attempt(m, T0, Quota::unlimited(), sized(100))?.map_err(|e| format!("{e:?}"))?;
    let one = m.usage(ADA, None, T0).ctx("usage")?;
    ensure_eq(one.stored_records, 1, "usage counts the note")?;
    ensure(
        one.stored_bytes > 0 && one.bytes > 0,
        "usage counts its bytes",
    )?;
    let quota = Quota {
        stored_bytes: one.stored_bytes * 3,
        ..Quota::unlimited()
    };
    trips(m, quota, 2, QuotaLimit::StoredBytes, 1)?;
    // Bytes per hour, per (principal, agent).
    let f = env.fresh()?;
    let m = &*f.memory;
    let quota = Quota {
        bytes_per_hour: one.bytes * 2,
        ..Quota::unlimited()
    };
    let retry = trips(m, quota, 2, QuotaLimit::BytesPerHour, 1)?;
    ensure(retry.is_some(), "a rate gives retry_after_ms")?;
    let usage = m.usage(ADA, None, T0).ctx("usage")?;
    ensure_eq(
        (usage.writes, usage.bytes),
        (2, one.bytes * 2),
        "usage in the window",
    )?;
    pass()
}

fn two_writers(env: &MemoryEnv<'_>) -> CaseResult {
    let f = env.fresh()?;
    let m = &*f.memory;
    // Provision first, so both writers race on the limit and not on creating the store.
    attempt(m, T0, Quota::unlimited(), sized(1))?.map_err(|e| format!("{e:?}"))?;
    let quota = Quota {
        stored_records: 10,
        ..Quota::unlimited()
    };
    let start = Barrier::new(2);
    let outcomes: Vec<Result<(u64, u64), String>> = std::thread::scope(|scope| {
        let handles: Vec<_> = [100_u64, 200]
            .into_iter()
            .map(|base| {
                let start = &start;
                scope.spawn(move || -> Result<(u64, u64), String> {
                    start.wait();
                    let (mut created, mut refused) = (0, 0);
                    for k in 0..20 {
                        match attempt(m, T0 + 1, quota, sized(base + k))? {
                            Ok(()) => created += 1,
                            Err((QuotaLimit::StoredRecords, None)) => refused += 1,
                            Err(other) => return Err(format!("the wrong refusal: {other:?}")),
                        }
                    }
                    Ok((created, refused))
                })
            })
            .collect();
        handles
            .into_iter()
            .map(|h| h.join().unwrap_or_else(|_| Err("a writer panicked".into())))
            .collect()
    });
    let mut created = 1;
    for outcome in outcomes {
        created += outcome?.0;
    }
    ensure_eq(created, 10, "exactly the limit was stored")?;
    ensure_eq(
        m.usage(ADA, None, T0).ctx("usage")?.stored_records,
        10,
        "usage",
    )?;
    pass()
}

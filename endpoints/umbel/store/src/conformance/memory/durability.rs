//! Group `memory_durability`: reopening returns the same head and contents.

use super::write::note;
use super::{ADA, MemoryEnv, T0, ada, list_query, write};
use crate::conformance::{CaseResult, Ctx, ensure_eq, pass, samples};
use crate::memory::{
    Confirm, DAY_MS, Forget, ForgetSelector, Invalidate, InvalidationReason, MemoryStore,
};

pub(super) const CASES: &[(&str, super::MemoryCaseFn)] =
    &[("reopen_returns_the_same_head_and_contents", reopen)];

type Snapshot = (
    u64,
    Vec<crate::memory::MemoryChange>,
    Vec<crate::memory::MemoryMeta>,
    Vec<Vec<crate::memory::MemoryRecord>>,
);

fn snapshot(m: &dyn MemoryStore) -> Result<Snapshot, String> {
    let now = T0 + 2 * DAY_MS;
    let mut query = list_query(now);
    query.flags.include_expired = true;
    let items = m.list(&query, &ada()).ctx("list")?.items;
    let histories = (1..=5)
        .map(|n| m.history(&samples::memory_id(n), &ada()).ctx("history"))
        .collect::<Result<Vec<_>, _>>()?;
    Ok((
        m.head().ctx("head")?,
        m.changes(0, 1000, &ada(), None).ctx("changes")?,
        items,
        histories,
    ))
}

fn reopen(env: &MemoryEnv<'_>) -> CaseResult {
    let f = env.fresh()?;
    let m = &*f.memory;
    write(
        m,
        T0,
        (1..=5).map(|n| note(n, &format!("durable {n}"))).collect(),
    )?;
    m.invalidate(
        Invalidate {
            id: samples::memory_id(2),
            at: T0 + DAY_MS,
            valid_until: T0 + DAY_MS,
            by: ADA.into(),
            reason: InvalidationReason::Duplicate,
            note: Some("a note".into()),
            expect_version: Some(1),
            trace_id: None,
        },
        &ada(),
    )
    .ctx("invalidate")?;
    let hash = m
        .history(&samples::memory_id(3), &ada())
        .ctx("history")?
        .first()
        .map(|r| r.content_hash.as_str().to_owned())
        .ok_or("record 3")?;
    m.confirm(
        Confirm {
            id: samples::memory_id(3),
            at: T0 + DAY_MS,
            by: ADA.into(),
            content_hash: hash,
            trace_id: None,
            assurance: Some(crate::Assurance::terminal()),
        },
        &ada(),
    )
    .ctx("confirm")?;
    m.forget(Forget {
        owner: ADA.into(),
        selector: ForgetSelector::Ids(vec![samples::memory_id(4)]),
        at: T0 + DAY_MS,
        trace_id: None,
    })
    .ctx("forget")?;
    let before = snapshot(m)?;
    let dir = f.dir.path().to_owned();
    let super::MemoryFresh { dir: guard, memory } = f;
    drop(memory);
    let reopened = env.reopen(&dir)?;
    let after = snapshot(&*reopened)?;
    ensure_eq(after.0, before.0, "the head")?;
    ensure_eq(after.1, before.1, "the changes")?;
    ensure_eq(after.2, before.2, "the records")?;
    ensure_eq(after.3, before.3, "the histories")?;
    let next = write(
        &*reopened,
        T0 + 2 * DAY_MS,
        vec![note(9, "after reopening")],
    )?;
    ensure_eq(
        next.from_rev,
        Some(before.0 + 1),
        "writes continue the sequence",
    )?;
    drop(guard);
    pass()
}

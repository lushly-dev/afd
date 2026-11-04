//! Reading memory (phase 4 specification, section 4.1; owner decision 4): `memory_list` under the
//! caller's reader filter, filtered on what the list returns, then `memory_get` of the survivors,
//! oldest first, for the content hash, observations, constraints, confirmation and text. Never a
//! derivation read: what the caller cannot read, the curator never sees.
//!
//! A call lists at most the pack's `max_records` and reads at most `max_gets`, a bounded cost
//! stated rather than a new store projection; what the bounds leave out is counted.

use umbel_sdk::{Cx, HostError, Outcome};
use umbel_store::memory::{MemoryCursor, MemoryList, MemoryMeta, MemoryOrder, Millis};
use umbel_store::{AsOf, MemoryClass, MemoryRecord, ReadFlags, ScopeQuery};

use crate::fail;
use crate::pack::Settle;

/// The largest list page the store serves.
const PAGE: u32 = umbel_store::memory::MAX_MEMORY_LIST_LIMIT;

/// What one call read, with the counts of what it left out.
#[derive(Debug, Default)]
pub(crate) struct Read {
    /// The records read in full, oldest first.
    pub(crate) records: Vec<MemoryRecord>,
    /// Records listed.
    pub(crate) listed: u64,
    /// Listed records that passed the list filter.
    pub(crate) eligible: u64,
    /// Eligible records not read in full because of `max_gets`.
    pub(crate) unread: u64,
    /// Readable records whose body did not open, as the store counts them.
    pub(crate) unopened: u64,
    /// Whether the list stopped at `max_records` with more to come.
    pub(crate) more: bool,
}

/// Whether a listed version may be a source at `now` (section 4.2 on what the list returns).
fn passes(meta: &MemoryMeta, now: Millis, settle: &Settle) -> bool {
    settle.window(meta.class).is_some()
        && meta.flags.is_empty()
        && settle.admits(meta.authority)
        && meta.valid_from <= now
        && meta.valid_until.is_none_or(|end| end > now)
        && meta.recorded_at <= now
        && meta.expires_at > now
}

/// The caller's readable memory in `space` at `now`, bounded by `settle`.
pub(crate) fn memory(cx: &Cx, space: &str, now: Millis, settle: &Settle) -> Result<Read, Outcome> {
    let mut read = Read::default();
    let mut survivors: Vec<(Millis, String)> = Vec::new();
    let mut after: Option<MemoryCursor> = None;
    let budget = u64::from(settle.max_records);
    loop {
        let left = budget.saturating_sub(read.listed);
        if left == 0 {
            read.more = after.is_some();
            break;
        }
        let query = MemoryList {
            scope: ScopeQuery::default(),
            classes: vec![MemoryClass::Semantic, MemoryClass::Procedural],
            tags: Vec::new(),
            authorities: settle.authorities.clone(),
            push: None,
            as_of: AsOf::at(now),
            flags: ReadFlags::at(now),
            order: MemoryOrder::Recorded,
            after: after.clone(),
            limit: u32::try_from(left.min(u64::from(PAGE))).unwrap_or(PAGE),
        };
        let page = match cx.memory_list(space, &query) {
            Ok(page) => page,
            Err(HostError::NotProvisioned) => return Ok(read),
            Err(error) => return Err(fail::host(&error)),
        };
        read.listed += page.items.len() as u64;
        read.unopened += page.unreadable;
        for meta in &page.items {
            if passes(meta, now, settle) {
                survivors.push((meta.recorded_at, meta.id.clone()));
            }
        }
        match page.next {
            Some(next) => after = Some(next),
            None => break,
        }
    }
    survivors.sort();
    survivors.dedup_by(|a, b| a.1 == b.1);
    read.eligible = survivors.len() as u64;
    let gets = usize::try_from(settle.max_gets).unwrap_or(usize::MAX);
    read.unread = survivors.len().saturating_sub(gets) as u64;
    for (_, id) in survivors.into_iter().take(gets) {
        match cx.memory_get(space, &id, AsOf::at(now), ReadFlags::at(now)) {
            Ok(Some(record)) => read.records.push(record),
            Ok(None) | Err(HostError::NotFound(_)) => {}
            Err(error) => return Err(fail::host(&error)),
        }
    }
    Ok(read)
}

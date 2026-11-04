//! Reading memory (phase 4 specification, section 4.1; owner decision 4): `memory_list` under the
//! caller's reader filter, filtered on what the list returns, then `memory_get` of the survivors,
//! oldest first, for the content hash, observations, constraints, confirmation and text. Never a
//! derivation read: what the caller cannot read, the curator never sees.
//!
//! A call lists at most the pack's `max_records` and reads at most `max_gets`, a bounded cost
//! stated rather than a new store projection; what the bounds leave out is counted.
//!
//! `curator-candidates` lists from the newest record each time ([`memory`]). A run continues a
//! **rotating** scan instead ([`scan`], section 7.3): it starts after the state's `scanAfter`,
//! wraps to the newest when it reaches the oldest, and stops where it began or at `max_records`,
//! so every record is reached across runs however many there are.

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
    /// Where a rotating scan continues next; `None` from the newest.
    pub(crate) next: Option<MemoryCursor>,
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

/// The caller's readable memory in `space` at `now`, bounded by `settle`, from the newest.
pub(crate) fn memory(cx: &Cx, space: &str, now: Millis, settle: &Settle) -> Result<Read, Outcome> {
    scan(cx, space, now, settle, None)
}

/// The list query of one page after `after`.
fn page_query(now: Millis, settle: &Settle, after: Option<MemoryCursor>, limit: u32) -> MemoryList {
    MemoryList {
        scope: ScopeQuery::default(),
        classes: vec![MemoryClass::Semantic, MemoryClass::Procedural],
        tags: Vec::new(),
        authorities: settle.authorities.clone(),
        push: None,
        as_of: AsOf::at(now),
        flags: ReadFlags::at(now),
        order: MemoryOrder::Recorded,
        after,
        limit,
    }
}

/// The caller's readable memory in `space` at `now`, bounded by `settle`, listed from just after
/// `start` (newest first), wrapping to the newest at the end and stopping where it began.
pub(crate) fn scan(
    cx: &Cx,
    space: &str,
    now: Millis,
    settle: &Settle,
    start: Option<MemoryCursor>,
) -> Result<Read, Outcome> {
    let mut read = Read::default();
    let mut survivors: Vec<(Millis, String)> = Vec::new();
    let mut after = start.clone();
    // After a wrap, items up to and including `start` are new to this run; the first one past it
    // was listed at the beginning.
    let mut wrapped = start.is_none();
    let budget = u64::from(settle.max_records);
    'pages: loop {
        let left = budget.saturating_sub(read.listed);
        if left == 0 {
            read.more = true;
            read.next = after.clone();
            break;
        }
        let limit = u32::try_from(left.min(u64::from(PAGE))).unwrap_or(PAGE);
        let page = match cx.memory_list(space, &page_query(now, settle, after.clone(), limit)) {
            Ok(page) => page,
            Err(HostError::NotProvisioned) => return Ok(read),
            Err(error) => return Err(fail::host(&error)),
        };
        read.unopened += page.unreadable;
        for meta in &page.items {
            if wrapped
                && let Some(begin) = start.as_ref()
                && begin.precedes(meta.recorded_at, &meta.id)
            {
                // Back where this run began: every listable record was reached.
                read.next = None;
                break 'pages;
            }
            read.listed += 1;
            if passes(meta, now, settle) {
                survivors.push((meta.recorded_at, meta.id.clone()));
            }
        }
        if page.next.is_none() {
            if wrapped {
                read.next = None;
                break;
            }
            // The oldest record: start again from the newest, up to where this run began.
            wrapped = true;
            after = None;
            continue;
        }
        after = page.next;
    }
    survivors.sort();
    survivors.dedup_by(|a, b| a.1 == b.1);
    read.eligible = survivors.len() as u64;
    let gets = usize::try_from(settle.max_gets).unwrap_or(usize::MAX);
    read.unread = survivors.len().saturating_sub(gets) as u64;
    for (_, id) in survivors.into_iter().take(gets) {
        if let Some(record) = get(cx, space, &id, now)? {
            read.records.push(record);
        }
    }
    Ok(read)
}

/// `id`'s current version at `now` under the caller's reader filter, as a source must stand:
/// `None` when the caller reads no live, unflagged, unexpired version of it.
pub(crate) fn get(
    cx: &Cx,
    space: &str,
    id: &str,
    now: Millis,
) -> Result<Option<MemoryRecord>, Outcome> {
    match cx.memory_get(space, id, AsOf::at(now), ReadFlags::at(now)) {
        Ok(record) => Ok(record),
        Err(HostError::NotFound(_) | HostError::NotProvisioned) => Ok(None),
        Err(error) => Err(fail::host(&error)),
    }
}

//! The memory groups (phase 3 section 5.5): what every `MemoryStore` backend must pass.
//!
//! A backend supplies a **memory factory**, which opens (creating nothing until the first write)
//! the memory store of space [`SPACE`] under a directory; optionally a [`MemoryRestore`], which
//! puts a `backup` copy in place by the backend's own procedure (the erasure group's copy case
//! is skipped without one); and optionally a `spawn_writer`, whose child test opens the same
//! directory and calls [`run_memory_child`]. Through [`super::run_all`] the groups run on the
//! stores' `memory` instead, and the child is the suite's own [`super::run_child`], told by
//! [`super::ENV_KIND`] to write memory records.

mod access;
mod bitemporal;
mod concurrency;
mod durability;
mod erasure;
mod fixture;
mod lifecycle;
mod quota;
mod recall;
mod write;

use std::io::Write as _;
use std::path::Path;
use std::sync::Arc;

use super::child::{ENV_COUNT, ENV_ID, WROTE_PREFIX, wait_for_start};
use super::{
    CaseReport, CaseResult, Ctx, Factory, GroupReport, Outcome, Report, SPACE, SpawnWriter,
    run_case, samples,
};
use crate::memory::{
    AsOf, MemoryBatch, MemoryList, MemoryOrder, MemoryReceipt, MemoryRecord, MemoryStore,
    MemoryWrite, Millis, ReadFlags, RecallQuery, ScopeQuery,
};
use crate::{MemoryQuery, ReaderFilter, StoreError};

/// Opens the memory store of the given space under a directory. Called again on the same
/// directory to reopen.
pub type MemoryFactory<'a> = &'a dyn Fn(&Path, &str) -> Result<Arc<dyn MemoryStore>, StoreError>;

/// Puts the copy that `backup(backup)` wrote in place of the live memory under `dir`, by the
/// backend's own procedure, keeping its key material (section 5.5). The suite has dropped every
/// handle to the store first, and reopens it through the factory after.
pub type MemoryRestore = fn(dir: &Path, space: &str, backup: &Path) -> Result<(), StoreError>;

type MemoryCaseFn = fn(&MemoryEnv<'_>) -> CaseResult;
type MemoryGroup = (&'static str, &'static [(&'static str, MemoryCaseFn)]);

const GROUPS: &[MemoryGroup] = &[
    ("memory_write", write::CASES),
    ("memory_bitemporal", bitemporal::CASES),
    ("memory_access", access::CASES),
    ("memory_recall", recall::CASES),
    ("memory_lifecycle", lifecycle::CASES),
    ("memory_erasure", erasure::CASES),
    ("memory_quota", quota::CASES),
    ("memory_concurrency", concurrency::CASES),
    ("memory_durability", durability::CASES),
];

/// The memory groups' names, in run order.
pub const MEMORY_GROUPS: [&str; 9] = [
    "memory_write",
    "memory_bitemporal",
    "memory_access",
    "memory_recall",
    "memory_lifecycle",
    "memory_erasure",
    "memory_quota",
    "memory_concurrency",
    "memory_durability",
];

/// Run every memory group against a backend.
#[must_use]
pub fn run_memory(
    factory: MemoryFactory<'_>,
    restore: Option<MemoryRestore>,
    spawn_writer: Option<SpawnWriter>,
) -> Report {
    run_memory_groups(factory, restore, spawn_writer, &[])
}

/// Run the named memory groups (all of them when `only` is empty), in the suite's order.
#[must_use]
pub fn run_memory_groups(
    factory: MemoryFactory<'_>,
    restore: Option<MemoryRestore>,
    spawn_writer: Option<SpawnWriter>,
    only: &[&str],
) -> Report {
    let env = MemoryEnv {
        factory,
        restore,
        spawn_writer,
    };
    let groups = GROUPS
        .iter()
        .filter(|(name, _)| only.is_empty() || only.contains(name))
        .map(|(name, cases)| GroupReport {
            name,
            cases: cases
                .iter()
                .map(|(case, run)| CaseReport {
                    name: case,
                    outcome: run_case(&env, *run),
                })
                .collect(),
        })
        .collect();
    Report { groups }
}

/// The memory groups named in `only` (all when it is empty), run through a phase 2 factory on the
/// stores' `memory`: skipped when the stores carry none, failed when the factory fails.
pub(super) fn run_through_stores(
    factory: Factory<'_>,
    spawn_writer: Option<SpawnWriter>,
    only: &[&str],
) -> Vec<GroupReport> {
    let wanted: Vec<&str> = MEMORY_GROUPS
        .into_iter()
        .filter(|name| only.is_empty() || only.contains(name))
        .collect();
    if wanted.is_empty() {
        return Vec::new();
    }
    let every_case = |outcome: &Outcome| -> Vec<GroupReport> {
        GROUPS
            .iter()
            .filter(|(name, _)| wanted.contains(name))
            .map(|(name, cases)| GroupReport {
                name,
                cases: cases
                    .iter()
                    .map(|(case, _)| CaseReport {
                        name: case,
                        outcome: outcome.clone(),
                    })
                    .collect(),
            })
            .collect()
    };
    let probe = match tempfile::tempdir() {
        Ok(dir) => dir,
        Err(e) => return every_case(&Outcome::Failed(format!("a temporary directory: {e}"))),
    };
    let restore = match factory(probe.path(), SPACE) {
        Ok(stores) if stores.memory.is_some() => stores.memory_restore,
        Ok(_) => {
            return every_case(&Outcome::Skipped(
                "the backend's stores carry no memory store".to_owned(),
            ));
        }
        Err(e) => return every_case(&Outcome::Failed(format!("opening the stores: {e}"))),
    };
    drop(probe);
    let memory_factory = |dir: &Path, space: &str| -> Result<Arc<dyn MemoryStore>, StoreError> {
        factory(dir, space)?
            .memory
            .ok_or_else(|| StoreError::invalid("the stores carry no memory store"))
    };
    run_memory_groups(&memory_factory, restore, spawn_writer, &wanted).groups
}

/// The base id of a writer child's records: `a` writes from 1000, `b` from 2000, any other name
/// from 3000.
fn child_base(name: &str) -> u64 {
    match name {
        "a" => 1000,
        "b" => 2000,
        _ => 3000,
    }
}

/// Write `ENV_COUNT` memory records for the child named `ENV_ID`, one batch each, printing one
/// `UMBEL-WROTE <rev> <id>` line for each.
///
/// # Errors
/// Why the child failed.
pub fn write_memories(memory: &dyn MemoryStore) -> Result<(), String> {
    let name = std::env::var(ENV_ID).map_err(|_| format!("{ENV_ID} is not set"))?;
    let count: u64 = std::env::var(ENV_COUNT)
        .map_err(|_| format!("{ENV_COUNT} is not set"))?
        .parse()
        .map_err(|e| format!("{ENV_COUNT}: {e}"))?;
    let mut out = std::io::stdout().lock();
    for n in 0..count {
        let id_n = child_base(&name) + n;
        let entry = samples::memory_entry(
            id_n,
            ADA,
            &[P_ADA],
            &format!("child {name} {n}"),
            &format!("written by child {name}, number {n}"),
        );
        let receipt = memory
            .write(samples::memory_batch(samples::MEMORY_AT, vec![entry]))
            .ctx("write")?;
        let rev = receipt.to_rev.ok_or("a write took no revision")?;
        writeln!(out, "{WROTE_PREFIX} {rev} {}", samples::memory_id(id_n))
            .map_err(|e| e.to_string())?;
    }
    out.flush().map_err(|e| e.to_string())
}

/// The memory child's work: [`wait_for_start`], then [`write_memories`]. A backend's writer
/// child test opens the memory store in `ENV_WRITER` and calls this.
///
/// # Errors
/// Why the child failed.
pub fn run_memory_child(memory: &dyn MemoryStore) -> Result<(), String> {
    wait_for_start()?;
    write_memories(memory)
}

/// What a memory case needs.
pub(super) struct MemoryEnv<'a> {
    pub(super) factory: MemoryFactory<'a>,
    pub(super) restore: Option<MemoryRestore>,
    pub(super) spawn_writer: Option<SpawnWriter>,
}

/// A directory and the memory store opened in it.
pub(super) struct MemoryFresh {
    pub(super) dir: tempfile::TempDir,
    pub(super) memory: Arc<dyn MemoryStore>,
}

impl MemoryEnv<'_> {
    /// A new empty directory with a fresh memory store.
    pub(super) fn fresh(&self) -> Result<MemoryFresh, String> {
        let dir = tempfile::tempdir().map_err(|e| format!("a temporary directory: {e}"))?;
        let memory = (self.factory)(dir.path(), SPACE)
            .map_err(|e| format!("opening a fresh memory store: {e}"))?;
        Ok(MemoryFresh { dir, memory })
    }

    /// Reopen the memory store under `dir`.
    pub(super) fn reopen(&self, dir: &Path) -> Result<Arc<dyn MemoryStore>, String> {
        (self.factory)(dir, SPACE).map_err(|e| format!("reopening the memory store: {e}"))
    }
}

/// The suite's people.
pub(super) const ADA: &str = "human:ada";
pub(super) const BO: &str = "human:bo";
/// Their private tokens.
pub(super) const P_ADA: &str = "principal:human:ada";
pub(super) const P_BO: &str = "principal:human:bo";

/// The suite's clock: [`samples::MEMORY_AT`].
pub(super) const T0: Millis = samples::MEMORY_AT;

/// Ada's reader: her principal and `space`.
pub(super) fn ada() -> ReaderFilter {
    super::reader(&[P_ADA, "space"])
}

/// Bo's reader.
pub(super) fn bo() -> ReaderFilter {
    super::reader(&[P_BO, "space"])
}

/// Write one batch of entries at `at`.
pub(super) fn write(
    memory: &dyn MemoryStore,
    at: Millis,
    entries: Vec<MemoryWrite>,
) -> Result<MemoryReceipt, String> {
    memory
        .write(samples::memory_batch(at, entries))
        .ctx("write")
}

/// Write a batch and require it to be refused with an error, and to leave the head where it was.
pub(super) fn refused(
    memory: &dyn MemoryStore,
    batch: MemoryBatch,
    what: &str,
    is: impl Fn(&StoreError) -> bool,
) -> Result<(), String> {
    let head = memory.head().ok();
    super::expect_err(memory.write(batch), what, is)?;
    super::ensure_eq(memory.head().ok(), head, &format!("{what}: the head"))
}

/// Flags letting flagged and expired records through, at `now`.
pub(super) fn all_flags(now: Millis) -> ReadFlags {
    ReadFlags {
        include_flagged: true,
        include_expired: true,
        now,
    }
}

/// The record at `at` (both instants), flagged and expired included.
pub(super) fn get_at(
    memory: &dyn MemoryStore,
    id: &str,
    at: Millis,
    reader: &ReaderFilter,
) -> Result<Option<MemoryRecord>, String> {
    memory
        .get(id, AsOf::at(at), all_flags(at), reader)
        .ctx("get")
}

/// A list of everything readable at `now`, flagged included, expired not.
pub(super) fn list_query(now: Millis) -> MemoryList {
    MemoryList {
        scope: ScopeQuery::default(),
        classes: Vec::new(),
        tags: Vec::new(),
        authorities: Vec::new(),
        push: None,
        as_of: AsOf::at(now),
        flags: ReadFlags {
            include_flagged: true,
            include_expired: false,
            now,
        },
        order: MemoryOrder::Recorded,
        after: None,
        limit: 500,
    }
}

/// The ids `list` returns for `query`, in order, over every page.
pub(super) fn list_ids(
    memory: &dyn MemoryStore,
    query: &MemoryList,
    reader: &ReaderFilter,
) -> Result<Vec<String>, String> {
    let mut query = query.clone();
    let mut out = Vec::new();
    loop {
        let page = memory.list(&query, reader).ctx("list")?;
        out.extend(page.items.iter().map(|m| m.id.clone()));
        match page.next {
            Some(next) => query.after = Some(next),
            None => return Ok(out),
        }
    }
}

/// A recall of `text` at `now`, flagged included, limit 200.
pub(super) fn recall_query(text: &str, now: Millis) -> Result<RecallQuery, String> {
    Ok(RecallQuery {
        query: MemoryQuery::parse(text).ctx("parse")?,
        scope: ScopeQuery::default(),
        classes: Vec::new(),
        tags: Vec::new(),
        authorities: Vec::new(),
        push: None,
        as_of: AsOf::at(now),
        flags: ReadFlags {
            include_flagged: true,
            include_expired: false,
            now,
        },
        limit: 200,
    })
}

/// The ids `recall` returns, in rank order.
pub(super) fn recall_ids(
    memory: &dyn MemoryStore,
    query: &RecallQuery,
    reader: &ReaderFilter,
) -> Result<Vec<String>, String> {
    Ok(memory
        .recall(query, reader)
        .ctx("recall")?
        .hits
        .into_iter()
        .map(|h| h.record.id)
        .collect())
}

/// `StoreError::NotFound`.
pub(super) fn not_found(error: &StoreError) -> bool {
    matches!(error, StoreError::NotFound)
}

/// `Invalid` or `TooLarge`: a refused write.
pub(super) fn refused_write(error: &StoreError) -> bool {
    matches!(error, StoreError::Invalid(_) | StoreError::TooLarge(_))
}

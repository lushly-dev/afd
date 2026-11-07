//! A deliberately breakable in-memory memory store for `memory_suite_detects.rs`. With
//! `MemoryFault::None` it is a correct backend (the memory groups pass against it); every other
//! fault breaks one rule the groups exist to catch.
//!
//! "Sealing" is modelled by a per-record key number kept apart from the rows: a row opens only
//! while its key entry holds that number, a forget leaves a marker in its place, and a backup
//! copies rows and never keys. Writes run on a copy of the state that replaces it only when the
//! whole batch succeeds, which is the fake's transaction.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use umbel_store::memory::{
    BackupReceipt, ClassCounts, Confirm, EntryReceipt, EntryState, ForgetReceipt, HOUR_MS,
    IDEMPOTENCY_KEEP_MS, Invalidate, Invalidation, InvalidationReason, KeyFileState, KeyStatus,
    LeftOut, MAX_MEMORY_CHANGES_LIMIT, MAX_MEMORY_LIST_LIMIT, MAX_RECALL_LIMIT, MAX_SWEEP_LIMIT,
    MemoryChange, MemoryChangeKind, MemoryCounts, MemoryCursor, MemoryFlag, MemoryList, MemoryMeta,
    MemoryPage, MemoryReceipt, MemoryUsage, MemoryVersionMeta, Observations, Occur,
    PURGE_BEFORE_WRITE, QueryTerm, QuotaLimit, RecallHit, RecallPage, RecallQuery, ReindexReceipt,
    Retention, Sweep, SweepReceipt, TermField, WalState, WriteRefusal, capture_key_under,
    capture_session_prefix, check_limit, content_hash_prefix_matches, format_instant,
    refuse_derivation,
};
use umbel_store::memory::{Forget, MemoryScope};
use umbel_store::{
    AccessSet, AsOf, Authority, Confirmation, ContentHash, Envelope, ForgetSelector, MemoryBatch,
    MemoryClass, MemoryQuery, MemoryRecord, MemoryStore, Millis, PushFilter, ReadFlags,
    ReaderFilter, Rev, ScopeQuery, StoreError,
};

/// What is broken.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum MemoryFault {
    None,
    /// `list` ignores the reader filter.
    UnfilteredRead,
    /// `invalidate` edits the current version in place instead of closing it.
    OverwritingInvalidate,
    /// `forget` closes the record's validity and keeps its rows and text.
    ForgetKeepsText,
    /// `forget` deletes the rows and keeps the key.
    ForgetKeepsKey,
    /// The quota is checked, the lock released, and the write made under a second lock. Between
    /// the two, a writer waits for another to check too (see `Gap`), so two writers always both
    /// pass the check before either writes and the race is lost every time, not by luck.
    QuotaOutsideTransaction,
    /// A `+` term is treated as a plain one.
    RequiredIsOptional,
    /// An idempotency key is shared by every owner and authority.
    GlobalIdempotency,
    /// Expiry is measured at the valid instant instead of now.
    ExpiryAtValidInstant,
}

#[derive(Clone)]
struct Version {
    number: u32,
    valid_from: Millis,
    valid_until: Option<Millis>,
    recorded_at: Millis,
    recorded_until: Option<Millis>,
    invalidation: Option<Invalidation>,
    superseded_by: Option<String>,
    envelope: Envelope,
}

impl Version {
    fn authority(&self) -> Authority {
        self.envelope
            .authority
            .as_deref()
            .and_then(Authority::parse)
            .unwrap_or(Authority::Agent)
    }
}

#[derive(Clone)]
struct Rec {
    id: String,
    class: MemoryClass,
    scope: MemoryScope,
    subject: String,
    text: String,
    tags: Vec<String>,
    access: AccessSet,
    sensitivity: umbel_store::Sensitivity,
    flags: Vec<MemoryFlag>,
    expires_at: Millis,
    supersedes: Vec<String>,
    capture_key: Option<String>,
    observations: Vec<(Option<String>, Millis)>,
    content_hash: ContentHash,
    versions: Vec<Version>,
    seal: u64,
    bytes: u64,
}

impl Rec {
    fn current(&self) -> &Version {
        &self.versions[self.versions.len() - 1]
    }

    fn at(&self, as_of: AsOf) -> Option<&Version> {
        self.versions.iter().find(|v| {
            as_of.matches(
                (v.recorded_at, v.recorded_until),
                (v.valid_from, v.valid_until),
            )
        })
    }

    fn record(&self, v: &Version) -> MemoryRecord {
        let sessions: BTreeSet<_> = self
            .observations
            .iter()
            .filter_map(|(s, _)| s.clone())
            .collect();
        MemoryRecord {
            id: self.id.clone(),
            record_version: v.number,
            class: self.class,
            scope: self.scope.clone(),
            subject: self.subject.clone(),
            text: self.text.clone(),
            tags: self.tags.clone(),
            access: self.access.clone(),
            sensitivity: self.sensitivity,
            flags: self.flags.clone(),
            valid_from: v.valid_from,
            valid_until: v.valid_until,
            recorded_at: v.recorded_at,
            recorded_until: v.recorded_until,
            expires_at: self.expires_at,
            observations: Observations {
                first: self.observations.first().map_or(0, |o| o.1),
                last: self.observations.iter().map(|o| o.1).max().unwrap_or(0),
                count: self.observations.len() as u64,
                sessions: sessions.len() as u64,
            },
            supersedes: self.supersedes.clone(),
            superseded_by: v.superseded_by.clone(),
            invalidation: v.invalidation.clone(),
            content_hash: self.content_hash.clone(),
            provenance: v.envelope.clone(),
        }
    }

    fn meta(&self, v: &Version) -> MemoryMeta {
        MemoryMeta {
            id: self.id.clone(),
            record_version: v.number,
            class: self.class,
            scope: self.scope.clone(),
            subject: self.subject.clone(),
            tags: self.tags.clone(),
            access: self.access.clone(),
            sensitivity: self.sensitivity,
            flags: self.flags.clone(),
            authority: v.authority(),
            origin: v.envelope.origin,
            valid_from: v.valid_from,
            valid_until: v.valid_until,
            recorded_at: v.recorded_at,
            expires_at: self.expires_at,
        }
    }

    /// The next version: the current one closed at `recorded`, the copy edited by `edit`.
    fn close(&mut self, recorded: Millis, trace: Option<String>, edit: impl FnOnce(&mut Version)) {
        let last = self.versions.len() - 1;
        self.versions[last].recorded_until = Some(recorded);
        let mut next = self.versions[last].clone();
        next.number += 1;
        next.recorded_at = recorded;
        next.recorded_until = None;
        next.envelope.trace_id = trace;
        next.envelope.observed_at = format_instant(recorded);
        edit(&mut next);
        next.envelope.valid_until = next.valid_until.map(format_instant);
        self.versions.push(next);
    }
}

#[derive(Clone)]
struct ChangeRow {
    change: MemoryChange,
    access: AccessSet,
    owner: String,
    agent: Option<String>,
    bytes: u64,
}

type IdemKey = (String, Option<Authority>, String);

#[derive(Clone, Default)]
struct State {
    provisioned: bool,
    records: BTreeMap<String, Rec>,
    /// `Some(seal)` for a live key, `None` for a destroyed marker.
    keys: BTreeMap<String, Option<u64>>,
    changes: Vec<ChangeRow>,
    tombstones: BTreeSet<String>,
    erased: BTreeMap<String, BTreeSet<String>>,
    idempotency: BTreeMap<IdemKey, (Millis, MemoryReceipt)>,
    next_seal: u64,
}

enum Key {
    Open,
    Absent,
    Destroyed,
    Wrong,
}

impl State {
    fn key(&self, rec: &Rec) -> Key {
        match self.keys.get(&rec.id) {
            Some(Some(k)) if *k == rec.seal => Key::Open,
            Some(Some(_)) => Key::Wrong,
            Some(None) => Key::Destroyed,
            None => Key::Absent,
        }
    }

    fn head(&self) -> Rev {
        self.changes.last().map_or(0, |c| c.change.rev)
    }

    fn push_change(
        &mut self,
        rec: &Rec,
        kind: MemoryChangeKind,
        at: Millis,
        trace: Option<String>,
        bytes: u64,
    ) -> Rev {
        let rev = self.head() + 1;
        self.changes.push(ChangeRow {
            change: MemoryChange {
                rev,
                kind,
                id: rec.id.clone(),
                record_version: rec.current().number,
                trace_id: trace,
                at,
            },
            access: rec.access.clone(),
            owner: rec.scope.principal.clone(),
            agent: rec.scope.agent_id().map(str::to_owned),
            bytes,
        });
        rev
    }

    /// Purge at most `limit` records past their purge date: key marker, rows gone, a `Purged`
    /// change, no tombstone.
    fn purge(&mut self, now: Millis, retention: Retention, limit: u32) -> u64 {
        let due: Vec<String> = self
            .records
            .values()
            .filter(|r| past_purge(r, retention, now))
            .map(|r| r.id.clone())
            .take(limit as usize)
            .collect();
        for id in &due {
            if let Some(rec) = self.records.remove(id) {
                self.keys.insert(id.clone(), None);
                self.push_change(&rec, MemoryChangeKind::Purged, now, None, 0);
            }
        }
        due.len() as u64
    }

    fn stored(&self, owner: &str) -> (u64, u64) {
        let owned = self.records.values().filter(|r| r.scope.principal == owner);
        owned.fold((0, 0), |(n, b), r| (n + 1, b + r.bytes))
    }

    /// Writes and bytes of the pair at or after `since`.
    fn written(
        &self,
        owner: &str,
        agent: Option<&str>,
        since: Millis,
    ) -> (u64, u64, Option<Millis>) {
        let rows = self.changes.iter().filter(|c| {
            c.owner == owner
                && c.agent.as_deref() == agent
                && c.change.at >= since
                && matches!(
                    c.change.kind,
                    MemoryChangeKind::Created | MemoryChangeKind::Observed
                )
        });
        rows.fold((0, 0, None), |(n, b, oldest), c| {
            (
                n + 1,
                b + c.bytes,
                Some(oldest.map_or(c.change.at, |o: Millis| o.min(c.change.at))),
            )
        })
    }
}

fn past_purge(rec: &Rec, retention: Retention, now: Millis) -> bool {
    let current = rec.current();
    let invalidated = current.invalidation.as_ref().map(|_| current.recorded_at);
    retention.past_purge(rec.class, rec.expires_at, invalidated, now)
}

pub(crate) struct FakeMemory {
    fault: MemoryFault,
    state: Mutex<State>,
    gap: Mutex<Gap>,
    met: Condvar,
}

/// How long a checked writer waits for a partner while it has never seen one.
const ALONE: Duration = Duration::from_millis(50);
/// How long it waits once two writers have been inside `write` at the same time.
const PAIRED: Duration = Duration::from_secs(5);

/// Where `QuotaOutsideTransaction`'s writers meet between the check and the write. A writer that
/// has passed the check waits until another writer passes it too, then both write: every round
/// checks the same state twice, so two writers at the limit both get in. A lone writer waits
/// only `ALONE`, so the single-writer cases stay quick.
#[derive(Default)]
struct Gap {
    /// Writers inside the faulty write.
    inside: usize,
    /// Two writers have been inside at once.
    paired: bool,
    /// A checked writer is waiting for a partner.
    waiting: bool,
    /// Bumped when a partner arrives, which releases the waiting writer.
    round: u64,
}

/// Counts a writer inside the faulty write until it returns.
struct Inside<'a>(&'a FakeMemory);

impl<'a> Inside<'a> {
    fn enter(fake: &'a FakeMemory) -> Self {
        let mut gap = locked(&fake.gap);
        gap.inside += 1;
        if gap.inside > 1 && !gap.paired {
            gap.paired = true;
            fake.met.notify_all();
        }
        Self(fake)
    }
}

impl Drop for Inside<'_> {
    fn drop(&mut self) {
        locked(&self.0.gap).inside -= 1;
    }
}

static REGISTRY: Mutex<BTreeMap<PathBuf, Arc<FakeMemory>>> = Mutex::new(BTreeMap::new());
static BACKUPS: Mutex<BTreeMap<PathBuf, State>> = Mutex::new(BTreeMap::new());

fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// A factory whose store survives reopening: one fake per directory.
pub(crate) fn memory_factory(
    fault: MemoryFault,
) -> impl Fn(&Path, &str) -> Result<Arc<dyn MemoryStore>, StoreError> {
    move |dir, _space| {
        let fake = locked(&REGISTRY)
            .entry(dir.to_owned())
            .or_insert_with(|| {
                Arc::new(FakeMemory {
                    fault,
                    state: Mutex::new(State::default()),
                    gap: Mutex::new(Gap::default()),
                    met: Condvar::new(),
                })
            })
            .clone();
        Ok(fake)
    }
}

/// The fake's restore: the backup's rows in place of the live ones, the live keys kept.
pub(crate) fn memory_restore(dir: &Path, _space: &str, backup: &Path) -> Result<(), StoreError> {
    let copy = locked(&BACKUPS)
        .get(backup)
        .cloned()
        .ok_or_else(|| StoreError::Io("no fake backup there".into()))?;
    let registry = locked(&REGISTRY);
    let fake = registry
        .get(dir)
        .ok_or_else(|| StoreError::Io("no fake store there".into()))?;
    let mut state = locked(&fake.state);
    let keys = std::mem::take(&mut state.keys);
    *state = copy;
    state.keys = keys;
    Ok(())
}

impl FakeMemory {
    fn lock(&self) -> MutexGuard<'_, State> {
        locked(&self.state)
    }

    /// Wait, between the check and the write, for another writer to pass the check (`Gap`).
    fn meet(&self) {
        let mut gap = locked(&self.gap);
        if gap.waiting {
            gap.waiting = false;
            gap.round += 1;
            self.met.notify_all();
            return;
        }
        gap.waiting = true;
        let (round, start) = (gap.round, Instant::now());
        while gap.round == round {
            let limit = if gap.paired { PAIRED } else { ALONE };
            let Some(left) = limit.checked_sub(start.elapsed()).filter(|d| !d.is_zero()) else {
                gap.waiting = false;
                return;
            };
            gap = self
                .met
                .wait_timeout(gap, left)
                .unwrap_or_else(PoisonError::into_inner)
                .0;
        }
    }

    /// The state, provisioned, or `NotProvisioned`.
    fn read(&self) -> Result<MutexGuard<'_, State>, StoreError> {
        let state = self.lock();
        if state.provisioned {
            Ok(state)
        } else {
            Err(StoreError::NotProvisioned)
        }
    }

    fn passes(&self, rec: &Rec, as_of: AsOf, flags: ReadFlags) -> bool {
        let clock = if self.fault == MemoryFault::ExpiryAtValidInstant {
            as_of.valid
        } else {
            flags.now
        };
        (flags.include_expired || rec.expires_at > clock)
            && (flags.include_flagged || rec.flags.is_empty())
    }

    /// The readable, open, matching records of a list or recall, and how many were unreadable.
    #[allow(clippy::too_many_arguments)]
    fn candidates<'s>(
        &self,
        state: &'s State,
        reader: &ReaderFilter,
        scope: &ScopeQuery,
        classes: &[MemoryClass],
        tags: &[String],
        authorities: &[Authority],
        push: Option<&PushFilter>,
        as_of: AsOf,
        flags: ReadFlags,
    ) -> (Vec<(&'s Rec, &'s Version)>, u64) {
        let mut out = Vec::new();
        let mut unreadable = 0;
        for rec in state.records.values() {
            let admitted = reader.admits(&rec.access) || self.fault == MemoryFault::UnfilteredRead;
            if !admitted || !scope.admits(&rec.scope) {
                continue;
            }
            match state.key(rec) {
                Key::Open => {}
                Key::Destroyed => continue,
                Key::Absent | Key::Wrong => {
                    unreadable += 1;
                    continue;
                }
            }
            let Some(v) = rec.at(as_of) else { continue };
            let wanted = self.passes(rec, as_of, flags)
                && (classes.is_empty() || classes.contains(&rec.class))
                && tags.iter().all(|t| rec.tags.contains(t))
                && (authorities.is_empty() || authorities.contains(&v.authority()))
                && push.is_none_or(|p| {
                    p.admits(
                        &rec.scope.principal,
                        v.authority(),
                        rec.scope.project.as_deref(),
                        &scope.project,
                        !rec.flags.is_empty(),
                    )
                });
            if wanted {
                out.push((rec, v));
            }
        }
        (out, unreadable)
    }

    /// The readable record `id` for a change, or the answer an absent one gets.
    fn changeable<'s>(
        state: &'s mut State,
        id: &str,
        reader: &ReaderFilter,
    ) -> Result<&'s mut Rec, StoreError> {
        let key = match state.records.get(id) {
            Some(rec) if reader.admits(&rec.access) => state.key(rec),
            _ => return Err(StoreError::NotFound),
        };
        match key {
            Key::Open => {}
            Key::Destroyed => return Err(StoreError::NotFound),
            Key::Absent => return Err(StoreError::KeyAbsent { id: id.to_owned() }),
            Key::Wrong => return Err(StoreError::SealInvalid { id: id.to_owned() }),
        }
        state.records.get_mut(id).ok_or(StoreError::NotFound)
    }

    fn apply(
        &self,
        state: &mut State,
        batch: &MemoryBatch,
        owner: &str,
        authority: Authority,
        hashes: &[ContentHash],
    ) -> Result<MemoryReceipt, StoreError> {
        let at = batch.at;
        let idem = batch.idempotency.as_ref().map(|k| {
            if self.fault == MemoryFault::GlobalIdempotency {
                (String::new(), None, k.clone())
            } else {
                (owner.to_owned(), Some(authority), k.clone())
            }
        });
        if let Some((_, receipt)) = idem.as_ref().and_then(|k| state.idempotency.get(k)) {
            let mut receipt = receipt.clone();
            receipt.replayed = true;
            return Ok(receipt);
        }
        if let Some(key) = &batch.capture_key
            && state
                .erased
                .get(owner)
                .is_some_and(|prefixes| prefixes.iter().any(|p| capture_key_under(p, key)))
        {
            return Ok(MemoryReceipt {
                entries: Vec::new(),
                superseded: Vec::new(),
                from_rev: None,
                to_rev: None,
                replayed: false,
                refused: Some(WriteRefusal::Erased),
            });
        }
        let first_rev = state.head() + 1;
        let mut entries = Vec::new();
        let mut superseded = Vec::new();
        for (entry, hash) in batch.entries.iter().zip(hashes) {
            let observed = state
                .records
                .values()
                .find(|r| {
                    let current = r.current();
                    r.scope.principal == owner
                        && r.scope.project == entry.scope.project
                        && r.class == entry.class
                        && r.content_hash == *hash
                        && current.authority() == authority
                        && r.access == entry.access
                        && r.expires_at > at
                        && current.invalidation.is_none()
                        && current.valid_until.is_none_or(|u| u > at)
                        && matches!(state.key(r), Key::Open)
                })
                .map(|r| r.id.clone());
            if let Some(id) = observed {
                let Some(rec) = state.records.get_mut(&id) else {
                    return Err(StoreError::Corrupt("the observed record vanished".into()));
                };
                rec.observations.push((entry.scope.session.clone(), at));
                if let Some(renew) = entry.renew {
                    let first = rec.versions[0].recorded_at;
                    let until = (at + renew.ttl_ms).min(first + renew.max_ttl_ms);
                    rec.expires_at = rec.expires_at.max(until);
                }
                let rec = rec.clone();
                state.push_change(
                    &rec,
                    MemoryChangeKind::Observed,
                    at,
                    entry.envelope.trace_id.clone(),
                    0,
                );
                entries.push(EntryReceipt {
                    id,
                    record_version: rec.current().number,
                    state: EntryState::Observed,
                    expires_at: rec.expires_at,
                });
                continue;
            }
            if state.records.contains_key(&entry.id)
                || state.keys.contains_key(&entry.id)
                || state.tombstones.contains(&entry.id)
            {
                return Err(StoreError::invalid(format!(
                    "memory id {} is already used",
                    entry.id
                )));
            }
            state.next_seal += 1;
            let seal = state.next_seal;
            let bytes = 2
                * (entry.subject.len()
                    + entry.text.len()
                    + entry.tags.iter().map(String::len).sum::<usize>()) as u64;
            let rec = Rec {
                id: entry.id.clone(),
                class: entry.class,
                scope: entry.scope.clone(),
                subject: entry.subject.clone(),
                text: entry.text.clone(),
                tags: entry.tags.clone(),
                access: entry.access.clone(),
                sensitivity: entry.sensitivity,
                flags: entry.flags.clone(),
                expires_at: entry.expires_at,
                supersedes: entry.supersedes.clone(),
                capture_key: batch.capture_key.clone(),
                observations: vec![(entry.scope.session.clone(), at)],
                content_hash: hash.clone(),
                versions: vec![Version {
                    number: 1,
                    valid_from: entry.valid_from,
                    valid_until: entry.valid_until,
                    recorded_at: at,
                    recorded_until: None,
                    invalidation: None,
                    superseded_by: None,
                    envelope: entry.envelope.clone(),
                }],
                seal,
                bytes,
            };
            state.keys.insert(rec.id.clone(), Some(seal));
            state.push_change(
                &rec,
                MemoryChangeKind::Created,
                at,
                entry.envelope.trace_id.clone(),
                bytes,
            );
            entries.push(EntryReceipt {
                id: rec.id.clone(),
                record_version: 1,
                state: EntryState::Created,
                expires_at: rec.expires_at,
            });
            state.records.insert(rec.id.clone(), rec);
            for target in &entry.supersedes {
                let open = state
                    .records
                    .get(target)
                    .is_some_and(|r| matches!(state.key(r), Key::Open));
                let Some(old) = state.records.get_mut(target).filter(|_| open) else {
                    return Err(StoreError::NotFound);
                };
                let recorded = at.max(old.current().recorded_at);
                let until = entry.valid_from.max(old.current().valid_from + 1);
                old.close(recorded, entry.envelope.trace_id.clone(), |v| {
                    v.valid_until = Some(until);
                    v.superseded_by = Some(entry.id.clone());
                    v.invalidation = Some(Invalidation {
                        at: recorded,
                        by: owner.to_owned(),
                        reason: InvalidationReason::Other,
                        note: None,
                    });
                });
                let old = old.clone();
                state.push_change(
                    &old,
                    MemoryChangeKind::Invalidated,
                    recorded,
                    entry.envelope.trace_id.clone(),
                    0,
                );
                superseded.push(target.clone());
            }
        }
        let last_rev = state.head();
        let receipt = MemoryReceipt {
            entries,
            superseded,
            from_rev: (last_rev >= first_rev).then_some(first_rev),
            to_rev: (last_rev >= first_rev).then_some(last_rev),
            replayed: false,
            refused: None,
        };
        if let Some(key) = idem {
            state.idempotency.insert(key, (at, receipt.clone()));
        }
        Ok(receipt)
    }

    /// The quota of section 8.11 over a state the batch has been applied to.
    fn over_quota(
        state: &State,
        before: &State,
        batch: &MemoryBatch,
        owner: &str,
    ) -> Option<StoreError> {
        let agent = batch.entries[0].scope.agent_id();
        let q = batch.quota;
        let (records, bytes) = state.stored(owner);
        if records > q.stored_records {
            return Some(StoreError::QuotaExceeded {
                limit: QuotaLimit::StoredRecords,
                retry_after_ms: None,
            });
        }
        if bytes > q.stored_bytes {
            return Some(StoreError::QuotaExceeded {
                limit: QuotaLimit::StoredBytes,
                retry_after_ms: None,
            });
        }
        let since = batch.at - HOUR_MS + 1;
        let (writes, written, _) = state.written(owner, agent, since);
        let (_, _, oldest) = before.written(owner, agent, since);
        let retry = Some(oldest.map_or(1, |o| (o + HOUR_MS - batch.at).max(1)) as u64);
        if writes > q.writes_per_hour {
            return Some(StoreError::QuotaExceeded {
                limit: QuotaLimit::WritesPerHour,
                retry_after_ms: retry,
            });
        }
        if written > q.bytes_per_hour {
            return Some(StoreError::QuotaExceeded {
                limit: QuotaLimit::BytesPerHour,
                retry_after_ms: retry,
            });
        }
        None
    }
}

impl MemoryStore for FakeMemory {
    fn write(&self, batch: MemoryBatch) -> Result<MemoryReceipt, StoreError> {
        let (owner, authority, hashes) = batch.check("main")?;
        {
            let mut state = self.lock();
            state.provisioned = true;
            state.purge(batch.at, batch.retention, PURGE_BEFORE_WRITE);
        }
        if self.fault == MemoryFault::QuotaOutsideTransaction {
            let _inside = Inside::enter(self);
            {
                let state = self.lock();
                let mut staged = state.clone();
                self.apply(&mut staged, &batch, &owner, authority, &hashes)?;
                if let Some(e) = Self::over_quota(&staged, &state, &batch, &owner) {
                    return Err(e);
                }
            }
            self.meet();
            let mut state = self.lock();
            let mut staged = state.clone();
            let receipt = self.apply(&mut staged, &batch, &owner, authority, &hashes)?;
            *state = staged;
            return Ok(receipt);
        }
        let mut state = self.lock();
        let mut staged = state.clone();
        let receipt = self.apply(&mut staged, &batch, &owner, authority, &hashes)?;
        if !receipt.replayed
            && receipt.refused.is_none()
            && let Some(e) = Self::over_quota(&staged, &state, &batch, &owner)
        {
            return Err(e);
        }
        *state = staged;
        Ok(receipt)
    }

    fn invalidate(
        &self,
        req: Invalidate,
        reader: &ReaderFilter,
    ) -> Result<MemoryVersionMeta, StoreError> {
        refuse_derivation(reader)?;
        req.check()?;
        let mut state = self.read()?;
        let fault = self.fault;
        let rec = Self::changeable(&mut state, &req.id, reader)?;
        let current = rec.current().clone();
        if req.expect_version.is_some_and(|v| v != current.number) {
            return Err(StoreError::Conflict {
                current: Some(current.number.to_string()),
            });
        }
        if req.valid_until <= current.valid_from || req.valid_until > req.at {
            return Err(StoreError::invalid(
                "T must follow validFrom and not pass now",
            ));
        }
        let recorded = req.at.max(current.recorded_at);
        let invalidation = Invalidation {
            at: recorded,
            by: req.by.clone(),
            reason: req.reason,
            note: req.note.clone(),
        };
        if fault == MemoryFault::OverwritingInvalidate {
            let last = rec.versions.len() - 1;
            rec.versions[last].valid_until = Some(req.valid_until);
            rec.versions[last].invalidation = Some(invalidation);
        } else {
            rec.close(recorded, req.trace_id.clone(), |v| {
                v.valid_until = Some(req.valid_until);
                v.invalidation = Some(invalidation);
            });
        }
        let rec = rec.clone();
        let rev = state.push_change(
            &rec,
            MemoryChangeKind::Invalidated,
            recorded,
            req.trace_id,
            0,
        );
        Ok(MemoryVersionMeta {
            id: rec.id.clone(),
            record_version: rec.current().number,
            valid_until: rec.current().valid_until,
            recorded_at: rec.current().recorded_at,
            rev,
        })
    }

    fn confirm(
        &self,
        req: Confirm,
        reader: &ReaderFilter,
    ) -> Result<MemoryVersionMeta, StoreError> {
        refuse_derivation(reader)?;
        let mut state = self.read()?;
        let rec = Self::changeable(&mut state, &req.id, reader)?;
        let current = rec.current().clone();
        let prior = current.authority();
        if rec.scope.principal != req.by {
            return Err(StoreError::invalid(
                "a person confirms only their own records",
            ));
        }
        if !rec.flags.is_empty() || matches!(prior, Authority::Transcript | Authority::Person) {
            return Err(StoreError::invalid(
                "flagged, transcript and person records are not confirmed",
            ));
        }
        if !content_hash_prefix_matches(&rec.content_hash, &req.content_hash) {
            return Err(StoreError::Conflict { current: None });
        }
        let recorded = req.at.max(current.recorded_at);
        rec.close(recorded, req.trace_id.clone(), |v| {
            v.envelope.authority = Some(Authority::Person.as_str().to_owned());
            v.envelope.confirmation = Some(Confirmation {
                by: req.by.clone(),
                at: format_instant(recorded),
                prior_authority: prior,
            });
        });
        let rec = rec.clone();
        let rev = state.push_change(&rec, MemoryChangeKind::Confirmed, recorded, req.trace_id, 0);
        Ok(MemoryVersionMeta {
            id: rec.id.clone(),
            record_version: rec.current().number,
            valid_until: rec.current().valid_until,
            recorded_at: recorded,
            rev,
        })
    }

    fn get(
        &self,
        id: &str,
        as_of: AsOf,
        flags: ReadFlags,
        reader: &ReaderFilter,
    ) -> Result<Option<MemoryRecord>, StoreError> {
        refuse_derivation(reader)?;
        let state = self.read()?;
        let Some(rec) = state.records.get(id).filter(|r| reader.admits(&r.access)) else {
            return Ok(None);
        };
        match state.key(rec) {
            Key::Open => {}
            Key::Destroyed => return Ok(None),
            Key::Absent => return Err(StoreError::KeyAbsent { id: id.to_owned() }),
            Key::Wrong => return Err(StoreError::SealInvalid { id: id.to_owned() }),
        }
        Ok(rec
            .at(as_of)
            .filter(|_| self.passes(rec, as_of, flags))
            .map(|v| rec.record(v)))
    }

    fn history(&self, id: &str, reader: &ReaderFilter) -> Result<Vec<MemoryRecord>, StoreError> {
        refuse_derivation(reader)?;
        let state = self.read()?;
        let Some(rec) = state.records.get(id).filter(|r| reader.admits(&r.access)) else {
            return Ok(Vec::new());
        };
        match state.key(rec) {
            Key::Open => Ok(rec.versions.iter().map(|v| rec.record(v)).collect()),
            Key::Destroyed => Ok(Vec::new()),
            Key::Absent => Err(StoreError::KeyAbsent { id: id.to_owned() }),
            Key::Wrong => Err(StoreError::SealInvalid { id: id.to_owned() }),
        }
    }

    fn list(&self, query: &MemoryList, reader: &ReaderFilter) -> Result<MemoryPage, StoreError> {
        refuse_derivation(reader)?;
        check_limit("list", query.limit, MAX_MEMORY_LIST_LIMIT)?;
        let state = self.read()?;
        let (found, unreadable) = self.candidates(
            &state,
            reader,
            &query.scope,
            &query.classes,
            &query.tags,
            &query.authorities,
            query.push.as_ref(),
            query.as_of,
            query.flags,
        );
        let mut items: Vec<MemoryMeta> = found
            .into_iter()
            .filter(|(r, v)| {
                query
                    .after
                    .as_ref()
                    .is_none_or(|a| a.precedes(v.recorded_at, &r.id))
            })
            .map(|(r, v)| r.meta(v))
            .collect();
        items.sort_by(|a, b| {
            b.recorded_at
                .cmp(&a.recorded_at)
                .then_with(|| a.id.cmp(&b.id))
        });
        let next = if items.len() > query.limit as usize {
            items.truncate(query.limit as usize);
            items.last().map(|m| MemoryCursor {
                recorded_at: m.recorded_at,
                id: m.id.clone(),
            })
        } else {
            None
        };
        Ok(MemoryPage {
            items,
            next,
            unreadable,
        })
    }

    fn recall(&self, query: &RecallQuery, reader: &ReaderFilter) -> Result<RecallPage, StoreError> {
        refuse_derivation(reader)?;
        check_limit("recall", query.limit, MAX_RECALL_LIMIT)?;
        let state = self.read()?;
        let table: Vec<&Rec> = state
            .records
            .values()
            .filter(|r| !matches!(state.key(r), Key::Destroyed))
            .collect();
        let corpus = Corpus::new(&table);
        let terms = self.terms(&query.query);
        let (found, unreadable) = self.candidates(
            &state,
            reader,
            &query.scope,
            &query.classes,
            &query.tags,
            &query.authorities,
            query.push.as_ref(),
            query.as_of,
            query.flags,
        );
        let mut scored: Vec<(f64, &Rec, &Version)> = found
            .into_iter()
            .filter_map(|(r, v)| corpus.score(r, &terms).map(|s| (s, r, v)))
            .collect();
        scored.sort_by(|a, b| {
            b.0.total_cmp(&a.0)
                .then_with(|| b.2.recorded_at.cmp(&a.2.recorded_at))
                .then_with(|| a.1.id.cmp(&b.1.id))
        });
        let hits = scored
            .into_iter()
            .take(query.limit as usize)
            .zip(1..)
            .map(|((_, r, v), rank)| RecallHit {
                rank,
                record: r.record(v),
                snippet: snippet(&r.text, &terms),
            })
            .collect();
        Ok(RecallPage { hits, unreadable })
    }

    fn left_out(
        &self,
        scope: &ScopeQuery,
        classes: &[MemoryClass],
        push: &PushFilter,
        as_of: AsOf,
        now: Millis,
        reader: &ReaderFilter,
    ) -> Result<LeftOut, StoreError> {
        refuse_derivation(reader)?;
        let state = self.read()?;
        let classes = if classes.is_empty() {
            &MemoryClass::ALL[..]
        } else {
            classes
        };
        let mut out = LeftOut::default();
        for class in classes {
            out.by_class.insert(*class, Default::default());
        }
        for rec in state.records.values() {
            if !reader.admits(&rec.access)
                || matches!(state.key(rec), Key::Destroyed)
                || !scope.admits(&rec.scope)
                || !classes.contains(&rec.class)
                || rec.expires_at <= now
            {
                continue;
            }
            let Some(v) = rec.at(as_of) else { continue };
            let flagged = !rec.flags.is_empty();
            let counts = out.by_class.entry(rec.class).or_default();
            if flagged {
                counts.flagged += 1;
            } else if !push.admits(
                &rec.scope.principal,
                v.authority(),
                rec.scope.project.as_deref(),
                &scope.project,
                false,
            ) {
                counts.authority += 1;
            }
        }
        Ok(out)
    }

    fn forget(&self, req: Forget) -> Result<ForgetReceipt, StoreError> {
        req.check()?;
        let mut state = self.read()?;
        let owned = |r: &Rec| r.scope.principal == req.owner;
        let (targets, not_found): (Vec<String>, Vec<String>) = match &req.selector {
            ForgetSelector::Ids(ids) => {
                let mut found = Vec::new();
                let mut missing = Vec::new();
                for id in ids {
                    let live = state
                        .records
                        .get(id)
                        .is_some_and(|r| owned(r) && !matches!(state.key(r), Key::Destroyed));
                    if live {
                        found.push(id.clone());
                    } else {
                        missing.push(id.clone());
                    }
                }
                (found, missing)
            }
            selector => {
                let ids = state
                    .records
                    .values()
                    .filter(|r| owned(r) && !matches!(state.key(r), Key::Destroyed))
                    .filter(|r| match selector {
                        ForgetSelector::Session(s) => r.scope.session.as_ref() == Some(s),
                        ForgetSelector::Project(p) => r.scope.project.as_ref() == Some(p),
                        ForgetSelector::Before(t) => r.versions[0].recorded_at < *t,
                        ForgetSelector::Ids(_) => false,
                    })
                    .map(|r| r.id.clone())
                    .collect();
                (ids, Vec::new())
            }
        };
        for id in &targets {
            let Some(rec) = state.records.get(id).cloned() else {
                continue;
            };
            if let Some(key) = &rec.capture_key {
                let prefixes = state.erased.entry(req.owner.clone()).or_default();
                prefixes.insert(key.clone());
                if matches!(req.selector, ForgetSelector::Session(_))
                    && let Some(prefix) = capture_session_prefix(key)
                {
                    prefixes.insert(prefix);
                }
            }
            state.tombstones.insert(id.clone());
            match self.fault {
                MemoryFault::ForgetKeepsText => {
                    if let Some(kept) = state.records.get_mut(id) {
                        let from = kept.current().valid_from;
                        kept.close(req.at, req.trace_id.clone(), |v| {
                            v.valid_until = Some(req.at.max(from + 1));
                        });
                    }
                }
                MemoryFault::ForgetKeepsKey => {
                    state.records.remove(id);
                }
                _ => {
                    state.keys.insert(id.clone(), None);
                    state.records.remove(id);
                }
            }
            state.push_change(
                &rec,
                MemoryChangeKind::Erased,
                req.at,
                req.trace_id.clone(),
                0,
            );
        }
        Ok(ForgetReceipt {
            erased: targets.len() as u64,
            ids: targets.into_iter().take(100).collect(),
            not_found,
            wal: WalState::Clean,
        })
    }

    fn sweep(&self, req: Sweep) -> Result<SweepReceipt, StoreError> {
        check_limit("sweep", req.limit, MAX_SWEEP_LIMIT)?;
        let mut state = self.read()?;
        let purged = state.purge(req.now, req.retention, req.limit);
        let line = req.now - IDEMPOTENCY_KEEP_MS;
        state.idempotency.retain(|_, (at, _)| *at >= line);
        let remaining = state
            .records
            .values()
            .filter(|r| past_purge(r, req.retention, req.now))
            .count() as u64;
        Ok(SweepReceipt { purged, remaining })
    }

    fn reindex(&self, remove_orphans: bool) -> Result<ReindexReceipt, StoreError> {
        let mut state = self.read()?;
        let orphans: Vec<String> = state
            .keys
            .iter()
            .filter(|(id, key)| key.is_some() && !state.records.contains_key(*id))
            .map(|(id, _)| id.clone())
            .collect();
        let open = state
            .records
            .values()
            .filter(|r| matches!(state.key(r), Key::Open))
            .count() as u64;
        let total = state.records.len() as u64;
        if remove_orphans {
            for id in &orphans {
                state.keys.remove(id);
            }
        }
        Ok(ReindexReceipt {
            reindexed: open,
            unreadable: total - open,
            orphans: orphans.len() as u64,
            orphans_removed: if remove_orphans {
                orphans.len() as u64
            } else {
                0
            },
        })
    }

    fn backup(&self, dest: &Path) -> Result<BackupReceipt, StoreError> {
        let state = self.read()?;
        let mut copy = state.clone();
        copy.keys.clear();
        std::fs::create_dir_all(dest).map_err(|e| StoreError::Io(e.to_string()))?;
        let file = dest.join("memory.sqlite3");
        std::fs::write(&file, b"fake memory backup").map_err(|e| StoreError::Io(e.to_string()))?;
        locked(&BACKUPS).insert(dest.to_owned(), copy);
        Ok(BackupReceipt { file, bytes: 18 })
    }

    fn key_status(&self) -> Result<KeyStatus, StoreError> {
        let state = self.read()?;
        Ok(KeyStatus {
            file: KeyFileState::Present,
            unsettled: 0,
            destroyed: state.keys.values().filter(|k| k.is_none()).count() as u64,
            orphans: state
                .keys
                .iter()
                .filter(|(id, k)| k.is_some() && !state.records.contains_key(*id))
                .count() as u64,
            absent: state
                .records
                .keys()
                .filter(|id| !state.keys.contains_key(*id))
                .count() as u64,
        })
    }

    fn changes(
        &self,
        after: Rev,
        limit: u32,
        reader: &ReaderFilter,
        trace: Option<&str>,
    ) -> Result<Vec<MemoryChange>, StoreError> {
        refuse_derivation(reader)?;
        check_limit("changes", limit, MAX_MEMORY_CHANGES_LIMIT)?;
        let state = self.read()?;
        Ok(state
            .changes
            .iter()
            .filter(|c| c.change.rev > after && reader.admits(&c.access))
            .filter(|c| trace.is_none_or(|t| c.change.trace_id.as_deref() == Some(t)))
            .take(limit as usize)
            .map(|c| c.change.clone())
            .collect())
    }

    fn head(&self) -> Result<Rev, StoreError> {
        Ok(self.read()?.head())
    }

    fn usage(
        &self,
        owner: &str,
        agent: Option<&str>,
        since: Millis,
    ) -> Result<MemoryUsage, StoreError> {
        let state = self.read()?;
        let (stored_records, stored_bytes) = state.stored(owner);
        let (writes, bytes, _) = state.written(owner, agent, since);
        Ok(MemoryUsage {
            stored_records,
            stored_bytes,
            writes,
            bytes,
        })
    }

    fn counts(
        &self,
        now: Millis,
        expiring_within_ms: Millis,
        reader: &ReaderFilter,
    ) -> Result<MemoryCounts, StoreError> {
        refuse_derivation(reader)?;
        let state = self.read()?;
        let mut out = MemoryCounts::default();
        for rec in state.records.values().filter(|r| reader.admits(&r.access)) {
            match state.key(rec) {
                Key::Open => {}
                Key::Destroyed => continue,
                Key::Absent | Key::Wrong => {
                    out.unreadable += 1;
                    continue;
                }
            }
            let v = rec.current();
            let c: &mut ClassCounts = out.by_class.entry(rec.class).or_default();
            if rec.expires_at <= now {
                c.expired += 1;
                continue;
            }
            if v.valid_until.is_some_and(|u| u <= now) {
                c.invalidated += 1;
                continue;
            }
            if v.valid_from > now {
                c.not_yet_valid += 1;
                continue;
            }
            if rec.flags.is_empty() {
                c.live += 1;
            } else {
                c.flagged += 1;
            }
            if rec.expires_at <= now + expiring_within_ms {
                c.expiring_soon += 1;
            }
        }
        Ok(out)
    }
}

// ---------------------------------------------------------------------------------------------
// The fake's lexical lane: lower-case alphanumeric tokens, a plural `s` stripped, and BM25 with
// field weights 3, 2 and 1, as the embedded backend's FTS5 table ranks.

fn stem(word: &str) -> String {
    if word.len() > 3 && word.ends_with('s') && !word.ends_with("ss") {
        word[..word.len() - 1].to_owned()
    } else {
        word.to_owned()
    }
}

fn tokens(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(|w| stem(&w.to_lowercase()))
        .collect()
}

/// A term's tokens; a prefix term's last token is matched as a prefix, unstemmed.
struct Term {
    occur: Occur,
    field: Option<TermField>,
    tokens: Vec<String>,
    prefix: bool,
}

impl FakeMemory {
    fn terms(&self, query: &MemoryQuery) -> Vec<Term> {
        query
            .terms()
            .iter()
            .map(|t: &QueryTerm| {
                let mut toks = tokens(&t.text);
                if t.prefix
                    && let Some(last) = toks.last_mut()
                {
                    *last = t
                        .text
                        .split(|c: char| !c.is_alphanumeric())
                        .rfind(|w| !w.is_empty())
                        .unwrap_or_default()
                        .to_lowercase();
                }
                let occur =
                    if self.fault == MemoryFault::RequiredIsOptional && t.occur == Occur::Must {
                        Occur::Should
                    } else {
                        t.occur
                    };
                Term {
                    occur,
                    field: t.field,
                    tokens: toks,
                    prefix: t.prefix,
                }
            })
            .collect()
    }
}

fn occurrences(field: &[String], term: &Term) -> u64 {
    let n = term.tokens.len();
    if n == 0 || field.len() < n {
        return 0;
    }
    (0..=field.len() - n)
        .filter(|&i| {
            (0..n).all(|k| {
                let last = k == n - 1;
                if last && term.prefix {
                    field[i + k].starts_with(&term.tokens[k])
                } else {
                    field[i + k] == term.tokens[k]
                }
            })
        })
        .count() as u64
}

struct Fields {
    subject: Vec<String>,
    tags: Vec<String>,
    text: Vec<String>,
}

impl Fields {
    fn of(rec: &Rec) -> Self {
        Self {
            subject: tokens(&rec.subject),
            tags: tokens(&rec.tags.join(" ")),
            text: tokens(&rec.text),
        }
    }

    fn len(&self) -> f64 {
        (self.subject.len() + self.tags.len() + self.text.len()) as f64
    }

    /// The term's weighted frequency.
    fn weighted(&self, term: &Term) -> f64 {
        let allowed = |f: TermField| term.field.is_none_or(|g| g == f);
        let mut sum = 0.0;
        for (field, tokens, weight) in [
            (TermField::Subject, &self.subject, 3.0),
            (TermField::Tags, &self.tags, 2.0),
            (TermField::Body, &self.text, 1.0),
        ] {
            if allowed(field) {
                sum += weight * occurrences(tokens, term) as f64;
            }
        }
        sum
    }
}

struct Corpus {
    rows: BTreeMap<String, Fields>,
    avgdl: f64,
}

impl Corpus {
    fn new(table: &[&Rec]) -> Self {
        let rows: BTreeMap<String, Fields> = table
            .iter()
            .map(|r| (r.id.clone(), Fields::of(r)))
            .collect();
        let total: f64 = rows.values().map(Fields::len).sum();
        let avgdl = if rows.is_empty() {
            1.0
        } else {
            total / rows.len() as f64
        };
        Self { rows, avgdl }
    }

    /// BM25 rounded to four places, or `None` when the record does not match.
    fn score(&self, rec: &Rec, terms: &[Term]) -> Option<f64> {
        let fields = self.rows.get(&rec.id)?;
        let hit = |t: &Term| fields.weighted(t) > 0.0;
        let musts: Vec<&Term> = terms.iter().filter(|t| t.occur == Occur::Must).collect();
        if terms.iter().any(|t| t.occur == Occur::MustNot && hit(t))
            || !musts.iter().all(|t| hit(t))
        {
            return None;
        }
        let positive: Vec<&Term> = terms.iter().filter(|t| t.occur != Occur::MustNot).collect();
        if musts.is_empty() && !positive.iter().any(|t| hit(t)) {
            return None;
        }
        let n = self.rows.len() as f64;
        let (k1, b) = (1.2, 0.75);
        let mut score = 0.0;
        for term in positive {
            let f = fields.weighted(term);
            if f == 0.0 {
                continue;
            }
            let containing = self
                .rows
                .values()
                .filter(|row| row.weighted(term) > 0.0)
                .count() as f64;
            let idf = ((n - containing + 0.5) / (containing + 0.5)).ln().max(1e-6);
            score += idf * (f * (k1 + 1.0)) / (f + k1 * (1.0 - b + b * fields.len() / self.avgdl));
        }
        Some((score * 10_000.0).round() / 10_000.0)
    }
}

/// The text with each matching word marked `**`.
fn snippet(text: &str, terms: &[Term]) -> String {
    text.split_whitespace()
        .map(|word| {
            let toks = tokens(word);
            let marked = terms.iter().filter(|t| t.occur != Occur::MustNot).any(|t| {
                (t.tokens.len() == 1
                    && toks.iter().any(|w| {
                        if t.prefix {
                            w.starts_with(&t.tokens[0])
                        } else {
                            *w == t.tokens[0]
                        }
                    }))
                    || (t.tokens.len() > 1 && t.tokens.iter().any(|q| toks.contains(q)))
            });
            if marked {
                format!("**{word}**")
            } else {
                word.to_owned()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

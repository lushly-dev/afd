//! Forget, purge, roll-forward, sweep, reindex, the rebuild of a restored copy and checkpoints
//! (phase 3 sections 5.4, 7.2 and 8.8).
//!
//! **Forget, in order.** (1) Resolve the ids and commit the erased prefixes. (2) Under a second
//! `BEGIN IMMEDIATE` on the memory database, held, destroy the keys in the key file and commit
//! it: the erasure point. (3) Remove the rows, write tombstones and changes, commit. (4) Outside
//! any transaction, rebuild the index in a transaction of its own and run
//! `wal_checkpoint(TRUNCATE)`. (5) Only after both succeeded, settle the markers. After the
//! erasure point a forget does not fail: a failure in steps 3 to 5 answers `wal: Pending`, and the
//! next writer's roll-forward finishes the rest. A purge is steps 2 to 5 with kind `purge`, no
//! erased prefix and no tombstone.

use std::collections::{BTreeSet, HashSet};

use rusqlite::{Connection, TransactionBehavior, params, params_from_iter};
use umbel_store::memory::{
    Forget, ForgetReceipt, IDEMPOTENCY_KEEP_MS, MAX_FORGET_IDS, MAX_SWEEP_LIMIT, MemoryChangeKind,
    ReindexReceipt, Retention, Sweep, SweepReceipt, WalState, capture_session_prefix, check_limit,
};
use umbel_store::{ForgetSelector, MemoryClass, Millis, StoreError};

use super::SqliteMemoryStore;
use super::keys::{self, KeyEntry, Keys, MarkerKind};
use super::points;
use super::rows::{ChangeRow, RecordRow, erase_rows, insert_change, record_row};
use super::schema::{CREATE_FTS, DERIVED_SCHEMA, FTS_SECURE_DELETE};
use crate::error::{Fail, map_sql, to_u64};
use crate::sql::Sql;

/// `records` with a current version `v` past its purge date at `now` (section 8.8): `expires`
/// older than `now − purge_after` for its class, or a current version carrying an invalidation
/// recorded before that.
pub(super) fn due(now: Millis, retention: Retention) -> Sql {
    let line = |class: MemoryClass| now.saturating_sub(retention.purge_after_ms(class));
    let case = |sql: &mut Sql| {
        sql.push("(CASE r.class WHEN 'episodic' THEN ")
            .bind(line(MemoryClass::Episodic))
            .push(" WHEN 'semantic' THEN ")
            .bind(line(MemoryClass::Semantic))
            .push(" ELSE ")
            .bind(line(MemoryClass::Procedural))
            .push(" END)");
    };
    let mut sql = Sql::new(
        "SELECT r.id FROM records r JOIN versions v ON v.id = r.id AND v.recorded_until IS NULL \
         WHERE ",
    );
    sql.push("(r.expires < ");
    case(&mut sql);
    sql.push(" OR (v.inv_reason IS NOT NULL AND v.recorded_at < ");
    case(&mut sql);
    sql.push("))");
    sql
}

/// Remove a record's rows and record the change, with the access it had.
fn erase(
    tx: &Connection,
    rec: &RecordRow,
    kind: MemoryChangeKind,
    at: Millis,
    trace: Option<&str>,
    index: bool,
) -> Result<(), Fail> {
    let version: u32 = tx.query_row(
        "SELECT COALESCE(MAX(record_version), 1) FROM versions WHERE id = ?1",
        [&rec.id],
        |r| r.get(0),
    )?;
    erase_rows(tx, rec, index)?;
    insert_change(
        tx,
        &ChangeRow {
            kind,
            id: &rec.id,
            record_version: version,
            trace_id: trace,
            at,
            owner: &rec.owner,
            agent: rec.agent.as_ref().and_then(|a| a.id.as_deref()),
            bytes: 0,
            access: &rec.access,
        },
    )?;
    Ok(())
}

/// Remove a row whose key entry is a destroyed marker. Kind `forget` writes a tombstone
/// (`forget-recovered`) and an `Erased` change, and with `prefix` also the row's erased capture
/// prefix, which a restored copy lost (the rebuild and reindex of section 5.4); kind `purge`
/// writes a `Purged` change only.
fn drop_marked(
    tx: &Connection,
    rec: &RecordRow,
    kind: MarkerKind,
    at: Millis,
    prefix: bool,
    index: bool,
) -> Result<(), Fail> {
    match kind {
        MarkerKind::Forget => {
            if prefix {
                let key: Option<String> = tx.query_row(
                    "SELECT capture_key FROM records WHERE rowid = ?1",
                    [rec.rowid],
                    |r| r.get(0),
                )?;
                if let Some(key) = key {
                    tx.execute(
                        "INSERT OR IGNORE INTO capture_erasures \
                         (owner, key_prefix, erased_at, trace_id) VALUES (?1, ?2, ?3, NULL)",
                        params![rec.owner, key, at],
                    )?;
                }
            }
            tx.execute(
                "INSERT OR IGNORE INTO tombstones (id, erased_at, trace_id, kind) \
                 VALUES (?1, ?2, NULL, 'forget-recovered')",
                params![rec.id, at],
            )?;
            erase(tx, rec, MemoryChangeKind::Erased, at, None, index)
        }
        MarkerKind::Purge => erase(tx, rec, MemoryChangeKind::Purged, at, None, index),
    }
}

/// Every `records` row.
pub(super) fn all_records(tx: &Connection) -> Result<Vec<RecordRow>, Fail> {
    let sql = format!("SELECT {} FROM records r", super::rows::RECORD_COLS);
    let mut stmt = tx.prepare(&sql)?;
    let mut found = stmt.query([])?;
    let mut out = Vec::new();
    while let Some(row) = found.next()? {
        out.push(RecordRow::from_row(row, 0)?);
    }
    Ok(out)
}

/// Index `rows` into a fresh `records_fts` and `record_derived`: each that opens under its key gets
/// `indexed = 1`; one with an absent key or a blob that does not open gets `indexed = 0` and is
/// counted, never deleted. Returns `(reindexed, unreadable)`.
fn index_rows(
    tx: &Connection,
    space: &str,
    keys: &Keys,
    rows: &[RecordRow],
) -> Result<(u64, u64), Fail> {
    let (mut reindexed, mut unreadable) = (0, 0);
    for rec in rows {
        let opened = match keys.entry(&rec.id) {
            Some(KeyEntry::Live(key)) => rec.body(space, key).map(Some),
            _ => Ok(None),
        };
        match opened {
            Ok(Some(body)) => {
                tx.execute(
                    "INSERT INTO records_fts (rowid, subject, tags, text) VALUES (?1, ?2, ?3, ?4)",
                    params![rec.rowid, body.subject, body.tags.join(" "), body.text],
                )?;
                tx.execute(
                    "INSERT INTO record_derived (id, content_hash, tags) VALUES (?1, ?2, ?3)",
                    params![
                        rec.id,
                        body.content_hash.as_str(),
                        serde_json::json!(body.tags).to_string()
                    ],
                )?;
                tx.execute(
                    "UPDATE records SET indexed = 1 WHERE rowid = ?1",
                    [rec.rowid],
                )?;
                reindexed += 1;
            }
            Ok(None)
            | Err(Fail::Store(StoreError::SealInvalid { .. } | StoreError::KeyAbsent { .. })) => {
                tx.execute(
                    "UPDATE records SET indexed = 0 WHERE rowid = ?1",
                    [rec.rowid],
                )?;
                unreadable += 1;
            }
            Err(other) => return Err(other),
        }
    }
    Ok((reindexed, unreadable))
}

/// The rebuild on open of a restored copy (section 5.4), in one transaction: rows with a
/// destroyed marker go, with a tombstone, an `Erased` change and the erased prefix for a forget
/// and a `Purged` change for a purge, so a forget survives a restore; then `records_fts` (with
/// `secure-delete` set again) and `record_derived` are created and every remaining row that opens
/// is indexed. Writes nothing to the key file and removes no orphan key. Another process that
/// rebuilt first leaves nothing to do.
pub(super) fn rebuild(conn: &mut Connection, space: &str, kc: &mut Connection) -> Result<(), Fail> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    if super::pool::has_index(&tx)? {
        return Ok(());
    }
    let keys = keys::all(kc)?;
    let mut kept = Vec::new();
    for rec in all_records(&tx)? {
        match keys.destroyed(&rec.id) {
            Some((kind, at)) => drop_marked(&tx, &rec, kind, at, true, false)?,
            None => kept.push(rec),
        }
    }
    tx.execute_batch(DERIVED_SCHEMA)?;
    tx.execute("DELETE FROM record_derived", [])?;
    tx.execute(CREATE_FTS, [])?;
    tx.execute(FTS_SECURE_DELETE, [])?;
    index_rows(&tx, space, &keys, &kept)?;
    points::crash("rebuild");
    tx.commit()?;
    Ok(())
}

/// `wal_checkpoint(TRUNCATE)` outside any transaction (section 5.4, step 4). Without `wait` it
/// takes no lock wait at all. Answers whether the WAL is now empty; a reader holding it, or a
/// lock that was not free, answers `false`.
pub(super) fn truncate(
    conn: &Connection,
    wait: bool,
    timeout: std::time::Duration,
) -> Result<bool, Fail> {
    if !wait {
        conn.busy_timeout(std::time::Duration::ZERO)?;
    }
    let result = conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |r| {
        r.get::<_, i64>(0)
    });
    if !wait {
        conn.busy_timeout(timeout)?;
    }
    match result {
        Ok(busy) => Ok(busy == 0),
        Err(error) if matches!(map_sql(&error), StoreError::Busy) => Ok(false),
        Err(error) => Err(error.into()),
    }
}

/// Rebuild the index from its own content table in a transaction of its own, after an erasure
/// has committed (phase 3 "Amendments from step 3a", item 7): a leaf page's separator in
/// `records_fts_idx` can be a whole deleted token, which `secure-delete` keeps and `optimize`
/// does not clear on a one-segment index. With `secure_delete=ON` the freed pages are overwritten.
/// It reads the index's plaintext copy and needs no key. Without `wait` it takes no lock wait.
/// Answers whether it ran.
fn compact(conn: &mut Connection, wait: bool, timeout: std::time::Duration) -> Result<bool, Fail> {
    if !wait {
        conn.busy_timeout(std::time::Duration::ZERO)?;
    }
    let run = |conn: &mut Connection| -> Result<(), rusqlite::Error> {
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute(
            "INSERT INTO records_fts (records_fts) VALUES ('rebuild')",
            [],
        )?;
        tx.commit()
    };
    let result = run(conn);
    if !wait {
        conn.busy_timeout(timeout)?;
    }
    match result {
        Ok(()) => Ok(true),
        Err(error) if matches!(map_sql(&error), StoreError::Busy) => Ok(false),
        Err(error) => Err(error.into()),
    }
}

/// Step 4 after an erasure has committed: compact the index, then truncate the WAL, each outside
/// the erasure's transaction. Never fails, since the rows are already gone: a busy or failed step
/// answers `false`, and the markers stay unsettled for the next writer.
fn settle_wal(conn: &mut Connection, wait: bool, timeout: std::time::Duration) -> bool {
    matches!(compact(conn, wait, timeout), Ok(true))
        && matches!(truncate(conn, wait, timeout), Ok(true))
}

/// Unsettled markers whose rows are gone.
fn unsettled_gone(conn: &Connection, kc: &Connection) -> Result<Vec<String>, Fail> {
    let mut out = Vec::new();
    for (id, _, _) in keys::unsettled(kc)? {
        let exists: bool = conn.query_row(
            "SELECT EXISTS (SELECT 1 FROM records WHERE id = ?1)",
            [&id],
            |r| r.get(0),
        )?;
        if !exists {
            out.push(id);
        }
    }
    Ok(out)
}

impl SqliteMemoryStore {
    /// Roll forward every unsettled marker (section 5.4), at the start of each writer: remove the
    /// rows that remain (a tombstone `forget-recovered` and an `Erased` change for a forget, a
    /// `Purged` change for a purge, nothing when the row is gone), commit, then with no wait
    /// compact the index and truncate the WAL, and settle the markers only when both succeeded.
    /// A `Busy` anywhere is left for the next writer.
    pub(super) fn roll_forward(&self) -> Result<(), StoreError> {
        let timeout = self.pool.timeout();
        let result = self.pool.write(|conn| {
            self.pool.keys(|kc| {
                let markers = keys::unsettled(kc)?;
                if markers.is_empty() {
                    return Ok(());
                }
                let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
                for (id, kind, at) in &markers {
                    if let Some(rec) = record_row(&tx, id)? {
                        drop_marked(&tx, &rec, *kind, *at, false, true)?;
                    }
                }
                tx.commit()?;
                if settle_wal(conn, false, timeout) {
                    let ids: Vec<&str> = markers.iter().map(|(id, _, _)| id.as_str()).collect();
                    keys::settle(kc, &ids)?;
                }
                Ok(())
            })
        });
        match result {
            Ok(()) | Err(StoreError::Busy) => Ok(()),
            Err(other) => Err(other),
        }
    }

    /// A purge: in one memory transaction, select at most `limit` records past their purge date,
    /// destroy their keys (kind `purge`, the erasure point), remove their rows with a `Purged`
    /// change each, and, for a sweep, drop old idempotency receipts and count what remains;
    /// commit; then compact and truncate, waiting or not, and settle. Returns
    /// `(purged, remaining)`; `remaining` is 0 unless `sweep`.
    fn purge(
        &self,
        now: Millis,
        retention: Retention,
        limit: u32,
        sweep: bool,
    ) -> Result<(u64, u64), StoreError> {
        let timeout = self.pool.timeout();
        self.pool.write(|conn| {
            self.pool.keys(|kc| {
                let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
                let mut sql = due(now, retention);
                sql.push(" ORDER BY r.id LIMIT ").bind(i64::from(limit));
                let ids: Vec<String> = {
                    let mut stmt = tx.prepare(&sql.text)?;
                    let found =
                        stmt.query_map(params_from_iter(sql.params.iter()), |r| r.get(0))?;
                    found.collect::<Result<_, _>>()?
                };
                let refs: Vec<&str> = ids.iter().map(String::as_str).collect();
                if !refs.is_empty() {
                    keys::destroy(kc, &refs, now, MarkerKind::Purge)?;
                    points::crash("purge-2");
                    for id in &ids {
                        if let Some(rec) = record_row(&tx, id)? {
                            erase(&tx, &rec, MemoryChangeKind::Purged, now, None, true)?;
                        }
                    }
                }
                let mut remaining = 0;
                if sweep {
                    tx.execute(
                        "DELETE FROM idempotency WHERE at < ?1",
                        [now.saturating_sub(IDEMPOTENCY_KEEP_MS)],
                    )?;
                    let due = due(now, retention);
                    let left: i64 = tx.query_row(
                        &format!("SELECT COUNT(*) FROM ({})", due.text),
                        params_from_iter(due.params.iter()),
                        |r| r.get(0),
                    )?;
                    remaining = to_u64(left)?;
                }
                tx.commit()?;
                if refs.is_empty() {
                    if sweep {
                        truncate(conn, false, timeout)?;
                    }
                    return Ok((0, remaining));
                }
                points::crash("purge-3");
                if settle_wal(conn, sweep, timeout) {
                    points::crash("purge-4");
                    keys::settle(kc, &refs)?;
                }
                Ok((ids.len() as u64, remaining))
            })
        })
    }

    /// The purge before a write: at most `limit` records, with no wait after the commit.
    pub(super) fn purge_committed(
        &self,
        now: Millis,
        retention: Retention,
        limit: u32,
    ) -> Result<u64, StoreError> {
        self.purge(now, retention, limit, false).map(|(n, _)| n)
    }

    pub(super) fn do_forget(&self, req: Forget) -> Result<ForgetReceipt, StoreError> {
        req.check()?;
        self.pool.read(|_| Ok(()))?;
        self.roll_forward()?;
        let timeout = self.pool.timeout();
        self.pool.write(|conn| {
            self.pool.keys(|kc| {
                // Step 1: resolve, and commit the erased prefixes (section 7.2) before any key is
                // destroyed: the record's capture window, and for a forget by session the whole
                // session.
                let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
                let (targets, not_found) = resolve(&tx, &req)?;
                let session = matches!(req.selector, ForgetSelector::Session(_));
                erase_prefixes(&tx, &targets, session, req.at, req.trace_id.as_deref())?;
                tx.commit()?;
                points::crash("forget-1");
                let erasure = Erasure {
                    at: req.at,
                    trace_id: req.trace_id.as_deref(),
                    tombstone: "forget",
                };
                erasure.run(conn, kc, &targets, not_found, timeout)
            })
        })
    }

    pub(super) fn do_sweep(&self, req: Sweep) -> Result<SweepReceipt, StoreError> {
        check_limit("sweep", req.limit, MAX_SWEEP_LIMIT)?;
        self.pool.read(|_| Ok(()))?;
        self.roll_forward()?;
        self.purge_erase_state(req.now)?;
        let (purged, remaining) = self.purge(req.now, req.retention, req.limit, true)?;
        Ok(SweepReceipt { purged, remaining })
    }

    /// `memory-reindex` (section 5.4): roll forward; then in one transaction remove rows with a
    /// marker as the rebuild does, drop and create `records_fts` with `secure-delete` set again,
    /// empty `record_derived`, and index every row that opens (`indexed = 0` for one that does
    /// not, reported and never deleted), counting orphan keys. Only with `remove_orphans` (D89),
    /// in a second step under the memory write lock and then the key file's, are orphans removed.
    /// Then truncate the WAL and settle the markers whose rows are gone. Recreating the table is
    /// what clears the token prefixes FTS5's `secure-delete` leaves.
    pub(super) fn do_reindex(&self, remove_orphans: bool) -> Result<ReindexReceipt, StoreError> {
        self.pool.read(|_| Ok(()))?;
        self.roll_forward()?;
        let timeout = self.pool.timeout();
        self.pool.write(|conn| {
            self.pool.keys(|kc| {
                let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
                let keys = keys::all(kc)?;
                let mut kept = Vec::new();
                for rec in all_records(&tx)? {
                    match keys.destroyed(&rec.id) {
                        Some((kind, at)) => drop_marked(&tx, &rec, kind, at, true, true)?,
                        None => kept.push(rec),
                    }
                }
                tx.execute("DROP TABLE records_fts", [])?;
                tx.execute(CREATE_FTS, [])?;
                tx.execute(FTS_SECURE_DELETE, [])?;
                tx.execute_batch(DERIVED_SCHEMA)?;
                tx.execute("DELETE FROM record_derived", [])?;
                let (reindexed, unreadable) = index_rows(&tx, &self.space, &keys, &kept)?;
                let rows: HashSet<String> = kept.iter().map(|r| r.id.clone()).collect();
                let orphans = keys::orphans(&keys, &rows).len() as u64;
                tx.commit()?;
                let mut orphans_removed = 0;
                if remove_orphans && orphans > 0 {
                    // Under the memory write lock, so no writer is between its key commit and its
                    // memory commit: what has no row now is an orphan of this database.
                    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
                    let rows: HashSet<String> = {
                        let mut stmt = tx.prepare("SELECT id FROM records")?;
                        let found = stmt.query_map([], |r| r.get(0))?;
                        found.collect::<Result<_, _>>()?
                    };
                    let keys = keys::all(kc)?;
                    let list = keys::orphans(&keys, &rows);
                    orphans_removed = keys::remove_live(kc, &list)?;
                    drop(tx);
                }
                if truncate(conn, true, timeout)? {
                    let gone = unsettled_gone(conn, kc)?;
                    let ids: Vec<&str> = gone.iter().map(String::as_str).collect();
                    keys::settle(kc, &ids)?;
                }
                Ok(ReindexReceipt {
                    reindexed,
                    unreadable,
                    orphans,
                    orphans_removed,
                })
            })
        })
    }

    /// A `TRUNCATE` checkpoint, as `store-check` runs it. Unsettled markers whose rows are gone
    /// are settled after an index compaction and a checkpoint that both succeed, so a settled
    /// marker always means the rebuild and the truncate ran after its rows went.
    pub(super) fn do_checkpoint(&self) -> Result<(), StoreError> {
        let timeout = self.pool.timeout();
        let result = self.pool.read(|conn| {
            let gone = self
                .pool
                .keys(|kc| unsettled_gone(conn, kc))
                .unwrap_or_default();
            if gone.is_empty() {
                truncate(conn, true, timeout)?;
                return Ok(());
            }
            if settle_wal(conn, true, timeout) {
                let ids: Vec<&str> = gone.iter().map(String::as_str).collect();
                self.pool.keys(|kc| keys::settle(kc, &ids))?;
            }
            Ok(())
        });
        match result {
            Ok(())
            | Err(
                StoreError::NotProvisioned
                | StoreError::Busy
                | StoreError::KeysMissing
                | StoreError::KeysMismatch,
            ) => Ok(()),
            Err(other) => Err(other),
        }
    }
}

/// Step 1's erased prefixes (section 7.2), in its transaction: each target's capture window,
/// and for a forget by session the whole session, under the record's owner.
pub(super) fn erase_prefixes(
    tx: &Connection,
    targets: &[RecordRow],
    session: bool,
    at: Millis,
    trace_id: Option<&str>,
) -> Result<(), Fail> {
    for rec in targets {
        let key: Option<String> = tx.query_row(
            "SELECT capture_key FROM records WHERE rowid = ?1",
            [rec.rowid],
            |r| r.get(0),
        )?;
        if let Some(key) = key {
            let mut prefixes = vec![key.clone()];
            if session && let Some(prefix) = capture_session_prefix(&key) {
                prefixes.push(prefix);
            }
            for prefix in prefixes {
                tx.execute(
                    "INSERT OR IGNORE INTO capture_erasures \
                     (owner, key_prefix, erased_at, trace_id) VALUES (?1, ?2, ?3, ?4)",
                    params![rec.owner, prefix, at, trace_id],
                )?;
            }
        }
    }
    Ok(())
}

/// Steps 2 to 5 of a forget or an erase, once step 1 has committed: what they write.
pub(super) struct Erasure<'a> {
    pub(super) at: Millis,
    pub(super) trace_id: Option<&'a str>,
    /// The tombstones' kind: `forget` or `erase`.
    pub(super) tombstone: &'static str,
}

impl Erasure<'_> {
    /// Destroy the targets' keys (the erasure point), remove their rows, compact and truncate,
    /// settle. A failure before the key file's commit destroyed nothing and fails the call; after
    /// it nothing fails, and `Pending` leaves the rest to the next writer's roll-forward.
    pub(super) fn run(
        &self,
        conn: &mut Connection,
        kc: &mut Connection,
        targets: &[RecordRow],
        not_found: Vec<String>,
        timeout: std::time::Duration,
    ) -> Result<ForgetReceipt, Fail> {
        if targets.is_empty() {
            return Ok(Self::receipt(targets, not_found, WalState::Clean));
        }
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if !self.destroy_and_remove(tx, kc, targets)? {
            return Ok(Self::receipt(targets, not_found, WalState::Pending));
        }
        Ok(self.settle(conn, kc, targets, not_found, timeout))
    }

    /// Build the receipt without reopening any erased content.
    pub(super) fn receipt(
        targets: &[RecordRow],
        not_found: Vec<String>,
        wal: WalState,
    ) -> ForgetReceipt {
        ForgetReceipt {
            erased: targets.len() as u64,
            ids: targets
                .iter()
                .take(MAX_FORGET_IDS)
                .map(|r| r.id.clone())
                .collect(),
            not_found,
            wal,
        }
    }

    /// Steps 2 and 3 under a write lock the caller already holds. An erase rechecks its plan
    /// under this same lock before calling: no writer can change it before key destruction.
    pub(super) fn destroy_and_remove(
        &self,
        tx: rusqlite::Transaction<'_>,
        kc: &mut Connection,
        targets: &[RecordRow],
    ) -> Result<bool, Fail> {
        if targets.is_empty() {
            tx.commit()?;
            return Ok(true);
        }
        let ids: Vec<&str> = targets.iter().map(|r| r.id.as_str()).collect();
        keys::destroy(kc, &ids, self.at, MarkerKind::Forget)?;
        points::crash("forget-2");
        // After the erasure point a removal failure is pending recovery, never a failed erase.
        if self.remove(tx, targets).is_err() {
            return Ok(false);
        }
        points::crash("forget-3");
        Ok(true)
    }

    /// Steps 4 and 5 after row removal. They cannot fail the call past the erasure point.
    pub(super) fn settle(
        &self,
        conn: &mut Connection,
        kc: &mut Connection,
        targets: &[RecordRow],
        not_found: Vec<String>,
        timeout: std::time::Duration,
    ) -> ForgetReceipt {
        if targets.is_empty() {
            return Self::receipt(targets, not_found, WalState::Clean);
        }
        if !settle_wal(conn, true, timeout) {
            return Self::receipt(targets, not_found, WalState::Pending);
        }
        points::crash("forget-4");
        let ids: Vec<&str> = targets.iter().map(|r| r.id.as_str()).collect();
        if keys::settle(kc, &ids).is_err() {
            return Self::receipt(targets, not_found, WalState::Pending);
        }
        points::crash("forget-5");
        Self::receipt(targets, not_found, WalState::Clean)
    }

    /// Step 3, in step 2's transaction: for each id whose row still exists, remove its rows and
    /// write a tombstone and an `Erased` change; commit.
    fn remove(&self, tx: rusqlite::Transaction<'_>, targets: &[RecordRow]) -> Result<(), Fail> {
        points::fail("forget-3")?;
        for target in targets {
            let Some(rec) = record_row(&tx, &target.id)? else {
                continue;
            };
            tx.execute(
                "INSERT OR IGNORE INTO tombstones (id, erased_at, trace_id, kind) \
                 VALUES (?1, ?2, ?3, ?4)",
                params![rec.id, self.at, self.trace_id, self.tombstone],
            )?;
            erase(
                &tx,
                &rec,
                MemoryChangeKind::Erased,
                self.at,
                self.trace_id,
                true,
            )?;
        }
        tx.commit()?;
        Ok(())
    }
}

/// The owner's records a forget erases, and the requested ids that were not the owner's.
fn resolve(tx: &Connection, req: &Forget) -> Result<(Vec<RecordRow>, Vec<String>), Fail> {
    let mut targets = Vec::new();
    let mut not_found = Vec::new();
    // The owner's records, and those of the legacy principals it stands for (phase 5 section 4.6).
    let owns = |owner: &str| owner == req.owner || req.equivalents.iter().any(|e| e == owner);
    match &req.selector {
        ForgetSelector::Ids(ids) => {
            let mut seen = BTreeSet::new();
            for id in ids {
                match record_row(tx, id)? {
                    Some(rec) if owns(&rec.owner) && seen.insert(id.clone()) => {
                        targets.push(rec);
                    }
                    Some(rec) if owns(&rec.owner) => {}
                    _ => not_found.push(id.clone()),
                }
            }
        }
        selector => {
            let mut sql = Sql::new("SELECT r.id FROM records r WHERE r.owner IN ");
            sql.bind_list(
                std::iter::once(req.owner.as_str())
                    .chain(req.equivalents.iter().map(String::as_str)),
            );
            match selector {
                ForgetSelector::Session(s) => {
                    sql.push(" AND r.session = ").bind(s);
                }
                ForgetSelector::Project(p) => {
                    sql.push(" AND r.project = ").bind(p);
                }
                ForgetSelector::Before(t) => {
                    sql.push(
                        " AND (SELECT f.recorded_at FROM versions f \
                         WHERE f.id = r.id AND f.record_version = 1) < ",
                    )
                    .bind(*t);
                }
                ForgetSelector::Ids(_) => {}
            }
            sql.push(" ORDER BY r.id");
            let ids: Vec<String> = {
                let mut stmt = tx.prepare(&sql.text)?;
                let found = stmt.query_map(params_from_iter(sql.params.iter()), |r| r.get(0))?;
                found.collect::<Result<_, _>>()?
            };
            for id in ids {
                if let Some(rec) = record_row(tx, &id)? {
                    targets.push(rec);
                }
            }
        }
    }
    Ok((targets, not_found))
}

//! Forget, purge, sweep, reindex and checkpoints (phase 3 sections 5.4, 7.2 and 8.8).
//!
//! Step 3a has no key file, so a forget is section 5.4's steps 1 and 3 in one transaction
//! (erased prefixes, rows removed, tombstones, changes), then the index compacted in a
//! transaction of its own (`compact`), then step 4, `wal_checkpoint(TRUNCATE)` outside any
//! transaction, because SQLite refuses a checkpoint inside one. A purge is the same
//! without prefixes or tombstones. Step 3b inserts the key destruction between them and adds the
//! markers that let a later writer retry a busy compaction or checkpoint; until then either one
//! busy answers `wal: Pending`: the next erasing call or `reindex` compacts the index, and they
//! or `checkpoint()` truncate the WAL.

use std::collections::BTreeSet;

use rusqlite::{Connection, TransactionBehavior, params, params_from_iter};
use umbel_store::memory::{
    Forget, ForgetReceipt, IDEMPOTENCY_KEEP_MS, MAX_FORGET_IDS, MAX_SWEEP_LIMIT, MemoryChangeKind,
    ReindexReceipt, Retention, Sweep, SweepReceipt, WalState, capture_session_prefix, check_limit,
};
use umbel_store::{ForgetSelector, MemoryClass, Millis, StoreError};

use super::SqliteMemoryStore;
use super::rows::{ChangeRow, RecordRow, erase_rows, insert_change, record_row};
use super::schema::{CREATE_FTS, FTS_SECURE_DELETE};
use crate::error::{Fail, map_sql, to_u64};
use crate::sql::Sql;

/// `records` with a current version `v` past its purge date at `now` (section 8.8): `expires`
/// older than `now − purge_after` for its class, or a current version carrying an invalidation
/// recorded before that.
fn due(now: Millis, retention: Retention) -> Sql {
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

/// Purge at most `limit` records past their purge date, in id order: rows gone and a `Purged`
/// change each, no tombstone and no erased prefix. Returns how many.
fn purge(tx: &Connection, now: Millis, retention: Retention, limit: u32) -> Result<u64, Fail> {
    let mut sql = due(now, retention);
    sql.push(" ORDER BY r.id LIMIT ").bind(i64::from(limit));
    let ids: Vec<String> = {
        let mut stmt = tx.prepare(&sql.text)?;
        let found = stmt.query_map(params_from_iter(sql.params.iter()), |r| r.get(0))?;
        found.collect::<Result<_, _>>()?
    };
    for id in &ids {
        if let Some(rec) = record_row(tx, id)? {
            erase(tx, &rec, MemoryChangeKind::Purged, now, None)?;
        }
    }
    Ok(ids.len() as u64)
}

/// Remove a record's rows and record the change, with the access it had.
fn erase(
    tx: &Connection,
    rec: &RecordRow,
    kind: MemoryChangeKind,
    at: Millis,
    trace: Option<&str>,
) -> Result<(), Fail> {
    let version: u32 = tx.query_row(
        "SELECT MAX(record_version) FROM versions WHERE id = ?1",
        [&rec.id],
        |r| r.get(0),
    )?;
    erase_rows(tx, rec)?;
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
/// has committed (phase 3 "Amendments from step 3a", item 7). FTS5's `secure-delete` removes a
/// deleted row's entries from the segments, but a leaf page's separator in `records_fts_idx` can
/// be a whole deleted token; `optimize` is a no-op on an index that is already one segment, so it
/// cannot be relied on, and `rebuild` writes every segment and separator afresh. With
/// `secure_delete=ON` the freed pages are overwritten. It reads the index's plaintext copy and needs
/// no key. Without `wait` it takes no lock wait. Answers whether it ran.
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

/// After an erasure has committed: compact the index, then truncate the WAL, each outside the
/// erasure's transaction. Never fails, since the rows are already gone: a busy or failed step
/// answers `false`, which a forget reports as `wal: Pending`.
fn settle(conn: &mut Connection, wait: bool, timeout: std::time::Duration) -> bool {
    matches!(compact(conn, wait, timeout), Ok(true))
        && matches!(truncate(conn, wait, timeout), Ok(true))
}

impl SqliteMemoryStore {
    /// Purge at most `limit` records in a transaction of their own, then, outside it and with
    /// no wait, compact the index and truncate the WAL. Returns how many were purged.
    pub(super) fn purge_committed(
        &self,
        now: Millis,
        retention: Retention,
        limit: u32,
    ) -> Result<u64, StoreError> {
        self.pool.write(|conn| {
            let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let purged = purge(&tx, now, retention, limit)?;
            tx.commit()?;
            if purged > 0 {
                settle(conn, false, self.pool.timeout());
            }
            Ok(purged)
        })
    }

    pub(super) fn do_forget(&self, req: Forget) -> Result<ForgetReceipt, StoreError> {
        req.check()?;
        self.pool.read(|_| Ok(()))?;
        self.pool.write(|conn| {
            let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let (targets, not_found) = resolve(&tx, &req)?;
            for rec in &targets {
                // The erased prefixes first (section 7.2): the record's capture window, and for a
                // forget by session the whole session.
                let key: Option<String> = tx.query_row(
                    "SELECT capture_key FROM records WHERE rowid = ?1",
                    [rec.rowid],
                    |r| r.get(0),
                )?;
                if let Some(key) = key {
                    let mut prefixes = vec![key.clone()];
                    if matches!(req.selector, ForgetSelector::Session(_))
                        && let Some(prefix) = capture_session_prefix(&key)
                    {
                        prefixes.push(prefix);
                    }
                    for prefix in prefixes {
                        tx.execute(
                            "INSERT OR IGNORE INTO capture_erasures \
                             (owner, key_prefix, erased_at, trace_id) VALUES (?1, ?2, ?3, ?4)",
                            params![req.owner, prefix, req.at, req.trace_id],
                        )?;
                    }
                }
                tx.execute(
                    "INSERT OR IGNORE INTO tombstones (id, erased_at, trace_id, kind) \
                     VALUES (?1, ?2, ?3, 'forget')",
                    params![rec.id, req.at, req.trace_id],
                )?;
                erase(
                    &tx,
                    rec,
                    MemoryChangeKind::Erased,
                    req.at,
                    req.trace_id.as_deref(),
                )?;
            }
            tx.commit()?;
            let wal = if targets.is_empty() || settle(conn, true, self.pool.timeout()) {
                WalState::Clean
            } else {
                WalState::Pending
            };
            Ok(ForgetReceipt {
                erased: targets.len() as u64,
                ids: targets
                    .iter()
                    .take(MAX_FORGET_IDS)
                    .map(|r| r.id.clone())
                    .collect(),
                not_found,
                wal,
            })
        })
    }

    pub(super) fn do_sweep(&self, req: Sweep) -> Result<SweepReceipt, StoreError> {
        check_limit("sweep", req.limit, MAX_SWEEP_LIMIT)?;
        self.pool.read(|_| Ok(()))?;
        self.pool.write(|conn| {
            let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let purged = purge(&tx, req.now, req.retention, req.limit)?;
            tx.execute(
                "DELETE FROM idempotency WHERE at < ?1",
                [req.now.saturating_sub(IDEMPOTENCY_KEEP_MS)],
            )?;
            let due = due(req.now, req.retention);
            let remaining: i64 = tx.query_row(
                &format!("SELECT COUNT(*) FROM ({})", due.text),
                params_from_iter(due.params.iter()),
                |r| r.get(0),
            )?;
            tx.commit()?;
            if purged > 0 {
                settle(conn, true, self.pool.timeout());
            } else {
                truncate(conn, false, self.pool.timeout())?;
            }
            Ok(SweepReceipt {
                purged,
                remaining: to_u64(remaining)?,
            })
        })
    }

    /// Drop and create `records_fts`, setting `secure-delete` again, empty `record_derived`, and
    /// insert every record that opens, with `indexed = 1`; one that does not open gets
    /// `indexed = 0` and is reported, never deleted. Then truncate the WAL. Recreating the
    /// table is what clears token prefixes FTS5's `secure-delete` leaves (section 5.4). Step 3a
    /// has no key file, so it counts no orphans.
    pub(super) fn do_reindex(&self, _remove_orphans: bool) -> Result<ReindexReceipt, StoreError> {
        self.pool.read(|_| Ok(()))?;
        self.pool.write(|conn| {
            let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
            tx.execute("DROP TABLE records_fts", [])?;
            tx.execute(CREATE_FTS, [])?;
            tx.execute(FTS_SECURE_DELETE, [])?;
            tx.execute("DELETE FROM record_derived", [])?;
            let rows: Vec<RecordRow> = {
                let sql = format!("SELECT {} FROM records r", super::rows::RECORD_COLS);
                let mut stmt = tx.prepare(&sql)?;
                let mut found = stmt.query([])?;
                let mut out = Vec::new();
                while let Some(row) = found.next()? {
                    out.push(RecordRow::from_row(row, 0)?);
                }
                out
            };
            let (mut reindexed, mut unreadable) = (0, 0);
            for rec in rows {
                match rec.body(&self.space) {
                    Ok(body) => {
                        tx.execute(
                            "INSERT INTO records_fts (rowid, subject, tags, text) \
                             VALUES (?1, ?2, ?3, ?4)",
                            params![rec.rowid, body.subject, body.tags.join(" "), body.text],
                        )?;
                        tx.execute(
                            "INSERT INTO record_derived (id, content_hash, tags) \
                             VALUES (?1, ?2, ?3)",
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
                    Err(Fail::Store(
                        StoreError::SealInvalid { .. } | StoreError::KeyAbsent { .. },
                    )) => {
                        tx.execute(
                            "UPDATE records SET indexed = 0 WHERE rowid = ?1",
                            [rec.rowid],
                        )?;
                        unreadable += 1;
                    }
                    Err(other) => return Err(other),
                }
            }
            tx.commit()?;
            truncate(conn, true, self.pool.timeout())?;
            Ok(ReindexReceipt {
                reindexed,
                unreadable,
                orphans: 0,
                orphans_removed: 0,
            })
        })
    }

    pub(super) fn do_checkpoint(&self) -> Result<(), StoreError> {
        match self
            .pool
            .read(|conn| truncate(conn, true, self.pool.timeout()).map(drop))
        {
            Ok(()) | Err(StoreError::NotProvisioned | StoreError::Busy) => Ok(()),
            Err(other) => Err(other),
        }
    }
}

/// The owner's records a forget erases, and the requested ids that were not the owner's.
fn resolve(tx: &Connection, req: &Forget) -> Result<(Vec<RecordRow>, Vec<String>), Fail> {
    let mut targets = Vec::new();
    let mut not_found = Vec::new();
    match &req.selector {
        ForgetSelector::Ids(ids) => {
            let mut seen = BTreeSet::new();
            for id in ids {
                match record_row(tx, id)? {
                    Some(rec) if rec.owner == req.owner && seen.insert(id.clone()) => {
                        targets.push(rec);
                    }
                    Some(rec) if rec.owner == req.owner => {}
                    _ => not_found.push(id.clone()),
                }
            }
        }
        selector => {
            let mut sql = Sql::new("SELECT r.id FROM records r WHERE r.owner = ");
            sql.bind(&req.owner);
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

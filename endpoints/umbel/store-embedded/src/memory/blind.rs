//! `memory-erase` at the store (phase 5 specification, section 8.4; D85, D118): the target's
//! records selected by owner **whatever their access set**, the erase on phase 3's forget path,
//! and the two-person rule's erase requests.
//!
//! **Blind, and only for the host.** No reader filter applies here: the host's memory services
//! call these methods only for a verified eraser, and they answer ids, versions and counts, never
//! a record's text, labels or access.
//!
//! **The erase.** In one first transaction it takes the named erase request (only if still
//! pending with the plan presented), selects the targets, computes their plan and, when it is the
//! one presented, commits their erased prefixes; then phase 3's steps 2 to 5 run as for a forget
//! (keys first, D73, D82). A plan that does not match erases nothing and voids the request, in that
//! same transaction.
//!
//! **Erase requests** live in the memory database's `erase_requests` table, created on first use
//! (`IF NOT EXISTS`, so a database from before step 10 gains it without a schema version), never
//! copied by `store-backup` (it is not one of the backup's tables), and deleted with
//! `secure_delete` when they run, are voided or expire: every request operation first purges the
//! expired ones.

use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params, params_from_iter};
use umbel_store::memory::{
    Erase, EraseOutcome, EraseRequest, EraseTarget, check_erase_ids, check_erase_owners,
    erase_plan, is_erase_request_id,
};
use umbel_store::{Millis, StoreError};

use super::SqliteMemoryStore;
use super::erase::{Erasure, erase_prefixes};
use super::points;
use super::rows::{RecordRow, record_row};
use crate::error::Fail;
use crate::sql::Sql;

/// The erase requests' table: ids, the target, the plan's hash, the first eraser and two times.
const ERASE_REQUESTS: &str = "CREATE TABLE IF NOT EXISTS erase_requests (
    id         TEXT PRIMARY KEY,
    target     TEXT NOT NULL,
    plan       TEXT NOT NULL,
    first      TEXT NOT NULL,
    at         INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
) STRICT, WITHOUT ROWID";

/// Whether the table exists (a reader never creates it).
fn has_requests(conn: &Connection) -> Result<bool, Fail> {
    Ok(conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'erase_requests')",
        [],
        |r| r.get(0),
    )?)
}

/// Delete the requests expired at `now`.
fn purge_expired(conn: &Connection, now: Millis) -> Result<(), Fail> {
    conn.execute("DELETE FROM erase_requests WHERE expires_at <= ?1", [now])?;
    Ok(())
}

/// The ids of the records `owners` own, among `ids` when given, ordered by id.
fn target_ids(
    conn: &Connection,
    owners: &[String],
    ids: Option<&[String]>,
) -> Result<Vec<String>, Fail> {
    let mut sql = Sql::new("SELECT r.id FROM records r WHERE r.owner IN ");
    sql.bind_list(owners.iter().map(String::as_str));
    if let Some(ids) = ids {
        sql.push(" AND r.id IN ")
            .bind_list(ids.iter().map(String::as_str));
    }
    sql.push(" ORDER BY r.id");
    let mut stmt = conn.prepare(&sql.text)?;
    let found = stmt.query_map(params_from_iter(sql.params.iter()), |r| r.get(0))?;
    Ok(found.collect::<Result<_, _>>()?)
}

/// The targets of `owners` (and `ids`) with their current versions.
fn targets(
    conn: &Connection,
    owners: &[String],
    ids: Option<&[String]>,
) -> Result<Vec<EraseTarget>, Fail> {
    let mut out = Vec::new();
    for id in target_ids(conn, owners, ids)? {
        let version: u32 = conn.query_row(
            "SELECT COALESCE(MAX(record_version), 1) FROM versions WHERE id = ?1",
            [&id],
            |r| r.get(0),
        )?;
        out.push(EraseTarget {
            id,
            record_version: version,
        });
    }
    Ok(out)
}

impl SqliteMemoryStore {
    pub(super) fn do_erase_targets(
        &self,
        owners: &[String],
        ids: Option<&[String]>,
    ) -> Result<Vec<EraseTarget>, StoreError> {
        check_erase_owners(owners)?;
        if let Some(ids) = ids {
            check_erase_ids(ids)?;
        }
        self.pool.read(|_| Ok(()))?;
        // A record whose key a forget already destroyed is gone: roll it forward first, so the
        // plan names only what an erase can still reach.
        self.roll_forward()?;
        self.pool.read(|conn| targets(conn, owners, ids))
    }

    pub(super) fn do_erase(&self, req: Erase) -> Result<EraseOutcome, StoreError> {
        req.check()?;
        self.pool.read(|_| Ok(()))?;
        self.roll_forward()?;
        let timeout = self.pool.timeout();
        self.pool.write(|conn| {
            self.pool.keys(|kc| {
                // Step 1: take the request, select and check the plan, commit the erased prefixes.
                let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
                if let Some(request) = &req.request {
                    tx.execute_batch(ERASE_REQUESTS)?;
                    purge_expired(&tx, req.at)?;
                    let plan: Option<String> = tx
                        .query_row(
                            "SELECT plan FROM erase_requests WHERE id = ?1",
                            [request],
                            |r| r.get(0),
                        )
                        .optional()?;
                    // Taken (or voided) here, in the erase's own first transaction, so two
                    // second erasers cannot both run it.
                    tx.execute("DELETE FROM erase_requests WHERE id = ?1", [request])?;
                    match plan {
                        None => {
                            tx.commit()?;
                            return Ok(EraseOutcome::RequestGone);
                        }
                        // Another plan voids the request (section 8.4).
                        Some(plan) if plan != req.plan => {
                            tx.commit()?;
                            return Ok(EraseOutcome::PlanStale);
                        }
                        Some(_) => {}
                    }
                }
                let selected = targets(&tx, &req.owners, req.ids.as_deref())?;
                if erase_plan(&selected) != req.plan {
                    // The request, if any, is already taken in this transaction: it is voided.
                    tx.commit()?;
                    return Ok(EraseOutcome::PlanStale);
                }
                let mut rows: Vec<RecordRow> = Vec::with_capacity(selected.len());
                for target in &selected {
                    if let Some(rec) = record_row(&tx, &target.id)? {
                        rows.push(rec);
                    }
                }
                erase_prefixes(&tx, &rows, false, req.at, req.trace_id.as_deref())?;
                tx.commit()?;
                points::crash("erase-1");
                let erasure = Erasure {
                    at: req.at,
                    trace_id: req.trace_id.as_deref(),
                    tombstone: "erase",
                };
                erasure
                    .run(conn, kc, &rows, Vec::new(), timeout)
                    .map(EraseOutcome::Erased)
            })
        })
    }

    pub(super) fn do_erase_request_create(
        &self,
        req: EraseRequest,
        now: Millis,
    ) -> Result<(), StoreError> {
        req.check()?;
        self.pool.read(|_| Ok(()))?;
        self.pool.write(|conn| {
            let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
            tx.execute_batch(ERASE_REQUESTS)?;
            purge_expired(&tx, now)?;
            let added = tx.execute(
                "INSERT OR IGNORE INTO erase_requests (id, target, plan, first, at, expires_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    req.id,
                    req.target,
                    req.plan,
                    req.first,
                    req.at,
                    req.expires_at
                ],
            )?;
            if added != 1 {
                return Err(StoreError::invalid("an erase request with this id exists").into());
            }
            tx.commit()?;
            Ok(())
        })
    }

    pub(super) fn do_erase_request(
        &self,
        id: &str,
        now: Millis,
    ) -> Result<Option<EraseRequest>, StoreError> {
        if !is_erase_request_id(id) {
            return Ok(None);
        }
        self.pool.read(|_| Ok(()))?;
        self.pool.write(|conn| {
            let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
            if !has_requests(&tx)? {
                return Ok(None);
            }
            purge_expired(&tx, now)?;
            let found = tx
                .query_row(
                    "SELECT id, target, plan, first, at, expires_at FROM erase_requests WHERE id = ?1",
                    [id],
                    |r| {
                        Ok(EraseRequest {
                            id: r.get(0)?,
                            target: r.get(1)?,
                            plan: r.get(2)?,
                            first: r.get(3)?,
                            at: r.get(4)?,
                            expires_at: r.get(5)?,
                        })
                    },
                )
                .optional()?;
            tx.commit()?;
            Ok(found)
        })
    }

    pub(super) fn do_erase_request_void(&self, id: &str) -> Result<bool, StoreError> {
        if !is_erase_request_id(id) {
            return Ok(false);
        }
        self.pool.read(|_| Ok(()))?;
        self.pool.write(|conn| {
            let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
            if !has_requests(&tx)? {
                return Ok(false);
            }
            let gone = tx.execute("DELETE FROM erase_requests WHERE id = ?1", [id])?;
            tx.commit()?;
            Ok(gone == 1)
        })
    }
}

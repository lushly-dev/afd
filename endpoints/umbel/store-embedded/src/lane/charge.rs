//! The records write quota (D212, records host specification section 4.2): which principal each
//! declared record is charged to, and the check a put makes against its principal's quota.
//!
//! **A principal's use is derived, never counted.** Each record has at most one row of
//! `record_charges` (schema version 5), keyed by its lane, holding the principal of its stored
//! envelope and its rows of `record_terms`, both **set** whenever the record's terms are written.
//! A principal's use is a `COUNT` and a `SUM` over its own rows, by an index that covers them, in
//! the transaction that writes. So:
//!
//! - **Concurrent writers.** Every put takes SQLite's write lock (`BEGIN IMMEDIATE`) before it
//!   reads the use, so two puts by one principal are serialised and the second reads the first's
//!   charge.
//! - **Crash and rebuild.** A charge commits with the terms it counts, or not at all, and a
//!   rebuild sets each one again from the record's envelope and its terms: running it twice
//!   gives the same rows, and nothing is ever counted twice.
//! - **Deletes.** A record deleted, or left without lane rows by a rebuild, takes its charge with
//!   it by `ON DELETE CASCADE`: quota comes back with no statement of its own.
//!
//! The cost of a put's reading is its principal's rows of the kind, which the records limit
//! bounds.

use rusqlite::{OptionalExtension, Transaction, params};
use umbel_store::StoreError;
use umbel_store::lane::{QuotaUse, RecordQuota};

use crate::error::{Fail, to_u64};

/// A lane row's charge.
pub(super) const CHARGE_OF_SQL: &str =
    "SELECT principal, postings FROM record_charges WHERE lane = ?1";

/// What one principal is charged in one kind, by the covering index.
pub(super) const USE_SQL: &str = "SELECT COUNT(*), COALESCE(SUM(postings), 0) FROM record_charges
     WHERE ns = ?1 AND kind = ?2 AND principal = ?3";

/// The largest use of any one principal in one kind (`lane_status`), by the covering index.
pub(super) const MOST_USE_SQL: &str =
    "SELECT COALESCE(MAX(records), 0), COALESCE(MAX(postings), 0) FROM
       (SELECT COUNT(*) AS records, SUM(postings) AS postings FROM record_charges
        WHERE ns = ?1 AND kind = ?2 GROUP BY principal)";

/// The principal a lane row is charged to now, and its postings.
pub(super) fn charge_of(tx: &Transaction<'_>, lane: i64) -> Result<Option<(String, u64)>, Fail> {
    let found: Option<(String, i64)> = tx
        .query_row(CHARGE_OF_SQL, [lane], |row| Ok((row.get(0)?, row.get(1)?)))
        .optional()?;
    found
        .map(|(principal, postings)| Ok((principal, to_u64(postings)?)))
        .transpose()
}

/// What `principal` is charged in one kind now.
pub(super) fn use_of(
    tx: &Transaction<'_>,
    ns: &str,
    kind: &str,
    principal: &str,
) -> Result<QuotaUse, Fail> {
    let (records, postings): (i64, i64) =
        tx.query_row(USE_SQL, params![ns, kind, principal], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })?;
    Ok(QuotaUse {
        records: to_u64(records)?,
        postings: to_u64(postings)?,
    })
}

/// Hold a put to `quota` before it writes anything: the put would charge the record, now on
/// `lane` (none for a record with no lane row), to `principal` with `postings`. Refused with
/// [`StoreError::RecordQuotaExceeded`] when that leaves `principal` past a limit it adds to.
pub(super) fn check_quota(
    tx: &Transaction<'_>,
    quota: &RecordQuota,
    ns: &str,
    kind: &str,
    lane: Option<i64>,
    principal: &str,
    postings: u64,
) -> Result<(), Fail> {
    let before = use_of(tx, ns, kind, principal)?;
    let mut after = before;
    // The record's charge, if it is this principal's already, moves rather than adds.
    if let Some(lane) = lane
        && let Some((held_by, held)) = charge_of(tx, lane)?
        && held_by == principal
    {
        after.records = after.records.saturating_sub(1);
        after.postings = after.postings.saturating_sub(held);
    }
    after.records = after.records.saturating_add(1);
    after.postings = after.postings.saturating_add(postings);
    match quota.refuses(before, after) {
        Some(limit) => Err(StoreError::RecordQuotaExceeded { limit }.into()),
        None => Ok(()),
    }
}

/// Charge the record on `lane` to `principal` with the rows of `record_terms` it holds now, or
/// to no one. Called after its terms are written, by a put and by a rebuild: a value set, never
/// added to.
pub(super) fn set_charge(
    tx: &Transaction<'_>,
    lane: i64,
    ns: &str,
    kind: &str,
    principal: Option<&str>,
) -> Result<(), Fail> {
    match principal {
        Some(principal) => {
            tx.execute(
                "INSERT INTO record_charges (lane, ns, kind, principal, postings)
                 VALUES (?1, ?2, ?3, ?4, (SELECT COUNT(*) FROM record_terms WHERE lane = ?1))
                 ON CONFLICT (lane) DO UPDATE SET principal = excluded.principal,
                   postings = excluded.postings",
                params![lane, ns, kind, principal],
            )?;
        }
        None => {
            tx.execute("DELETE FROM record_charges WHERE lane = ?1", [lane])?;
        }
    }
    Ok(())
}

//! What `store-check` and the doctor read from the memory store (phase 3 sections 5.3 and 5.4):
//! the integrity of both files, the lexical lane's consistency, the access tables, whether every
//! row opens, the markers, the orphans, and the maintenance state. Reads only, holds no text,
//! and never a key outside the store.

use std::collections::HashSet;

use rusqlite::{Connection, params_from_iter};
use umbel_store::memory::Retention;
use umbel_store::{Millis, StoreError};

use super::SqliteMemoryStore;
use super::erase::{all_records, due};
use super::keys::{self, KeyEntry};
use super::rows::VersionRow;
use crate::error::{Fail, to_u64};

/// The most ids a finding lists.
const LISTED: usize = 100;

/// `store-check`'s findings on a provisioned memory store. Every list holds ids, never text.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[non_exhaustive]
pub struct MemoryCheck {
    /// `PRAGMA integrity_check` on `memory.sqlite3`; empty when it says ok.
    pub integrity: Vec<String>,
    /// `PRAGMA integrity_check` on `memory.keys`; empty when it says ok.
    pub keys_integrity: Vec<String>,
    /// FTS5's `integrity-check` on `records_fts`, when it failed.
    pub fts: Option<String>,
    /// Rows of `records` with `indexed = 1`.
    pub indexed: u64,
    /// Rows of `record_derived`.
    pub derived: u64,
    /// Rows of `records_fts`.
    pub fts_rows: u64,
    /// Records with `indexed = 0`: a reindex or a rebuild could not open them.
    pub not_indexed: Vec<String>,
    /// Records and changes without an access token.
    pub access: Vec<String>,
    /// Rows with no key entry (`MEMORY_KEY_ABSENT`).
    pub absent: Vec<String>,
    /// Rows whose body or a version does not open (`MEMORY_SEAL_INVALID`).
    pub seal_invalid: Vec<String>,
    /// Rows whose key entry is a destroyed marker: a file-level copy put back, until
    /// `memory-reindex` removes them.
    pub marked: Vec<String>,
    /// Key entries with no row.
    pub orphans: u64,
    /// Destroyed markers whose roll-forward has not finished.
    pub unsettled: u64,
}

/// The maintenance state the doctor's `stores.sweep` reads (section 8.8).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
#[non_exhaustive]
pub struct MemoryMaintenance {
    /// Records past their purge date at the instant asked, by the retention given.
    pub past_purge: u64,
    /// The latest `Purged` change, if any.
    pub last_purge: Option<Millis>,
}

fn integrity(conn: &Connection) -> Result<Vec<String>, Fail> {
    let mut statement = conn.prepare("PRAGMA integrity_check")?;
    let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
    let mut findings = Vec::new();
    for row in rows {
        let line = row?;
        if line != "ok" {
            findings.push(line);
        }
    }
    Ok(findings)
}

fn count(conn: &Connection, sql: &str) -> Result<u64, Fail> {
    Ok(to_u64(
        conn.query_row(sql, [], |row| row.get::<_, i64>(0))?,
    )?)
}

fn ids(conn: &Connection, sql: &str) -> Result<Vec<String>, Fail> {
    let mut statement = conn.prepare(sql)?;
    let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
    let mut found = Vec::new();
    for row in rows.take(LISTED) {
        found.push(row?);
    }
    Ok(found)
}

fn push_listed(list: &mut Vec<String>, id: &str) {
    if list.len() < LISTED {
        list.push(id.to_owned());
    }
}

impl SqliteMemoryStore {
    /// `store-check`'s read of the memory store (section 5.4). Writes nothing; the checkpoint
    /// that settles markers is [`MemoryStore::checkpoint`](umbel_store::MemoryStore::checkpoint).
    ///
    /// # Errors
    /// `NotProvisioned` before the first write; `KeysMissing` or `KeysMismatch` when the key file
    /// is gone or foreign; `Busy` or `Io`.
    pub fn check(&self) -> Result<MemoryCheck, StoreError> {
        self.pool.read(|conn| {
            let mut check = MemoryCheck {
                integrity: integrity(conn)?,
                ..MemoryCheck::default()
            };
            check.fts = conn
                .execute(
                    "INSERT INTO records_fts(records_fts) VALUES('integrity-check')",
                    [],
                )
                .err()
                .map(|error| error.to_string());
            check.indexed = count(conn, "SELECT COUNT(*) FROM records WHERE indexed = 1")?;
            check.derived = count(conn, "SELECT COUNT(*) FROM record_derived")?;
            check.fts_rows = count(conn, "SELECT COUNT(*) FROM records_fts")?;
            check.not_indexed = ids(conn, "SELECT id FROM records WHERE indexed = 0 ORDER BY id")?;
            check.access = ids(
                conn,
                "SELECT 'record ' || r.id FROM records r WHERE NOT EXISTS (SELECT 1 FROM record_access a WHERE a.id = r.id) \
                 UNION ALL SELECT 'change ' || CAST(c.rev AS TEXT) FROM changes c WHERE NOT EXISTS (SELECT 1 FROM change_access a WHERE a.rev = c.rev)",
            )?;
            let rows = all_records(conn)?;
            let space = self.space.clone();
            self.pool.keys(|kc| {
                check.keys_integrity = integrity(kc)?;
                let keys = keys::all(kc)?;
                let present: HashSet<String> = rows.iter().map(|rec| rec.id.clone()).collect();
                check.orphans = keys::orphans(&keys, &present).len() as u64;
                check.unsettled = keys.marker_counts().1;
                for rec in &rows {
                    let key = match keys.entry(&rec.id) {
                        None => {
                            push_listed(&mut check.absent, &rec.id);
                            continue;
                        }
                        Some(KeyEntry::Destroyed { .. }) => {
                            push_listed(&mut check.marked, &rec.id);
                            continue;
                        }
                        Some(KeyEntry::Live(key)) => key,
                    };
                    let mut opens = rec.body(&space, key).is_ok();
                    if opens {
                        let mut statement = conn.prepare(&format!(
                            "SELECT {} FROM versions v WHERE v.id = ?1",
                            super::rows::VERSION_COLS
                        ))?;
                        let mut found = statement.query([&rec.id])?;
                        while let Some(row) = found.next()? {
                            let version = VersionRow::from_row(row, 0)?;
                            if rec.version(&space, key, version).is_err() {
                                opens = false;
                                break;
                            }
                        }
                    }
                    if !opens {
                        push_listed(&mut check.seal_invalid, &rec.id);
                    }
                }
                Ok(())
            })?;
            Ok(check)
        })
    }

    /// The doctor's maintenance read (section 8.8): how many records are past their purge date
    /// at `now` by `retention`, and when the last purge was. Reads no key.
    ///
    /// # Errors
    /// `NotProvisioned` before the first write; `Busy` or `Io`.
    pub fn maintenance(
        &self,
        now: Millis,
        retention: Retention,
    ) -> Result<MemoryMaintenance, StoreError> {
        self.pool.read(|conn| {
            let due = due(now, retention);
            let past: i64 = conn.query_row(
                &format!("SELECT COUNT(*) FROM ({})", due.text),
                params_from_iter(due.params.iter()),
                |row| row.get(0),
            )?;
            let last: Option<Millis> = conn.query_row(
                "SELECT MAX(at) FROM changes WHERE kind = 'purged'",
                [],
                |row| row.get(0),
            )?;
            Ok(MemoryMaintenance {
                past_purge: to_u64(past)?,
                last_purge: last,
            })
        })
    }

    /// The trace ids of the changes after `after`, ascending, at most `limit`, with their
    /// revision and time: what `store-check`'s journal cross-check (D66) compares. Ids and times
    /// only, never text, and for the deployer's own check: no reader filter applies.
    ///
    /// # Errors
    /// `NotProvisioned` before the first write; `Busy` or `Io`.
    pub fn change_traces(
        &self,
        after: u64,
        limit: u32,
    ) -> Result<Vec<(u64, Option<String>, Millis)>, StoreError> {
        self.pool.read(|conn| {
            let mut statement = conn.prepare(
                "SELECT rev, trace_id, at FROM changes WHERE rev > ?1 ORDER BY rev LIMIT ?2",
            )?;
            let rows = statement.query_map(
                rusqlite::params![i64::try_from(after).unwrap_or(i64::MAX), i64::from(limit)],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Millis>(2)?,
                    ))
                },
            )?;
            let mut found = Vec::new();
            for row in rows {
                let (rev, trace, at) = row?;
                found.push((to_u64(rev)?, trace, at));
            }
            Ok(found)
        })
    }
}

impl SqliteMemoryStore {
    /// `PRAGMA integrity_check` on the key file alone, for the doctor's `stores.memory_keys`;
    /// empty when it says ok.
    ///
    /// # Errors
    /// `NotProvisioned`, `KeysMissing`, `KeysMismatch`, `Busy` or `Io`.
    pub fn keys_integrity_check(&self) -> Result<Vec<String>, StoreError> {
        self.pool.read(|_| Ok(()))?;
        self.pool.keys(|kc| integrity(kc)).map_err(StoreError::from)
    }
}

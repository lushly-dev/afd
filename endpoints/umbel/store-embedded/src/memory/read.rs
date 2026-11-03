//! The memory store's reads (phase 3 section 5.2). Each filters by the reader inside its own
//! statement, before ordering and limits, and never writes or waits on a write lock.

use rusqlite::{Connection, params_from_iter};
use umbel_store::memory::{
    AsOf, ClassCounts, LeftOut, MAX_MEMORY_CHANGES_LIMIT, MAX_MEMORY_LIST_LIMIT, MAX_RECALL_LIMIT,
    MemoryChange, MemoryCounts, MemoryCursor, MemoryList, MemoryPage, MemoryUsage, RecallHit,
    RecallPage, RecallQuery, check_limit, refuse_derivation,
};
use umbel_store::{
    MemoryClass, MemoryRecord, Millis, PushFilter, ReadFlags, ReaderFilter, Rev, ScopeQuery,
    StoreError,
};

use super::SqliteMemoryStore;
use super::keys::{self, Keys};
use super::rows::{
    RECORD_COLS, RECORD_WIDTH, RecordRow, VERSION_COLS, VersionRow, parse_change_kind,
};
use crate::error::{Fail, to_i64, to_u64};
use crate::sql::Sql;

/// The `SELECT ... FROM records r JOIN versions v` every record read starts from.
fn select_records() -> Sql {
    Sql::new(&format!(
        "SELECT {RECORD_COLS}, {VERSION_COLS} FROM records r JOIN versions v ON v.id = r.id WHERE 1"
    ))
}

fn rows(conn: &Connection, sql: &Sql) -> Result<Vec<(RecordRow, VersionRow)>, Fail> {
    let mut stmt = conn.prepare(&sql.text)?;
    let mut out = Vec::new();
    let mut found = stmt.query(params_from_iter(sql.params.iter()))?;
    while let Some(row) = found.next()? {
        out.push((
            RecordRow::from_row(row, 0)?,
            VersionRow::from_row(row, RECORD_WIDTH)?,
        ));
    }
    Ok(out)
}

/// The key entries of the rows' records, in one `SELECT` on the key file.
fn keys_of<'a>(kc: &Connection, rows: impl Iterator<Item = &'a RecordRow>) -> Result<Keys, Fail> {
    let mut ids: Vec<&str> = rows.map(|r| r.id.as_str()).collect();
    ids.sort_unstable();
    ids.dedup();
    keys::lookup(kc, &ids)
}

/// Whether a failure is a body that does not open, which a list or recall counts and skips.
fn unopenable(fail: &Fail) -> bool {
    matches!(
        fail,
        Fail::Store(StoreError::SealInvalid { .. } | StoreError::KeyAbsent { .. })
    )
}

impl SqliteMemoryStore {
    pub(super) fn read_get(
        &self,
        id: &str,
        as_of: AsOf,
        flags: ReadFlags,
        reader: &ReaderFilter,
    ) -> Result<Option<MemoryRecord>, StoreError> {
        refuse_derivation(reader)?;
        self.pool.read(|conn| {
            self.pool.keys(|kc| {
                let tx = conn.transaction()?;
                let mut sql = select_records();
                sql.push(" AND r.id = ").bind(id);
                sql.and_memory_readable(reader)
                    .and_as_of(as_of)
                    .and_flags(flags);
                let Some((rec, v)) = rows(&tx, &sql)?.into_iter().next() else {
                    return Ok(None);
                };
                let keys = keys_of(kc, std::iter::once(&rec))?;
                // A destroyed marker: forgotten, whether or not its rows are gone yet.
                if keys.destroyed(&rec.id).is_some() {
                    return Ok(None);
                }
                let key = keys.require(&rec.id)?;
                let version = rec.version(&self.space, key, v)?;
                Ok(Some(rec.record(&tx, &self.space, key, version)?))
            })
        })
    }

    pub(super) fn read_history(
        &self,
        id: &str,
        reader: &ReaderFilter,
    ) -> Result<Vec<MemoryRecord>, StoreError> {
        refuse_derivation(reader)?;
        self.pool.read(|conn| {
            self.pool.keys(|kc| {
                let tx = conn.transaction()?;
                let mut sql = select_records();
                sql.push(" AND r.id = ").bind(id);
                sql.and_memory_readable(reader)
                    .push(" ORDER BY v.record_version");
                let found = rows(&tx, &sql)?;
                let keys = keys_of(kc, found.iter().map(|(r, _)| r))?;
                let mut out = Vec::new();
                for (rec, v) in found {
                    if keys.destroyed(&rec.id).is_some() {
                        return Ok(Vec::new());
                    }
                    let key = keys.require(&rec.id)?;
                    let version = rec.version(&self.space, key, v)?;
                    out.push(rec.record(&tx, &self.space, key, version)?);
                }
                Ok(out)
            })
        })
    }

    pub(super) fn read_list(
        &self,
        query: &MemoryList,
        reader: &ReaderFilter,
    ) -> Result<MemoryPage, StoreError> {
        refuse_derivation(reader)?;
        check_limit("list", query.limit, MAX_MEMORY_LIST_LIMIT)?;
        self.pool.read(|conn| {
            self.pool.keys(|kc| {
                let mut sql = select_records();
                sql.and_memory_readable(reader)
                    .and_as_of(query.as_of)
                    .and_flags(query.flags)
                    .and_scope(&query.scope)
                    .and_classes(&query.classes)
                    .and_tags(&query.tags)
                    .and_authorities(&query.authorities);
                if let Some(push) = &query.push {
                    sql.and_push(push, &query.scope.project);
                }
                if let Some(after) = &query.after {
                    sql.push(" AND (v.recorded_at < ")
                        .bind(after.recorded_at)
                        .push(" OR (v.recorded_at = ")
                        .bind(after.recorded_at)
                        .push(" AND r.id > ")
                        .bind(&after.id)
                        .push("))");
                }
                sql.push(" ORDER BY v.recorded_at DESC, r.id LIMIT ")
                    .bind(i64::from(query.limit) + 1);
                let mut items = Vec::new();
                let mut unreadable = 0;
                let mut more = false;
                let found = rows(conn, &sql)?;
                let keys = keys_of(kc, found.iter().map(|(r, _)| r))?;
                for (rec, v) in found {
                    if items.len() == query.limit as usize {
                        more = true;
                        break;
                    }
                    // A destroyed marker: forgotten, so neither listed nor counted.
                    if keys.destroyed(&rec.id).is_some() {
                        continue;
                    }
                    match keys
                        .require(&rec.id)
                        .and_then(|key| rec.meta(&self.space, key, &v))
                    {
                        Ok(meta) => items.push(meta),
                        Err(fail) if unopenable(&fail) => unreadable += 1,
                        Err(fail) => return Err(fail),
                    }
                }
                let next = if more {
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
            })
        })
    }

    pub(super) fn read_recall(
        &self,
        query: &RecallQuery,
        reader: &ReaderFilter,
    ) -> Result<RecallPage, StoreError> {
        refuse_derivation(reader)?;
        check_limit("recall", query.limit, MAX_RECALL_LIMIT)?;
        self.pool.read(|conn| {
            self.pool.keys(|kc| {
                let tx = conn.transaction()?;
                // One statement: the match, the reader, the intervals, expiry, flags, scope and every
                // filter, before ranking and the limit (section 5.3). The query text was parsed by
                // `MemoryQuery::parse`; `fts5()` double-quotes every term.
                let mut sql = Sql::new(&format!(
                    "SELECT {RECORD_COLS}, {VERSION_COLS}, \
                 snippet(records_fts, 2, '**', '**', '…', 32) \
                 FROM records_fts JOIN records r ON r.rowid = records_fts.rowid \
                 JOIN versions v ON v.id = r.id \
                 WHERE records_fts MATCH "
                ));
                sql.bind(query.query.fts5()).push(" AND r.indexed = 1");
                sql.and_memory_readable(reader)
                    .and_as_of(query.as_of)
                    .and_flags(query.flags)
                    .and_scope(&query.scope)
                    .and_classes(&query.classes)
                    .and_tags(&query.tags)
                    .and_authorities(&query.authorities);
                if let Some(push) = &query.push {
                    sql.and_push(push, &query.scope.project);
                }
                sql.push(
                " ORDER BY round(bm25(records_fts, 3.0, 2.0, 1.0), 4), v.recorded_at DESC, r.id \
                 LIMIT ",
            )
            .bind(i64::from(query.limit));
                let found = {
                    let mut stmt = tx.prepare(&sql.text)?;
                    let mut found = Vec::new();
                    let mut cursor = stmt.query(params_from_iter(sql.params.iter()))?;
                    while let Some(row) = cursor.next()? {
                        found.push((
                            RecordRow::from_row(row, 0)?,
                            VersionRow::from_row(row, RECORD_WIDTH)?,
                            row.get::<_, String>(RECORD_WIDTH + 12)?,
                        ));
                    }
                    found
                };
                let mut hits = Vec::new();
                let mut unreadable = 0;
                let keys = keys_of(kc, found.iter().map(|(r, _, _)| r))?;
                for (rec, v, snippet) in found {
                    // A destroyed marker: forgotten. Its index row may still match until the
                    // roll-forward removes it; the snippet is never served.
                    if keys.destroyed(&rec.id).is_some() {
                        continue;
                    }
                    let opened = keys.require(&rec.id).and_then(|key| {
                        rec.version(&self.space, key, v)
                            .and_then(|version| rec.record(&tx, &self.space, key, version))
                    });
                    match opened {
                        Ok(record) => hits.push(RecallHit {
                            rank: u32::try_from(hits.len() + 1).unwrap_or(u32::MAX),
                            record,
                            snippet,
                        }),
                        Err(fail) if unopenable(&fail) => unreadable += 1,
                        Err(fail) => return Err(fail),
                    }
                }
                // Readable records in scope that are not indexed can never match: count them too.
                let mut missing = Sql::new(
                    "SELECT COUNT(*) FROM records r JOIN versions v ON v.id = r.id \
                 WHERE r.indexed = 0",
                );
                missing
                    .and_memory_readable(reader)
                    .and_as_of(query.as_of)
                    .and_flags(query.flags)
                    .and_scope(&query.scope)
                    .and_classes(&query.classes);
                let missing: i64 = tx.query_row(
                    &missing.text,
                    params_from_iter(missing.params.iter()),
                    |r| r.get(0),
                )?;
                Ok(RecallPage {
                    hits,
                    unreadable: unreadable + to_u64(missing)?,
                })
            })
        })
    }

    pub(super) fn read_left_out(
        &self,
        scope: &ScopeQuery,
        classes: &[MemoryClass],
        push: &PushFilter,
        as_of: AsOf,
        now: Millis,
        reader: &ReaderFilter,
    ) -> Result<LeftOut, StoreError> {
        refuse_derivation(reader)?;
        let classes = if classes.is_empty() {
            &MemoryClass::ALL[..]
        } else {
            classes
        };
        self.pool.read(|conn| {
            let mut sql = Sql::new(
                "SELECT r.class, r.flagged, r.owner, v.authority, r.project \
                 FROM records r JOIN versions v ON v.id = r.id WHERE r.expires > ",
            );
            sql.bind(now);
            sql.and_memory_readable(reader)
                .and_as_of(as_of)
                .and_scope(scope)
                .and_classes(classes);
            let mut out = LeftOut::default();
            for class in classes {
                out.by_class.insert(*class, Default::default());
            }
            let mut stmt = conn.prepare(&sql.text)?;
            let mut found = stmt.query(params_from_iter(sql.params.iter()))?;
            while let Some(row) = found.next()? {
                let class = MemoryClass::parse(&row.get::<_, String>(0)?)
                    .ok_or_else(|| StoreError::Corrupt("a stored class".to_owned()))?;
                let flagged = row.get::<_, i64>(1)? != 0;
                let owner: String = row.get(2)?;
                let authority = umbel_store::Authority::parse(&row.get::<_, String>(3)?)
                    .ok_or_else(|| StoreError::Corrupt("a stored authority".to_owned()))?;
                let project: Option<String> = row.get(4)?;
                let counts = out.by_class.entry(class).or_default();
                if flagged {
                    counts.flagged += 1;
                } else if !push.admits(&owner, authority, project.as_deref(), &scope.project, false)
                {
                    counts.authority += 1;
                }
            }
            Ok(out)
        })
    }

    pub(super) fn read_changes(
        &self,
        after: Rev,
        limit: u32,
        reader: &ReaderFilter,
        trace: Option<&str>,
    ) -> Result<Vec<MemoryChange>, StoreError> {
        refuse_derivation(reader)?;
        check_limit("changes", limit, MAX_MEMORY_CHANGES_LIMIT)?;
        let after = to_i64(after)?;
        self.pool.read(|conn| {
            let mut sql = Sql::new(
                "SELECT c.rev, c.kind, c.id, c.record_version, c.trace_id, c.at \
                 FROM changes c WHERE c.rev > ",
            );
            sql.bind(after);
            sql.and_readable("change_access", &[("rev", "c.rev")], reader);
            if let Some(trace) = trace {
                sql.push(" AND c.trace_id = ").bind(trace);
            }
            sql.push(" ORDER BY c.rev LIMIT ").bind(i64::from(limit));
            let mut stmt = conn.prepare(&sql.text)?;
            let mut found = stmt.query(params_from_iter(sql.params.iter()))?;
            let mut out = Vec::new();
            while let Some(row) = found.next()? {
                out.push(MemoryChange {
                    rev: to_u64(row.get(0)?)?,
                    kind: parse_change_kind(&row.get::<_, String>(1)?)?,
                    id: row.get(2)?,
                    record_version: row.get(3)?,
                    trace_id: row.get(4)?,
                    at: row.get(5)?,
                });
            }
            Ok(out)
        })
    }

    pub(super) fn read_head(&self) -> Result<Rev, StoreError> {
        self.pool.read(|conn| {
            let head: i64 =
                conn.query_row("SELECT COALESCE(MAX(rev), 0) FROM changes", [], |r| {
                    r.get(0)
                })?;
            Ok(to_u64(head)?)
        })
    }

    pub(super) fn read_usage(
        &self,
        owner: &str,
        agent: Option<&str>,
        since: Millis,
    ) -> Result<MemoryUsage, StoreError> {
        self.pool.read(|conn| usage(conn, owner, agent, since))
    }

    pub(super) fn read_counts(
        &self,
        now: Millis,
        expiring_within_ms: Millis,
        reader: &ReaderFilter,
    ) -> Result<MemoryCounts, StoreError> {
        refuse_derivation(reader)?;
        self.pool.read(|conn| {
            let mut sql = Sql::new(
                "SELECT r.class, r.flagged, r.expires, r.indexed, v.valid_from, v.valid_until \
                 FROM records r JOIN versions v ON v.id = r.id \
                 WHERE v.recorded_until IS NULL",
            );
            sql.and_memory_readable(reader);
            let mut out = MemoryCounts::default();
            let mut stmt = conn.prepare(&sql.text)?;
            let mut found = stmt.query(params_from_iter(sql.params.iter()))?;
            while let Some(row) = found.next()? {
                if row.get::<_, i64>(3)? == 0 {
                    out.unreadable += 1;
                    continue;
                }
                let class = MemoryClass::parse(&row.get::<_, String>(0)?)
                    .ok_or_else(|| StoreError::Corrupt("a stored class".to_owned()))?;
                let flagged = row.get::<_, i64>(1)? != 0;
                let expires: Millis = row.get(2)?;
                let valid_from: Millis = row.get(4)?;
                let valid_until: Option<Millis> = row.get(5)?;
                let c: &mut ClassCounts = out.by_class.entry(class).or_default();
                if expires <= now {
                    c.expired += 1;
                } else if valid_until.is_some_and(|u| u <= now) {
                    c.invalidated += 1;
                } else if valid_from > now {
                    c.not_yet_valid += 1;
                } else {
                    if flagged {
                        c.flagged += 1;
                    } else {
                        c.live += 1;
                    }
                    if expires <= now.saturating_add(expiring_within_ms) {
                        c.expiring_soon += 1;
                    }
                }
            }
            Ok(out)
        })
    }
}

/// The owner's stored records and bytes, and the writes and bytes of `(owner, agent)` at or after
/// `since`: created and observed changes.
pub(super) fn usage(
    conn: &Connection,
    owner: &str,
    agent: Option<&str>,
    since: Millis,
) -> Result<MemoryUsage, Fail> {
    let (records, bytes): (i64, i64) = conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(stored_bytes), 0) FROM records WHERE owner = ?1",
        [owner],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let (writes, written): (i64, i64) = conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(bytes), 0) FROM changes \
         WHERE owner = ?1 AND agent IS ?2 AND at >= ?3 AND kind IN ('created', 'observed')",
        rusqlite::params![owner, agent, since],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    Ok(MemoryUsage {
        stored_records: to_u64(records)?,
        stored_bytes: to_u64(bytes)?,
        writes: to_u64(writes)?,
        bytes: to_u64(written)?,
    })
}

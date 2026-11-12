//! The record lane over SQLite (records host specification, sections 4.2, 5, 7 and 12.1; D163):
//! a declared kind's records indexed in the same database, in the same transaction as their
//! `records` row. The lane is ordinary tables: a term table with frequencies, a key table and
//! one row per record.
//!
//! Every read names `record_lane l` and carries the reader filter as a clause of its statement
//! (section 5.3), so a total, a candidate and a cursor never count a record the reader may not
//! read. A derivation reader is refused: the lane is never read without a reader, except by the
//! rebuild and the status, which return counts and no record.

mod find;
mod rank;
mod reindex;
mod standing;
mod status;
mod write;

use rusqlite::{Connection, OptionalExtension, Row, params};
use umbel_store::lane::{LaneRecord, LaneState, RecordDecl};
use umbel_store::{MemoryFlag, ReaderFilter, StoreError};

use crate::documents::record_from_row;
use crate::error::{Fail, to_i64};
use crate::sql::Sql;

/// The columns every read of a lane record selects, over `record_lane l` joined to `records r`.
const RECORD_COLUMNS: &str = "r.ns, r.kind, r.id, r.rev, r.content_hash, r.body, r.envelope, \
     l.lane, l.created_rev, l.created_at, l.flags";

/// `FROM record_lane l JOIN records r` and the kind's two columns, which every read begins with.
const FROM_LANE: &str = " FROM record_lane l JOIN records r ON r.ns = l.ns AND r.kind = l.kind \
     AND r.id = l.id WHERE l.ns = ";

/// The access table's key columns against `record_lane l` (section 5.3).
const LANE_ACCESS: &[(&str, &str)] = &[("ns", "l.ns"), ("kind", "l.kind"), ("id", "l.id")];

/// The most lanes one statement names in a list.
const LANE_BATCH: usize = 500;

/// Refuse a derivation reader, as memory does: the lane is never read without a reader.
fn refuse_derivation(reader: &ReaderFilter) -> Result<(), StoreError> {
    if reader.is_derivation() {
        Err(StoreError::invalid(
            "the record lane refuses a derivation read",
        ))
    } else {
        Ok(())
    }
}

/// A kind's declaration row.
struct KindRow {
    decl_hash: String,
    decl: String,
    stale: bool,
}

fn kind_row(conn: &Connection, ns: &str, kind: &str) -> Result<Option<KindRow>, Fail> {
    Ok(conn
        .query_row(
            "SELECT decl_hash, decl, stale FROM record_kinds WHERE ns = ?1 AND kind = ?2",
            params![ns, kind],
            |row| {
                Ok(KindRow {
                    decl_hash: row.get(0)?,
                    decl: row.get(1)?,
                    stale: row.get::<_, i64>(2)? != 0,
                })
            },
        )
        .optional()?)
}

fn any_record(conn: &Connection, ns: &str, kind: &str) -> Result<bool, Fail> {
    Ok(conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM records WHERE ns = ?1 AND kind = ?2)",
        params![ns, kind],
        |row| row.get(0),
    )?)
}

/// Whether the kind's lane is `decl`'s (section 2): stale when the stored hash differs from the
/// declaration's, when the mark is set (a record was written while the kind was undeclared, or a
/// rebuild is under way), or when the kind holds records and no declaration row, which are
/// records written before it was declared.
fn lane_state(conn: &Connection, ns: &str, decl: &RecordDecl) -> Result<LaneState, Fail> {
    let ready = match kind_row(conn, ns, &decl.kind)? {
        Some(row) => !row.stale && row.decl_hash == decl.hash().as_str(),
        None => !any_record(conn, ns, &decl.kind)?,
    };
    Ok(if ready {
        LaneState::Ready
    } else {
        LaneState::Stale
    })
}

/// Every lane service on a stale kind answers `LaneStale`.
fn require_ready(conn: &Connection, ns: &str, decl: &RecordDecl) -> Result<(), Fail> {
    match lane_state(conn, ns, decl)? {
        LaneState::Ready => Ok(()),
        LaneState::Stale => Err(StoreError::LaneStale.into()),
    }
}

/// The scan's findings as a lane row stores them: a JSON array of their wire spellings.
fn flags_text(flags: &[MemoryFlag]) -> String {
    let mut names: Vec<&str> = flags.iter().map(|flag| flag.as_str()).collect();
    names.sort_unstable();
    names.dedup();
    serde_json::Value::from(names).to_string()
}

fn flags_from(text: &str) -> Result<Vec<MemoryFlag>, Fail> {
    let names: Vec<String> = crate::documents::parse_json(text)?;
    names
        .iter()
        .map(|name| {
            MemoryFlag::parse(name).ok_or_else(|| {
                StoreError::Corrupt(format!("a lane row holds the unknown finding `{name}`")).into()
            })
        })
        .collect()
}

/// One row of [`RECORD_COLUMNS`] as the lane record a service returns, with its lane number.
fn lane_record_from_row(row: &Row<'_>, decl: &RecordDecl) -> Result<(i64, LaneRecord), Fail> {
    Ok((
        row.get(7)?,
        LaneRecord {
            record: record_from_row(row)?,
            created_at: row.get(9)?,
            flags: flags_from(&row.get::<_, String>(10)?)?,
            label: standing::label(decl),
        },
    ))
}

/// A position of a declaration's list as SQLite's integer.
fn position(index: u8) -> i64 {
    i64::from(index)
}

/// A count as SQLite's integer, for a `LIMIT`.
fn limit_of(value: u64) -> Result<i64, StoreError> {
    to_i64(value)
}

/// ` AND <the record passes the key filters>`: one `EXISTS` over `record_keys` a filter.
fn and_keys(sql: &mut Sql, keys: &[(u8, Vec<String>)]) {
    for (key, any) in keys {
        sql.push(" AND EXISTS (SELECT 1 FROM record_keys k WHERE k.lane = l.lane AND k.key = ")
            .bind(position(*key))
            .push(" AND k.value IN ")
            .bind_list(any.iter())
            .push(")");
    }
}

/// ` AND <the reader may read the record> <the view admits it>` over `record_lane l`.
fn and_visible(
    sql: &mut Sql,
    decl: &RecordDecl,
    view: &umbel_store::lane::StandingView,
    reader: &ReaderFilter,
) {
    sql.and_readable("record_access", LANE_ACCESS, reader);
    standing::and_admitted(sql, decl, view);
}

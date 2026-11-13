//! `reindex_records`: one kind's lane rebuilt from its `records` rows (records host
//! specification, section 12.1), in chunks, so the write lock is never held for a whole kind.
//!
//! A kind being rebuilt is offline, and everything else in the store is not. A rebuild that
//! stops part-way leaves the kind stale, and running it again finishes it: each chunk is whole,
//! and rewriting a record's lane rows twice gives the same rows.
//!
//! **A rebuild writes only while the kind's generation is the one it raised.** Each chunk's
//! transaction reads the generation first and the rebuild stops when it has moved: an undeclared
//! put, or another rebuild, came after it. So of two rebuilds at once, under one declaration or
//! two, the one that started last writes every row and the other writes none after it began.
//!
//! **Another writer gets a turn between chunks.** A writer that found the store locked waits in
//! SQLite's busy handler, which sleeps for up to 100 ms between tries. A rebuild that took the
//! lock again as soon as it released it would win every time, and the writer would wait the
//! whole rebuild out. So the rebuild waits [`CHUNK_PAUSE`] between chunks, longer than the
//! handler's longest sleep.

use std::collections::BTreeMap;
use std::time::Duration;

use rusqlite::{OptionalExtension, TransactionBehavior, params};
use serde_json::Value as Json;
use umbel_store::lane::{RecordDecl, ReindexReport, extract};
use umbel_store::{Embedder, Envelope, MemoryFlag, Rev, StoreError, canonical_json, record_target};

use super::flags_text;
use super::write::{
    LaneValues, add_postings, clear_standing, insert_lane, lane_row, update_lane, write_keys,
    write_terms,
};
use crate::SqliteStore;
use crate::documents::parse_json;
use crate::error::to_u64;

/// How long a rebuild leaves the write lock free between two chunks: longer than the longest
/// sleep of SQLite's busy handler (100 ms), so a writer waiting in it wakes while the lock is
/// free.
pub(crate) const CHUNK_PAUSE: Duration = Duration::from_millis(120);

/// One chunk's records: after the id `?3` (none: from the kind's first), by id, at most `?4`.
/// The comparison is one range over the primary key `(ns, kind, id)`, so a chunk reads its own
/// rows and never the ones before them: an id is at least one byte, so every id is after `''`.
const CHUNK_SQL: &str = "SELECT id, rev, body, envelope FROM records
     WHERE ns = ?1 AND kind = ?2 AND id > COALESCE(?3, '') ORDER BY id LIMIT ?4";

/// What a rebuild counted.
#[derive(Default)]
struct Counts {
    records: u64,
    unindexed: u64,
    wordings_changed: u64,
}

/// What one chunk's transaction did.
enum Chunk {
    /// It wrote a full chunk, ending at this id: the kind may hold more.
    More(String),
    /// It wrote the kind's last records.
    Last,
    /// The generation is not this rebuild's: it wrote nothing, and the rebuild stops.
    Superseded,
}

impl SqliteStore {
    /// Step 1.1: one short transaction sets the kind's stale mark and adds one to its
    /// generation, inserting its row if there is none, and answers the generation it wrote.
    fn begin_rebuild(&self, ns: &str, decl: &RecordDecl) -> Result<i64, StoreError> {
        let hash = decl.hash();
        let stored = canonical_json(&decl.to_json());
        self.pool().with(|conn| {
            let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let generation: i64 = tx.query_row(
                "INSERT INTO record_kinds (ns, kind, decl_hash, decl, stale, generation) VALUES (?1, ?2, ?3, ?4, 1, 1)
                 ON CONFLICT (ns, kind) DO UPDATE SET stale = 1, generation = generation + 1
                 RETURNING generation",
                params![ns, decl.kind, hash.as_str(), stored],
                |row| row.get(0),
            )?;
            tx.commit()?;
            Ok(generation)
        })
    }

    /// Step 1.2: one read, outside any write transaction. For the records of the kind that have
    /// no lane row, their first revision and its time, by one grouped scan of `changes`, which
    /// has no index on `target`: one pass over the log and never a lookup a record.
    fn first_puts(
        &self,
        ns: &str,
        kind: &str,
    ) -> Result<BTreeMap<String, (Rev, String)>, StoreError> {
        let prefix = record_target(ns, kind, "");
        self.pool().with(|conn| {
            let missing: bool = conn.query_row(
                "SELECT EXISTS (SELECT 1 FROM records r WHERE r.ns = ?1 AND r.kind = ?2 AND NOT EXISTS
                   (SELECT 1 FROM record_lane l WHERE l.ns = r.ns AND l.kind = r.kind AND l.id = r.id))",
                params![ns, kind],
                |row| row.get(0),
            )?;
            let mut first = BTreeMap::new();
            if !missing {
                return Ok(first);
            }
            let mut statement = conn.prepare(
                "SELECT target, MIN(rev), at FROM changes WHERE kind = 'record' GROUP BY target",
            )?;
            let mut rows = statement.query([])?;
            while let Some(row) = rows.next()? {
                let target: String = row.get(0)?;
                // Kept for the kind's targets.
                if let Some(id) = target.strip_prefix(&prefix) {
                    first.insert(id.to_owned(), (to_u64(row.get(1)?)?, row.get(2)?));
                }
            }
            Ok(first)
        })
    }

    /// Step 1.3, one chunk, in one transaction. It reads the kind's generation first and writes
    /// nothing unless it is `generation`, this rebuild's own. Then the kind's `records` rows
    /// after `after`, by id, at most `chunk` of them, each extracted and written with its lane
    /// row, terms and keys.
    #[allow(clippy::too_many_arguments)]
    fn rebuild_chunk(
        &self,
        ns: &str,
        decl: &RecordDecl,
        scan: &dyn Fn(&str) -> Vec<MemoryFlag>,
        first: &BTreeMap<String, (Rev, String)>,
        generation: i64,
        after: Option<&str>,
        index: usize,
        counts: &mut Counts,
    ) -> Result<Chunk, StoreError> {
        let kind = decl.kind.as_str();
        let chunk = self.lane_limits().reindex_chunk.max(1);
        self.pool().with(|conn| {
            let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let current: Option<i64> = tx
                .query_row(
                    "SELECT generation FROM record_kinds WHERE ns = ?1 AND kind = ?2",
                    params![ns, kind],
                    |row| row.get(0),
                )
                .optional()?;
            if current != Some(generation) {
                // An undeclared put or another rebuild came after this one began. What it
                // wrote, or will write, is not this rebuild's to overwrite.
                return Ok(Chunk::Superseded);
            }
            #[cfg(feature = "testkit")]
            self.at_rebuild_point(crate::RebuildPoint::InChunk(index));
            #[cfg(not(feature = "testkit"))]
            let _ = index;
            let rows: Vec<(String, i64, String, String)> = {
                let mut select = tx.prepare_cached(CHUNK_SQL)?;
                select
                    .query_map(params![ns, kind, after, chunk as i64], |row| {
                        Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
                    })?
                    .collect::<Result<_, _>>()?
            };
            // The chunk's counts join the rebuild's only when the chunk commits.
            let mut chunk_counts = Counts::default();
            for (id, rev, body, envelope) in &rows {
                chunk_counts.records += 1;
                let body: Json = parse_json(body)?;
                let row = lane_row(&tx, ns, kind, id)?;
                let Ok(found) = extract(decl, &body) else {
                    // A body the declaration refuses is left without lane rows.
                    if let Some(row) = row {
                        // Its terms go with it, by cascade, and out of the kind's count.
                        let held: i64 = tx.query_row(
                            "SELECT COUNT(*) FROM record_terms WHERE lane = ?1",
                            [row.lane],
                            |r| r.get(0),
                        )?;
                        tx.execute("DELETE FROM record_lane WHERE lane = ?1", [row.lane])?;
                        add_postings(&tx, ns, kind, -held)?;
                    }
                    chunk_counts.unindexed += 1;
                    continue;
                };
                let mut flags: Vec<MemoryFlag> = found
                    .texts
                    .iter()
                    .flatten()
                    .flat_map(|text| scan(text))
                    .collect();
                flags.sort();
                flags.dedup();
                let flags = flags_text(&flags);
                let values = LaneValues::of(&found);
                let lane = match row {
                    Some(row) => {
                        update_lane(&tx, row.lane, &values, &flags)?;
                        if row.wording_hash.as_deref() != values.wording {
                            // What stood on the old wording goes with it, whatever the kind is
                            // declared as now: a wording edited while the kind was undeclared
                            // must not carry an affirmation into a later standing declaration.
                            clear_standing(&tx, row.lane)?;
                            tx.execute("DELETE FROM record_vectors WHERE lane = ?1", [row.lane])?;
                            chunk_counts.wordings_changed += 1;
                        } else if row.match_digest.as_deref() != values.digest {
                            // A vector is of the match value it was embedded for.
                            tx.execute("DELETE FROM record_vectors WHERE lane = ?1", [row.lane])?;
                        }
                        row.lane
                    }
                    None => {
                        let (created_rev, created_at) = match first.get(id) {
                            Some((rev, at)) => (*rev, at.clone()),
                            None => {
                                let envelope: Envelope = parse_json(envelope)?;
                                (to_u64(*rev)?, envelope.observed_at)
                            }
                        };
                        insert_lane(&tx, ns, kind, id, created_rev, &created_at, &values, &flags)?
                    }
                };
                write_terms(&tx, ns, kind, lane, &found)?;
                write_keys(&tx, ns, kind, lane, &found)?;
            }
            tx.commit()?;
            counts.records += chunk_counts.records;
            counts.unindexed += chunk_counts.unindexed;
            counts.wordings_changed += chunk_counts.wordings_changed;
            Ok(match rows.last() {
                Some((id, ..)) if rows.len() == chunk => Chunk::More(id.clone()),
                _ => Chunk::Last,
            })
        })
    }

    /// Step 1.4: one short transaction reads the generation. Only if it is still `generation`
    /// does it write the declaration to the kind's row, clear the stale mark and set the kind's
    /// count of postings from its rows; whether it did.
    fn end_rebuild(
        &self,
        ns: &str,
        decl: &RecordDecl,
        generation: i64,
    ) -> Result<bool, StoreError> {
        let hash = decl.hash();
        let stored = canonical_json(&decl.to_json());
        self.pool().with(|conn| {
            let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let cleared = tx.execute(
                "UPDATE record_kinds SET decl_hash = ?3, decl = ?4, stale = 0
                 WHERE ns = ?1 AND kind = ?2 AND generation = ?5",
                params![ns, decl.kind, hash.as_str(), stored, generation],
            )?;
            if cleared == 1 {
                // The rebuild that clears the mark also sets the kind's count of postings from
                // its rows, once, so a count that drifted (a `records` row deleted by a statement
                // that does not keep it, as an erasure would) is repaired by a rebuild.
                tx.execute(
                    "INSERT INTO record_postings (ns, kind, postings)
                     VALUES (?1, ?2, (SELECT COUNT(*) FROM record_terms WHERE ns = ?1 AND kind = ?2))
                     ON CONFLICT (ns, kind) DO UPDATE SET postings = excluded.postings",
                    params![ns, decl.kind],
                )?;
            }
            tx.commit()?;
            Ok(cleared == 1)
        })
    }

    pub(crate) fn lane_reindex(
        &self,
        ns: &str,
        decl: &RecordDecl,
        scan: &dyn Fn(&str) -> Vec<MemoryFlag>,
        _embedder: Option<&dyn Embedder>,
        vectors_only: bool,
    ) -> Result<ReindexReport, StoreError> {
        decl.check()?;
        if vectors_only {
            // The rebuild is skipped, and the vectors are the specification's step B5.
            let status = self.lane_state_of(ns, decl)?;
            return Ok(ReindexReport {
                records: status.records,
                unindexed: status.unindexed,
                wordings_changed: 0,
                superseded: false,
                vectors_written: 0,
                vectors_removed: 0,
            });
        }
        let generation = self.begin_rebuild(ns, decl)?;
        let first = self.first_puts(ns, &decl.kind)?;
        let mut counts = Counts::default();
        let mut after: Option<String> = None;
        let mut superseded = false;
        for index in 0.. {
            let done = self.rebuild_chunk(
                ns,
                decl,
                scan,
                &first,
                generation,
                after.as_deref(),
                index,
                &mut counts,
            )?;
            match done {
                Chunk::More(last) => {
                    after = Some(last);
                    #[cfg(feature = "testkit")]
                    self.at_rebuild_point(crate::RebuildPoint::AfterChunk(index));
                    // The write lock is free here: a writer waiting on it gets its turn.
                    std::thread::sleep(CHUNK_PAUSE);
                }
                Chunk::Last => break,
                Chunk::Superseded => {
                    superseded = true;
                    break;
                }
            }
        }
        let cleared = !superseded && self.end_rebuild(ns, decl, generation)?;
        Ok(ReindexReport {
            records: counts.records,
            unindexed: counts.unindexed,
            wordings_changed: counts.wordings_changed,
            superseded: !cleared,
            vectors_written: 0,
            vectors_removed: 0,
        })
    }
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::CHUNK_SQL;
    use crate::schema::{LANE_SCHEMA, SCHEMA};

    #[test]
    fn a_chunk_is_one_range_over_the_primary_key() {
        let conn = Connection::open_in_memory().expect("a database");
        conn.execute_batch(SCHEMA).expect("the schema");
        conn.execute_batch(LANE_SCHEMA).expect("the lane's schema");
        for after in [None, Some("n-0500")] {
            let plan: Vec<String> = conn
                .prepare(&format!("EXPLAIN QUERY PLAN {CHUNK_SQL}"))
                .expect("prepare")
                .query_map(rusqlite::params!["notes", "note", after, 1000], |row| {
                    row.get(3)
                })
                .expect("query")
                .collect::<Result<_, _>>()
                .expect("rows");
            assert_eq!(plan.len(), 1, "one step, with no sort: {plan:?}");
            assert!(
                plan[0].contains("SEARCH records USING PRIMARY KEY (ns=? AND kind=? AND id>?)"),
                "{plan:?}"
            );
        }
    }
}

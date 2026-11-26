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

use std::collections::{BTreeMap, BTreeSet};
use std::time::Duration;

use rusqlite::{OptionalExtension, TransactionBehavior, params};
use serde_json::Value as Json;
use umbel_store::lane::{MAX_MATCH_TEXTS, RecordDecl, ReindexReport, extract};
use umbel_store::{
    EmbedError, Embedder, Envelope, MemoryFlag, Rev, StoreError, canonical_json, record_target,
    unit_vector,
};

use super::charge::set_charge;
use super::write::{
    LaneValues, add_postings, clear_standing, insert_lane, lane_row, update_lane, write_keys,
    write_terms,
};
use super::{encode_vector, flags_text, require_ready};
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
pub(super) const CHUNK_SQL: &str = "SELECT id, rev, body, envelope FROM records
     WHERE ns = ?1 AND kind = ?2 AND id > COALESCE(?3, '') ORDER BY id LIMIT ?4";

/// Check whether any record of the kind lacks a lane row before scanning `changes` (step 1.2).
pub(super) const MISSING_LANE_SQL: &str =
    "SELECT EXISTS (SELECT 1 FROM records r WHERE r.ns = ?1 AND r.kind = ?2 AND NOT EXISTS
       (SELECT 1 FROM record_lane l WHERE l.ns = r.ns AND l.kind = r.kind AND l.id = r.id))";

/// One grouped pass over `changes` to recover each record's first revision and timestamp (step 1.2).
pub(super) const FIRST_PUTS_SQL: &str =
    "SELECT target, MIN(rev), at FROM changes WHERE kind = 'record' GROUP BY target";

/// One batch of records needing vectors for a model, paged by `l.id` over the unique index
/// `(ns, kind, id)` so each batch resumes in index order with no temp B-tree sort. `+l.match_digest`
/// prevents SQLite from choosing `record_lane_by_digest`, which is not ordered by `id` and would
/// otherwise rescan and sort the entire kind on every 64-row batch (O(N^2)).
pub(super) const VECTOR_BATCH_SQL: &str = "SELECT l.lane, l.id, l.match_digest, r.body
     FROM record_lane l
     JOIN records r ON r.ns = l.ns AND r.kind = l.kind AND r.id = l.id
     WHERE l.ns = ?1 AND l.kind = ?2
       AND l.id > COALESCE(?3, '')
       AND +l.match_digest IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM record_vectors v
         WHERE v.lane = l.lane AND v.model = ?4
       )
     ORDER BY l.id
     LIMIT ?5";

/// Optional timer threaded through [`SqliteStore::lane_reindex_inner`]; zero-sized when `testkit`
/// is not enabled so shipped and test builds run one orchestration body.
#[cfg(feature = "testkit")]
struct RebuildProbe<'a>(Option<&'a mut RebuildTimings>);

#[cfg(not(feature = "testkit"))]
struct RebuildProbe;

#[cfg(not(feature = "testkit"))]
struct RebuildMark;

#[cfg(feature = "testkit")]
impl RebuildProbe<'_> {
    fn mark(&self) -> Option<std::time::Instant> {
        self.0.as_ref().map(|_| std::time::Instant::now())
    }
    fn set_first_puts(&mut self, start: Option<std::time::Instant>) {
        if let (Some(t), Some(dst)) = (start, self.0.as_deref_mut()) {
            dst.first_puts = t.elapsed();
        }
    }
    fn push_chunk(&mut self, start: Option<std::time::Instant>) {
        if let (Some(t), Some(dst)) = (start, self.0.as_deref_mut()) {
            dst.chunks.push(t.elapsed());
        }
    }
    fn add_pause(&mut self, start: Option<std::time::Instant>) {
        if let (Some(t), Some(dst)) = (start, self.0.as_deref_mut()) {
            dst.pause_total += t.elapsed();
        }
    }
    fn set_end_rebuild(&mut self, start: Option<std::time::Instant>) {
        if let (Some(t), Some(dst)) = (start, self.0.as_deref_mut()) {
            dst.end_rebuild = t.elapsed();
        }
    }
    fn set_vectors(&mut self, start: Option<std::time::Instant>) {
        if let (Some(t), Some(dst)) = (start, self.0.as_deref_mut()) {
            dst.vectors = t.elapsed();
        }
    }
    fn set_total(&mut self, start: Option<std::time::Instant>) {
        if let (Some(t), Some(dst)) = (start, self.0.as_deref_mut()) {
            dst.total = t.elapsed();
        }
    }
}

#[cfg(not(feature = "testkit"))]
impl RebuildProbe {
    fn mark(&self) -> RebuildMark {
        RebuildMark
    }
    fn set_first_puts(&mut self, _: RebuildMark) {}
    fn push_chunk(&mut self, _: RebuildMark) {}
    fn add_pause(&mut self, _: RebuildMark) {}
    fn set_end_rebuild(&mut self, _: RebuildMark) {}
    fn set_vectors(&mut self, _: RebuildMark) {}
    fn set_total(&mut self, _: RebuildMark) {}
}

/// Wall-clock breakdown of one [`SqliteStore::lane_reindex_timed`] rebuild (records host
/// specification, sections 12.1 and 16). Compiled in only with the `testkit` feature.
#[cfg(feature = "testkit")]
#[derive(Debug, Clone, Default)]
pub struct RebuildTimings {
    /// Total wall-clock time of the rebuild call.
    pub total: Duration,
    /// Time spent in step 1.2 (`first_puts`).
    pub first_puts: Duration,
    /// Wall-clock time of each chunk transaction (`rebuild_chunk`), in order.
    pub chunks: Vec<Duration>,
    /// Total wall-clock time spent sleeping between chunks (`CHUNK_PAUSE`).
    pub pause_total: Duration,
    /// Wall-clock time of step 1.4 (`end_rebuild`).
    pub end_rebuild: Duration,
    /// Wall-clock time of step 2 (`reindex_vectors`).
    pub vectors: Duration,
}

#[cfg(feature = "testkit")]
impl RebuildTimings {
    /// The longest single chunk transaction, if any chunk ran.
    #[must_use]
    pub fn longest_chunk(&self) -> Duration {
        self.chunks.iter().copied().max().unwrap_or(Duration::ZERO)
    }
}

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

/// The `principal` a stored envelope names, if any.
fn envelope_principal(envelope: &str) -> Result<Option<String>, crate::error::Fail> {
    let envelope: Json = parse_json(envelope)?;
    Ok(envelope
        .get("principal")
        .and_then(Json::as_str)
        .map(str::to_owned))
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
            let missing: bool =
                conn.query_row(MISSING_LANE_SQL, params![ns, kind], |row| row.get(0))?;
            let mut first = BTreeMap::new();
            if !missing {
                return Ok(first);
            }
            let mut statement = conn.prepare(FIRST_PUTS_SQL)?;
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
                            chunk_counts.wordings_changed += 1;
                        }
                        if row.match_digest.as_deref() != values.digest {
                            // A vector is of the match value it was embedded for; keep it when
                            // only an unrelated text pointer changed (step B5 follow-up).
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
                // Charged to its envelope's principal with the postings it holds now, set and
                // never added: no quota is checked, and no record counts twice (D212).
                set_charge(
                    &tx,
                    lane,
                    ns,
                    kind,
                    envelope_principal(envelope)?.as_deref(),
                )?;
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

    /// Step 2 (section 12.1): delete vectors of every other model for the kind and embed each
    /// record with a match value lacking a vector for `embedder.model()`, in batches of 64
    /// outside any long transaction.
    ///
    /// Fenced by `record_kinds.generation`: if `expected_generation` is `Some(g)` (following a
    /// full rebuild) the vector phase verifies `generation == g` before deleting, before each
    /// batch embed, and inside each batch write transaction; if `None` (`vectors_only`), it
    /// raises `generation` first so concurrent vector or full rebuilds cannot interleave stale
    /// vectors. Returns `(vectors_written, vectors_removed, superseded)`.
    fn reindex_vectors(
        &self,
        ns: &str,
        decl: &RecordDecl,
        embedder: Option<&dyn Embedder>,
        expected_generation: Option<i64>,
    ) -> Result<(u64, u64, bool), StoreError> {
        // When `vectors_only` runs without an embedder, skip without touching the lane or
        // requiring readiness (preserves A59's stale-lane no-op for unmatched kinds too).
        if expected_generation.is_none() && embedder.is_none() {
            return Ok((0, 0, false));
        }
        let Some(pointer) = decl.match_pointer() else {
            return self.pool().with(|conn| {
                let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
                if let Some(gen_id) = expected_generation {
                    let current: Option<i64> = tx
                        .query_row(
                            "SELECT generation FROM record_kinds WHERE ns = ?1 AND kind = ?2",
                            params![ns, decl.kind],
                            |row| row.get(0),
                        )
                        .optional()?;
                    if current != Some(gen_id) {
                        return Ok((0, 0, true));
                    }
                }
                require_ready(&tx, ns, decl)?;
                let deleted = tx.execute(
                    "DELETE FROM record_vectors
                     WHERE lane IN (SELECT lane FROM record_lane WHERE ns = ?1 AND kind = ?2)",
                    params![ns, decl.kind],
                )?;
                tx.commit()?;
                Ok((0, deleted as u64, false))
            });
        };
        let Some(embedder) = embedder else {
            return Ok((0, 0, false));
        };
        let model = embedder.model().as_str();
        let expected_dim = embedder.dimensions();
        enum VectorInit {
            Empty,
            Superseded,
            Active(i64, u64),
        }
        let (gen_id, vectors_removed) = match self.pool().with(|conn| {
            let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let gen_id = match expected_generation {
                Some(gen_id) => {
                    let current: Option<i64> = tx
                        .query_row(
                            "SELECT generation FROM record_kinds WHERE ns = ?1 AND kind = ?2",
                            params![ns, decl.kind],
                            |row| row.get(0),
                        )
                        .optional()?;
                    if current != Some(gen_id) {
                        return Ok(VectorInit::Superseded);
                    }
                    require_ready(&tx, ns, decl)?;
                    gen_id
                }
                None => {
                    require_ready(&tx, ns, decl)?;
                    let bumped: Option<i64> = tx
                        .query_row(
                            "UPDATE record_kinds SET generation = generation + 1
                             WHERE ns = ?1 AND kind = ?2
                             RETURNING generation",
                            params![ns, decl.kind],
                            |row| row.get(0),
                        )
                        .optional()?;
                    let Some(gen_id) = bumped else {
                        // `require_ready` succeeded with no `record_kinds` row, so the kind has
                        // no stored records and nothing to embed or delete.
                        return Ok(VectorInit::Empty);
                    };
                    gen_id
                }
            };
            let deleted = tx.execute(
                "DELETE FROM record_vectors
                 WHERE lane IN (SELECT lane FROM record_lane WHERE ns = ?1 AND kind = ?2)
                   AND model != ?3",
                params![ns, decl.kind, model],
            )?;
            tx.commit()?;
            Ok(VectorInit::Active(gen_id, deleted as u64))
        })? {
            VectorInit::Empty => return Ok((0, 0, false)),
            VectorInit::Superseded => return Ok((0, 0, true)),
            VectorInit::Active(gen_id, deleted) => (gen_id, deleted),
        };
        let mut vectors_written = 0u64;
        // Track `(lane, match_digest)` pairs that embedded to a zero vector so catch-up sweeps do
        // not re-embed the same wording, while still re-embedding the lane if a concurrent put
        // changes its match wording to a new digest.
        let mut zero_lanes: BTreeSet<(i64, Vec<u8>)> = BTreeSet::new();
        let batch_limit = MAX_MATCH_TEXTS as i64;
        // Up to four full `l.id` embedding sweeps plus a fifth verification pass: sweep 0 embeds
        // every missing lane in index order; whenever a sweep called the embedder (even if all
        // vectors were zero or their digests moved concurrently before the write transaction), the
        // next sweep checks from the start for any concurrent `put_declared_record` that inserted
        // a lower-sorting ID or rewrote a match text while a batch was embedding (declared puts do
        // not bump `generation`). If non-zero missing vectors still remain after four sweeps,
        // report `superseded = true` rather than returning an incomplete lane as clean.
        const MAX_EMBED_SWEEPS: usize = 4;
        for sweep in 0..=MAX_EMBED_SWEEPS {
            let mut after_id: Option<String> = None;
            let mut embedded_in_sweep = false;
            loop {
                let Some(batch) = self.pool().with(|conn| {
                    let tx = conn.transaction()?;
                    let current: Option<i64> = tx
                        .query_row(
                            "SELECT generation FROM record_kinds WHERE ns = ?1 AND kind = ?2",
                            params![ns, decl.kind],
                            |row| row.get(0),
                        )
                        .optional()?;
                    if current != Some(gen_id) {
                        return Ok(None);
                    }
                    require_ready(&tx, ns, decl)?;
                    let mut stmt = tx.prepare_cached(VECTOR_BATCH_SQL)?;
                    let rows = stmt
                        .query_map(
                            params![ns, decl.kind, after_id.as_deref(), model, batch_limit],
                            |row| {
                                Ok((
                                    row.get::<_, i64>(0)?,
                                    row.get::<_, String>(1)?,
                                    row.get::<_, Vec<u8>>(2)?,
                                    row.get::<_, String>(3)?,
                                ))
                            },
                        )?
                        .collect::<Result<Vec<_>, _>>()?;
                    Ok(Some(rows))
                })?
                else {
                    return Ok((vectors_written, vectors_removed, true));
                };
                let Some((_, last_id, ..)) = batch.last() else {
                    break;
                };
                after_id = Some(last_id.clone());
                let mut pending: Vec<(i64, Vec<u8>, String)> = Vec::with_capacity(batch.len());
                for (lane, _, digest, body_text) in batch {
                    if zero_lanes.contains(&(lane, digest.clone())) {
                        continue;
                    }
                    let body: Json = parse_json(&body_text)?;
                    if let Some(text) = pointer.get(&body).and_then(Json::as_str) {
                        pending.push((lane, digest, text.to_owned()));
                    }
                }
                if pending.is_empty() {
                    continue;
                }
                if sweep == MAX_EMBED_SWEEPS {
                    return Ok((vectors_written, vectors_removed, true));
                }
                embedded_in_sweep = true;
                let refs: Vec<&str> = pending.iter().map(|(_, _, text)| text.as_str()).collect();
                let raw_vectors = embedder.embed(&refs).map_err(|err| match err {
                    EmbedError::Unavailable(reason) => StoreError::Io(reason),
                    EmbedError::Invalid(reason) => StoreError::Invalid(reason),
                })?;
                if raw_vectors.len() != pending.len() {
                    return Err(StoreError::Invalid(format!(
                        "embedding provider returned {} vectors for {} texts",
                        raw_vectors.len(),
                        pending.len()
                    )));
                }
                let mut ready: Vec<(i64, Vec<u8>, Vec<u8>)> = Vec::with_capacity(pending.len());
                for ((lane, digest, _), raw) in pending.into_iter().zip(raw_vectors) {
                    if raw.len() != expected_dim {
                        return Err(StoreError::Invalid(format!(
                            "embedding provider returned {} dimensions, expected {expected_dim}",
                            raw.len()
                        )));
                    }
                    if !raw.iter().all(|v| v.is_finite()) {
                        return Err(StoreError::Invalid(
                            "embedding provider returned a non-finite number".to_owned(),
                        ));
                    }
                    // A zero vector is no vector (section 9.1): skip storing it and remember
                    // `(lane, digest)` so catch-up sweeps do not re-embed the same wording.
                    if let Some(unit) = unit_vector(&raw) {
                        ready.push((lane, digest, encode_vector(&unit)));
                    } else {
                        zero_lanes.insert((lane, digest));
                    }
                }
                if ready.is_empty() {
                    continue;
                }
                let Some(written) = self.pool().with(|conn| {
                    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
                    let current: Option<i64> = tx
                        .query_row(
                            "SELECT generation FROM record_kinds WHERE ns = ?1 AND kind = ?2",
                            params![ns, decl.kind],
                            |row| row.get(0),
                        )
                        .optional()?;
                    if current != Some(gen_id) {
                        return Ok(None);
                    }
                    require_ready(&tx, ns, decl)?;
                    let mut count = 0u64;
                    for (lane, digest, encoded) in &ready {
                        let current: Option<Vec<u8>> = tx
                            .query_row(
                                "SELECT match_digest FROM record_lane WHERE lane = ?1",
                                [lane],
                                |row| row.get(0),
                            )
                            .optional()?
                            .flatten();
                        if current.as_deref() == Some(digest.as_slice()) {
                            tx.execute(
                                "INSERT OR REPLACE INTO record_vectors (lane, model, vector)
                                 VALUES (?1, ?2, ?3)",
                                params![lane, model, encoded.as_slice()],
                            )?;
                            count += 1;
                        }
                    }
                    tx.commit()?;
                    Ok(Some(count))
                })?
                else {
                    return Ok((vectors_written, vectors_removed, true));
                };
                vectors_written += written;
            }
            if !embedded_in_sweep {
                return Ok((vectors_written, vectors_removed, false));
            }
        }
        Ok((vectors_written, vectors_removed, true))
    }

    pub(crate) fn lane_reindex(
        &self,
        ns: &str,
        decl: &RecordDecl,
        scan: &dyn Fn(&str) -> Vec<MemoryFlag>,
        embedder: Option<&dyn Embedder>,
        vectors_only: bool,
    ) -> Result<ReindexReport, StoreError> {
        #[cfg(feature = "testkit")]
        let mut probe = RebuildProbe(None);
        #[cfg(not(feature = "testkit"))]
        let mut probe = RebuildProbe;
        self.lane_reindex_inner(ns, decl, scan, embedder, vectors_only, &mut probe)
    }

    /// Rebuild a declared kind's lane and return the per-chunk wall-clock breakdown (records host
    /// specification, section 16). Compiled in only with the `testkit` feature.
    ///
    /// # Errors
    /// Same as [`umbel_store::DocumentStore::reindex_records`].
    #[cfg(feature = "testkit")]
    pub fn lane_reindex_timed(
        &self,
        ns: &str,
        decl: &RecordDecl,
        scan: &dyn Fn(&str) -> Vec<MemoryFlag>,
        embedder: Option<&dyn Embedder>,
        vectors_only: bool,
    ) -> Result<(ReindexReport, RebuildTimings), StoreError> {
        let mut timings = RebuildTimings::default();
        let mut probe = RebuildProbe(Some(&mut timings));
        let report = self.lane_reindex_inner(ns, decl, scan, embedder, vectors_only, &mut probe)?;
        Ok((report, timings))
    }

    fn lane_reindex_inner(
        &self,
        ns: &str,
        decl: &RecordDecl,
        scan: &dyn Fn(&str) -> Vec<MemoryFlag>,
        embedder: Option<&dyn Embedder>,
        vectors_only: bool,
        #[cfg(feature = "testkit")] probe: &mut RebuildProbe<'_>,
        #[cfg(not(feature = "testkit"))] probe: &mut RebuildProbe,
    ) -> Result<ReindexReport, StoreError> {
        let started = probe.mark();
        decl.check()?;
        if vectors_only {
            let status = self.lane_state_of(ns, decl)?;
            let v_start = probe.mark();
            let (vectors_written, vectors_removed, superseded) =
                self.reindex_vectors(ns, decl, embedder, None)?;
            probe.set_vectors(v_start);
            probe.set_total(started);
            return Ok(ReindexReport {
                records: status.records,
                unindexed: status.unindexed,
                wordings_changed: 0,
                superseded,
                vectors_written,
                vectors_removed,
            });
        }
        let generation = self.begin_rebuild(ns, decl)?;
        let fp_start = probe.mark();
        let first = self.first_puts(ns, &decl.kind)?;
        probe.set_first_puts(fp_start);
        let mut counts = Counts::default();
        let mut after: Option<String> = None;
        let mut superseded = false;
        for index in 0.. {
            let chunk_start = probe.mark();
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
            probe.push_chunk(chunk_start);
            match done {
                Chunk::More(last) => {
                    after = Some(last);
                    #[cfg(feature = "testkit")]
                    self.at_rebuild_point(crate::RebuildPoint::AfterChunk(index));
                    let pause_start = probe.mark();
                    // The write lock is free here: a writer waiting on it gets its turn.
                    std::thread::sleep(CHUNK_PAUSE);
                    probe.add_pause(pause_start);
                }
                Chunk::Last => break,
                Chunk::Superseded => {
                    superseded = true;
                    break;
                }
            }
        }
        let end_start = probe.mark();
        let cleared = !superseded && self.end_rebuild(ns, decl, generation)?;
        probe.set_end_rebuild(end_start);
        let v_start = probe.mark();
        let (vectors_written, vectors_removed, vec_superseded) = if cleared {
            self.reindex_vectors(ns, decl, embedder, Some(generation))?
        } else {
            (0, 0, false)
        };
        probe.set_vectors(v_start);
        probe.set_total(started);
        Ok(ReindexReport {
            records: counts.records,
            unindexed: counts.unindexed,
            wordings_changed: counts.wordings_changed,
            superseded: !cleared || vec_superseded,
            vectors_written,
            vectors_removed,
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

    #[test]
    fn vectors_only_on_empty_matched_kind_succeeds_and_generation_bump_supersedes() {
        use serde_json::json;
        use umbel_store::conformance::samples;
        use umbel_store::lane::{LaneWrite, Pointer, RecordDecl};
        use umbel_store::{DocumentStore, EmbedError, Embedder, Expect, ModelId, ReaderFilter};

        struct Stub {
            model: ModelId,
            on_embed: Option<Box<dyn Fn() + Send + Sync>>,
        }
        impl Embedder for Stub {
            fn model(&self) -> &ModelId {
                &self.model
            }
            fn dimensions(&self) -> usize {
                16
            }
            fn embed(&self, texts: &[&str]) -> Result<Vec<Vec<f32>>, EmbedError> {
                if let Some(hook) = &self.on_embed {
                    hook();
                }
                Ok(texts.iter().map(|_| vec![1.0f32; 16]).collect())
            }
        }

        let dir = tempfile::tempdir().expect("tempdir");
        let store = crate::SqliteStore::open(dir.path(), "main", crate::StoreOptions::default())
            .expect("open");
        let decl = RecordDecl {
            kind: "note".to_owned(),
            standing: false,
            text: vec![Pointer::parse("/statement").expect("ptr")],
            keys: Vec::new(),
            matched: Some(0),
        };
        let model = ModelId::parse("demo@0123456789abcdef").expect("model");
        let stub = Stub {
            model: model.clone(),
            on_embed: None,
        };

        // 1. Empty declared matched kind with vectors_only = true must succeed with zero counts.
        let empty = store
            .reindex_records("notes", &decl, &|_| Vec::new(), Some(&stub), true)
            .expect("empty matched kind vectors_only");
        assert_eq!(empty.records, 0);
        assert_eq!(empty.vectors_written, 0);
        assert_eq!(empty.vectors_removed, 0);
        assert!(!empty.superseded);

        // 2. If another writer bumps generation mid-embed, reindex_vectors writes nothing and
        //    reports superseded = true.
        let env = samples::envelope(&["space"], "t1", "2026-11-22T00:00:00.000Z");
        let reader = ReaderFilter::tokens(["space"]).expect("reader");
        store
            .put_declared_record(
                "notes",
                &decl,
                "n1",
                json!({ "statement": "Prune roses." }),
                env.clone(),
                Expect::Any,
                LaneWrite {
                    flags: Vec::new(),
                    evidence: None,
                    model: None,
                    quota: None,
                },
                &reader,
            )
            .expect("put");
        let store_for_hook =
            crate::SqliteStore::open(dir.path(), "main", crate::StoreOptions::default())
                .expect("open 2");
        let decl_for_hook = decl.clone();
        let superseding_stub = Stub {
            model,
            on_embed: Some(Box::new(move || {
                // Undeclared put raises generation and marks kind stale while embed() is in flight.
                store_for_hook
                    .put_record(
                        "notes",
                        &decl_for_hook.kind,
                        "n2",
                        json!({ "statement": "Water tomatoes." }),
                        env.clone(),
                        Expect::Any,
                    )
                    .expect("undeclared put");
            })),
        };
        let rep = store
            .reindex_records(
                "notes",
                &decl,
                &|_| Vec::new(),
                Some(&superseding_stub),
                true,
            )
            .expect("superseded vectors_only");
        assert!(rep.superseded, "{rep:?}");
        assert_eq!(rep.vectors_written, 0);
    }

    #[test]
    fn vectors_only_pages_multiple_batches_non_ascii_unmatched_and_zero_vectors() {
        use serde_json::json;
        use umbel_store::conformance::samples;
        use umbel_store::lane::{LaneWrite, Pointer, RecordDecl};
        use umbel_store::{DocumentStore, EmbedError, Embedder, Expect, ModelId, ReaderFilter};

        struct ZeroForMarker {
            model: ModelId,
        }
        impl Embedder for ZeroForMarker {
            fn model(&self) -> &ModelId {
                &self.model
            }
            fn dimensions(&self) -> usize {
                8
            }
            fn embed(&self, texts: &[&str]) -> Result<Vec<Vec<f32>>, EmbedError> {
                Ok(texts
                    .iter()
                    .map(|t| {
                        if t.contains("ZERO_VECTOR") {
                            vec![0.0f32; 8]
                        } else {
                            vec![1.0f32; 8]
                        }
                    })
                    .collect())
            }
        }

        let dir = tempfile::tempdir().expect("tempdir");
        let store = crate::SqliteStore::open(dir.path(), "main", crate::StoreOptions::default())
            .expect("open");
        let decl = RecordDecl {
            kind: "note".to_owned(),
            standing: false,
            text: vec![Pointer::parse("/statement").expect("ptr")],
            keys: Vec::new(),
            matched: Some(0),
        };
        let env = samples::envelope(&["space"], "t1", "2026-11-23T00:00:00.000Z");
        let reader = ReaderFilter::tokens(["space"]).expect("reader");
        // 72 regular records (> 64 batch size), 2 non-ASCII IDs, 1 unmatched (null match_digest),
        // and 1 record whose embedder returns a zero vector (must not loop forever).
        for i in 0..72usize {
            store
                .put_declared_record(
                    "notes",
                    &decl,
                    &format!("n{i:03}"),
                    json!({ "statement": format!("Prune rose bush {i}.") }),
                    env.clone(),
                    Expect::Any,
                    LaneWrite {
                        flags: Vec::new(),
                        evidence: None,
                        model: None,
                        quota: None,
                    },
                    &reader,
                )
                .expect("put");
        }
        for (id, body) in [
            ("é-rose", json!({ "statement": "Élaguer les rosiers." })),
            ("α-herb", json!({ "statement": "Αρωματικά βότανα." })),
            ("n-zero", json!({ "statement": "ZERO_VECTOR sentinel" })),
            ("n-empty", json!({})),
        ] {
            store
                .put_declared_record(
                    "notes",
                    &decl,
                    id,
                    body,
                    env.clone(),
                    Expect::Any,
                    LaneWrite {
                        flags: Vec::new(),
                        evidence: None,
                        model: None,
                        quota: None,
                    },
                    &reader,
                )
                .expect("put special");
        }
        let model = ModelId::parse("demo@0123456789abcdef").expect("model");
        let stub = ZeroForMarker {
            model: model.clone(),
        };
        let rep = store
            .reindex_records("notes", &decl, &|_| Vec::new(), Some(&stub), true)
            .expect("multi-batch vectors_only");
        assert!(!rep.superseded);
        assert_eq!(
            rep.vectors_written, 74,
            "72 ascii + 2 non-ascii, excluding zero and empty"
        );
        let status = store.lane_status("notes", &decl).expect("status");
        assert_eq!(status.vectors.get(model.as_str()), Some(&74));
    }

    #[test]
    fn vectors_only_catches_concurrent_lower_id_declared_put_during_embed() {
        use serde_json::json;
        use std::sync::atomic::{AtomicBool, Ordering};
        use umbel_store::conformance::samples;
        use umbel_store::lane::{LaneWrite, Pointer, RecordDecl};
        use umbel_store::{DocumentStore, EmbedError, Embedder, Expect, ModelId, ReaderFilter};

        struct InsertLowerOnFirstBatch {
            model: ModelId,
            inserted: AtomicBool,
            store: crate::SqliteStore,
            decl: RecordDecl,
        }
        impl Embedder for InsertLowerOnFirstBatch {
            fn model(&self) -> &ModelId {
                &self.model
            }
            fn dimensions(&self) -> usize {
                8
            }
            fn embed(&self, texts: &[&str]) -> Result<Vec<Vec<f32>>, EmbedError> {
                if !self.inserted.swap(true, Ordering::SeqCst) {
                    // Concurrent declared put with a lower-sorting ID ("a00" < "m01"): does not
                    // bump `record_kinds.generation`, so a single-sweep `l.id > after_id` loop
                    // without catch-up would miss it.
                    let env = samples::envelope(&["space"], "t2", "2026-11-23T00:00:01.000Z");
                    let reader = ReaderFilter::tokens(["space"]).expect("reader");
                    self.store
                        .put_declared_record(
                            "notes",
                            &self.decl,
                            "a00",
                            json!({ "statement": "Late arriving rose note." }),
                            env,
                            Expect::Absent,
                            LaneWrite {
                                flags: Vec::new(),
                                evidence: None,
                                model: None,
                                quota: None,
                            },
                            &reader,
                        )
                        .expect("concurrent declared put");
                }
                Ok(texts.iter().map(|_| vec![1.0f32; 8]).collect())
            }
        }

        let dir = tempfile::tempdir().expect("tempdir");
        let store = crate::SqliteStore::open(dir.path(), "main", crate::StoreOptions::default())
            .expect("open");
        let decl = RecordDecl {
            kind: "note".to_owned(),
            standing: false,
            text: vec![Pointer::parse("/statement").expect("ptr")],
            keys: Vec::new(),
            matched: Some(0),
        };
        let env = samples::envelope(&["space"], "t1", "2026-11-23T00:00:00.000Z");
        let reader = ReaderFilter::tokens(["space"]).expect("reader");
        for id in ["m01", "m02"] {
            store
                .put_declared_record(
                    "notes",
                    &decl,
                    id,
                    json!({ "statement": format!("Initial note {id}.") }),
                    env.clone(),
                    Expect::Absent,
                    LaneWrite {
                        flags: Vec::new(),
                        evidence: None,
                        model: None,
                        quota: None,
                    },
                    &reader,
                )
                .expect("put");
        }
        let model = ModelId::parse("demo@0123456789abcdef").expect("model");
        let embedder = InsertLowerOnFirstBatch {
            model: model.clone(),
            inserted: AtomicBool::new(false),
            store: crate::SqliteStore::open(dir.path(), "main", crate::StoreOptions::default())
                .expect("open 2"),
            decl: decl.clone(),
        };
        let rep = store
            .reindex_records("notes", &decl, &|_| Vec::new(), Some(&embedder), true)
            .expect("vectors_only with concurrent lower-id insert");
        assert!(!rep.superseded);
        assert_eq!(rep.vectors_written, 3, "catch-up sweep must embed a00 too");
        let status = store.lane_status("notes", &decl).expect("status");
        assert_eq!(status.with_match, 3);
        assert_eq!(status.vectors.get(model.as_str()), Some(&3));
    }

    #[test]
    fn vectors_only_catches_zero_vector_rewrite_and_concurrent_update_when_sweep_writes_zero() {
        use serde_json::json;
        use std::sync::atomic::{AtomicUsize, Ordering};
        use umbel_store::conformance::samples;
        use umbel_store::lane::{LaneWrite, Pointer, RecordDecl};
        use umbel_store::{DocumentStore, EmbedError, Embedder, Expect, ModelId, ReaderFilter};

        // On batch 0: returns a zero vector for "zero-only" AND concurrently rewrites "zero-only"
        // to a non-zero wording AND inserts a lower-sorting "a00" record. Sweep 0 therefore writes
        // 0 vectors (`ready.is_empty()`), yet sweep 1 must catch both the rewritten lane (new
        // digest on the same lane rowid) and the lower-sorting insert.
        struct MutateDuringZeroBatch {
            model: ModelId,
            calls: AtomicUsize,
            store: crate::SqliteStore,
            decl: RecordDecl,
        }
        impl Embedder for MutateDuringZeroBatch {
            fn model(&self) -> &ModelId {
                &self.model
            }
            fn dimensions(&self) -> usize {
                8
            }
            fn embed(&self, texts: &[&str]) -> Result<Vec<Vec<f32>>, EmbedError> {
                let call = self.calls.fetch_add(1, Ordering::SeqCst);
                if call == 0 {
                    let env = samples::envelope(&["space"], "t2", "2026-11-23T00:00:01.000Z");
                    let reader = ReaderFilter::tokens(["space"]).expect("reader");
                    self.store
                        .put_declared_record(
                            "notes",
                            &self.decl,
                            "m01",
                            json!({ "statement": "Now valid rose wording." }),
                            env.clone(),
                            Expect::Any,
                            LaneWrite {
                                flags: Vec::new(),
                                evidence: None,
                                model: None,
                                quota: None,
                            },
                            &reader,
                        )
                        .expect("rewrite m01");
                    self.store
                        .put_declared_record(
                            "notes",
                            &self.decl,
                            "a00",
                            json!({ "statement": "Lower id inserted during zero batch." }),
                            env,
                            Expect::Absent,
                            LaneWrite {
                                flags: Vec::new(),
                                evidence: None,
                                model: None,
                                quota: None,
                            },
                            &reader,
                        )
                        .expect("insert a00");
                }
                Ok(texts
                    .iter()
                    .map(|t| {
                        if t.contains("zero-only") {
                            vec![0.0f32; 8]
                        } else {
                            vec![1.0f32; 8]
                        }
                    })
                    .collect())
            }
        }

        let dir = tempfile::tempdir().expect("tempdir");
        let store = crate::SqliteStore::open(dir.path(), "main", crate::StoreOptions::default())
            .expect("open");
        let decl = RecordDecl {
            kind: "note".to_owned(),
            standing: false,
            text: vec![Pointer::parse("/statement").expect("ptr")],
            keys: Vec::new(),
            matched: Some(0),
        };
        let env = samples::envelope(&["space"], "t1", "2026-11-23T00:00:00.000Z");
        let reader = ReaderFilter::tokens(["space"]).expect("reader");
        store
            .put_declared_record(
                "notes",
                &decl,
                "m01",
                json!({ "statement": "zero-only initial text" }),
                env,
                Expect::Absent,
                LaneWrite {
                    flags: Vec::new(),
                    evidence: None,
                    model: None,
                    quota: None,
                },
                &reader,
            )
            .expect("put m01");
        let model = ModelId::parse("demo@0123456789abcdef").expect("model");
        let embedder = MutateDuringZeroBatch {
            model: model.clone(),
            calls: AtomicUsize::new(0),
            store: crate::SqliteStore::open(dir.path(), "main", crate::StoreOptions::default())
                .expect("open 2"),
            decl: decl.clone(),
        };
        let rep = store
            .reindex_records("notes", &decl, &|_| Vec::new(), Some(&embedder), true)
            .expect("catch-up after zero-write sweep");
        assert!(!rep.superseded);
        assert_eq!(rep.vectors_written, 2, "must embed rewritten m01 and a00");
        let status = store.lane_status("notes", &decl).expect("status");
        assert_eq!(status.with_match, 2);
        assert_eq!(status.vectors.get(model.as_str()), Some(&2));
    }
}

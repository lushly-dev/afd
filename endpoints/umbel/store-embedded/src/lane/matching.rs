//! `match_records` (records host specification, section 8; D165): for each text, the records
//! whose match field is identical to it and the nearest ones by words, with their scores. The
//! host returns scores only: what to do with one is the calling plugin's.
//!
//! **Every statement is held to three clauses**: the reader may read the record, the view admits
//! its standing, and the call does not exclude it ([`Scope::and_counted`]). So the corpus's size,
//! its tokens, each term's count, the candidates and both lists are the reader's own: a record
//! the reader may not read changes no score, no order and no `cut`. The key filters narrow the
//! candidates and the identical records, never the statistics.
//!
//! **The one refusal for size is the kind's** (section 8.2, after step B4's review): when the
//! kind as a whole holds more postings than the bound, over all its text fields and whoever may
//! read them, every match of it, and every ranked find ([`super::rank`]), is refused and returns
//! nothing. It is checked once a call,
//! before anything else is read, from the count the put and the rebuild keep in
//! `record_postings`, so it is the same for every call and every reader: it says that the kind
//! is past its matching size, and nothing of which records hold which words.
//!
//! The words score is [`umbel_store::lane::score`]'s: BM25 over the lane's terms, scaled so that
//! a text scores 1 against itself, in both directions, the lower kept, with the incoming text
//! counted as one more record of its corpus. Without vectors `meaning` is absent from every hit
//! and `fused` equals `words`; vectors are step B5's.

use std::collections::BTreeMap;

use rusqlite::{Connection, params_from_iter};
use serde_json::Value;
use umbel_store::lane::score::{Corpus, Posting, directed, fused, round4, score, words};
use umbel_store::lane::{
    LaneRecord, MATCH_POOL, MAX_IDENTICAL, MatchHit, MatchPage, MatchPlan, MatchResult, MatchText,
    MatchVectors, MeaningState, RecordDecl, RecordMatch, StandingView,
};
use umbel_store::{ReaderFilter, StoreError};

use super::find::{records, select};
use super::rank::{Counts, Scope, candidates, within_bound};
use super::{RECORD_COLUMNS, and_keys, limit_of, refuse_derivation, require_ready};
use crate::SqliteStore;
use crate::error::Fail;
use crate::sql::Sql;

/// One pooled record with its two directed scores, unrounded.
struct Pooled {
    lane: i64,
    id: String,
    /// `directed(q, d)`.
    to_record: f64,
    /// `words(q, d)`: the lower of the two directions.
    words: f64,
}

/// The statement of a text's identical records: the lanes whose match digest is `digest`, by
/// id, at most [`MAX_IDENTICAL`], with the key filters, the reader, the view and the
/// exclusions. One lookup in `record_lane_by_digest`, and a sort of what it finds.
fn identical_sql(
    scope: &Scope<'_>,
    keys: &[(u8, Vec<String>)],
    digest: &[u8; 32],
) -> Result<Sql, StoreError> {
    let mut sql = Sql::new("SELECT l.lane FROM record_lane l WHERE l.ns = ");
    sql.bind(scope.ns)
        .push(" AND l.kind = ")
        .bind(scope.decl.kind.as_str())
        .push(" AND l.match_digest = ")
        .bind(digest.as_slice());
    and_keys(&mut sql, keys);
    scope.and_counted(&mut sql);
    // `+l.id`, and not `l.id`: given an order an index could give, the planner reads the kind
    // in id order to save the sort, which is every lane row of the kind for a text that is
    // identical to nothing. The unary plus keeps the column's value and its byte order.
    sql.push(" ORDER BY +l.id LIMIT ")
        .bind(limit_of(MAX_IDENTICAL as u64)?);
    Ok(sql)
}

/// The lanes of the records whose match field is identical to a text of this digest.
fn identical(
    scope: &Scope<'_>,
    keys: &[(u8, Vec<String>)],
    digest: &[u8; 32],
) -> Result<Vec<i64>, Fail> {
    let sql = identical_sql(scope, keys, digest)?;
    let mut statement = scope.conn.prepare_cached(&sql.text)?;
    let lanes = statement
        .query_map(params_from_iter(&sql.params), |row| row.get(0))?
        .collect::<Result<_, _>>()?;
    Ok(lanes)
}

/// The statement of the pooled records' whole term lists in the match field, by lane and then
/// by term, under the reader, the view and the exclusions again.
fn terms_sql(scope: &Scope<'_>, lanes: &[i64]) -> Sql {
    let mut sql = Sql::new(
        "SELECT t.lane, t.term, t.tf FROM record_terms t JOIN record_lane l ON l.lane = t.lane WHERE t.lane IN ",
    );
    sql.bind_list(lanes.iter().copied())
        .push(" AND t.field IN ")
        .bind_list(scope.fields.iter().map(|field| i64::from(*field)));
    scope.and_counted(&mut sql);
    sql.push(" ORDER BY t.lane, t.term");
    sql
}

/// The statement of the hits' records, by lane, under the reader, the view and the exclusions
/// once more, with what a label needs.
fn hits_sql(scope: &Scope<'_>, lanes: &[i64]) -> Sql {
    let mut sql = select(RECORD_COLUMNS, scope.ns, &scope.decl.kind);
    sql.push(" AND l.lane IN ").bind_list(lanes.iter().copied());
    scope.and_counted(&mut sql);
    sql
}

/// Each pooled record's whole term list in the match field, by lane, in the terms' byte order:
/// one statement ([`terms_sql`]).
fn terms_of(scope: &Scope<'_>, pool: &[Pooled]) -> Result<BTreeMap<i64, Vec<(String, u32)>>, Fail> {
    let mut held: BTreeMap<i64, Vec<(String, u32)>> = BTreeMap::new();
    if pool.is_empty() {
        return Ok(held);
    }
    let lanes: Vec<i64> = pool.iter().map(|pooled| pooled.lane).collect();
    let sql = terms_sql(scope, &lanes);
    let mut statement = scope.conn.prepare_cached(&sql.text)?;
    let mut rows = statement.query(params_from_iter(&sql.params))?;
    while let Some(row) = rows.next()? {
        held.entry(row.get(0)?)
            .or_default()
            .push((row.get(1)?, row.get(2)?));
    }
    Ok(held)
}

/// Section 8.2's step 5: keep the [`MATCH_POOL`] candidates with the highest `directed(q, d)`
/// at four places, ties by id in the byte order of its UTF-8. The digits past the fourth place
/// never decide, so every backend pools the same records.
fn keep_pool(pool: &mut Vec<Pooled>) {
    pool.sort_by(|a, b| {
        round4(b.to_record)
            .total_cmp(&round4(a.to_record))
            .then_with(|| a.id.as_bytes().cmp(b.id.as_bytes()))
    });
    pool.truncate(MATCH_POOL);
}

/// Section 8.2's steps for one text: its counts, the gather, the query direction, the pool and
/// both directions. It answers the pool, each record with its words score, and whether the
/// gather was cut.
fn nearest(
    scope: &Scope<'_>,
    keys: &[(u8, Vec<String>)],
    text: &MatchText,
    stored: &Corpus,
    counts: &mut Counts,
    gather_postings: u64,
) -> Result<(Vec<Pooled>, bool), Fail> {
    // 1. Counts for the text's distinct terms, from the call's table.
    counts.need(scope, text.terms.iter().map(|(term, _)| term.as_str()))?;
    // The text's corpus is the stored one plus the text itself, as one more record: one more
    // record, its tokens, and one more holder of each of its terms.
    let corpus = Corpus {
        records: stored.records + 1,
        tokens: stored.tokens + u64::from(text.length),
    };
    let asked: Vec<&str> = text.terms.iter().map(|(term, _)| term.as_str()).collect();
    let stored_counts: BTreeMap<&str, u64> =
        asked.iter().map(|term| (*term, counts.df0(term))).collect();
    // 2 and 3. The gather order and the gather, over the stored counts, which no key filter
    // narrows.
    let (lanes, cut) = candidates(scope, keys, &stored_counts, gather_postings)?;
    // 4. The query direction, for every candidate. The text's terms are in byte order, so
    // every backend adds in one order.
    let own = score(
        &corpus,
        text.length,
        text.terms.iter().map(|(term, tf)| Posting {
            df: counts.df0(term) + 1,
            tf: *tf,
        }),
    );
    let mut pool: Vec<Pooled> = scope
        .held(&lanes, &asked)?
        .into_iter()
        .map(|held| {
            let postings = asked.iter().filter_map(|term| {
                let tf = held.terms.get(*term).copied()?;
                Some(Posting {
                    df: counts.df0(term) + 1,
                    tf,
                })
            });
            Pooled {
                lane: held.lane,
                to_record: directed(score(&corpus, held.length, postings), own),
                words: 0.0,
                id: held.id,
            }
        })
        .collect();
    // 5. The pool.
    keep_pool(&mut pool);
    // 6. Both directions: each pooled record's whole term list, and counts for those terms.
    let held = terms_of(scope, &pool)?;
    counts.need(
        scope,
        held.values().flatten().map(|(term, _)| term.as_str()),
    )?;
    let in_text: BTreeMap<&str, u32> = text
        .terms
        .iter()
        .map(|(term, tf)| (term.as_str(), *tf))
        .collect();
    for pooled in &mut pool {
        let terms = held.get(&pooled.lane).map_or(&[][..], Vec::as_slice);
        let length: u32 = terms.iter().map(|(_, tf)| *tf).sum();
        // A term the text holds too has one more holder in this text's corpus.
        let df = |term: &str| counts.df0(term) + u64::from(in_text.contains_key(term));
        let own = score(
            &corpus,
            length,
            terms.iter().map(|(term, tf)| Posting {
                df: df(term),
                tf: *tf,
            }),
        );
        let to_text = score(
            &corpus,
            text.length,
            terms.iter().filter_map(|(term, _)| {
                let tf = in_text.get(term.as_str()).copied()?;
                Some(Posting { df: df(term), tf })
            }),
        );
        pooled.words = words(pooled.to_record, directed(to_text, own));
    }
    Ok((pool, cut))
}

/// The value at the match pointer of a record's body.
fn match_text(decl: &RecordDecl, body: &Value) -> String {
    decl.match_pointer()
        .and_then(|pointer| pointer.get(body))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

/// A hit of `record`, with `scores` in `nearest` and none in `identical`.
fn hit(decl: &RecordDecl, record: &LaneRecord, scores: Option<(f64, f64)>) -> MatchHit {
    MatchHit {
        id: record.record.id.clone(),
        rev: record.record.rev,
        text: match_text(decl, &record.record.body),
        flags: record.flags.clone(),
        label: record.label.clone(),
        words: scores.map(|(words, _)| words),
        meaning: None,
        fused: scores.map(|(_, fused)| fused),
    }
}

/// One text's result.
fn matched(
    scope: &Scope<'_>,
    plan: &MatchPlan,
    text: &MatchText,
    stored: &Corpus,
    counts: &mut Counts,
    gather_postings: u64,
    k: usize,
) -> Result<MatchResult, Fail> {
    // A text whose normalised form is empty has no digest and is identical to nothing.
    let same = match &text.digest {
        Some(digest) => identical(scope, &plan.keys, digest)?,
        None => Vec::new(),
    };
    let (pool, cut) = nearest(scope, &plan.keys, text, stored, counts, gather_postings)?;
    // With no meaning served, `fused` is `words`, from the unrounded score. The order is by
    // the rounded value descending, then by id, so the last bits of a float never change it.
    let mut ranked: Vec<(&Pooled, f64, f64)> = pool
        .iter()
        .map(|pooled| {
            (
                pooled,
                round4(pooled.words),
                round4(fused(0.0, 0.0, pooled.words)),
            )
        })
        .collect();
    ranked.sort_by(|a, b| {
        b.2.total_cmp(&a.2)
            .then_with(|| a.0.id.as_bytes().cmp(b.0.id.as_bytes()))
    });
    ranked.truncate(k);
    // The hits' records, by lane, under the reader, the view and the exclusions once more,
    // each with the label a read gives it.
    let mut lanes: Vec<i64> = same.clone();
    lanes.extend(ranked.iter().map(|(pooled, _, _)| pooled.lane));
    lanes.sort_unstable();
    lanes.dedup();
    let mut by_lane: BTreeMap<i64, LaneRecord> = BTreeMap::new();
    if !lanes.is_empty() {
        let sql = hits_sql(scope, &lanes);
        by_lane.extend(
            records(scope.conn, &sql, scope.decl, scope.view, scope.reader)?
                .into_iter()
                .map(|read| (read.lane, read.record)),
        );
    }
    Ok(MatchResult {
        identical: same
            .iter()
            .filter_map(|lane| by_lane.get(lane))
            .map(|record| hit(scope.decl, record, None))
            .collect(),
        nearest: ranked
            .iter()
            .filter_map(|(pooled, words, fused)| {
                by_lane
                    .get(&pooled.lane)
                    .map(|record| hit(scope.decl, record, Some((*words, *fused))))
            })
            .collect(),
        cut,
    })
}

/// Every text of a match, inside one snapshot.
#[allow(clippy::too_many_arguments)]
fn page(
    conn: &Connection,
    ns: &str,
    decl: &RecordDecl,
    query: &RecordMatch,
    plan: &MatchPlan,
    view: &StandingView,
    reader: &ReaderFilter,
    limits: umbel_store::lane::LaneLimits,
) -> Result<MatchPage, Fail> {
    let fields = [plan.field];
    let scope = Scope {
        conn,
        ns,
        decl,
        fields: &fields,
        exclude: &plan.exclude,
        view,
        reader,
    };
    // Once a call: the stored part of `N` and `L`, and an empty table of stored counts.
    let stored = scope.corpus()?;
    let mut counts = Counts::new();
    let k = query.k as usize;
    let mut results = Vec::with_capacity(plan.texts.len());
    for text in &plan.texts {
        results.push(matched(
            &scope,
            plan,
            text,
            &stored,
            &mut counts,
            limits.gather_postings,
            k,
        )?);
    }
    Ok(MatchPage {
        results,
        admitted: view.admit.clone(),
        meaning: MeaningState::Off,
    })
}

impl SqliteStore {
    pub(crate) fn lane_match(
        &self,
        ns: &str,
        decl: &RecordDecl,
        query: &RecordMatch,
        vectors: Option<&MatchVectors>,
        view: &StandingView,
        reader: &ReaderFilter,
    ) -> Result<MatchPage, StoreError> {
        refuse_derivation(reader)?;
        let plan = query.plan(decl)?;
        // Step B5 serves vectors. Until then a match that carries them is refused, and never
        // answered as if it had carried none.
        if vectors.is_some() {
            return Err(StoreError::invalid(
                "a match with vectors is not served yet",
            ));
        }
        let limits = self.lane_limits();
        self.pool().with(|conn| {
            // One snapshot for the kind's state, its size, the statistics and every text.
            let tx = conn.transaction()?;
            require_ready(&tx, ns, decl)?;
            within_bound(&tx, ns, &decl.kind, limits.match_postings)?;
            page(&tx, ns, decl, query, &plan, view, reader, limits)
        })
    }
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;
    use umbel_store::lane::{Pointer, Standing};

    use super::super::rank::counts_sql;
    use super::*;
    use crate::schema::{LANE_SCHEMA, POSTINGS_SCHEMA, SCHEMA};

    /// A database with the lane's tables and nothing in them.
    fn database() -> Connection {
        let conn = Connection::open_in_memory().expect("a database");
        conn.execute_batch(SCHEMA).expect("the schema");
        conn.execute_batch(LANE_SCHEMA).expect("the lane's schema");
        conn.execute_batch(POSTINGS_SCHEMA)
            .expect("the postings' schema");
        conn
    }

    fn decl() -> RecordDecl {
        let pointer = |text: &str| Pointer::parse(text).expect("a pointer");
        RecordDecl {
            kind: "note".to_owned(),
            standing: true,
            text: vec![pointer("/statement")],
            keys: vec![pointer("/bed")],
            matched: Some(0),
        }
    }

    /// A view that admits affirmed records alone, so its standing clause is in every statement.
    fn view() -> StandingView {
        StandingView {
            own: Vec::new(),
            command_writable: Vec::new(),
            person: vec!["human:local".to_owned()],
            admit: vec![Standing::Affirmed],
            levels: Vec::new(),
        }
    }

    /// The marks of the reader clause, the standing clause and the exclusions.
    const COUNTED: [&str; 3] = ["record_access ax", "record_decisions c", "l.id NOT IN"];

    /// `sql` carries each of `clauses` and is a statement SQLite accepts over the lane.
    fn holds(conn: &Connection, what: &str, sql: &Sql, clauses: &[&str]) -> Vec<String> {
        for clause in clauses {
            assert!(sql.text.contains(clause), "{what}: {clause}: {}", sql.text);
        }
        conn.prepare(&format!("EXPLAIN QUERY PLAN {}", sql.text))
            .expect("prepare")
            .query_map(params_from_iter(&sql.params), |row| row.get(3))
            .expect("query")
            .collect::<Result<_, _>>()
            .expect("rows")
    }

    #[test]
    fn identical_is_one_lookup_by_digest_under_the_reader_and_the_view() {
        let conn = database();
        let (decl, view) = (decl(), view());
        let reader = ReaderFilter::tokens(["space"]).expect("a reader");
        let exclude = ["n1".to_owned()];
        let scope = Scope {
            conn: &conn,
            ns: "notes",
            decl: &decl,
            fields: &[0],
            exclude: &exclude,
            view: &view,
            reader: &reader,
        };
        let keys = [(0, vec!["north".to_owned()])];
        let sql = identical_sql(&scope, &keys, &[7; 32]).expect("the statement");
        // The statement is held to every clause: the key filter, the reader, the view's
        // standing and the exclusions.
        let mut clauses = vec!["record_keys k"];
        clauses.extend(COUNTED);
        let plan = holds(&conn, "identical", &sql, &clauses);
        assert!(
            plan[0].contains(
                "SEARCH l USING INDEX record_lane_by_digest (ns=? AND kind=? AND match_digest=?)"
            ),
            "{plan:?}"
        );
    }

    /// The statements that name only lanes an earlier statement returned, and the counts'
    /// statement, each carry the reader, the standing and the exclusions themselves: the
    /// clauses through the trait would not show their absence, since the earlier statement had
    /// them.
    #[test]
    fn every_follow_on_statement_carries_the_reader_the_standing_and_the_exclusions() {
        let conn = database();
        let (decl, view) = (decl(), view());
        let reader = ReaderFilter::tokens(["space"]).expect("a reader");
        let exclude = ["n1".to_owned()];
        let scope = Scope {
            conn: &conn,
            ns: "notes",
            decl: &decl,
            fields: &[0],
            exclude: &exclude,
            view: &view,
            reader: &reader,
        };
        let lanes = [1, 2, 3];
        let terms = ["mulch", "rose"];
        for (what, sql) in [
            ("a term's count", counts_sql(&scope, &terms)),
            (
                "a candidate's frequencies",
                scope.frequencies_sql(&lanes, &terms),
            ),
            ("a candidate's length", scope.lengths_sql(&lanes)),
            ("a pooled record's terms", terms_sql(&scope, &lanes)),
            ("the hits' records", hits_sql(&scope, &lanes)),
        ] {
            holds(&conn, what, &sql, &COUNTED);
        }
    }

    fn pooled(id: &str, to_record: f64) -> Pooled {
        Pooled {
            lane: 0,
            id: id.to_owned(),
            to_record,
            words: 0.0,
        }
    }

    /// More candidates than the pool holds, all at one score to four places and apart past it:
    /// the pool is the first by id, and the digits past the fourth place decide nothing.
    #[test]
    fn the_pool_ties_at_four_places_and_keeps_the_first_by_id() {
        let count = MATCH_POOL + 6;
        // The higher the id, the higher the unrounded score: by the unrounded score the pool
        // would be the last ids, and by four places and then id it is the first.
        let mut pool: Vec<Pooled> = (0..count)
            .map(|i| pooled(&format!("n{i:03}"), 0.5 + 1e-7 * i as f64))
            .collect();
        pool.reverse();
        // One candidate past the tie by a whole place comes first whatever its id.
        pool.push(pooled("z", 0.5002));
        keep_pool(&mut pool);
        let kept: Vec<&str> = pool.iter().map(|pooled| pooled.id.as_str()).collect();
        let mut expected = vec!["z".to_owned()];
        expected.extend((0..MATCH_POOL - 1).map(|i| format!("n{i:03}")));
        assert_eq!(kept, expected);
    }

    #[test]
    fn a_kind_past_its_bound_is_refused_and_one_at_it_is_not() {
        let conn = database();
        conn.execute(
            "INSERT INTO record_kinds (ns, kind, decl_hash, decl) VALUES ('notes', 'note', 'h', '{}')",
            [],
        )
        .expect("a kind");
        // A kind with no row of postings holds none.
        assert!(
            within_bound(&conn, "notes", "note", 0).is_ok(),
            "an empty kind is within any bound"
        );
        conn.execute(
            "INSERT INTO record_postings (ns, kind, postings) VALUES ('notes', 'note', 10)",
            [],
        )
        .expect("a count");
        assert!(
            within_bound(&conn, "notes", "note", 10).is_ok(),
            "at the bound"
        );
        assert!(matches!(
            within_bound(&conn, "notes", "note", 9),
            Err(Fail::Store(StoreError::LaneTooBroad { limit: 9 }))
        ));
        // Another kind's count is its own.
        assert!(
            within_bound(&conn, "notes", "other", 0).is_ok(),
            "another kind"
        );
    }
}

//! A find under order `rank` (records host specification, sections 7 and 8.2): the once-a-call
//! statistics, the gather under its bound, and the query direction's score, over the searched
//! fields, without counting the query as a record.
//!
//! Over several fields a record's frequency for a term is its sum over them, its length the sum
//! of their token counts, and a count is of the records that hold the term in any of them.

use std::collections::BTreeMap;

use rusqlite::{Connection, params_from_iter};
use umbel_store::lane::score::{Corpus, Posting, round4, score};
use umbel_store::lane::{
    Cursor, FindPage, FindPlan, LaneLimits, RecordDecl, RecordFind, STAT_TERMS, StandingView,
    TextPlan,
};
use umbel_store::{ReaderFilter, Rev, StoreError};

use super::find::{records, select};
use super::{LANE_BATCH, RECORD_COLUMNS, and_keys, and_visible, limit_of, position};
use crate::error::{Fail, to_u64};
use crate::sql::Sql;

/// What the statements of one ranked find share.
struct Scope<'a> {
    conn: &'a Connection,
    ns: &'a str,
    decl: &'a RecordDecl,
    text: &'a TextPlan,
    view: &'a StandingView,
    reader: &'a ReaderFilter,
}

impl Scope<'_> {
    /// `(?, ...)` of the searched fields' positions.
    fn bind_fields(&self, sql: &mut Sql) {
        sql.bind_list(self.text.fields.iter().map(|field| position(*field)));
    }

    /// `N` and `L` of the reader's admitted records: how many there are, and their tokens in
    /// the searched fields. One statement over `record_lane`, with the reader and standing
    /// clauses and no key filter.
    fn corpus(&self) -> Result<Corpus, Fail> {
        let lengths = self
            .text
            .fields
            .iter()
            .map(|field| format!("l.n{field}"))
            .collect::<Vec<_>>()
            .join(" + ");
        let mut sql = Sql::new("SELECT COUNT(*), COALESCE(SUM(");
        sql.push(&lengths)
            .push("), 0) FROM record_lane l WHERE l.ns = ")
            .bind(self.ns)
            .push(" AND l.kind = ")
            .bind(self.decl.kind.as_str());
        and_visible(&mut sql, self.decl, self.view, self.reader);
        let (records, tokens): (i64, i64) =
            self.conn
                .query_row(&sql.text, params_from_iter(&sql.params), |row| {
                    Ok((row.get(0)?, row.get(1)?))
                })?;
        Ok(Corpus {
            records: to_u64(records)?,
            tokens: to_u64(tokens)?,
        })
    }

    /// `df0` of each of the query's terms: how many of the reader's admitted records hold it in
    /// a searched field. A statement reads every posting of at most [`STAT_TERMS`] terms in the
    /// kind and the fields and answers two numbers a term: `scanned`, all of them, whoever may
    /// read them, and `df0`. Past `stat_postings` scanned the call is refused.
    fn counts(&self, stat_postings: u64) -> Result<BTreeMap<&str, u64>, Fail> {
        let mut counts = BTreeMap::new();
        let mut scanned = 0u64;
        for terms in self.text.terms.chunks(STAT_TERMS) {
            let mut sql = Sql::new("SELECT t.term, COUNT(*), COUNT(DISTINCT CASE WHEN 1 = 1");
            and_visible(&mut sql, self.decl, self.view, self.reader);
            sql.push(
                " THEN t.lane END) FROM record_terms t JOIN record_lane l ON l.lane = t.lane WHERE t.ns = ",
            )
            .bind(self.ns)
            .push(" AND t.kind = ")
            .bind(self.decl.kind.as_str())
            .push(" AND t.field IN ");
            self.bind_fields(&mut sql);
            sql.push(" AND t.term IN ")
                .bind_list(terms.iter())
                .push(" GROUP BY t.term");
            let mut statement = self.conn.prepare_cached(&sql.text)?;
            let mut rows = statement.query(params_from_iter(&sql.params))?;
            while let Some(row) = rows.next()? {
                let term: String = row.get(0)?;
                scanned += to_u64(row.get(1)?)?;
                let df = to_u64(row.get(2)?)?;
                if let Some(term) = terms.iter().find(|known| **known == term) {
                    counts.insert(term.as_str(), df);
                }
            }
            if scanned > stat_postings {
                return Err(StoreError::LaneTooBroad {
                    limit: stat_postings,
                }
                .into());
            }
        }
        Ok(counts)
    }

    /// The lanes that hold one of `terms` in a searched field and pass every clause (the key
    /// filters, the reader and the view), in lane order, at most `limit` of them.
    fn gather(
        &self,
        keys: &[(u8, Vec<String>)],
        terms: &[&str],
        limit: Option<u64>,
    ) -> Result<Vec<i64>, Fail> {
        let mut sql = Sql::new(
            "SELECT DISTINCT t.lane FROM record_terms t JOIN record_lane l ON l.lane = t.lane WHERE t.ns = ",
        );
        sql.bind(self.ns)
            .push(" AND t.kind = ")
            .bind(self.decl.kind.as_str())
            .push(" AND t.field IN ");
        self.bind_fields(&mut sql);
        sql.push(" AND t.term IN ").bind_list(terms.iter().copied());
        and_keys(&mut sql, keys);
        and_visible(&mut sql, self.decl, self.view, self.reader);
        sql.push(" ORDER BY t.lane");
        if let Some(limit) = limit {
            sql.push(" LIMIT ").bind(limit_of(limit)?);
        }
        let mut statement = self.conn.prepare_cached(&sql.text)?;
        let lanes = statement
            .query_map(params_from_iter(&sql.params), |row| row.get(0))?
            .collect::<Result<_, _>>()?;
        Ok(lanes)
    }

    /// Each candidate's id, first revision and score: `score(q, d)` from its frequencies for
    /// all of the query's terms and its length in the searched fields.
    fn scored(
        &self,
        corpus: &Corpus,
        counts: &BTreeMap<&str, u64>,
        candidates: &[i64],
    ) -> Result<Vec<Scored>, Fail> {
        let lengths = self
            .text
            .fields
            .iter()
            .map(|field| format!("l.n{field}"))
            .collect::<Vec<_>>()
            .join(" + ");
        let mut scored = Vec::with_capacity(candidates.len());
        for lanes in candidates.chunks(LANE_BATCH) {
            // Each candidate's frequencies, by lane and then by term. Both statements carry the
            // reader and the view again, as every statement over the lane does (section 5.3).
            let mut frequencies: BTreeMap<i64, BTreeMap<String, u32>> = BTreeMap::new();
            {
                let mut sql = Sql::new(
                    "SELECT t.lane, t.term, SUM(t.tf) FROM record_terms t JOIN record_lane l ON l.lane = t.lane WHERE t.lane IN ",
                );
                sql.bind_list(lanes.iter().copied())
                    .push(" AND t.field IN ");
                self.bind_fields(&mut sql);
                sql.push(" AND t.term IN ")
                    .bind_list(self.text.terms.iter());
                and_visible(&mut sql, self.decl, self.view, self.reader);
                sql.push(" GROUP BY t.lane, t.term");
                let mut statement = self.conn.prepare_cached(&sql.text)?;
                let mut rows = statement.query(params_from_iter(&sql.params))?;
                while let Some(row) = rows.next()? {
                    frequencies
                        .entry(row.get(0)?)
                        .or_default()
                        .insert(row.get(1)?, row.get(2)?);
                }
            }
            let none = BTreeMap::new();
            let mut sql = Sql::new("SELECT l.lane, l.id, l.created_rev, ");
            sql.push(&lengths)
                .push(" FROM record_lane l WHERE l.lane IN ")
                .bind_list(lanes.iter().copied());
            and_visible(&mut sql, self.decl, self.view, self.reader);
            let mut statement = self.conn.prepare_cached(&sql.text)?;
            let mut rows = statement.query(params_from_iter(&sql.params))?;
            while let Some(row) = rows.next()? {
                let lane: i64 = row.get(0)?;
                let length: u32 = row.get(3)?;
                // The query's terms are in byte order, so every backend adds in one order.
                let held = frequencies.get(&lane).unwrap_or(&none);
                let postings = self.text.terms.iter().filter_map(|term| {
                    let tf = held.get(term.as_str()).copied()?;
                    let df = counts.get(term.as_str()).copied()?;
                    Some(Posting { df, tf })
                });
                scored.push(Scored {
                    lane,
                    id: row.get(1)?,
                    created: to_u64(row.get(2)?)?,
                    score: round4(score(corpus, length, postings)),
                });
            }
        }
        Ok(scored)
    }
}

/// One candidate with what the order compares.
struct Scored {
    lane: i64,
    id: String,
    created: Rev,
    score: f64,
}

impl Scored {
    /// This candidate's place against `(score, created, id)` in the order of a ranked page:
    /// the score at four places descending, then the first revision descending, then the id in
    /// the byte order of its UTF-8. `Less` when this candidate comes first.
    fn against(&self, score: f64, created: Rev, id: &str) -> std::cmp::Ordering {
        score
            .total_cmp(&self.score)
            .then_with(|| created.cmp(&self.created))
            .then_with(|| self.id.as_bytes().cmp(id.as_bytes()))
    }
}

/// The candidates of section 8.2's steps 1 to 3 and whether the gather was cut. Terms are taken
/// by `df0` ascending, then by their bytes, while the sum of their `df0` stays at or under the
/// bound, and at least one is taken; the bound is compared with `df0`, which no key filter
/// narrows. When the first term alone passes the bound, its postings are read with every clause
/// in lane order with `LIMIT bound + 1`: more than the bound sets `cut` and drops the last.
/// Nothing else sets `cut`.
fn candidates(
    scope: &Scope<'_>,
    keys: &[(u8, Vec<String>)],
    counts: &BTreeMap<&str, u64>,
    bound: u64,
) -> Result<(Vec<i64>, bool), Fail> {
    let mut order: Vec<(&str, u64)> = counts
        .iter()
        .filter(|(_, df)| **df > 0)
        .map(|(term, df)| (*term, *df))
        .collect();
    order.sort_by(|(a, a_df), (b, b_df)| {
        a_df.cmp(b_df).then_with(|| a.as_bytes().cmp(b.as_bytes()))
    });
    let Some((rarest, rarest_df)) = order.first().copied() else {
        return Ok((Vec::new(), false));
    };
    if rarest_df > bound {
        let mut lanes = scope.gather(keys, &[rarest], Some(bound + 1))?;
        let cut = lanes.len() as u64 > bound;
        if cut {
            lanes.pop();
        }
        return Ok((lanes, cut));
    }
    let mut taken = Vec::new();
    let mut sum = 0u64;
    for (term, df) in order {
        if !taken.is_empty() && sum + df > bound {
            break;
        }
        sum += df;
        taken.push(term);
    }
    Ok((scope.gather(keys, &taken, None)?, false))
}

/// A page of a find under order `rank`.
#[allow(clippy::too_many_arguments)]
pub(super) fn ranked(
    conn: &Connection,
    ns: &str,
    decl: &RecordDecl,
    query: &RecordFind,
    plan: &FindPlan,
    text: &TextPlan,
    view: &StandingView,
    reader: &ReaderFilter,
    limits: LaneLimits,
) -> Result<FindPage, Fail> {
    let scope = Scope {
        conn,
        ns,
        decl,
        text,
        view,
        reader,
    };
    let corpus = scope.corpus()?;
    let counts = scope.counts(limits.stat_postings)?;
    let (lanes, cut) = candidates(&scope, &plan.keys, &counts, limits.gather_postings)?;
    let mut scored = scope.scored(&corpus, &counts, &lanes)?;
    scored.sort_by(|a, b| a.against(b.score, b.created, &b.id));
    let total = query.total.then_some(scored.len() as u64);
    if let Some(Cursor::Rank(score, created, id)) = &plan.after {
        scored.retain(|candidate| candidate.against(*score, *created, id).is_gt());
    }
    let limit = query.limit as usize;
    let more = scored.len() > limit;
    scored.truncate(limit);
    let next = more
        .then(|| scored.last())
        .flatten()
        .map(|last| Cursor::Rank(last.score, last.created, last.id.clone()).encode());
    // The page's records, by lane, under the reader and the view once more.
    let mut by_lane = BTreeMap::new();
    for page in scored.chunks(LANE_BATCH) {
        let mut sql = select(RECORD_COLUMNS, ns, &decl.kind);
        sql.push(" AND l.lane IN ")
            .bind_list(page.iter().map(|candidate| candidate.lane));
        and_visible(&mut sql, decl, view, reader);
        by_lane.extend(records(conn, &sql, decl)?);
    }
    Ok(FindPage {
        items: scored
            .iter()
            .filter_map(|candidate| by_lane.remove(&candidate.lane))
            .collect(),
        next,
        total,
        admitted: view.admit.clone(),
        cut,
    })
}

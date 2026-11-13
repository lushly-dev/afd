//! A find under order `rank` (records host specification, sections 7 and 8.2): the once-a-call
//! statistics, the gather under its bound, and the query direction's score, over the searched
//! fields, without counting the query as a record. A match ([`super::matching`]) runs the same
//! statements over its match field, with its excluded ids left out of each.
//!
//! Over several fields a record's frequency for a term is its sum over them, its length the sum
//! of their token counts, and a count is of the records that hold the term in any of them.
//!
//! A ranked find is refused, as a match is, when its kind as a whole holds more postings than
//! the bound ([`within_bound`], after step B4's focused review): its counts read every posting
//! of each query term, whoever may read it, so its work grows with the kind. The bound is the
//! same for every reader and every text, so no refusal depends on which records hold a word.
//! A find by id, by recency or by keys alone is never refused for its size.

use std::collections::BTreeMap;

use rusqlite::{Connection, OptionalExtension, params, params_from_iter};
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

/// What the statements of one ranked find, or of one match, share.
pub(super) struct Scope<'a> {
    pub(super) conn: &'a Connection,
    pub(super) ns: &'a str,
    pub(super) decl: &'a RecordDecl,
    /// The searched text pointers' positions: a find's fields, or a match's one match field.
    pub(super) fields: &'a [u8],
    /// The ids a match leaves out of both lists and out of the statistics; none for a find.
    pub(super) exclude: &'a [String],
    pub(super) view: &'a StandingView,
    pub(super) reader: &'a ReaderFilter,
}

/// One candidate as the query direction needs it.
pub(super) struct Held {
    pub(super) lane: i64,
    pub(super) id: String,
    /// The revision of the record's first put.
    pub(super) created: Rev,
    /// Its tokens in the searched fields.
    pub(super) length: u32,
    /// Its frequency for each of the asked terms it holds.
    pub(super) terms: BTreeMap<String, u32>,
}

impl Scope<'_> {
    /// `(?, ...)` of the searched fields' positions.
    fn bind_fields(&self, sql: &mut Sql) {
        sql.bind_list(self.fields.iter().map(|field| position(*field)));
    }

    /// `l.n<a> + l.n<b>`: a record's tokens in the searched fields.
    fn lengths(&self) -> String {
        self.fields
            .iter()
            .map(|field| format!("l.n{field}"))
            .collect::<Vec<_>>()
            .join(" + ")
    }

    /// ` AND <the reader may read the record> <the view admits it> <the call does not exclude
    /// it>` over `record_lane l`: the three clauses every statistic, every candidate and every
    /// hit is held to (sections 5.3, 6.6 and 8.2).
    pub(super) fn and_counted(&self, sql: &mut Sql) {
        and_visible(sql, self.decl, self.view, self.reader);
        if !self.exclude.is_empty() {
            sql.push(" AND l.id NOT IN ").bind_list(self.exclude.iter());
        }
    }

    /// `N` and `L` of the reader's admitted records: how many there are, and their tokens in
    /// the searched fields. One statement over `record_lane`, with the reader, standing and
    /// exclude clauses and no key filter.
    pub(super) fn corpus(&self) -> Result<Corpus, Fail> {
        let mut sql = Sql::new("SELECT COUNT(*), COALESCE(SUM(");
        sql.push(&self.lengths())
            .push("), 0) FROM record_lane l WHERE l.ns = ")
            .bind(self.ns)
            .push(" AND l.kind = ")
            .bind(self.decl.kind.as_str());
        self.and_counted(&mut sql);
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

    /// The lanes that hold one of `terms` in a searched field and pass every clause (the key
    /// filters, the reader, the view and the exclusions), in lane order, at most `limit` of
    /// them.
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
        self.and_counted(&mut sql);
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

    /// Step 4's frequencies for a batch of candidate lanes: each lane's frequency for each of
    /// `terms` it holds, summed over the searched fields, under the reader, the view and the
    /// exclusions again.
    pub(super) fn frequencies_sql(&self, lanes: &[i64], terms: &[&str]) -> Sql {
        let mut sql = Sql::new(
            "SELECT t.lane, t.term, SUM(t.tf) FROM record_terms t JOIN record_lane l ON l.lane = t.lane WHERE t.lane IN ",
        );
        sql.bind_list(lanes.iter().copied())
            .push(" AND t.field IN ");
        self.bind_fields(&mut sql);
        sql.push(" AND t.term IN ").bind_list(terms.iter().copied());
        self.and_counted(&mut sql);
        sql.push(" GROUP BY t.lane, t.term");
        sql
    }

    /// Step 4's lengths for a batch of candidate lanes: each one's id, first revision and
    /// tokens in the searched fields, under the reader, the view and the exclusions again.
    pub(super) fn lengths_sql(&self, lanes: &[i64]) -> Sql {
        let mut sql = Sql::new("SELECT l.lane, l.id, l.created_rev, ");
        sql.push(&self.lengths())
            .push(" FROM record_lane l WHERE l.lane IN ")
            .bind_list(lanes.iter().copied());
        self.and_counted(&mut sql);
        sql
    }

    /// Each candidate with its id, its first revision, its length in the searched fields and
    /// its frequencies for `terms`: section 8.2's step 4, two statements a batch of lanes
    /// ([`Self::frequencies_sql`] and [`Self::lengths_sql`]). Both carry the reader, the view
    /// and the exclusions again, as every statement over the lane does (section 5.3), though
    /// they name only lanes a statement with them returned.
    pub(super) fn held(&self, candidates: &[i64], terms: &[&str]) -> Result<Vec<Held>, Fail> {
        let mut held = Vec::with_capacity(candidates.len());
        for lanes in candidates.chunks(LANE_BATCH) {
            // Each candidate's frequencies, by lane and then by term.
            let mut frequencies: BTreeMap<i64, BTreeMap<String, u32>> = BTreeMap::new();
            {
                let sql = self.frequencies_sql(lanes, terms);
                let mut statement = self.conn.prepare_cached(&sql.text)?;
                let mut rows = statement.query(params_from_iter(&sql.params))?;
                while let Some(row) = rows.next()? {
                    frequencies
                        .entry(row.get(0)?)
                        .or_default()
                        .insert(row.get(1)?, row.get(2)?);
                }
            }
            let sql = self.lengths_sql(lanes);
            let mut statement = self.conn.prepare_cached(&sql.text)?;
            let mut rows = statement.query(params_from_iter(&sql.params))?;
            while let Some(row) = rows.next()? {
                let lane: i64 = row.get(0)?;
                held.push(Held {
                    lane,
                    id: row.get(1)?,
                    created: to_u64(row.get(2)?)?,
                    length: row.get(3)?,
                    terms: frequencies.remove(&lane).unwrap_or_default(),
                });
            }
        }
        Ok(held)
    }
}

/// The stored counts of one call (section 8.2): `df0` of each term the call has needed, how
/// many of the reader's admitted and not excluded records hold it in a searched field. A term
/// is counted at most once a call, whichever text or pooled record first needs it.
///
/// **Nothing here refuses.** A count is of the records that pass the reader, standing and
/// exclude clauses, and no number of records the reader may not read is taken: after step B4's
/// review a refusal never depends on what a term's postings hold. A match and a ranked find are
/// refused for their kind's size alone, before any count ([`within_bound`]). The statement still
/// reads every posting of each term to find the ones that pass, so its work grows with the
/// term's postings, readable or not: the bound on the kind is what bounds it.
pub(super) struct Counts {
    df0: BTreeMap<String, u64>,
}

impl Counts {
    /// No term counted yet.
    pub(super) fn new() -> Self {
        Self {
            df0: BTreeMap::new(),
        }
    }

    /// `df0` of a term this call has counted; 0 for one it has not, or that no record holds.
    pub(super) fn df0(&self, term: &str) -> u64 {
        self.df0.get(term).copied().unwrap_or(0)
    }

    /// Count each of `terms` this call has not counted yet: one statement for at most
    /// [`STAT_TERMS`] terms, over their postings in the kind and the searched fields whose
    /// record passes the reader, standing and exclude clauses.
    pub(super) fn need<'t>(
        &mut self,
        scope: &Scope<'_>,
        terms: impl IntoIterator<Item = &'t str>,
    ) -> Result<(), Fail> {
        let mut wanted: Vec<&str> = terms
            .into_iter()
            .filter(|term| !self.df0.contains_key(*term))
            .collect();
        wanted.sort_unstable();
        wanted.dedup();
        for terms in wanted.chunks(STAT_TERMS) {
            let sql = counts_sql(scope, terms);
            let mut statement = scope.conn.prepare_cached(&sql.text)?;
            let mut rows = statement.query(params_from_iter(&sql.params))?;
            while let Some(row) = rows.next()? {
                let term: String = row.get(0)?;
                self.df0.insert(term, to_u64(row.get(1)?)?);
            }
            // A term no record holds is counted too: it is not asked for again.
            for term in terms {
                self.df0.entry((*term).to_owned()).or_insert(0);
            }
        }
        Ok(())
    }
}

/// The statement of `df0` for `terms`: how many records that pass the reader, standing and
/// exclude clauses hold each in a searched field.
pub(super) fn counts_sql(scope: &Scope<'_>, terms: &[&str]) -> Sql {
    let mut sql = Sql::new(
        "SELECT t.term, COUNT(DISTINCT t.lane) FROM record_terms t JOIN record_lane l ON l.lane = t.lane WHERE t.ns = ",
    );
    sql.bind(scope.ns)
        .push(" AND t.kind = ")
        .bind(scope.decl.kind.as_str())
        .push(" AND t.field IN ");
    scope.bind_fields(&mut sql);
    sql.push(" AND t.term IN ").bind_list(terms.iter().copied());
    scope.and_counted(&mut sql);
    sql.push(" GROUP BY t.term");
    sql
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
pub(super) fn candidates(
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

/// Section 8.2's bound, checked once a call before anything else is read, by a match and by a
/// ranked find: refused when the kind as a whole holds more than `bound` postings. The count is `record_postings`', which the
/// put and the rebuild keep in their own transactions; nothing here depends on the call's
/// texts or its reader, so every such call of the kind is answered or refused alike.
pub(super) fn within_bound(
    conn: &Connection,
    ns: &str,
    kind: &str,
    bound: u64,
) -> Result<(), Fail> {
    let postings: i64 = conn
        .query_row(
            "SELECT postings FROM record_postings WHERE ns = ?1 AND kind = ?2",
            params![ns, kind],
            |row| row.get(0),
        )
        .optional()?
        .unwrap_or(0);
    if to_u64(postings)? > bound {
        return Err(StoreError::LaneTooBroad { limit: bound }.into());
    }
    Ok(())
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
    // The kind's size first: its counts read every posting of each query term, whoever may
    // read it, so a ranked find of a kind past the bound is refused as a match is.
    within_bound(conn, ns, &decl.kind, limits.match_postings)?;
    let scope = Scope {
        conn,
        ns,
        decl,
        fields: &text.fields,
        exclude: &[],
        view,
        reader,
    };
    let corpus = scope.corpus()?;
    let mut stored = Counts::new();
    stored.need(&scope, text.terms.iter().map(String::as_str))?;
    // The query's terms are in byte order, so every backend adds in one order.
    let terms: Vec<&str> = text.terms.iter().map(String::as_str).collect();
    let counts: BTreeMap<&str, u64> = terms.iter().map(|term| (*term, stored.df0(term))).collect();
    let (lanes, cut) = candidates(&scope, &plan.keys, &counts, limits.gather_postings)?;
    // Each candidate's score: `score(q, d)` from its frequencies for all of the query's terms
    // and its length in the searched fields.
    let mut scored: Vec<Scored> = scope
        .held(&lanes, &terms)?
        .into_iter()
        .map(|held| {
            let postings = terms.iter().filter_map(|term| {
                let tf = held.terms.get(*term).copied()?;
                let df = counts.get(term).copied()?;
                Some(Posting { df, tf })
            });
            Scored {
                lane: held.lane,
                score: round4(score(&corpus, held.length, postings)),
                id: held.id,
                created: held.created,
            }
        })
        .collect();
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
        by_lane.extend(
            records(conn, &sql, decl, view, reader)?
                .into_iter()
                .map(|read| (read.lane, read.record)),
        );
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

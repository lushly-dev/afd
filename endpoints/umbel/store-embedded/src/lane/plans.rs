//! `EXPLAIN QUERY PLAN` inspection for every SQL statement of the record lane (records host
//! specification, step B4 follow-up assigned to step B6).
//!
//! Constructs every statement through the same builders as production reads, finds, matches and
//! rebuilds so plan inspection cannot drift from the executed SQL. Compiled under `test` and
//! `feature = "testkit"` only.

use rusqlite::{Connection, params, params_from_iter};
use umbel_store::lane::{FindOrder, KeyFilter, RecordDecl, RecordFind, StandingView, TextQuery};
use umbel_store::{ReaderFilter, StoreError};

use super::charge::{CHARGE_OF_SQL, MOST_USE_SQL, USE_SQL};
use super::find::{and_filters, select};
use super::matching::{hits_sql, identical_sql, missing_vector_sql, terms_sql, vectors_sql};
use super::rank::{Scope, counts_sql};
use super::reindex::{CHUNK_SQL, FIRST_PUTS_SQL, MISSING_LANE_SQL, VECTOR_BATCH_SQL};
use super::standing::{affirmations_sql, sources_sql};
use super::{RECORD_COLUMNS, and_visible};
use crate::SqliteStore;
use crate::error::Fail;
use crate::sql::Sql;

fn explain(conn: &Connection, sql: &Sql) -> Result<Vec<String>, Fail> {
    let mut stmt = conn.prepare(&format!("EXPLAIN QUERY PLAN {}", sql.text))?;
    let rows = stmt
        .query_map(params_from_iter(&sql.params), |row| row.get::<_, String>(3))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn explain_raw(
    conn: &Connection,
    sql: &str,
    bind: impl rusqlite::Params,
) -> Result<Vec<String>, Fail> {
    let mut stmt = conn.prepare(&format!("EXPLAIN QUERY PLAN {sql}"))?;
    let rows = stmt
        .query_map(bind, |row| row.get::<_, String>(3))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

impl SqliteStore {
    /// Run `EXPLAIN QUERY PLAN` on every SQL statement of the record lane against this live
    /// store, returning `(label, plan_lines)` in deterministic order.
    ///
    /// # Errors
    /// `Invalid` if `decl` is invalid; `Busy`, `Corrupt` or `Io` on SQLite errors.
    pub fn explain_lane_plans(
        &self,
        ns: &str,
        decl: &RecordDecl,
        view: &StandingView,
        reader: &ReaderFilter,
        model: &str,
    ) -> Result<Vec<(String, Vec<String>)>, StoreError> {
        decl.check()?;
        let kind = decl.kind.as_str();
        let fields = [u8::try_from(decl.matched.unwrap_or(0)).unwrap_or(0)];
        let exclude = ["n0".to_owned()];
        let sample_lanes = [1i64, 2, 3];
        let sample_terms = ["roses", "mulch"];
        let key_filters: Vec<(u8, Vec<String>)> = if decl.keys.is_empty() {
            Vec::new()
        } else {
            vec![(0, vec!["north".to_owned()])]
        };

        let find_key = RecordFind {
            kind: decl.kind.clone(),
            keys: decl
                .keys
                .first()
                .map(|key| KeyFilter {
                    key: key.clone(),
                    any: vec!["north".to_owned()],
                })
                .into_iter()
                .collect(),
            standings: Vec::new(),
            verified_only: false,
            text: None,
            order: FindOrder::Id,
            after: None,
            limit: 50,
            total: true,
        };
        let find_key_plan = find_key.plan(decl)?;

        let find_text = RecordFind {
            kind: decl.kind.clone(),
            keys: Vec::new(),
            standings: Vec::new(),
            verified_only: false,
            text: Some(TextQuery {
                query: "prune roses".to_owned(),
                fields: Vec::new(),
            }),
            order: FindOrder::Id,
            after: None,
            limit: 50,
            total: true,
        };
        let find_text_plan = find_text.plan(decl)?;

        self.pool().with(|conn| {
            let tx = conn.transaction()?;
            let scope = Scope {
                conn: &tx,
                ns,
                decl,
                fields: &fields,
                exclude: &exclude,
                view,
                reader,
            };

            let mut out = Vec::new();

            // 1. read_record
            let mut read_sql = select(RECORD_COLUMNS, ns, kind);
            read_sql.push(" AND l.id = ").bind("n00001");
            and_visible(&mut read_sql, decl, view, reader);
            out.push(("read_record".to_owned(), explain(&tx, &read_sql)?));

            // 2. find_records by id (with key filter)
            let mut find_id_sql = select(RECORD_COLUMNS, ns, kind);
            and_filters(&mut find_id_sql, decl, &find_key_plan, view, reader);
            find_id_sql.push(" ORDER BY l.id LIMIT ").bind(51i64);
            out.push(("find_id_key".to_owned(), explain(&tx, &find_id_sql)?));

            // 3. find_records by id (with text filter)
            let mut find_text_sql = select(RECORD_COLUMNS, ns, kind);
            and_filters(&mut find_text_sql, decl, &find_text_plan, view, reader);
            find_text_sql.push(" ORDER BY l.id LIMIT ").bind(51i64);
            out.push(("find_id_text".to_owned(), explain(&tx, &find_text_sql)?));

            // 4. find_records by recent (with key filter)
            let mut find_recent_sql = select(RECORD_COLUMNS, ns, kind);
            and_filters(&mut find_recent_sql, decl, &find_key_plan, view, reader);
            find_recent_sql
                .push(" ORDER BY l.created_rev DESC, l.id LIMIT ")
                .bind(51i64);
            out.push((
                "find_recent_key".to_owned(),
                explain(&tx, &find_recent_sql)?,
            ));

            // 5. find_records total count (with key filter)
            let mut find_total_sql = select("COUNT(*)", ns, kind);
            and_filters(&mut find_total_sql, decl, &find_key_plan, view, reader);
            out.push(("find_total_key".to_owned(), explain(&tx, &find_total_sql)?));

            // 6. within_bound
            out.push((
                "within_bound".to_owned(),
                explain_raw(
                    &tx,
                    "SELECT postings FROM record_postings WHERE ns = ?1 AND kind = ?2",
                    params![ns, kind],
                )?,
            ));

            // 7. corpus (once a call)
            let corpus = scope.corpus_sql();
            out.push(("corpus".to_owned(), explain(&tx, &corpus)?));

            // 8. counts (df0)
            let counts = counts_sql(&scope, &sample_terms);
            out.push(("counts_df0".to_owned(), explain(&tx, &counts)?));

            // 9. gather (unbounded and limited)
            let gather = scope.gather_sql(&key_filters, &sample_terms, None)?;
            out.push(("gather".to_owned(), explain(&tx, &gather)?));
            let gather_cut = scope.gather_sql(&key_filters, &["roses"], Some(20_001))?;
            out.push(("gather_cut".to_owned(), explain(&tx, &gather_cut)?));

            // 10. candidate frequencies
            let freqs = scope.frequencies_sql(&sample_lanes, &sample_terms);
            out.push(("candidate_frequencies".to_owned(), explain(&tx, &freqs)?));

            // 11. candidate lengths
            let lens = scope.lengths_sql(&sample_lanes);
            out.push(("candidate_lengths".to_owned(), explain(&tx, &lens)?));

            // 12. identical lookup
            let ident = identical_sql(&scope, &key_filters, &[7u8; 32])?;
            out.push(("identical".to_owned(), explain(&tx, &ident)?));

            // 13. pooled record full terms
            let terms = terms_sql(&scope, &sample_lanes);
            out.push(("pooled_terms".to_owned(), explain(&tx, &terms)?));

            // 14. final hits load
            let hits = hits_sql(&scope, &sample_lanes);
            out.push(("hits".to_owned(), explain(&tx, &hits)?));

            // 15. missing vector check
            let missing_vec = missing_vector_sql(&scope, &key_filters, model);
            out.push(("missing_vector".to_owned(), explain(&tx, &missing_vec)?));

            // 16. streaming vector scan
            let vec_scan = vectors_sql(&scope, &key_filters, model);
            out.push(("vectors_scan".to_owned(), explain(&tx, &vec_scan)?));

            // 17. reindex chunk
            out.push((
                "reindex_chunk".to_owned(),
                explain_raw(&tx, CHUNK_SQL, params![ns, kind, Some("n00500"), 1000i64])?,
            ));

            // 18. reindex vectors batch
            out.push((
                "reindex_vectors_batch".to_owned(),
                explain_raw(
                    &tx,
                    VECTOR_BATCH_SQL,
                    params![ns, kind, Some("n00500"), model, 64i64],
                )?,
            ));

            // 19. standing affirmations lookup (standing::label)
            let aff = affirmations_sql(&sample_lanes, view, reader);
            out.push(("standing_affirmations".to_owned(), explain(&tx, &aff)?));

            // 20. standing attested sources lookup (standing::label)
            let src = sources_sql(&sample_lanes, view, reader);
            out.push(("standing_sources".to_owned(), explain(&tx, &src)?));

            // 21. reindex missing-lane existence check (step 1.2)
            out.push((
                "reindex_missing_lane".to_owned(),
                explain_raw(&tx, MISSING_LANE_SQL, params![ns, kind])?,
            ));

            // 22. reindex first_puts grouped change-log scan (step 1.2)
            out.push((
                "reindex_first_puts".to_owned(),
                explain_raw(&tx, FIRST_PUTS_SQL, [])?,
            ));

            // 23. the records write quota: one principal's use (a put's step 7.5a, D212)
            out.push((
                "quota_use".to_owned(),
                explain_raw(&tx, USE_SQL, params![ns, kind, "human:local"])?,
            ));

            // 24. a record's charge
            out.push((
                "quota_charge".to_owned(),
                explain_raw(&tx, CHARGE_OF_SQL, [1i64])?,
            ));

            // 25. the largest use of any principal (lane_status)
            out.push((
                "quota_most".to_owned(),
                explain_raw(&tx, MOST_USE_SQL, params![ns, kind])?,
            ));

            Ok(out)
        })
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used, clippy::unwrap_used)]

    use serde_json::json;
    use umbel_store::conformance::samples;
    use umbel_store::lane::{LaneWrite, Pointer, RecordDecl, Standing, StandingView};
    use umbel_store::{DocumentStore, Expect, ReaderFilter};

    use crate::{SqliteStore, StoreOptions};

    #[test]
    fn every_lane_statement_uses_an_index_for_keyed_and_term_lookups() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = SqliteStore::open(dir.path(), "main", StoreOptions::default()).expect("open");
        let decl = RecordDecl {
            kind: "note".to_owned(),
            standing: true,
            text: vec![Pointer::parse("/statement").unwrap()],
            keys: vec![
                Pointer::parse("/bed").unwrap(),
                Pointer::parse("/tags").unwrap(),
            ],
            matched: Some(0),
        };
        let reader = ReaderFilter::tokens(["space"]).unwrap();
        let env = samples::envelope(&["space"], "t", "2026-11-23T00:00:00.000Z");
        for i in 0..25 {
            store
                .put_declared_record(
                    "notes",
                    &decl,
                    &format!("n{i:05}"),
                    json!({
                        "statement": format!("Prune roses and spread mulch in winter bed {i}."),
                        "bed": if i % 2 == 0 { "north" } else { "south" },
                        "tags": ["roses", "winter"],
                    }),
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
        let view = StandingView {
            own: Vec::new(),
            command_writable: Vec::new(),
            person: vec!["human:local".to_owned()],
            admit: vec![Standing::Unverified, Standing::Attested, Standing::Affirmed],
            levels: Vec::new(),
        };
        let plans = store
            .explain_lane_plans("notes", &decl, &view, &reader, "stub@0123456789abcdef")
            .expect("plans");
        assert_eq!(plans.len(), 26);

        let find_plan = |name: &str| -> String {
            plans
                .iter()
                .find(|(n, _)| n == name)
                .unwrap_or_else(|| panic!("missing plan {name}"))
                .1
                .join(" | ")
        };

        assert!(
            find_plan("read_record").contains("USING INDEX sqlite_autoindex_record_lane_1"),
            "{}",
            find_plan("read_record")
        );
        assert!(
            find_plan("within_bound").contains("SEARCH record_postings USING PRIMARY KEY"),
            "{}",
            find_plan("within_bound")
        );
        assert!(
            find_plan("counts_df0").contains("SEARCH t USING PRIMARY KEY"),
            "{}",
            find_plan("counts_df0")
        );
        assert!(
            find_plan("gather").contains("SEARCH t USING PRIMARY KEY"),
            "{}",
            find_plan("gather")
        );
        assert!(
            find_plan("identical").contains("USING INDEX record_lane_by_digest"),
            "{}",
            find_plan("identical")
        );
        assert!(
            find_plan("candidate_frequencies")
                .contains("SEARCH t USING INDEX record_terms_by_lane"),
            "{}",
            find_plan("candidate_frequencies")
        );
        assert!(
            find_plan("candidate_lengths").contains("SEARCH l USING INTEGER PRIMARY KEY"),
            "{}",
            find_plan("candidate_lengths")
        );
        assert!(
            find_plan("pooled_terms").contains("SEARCH t USING INDEX record_terms_by_lane"),
            "{}",
            find_plan("pooled_terms")
        );
        assert!(
            find_plan("hits").contains("SEARCH l USING INTEGER PRIMARY KEY"),
            "{}",
            find_plan("hits")
        );
        assert!(
            find_plan("reindex_chunk")
                .contains("SEARCH records USING PRIMARY KEY (ns=? AND kind=? AND id>?)"),
            "{}",
            find_plan("reindex_chunk")
        );
        assert!(
            find_plan("find_recent_key").contains("record_lane_by_recency"),
            "{}",
            find_plan("find_recent_key")
        );
        let vec_batch_plan = find_plan("reindex_vectors_batch");
        assert!(
            vec_batch_plan.contains(
                "SEARCH l USING INDEX sqlite_autoindex_record_lane_1 (ns=? AND kind=? AND id>?)"
            ),
            "{vec_batch_plan}"
        );
        assert!(
            !vec_batch_plan.contains("USE TEMP B-TREE"),
            "vector batch pagination must not sort the kind: {vec_batch_plan}"
        );
        assert!(
            find_plan("standing_affirmations").contains("SEARCH l USING INTEGER PRIMARY KEY"),
            "{}",
            find_plan("standing_affirmations")
        );
        assert!(
            find_plan("standing_sources").contains("SEARCH l USING INTEGER PRIMARY KEY"),
            "{}",
            find_plan("standing_sources")
        );
        // The quota reads only its principal's rows, from the index alone (D212).
        assert!(
            find_plan("quota_use").contains(
                "SEARCH record_charges USING COVERING INDEX record_charges_by_principal (ns=? AND kind=? AND principal=?)"
            ),
            "{}",
            find_plan("quota_use")
        );
        assert!(
            find_plan("quota_charge").contains("SEARCH record_charges USING INTEGER PRIMARY KEY"),
            "{}",
            find_plan("quota_charge")
        );
        assert!(
            find_plan("quota_most")
                .contains("USING COVERING INDEX record_charges_by_principal (ns=? AND kind=?)"),
            "{}",
            find_plan("quota_most")
        );
    }
}

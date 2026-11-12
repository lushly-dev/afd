//! `read_record` and `find_records` (records host specification, section 7; D164). Orders `id`
//! and `recent` are one statement each; order `rank` is [`super::rank`]'s.

use rusqlite::{Connection, params_from_iter};
use umbel_store::lane::{
    Cursor, FindOrder, FindPage, FindPlan, LaneRecord, RecordDecl, RecordFind, StandingView,
};
use umbel_store::{ReaderFilter, StoreError};

use super::{
    FROM_LANE, RECORD_COLUMNS, Read, and_keys, and_visible, limit_of, position, rank,
    read_from_row, refuse_derivation, require_ready, standing,
};
use crate::SqliteStore;
use crate::error::{Fail, to_i64, to_u64};
use crate::sql::Sql;

/// `SELECT <what> FROM record_lane l JOIN records r ... WHERE l.ns = ? AND l.kind = ?`.
pub(super) fn select(what: &str, ns: &str, kind: &str) -> Sql {
    let mut sql = Sql::new("SELECT ");
    sql.push(what)
        .push(FROM_LANE)
        .bind(ns)
        .push(" AND l.kind = ")
        .bind(kind);
    sql
}

/// ` AND <every filter of the find>`: the key filters, the text as an exact filter (the record
/// holds at least one of the query's terms in a searched field), the reader clause and the
/// standing clause.
fn and_filters(
    sql: &mut Sql,
    decl: &RecordDecl,
    plan: &FindPlan,
    view: &StandingView,
    reader: &ReaderFilter,
) {
    and_keys(sql, &plan.keys);
    if let Some(text) = &plan.text {
        sql.push(" AND EXISTS (SELECT 1 FROM record_terms t WHERE t.lane = l.lane AND t.field IN ")
            .bind_list(text.fields.iter().map(|field| position(*field)))
            .push(" AND t.term IN ")
            .bind_list(text.terms.iter())
            .push(")");
    }
    and_visible(sql, decl, view, reader);
}

/// The rows of `sql` as lane records, in the statement's order, each with its label as `reader`
/// may see it (section 6.5).
pub(super) fn records(
    conn: &Connection,
    sql: &Sql,
    decl: &RecordDecl,
    view: &StandingView,
    reader: &ReaderFilter,
) -> Result<Vec<Read>, Fail> {
    let mut found = Vec::new();
    {
        let mut statement = conn.prepare_cached(&sql.text)?;
        let mut rows = statement.query(params_from_iter(&sql.params))?;
        while let Some(row) = rows.next()? {
            found.push(read_from_row(row)?);
        }
    }
    standing::label(conn, decl, view, reader, &mut found)?;
    Ok(found)
}

/// Orders `id` and `recent`: one statement with every filter, the cursor and `LIMIT limit + 1`,
/// and one more for the total when asked.
fn listed(
    conn: &Connection,
    ns: &str,
    decl: &RecordDecl,
    query: &RecordFind,
    plan: &FindPlan,
    view: &StandingView,
    reader: &ReaderFilter,
) -> Result<FindPage, Fail> {
    let limit = query.limit as usize;
    let mut sql = select(RECORD_COLUMNS, ns, &decl.kind);
    and_filters(&mut sql, decl, plan, view, reader);
    match &plan.after {
        Some(Cursor::Id(id)) => {
            sql.push(" AND l.id > ").bind(id);
        }
        Some(Cursor::Recent(created, id)) => {
            let created = to_i64(*created)?;
            sql.push(" AND (l.created_rev < ")
                .bind(created)
                .push(" OR (l.created_rev = ")
                .bind(created)
                .push(" AND l.id > ")
                .bind(id)
                .push("))");
        }
        // `RecordFind::plan` gives a cursor of the query's own order, and `rank` is not here.
        Some(Cursor::Rank(..)) | None => {}
    }
    sql.push(match query.order {
        FindOrder::Recent => " ORDER BY l.created_rev DESC, l.id LIMIT ",
        _ => " ORDER BY l.id LIMIT ",
    })
    .bind(limit_of(u64::from(query.limit) + 1)?);
    let mut found = records(conn, &sql, decl, view, reader)?;
    let more = found.len() > limit;
    found.truncate(limit);
    let next = more
        .then(|| found.last())
        .flatten()
        .map(|last| match query.order {
            FindOrder::Recent => Cursor::Recent(last.created, last.record.record.id.clone()),
            _ => Cursor::Id(last.record.record.id.clone()),
        })
        .map(|cursor| cursor.encode());
    let total = if query.total {
        let mut count = select("COUNT(*)", ns, &decl.kind);
        and_filters(&mut count, decl, plan, view, reader);
        let total: i64 =
            conn.query_row(&count.text, params_from_iter(&count.params), |r| r.get(0))?;
        Some(to_u64(total)?)
    } else {
        None
    };
    Ok(FindPage {
        items: found.into_iter().map(|read| read.record).collect(),
        next,
        total,
        admitted: view.admit.clone(),
        cut: false,
    })
}

impl SqliteStore {
    pub(crate) fn lane_read(
        &self,
        ns: &str,
        decl: &RecordDecl,
        id: &str,
        view: &StandingView,
        reader: &ReaderFilter,
    ) -> Result<Option<LaneRecord>, StoreError> {
        refuse_derivation(reader)?;
        let mut sql = select(RECORD_COLUMNS, ns, &decl.kind);
        sql.push(" AND l.id = ").bind(id);
        and_visible(&mut sql, decl, view, reader);
        self.pool().with(|conn| {
            // One snapshot for the kind's state and the read.
            let tx = conn.transaction()?;
            require_ready(&tx, ns, decl)?;
            let found = records(&tx, &sql, decl, view, reader)?;
            Ok(found.into_iter().next().map(|read| read.record))
        })
    }

    pub(crate) fn lane_find(
        &self,
        ns: &str,
        decl: &RecordDecl,
        query: &RecordFind,
        view: &StandingView,
        reader: &ReaderFilter,
    ) -> Result<FindPage, StoreError> {
        refuse_derivation(reader)?;
        let plan = query.plan(decl)?;
        let limits = self.lane_limits();
        self.pool().with(|conn| {
            // One snapshot for the kind's state, the page and its total.
            let tx = conn.transaction()?;
            require_ready(&tx, ns, decl)?;
            match (&plan.text, query.order) {
                (Some(text), FindOrder::Rank) => {
                    rank::ranked(&tx, ns, decl, query, &plan, text, view, reader, limits)
                }
                _ => listed(&tx, ns, decl, query, &plan, view, reader),
            }
        })
    }
}

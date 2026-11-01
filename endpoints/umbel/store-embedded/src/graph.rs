//! `GraphStore` over SQLite: contributions per origin document, readable through that
//! document's access set.

use std::collections::HashSet;

use rusqlite::{OptionalExtension, TransactionBehavior, params, params_from_iter};
use umbel_store::{
    Direction, Edge, EdgeKey, GraphBatch, GraphStore, MAX_CONTRIBUTION_ITEMS, MAX_NODE_LOOKUP,
    Node, ReaderFilter, Rev, StoreError, Subgraph, check_identifier,
};

use crate::SqliteStore;
use crate::error::{Fail, to_i64, to_u64};
use crate::sql::Sql;

/// The caps on a graph string: ids and kinds are short, labels may be longer.
const MAX_GRAPH_ID_BYTES: usize = 1024;
const MAX_GRAPH_LABEL_BYTES: usize = 4096;

fn check_text(what: &str, text: &str, max: usize) -> Result<(), StoreError> {
    if text.is_empty() || text.len() > max || text.chars().any(char::is_control) {
        return Err(StoreError::invalid(format!(
            "{what} must be 1 to {max} bytes without a control character"
        )));
    }
    Ok(())
}

/// Everything about a batch that can be checked without the database.
fn check_batch(batch: &GraphBatch) -> Result<(), StoreError> {
    let mut origins = HashSet::new();
    for (doc, contribution) in &batch.entries {
        check_identifier("a graph origin", doc)?;
        if !origins.insert(doc.as_str()) {
            return Err(StoreError::invalid(format!("the batch names `{doc}` twice")));
        }
        let Some(graph) = contribution else { continue };
        if graph.nodes.len() > MAX_CONTRIBUTION_ITEMS || graph.edges.len() > MAX_CONTRIBUTION_ITEMS {
            return Err(StoreError::TooLarge(format!(
                "a contribution holds at most {MAX_CONTRIBUTION_ITEMS} nodes and as many edges"
            )));
        }
        let mut nodes = HashSet::new();
        for node in &graph.nodes {
            check_text("a node id", &node.id, MAX_GRAPH_ID_BYTES)?;
            check_text("a node kind", &node.kind, MAX_GRAPH_ID_BYTES)?;
            check_text("a node label", &node.label, MAX_GRAPH_LABEL_BYTES)?;
            if !nodes.insert(node.id.as_str()) {
                return Err(StoreError::invalid(format!(
                    "`{doc}` contributes node `{}` twice",
                    node.id
                )));
            }
        }
        let mut edges = HashSet::new();
        for edge in &graph.edges {
            check_text("an edge end", &edge.from, MAX_GRAPH_ID_BYTES)?;
            check_text("an edge end", &edge.to, MAX_GRAPH_ID_BYTES)?;
            check_text("an edge kind", &edge.kind, MAX_GRAPH_ID_BYTES)?;
            if i64::try_from(edge.weight).is_err() {
                return Err(StoreError::invalid("an edge weight is at most 2^63 - 1"));
            }
            if !edges.insert((edge.from.as_str(), edge.to.as_str(), edge.kind.as_str())) {
                return Err(StoreError::invalid(format!(
                    "`{doc}` contributes the edge `{}` -{}-> `{}` twice",
                    edge.from, edge.kind, edge.to
                )));
            }
        }
    }
    Ok(())
}

/// Check `applied` against the graph's and the store's revisions, inside the write transaction.
fn check_applied(tx: &rusqlite::Transaction<'_>, applied: Rev) -> Result<(), Fail> {
    let current: i64 = tx.query_row("SELECT rev FROM graph_applied WHERE id = 1", [], |r| r.get(0))?;
    let current = to_u64(current)?;
    if applied < current {
        return Err(StoreError::Conflict { current: Some(current.to_string()) }.into());
    }
    let head: i64 = tx.query_row("SELECT COALESCE(MAX(rev), 0) FROM changes", [], |r| r.get(0))?;
    let head = to_u64(head)?;
    if applied > head {
        return Err(StoreError::invalid(format!(
            "the graph cannot reflect revision {applied}: the store's head is {head}"
        ))
        .into());
    }
    Ok(())
}

fn edge_from_row(row: &rusqlite::Row<'_>) -> Result<Edge, Fail> {
    Ok(Edge { from: row.get(0)?, to: row.get(1)?, kind: row.get(2)?, weight: to_u64(row.get(3)?)? })
}

/// The shared head of an aggregated-edge query: readable origin and both endpoints readable.
fn edges_query(reader: &ReaderFilter) -> Sql {
    let mut sql = Sql::new(
        "SELECT e.from_node, e.to_node, e.kind, SUM(e.weight) FROM edges e WHERE 1 = 1",
    );
    sql.and_doc_readable("e.origin", reader);
    sql.and_node_readable("e.from_node", reader);
    sql.and_node_readable("e.to_node", reader);
    sql
}

impl GraphStore for SqliteStore {
    fn apply(&self, batch: GraphBatch, applied: Rev) -> Result<(), StoreError> {
        check_batch(&batch)?;
        to_i64(applied)?;
        self.pool().with(|conn| {
            let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
            check_applied(&tx, applied)?;
            for (doc, contribution) in &batch.entries {
                if contribution.is_some() {
                    let stored: Option<i64> = tx
                        .query_row("SELECT 1 FROM documents WHERE doc = ?1", [doc], |r| r.get(0))
                        .optional()?;
                    if stored.is_none() {
                        return Err(StoreError::invalid(format!(
                            "`{doc}` is not a stored document, so it cannot originate graph rows"
                        ))
                        .into());
                    }
                }
                tx.execute("DELETE FROM nodes WHERE origin = ?1", [doc])?;
                tx.execute("DELETE FROM edges WHERE origin = ?1", [doc])?;
                let Some(graph) = contribution else { continue };
                for node in &graph.nodes {
                    tx.execute(
                        "INSERT INTO nodes (origin, id, kind, label) VALUES (?1, ?2, ?3, ?4)",
                        params![doc, node.id, node.kind, node.label],
                    )?;
                }
                for edge in &graph.edges {
                    tx.execute(
                        "INSERT INTO edges (origin, from_node, to_node, kind, weight) VALUES (?1, ?2, ?3, ?4, ?5)",
                        params![doc, edge.from, edge.to, edge.kind, to_i64(edge.weight)?],
                    )?;
                }
            }
            tx.execute("UPDATE graph_applied SET rev = ?1 WHERE id = 1", [to_i64(applied)?])?;
            tx.commit()?;
            Ok(())
        })
    }

    fn clear(&self, applied: Rev) -> Result<(), StoreError> {
        to_i64(applied)?;
        self.pool().with(|conn| {
            let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
            check_applied(&tx, applied)?;
            tx.execute("DELETE FROM nodes", [])?;
            tx.execute("DELETE FROM edges", [])?;
            tx.execute("UPDATE graph_applied SET rev = ?1 WHERE id = 1", [to_i64(applied)?])?;
            tx.commit()?;
            Ok(())
        })
    }

    fn applied(&self) -> Result<Rev, StoreError> {
        self.pool().with(|conn| {
            let rev: i64 = conn.query_row("SELECT rev FROM graph_applied WHERE id = 1", [], |r| r.get(0))?;
            Ok(to_u64(rev)?)
        })
    }

    fn neighbors(
        &self,
        node: &str,
        kinds: &[String],
        direction: Direction,
        limit: u32,
        reader: &ReaderFilter,
    ) -> Result<Vec<Edge>, StoreError> {
        if limit == 0 {
            return Err(StoreError::invalid("limit must be at least 1"));
        }
        let mut sql = edges_query(reader);
        match direction {
            Direction::Out => sql.push(" AND e.from_node = ").bind(node),
            Direction::In => sql.push(" AND e.to_node = ").bind(node),
            Direction::Both => sql
                .push(" AND (e.from_node = ")
                .bind(node)
                .push(" OR e.to_node = ")
                .bind(node)
                .push(")"),
        };
        if !kinds.is_empty() {
            sql.push(" AND e.kind IN ").bind_list(kinds.iter().map(String::as_str));
        }
        sql.push(" GROUP BY e.from_node, e.to_node, e.kind ORDER BY e.from_node, e.to_node, e.kind LIMIT ")
            .bind(i64::from(limit));
        self.pool().with(|conn| {
            let mut statement = conn.prepare_cached(&sql.text)?;
            let mut rows = statement.query(params_from_iter(&sql.params))?;
            let mut edges = Vec::new();
            while let Some(row) = rows.next()? {
                edges.push(edge_from_row(row)?);
            }
            Ok(edges)
        })
    }

    fn nodes(&self, ids: &[String], reader: &ReaderFilter) -> Result<Vec<Node>, StoreError> {
        if ids.len() > MAX_NODE_LOOKUP {
            return Err(StoreError::invalid(format!("nodes takes at most {MAX_NODE_LOOKUP} ids")));
        }
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let mut sql = Sql::new("SELECT n.id, MIN(n.kind), MIN(n.label) FROM nodes n WHERE n.id IN ");
        sql.bind_list(ids.iter().map(String::as_str));
        sql.and_doc_readable("n.origin", reader);
        sql.push(" GROUP BY n.id ORDER BY n.id");
        self.pool().with(|conn| {
            let mut statement = conn.prepare_cached(&sql.text)?;
            let mut rows = statement.query(params_from_iter(&sql.params))?;
            let mut nodes = Vec::new();
            while let Some(row) = rows.next()? {
                nodes.push(Node { id: row.get(0)?, kind: row.get(1)?, label: row.get(2)? });
            }
            Ok(nodes)
        })
    }

    fn edges_of_kind(
        &self,
        kind: &str,
        limit: u32,
        after: Option<&EdgeKey>,
        reader: &ReaderFilter,
    ) -> Result<Vec<Edge>, StoreError> {
        if limit == 0 {
            return Err(StoreError::invalid("limit must be at least 1"));
        }
        let mut sql = edges_query(reader);
        sql.push(" AND e.kind = ").bind(kind);
        if let Some(after) = after {
            sql.push(" AND (e.from_node, e.to_node) > (")
                .bind(after.from.as_str())
                .push(", ")
                .bind(after.to.as_str())
                .push(")");
        }
        sql.push(" GROUP BY e.from_node, e.to_node, e.kind ORDER BY e.from_node, e.to_node LIMIT ")
            .bind(i64::from(limit));
        self.pool().with(|conn| {
            let mut statement = conn.prepare_cached(&sql.text)?;
            let mut rows = statement.query(params_from_iter(&sql.params))?;
            let mut edges = Vec::new();
            while let Some(row) = rows.next()? {
                edges.push(edge_from_row(row)?);
            }
            Ok(edges)
        })
    }

    fn subgraph(&self, reader: &ReaderFilter) -> Result<Subgraph, StoreError> {
        let mut nodes_sql = Sql::new("SELECT n.id, MIN(n.kind), MIN(n.label) FROM nodes n WHERE 1 = 1");
        nodes_sql.and_doc_readable("n.origin", reader);
        nodes_sql.push(" GROUP BY n.id ORDER BY n.id");
        let mut edges_sql = edges_query(reader);
        edges_sql.push(" GROUP BY e.from_node, e.to_node, e.kind ORDER BY e.from_node, e.to_node, e.kind");
        self.pool().with(|conn| {
            let tx = conn.transaction()?;
            let mut nodes = Vec::new();
            {
                let mut statement = tx.prepare_cached(&nodes_sql.text)?;
                let mut rows = statement.query(params_from_iter(&nodes_sql.params))?;
                while let Some(row) = rows.next()? {
                    nodes.push(Node { id: row.get(0)?, kind: row.get(1)?, label: row.get(2)? });
                }
            }
            let mut edges = Vec::new();
            {
                let mut statement = tx.prepare_cached(&edges_sql.text)?;
                let mut rows = statement.query(params_from_iter(&edges_sql.params))?;
                while let Some(row) = rows.next()? {
                    edges.push(edge_from_row(row)?);
                }
            }
            Ok(Subgraph { nodes, edges })
        })
    }
}

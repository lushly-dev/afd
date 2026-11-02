//! The structural graph's shared types (specification sections 3.1 and 7.3).

use serde::{Deserialize, Serialize};

use std::collections::HashSet;

use crate::document::{DocId, check_identifier};
use crate::error::{Result, StoreError};

/// The most nodes, and the most edges, one document's contribution may hold.
pub const MAX_CONTRIBUTION_ITEMS: usize = 100_000;
/// The most nodes `GraphStore::nodes` takes at once.
pub const MAX_NODE_LOOKUP: usize = 1000;

/// A graph node: a typed id such as `doc:handbook/deploy`, `tag:ops` or `heading:<doc>#<slug>`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Node {
    /// The typed id.
    pub id: String,
    /// The kind (`document`, `heading`, `directory`, `tag`, `owner`, `symbol`).
    pub kind: String,
    /// A display label.
    pub label: String,
}

/// A directed, typed, weighted edge. A contribution holds one per origin; readers see the
/// aggregate over the origins they can read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Edge {
    /// The source node id.
    pub from: String,
    /// The target node id.
    pub to: String,
    /// The kind (`contains`, `links_to`, `co_cited`, ...).
    pub kind: String,
    /// The weight; a reader sees the sum over readable origins.
    pub weight: u64,
}

/// The `(from, to)` an `edges_of_kind` page continues after.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EdgeKey {
    /// The source node id.
    pub from: String,
    /// The target node id.
    pub to: String,
}

/// Which edges incident to a node `neighbors` follows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    /// Edges leaving the node.
    Out,
    /// Edges arriving at it.
    In,
    /// Both.
    Both,
}

/// What one document contributes to the graph: its nodes and the edges it originates.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct DocGraph {
    /// The nodes this document produced.
    pub nodes: Vec<Node>,
    /// The edges this document originates.
    pub edges: Vec<Edge>,
}

/// A batch for `GraphStore::apply`: for each document, its new contribution, or `None` to remove
/// everything it contributed. Each document appears at most once.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct GraphBatch {
    /// `(origin document, contribution)`.
    pub entries: Vec<(DocId, Option<DocGraph>)>,
}

/// The readable graph of a space: nodes and aggregated edges, serialisable.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Subgraph {
    /// Readable nodes, by id.
    pub nodes: Vec<Node>,
    /// Aggregated edges whose endpoints and origins are readable, by `(from, to, kind)`.
    pub edges: Vec<Edge>,
}

/// The longest node id, edge end or kind, in bytes.
const MAX_GRAPH_ID_BYTES: usize = 1024;
/// The longest node label, in bytes.
const MAX_GRAPH_LABEL_BYTES: usize = 4096;

fn check_text(what: &str, text: &str, max: usize) -> Result<()> {
    if text.is_empty() || text.len() > max || text.chars().any(char::is_control) {
        return Err(StoreError::invalid(format!(
            "{what} must be 1 to {max} bytes without a control character"
        )));
    }
    Ok(())
}

impl GraphBatch {
    /// The checks every backend makes before applying a batch, so all refuse alike: each origin
    /// once, bounded contributions, well-formed ids, no node or edge twice within a
    /// contribution, weights that fit a signed 64-bit integer.
    ///
    /// # Errors
    /// [`StoreError::Invalid`] or [`StoreError::TooLarge`] naming the first rule broken.
    pub fn check(&self) -> Result<()> {
        let mut origins = HashSet::new();
        for (doc, contribution) in &self.entries {
            check_identifier("a graph origin", doc)?;
            if !origins.insert(doc.as_str()) {
                return Err(StoreError::invalid(format!(
                    "the batch names `{doc}` twice"
                )));
            }
            let Some(graph) = contribution else { continue };
            if graph.nodes.len() > MAX_CONTRIBUTION_ITEMS
                || graph.edges.len() > MAX_CONTRIBUTION_ITEMS
            {
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
}

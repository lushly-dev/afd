//! The structural graph's shared types (specification sections 3.1 and 7.3).

use serde::{Deserialize, Serialize};

use crate::document::DocId;

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

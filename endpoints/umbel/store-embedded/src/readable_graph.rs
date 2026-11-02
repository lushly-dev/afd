//! The petgraph form of a space's readable graph (specification section 3.2): built from SQLite
//! on demand and cached per process, so traversals do not re-read it for every call. The cache
//! is derived data, never request state.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use petgraph::stable_graph::{NodeIndex, StableDiGraph};
use petgraph::visit::{EdgeRef, IntoEdgeReferences};
use umbel_store::{
    ContentHash, DocumentStore, GraphStore, Node, ReaderFilter, Rev, StoreError, Subgraph,
};

use crate::SqliteStore;

/// How many readable graphs a process keeps; the least recently used is evicted.
pub const GRAPH_CACHE_ENTRIES: usize = 8;

/// An edge's payload in the petgraph form.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EdgeData {
    /// The edge kind.
    pub kind: String,
    /// The weight summed over the readable origins.
    pub weight: u64,
}

/// A space's readable graph for one reader filter.
#[derive(Debug)]
pub struct ReadableGraph {
    /// The graph: nodes by id, aggregated edges.
    pub graph: StableDiGraph<Node, EdgeData>,
    index: HashMap<String, NodeIndex>,
}

impl ReadableGraph {
    fn from_subgraph(sub: Subgraph) -> Self {
        let mut graph = StableDiGraph::new();
        let mut index = HashMap::with_capacity(sub.nodes.len());
        for node in sub.nodes {
            let id = node.id.clone();
            index.insert(id, graph.add_node(node));
        }
        for edge in sub.edges {
            if let (Some(&from), Some(&to)) = (index.get(&edge.from), index.get(&edge.to)) {
                graph.add_edge(
                    from,
                    to,
                    EdgeData {
                        kind: edge.kind,
                        weight: edge.weight,
                    },
                );
            }
        }
        Self { graph, index }
    }

    /// The graph as the serialisable [`Subgraph`] `GraphStore::subgraph` returns, in the same
    /// order (nodes by id; edges by `(from, to, kind)`, which is how they were added).
    #[must_use]
    pub fn to_subgraph(&self) -> Subgraph {
        Subgraph {
            nodes: self.graph.node_weights().cloned().collect(),
            edges: self
                .graph
                .edge_references()
                .map(|edge| umbel_store::Edge {
                    from: self.graph[edge.source()].id.clone(),
                    to: self.graph[edge.target()].id.clone(),
                    kind: edge.weight().kind.clone(),
                    weight: edge.weight().weight,
                })
                .collect(),
        }
    }

    /// The graph index of a node id.
    #[must_use]
    pub fn node(&self, id: &str) -> Option<NodeIndex> {
        self.index.get(id).copied()
    }
}

/// What a cached graph was built from. Every document write advances the head, so a tightened
/// access set, which hides edges at once (their origin's current set decides), invalidates an
/// entry even though the graph's own applied revision did not move.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Key {
    graph_applied: Rev,
    head: Rev,
    reader: String,
}

/// The per-store cache, least recently used first.
#[derive(Default)]
pub(crate) struct GraphCache {
    entries: Mutex<Vec<(Key, Arc<ReadableGraph>)>>,
}

fn digest(reader: &ReaderFilter) -> String {
    match reader.token_list() {
        None => "derivation".to_owned(),
        Some(tokens) => ContentHash::of(tokens.join("\n").as_bytes()).to_string(),
    }
}

impl SqliteStore {
    /// The space's graph as readable by `reader`, in petgraph form, cached by `(graph applied
    /// revision, head revision, reader filter)`, at most [`GRAPH_CACHE_ENTRIES`] entries.
    ///
    /// # Errors
    /// As [`GraphStore::subgraph`].
    pub fn readable_graph(&self, reader: &ReaderFilter) -> Result<Arc<ReadableGraph>, StoreError> {
        // The key is read before the graph, so a graph built from newer data than its key is
        // filed under a key that no later call asks for.
        let key = Key {
            graph_applied: GraphStore::applied(self)?,
            head: DocumentStore::head(self)?,
            reader: digest(reader),
        };
        if let Ok(mut entries) = self.graph_cache.entries.lock()
            && let Some(at) = entries.iter().position(|(k, _)| *k == key)
        {
            let hit = entries.remove(at);
            let graph = hit.1.clone();
            entries.push(hit);
            return Ok(graph);
        }
        let built = Arc::new(ReadableGraph::from_subgraph(GraphStore::subgraph(
            self, reader,
        )?));
        if let Ok(mut entries) = self.graph_cache.entries.lock() {
            entries.retain(|(k, _)| *k != key);
            entries.push((key, built.clone()));
            while entries.len() > GRAPH_CACHE_ENTRIES {
                entries.remove(0);
            }
        }
        Ok(built)
    }
}

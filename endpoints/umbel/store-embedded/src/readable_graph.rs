//! The petgraph form of a space's readable graph (specification section 3.2): built from SQLite
//! on demand and cached per process, so traversals do not re-read it for every call. The cache
//! is derived data, never request state.
//!
//! The cache has two levels (#1776, D216). The **built graph** is every node and edge row at one
//! applied revision, each naming its origin document, read from SQLite once and shared by every
//! reader, beside the access set of each of its origins. A reader's **view** is filtered from it
//! in memory, with the rules of [`umbel_store::GraphStore::subgraph`]'s query, and the most
//! recently used views are kept. A write that moves the store's head but not the graph's applied
//! revision (a document or plugin-record write) rebuilds nothing: the cache re-reads the access
//! sets of only the origins that the changes since name, and only when one of those sets differs
//! are the views filtered again, still from the same built graph. So a tightened access set
//! still hides its rows at once.
//!
//! A graph write at the applied revision the graph already has ([`umbel_store::GraphStore::apply`]
//! allows it) is seen at once by the process that made it, which counts its writes, and by
//! another process once the applied revision moves.

use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError};

use petgraph::stable_graph::{NodeIndex, StableDiGraph};
use petgraph::visit::{EdgeRef, IntoEdgeReferences};
use rusqlite::{Transaction, params};
use umbel_store::{ContentHash, Edge, Node, ReaderFilter, Rev, StoreError, Subgraph};

use crate::SqliteStore;
use crate::error::{Fail, to_i64, to_u64};

/// How many readers' views a process keeps, beside the one built graph they are filtered from;
/// the least recently used is evicted.
pub const GRAPH_CACHE_ENTRIES: usize = 8;

/// The fewest changes since the cached head past which the cache re-reads every origin's access
/// set rather than the ones those changes name.
const INCREMENTAL_CHANGES: u64 = 1024;

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
    index: std::collections::HashMap<String, NodeIndex>,
}

impl ReadableGraph {
    fn from_subgraph(sub: Subgraph) -> Self {
        let mut graph = StableDiGraph::new();
        let mut index = std::collections::HashMap::with_capacity(sub.nodes.len());
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
                .map(|edge| Edge {
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

/// One node row: the index of its origin in [`Built::origins`], its id, kind and label.
struct NodeRow {
    origin: usize,
    id: String,
    kind: String,
    label: String,
}

/// One edge row: the index of its origin, its endpoints, kind and weight.
struct EdgeRow {
    origin: usize,
    from: String,
    to: String,
    kind: String,
    weight: i64,
}

/// Every row of the graph at one applied revision, unfiltered.
struct Built {
    /// The origin documents, sorted and distinct.
    origins: Vec<String>,
    /// Ordered by id, then origin.
    nodes: Vec<NodeRow>,
    /// Ordered by `(from, to, kind)`, then origin.
    edges: Vec<EdgeRow>,
}

/// What every view is filtered from: the built graph, and its origins' access sets at `head`.
#[derive(Clone)]
struct Shared {
    applied: Rev,
    /// This process's graph writes counted before the built graph was read.
    writes: u64,
    head: Rev,
    built: Arc<Built>,
    /// Per origin, its access tokens sorted; empty for a document no longer stored.
    access: Arc<Vec<Vec<String>>>,
    /// Names this pair of built graph and access sets among every one this cache has held.
    epoch: u64,
}

impl Shared {
    /// Whether this state may answer a call that read `applied`, `head` and `writes`: it is the
    /// same state or a later one.
    fn serves(&self, applied: Rev, head: Rev, writes: u64) -> bool {
        self.applied >= applied && self.head >= head && self.writes >= writes
    }
}

#[derive(Default)]
struct State {
    current: Option<Shared>,
    next_epoch: u64,
}

/// A cached view's key: the state it was filtered from and the reader's digest.
#[derive(Debug, Clone, PartialEq, Eq)]
struct ViewKey {
    epoch: u64,
    reader: String,
}

/// The per-store cache.
#[derive(Default)]
pub(crate) struct GraphCache {
    state: Mutex<State>,
    /// The views, least recently used first.
    views: Mutex<Vec<(ViewKey, Arc<ReadableGraph>)>>,
    /// This process's successful graph writes (`apply` and `clear`). A write that leaves the
    /// applied revision where it was still rebuilds the built graph here.
    writes: AtomicU64,
    /// How many times the built graph was read from SQLite.
    builds: AtomicU64,
}

impl GraphCache {
    /// Count one successful graph write of this process.
    pub(crate) fn wrote(&self) {
        self.writes.fetch_add(1, Ordering::SeqCst);
    }
}

fn digest(reader: &ReaderFilter) -> String {
    match reader.token_list() {
        None => "derivation".to_owned(),
        Some(tokens) => ContentHash::of(tokens.join("\n").as_bytes()).to_string(),
    }
}

/// The graph's applied revision and the store's head, in one statement.
fn revisions(conn: &rusqlite::Connection) -> Result<(Rev, Rev), Fail> {
    let (applied, head): (i64, i64) = conn.query_row(
        "SELECT (SELECT rev FROM graph_applied WHERE id = 1),
                (SELECT COALESCE(MAX(rev), 0) FROM changes)",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    Ok((to_u64(applied)?, to_u64(head)?))
}

fn read_built(tx: &Transaction<'_>) -> Result<Built, Fail> {
    let mut origins: Vec<String> = Vec::new();
    {
        let mut statement = tx
            .prepare_cached("SELECT origin FROM nodes UNION SELECT origin FROM edges ORDER BY 1")?;
        let mut rows = statement.query([])?;
        while let Some(row) = rows.next()? {
            origins.push(row.get(0)?);
        }
    }
    let at = |origin: &str| {
        origins
            .binary_search_by(|probe| probe.as_str().cmp(origin))
            .map_err(|_| Fail::from(StoreError::Corrupt("a graph row's origin vanished".into())))
    };
    let mut nodes = Vec::new();
    {
        let mut statement =
            tx.prepare_cached("SELECT origin, id, kind, label FROM nodes ORDER BY id, origin")?;
        let mut rows = statement.query([])?;
        while let Some(row) = rows.next()? {
            let origin: String = row.get(0)?;
            nodes.push(NodeRow {
                origin: at(&origin)?,
                id: row.get(1)?,
                kind: row.get(2)?,
                label: row.get(3)?,
            });
        }
    }
    let mut edges = Vec::new();
    {
        let mut statement = tx.prepare_cached(
            "SELECT origin, from_node, to_node, kind, weight FROM edges
             ORDER BY from_node, to_node, kind, origin",
        )?;
        let mut rows = statement.query([])?;
        while let Some(row) = rows.next()? {
            let origin: String = row.get(0)?;
            edges.push(EdgeRow {
                origin: at(&origin)?,
                from: row.get(1)?,
                to: row.get(2)?,
                kind: row.get(3)?,
                weight: row.get(4)?,
            });
        }
    }
    Ok(Built {
        origins,
        nodes,
        edges,
    })
}

/// Every origin's access set.
fn read_access(tx: &Transaction<'_>, built: &Built) -> Result<Vec<Vec<String>>, Fail> {
    let mut access = vec![Vec::new(); built.origins.len()];
    let mut statement = tx.prepare_cached(
        "SELECT doc, token FROM doc_access
         WHERE doc IN (SELECT origin FROM nodes UNION SELECT origin FROM edges)
         ORDER BY doc, token",
    )?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        let doc: String = row.get(0)?;
        if let Ok(at) = built.origins.binary_search(&doc) {
            access[at].push(row.get(1)?);
        }
    }
    Ok(access)
}

/// The access sets of `previous` with those of the origins that a change after `since` names
/// read again, or `None` when none of them differs. Only a document's `put` or `delete` changes
/// its access set; a change of another kind whose target happens to equal an origin's id costs
/// one read and changes nothing.
fn reread_access(
    tx: &Transaction<'_>,
    built: &Built,
    previous: &[Vec<String>],
    since: Rev,
) -> Result<Option<Vec<Vec<String>>>, Fail> {
    let mut changed: Vec<usize> = Vec::new();
    {
        let mut statement =
            tx.prepare_cached("SELECT DISTINCT target FROM changes WHERE rev > ?1")?;
        let mut rows = statement.query([to_i64(since)?])?;
        while let Some(row) = rows.next()? {
            let target: String = row.get(0)?;
            if let Ok(at) = built.origins.binary_search(&target) {
                changed.push(at);
            }
        }
    }
    let mut access: Option<Vec<Vec<String>>> = None;
    let mut statement =
        tx.prepare_cached("SELECT token FROM doc_access WHERE doc = ?1 ORDER BY token")?;
    for at in changed {
        let tokens: Vec<String> = statement
            .query_map(params![built.origins[at]], |r| r.get(0))?
            .collect::<Result<_, _>>()?;
        if tokens != previous[at] {
            access.get_or_insert_with(|| previous.to_vec())[at] = tokens;
        }
    }
    Ok(access)
}

/// `reader`'s view of `built` with the origins' `access`: what the query of
/// [`umbel_store::GraphStore::subgraph`] selects. A node is readable when one of its rows'
/// origins is, and takes the least kind and the least label of its readable rows. An edge is
/// readable when its origin is and both its endpoints are readable nodes, and its weight is the
/// sum over its readable origins. (The derivation reader's query also returns edges whose
/// endpoint is no node; the petgraph form has never held those.)
fn view(built: &Built, access: &[Vec<String>], reader: &ReaderFilter) -> Result<Subgraph, Fail> {
    let readable: Vec<bool> = match reader.token_list() {
        None => vec![true; built.origins.len()],
        Some(tokens) => {
            let tokens: HashSet<&str> = tokens.iter().map(String::as_str).collect();
            access
                .iter()
                .map(|set| set.iter().any(|token| tokens.contains(token.as_str())))
                .collect()
        }
    };
    let mut nodes: Vec<Node> = Vec::new();
    for group in built.nodes.chunk_by(|a, b| a.id == b.id) {
        let mut kind: Option<&str> = None;
        let mut label: Option<&str> = None;
        for row in group.iter().filter(|row| readable[row.origin]) {
            kind = Some(kind.map_or(row.kind.as_str(), |k| k.min(row.kind.as_str())));
            label = Some(label.map_or(row.label.as_str(), |l| l.min(row.label.as_str())));
        }
        if let (Some(kind), Some(label), Some(first)) = (kind, label, group.first()) {
            nodes.push(Node {
                id: first.id.clone(),
                kind: kind.to_owned(),
                label: label.to_owned(),
            });
        }
    }
    let present: HashSet<&str> = nodes.iter().map(|node| node.id.as_str()).collect();
    let mut edges: Vec<Edge> = Vec::new();
    let same = |a: &EdgeRow, b: &EdgeRow| a.from == b.from && a.to == b.to && a.kind == b.kind;
    for group in built.edges.chunk_by(same) {
        let Some(first) = group.first() else { continue };
        if !present.contains(first.from.as_str()) || !present.contains(first.to.as_str()) {
            continue;
        }
        let mut weight: Option<i64> = None;
        for row in group.iter().filter(|row| readable[row.origin]) {
            weight = Some(
                weight
                    .unwrap_or(0)
                    .checked_add(row.weight)
                    .ok_or_else(|| StoreError::Io("an edge's summed weight overflows".into()))?,
            );
        }
        if let Some(weight) = weight {
            edges.push(Edge {
                from: first.from.clone(),
                to: first.to.clone(),
                kind: first.kind.clone(),
                weight: to_u64(weight)?,
            });
        }
    }
    Ok(Subgraph { nodes, edges })
}

impl SqliteStore {
    /// The space's graph as readable by `reader`, in petgraph form: filtered from the built
    /// graph of the graph's applied revision, which every reader shares, and cached by that and
    /// the reader filter, at most [`GRAPH_CACHE_ENTRIES`] views.
    ///
    /// # Errors
    /// As [`umbel_store::GraphStore::subgraph`].
    pub fn readable_graph(&self, reader: &ReaderFilter) -> Result<Arc<ReadableGraph>, StoreError> {
        // The write count is read before the revisions, so a built graph read after a write of
        // this process is filed under a count no later call asks for.
        let writes = self.graph_cache.writes.load(Ordering::SeqCst);
        let (applied, head) = self.pool().with(|conn| revisions(conn))?;
        let shared = self.shared(applied, head, writes)?;
        let key = ViewKey {
            epoch: shared.epoch,
            reader: digest(reader),
        };
        {
            let mut views = self
                .graph_cache
                .views
                .lock()
                .unwrap_or_else(PoisonError::into_inner);
            if let Some(at) = views.iter().position(|(k, _)| *k == key) {
                let hit = views.remove(at);
                let graph = Arc::clone(&hit.1);
                views.push(hit);
                return Ok(graph);
            }
        }
        let built = Arc::new(ReadableGraph::from_subgraph(
            view(&shared.built, &shared.access, reader).map_err(StoreError::from)?,
        ));
        let mut views = self
            .graph_cache
            .views
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        // A view of an older state than one already kept is answered and not kept: no later call
        // asks for it.
        if views.iter().all(|(k, _)| k.epoch <= key.epoch) {
            views.retain(|(k, _)| k.epoch == key.epoch && *k != key);
            views.push((key, Arc::clone(&built)));
            while views.len() > GRAPH_CACHE_ENTRIES {
                views.remove(0);
            }
        }
        Ok(built)
    }

    /// The state that answers a call that read `applied`, `head` and `writes`: the cached one
    /// when it is as recent, else brought up to date under the lock, so concurrent calls read
    /// SQLite once.
    fn shared(&self, applied: Rev, head: Rev, writes: u64) -> Result<Shared, StoreError> {
        let mut state = self
            .graph_cache
            .state
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        if let Some(current) = &state.current
            && current.serves(applied, head, writes)
        {
            return Ok(current.clone());
        }
        let previous = state.current.clone();
        let next_epoch = state.next_epoch;
        // Read again under the lock, before the snapshot: a count read earlier may be older than
        // the cached state's, and filing a new state under it would rebuild twice.
        let writes = self.graph_cache.writes.load(Ordering::SeqCst);
        let refreshed = self.pool().with(|conn| {
            let tx = conn.transaction()?;
            let (applied, head) = revisions(&tx)?;
            let same_graph = previous
                .as_ref()
                .filter(|p| p.applied == applied && p.writes == writes && head >= p.head);
            let refreshed = match same_graph {
                Some(p)
                    if head - p.head
                        < INCREMENTAL_CHANGES
                            .max(u64::try_from(p.built.origins.len()).unwrap_or(u64::MAX)) =>
                {
                    match reread_access(&tx, &p.built, &p.access, p.head)? {
                        None => Shared { head, ..p.clone() },
                        Some(access) => Shared {
                            head,
                            access: Arc::new(access),
                            epoch: next_epoch,
                            ..p.clone()
                        },
                    }
                }
                Some(p) => {
                    let access = read_access(&tx, &p.built)?;
                    if access == *p.access {
                        Shared { head, ..p.clone() }
                    } else {
                        Shared {
                            head,
                            access: Arc::new(access),
                            epoch: next_epoch,
                            ..p.clone()
                        }
                    }
                }
                None => {
                    let built = read_built(&tx)?;
                    self.graph_cache.builds.fetch_add(1, Ordering::SeqCst);
                    let access = read_access(&tx, &built)?;
                    Shared {
                        applied,
                        writes,
                        head,
                        built: Arc::new(built),
                        access: Arc::new(access),
                        epoch: next_epoch,
                    }
                }
            };
            tx.commit()?;
            Ok(refreshed)
        })?;
        if refreshed.epoch == next_epoch {
            state.next_epoch += 1;
        }
        state.current = Some(refreshed.clone());
        Ok(refreshed)
    }

    /// How many times this store's readable-graph cache read the built graph from SQLite.
    /// Compiled in only with the `testkit` feature.
    #[cfg(feature = "testkit")]
    #[must_use]
    pub fn readable_graph_builds(&self) -> u64 {
        self.graph_cache.builds.load(Ordering::SeqCst)
    }
}

//! The readable-graph cache shares one built graph between readers (#1776, D216): every reader's
//! view is filtered from it, and none ever holds a node or edge it cannot read.
//!
//! Each check holds a view to two oracles: the SQL query of `GraphStore::subgraph` for the same
//! reader, and this file's own model of which documents the reader can read, computed from the
//! access sets the test wrote and nothing the store answers.
use crate::support;
use std::collections::{BTreeMap, BTreeSet};

use umbel_store::conformance::samples;
use umbel_store::{
    DocGraph, DocumentStore, Edge, Expect, GraphBatch, GraphStore, Node, ReaderFilter, Subgraph,
};
use umbel_store_embedded::{SqliteStore, StoreOptions};

const AT: &str = "2026-11-26T09:00:00.000Z";
const TOKENS: [&str; 4] = ["space", "group:a", "group:b", "group:c"];
const DOCS: usize = 8;

fn doc(n: usize) -> String {
    format!("notes/d{n}")
}

/// Every reader the checks hold views to: the derivation reader, each token alone, pairs, all of
/// them, and a reader with no token.
fn readers() -> Vec<(String, ReaderFilter, Option<BTreeSet<String>>)> {
    let mut readers = vec![("derivation".to_owned(), ReaderFilter::derivation(), None)];
    let mut sets: Vec<Vec<&str>> = vec![vec![]];
    sets.extend(TOKENS.iter().map(|t| vec![*t]));
    sets.push(vec!["group:a", "group:b"]);
    sets.push(vec!["space", "group:c"]);
    sets.push(TOKENS.to_vec());
    for set in sets {
        readers.push((
            format!("{set:?}"),
            ReaderFilter::tokens(set.iter().copied()).expect("a reader"),
            Some(set.iter().map(|t| (*t).to_owned()).collect()),
        ));
    }
    readers
}

/// A small deterministic generator, so a failing case is the same case every run.
struct Lcg(u64);

impl Lcg {
    fn next(&mut self, below: usize) -> usize {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        ((self.0 >> 33) % below as u64) as usize
    }

    fn access(&mut self) -> Vec<&'static str> {
        let mut set: Vec<&str> = TOKENS
            .iter()
            .copied()
            .filter(|_| self.next(3) == 0)
            .collect();
        if set.is_empty() {
            set.push(TOKENS[self.next(TOKENS.len())]);
        }
        set
    }
}

/// The contributions: nodes shared by several documents with differing kinds and labels, edges
/// between them, an edge whose endpoint no document produced, and the same edge from several
/// origins so weights sum.
fn contributions(rng: &mut Lcg) -> Vec<(String, Option<DocGraph>)> {
    (0..DOCS)
        .map(|n| {
            let mut nodes = vec![Node {
                id: format!("doc:{}", doc(n)),
                kind: "document".to_owned(),
                label: doc(n),
            }];
            for _ in 0..3 {
                let shared = rng.next(5);
                nodes.push(Node {
                    id: format!("tag:t{shared}"),
                    kind: format!("tag-{}", rng.next(3)),
                    label: format!("label {}", rng.next(4)),
                });
            }
            nodes.sort_by(|a, b| a.id.cmp(&b.id));
            nodes.dedup_by(|a, b| a.id == b.id);
            let mut edges: Vec<Edge> = nodes
                .iter()
                .skip(1)
                .map(|tag| Edge {
                    from: format!("doc:{}", doc(n)),
                    to: tag.id.clone(),
                    kind: "tagged".to_owned(),
                    weight: 1 + rng.next(3) as u64,
                })
                .collect();
            // An edge between two tags, which other documents may also originate.
            edges.push(Edge {
                from: format!("tag:t{}", rng.next(5)),
                to: format!("tag:t{}", rng.next(5)),
                kind: "near".to_owned(),
                weight: 1 + rng.next(4) as u64,
            });
            // An edge to a node no document produced.
            edges.push(Edge {
                from: format!("doc:{}", doc(n)),
                to: "missing:nowhere".to_owned(),
                kind: "links".to_owned(),
                weight: 1,
            });
            edges.sort_by(|a, b| (&a.from, &a.to, &a.kind).cmp(&(&b.from, &b.to, &b.kind)));
            edges.dedup_by(|a, b| (&a.from, &a.to, &a.kind) == (&b.from, &b.to, &b.kind));
            (doc(n), Some(DocGraph { nodes, edges }))
        })
        .collect()
}

/// What `reader` can read under the model: the derivation reader everything, a token reader the
/// rows of the documents whose access set the test last wrote shares one of its tokens.
fn expected(
    graph: &[(String, Option<DocGraph>)],
    access: &BTreeMap<String, Vec<&str>>,
    tokens: Option<&BTreeSet<String>>,
) -> Subgraph {
    let readable = |origin: &str| match tokens {
        None => true,
        Some(tokens) => access
            .get(origin)
            .is_some_and(|set| set.iter().any(|t| tokens.contains(*t))),
    };
    let mut nodes: BTreeMap<String, (String, String)> = BTreeMap::new();
    for (origin, contribution) in graph {
        let Some(contribution) = contribution else {
            continue;
        };
        if !readable(origin) {
            continue;
        }
        for node in &contribution.nodes {
            let entry = nodes
                .entry(node.id.clone())
                .or_insert_with(|| (node.kind.clone(), node.label.clone()));
            entry.0 = entry.0.clone().min(node.kind.clone());
            entry.1 = entry.1.clone().min(node.label.clone());
        }
    }
    let mut edges: BTreeMap<(String, String, String), u64> = BTreeMap::new();
    for (origin, contribution) in graph {
        let Some(contribution) = contribution else {
            continue;
        };
        if !readable(origin) {
            continue;
        }
        for edge in &contribution.edges {
            if nodes.contains_key(&edge.from) && nodes.contains_key(&edge.to) {
                *edges
                    .entry((edge.from.clone(), edge.to.clone(), edge.kind.clone()))
                    .or_default() += edge.weight;
            }
        }
    }
    Subgraph {
        nodes: nodes
            .into_iter()
            .map(|(id, (kind, label))| Node { id, kind, label })
            .collect(),
        edges: edges
            .into_iter()
            .map(|((from, to, kind), weight)| Edge {
                from,
                to,
                kind,
                weight,
            })
            .collect(),
    }
}

/// The SQL query's answer without the edges whose endpoint is not a readable node, which only
/// the derivation reader's query returns and no petgraph form holds.
fn sql(store: &SqliteStore, reader: &ReaderFilter) -> Subgraph {
    let mut sub = store.subgraph(reader).expect("subgraph");
    let ids: BTreeSet<String> = sub.nodes.iter().map(|n| n.id.clone()).collect();
    sub.edges
        .retain(|e| ids.contains(&e.from) && ids.contains(&e.to));
    sub
}

fn check(
    store: &SqliteStore,
    graph: &[(String, Option<DocGraph>)],
    access: &BTreeMap<String, Vec<&str>>,
    step: &str,
) {
    for (name, reader, tokens) in readers() {
        let view = store.readable_graph(&reader).expect("graph").to_subgraph();
        let model = expected(graph, access, tokens.as_ref());
        assert_eq!(view, model, "{step}: reader {name} against the model");
        assert_eq!(
            view,
            sql(store, &reader),
            "{step}: reader {name} against SQL"
        );
    }
}

fn put(store: &SqliteStore, id: &str, access: &[&str]) {
    store
        .put_document(samples::document(id, access, id, "t"), Expect::Any)
        .expect("put");
}

#[test]
fn a_reader_never_sees_a_node_or_edge_it_cannot_read_from_the_shared_graph() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let stores = support::open(dir.path(), "main").expect("opening");
    let store = SqliteStore::open(dir.path(), "main", StoreOptions::default()).expect("opening");
    let mut rng = Lcg(1776);
    let mut access: BTreeMap<String, Vec<&str>> = BTreeMap::new();
    for n in 0..DOCS {
        let set = rng.access();
        put(&store, &doc(n), &set);
        access.insert(doc(n), set);
    }
    let graph = contributions(&mut rng);
    store
        .apply(
            GraphBatch {
                entries: graph.clone(),
            },
            u64::try_from(DOCS).expect("a revision"),
        )
        .expect("apply");
    drop(stores);
    check(&store, &graph, &access, "first");
    assert_eq!(
        store.readable_graph_builds(),
        1,
        "one built graph for every reader"
    );

    // Access changes, deletions and writes that are not graph writes: each view stays exactly
    // what its reader can read, and the graph is never built again.
    for step in 0..120 {
        let n = rng.next(DOCS);
        match rng.next(6) {
            0 => {
                store
                    .delete_document(&doc(n), Expect::Any, samples::envelope(&["space"], "t", AT))
                    .ok();
                access.remove(&doc(n));
            }
            1 => {
                // A document outside the graph.
                put(&store, &format!("other/x{step}"), &rng.access());
            }
            2 => {
                store
                    .put_record(
                        "notes",
                        "note",
                        &format!("r{step}"),
                        serde_json::json!({"text": "a record"}),
                        samples::envelope(&["space"], "t", AT),
                        Expect::Any,
                    )
                    .expect("put_record");
            }
            3 => {
                // The same access again: a write that changes nothing a reader can see.
                let same = access
                    .get(&doc(n))
                    .cloned()
                    .unwrap_or_else(|| vec!["space"]);
                put(&store, &doc(n), &same);
                access.insert(doc(n), same);
            }
            _ => {
                let set = rng.access();
                put(&store, &doc(n), &set);
                access.insert(doc(n), set);
            }
        }
        check(&store, &graph, &access, &format!("step {step}"));
    }
    assert_eq!(
        store.readable_graph_builds(),
        1,
        "no document or record write rebuilt the graph"
    );

    // A graph write builds it again, once, for every reader.
    let head = store.head().expect("head");
    let mut graph = graph;
    graph[0].1 = None;
    store
        .apply(
            GraphBatch {
                entries: vec![(graph[0].0.clone(), None)],
            },
            head,
        )
        .expect("apply");
    check(&store, &graph, &access, "after a graph write");
    assert_eq!(store.readable_graph_builds(), 2);
    // Another graph write at the same applied revision is seen too. (The document must be
    // stored to originate rows; putting it moves the head, which alone rebuilds nothing.)
    put(&store, &doc(0), &["space"]);
    access.insert(doc(0), vec!["space"]);
    check(
        &store,
        &graph,
        &access,
        "before a write at the same revision",
    );
    assert_eq!(store.readable_graph_builds(), 2);
    let restored = contributions(&mut Lcg(1776)).swap_remove(0);
    store
        .apply(
            GraphBatch {
                entries: vec![restored.clone()],
            },
            head,
        )
        .expect("apply");
    graph[0] = restored;
    check(
        &store,
        &graph,
        &access,
        "after a write at the same revision",
    );
    assert_eq!(store.readable_graph_builds(), 3);
}

#[test]
fn views_of_a_reader_are_shared_until_an_access_set_it_depends_on_changes() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let stores = support::open(dir.path(), "main").expect("opening");
    let store = SqliteStore::open(dir.path(), "main", StoreOptions::default()).expect("opening");
    put(&store, "notes/open", &["space"]);
    put(&store, "notes/secret", &["group:sec"]);
    let node = |id: &str| Node {
        id: id.to_owned(),
        kind: "document".to_owned(),
        label: id.to_owned(),
    };
    store
        .apply(
            GraphBatch {
                entries: vec![
                    (
                        "notes/open".into(),
                        Some(DocGraph {
                            nodes: vec![node("doc:open"), node("tag:shared")],
                            edges: vec![Edge {
                                from: "doc:open".into(),
                                to: "tag:shared".into(),
                                kind: "tagged".into(),
                                weight: 1,
                            }],
                        }),
                    ),
                    (
                        "notes/secret".into(),
                        Some(DocGraph {
                            nodes: vec![node("doc:secret"), node("tag:shared")],
                            edges: vec![Edge {
                                from: "doc:secret".into(),
                                to: "tag:shared".into(),
                                kind: "tagged".into(),
                                weight: 1,
                            }],
                        }),
                    ),
                ],
            },
            2,
        )
        .expect("apply");
    drop(stores);
    let outsider = ReaderFilter::tokens(["space"]).expect("a reader");
    let first = store.readable_graph(&outsider).expect("graph");
    // A record write and a write to a document outside the graph move the head: the same view.
    store
        .put_record(
            "notes",
            "note",
            "r1",
            serde_json::json!({"text": "a record"}),
            samples::envelope(&["space"], "t", AT),
            Expect::Any,
        )
        .expect("put_record");
    put(&store, "other/x", &["space"]);
    let again = store.readable_graph(&outsider).expect("graph");
    assert!(
        std::sync::Arc::ptr_eq(&first, &again),
        "served from the cache"
    );
    // Loosening the secret's access shows its rows at once, from the same built graph.
    put(&store, "notes/secret", &["space"]);
    let loosened = store.readable_graph(&outsider).expect("graph");
    assert!(loosened.node("doc:secret").is_some());
    assert_eq!(loosened.graph.edge_count(), 2);
    // Tightening both hides everything at once.
    put(&store, "notes/secret", &["group:sec"]);
    put(&store, "notes/open", &["group:sec"]);
    let hidden = store.readable_graph(&outsider).expect("graph");
    assert_eq!(hidden.graph.node_count(), 0);
    assert_eq!(store.readable_graph_builds(), 1);
}

/// A store with two documents in the graph, `notes/open` and `notes/secret`, sharing a tag.
fn two_documents() -> (tempfile::TempDir, SqliteStore) {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let stores = support::open(dir.path(), "main").expect("opening");
    let store = SqliteStore::open(dir.path(), "main", StoreOptions::default()).expect("opening");
    put(&store, "notes/open", &["space"]);
    put(&store, "notes/secret", &["group:sec"]);
    let contribution = |doc: &str| DocGraph {
        nodes: vec![
            Node {
                id: format!("doc:{doc}"),
                kind: "document".into(),
                label: doc.into(),
            },
            Node {
                id: "tag:shared".into(),
                kind: "tag".into(),
                label: "shared".into(),
            },
        ],
        edges: vec![Edge {
            from: format!("doc:{doc}"),
            to: "tag:shared".into(),
            kind: "tagged".into(),
            weight: 1,
        }],
    };
    store
        .apply(
            GraphBatch {
                entries: vec![
                    ("notes/open".into(), Some(contribution("open"))),
                    ("notes/secret".into(), Some(contribution("secret"))),
                ],
            },
            2,
        )
        .expect("apply");
    drop(stores);
    (dir, store)
}

#[test]
fn a_tightening_after_a_thousand_writes_or_from_another_process_hides_at_once() {
    let (dir, store) = two_documents();
    let outsider = ReaderFilter::tokens(["space"]).expect("a reader");
    assert!(
        store
            .readable_graph(&outsider)
            .expect("graph")
            .node("doc:open")
            .is_some()
    );
    // More changes since the cached head than the cache reads one by one: it re-reads every
    // origin's access set, and still rebuilds nothing.
    for n in 0..1_100 {
        store
            .put_record(
                "notes",
                "note",
                &format!("r{n}"),
                serde_json::json!({"text": "a record"}),
                samples::envelope(&["space"], "t", AT),
                Expect::Any,
            )
            .expect("put_record");
    }
    put(&store, "notes/open", &["group:sec"]);
    let hidden = store.readable_graph(&outsider).expect("graph");
    assert_eq!(hidden.graph.node_count(), 0, "hidden at once");
    assert_eq!(hidden.to_subgraph(), sql(&store, &outsider));
    // Another process, here a second handle on the same files, loosens it again: this
    // process's cache sees it on its next read.
    let other = SqliteStore::open(dir.path(), "main", StoreOptions::default()).expect("opening");
    put(&other, "notes/open", &["space"]);
    let shown = store.readable_graph(&outsider).expect("graph");
    assert!(shown.node("doc:open").is_some() && shown.node("doc:secret").is_none());
    assert_eq!(shown.to_subgraph(), sql(&store, &outsider));
    // And tightens it, the cache's head already past the change before.
    put(&other, "notes/open", &["group:sec"]);
    let again = store.readable_graph(&outsider).expect("graph");
    assert_eq!(again.graph.node_count(), 0);
    assert_eq!(store.readable_graph_builds(), 1);
}

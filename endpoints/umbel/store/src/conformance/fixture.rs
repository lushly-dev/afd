//! The access fixture (`fixtures/access/documents.json`): 40 documents with six access shapes,
//! links and tags, loaded into the stores and mirrored by an independent oracle that says what
//! each reader may see.

use std::collections::{BTreeMap, BTreeSet};

use serde::Deserialize;

use super::{Ctx, Stores, samples};
use crate::{DocGraph, Edge, Expect, GraphBatch, Node, ReaderFilter};
use serde_json::json;

const FIXTURE: &str = include_str!("../../fixtures/access/documents.json");

/// The namespace and kind of the fixture's records.
pub(super) const RECORD_NS: &str = "fixture";
pub(super) const RECORD_KIND: &str = "note";

#[derive(Deserialize)]
pub(super) struct FixtureDoc {
    pub(super) id: String,
    pub(super) collection: String,
    pub(super) title: String,
    pub(super) access: Vec<String>,
    pub(super) tags: Vec<String>,
    #[serde(rename = "type")]
    pub(super) doc_type: String,
    pub(super) links: Vec<String>,
}

#[derive(Deserialize)]
pub(super) struct Fixture {
    pub(super) readers: BTreeMap<String, Vec<String>>,
    pub(super) documents: Vec<FixtureDoc>,
}

pub(super) fn load() -> Result<Fixture, String> {
    serde_json::from_str(FIXTURE).map_err(|e| format!("the access fixture does not parse: {e}"))
}

impl FixtureDoc {
    fn access_refs(&self) -> Vec<&str> {
        self.access.iter().map(String::as_str).collect()
    }

    /// What this document contributes to the graph: its document and tag nodes, `links_to` and
    /// `tagged` edges, and `co_cited` between every ordered pair of distinct link targets.
    pub(super) fn graph(&self) -> DocGraph {
        let mut nodes = vec![Node { id: format!("doc:{}", self.id), kind: "document".to_owned(), label: self.title.clone() }];
        let mut edges = Vec::new();
        let edge = |from: String, to: String, kind: &str| Edge { from, to, kind: kind.to_owned(), weight: 1 };
        for tag in &self.tags {
            nodes.push(Node { id: format!("tag:{tag}"), kind: "tag".to_owned(), label: tag.clone() });
            edges.push(edge(format!("doc:{}", self.id), format!("tag:{tag}"), "tagged"));
        }
        for link in &self.links {
            edges.push(edge(format!("doc:{}", self.id), format!("doc:{link}"), "links_to"));
        }
        for a in &self.links {
            for b in &self.links {
                if a != b {
                    edges.push(edge(format!("doc:{a}"), format!("doc:{b}"), "co_cited"));
                }
            }
        }
        DocGraph { nodes, edges }
    }
}

/// Write the fixture: 40 documents (revisions 1 to 40), their 40 records (41 to 80) and one graph
/// batch applied at revision 80.
pub(super) fn populate(stores: &Stores, fixture: &Fixture) -> Result<(), String> {
    let d = &*stores.documents;
    for doc in &fixture.documents {
        let mut write = samples::document(&doc.id, &doc.access_refs(), &doc.title, "fixture");
        write.title = doc.title.clone();
        write.doc_type = doc.doc_type.clone();
        write.collection = doc.collection.clone();
        write.tags = doc.tags.clone();
        d.put_document(write, Expect::Absent).ctx("put_document")?;
    }
    for doc in &fixture.documents {
        let envelope = samples::envelope(&doc.access_refs(), "fixture", "2026-11-02T10:00:00.000Z");
        d.put_record(RECORD_NS, RECORD_KIND, &doc.id, json!({"about": doc.id, "title": doc.title}), envelope, Expect::Absent)
            .ctx("put_record")?;
    }
    let batch = GraphBatch {
        entries: fixture.documents.iter().map(|doc| (doc.id.clone(), Some(doc.graph()))).collect(),
    };
    stores.graph.apply(batch, 80).ctx("apply")
}

/// What one reader may see, computed from the fixture alone.
pub(super) struct Oracle {
    /// Readable document ids, sorted.
    pub(super) docs: BTreeSet<String>,
    /// Readable nodes by id: kind and the smallest label among readable origins.
    pub(super) nodes: BTreeMap<String, (String, String)>,
    /// Readable aggregated edges.
    pub(super) edges: BTreeMap<(String, String, String), u64>,
}

impl Oracle {
    /// `reader` of `None` is the derivation read.
    pub(super) fn new(fixture: &Fixture, reader: Option<&[String]>) -> Self {
        let readable = |doc: &FixtureDoc| match reader {
            None => true,
            Some(tokens) => doc.access.iter().any(|t| tokens.contains(t)),
        };
        let mut docs = BTreeSet::new();
        let mut nodes: BTreeMap<String, (String, String)> = BTreeMap::new();
        let mut raw: Vec<(String, String, String, u64)> = Vec::new();
        for doc in fixture.documents.iter().filter(|d| readable(d)) {
            docs.insert(doc.id.clone());
            let graph = doc.graph();
            for node in graph.nodes {
                let entry = nodes.entry(node.id).or_insert((node.kind.clone(), node.label.clone()));
                if node.label < entry.1 {
                    entry.1 = node.label;
                }
            }
            raw.extend(graph.edges.into_iter().map(|e| (e.from, e.to, e.kind, e.weight)));
        }
        let mut edges = BTreeMap::new();
        for (from, to, kind, weight) in raw {
            if nodes.contains_key(&from) && nodes.contains_key(&to) {
                *edges.entry((from, to, kind)).or_insert(0) += weight;
            }
        }
        Self { docs, nodes, edges }
    }

    pub(super) fn edge_list(&self) -> Vec<Edge> {
        self.edges
            .iter()
            .map(|((from, to, kind), weight)| Edge { from: from.clone(), to: to.clone(), kind: kind.clone(), weight: *weight })
            .collect()
    }

    pub(super) fn node_list(&self) -> Vec<Node> {
        self.nodes
            .iter()
            .map(|(id, (kind, label))| Node { id: id.clone(), kind: kind.clone(), label: label.clone() })
            .collect()
    }
}

/// A reader filter for the fixture's named reader.
pub(super) fn reader_filter(tokens: &[String]) -> Result<ReaderFilter, String> {
    ReaderFilter::tokens(tokens.iter().cloned()).ctx("building a reader filter")
}

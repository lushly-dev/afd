//! The structural graph a document contributes (specification section 7.3, decision D60): built
//! deterministically from one document's own text and metadata, so a document's contribution is
//! replaced as a unit when it changes.
//!
//! A contribution holds the nodes the document itself produces and the edges it originates. It
//! never produces a node for the document a link points at (that node is the target's own
//! contribution): an edge to a document the reader cannot read has an unreadable endpoint, so it
//! is not served, and the origin's access set cannot make the target's id readable.
//!
//! Co-citation is stored per citing document: this document's `co_cited` edges join every pair of
//! the first [`CO_CITATION_TARGETS`] distinct documents it links to, with this document as their
//! origin. The weight a reader sees is the sum over the citers the reader can read, which the
//! store computes at query time.

use std::collections::BTreeMap;

use umbel_okf::Structure;
use umbel_okf::links::{Target, resolve};
use umbel_store::{DocGraph, Document, Edge, Node};

/// How many distinct linked documents a citer contributes co-citation pairs from (at most 1225
/// pairs), so one document cannot flood the graph.
pub(crate) const CO_CITATION_TARGETS: usize = 50;
/// The most a `links_to` edge weighs.
pub(crate) const MAX_LINK_WEIGHT: u64 = 10;
/// Node kinds.
pub(crate) const DOCUMENT: &str = "document";

/// What building a document's contribution found.
pub(crate) struct Built {
    /// The nodes and edges to store.
    pub(crate) graph: DocGraph,
    /// The distinct documents the text links to, in document order.
    pub(crate) targets: Vec<String>,
    /// Links that name nothing in the container, or a heading of this document that is not there.
    pub(crate) unresolved: usize,
}

/// The node id of a document.
pub(crate) fn doc_node(id: &str) -> String {
    format!("doc:{id}")
}

/// A label the graph accepts: no control characters, at most 512 characters, never empty.
fn clean(text: &str, fallback: &str) -> String {
    let cleaned: String = text
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .take(512)
        .collect();
    let cleaned = cleaned.trim();
    if cleaned.is_empty() {
        fallback.to_owned()
    } else {
        cleaned.to_owned()
    }
}

/// Whether `text` can be part of a node id.
fn usable(text: &str) -> bool {
    !text.is_empty() && text.len() <= 900 && !text.chars().any(char::is_control)
}

#[derive(Default)]
struct Collector {
    nodes: BTreeMap<String, Node>,
    edges: BTreeMap<(String, String, String), u64>,
}

impl Collector {
    fn node(&mut self, id: String, kind: &str, label: String) {
        self.nodes.entry(id.clone()).or_insert(Node {
            id,
            kind: kind.to_owned(),
            label,
        });
    }

    fn edge(&mut self, from: &str, to: &str, kind: &str, weight: u64) {
        *self
            .edges
            .entry((from.to_owned(), to.to_owned(), kind.to_owned()))
            .or_insert(0) += weight;
    }
}

/// The document a `superseded_by` value names: an id or a `/`-prefixed path.
pub(crate) fn successor(value: &str, from: &str, collections: &[String]) -> Option<String> {
    let value = value.trim();
    let first = value.split('/').next().unwrap_or_default();
    let rooted = value.starts_with('/') || collections.iter().any(|known| known == first);
    let target = if rooted {
        format!("/{}", value.trim_start_matches('/'))
    } else {
        value.to_owned()
    };
    match resolve(&target, from, collections) {
        Target::Document { id, .. } if id != from => Some(id),
        _ => None,
    }
}

/// The contribution of `document`, whose parsed `structure` is empty for a document that has none
/// (code). `collections` are the space's collection ids, for links into other collections.
pub(crate) fn build(document: &Document, structure: &Structure, collections: &[String]) -> Built {
    let id = document.id.as_str();
    let me = doc_node(id);
    let mut found = Collector::default();
    found.node(me.clone(), DOCUMENT, clean(&document.title, id));

    // Directories: the root of the collection down to the document.
    let segments: Vec<&str> = id.split('/').collect();
    if segments.len() >= 2 {
        let mut path = segments[0].to_owned();
        let mut parent = format!("dir:{path}");
        found.node(parent.clone(), "directory", clean(segments[0], &path));
        for segment in &segments[1..segments.len() - 1] {
            path = format!("{path}/{segment}");
            let node = format!("dir:{path}");
            found.node(node.clone(), "directory", clean(segment, &path));
            found.edge(&parent, &node, "contains", 1);
            parent = node;
        }
        found.edge(&parent, &me, "contains", 1);
    }

    // Headings: the document holds the top ones, each heading its sub-headings.
    let heading_node = |slug: &str| format!("heading:{id}#{slug}");
    for heading in &structure.headings {
        let node = heading_node(&heading.slug);
        if !usable(&node) {
            continue;
        }
        found.node(node.clone(), "heading", clean(&heading.text, &heading.slug));
        let parent = heading
            .parent
            .and_then(|index| structure.headings.get(index))
            .map_or_else(|| me.clone(), |parent| heading_node(&parent.slug));
        found.edge(&parent, &node, "contains", 1);
    }

    // Tags and owners.
    for tag in &document.tags {
        if usable(tag) {
            let node = format!("tag:{tag}");
            found.node(node.clone(), "tag", clean(tag, tag));
            found.edge(&me, &node, "tagged", 1);
        }
    }
    for owner in &document.owners {
        if usable(owner) {
            let node = format!("owner:{owner}");
            found.node(node.clone(), "owner", clean(owner, owner));
            found.edge(&me, &node, "owned_by", 1);
        }
    }

    // The replacement supersedes this document.
    if let Some(value) = &document.superseded_by
        && let Some(successor) = successor(value, id, collections)
    {
        found.edge(&doc_node(&successor), &me, "supersedes", 1);
    }

    // Links: to documents, and to a heading of another document when the link names one.
    let mut order: Vec<String> = Vec::new();
    let mut counts: BTreeMap<String, u64> = BTreeMap::new();
    let mut fragments: BTreeMap<(String, String), u64> = BTreeMap::new();
    let mut unresolved = 0usize;
    for link in &structure.links {
        match resolve(&link.target, id, collections) {
            Target::Document {
                id: target,
                fragment,
            } => {
                if target == id {
                    continue;
                }
                if !counts.contains_key(&target) {
                    order.push(target.clone());
                }
                *counts.entry(target.clone()).or_insert(0) += 1;
                if let Some(slug) = fragment {
                    *fragments.entry((target, slug)).or_insert(0) += 1;
                }
            }
            Target::Fragment(slug) => {
                if structure.heading_by_slug(&slug).is_none() {
                    unresolved += 1;
                }
            }
            Target::Unresolved => unresolved += 1,
            _ => {}
        }
    }
    for target in &order {
        if usable(target) {
            let weight = counts
                .get(target)
                .copied()
                .unwrap_or(1)
                .min(MAX_LINK_WEIGHT);
            found.edge(&me, &doc_node(target), "links_to", weight);
        }
    }
    for ((target, slug), count) in &fragments {
        let node = format!("heading:{target}#{slug}");
        if usable(&node) {
            found.edge(&me, &node, "links_to", (*count).min(MAX_LINK_WEIGHT));
        }
    }

    // Co-citation: every pair of the first documents this one links to, both directions.
    let cited: Vec<&String> = order
        .iter()
        .filter(|target| usable(target))
        .take(CO_CITATION_TARGETS)
        .collect();
    for (at, first) in cited.iter().enumerate() {
        for second in &cited[at + 1..] {
            found.edge(&doc_node(first), &doc_node(second), "co_cited", 1);
            found.edge(&doc_node(second), &doc_node(first), "co_cited", 1);
        }
    }

    Built {
        graph: DocGraph {
            nodes: found.nodes.into_values().collect(),
            edges: found
                .edges
                .into_iter()
                .map(|((from, to, kind), weight)| Edge {
                    from,
                    to,
                    kind,
                    weight,
                })
                .collect(),
        },
        targets: order,
        unresolved,
    }
}

//! `knowledge-neighbors`, `knowledge-related` and `knowledge-path` (specification section 8.5):
//! the structural graph read as the caller.
//!
//! Every read goes through the `graph` grant, which serves only the edges whose two endpoints and
//! whose origin document the caller's reader filter admits, aggregated over the readable origins
//! (so a `co_cited` weight counts only citers the caller can read). Nothing here asks about a
//! node the store did not return, so a hidden document is neither named nor counted, and a path
//! cannot pass through one: its edges are not in the readable subgraph.

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use serde_json::{Value, json};
use umbel_sdk::{Cx, HostError, Outcome, failure, success};
use umbel_store::{Direction, Edge, Node};

use crate::budget::fit_count;
use crate::doc::readable;
use crate::fail;
use crate::graph::doc_node;

/// The node id prefixes; anything else names a document.
const NODE_PREFIXES: [&str; 6] = ["doc:", "heading:", "dir:", "tag:", "owner:", "symbol:"];
/// The edges one read asks the store for.
const EDGE_READ: u32 = 1000;
/// The kinds a path follows unless the caller names others: `contains` joins every document of a
/// directory to every other in two hops, which would make every path two hops long.
const PATH_KINDS: [&str; 7] = [
    "links_to",
    "supersedes",
    "co_cited",
    "tagged",
    "owned_by",
    "defines",
    "mentions",
];
/// The tags (or owners) of one document whose other documents `knowledge-related` reads.
const SHARED_READS: usize = 64;

/// A node id, or a document id, as the node id the graph uses.
fn node_id(value: &str) -> String {
    if NODE_PREFIXES.iter().any(|prefix| value.starts_with(prefix)) {
        value.to_owned()
    } else {
        doc_node(value)
    }
}

fn text<'a>(input: &'a Value, name: &str) -> Option<&'a str> {
    input.get(name).and_then(Value::as_str)
}

fn strings(input: &Value, name: &str) -> Vec<String> {
    input
        .get(name)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn node_json(node: &Node) -> Value {
    json!({ "id": node.id, "kind": node.kind, "label": node.label, "trust": "content" })
}

/// A `contains` edge weighs 1: the store sums the readable origins, and the count of documents
/// beneath a directory is not something the edge should report.
fn shown_weight(edge: &Edge) -> u64 {
    if edge.kind == "contains" {
        1
    } else {
        edge.weight
    }
}

fn not_found(is_doc: bool) -> Outcome {
    if is_doc {
        fail::document_not_found()
    } else {
        failure(
            "NODE_NOT_FOUND",
            "no readable node has that id in this space",
            "Check the id with knowledge-neighbors on a document; a node you may not read is reported the same way.",
        )
    }
}

fn arguments_invalid(message: &str) -> Outcome {
    failure(
        "GRAPH_ARGUMENTS_INVALID",
        message,
        "Check the command's input schema.",
    )
}

/// Document ids carry their node's `doc:` prefix; others do not.
fn doc_of(node: &str) -> Option<&str> {
    node.strip_prefix("doc:")
}

/// Titles and kinds of nodes, as far as the caller can read them.
fn labels(
    cx: &Cx,
    space: &str,
    ids: &BTreeSet<String>,
) -> Result<BTreeMap<String, Node>, HostError> {
    let mut found = BTreeMap::new();
    let ids: Vec<String> = ids.iter().cloned().collect();
    for chunk in ids.chunks(500) {
        for node in cx.graph_nodes(space, chunk)? {
            found.insert(node.id.clone(), node);
        }
    }
    Ok(found)
}

pub(crate) fn neighbors(input: &Value, cx: &mut Cx) -> Outcome {
    let cx: &Cx = cx;
    let Some(space) = cx.call().space.clone() else {
        return fail::no_space();
    };
    let node = match (text(input, "node"), text(input, "doc")) {
        (Some(node), None) => node_id(node),
        (None, Some(doc)) => doc_node(doc),
        _ => return arguments_invalid("give exactly one of `node` and `doc`"),
    };
    let direction = match text(input, "direction") {
        Some("out") => Direction::Out,
        Some("in") => Direction::In,
        _ => Direction::Both,
    };
    let limit = input
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(50)
        .clamp(1, 200);
    let limit = u32::try_from(limit).unwrap_or(50);
    let kinds = strings(input, "kinds");
    let doc = doc_of(&node).map(str::to_owned);
    let run = || -> Result<Outcome, HostError> {
        let me = cx.graph_nodes(&space, std::slice::from_ref(&node))?;
        let Some(me) = me.into_iter().next() else {
            // A readable document the graph has not caught up with has no edges yet; anything
            // else is absent or unreadable, and says so alike.
            if let Some(doc) = &doc
                && readable(cx, &space, doc)?
            {
                let shown =
                    json!({ "id": node, "kind": "document", "label": doc, "trust": "content" });
                return Ok(success(json!({ "node": shown, "edges": [], "count": 0 }))
                    .with_warning_details(
                        "INDEX_STALE",
                        "the graph has not been built for this document yet; run knowledge-refresh",
                        json!({ "space": space }),
                    ));
            }
            return Ok(not_found(doc.is_some()));
        };
        let edges = cx.graph_neighbors(&space, &node, &kinds, direction, limit)?;
        let others: BTreeSet<String> = edges
            .iter()
            .map(|edge| {
                if edge.from == node {
                    edge.to.clone()
                } else {
                    edge.from.clone()
                }
            })
            .collect();
        let named = labels(cx, &space, &others)?;
        let rows: Vec<Value> = edges
            .iter()
            .filter(|edge| edge.from != edge.to)
            .filter_map(|edge| {
                let out = edge.from == node;
                let other = if out { &edge.to } else { &edge.from };
                // An endpoint the store would not name is not shown.
                let other = named.get(other)?;
                Some(json!({
                    "direction": if out { "out" } else { "in" },
                    "kind": edge.kind,
                    "weight": shown_weight(edge),
                    "node": node_json(other),
                }))
            })
            .collect();
        let total = rows.len();
        let (_, outcome) = fit_count(total, cx.call().output_budget, |kept| {
            let mut outcome = success(json!({
                "node": node_json(&me),
                "edges": rows[..kept],
                "count": kept,
            }))
            .with_metadata("dev.umbel/trust", json!("content"));
            if kept < total {
                outcome = outcome.with_warning_details(
                    "RESULTS_LIMITED",
                    "fewer edges are shown than were found, to fit the output budget; ask for a larger budget or a smaller limit",
                    json!({ "found": total, "shown": kept }),
                );
            }
            outcome
        });
        Ok(outcome)
    };
    run().unwrap_or_else(|error| fail::host(&error))
}

/// What makes one document related to another.
#[derive(Default)]
struct Relation {
    score: f64,
    links: u64,
    co_cited: u64,
    tags: BTreeSet<String>,
    owners: BTreeSet<String>,
    directory: bool,
}

pub(crate) fn related(input: &Value, cx: &mut Cx) -> Outcome {
    let cx: &Cx = cx;
    let Some(space) = cx.call().space.clone() else {
        return fail::no_space();
    };
    let Some(doc) = text(input, "doc") else {
        return arguments_invalid("`doc` is required");
    };
    let limit = input
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(10)
        .clamp(1, 50);
    let limit = usize::try_from(limit).unwrap_or(10);
    let run = || -> Result<Outcome, HostError> {
        if !readable(cx, &space, doc)? {
            return Ok(fail::document_not_found());
        }
        let me = doc_node(doc);
        let mut found: BTreeMap<String, Relation> = BTreeMap::new();
        // The document an edge's far end names, when it is another document.
        fn other_doc<'a>(node: &'a str, doc: &str) -> Option<&'a str> {
            doc_of(node).filter(|id| *id != doc)
        }

        // Links either way.
        for edge in cx.graph_neighbors(
            &space,
            &me,
            &["links_to".to_owned()],
            Direction::Both,
            EDGE_READ,
        )? {
            let other = if edge.from == me {
                &edge.to
            } else {
                &edge.from
            };
            if let Some(id) = other_doc(other, doc) {
                found.entry(id.to_owned()).or_default().links += edge.weight;
            }
        }
        // Co-citation counts a pair only when at least two readable citers cite it.
        for edge in cx.graph_neighbors(
            &space,
            &me,
            &["co_cited".to_owned()],
            Direction::Out,
            EDGE_READ,
        )? {
            if edge.weight >= 2
                && let Some(id) = other_doc(&edge.to, doc)
            {
                found.entry(id.to_owned()).or_default().co_cited += edge.weight;
            }
        }
        // Shared tags and owners: the other documents that hold the same tag or owner node.
        for (kind, owners) in [("tagged", false), ("owned_by", true)] {
            let held =
                cx.graph_neighbors(&space, &me, &[kind.to_owned()], Direction::Out, EDGE_READ)?;
            let ids: BTreeSet<String> = held.iter().map(|edge| edge.to.clone()).collect();
            let names = labels(cx, &space, &ids)?;
            for shared in ids.iter().take(SHARED_READS) {
                let label = names
                    .get(shared)
                    .map_or(shared.as_str(), |n| n.label.as_str());
                for edge in cx.graph_neighbors(
                    &space,
                    shared,
                    &[kind.to_owned()],
                    Direction::In,
                    EDGE_READ,
                )? {
                    if let Some(id) = other_doc(&edge.from, doc) {
                        let relation = found.entry(id.to_owned()).or_default();
                        if owners {
                            relation.owners.insert(label.to_owned());
                        } else {
                            relation.tags.insert(label.to_owned());
                        }
                    }
                }
            }
        }
        // Documents in the same directory.
        for parent in
            cx.graph_neighbors(&space, &me, &["contains".to_owned()], Direction::In, 10)?
        {
            if !parent.from.starts_with("dir:") {
                continue;
            }
            for edge in cx.graph_neighbors(
                &space,
                &parent.from,
                &["contains".to_owned()],
                Direction::Out,
                EDGE_READ,
            )? {
                if let Some(id) = other_doc(&edge.to, doc) {
                    found.entry(id.to_owned()).or_default().directory = true;
                }
            }
        }

        let mut ranked: Vec<(String, Relation)> = found
            .into_iter()
            .map(|(id, mut relation)| {
                relation.score = 3.0 * relation.links as f64
                    + 2.0 * relation.co_cited as f64
                    + relation.tags.len() as f64
                    + relation.owners.len() as f64
                    + if relation.directory { 0.5 } else { 0.0 };
                (id, relation)
            })
            .filter(|(_, relation)| relation.score > 0.0)
            .collect();
        ranked.sort_by(|a, b| b.1.score.total_cmp(&a.1.score).then_with(|| a.0.cmp(&b.0)));
        ranked.truncate(limit);
        let ids: BTreeSet<String> = ranked.iter().map(|(id, _)| doc_node(id)).collect();
        let titles = labels(cx, &space, &ids)?;
        let rows: Vec<Value> = ranked
            .iter()
            .map(|(id, relation)| {
                let mut reasons = Vec::new();
                if relation.links > 0 {
                    reasons.push(json!({ "kind": "links", "weight": relation.links }));
                }
                if relation.co_cited > 0 {
                    reasons.push(json!({ "kind": "co_cited", "weight": relation.co_cited }));
                }
                if !relation.tags.is_empty() {
                    reasons.push(json!({ "kind": "tags", "shared": relation.tags }));
                }
                if !relation.owners.is_empty() {
                    reasons.push(json!({ "kind": "owners", "shared": relation.owners }));
                }
                if relation.directory {
                    reasons.push(json!({ "kind": "directory" }));
                }
                json!({
                    "doc": id,
                    "title": titles.get(&doc_node(id)).map(|n| n.label.clone()),
                    "score": (relation.score * 10_000.0).round() / 10_000.0,
                    "reasons": reasons,
                    "trust": "content",
                })
            })
            .collect();
        let total = rows.len();
        let sources = |kept: usize| -> Vec<Value> {
            rows[..kept]
                .iter()
                .map(|row| json!({ "type": "document", "id": format!("{space}:{}", row["doc"].as_str().unwrap_or_default()), "title": row["title"] }))
                .collect()
        };
        let (_, outcome) = fit_count(total, cx.call().output_budget, |kept| {
            let mut outcome =
                success(json!({ "doc": doc, "related": rows[..kept], "count": kept }))
                    .with_sources(sources(kept))
                    .with_metadata("dev.umbel/trust", json!("content"));
            if kept < total {
                outcome = outcome.with_warning_details(
                    "RESULTS_LIMITED",
                    "fewer documents are shown than were found, to fit the output budget",
                    json!({ "found": total, "shown": kept }),
                );
            }
            outcome
        });
        Ok(outcome)
    };
    run().unwrap_or_else(|error| fail::host(&error))
}

pub(crate) fn path(input: &Value, cx: &mut Cx) -> Outcome {
    let cx: &Cx = cx;
    let Some(space) = cx.call().space.clone() else {
        return fail::no_space();
    };
    let (Some(from), Some(to)) = (text(input, "from"), text(input, "to")) else {
        return arguments_invalid("`from` and `to` are required");
    };
    let (from, to) = (node_id(from), node_id(to));
    let max_hops = input
        .get("max_hops")
        .and_then(Value::as_u64)
        .unwrap_or(4)
        .clamp(1, 6);
    let max_hops = usize::try_from(max_hops).unwrap_or(4);
    let mut kinds = strings(input, "kinds");
    if kinds.is_empty() {
        kinds = PATH_KINDS.iter().map(|kind| (*kind).to_owned()).collect();
    }
    let graph = match cx.graph_subgraph(&space) {
        Ok(graph) => graph,
        Err(error) => return fail::host(&error),
    };
    let nothing = || {
        failure(
            "PATH_NOT_FOUND",
            &format!(
                "no path of at most {max_hops} hops joins them through documents you can read"
            ),
            "Raise max_hops (at most 6), name other kinds, or check both ids with knowledge-neighbors.",
        )
    };
    // The readable subgraph, nodes in id order, edges followed in both directions.
    let mut nodes = graph.nodes;
    nodes.sort_by(|a, b| a.id.cmp(&b.id));
    let index: BTreeMap<&str, usize> = nodes
        .iter()
        .enumerate()
        .map(|(at, node)| (node.id.as_str(), at))
        .collect();
    let (Some(&start), Some(&goal)) = (index.get(from.as_str()), index.get(to.as_str())) else {
        return nothing();
    };
    // `(neighbour, edge index, true when the edge leaves the node)`
    let mut adjacent: Vec<Vec<(usize, usize, bool)>> = vec![Vec::new(); nodes.len()];
    for (at, edge) in graph.edges.iter().enumerate() {
        if !kinds.contains(&edge.kind) {
            continue;
        }
        if let (Some(&a), Some(&b)) = (index.get(edge.from.as_str()), index.get(edge.to.as_str())) {
            adjacent[a].push((b, at, true));
            adjacent[b].push((a, at, false));
        }
    }
    for list in &mut adjacent {
        list.sort_by_key(|&(other, at, _)| (other, at));
    }
    let mut parent: Vec<Option<(usize, usize, bool)>> = vec![None; nodes.len()];
    let mut depth = vec![usize::MAX; nodes.len()];
    depth[start] = 0;
    let mut queue = VecDeque::from([start]);
    'search: while let Some(at) = queue.pop_front() {
        if at == goal {
            break;
        }
        if depth[at] >= max_hops {
            continue;
        }
        for &(other, edge, leaves) in &adjacent[at] {
            if depth[other] == usize::MAX {
                depth[other] = depth[at] + 1;
                parent[other] = Some((at, edge, leaves));
                if other == goal {
                    break 'search;
                }
                queue.push_back(other);
            }
        }
    }
    if depth[goal] == usize::MAX {
        return nothing();
    }
    let mut steps = Vec::new();
    let mut at = goal;
    loop {
        let via = parent[at].map(|(_, edge, leaves)| {
            let edge = &graph.edges[edge];
            // `leaves` is from the previous node's side.
            json!({ "kind": edge.kind, "direction": if leaves { "out" } else { "in" }, "weight": shown_weight(edge) })
        });
        steps.push(json!({ "node": node_json(&nodes[at]), "via": via }));
        match parent[at] {
            Some((before, _, _)) => at = before,
            None => break,
        }
    }
    steps.reverse();
    let hops = steps.len() - 1;
    success(json!({ "from": from, "to": to, "hops": hops, "path": steps }))
        .with_metadata("dev.umbel/trust", json!("content"))
}

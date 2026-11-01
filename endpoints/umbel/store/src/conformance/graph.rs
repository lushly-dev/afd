//! Group `graph`: contributions per origin, endpoint and origin filtering, aggregation over
//! readable origins (the co-citation rule), one-transaction `apply` and `applied`.

use super::{CaseResult, Ctx, Env, Fresh, conflict, ensure, ensure_eq, everyone, expect_err, invalid, pass, reader, samples};
use crate::{DocGraph, Direction, Edge, EdgeKey, Expect, GraphBatch, Node, ReaderFilter, Rev};

pub(super) const CASES: &[(&str, super::CaseFn)] = &[
    ("apply_replaces_one_origins_contribution", replace),
    ("none_removes_and_a_shared_node_survives", shared_nodes),
    ("endpoints_and_origins_are_both_checked", endpoints),
    ("weights_aggregate_over_readable_origins_only", aggregation),
    ("apply_is_one_transaction", one_transaction),
    ("applied_never_lowers_and_never_passes_head", applied_rules),
    ("clear_removes_everything", clear),
    ("neighbors_follow_kinds_direction_and_limit", neighbor_options),
    ("contributions_are_validated", validation),
];

fn node(id: &str) -> Node {
    Node { id: id.to_owned(), kind: "document".to_owned(), label: id.to_owned() }
}

fn edge(from: &str, to: &str, kind: &str, weight: u64) -> Edge {
    Edge { from: from.to_owned(), to: to.to_owned(), kind: kind.to_owned(), weight }
}

fn contribution(nodes: &[&str], edges: Vec<Edge>) -> Option<DocGraph> {
    Some(DocGraph { nodes: nodes.iter().map(|n| node(n)).collect(), edges })
}

fn put(f: &Fresh, id: &str, access: &[&str]) -> Result<Rev, String> {
    f.stores
        .documents
        .put_document(samples::document(id, access, id, "t"), Expect::Any)
        .map(|m| m.rev)
        .ctx("put_document")
}

fn apply(f: &Fresh, entries: Vec<(&str, Option<DocGraph>)>, applied: Rev) -> Result<(), String> {
    let batch = GraphBatch { entries: entries.into_iter().map(|(d, g)| (d.to_owned(), g)).collect() };
    f.stores.graph.apply(batch, applied).ctx("apply")
}

fn all_edges(f: &Fresh, reader: &ReaderFilter) -> Result<Vec<Edge>, String> {
    Ok(f.stores.graph.subgraph(reader).ctx("subgraph")?.edges)
}

fn replace(env: &Env<'_>) -> CaseResult {
    let f = env.fresh()?;
    let head = put(&f, "a/x", &["space"])?.max(put(&f, "a/y", &["space"])?);
    apply(&f, vec![
        ("a/x", contribution(&["doc:a/x"], vec![edge("doc:a/x", "doc:a/y", "links_to", 3)])),
        ("a/y", contribution(&["doc:a/y"], vec![])),
    ], head)?;
    let first = all_edges(&f, &everyone())?;
    ensure_eq(first, vec![edge("doc:a/x", "doc:a/y", "links_to", 3)], "the first contribution")?;
    apply(&f, vec![("a/x", contribution(&["doc:a/x"], vec![edge("doc:a/x", "doc:a/y", "links_to", 1), edge("doc:a/x", "doc:a/x", "contains", 1)]))], head)?;
    let second = all_edges(&f, &everyone())?;
    ensure_eq(second.len(), 2, "the old edges of the origin are gone, the new ones are there")?;
    ensure_eq(second[1].weight, 1, "replaced, not added to")?;
    ensure_eq(f.stores.graph.nodes(&["doc:a/y".to_owned()], &everyone()).ctx("nodes")?, vec![node("doc:a/y")], "other origins' nodes are untouched")?;
    pass()
}

fn shared_nodes(env: &Env<'_>) -> CaseResult {
    let f = env.fresh()?;
    put(&f, "a/x", &["space"])?;
    let head = put(&f, "a/y", &["group:eng"])?;
    let tag = Node { id: "tag:ops".to_owned(), kind: "tag".to_owned(), label: "ops".to_owned() };
    let with_tag = |doc: &str| Some(DocGraph { nodes: vec![node(&format!("doc:{doc}")), tag.clone()], edges: vec![edge(&format!("doc:{doc}"), "tag:ops", "tagged", 1)] });
    apply(&f, vec![("a/x", with_tag("a/x")), ("a/y", with_tag("a/y"))], head)?;
    let ids = vec!["tag:ops".to_owned()];
    ensure_eq(f.stores.graph.nodes(&ids, &everyone()).ctx("nodes")?.len(), 1, "a shared node is readable through any readable origin")?;
    apply(&f, vec![("a/x", None)], head)?;
    ensure(f.stores.graph.nodes(&ids, &everyone()).ctx("nodes")?.is_empty(), "with its only readable origin gone, the outsider cannot see it")?;
    ensure_eq(f.stores.graph.nodes(&ids, &reader(&["space", "group:eng"])).ctx("nodes")?.len(), 1, "but the other origin still produces it")?;
    ensure_eq(all_edges(&f, &ReaderFilter::derivation())?.len(), 1, "None removed only a/x's edges")?;
    pass()
}

fn endpoints(env: &Env<'_>) -> CaseResult {
    let f = env.fresh()?;
    put(&f, "a/open", &["space"])?;
    let head = put(&f, "a/secret", &["group:eng"])?;
    apply(&f, vec![
        ("a/open", contribution(&["doc:a/open"], vec![edge("doc:a/open", "doc:a/secret", "links_to", 1), edge("doc:a/open", "doc:a/open", "contains", 1)])),
        ("a/secret", contribution(&["doc:a/secret"], vec![edge("doc:a/secret", "doc:a/open", "links_to", 1)])),
    ], head)?;
    let outsider = all_edges(&f, &everyone())?;
    ensure_eq(outsider, vec![edge("doc:a/open", "doc:a/open", "contains", 1)], "an edge to an unreadable node and an edge from an unreadable origin are hidden")?;
    let n = f.stores.graph.neighbors("doc:a/open", &[], Direction::Both, 10, &everyone()).ctx("neighbors")?;
    ensure_eq(n.len(), 1, "neighbors hides them too")?;
    ensure(f.stores.graph.neighbors("doc:a/secret", &[], Direction::Both, 10, &everyone()).ctx("neighbors")?.is_empty(), "an unreadable node has no neighbors")?;
    ensure_eq(all_edges(&f, &reader(&["space", "group:eng"]))?.len(), 3, "the engineer sees all three")?;
    pass()
}

fn aggregation(env: &Env<'_>) -> CaseResult {
    let f = env.fresh()?;
    for (id, access) in [("a/x", "space"), ("a/y", "space"), ("a/public", "space"), ("a/private", "group:eng")] {
        put(&f, id, &[access])?;
    }
    let head = f.stores.documents.head().ctx("head")?;
    let pair = |w: u64| vec![edge("doc:a/x", "doc:a/y", "co_cited", w), edge("doc:a/y", "doc:a/x", "co_cited", w)];
    apply(&f, vec![
        ("a/x", contribution(&["doc:a/x"], vec![])),
        ("a/y", contribution(&["doc:a/y"], vec![])),
        ("a/public", contribution(&["doc:a/public"], pair(1))),
        ("a/private", contribution(&["doc:a/private"], pair(1))),
    ], head)?;
    let outsider = f.stores.graph.neighbors("doc:a/x", &["co_cited".to_owned()], Direction::Out, 10, &everyone()).ctx("neighbors")?;
    ensure_eq(outsider, vec![edge("doc:a/x", "doc:a/y", "co_cited", 1)], "the weight counts only citers the reader can read")?;
    let engineer = f.stores.graph.neighbors("doc:a/x", &["co_cited".to_owned()], Direction::Out, 10, &reader(&["space", "group:eng"])).ctx("neighbors")?;
    ensure_eq(engineer, vec![edge("doc:a/x", "doc:a/y", "co_cited", 2)], "and the sum over every readable citer")?;
    let paged = f.stores.graph.edges_of_kind("co_cited", 10, None, &everyone()).ctx("edges_of_kind")?;
    ensure_eq(paged.iter().map(|e| e.weight).collect::<Vec<_>>(), vec![1, 1], "edges_of_kind aggregates alike")?;
    let derived = f.stores.graph.edges_of_kind("co_cited", 10, None, &ReaderFilter::derivation()).ctx("edges_of_kind")?;
    ensure_eq(derived.iter().map(|e| e.weight).collect::<Vec<_>>(), vec![2, 2], "a derivation read sums every origin")?;
    pass()
}

fn one_transaction(env: &Env<'_>) -> CaseResult {
    let f = env.fresh()?;
    let head = put(&f, "a/x", &["space"])?;
    let good = contribution(&["doc:a/x"], vec![edge("doc:a/x", "doc:a/x", "contains", 1)]);
    expect_err(
        f.stores.graph.apply(
            GraphBatch { entries: vec![("a/x".to_owned(), good.clone()), ("a/never-stored".to_owned(), good.clone())] },
            head,
        ),
        "a batch naming a document that is not stored",
        invalid,
    )?;
    ensure(all_edges(&f, &ReaderFilter::derivation())?.is_empty(), "the valid part of a refused batch was not applied")?;
    ensure_eq(f.stores.graph.applied().ctx("applied")?, 0, "nor was `applied` moved")?;
    expect_err(
        f.stores.graph.apply(GraphBatch { entries: vec![("a/x".to_owned(), good.clone()), ("a/x".to_owned(), good)] }, head),
        "a batch naming a document twice",
        invalid,
    )?;
    ensure(all_edges(&f, &ReaderFilter::derivation())?.is_empty(), "still nothing applied")?;
    pass()
}

fn applied_rules(env: &Env<'_>) -> CaseResult {
    let f = env.fresh()?;
    for n in 0..5 {
        put(&f, &format!("a/doc-{n}"), &["space"])?;
    }
    let g = &*f.stores.graph;
    ensure_eq(g.applied().ctx("applied")?, 0, "a new graph reflects revision 0")?;
    apply(&f, vec![("a/doc-0", contribution(&["doc:a/doc-0"], vec![]))], 3)?;
    ensure_eq(g.applied().ctx("applied")?, 3, "applied moves up")?;
    apply(&f, vec![], 3)?;
    expect_err(
        g.apply(GraphBatch { entries: vec![("a/doc-1".to_owned(), contribution(&["doc:a/doc-1"], vec![]))] }, 2),
        "applied below the current one",
        |e| matches!(e, crate::StoreError::Conflict { current: Some(c) } if c == "3"),
    )?;
    ensure(
        g.nodes(&["doc:a/doc-1".to_owned()], &ReaderFilter::derivation()).ctx("nodes")?.is_empty(),
        "a refused lowering wrote nothing",
    )?;
    ensure_eq(g.applied().ctx("applied")?, 3, "applied stayed")?;
    expect_err(g.apply(GraphBatch::default(), 6), "applied past the store's head", invalid)?;
    expect_err(g.clear(1), "clear below the current revision", conflict)?;
    apply(&f, vec![], 5)?;
    ensure_eq(g.applied().ctx("applied")?, 5, "applied reaches head")?;
    pass()
}

fn clear(env: &Env<'_>) -> CaseResult {
    let f = env.fresh()?;
    let head = put(&f, "a/x", &["space"])?;
    apply(&f, vec![("a/x", contribution(&["doc:a/x"], vec![edge("doc:a/x", "doc:a/x", "contains", 1)]))], head)?;
    f.stores.graph.clear(head).ctx("clear")?;
    let sub = f.stores.graph.subgraph(&ReaderFilter::derivation()).ctx("subgraph")?;
    ensure(sub.nodes.is_empty() && sub.edges.is_empty(), "clear removes every contribution")?;
    ensure_eq(f.stores.graph.applied().ctx("applied")?, head, "and records `applied`")?;
    pass()
}

fn neighbor_options(env: &Env<'_>) -> CaseResult {
    let f = env.fresh()?;
    for id in ["a/x", "a/y", "a/z"] {
        put(&f, id, &["space"])?;
    }
    let head = f.stores.documents.head().ctx("head")?;
    apply(&f, vec![
        ("a/x", contribution(&["doc:a/x"], vec![
            edge("doc:a/x", "doc:a/y", "links_to", 1),
            edge("doc:a/x", "doc:a/z", "links_to", 2),
            edge("doc:a/x", "doc:a/y", "tagged", 1),
        ])),
        ("a/y", contribution(&["doc:a/y"], vec![edge("doc:a/y", "doc:a/x", "links_to", 1)])),
        ("a/z", contribution(&["doc:a/z"], vec![])),
    ], head)?;
    let g = &*f.stores.graph;
    let r = everyone();
    let kinds = |ks: &[&str]| ks.iter().map(|k| (*k).to_owned()).collect::<Vec<_>>();
    ensure_eq(g.neighbors("doc:a/x", &[], Direction::Out, 10, &r).ctx("out")?.len(), 3, "out, every kind")?;
    ensure_eq(g.neighbors("doc:a/x", &kinds(&["links_to"]), Direction::Out, 10, &r).ctx("out")?.len(), 2, "out, one kind")?;
    ensure_eq(g.neighbors("doc:a/x", &[], Direction::In, 10, &r).ctx("in")?, vec![edge("doc:a/y", "doc:a/x", "links_to", 1)], "in")?;
    ensure_eq(g.neighbors("doc:a/x", &[], Direction::Both, 10, &r).ctx("both")?.len(), 4, "both")?;
    ensure_eq(g.neighbors("doc:a/x", &[], Direction::Both, 2, &r).ctx("both")?.len(), 2, "limit")?;
    expect_err(g.neighbors("doc:a/x", &[], Direction::Both, 0, &r), "a zero limit", invalid)?;
    let page = g.edges_of_kind("links_to", 2, None, &r).ctx("page")?;
    let next = g.edges_of_kind("links_to", 2, page.last().map(|e| EdgeKey { from: e.from.clone(), to: e.to.clone() }).as_ref(), &r).ctx("page")?;
    ensure_eq((page.len(), next.len()), (2, 1), "edges_of_kind pages")?;
    ensure_eq(g.nodes(&[], &r).ctx("nodes")?.len(), 0, "no ids, no nodes")?;
    ensure_eq(g.nodes(&["doc:a/x".to_owned(), "doc:nope".to_owned()], &r).ctx("nodes")?.len(), 1, "unknown ids are omitted")?;
    expect_err(g.nodes(&vec!["x".to_owned(); 1001], &r), "too many ids", invalid)?;
    pass()
}

fn validation(env: &Env<'_>) -> CaseResult {
    let f = env.fresh()?;
    let head = put(&f, "a/x", &["space"])?;
    let g = &*f.stores.graph;
    let one = |graph: DocGraph| g.apply(GraphBatch { entries: vec![("a/x".to_owned(), Some(graph))] }, head);
    expect_err(one(DocGraph { nodes: vec![node("n"), node("n")], edges: vec![] }), "a node twice", invalid)?;
    expect_err(
        one(DocGraph { nodes: vec![], edges: vec![edge("a", "b", "k", 1), edge("a", "b", "k", 2)] }),
        "an edge twice",
        invalid,
    )?;
    expect_err(one(DocGraph { nodes: vec![node("")], edges: vec![] }), "an empty node id", invalid)?;
    expect_err(one(DocGraph { nodes: vec![], edges: vec![edge("a", "b", "k", u64::MAX)] }), "a weight past 2^63", invalid)?;
    ensure(g.subgraph(&ReaderFilter::derivation()).ctx("subgraph")?.nodes.is_empty(), "nothing was applied")?;
    pass()
}

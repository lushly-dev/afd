//! Group `access`: every read path, three readers, 40 documents; nothing unreadable ever comes
//! back, and an unreadable document is indistinguishable from an absent one.

use std::collections::BTreeSet;

use super::fixture::{self, Fixture, Oracle, RECORD_KIND, RECORD_NS};
use super::{CaseResult, Ctx, Env, Stores, ensure, ensure_eq, pass, skip};
use crate::{ChangeKind, Direction, EdgeKey, IndexQuery, ListQuery, ReaderFilter};

pub(super) const CASES: &[(&str, super::CaseFn)] = &[
    ("documents_listed_and_fetched_per_reader", documents),
    (
        "an_unreadable_document_is_indistinguishable_from_an_absent_one",
        indistinguishable,
    ),
    ("records_listed_and_fetched_per_reader", records),
    ("changes_per_reader", changes),
    ("graph_per_reader", graph),
    ("nothing_unreadable_appears_in_any_result", no_leaks),
    ("a_reader_with_no_tokens_reads_nothing", nobody),
    ("a_derivation_read_sees_everything", derivation),
    ("the_index_honours_the_reader_filter", index),
];

struct Setup {
    stores: Stores,
    fixture: Fixture,
    _dir: super::Fresh,
}

fn setup(env: &Env<'_>) -> Result<Setup, String> {
    let fresh = env.fresh()?;
    let fixture = fixture::load()?;
    fixture::populate(&fresh.stores, &fixture)?;
    Ok(Setup {
        stores: fresh.stores.clone(),
        fixture,
        _dir: fresh,
    })
}

fn readers(fixture: &Fixture) -> Vec<(String, Vec<String>)> {
    fixture
        .readers
        .iter()
        .map(|(n, t)| (n.clone(), t.clone()))
        .collect()
}

fn documents(env: &Env<'_>) -> CaseResult {
    let s = setup(env)?;
    for (name, tokens) in readers(&s.fixture) {
        let oracle = Oracle::new(&s.fixture, Some(&tokens));
        let reader = fixture::reader_filter(&tokens)?;
        let mut listed = Vec::new();
        let mut query = ListQuery::all(7);
        loop {
            let page = s
                .stores
                .documents
                .list_documents(&query, &reader)
                .ctx("list_documents")?;
            listed.extend(page.items.into_iter().map(|m| m.id));
            match page.next {
                Some(next) => query.after = Some(next),
                None => break,
            }
        }
        ensure_eq(
            listed,
            oracle.docs.iter().cloned().collect::<Vec<_>>(),
            &format!("{name}: the listing"),
        )?;
        for doc in &s.fixture.documents {
            let got = s
                .stores
                .documents
                .get_document(&doc.id, &reader)
                .ctx("get_document")?;
            ensure_eq(
                got.is_some(),
                oracle.docs.contains(&doc.id),
                &format!("{name}: get_document({})", doc.id),
            )?;
        }
        let mut by_collection = ListQuery::all(50);
        by_collection.collection = Some("runbooks".to_owned());
        let expected: Vec<String> = oracle
            .docs
            .iter()
            .filter(|id| id.starts_with("runbooks/"))
            .cloned()
            .collect();
        let got: Vec<String> = s
            .stores
            .documents
            .list_documents(&by_collection, &reader)
            .ctx("list_documents")?
            .items
            .into_iter()
            .map(|m| m.id)
            .collect();
        ensure_eq(
            got,
            expected,
            &format!("{name}: a filtered listing is still filtered by access"),
        )?;
    }
    pass()
}

fn indistinguishable(env: &Env<'_>) -> CaseResult {
    let s = setup(env)?;
    let outsider = fixture::reader_filter(&["space".to_owned()])?;
    let hidden = s
        .fixture
        .documents
        .iter()
        .find(|d| !d.access.contains(&"space".to_owned()))
        .ok_or("the fixture has no hidden document")?;
    let hidden_result = s.stores.documents.get_document(&hidden.id, &outsider);
    let absent_result = s
        .stores
        .documents
        .get_document("runbooks/never-written", &outsider);
    ensure_eq(
        hidden_result.clone(),
        absent_result.clone(),
        "the same answer for hidden and absent",
    )?;
    ensure(matches!(hidden_result, Ok(None)), "that answer is Ok(None)")?;
    ensure(
        matches!(
            s.stores
                .documents
                .get_record(RECORD_NS, RECORD_KIND, &hidden.id, &outsider),
            Ok(None)
        ),
        "a hidden record reads as None",
    )?;
    pass()
}

fn records(env: &Env<'_>) -> CaseResult {
    let s = setup(env)?;
    for (name, tokens) in readers(&s.fixture) {
        let oracle = Oracle::new(&s.fixture, Some(&tokens));
        let reader = fixture::reader_filter(&tokens)?;
        let mut listed = Vec::new();
        let mut after: Option<String> = None;
        loop {
            let page = s
                .stores
                .documents
                .list_records(RECORD_NS, RECORD_KIND, after.as_deref(), 9, &reader)
                .ctx("list_records")?;
            listed.extend(page.items.into_iter().map(|r| r.id));
            match page.next {
                Some(next) => after = Some(next),
                None => break,
            }
        }
        ensure_eq(
            listed,
            oracle.docs.iter().cloned().collect::<Vec<_>>(),
            &format!("{name}: the record listing"),
        )?;
        for doc in &s.fixture.documents {
            let got = s
                .stores
                .documents
                .get_record(RECORD_NS, RECORD_KIND, &doc.id, &reader)
                .ctx("get_record")?;
            ensure_eq(
                got.is_some(),
                oracle.docs.contains(&doc.id),
                &format!("{name}: get_record({})", doc.id),
            )?;
        }
    }
    pass()
}

fn changes(env: &Env<'_>) -> CaseResult {
    let s = setup(env)?;
    for (name, tokens) in readers(&s.fixture) {
        let oracle = Oracle::new(&s.fixture, Some(&tokens));
        let reader = fixture::reader_filter(&tokens)?;
        let got = s
            .stores
            .documents
            .changes(0, 1000, &reader, None)
            .ctx("changes")?;
        let mut expected: Vec<(u64, String)> = Vec::new();
        for (n, doc) in s.fixture.documents.iter().enumerate() {
            if oracle.docs.contains(&doc.id) {
                expected.push((n as u64 + 1, doc.id.clone()));
            }
        }
        for (n, doc) in s.fixture.documents.iter().enumerate() {
            if oracle.docs.contains(&doc.id) {
                expected.push((
                    n as u64 + 41,
                    format!("{RECORD_NS}/{RECORD_KIND}/{}", doc.id),
                ));
            }
        }
        ensure_eq(
            got.iter()
                .map(|c| (c.rev, c.target.clone()))
                .collect::<Vec<_>>(),
            expected,
            &format!("{name}: changes"),
        )?;
        ensure(
            got.iter()
                .all(|c| matches!(c.kind, ChangeKind::Put | ChangeKind::Record)),
            "the fixture only writes",
        )?;
    }
    pass()
}

fn graph(env: &Env<'_>) -> CaseResult {
    let s = setup(env)?;
    let mut cases = readers(&s.fixture)
        .into_iter()
        .map(|(n, t)| (n, Some(t)))
        .collect::<Vec<_>>();
    cases.push(("derivation".to_owned(), None));
    for (name, tokens) in cases {
        let oracle = Oracle::new(&s.fixture, tokens.as_deref());
        let reader = match &tokens {
            Some(t) => fixture::reader_filter(t)?,
            None => ReaderFilter::derivation(),
        };
        let g = &*s.stores.graph;
        let subgraph = g.subgraph(&reader).ctx("subgraph")?;
        ensure_eq(
            subgraph.nodes,
            oracle.node_list(),
            &format!("{name}: subgraph nodes"),
        )?;
        ensure_eq(
            subgraph.edges,
            oracle.edge_list(),
            &format!("{name}: subgraph edges"),
        )?;
        let ids: Vec<String> = s
            .fixture
            .documents
            .iter()
            .map(|d| format!("doc:{}", d.id))
            .chain((0..5).map(|n| format!("tag:t{n}")))
            .collect();
        let nodes = g.nodes(&ids, &reader).ctx("nodes")?;
        ensure_eq(nodes, oracle.node_list(), &format!("{name}: nodes"))?;
        for id in &ids {
            for direction in [Direction::Out, Direction::In, Direction::Both] {
                let got = g
                    .neighbors(id, &[], direction, 1000, &reader)
                    .ctx("neighbors")?;
                let expected: Vec<_> = oracle
                    .edge_list()
                    .into_iter()
                    .filter(|e| match direction {
                        Direction::Out => &e.from == id,
                        Direction::In => &e.to == id,
                        Direction::Both => &e.from == id || &e.to == id,
                    })
                    .collect();
                ensure_eq(
                    got,
                    expected,
                    &format!("{name}: neighbors({id}, {direction:?})"),
                )?;
            }
        }
        let co: Vec<_> = oracle
            .edge_list()
            .into_iter()
            .filter(|e| e.kind == "co_cited")
            .collect();
        let mut paged = Vec::new();
        let mut after: Option<EdgeKey> = None;
        loop {
            let page = g
                .edges_of_kind("co_cited", 11, after.as_ref(), &reader)
                .ctx("edges_of_kind")?;
            let full = page.len() == 11;
            if let Some(last) = page.last() {
                after = Some(EdgeKey {
                    from: last.from.clone(),
                    to: last.to.clone(),
                });
            }
            paged.extend(page);
            if !full {
                break;
            }
        }
        ensure_eq(paged, co, &format!("{name}: edges_of_kind pages"))?;
    }
    pass()
}

/// The strongest statement: serialise everything a reader gets back and look for any id or
/// title of a document it may not read.
fn no_leaks(env: &Env<'_>) -> CaseResult {
    let s = setup(env)?;
    for (name, tokens) in readers(&s.fixture) {
        let oracle = Oracle::new(&s.fixture, Some(&tokens));
        let reader = fixture::reader_filter(&tokens)?;
        let mut seen = String::new();
        let mut push = |value: serde_json::Value| seen.push_str(&value.to_string());
        let mut query = ListQuery::all(500);
        query.after = None;
        push(
            serde_json::to_value(
                s.stores
                    .documents
                    .list_documents(&query, &reader)
                    .ctx("list")?,
            )
            .map_err(|e| e.to_string())?,
        );
        for doc in &s.fixture.documents {
            push(
                serde_json::to_value(
                    s.stores
                        .documents
                        .get_document(&doc.id, &reader)
                        .ctx("get")?,
                )
                .map_err(|e| e.to_string())?,
            );
            push(
                serde_json::to_value(
                    s.stores
                        .documents
                        .get_record(RECORD_NS, RECORD_KIND, &doc.id, &reader)
                        .ctx("get")?,
                )
                .map_err(|e| e.to_string())?,
            );
            push(
                serde_json::to_value(
                    s.stores
                        .graph
                        .neighbors(
                            &format!("doc:{}", doc.id),
                            &[],
                            Direction::Both,
                            1000,
                            &reader,
                        )
                        .ctx("neighbors")?,
                )
                .map_err(|e| e.to_string())?,
            );
        }
        push(
            serde_json::to_value(
                s.stores
                    .documents
                    .list_records(RECORD_NS, RECORD_KIND, None, 500, &reader)
                    .ctx("list")?,
            )
            .map_err(|e| e.to_string())?,
        );
        push(
            serde_json::to_value(
                s.stores
                    .documents
                    .changes(0, 1000, &reader, None)
                    .ctx("changes")?,
            )
            .map_err(|e| e.to_string())?,
        );
        push(
            serde_json::to_value(s.stores.graph.subgraph(&reader).ctx("subgraph")?)
                .map_err(|e| e.to_string())?,
        );
        let hidden: BTreeSet<&str> = s
            .fixture
            .documents
            .iter()
            .map(|d| d.id.as_str())
            .filter(|id| !oracle.docs.contains(*id))
            .collect();
        ensure(
            !hidden.is_empty(),
            "the fixture hides something from every reader",
        )?;
        for doc in s
            .fixture
            .documents
            .iter()
            .filter(|d| hidden.contains(d.id.as_str()))
        {
            ensure(
                !seen.contains(&doc.id),
                &format!(
                    "{name}: the id `{}` of an unreadable document appeared",
                    doc.id
                ),
            )?;
            ensure(
                !seen.contains(&doc.title),
                &format!("{name}: the title of unreadable `{}` appeared", doc.id),
            )?;
        }
    }
    pass()
}

fn nobody(env: &Env<'_>) -> CaseResult {
    let s = setup(env)?;
    let reader = fixture::reader_filter(&[])?;
    ensure(
        s.stores
            .documents
            .list_documents(&ListQuery::all(50), &reader)
            .ctx("list")?
            .items
            .is_empty(),
        "documents",
    )?;
    ensure(
        s.stores
            .documents
            .changes(0, 1000, &reader, None)
            .ctx("changes")?
            .is_empty(),
        "changes",
    )?;
    ensure(
        s.stores
            .documents
            .list_records(RECORD_NS, RECORD_KIND, None, 50, &reader)
            .ctx("list")?
            .items
            .is_empty(),
        "records",
    )?;
    let sub = s.stores.graph.subgraph(&reader).ctx("subgraph")?;
    ensure(sub.nodes.is_empty() && sub.edges.is_empty(), "graph")?;
    ensure(
        s.stores
            .graph
            .neighbors("doc:handbook/doc-00", &[], Direction::Both, 10, &reader)
            .ctx("neighbors")?
            .is_empty(),
        "neighbors",
    )?;
    pass()
}

fn derivation(env: &Env<'_>) -> CaseResult {
    let s = setup(env)?;
    let page = s
        .stores
        .documents
        .list_documents(&ListQuery::all(500), &ReaderFilter::derivation())
        .ctx("list")?;
    ensure_eq(
        page.items.len(),
        40,
        "a derivation read lists every document",
    )?;
    let changes = s
        .stores
        .documents
        .changes(0, 1000, &ReaderFilter::derivation(), None)
        .ctx("changes")?;
    ensure_eq(changes.len(), 80, "and every change")?;
    pass()
}

fn index(env: &Env<'_>) -> CaseResult {
    let s = setup(env)?;
    let Some(index) = s.stores.index.clone() else {
        return skip("this backend has no search index");
    };
    fixture::index_documents(&s.stores, &s.fixture)?;
    for (name, tokens) in readers(&s.fixture) {
        let oracle = Oracle::new(&s.fixture, Some(&tokens));
        let reader = fixture::reader_filter(&tokens)?;
        let ask = |text: &str| IndexQuery {
            text: text.to_owned(),
            filters: crate::IndexFilters::default(),
            limit: crate::MAX_QUERY_LIMIT,
        };
        // Whatever the words, the reader's clause comes with them: a word every document has, an
        // all-negative query (everything but one word), and a tag filter.
        for text in ["shared", "-zzzznothing", "shared OR fixture OR note"] {
            let hits = index.search(&ask(text), &reader).ctx("search")?;
            let found: BTreeSet<String> = hits.iter().map(|h| h.doc.clone()).collect();
            ensure_eq(found, oracle.docs.clone(), &format!("`{text}` as {name}"))?;
        }
        let tagged = index.search(&ask("tags:t0"), &reader).ctx("search")?;
        for hit in &tagged {
            ensure(
                oracle.docs.contains(&hit.doc),
                &format!("{name} was shown `{}` by a tag query", hit.doc),
            )?;
        }
        for doc in &s.fixture.documents {
            let chunks = index.chunks(&doc.id, &reader).ctx("chunks")?;
            ensure_eq(
                chunks.len(),
                usize::from(oracle.docs.contains(&doc.id)),
                &format!("the chunks of `{}` as {name}", doc.id),
            )?;
        }
    }
    let nobody = ReaderFilter::tokens(Vec::<String>::new()).ctx("a reader")?;
    ensure(
        index
            .search(
                &IndexQuery {
                    text: "shared".to_owned(),
                    filters: crate::IndexFilters::default(),
                    limit: 10,
                },
                &nobody,
            )
            .ctx("search")?
            .is_empty(),
        "a reader with no tokens finds nothing",
    )?;
    pass()
}

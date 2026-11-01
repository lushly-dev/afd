//! Group `durability`: reopen after drop returns the same head and contents.

use serde_json::json;

use super::fixture::{self, Oracle, RECORD_KIND, RECORD_NS};
use super::{CaseResult, Ctx, Env, SPACE, ensure_eq, everyone, pass, samples};
use crate::{Expect, ListQuery, ReaderFilter};

pub(super) const CASES: &[(&str, super::CaseFn)] = &[("reopen_returns_the_same_head_and_contents", reopen)];

fn reopen(env: &Env<'_>) -> CaseResult {
    let f = env.fresh()?;
    let fixture = fixture::load()?;
    fixture::populate(&f.stores, &fixture)?;
    let tombstone = "handbook/doc-00";
    f.stores
        .documents
        .delete_document(tombstone, Expect::Any, samples::envelope(&["space"], "t", "2026-11-02T10:00:00.000Z"))
        .ctx("delete")?;
    f.stores
        .documents
        .put_record("k", "late", "r", json!({"v": 1}), samples::envelope(&["space"], "t", "2026-11-02T10:00:00.000Z"), Expect::Any)
        .ctx("put_record")?;
    let head = f.stores.documents.head().ctx("head")?;
    let derivation = ReaderFilter::derivation();
    let docs = f.stores.documents.list_documents(&ListQuery::all(500), &derivation).ctx("list")?;
    let changes = f.stores.documents.changes(0, 1000, &derivation, None).ctx("changes")?;
    let sub = f.stores.graph.subgraph(&derivation).ctx("subgraph")?;
    let applied = f.stores.graph.applied().ctx("applied")?;
    let first = f.stores.documents.get_document("runbooks/doc-00", &everyone()).ctx("get")?;
    let dir = f.dir.path().to_owned();
    let Stores { documents, graph, index } = f.stores.clone();
    drop((documents, graph, index));
    let reopened = (env.factory)(&dir, SPACE).map_err(|e| format!("reopening: {e}"))?;
    ensure_eq(reopened.documents.head().ctx("head")?, head, "the head")?;
    ensure_eq(reopened.documents.list_documents(&ListQuery::all(500), &derivation).ctx("list")?, docs, "the documents")?;
    ensure_eq(reopened.documents.changes(0, 1000, &derivation, None).ctx("changes")?, changes, "the changes")?;
    ensure_eq(reopened.graph.subgraph(&derivation).ctx("subgraph")?, sub, "the graph")?;
    ensure_eq(reopened.graph.applied().ctx("applied")?, applied, "graph applied")?;
    ensure_eq(reopened.documents.get_document("runbooks/doc-00", &everyone()).ctx("get")?, first, "a document, bytes and all")?;
    ensure_eq(
        reopened.documents.get_record("k", "late", "r", &everyone()).ctx("get")?.map(|r| r.body),
        Some(json!({"v": 1})),
        "a record",
    )?;
    let oracle = Oracle::new(&fixture, Some(&["space".to_owned()]));
    let _ = (&oracle, RECORD_NS, RECORD_KIND);
    let next = reopened
        .documents
        .put_document(samples::document("again/doc", &["space"], "x", "t"), Expect::Any)
        .ctx("put after reopen")?;
    ensure_eq(next.rev, head + 1, "writes continue the sequence")?;
    pass()
}

use super::Stores;

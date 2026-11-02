//! Group `changes`: order, paging, the trace filter, density and access.

use super::{
    CaseResult, Ctx, Env, ensure, ensure_eq, everyone, expect_err, invalid, pass, reader, samples,
};
use crate::{ChangeKind, DocumentStore, Expect, MAX_CHANGES_LIMIT, ReaderFilter};
use serde_json::json;

pub(super) const CASES: &[(&str, super::CaseFn)] = &[
    ("ascending_with_after_and_limit", order),
    ("a_change_carries_its_trace_and_time", trace_and_time),
    ("trace_filters_to_one_call", trace_filter),
    ("revisions_are_dense_only_under_derivation", density),
    (
        "a_delete_is_readable_by_the_deleted_versions_access",
        delete_access,
    ),
    ("limits", limits),
];

fn put(d: &dyn DocumentStore, id: &str, access: &[&str], trace: &str) -> Result<u64, String> {
    d.put_document(samples::document(id, access, id, trace), Expect::Any)
        .map(|m| m.rev)
        .ctx("put_document")
}

fn order(env: &Env<'_>) -> CaseResult {
    let s = env.fresh()?;
    let d = &*s.stores.documents;
    for n in 0..12 {
        put(d, &format!("a/doc-{n:02}"), &["space"], "t")?;
    }
    let all = d.changes(0, 100, &everyone(), None).ctx("changes")?;
    ensure_eq(
        all.iter().map(|c| c.rev).collect::<Vec<_>>(),
        (1..=12).collect::<Vec<_>>(),
        "ascending and dense",
    )?;
    let page = d.changes(4, 3, &everyone(), None).ctx("changes")?;
    ensure_eq(
        page.iter().map(|c| c.rev).collect::<Vec<_>>(),
        vec![5, 6, 7],
        "`after` is exclusive and `limit` bounds the page",
    )?;
    ensure(
        d.changes(12, 10, &everyone(), None)
            .ctx("changes")?
            .is_empty(),
        "nothing after head",
    )?;
    pass()
}

fn trace_and_time(env: &Env<'_>) -> CaseResult {
    let s = env.fresh()?;
    let d = &*s.stores.documents;
    let doc = samples::document("a/doc", &["space"], "x", "trace-one");
    let hash = doc.content_hash.clone();
    d.put_document(doc, Expect::Any).ctx("put")?;
    let changes = d.changes(0, 10, &everyone(), None).ctx("changes")?;
    let change = changes.first().ok_or("no change was recorded")?;
    ensure_eq(change.kind, ChangeKind::Put, "kind")?;
    ensure_eq(change.target.as_str(), "a/doc", "target")?;
    ensure_eq(change.content_hash.as_deref(), Some(hash.as_str()), "hash")?;
    ensure_eq(change.trace_id.as_deref(), Some("trace-one"), "trace")?;
    ensure_eq(
        change.at.as_str(),
        "2026-11-02T10:00:00.000Z",
        "`at` is the envelope's observedAt",
    )?;
    pass()
}

fn trace_filter(env: &Env<'_>) -> CaseResult {
    let s = env.fresh()?;
    let d = &*s.stores.documents;
    for n in 0..9 {
        put(
            d,
            &format!("a/doc-{n}"),
            &["space"],
            &format!("trace-{}", n % 3),
        )?;
    }
    d.put_record(
        "k",
        "sync",
        "r",
        json!({}),
        samples::envelope(&["space"], "trace-1", "2026-11-02T10:00:00.000Z"),
        Expect::Any,
    )
    .ctx("put_record")?;
    let ones = d
        .changes(0, 100, &everyone(), Some("trace-1"))
        .ctx("changes")?;
    ensure_eq(
        ones.iter().map(|c| c.rev).collect::<Vec<_>>(),
        vec![2, 5, 8, 10],
        "only the call's changes, records included",
    )?;
    ensure(
        d.changes(0, 100, &everyone(), Some("nobody"))
            .ctx("changes")?
            .is_empty(),
        "an unknown trace",
    )?;
    let after = d
        .changes(5, 100, &everyone(), Some("trace-1"))
        .ctx("changes")?;
    ensure_eq(
        after.iter().map(|c| c.rev).collect::<Vec<_>>(),
        vec![8, 10],
        "trace and after together",
    )?;
    pass()
}

fn density(env: &Env<'_>) -> CaseResult {
    let s = env.fresh()?;
    let d = &*s.stores.documents;
    for n in 0..10 {
        let access: &[&str] = if n % 3 == 0 {
            &["group:eng"]
        } else {
            &["space"]
        };
        put(d, &format!("a/doc-{n}"), access, "t")?;
    }
    let derivation = d
        .changes(0, 100, &ReaderFilter::derivation(), None)
        .ctx("changes")?;
    ensure_eq(
        derivation.iter().map(|c| c.rev).collect::<Vec<_>>(),
        (1..=10).collect::<Vec<_>>(),
        "a derivation read sees every revision",
    )?;
    let outsider = d.changes(0, 100, &everyone(), None).ctx("changes")?;
    ensure_eq(
        outsider
            .iter()
            .map(|c| c.target.as_str())
            .collect::<Vec<_>>(),
        vec![
            "a/doc-1", "a/doc-2", "a/doc-4", "a/doc-5", "a/doc-7", "a/doc-8",
        ],
        "unreadable changes are omitted",
    )?;
    let engineer = d
        .changes(0, 100, &reader(&["space", "group:eng"]), None)
        .ctx("changes")?;
    ensure_eq(engineer.len(), 10, "a reader holding the group sees all")?;
    let none = d.changes(0, 100, &reader(&[]), None).ctx("changes")?;
    ensure(none.is_empty(), "a reader with no tokens sees nothing")?;
    pass()
}

fn delete_access(env: &Env<'_>) -> CaseResult {
    let s = env.fresh()?;
    let d = &*s.stores.documents;
    put(d, "a/secret", &["group:eng"], "t1")?;
    put(d, "a/open", &["space"], "t2")?;
    d.delete_document(
        "a/secret",
        Expect::Any,
        samples::envelope(&["space"], "t3", "2026-11-02T10:05:00.000Z"),
    )
    .ctx("delete")?;
    d.delete_document(
        "a/open",
        Expect::Any,
        samples::envelope(&["group:eng"], "t4", "2026-11-02T10:06:00.000Z"),
    )
    .ctx("delete")?;
    let outsider = d.changes(0, 100, &everyone(), None).ctx("changes")?;
    ensure_eq(
        outsider.iter().map(|c| (c.rev, c.kind)).collect::<Vec<_>>(),
        vec![(2, ChangeKind::Put), (4, ChangeKind::Delete)],
        "a delete is as readable as the version it deleted, whatever the delete's own envelope says",
    )?;
    ensure_eq(outsider[1].target.as_str(), "a/open", "the visible delete")?;
    pass()
}

fn limits(env: &Env<'_>) -> CaseResult {
    let s = env.fresh()?;
    let d = &*s.stores.documents;
    expect_err(d.changes(0, 0, &everyone(), None), "a zero limit", invalid)?;
    expect_err(
        d.changes(0, MAX_CHANGES_LIMIT + 1, &everyone(), None),
        "a limit past 1000",
        invalid,
    )?;
    d.changes(0, MAX_CHANGES_LIMIT, &everyone(), None)
        .ctx("the largest limit")?;
    pass()
}

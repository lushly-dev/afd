//! Group `documents`: compare-and-set, revisions, tombstones, paging order and size limits.

use super::{
    CaseResult, Ctx, Env, conflict, ensure, ensure_eq, everyone, expect_err, invalid, pass, reader,
    samples,
};
use crate::{
    ContentHash, Envelope, Expect, ListQuery, MAX_DOC_ID_BYTES, MAX_DOCUMENT_BYTES, MAX_LIST_LIMIT,
    StoreError,
};

pub(super) const CASES: &[(&str, super::CaseFn)] = &[
    ("put_then_get_returns_what_was_written", put_then_get),
    ("revisions_are_consecutive_from_one", revisions),
    ("expect_is_a_compare_and_set", expect_cas),
    (
        "a_refused_write_changes_nothing",
        refused_writes_change_nothing,
    ),
    ("delete_writes_a_tombstone", delete_tombstone),
    ("listing_is_ordered_by_id_and_pages", listing_pages),
    (
        "listing_filters_by_collection_prefix_and_type",
        listing_filters,
    ),
    ("size_and_shape_limits", limits),
    ("the_record_must_agree_with_itself", self_consistency),
];

fn put_then_get(env: &Env<'_>) -> CaseResult {
    let s = env.fresh()?;
    let d = &s.stores.documents;
    let doc = samples::document("handbook/intro", &["space"], "hello\nworld\n", "t1");
    let meta = d
        .put_document(doc.clone(), Expect::Absent)
        .ctx("put_document")?;
    ensure_eq(meta.rev, 1, "the first write takes revision 1")?;
    ensure_eq(
        meta.id.as_str(),
        "handbook/intro",
        "the meta names the document",
    )?;
    let got = d
        .get_document("handbook/intro", &everyone())
        .ctx("get_document")?;
    let got = got.ok_or("the written document is not readable")?;
    ensure_eq(got.rev, 1, "the stored revision")?;
    ensure_eq(
        got.write,
        doc,
        "the document reads back as it was written, bytes included",
    )?;
    ensure_eq(d.head().ctx("head")?, 1, "head")?;
    ensure(
        d.get_document("handbook/missing", &everyone())
            .ctx("get")?
            .is_none(),
        "an absent id reads as None",
    )?;
    super::pass()
}

fn revisions(env: &Env<'_>) -> CaseResult {
    let s = env.fresh()?;
    let d = &s.stores.documents;
    ensure_eq(d.head().ctx("head")?, 0, "an empty store's head")?;
    for (n, id) in ["a/one", "a/two", "b/three"].iter().enumerate() {
        let meta = d
            .put_document(samples::document(id, &["space"], id, "t"), Expect::Any)
            .ctx("put_document")?;
        ensure_eq(meta.rev, n as u64 + 1, "revisions are consecutive")?;
    }
    let again = d
        .put_document(
            samples::document("a/one", &["space"], "changed", "t"),
            Expect::Any,
        )
        .ctx("replace")?;
    ensure_eq(again.rev, 4, "a replacement takes the next revision")?;
    let got = d
        .get_document("a/one", &everyone())
        .ctx("get")?
        .ok_or("a/one vanished")?;
    ensure_eq(
        got.bytes.as_slice(),
        b"changed".as_slice(),
        "the replacement replaced the bytes",
    )?;
    ensure_eq(got.rev, 4, "the document carries its latest revision")?;
    ensure_eq(d.head().ctx("head")?, 4, "head")?;
    let page = d
        .list_documents(&ListQuery::all(10), &everyone())
        .ctx("list")?;
    ensure_eq(
        page.items.len(),
        3,
        "a replacement is not a second document",
    )?;
    pass()
}

fn expect_cas(env: &Env<'_>) -> CaseResult {
    let s = env.fresh()?;
    let d = &s.stores.documents;
    let first = samples::document("a/doc", &["space"], "one", "t");
    let hash = first.content_hash.clone();
    expect_err(
        d.put_document(first.clone(), Expect::Hash(hash.clone())),
        "Hash against an absent document",
        |e| matches!(e, StoreError::Conflict { current: None }),
    )?;
    d.put_document(first.clone(), Expect::Absent)
        .ctx("Absent on a new document")?;
    expect_err(
        d.put_document(first.clone(), Expect::Absent),
        "Absent against an existing document",
        |e| matches!(e, StoreError::Conflict { current: Some(c) } if c == hash.as_str()),
    )?;
    let other = ContentHash::of(b"not it");
    expect_err(
        d.put_document(
            samples::document("a/doc", &["space"], "two", "t"),
            Expect::Hash(other),
        ),
        "Hash mismatch",
        conflict,
    )?;
    ensure_eq(d.head().ctx("head")?, 1, "a conflict writes nothing")?;
    let second = samples::document("a/doc", &["space"], "two", "t");
    d.put_document(second, Expect::Hash(hash))
        .ctx("Hash match")?;
    ensure_eq(d.head().ctx("head")?, 2, "head after the compare-and-set")?;
    pass()
}

fn refused_writes_change_nothing(env: &Env<'_>) -> CaseResult {
    let s = env.fresh()?;
    let d = &s.stores.documents;
    d.put_document(
        samples::document("a/doc", &["space"], "one", "t"),
        Expect::Any,
    )
    .ctx("put")?;
    let mut bad = samples::document("a/doc", &["space"], "two", "t");
    bad.content_hash = ContentHash::of(b"other");
    expect_err(
        d.put_document(bad, Expect::Any),
        "a wrong content hash",
        invalid,
    )?;
    let mut bad = samples::document("a/doc", &["space"], "two", "t");
    bad.size += 1;
    expect_err(d.put_document(bad, Expect::Any), "a wrong size", invalid)?;
    let mut bad = samples::document("a/doc", &["space"], "two", "t");
    bad.space = "other".to_owned();
    bad.envelope.space = "other".to_owned();
    expect_err(
        d.put_document(bad, Expect::Any),
        "another space's document",
        invalid,
    )?;
    ensure_eq(d.head().ctx("head")?, 1, "refusals take no revision")?;
    let got = d
        .get_document("a/doc", &everyone())
        .ctx("get")?
        .ok_or("the document vanished")?;
    ensure_eq(
        got.bytes.as_slice(),
        b"one".as_slice(),
        "refusals leave the stored document alone",
    )?;
    pass()
}

fn delete_tombstone(env: &Env<'_>) -> CaseResult {
    let s = env.fresh()?;
    let d = &s.stores.documents;
    let doc = samples::document("a/doc", &["space"], "one", "t1");
    let hash = doc.content_hash.clone();
    d.put_document(doc, Expect::Any).ctx("put")?;
    let envelope = |trace: &str| samples::envelope(&["space"], trace, "2026-11-02T10:01:00.000Z");
    expect_err(
        d.delete_document("a/missing", Expect::Any, envelope("t2")),
        "deleting an absent document",
        |e| matches!(e, StoreError::NotFound),
    )?;
    expect_err(
        d.delete_document("a/doc", Expect::Hash(ContentHash::of(b"x")), envelope("t2")),
        "deleting with the wrong hash",
        conflict,
    )?;
    expect_err(
        d.delete_document("a/doc", Expect::Absent, envelope("t2")),
        "Absent on a delete",
        conflict,
    )?;
    ensure_eq(d.head().ctx("head")?, 1, "refused deletes take no revision")?;
    let rev = d
        .delete_document("a/doc", Expect::Hash(hash), envelope("t2"))
        .ctx("delete")?;
    ensure_eq(rev, 2, "a delete takes the next revision")?;
    ensure(
        d.get_document("a/doc", &everyone()).ctx("get")?.is_none(),
        "a deleted document is gone",
    )?;
    ensure(
        d.list_documents(&ListQuery::all(10), &everyone())
            .ctx("list")?
            .items
            .is_empty(),
        "a deleted document is not listed",
    )?;
    let mut bad: Envelope = envelope("t3");
    bad.access.clear();
    expect_err(
        d.delete_document("a/doc", Expect::Any, bad),
        "a delete with a bad envelope",
        |e| invalid(e) || matches!(e, StoreError::NotFound),
    )?;
    d.put_document(
        samples::document("a/doc", &["space"], "again", "t4"),
        Expect::Absent,
    )
    .ctx("recreating a deleted id with Absent")?;
    ensure_eq(d.head().ctx("head")?, 3, "head")?;
    pass()
}

fn listing_pages(env: &Env<'_>) -> CaseResult {
    let s = env.fresh()?;
    let d = &s.stores.documents;
    // Written out of order on purpose.
    let ids: Vec<String> = (0..25)
        .map(|n| format!("col/doc-{:02}", (n * 7) % 25))
        .collect();
    for id in &ids {
        d.put_document(samples::document(id, &["space"], id, "t"), Expect::Any)
            .ctx("put")?;
    }
    let mut seen = Vec::new();
    let mut query = ListQuery::all(10);
    loop {
        let page = d.list_documents(&query, &everyone()).ctx("list")?;
        ensure(page.items.len() <= 10, "a page holds at most `limit` items")?;
        seen.extend(page.items.iter().map(|m| m.id.clone()));
        match page.next {
            Some(next) => {
                ensure_eq(
                    page.items.last().map(|m| m.id.clone()),
                    Some(next.clone()),
                    "next is the last id",
                )?;
                query.after = Some(next);
            }
            None => break,
        }
    }
    let mut sorted = ids;
    sorted.sort();
    ensure_eq(seen, sorted, "pages concatenate to every id in order")?;
    let exact = d
        .list_documents(&ListQuery::all(25), &everyone())
        .ctx("list")?;
    ensure(
        exact.next.is_none(),
        "a page that holds the rest has no next",
    )?;
    pass()
}

fn listing_filters(env: &Env<'_>) -> CaseResult {
    let s = env.fresh()?;
    let d = &s.stores.documents;
    for id in [
        "alpha/a/one",
        "alpha/a/two",
        "alpha/b/one",
        "beta/a/one",
        "alphabet/x",
    ] {
        let mut doc = samples::document(id, &["space"], id, "t");
        if id.ends_with("two") {
            doc.doc_type = "runbook".to_owned();
        }
        d.put_document(doc, Expect::Any).ctx("put")?;
    }
    let ids = |query: ListQuery| -> Result<Vec<String>, String> {
        Ok(d.list_documents(&query, &everyone())
            .ctx("list")?
            .items
            .into_iter()
            .map(|m| m.id)
            .collect())
    };
    let mut q = ListQuery::all(50);
    q.collection = Some("alpha".to_owned());
    ensure_eq(
        ids(q)?,
        ["alpha/a/one", "alpha/a/two", "alpha/b/one"]
            .map(String::from)
            .to_vec(),
        "collection",
    )?;
    let mut q = ListQuery::all(50);
    q.prefix = Some("alpha/a/".to_owned());
    ensure_eq(
        ids(q)?,
        ["alpha/a/one", "alpha/a/two"].map(String::from).to_vec(),
        "prefix",
    )?;
    let mut q = ListQuery::all(50);
    q.doc_type = Some("runbook".to_owned());
    ensure_eq(ids(q)?, vec!["alpha/a/two".to_owned()], "type")?;
    let mut q = ListQuery::all(50);
    q.prefix = Some("alpha".to_owned());
    q.after = Some("alpha/a/one".to_owned());
    ensure_eq(
        ids(q)?,
        ["alpha/a/two", "alpha/b/one", "alphabet/x"]
            .map(String::from)
            .to_vec(),
        "prefix with after (the prefix is not a path segment)",
    )?;
    let mut q = ListQuery::all(50);
    q.prefix = Some("100%_".to_owned());
    ensure_eq(
        ids(q)?,
        Vec::<String>::new(),
        "wildcard characters in a prefix are literal",
    )?;
    pass()
}

fn limits(env: &Env<'_>) -> CaseResult {
    let s = env.fresh()?;
    let d = &s.stores.documents;
    for limit in [0, MAX_LIST_LIMIT + 1] {
        expect_err(
            d.list_documents(&ListQuery::all(limit), &everyone()),
            "a list limit out of range",
            invalid,
        )?;
    }
    d.list_documents(&ListQuery::all(MAX_LIST_LIMIT), &everyone())
        .ctx("the largest list limit")?;
    let long = format!("col/{}", "x".repeat(MAX_DOC_ID_BYTES));
    expect_err(
        d.put_document(samples::document(&long, &["space"], "x", "t"), Expect::Any),
        "an id past 512 bytes",
        invalid,
    )?;
    let at_limit = format!("col/{}", "x".repeat(MAX_DOC_ID_BYTES - 4));
    d.put_document(
        samples::document(&at_limit, &["space"], "x", "t"),
        Expect::Any,
    )
    .ctx("an id of exactly 512 bytes")?;
    expect_err(
        d.put_document(
            samples::document("Bad/doc", &["space"], "x", "t"),
            Expect::Any,
        ),
        "a collection that is not a slug",
        invalid,
    )?;
    expect_err(
        d.put_document(samples::document("col/", &["space"], "x", "t"), Expect::Any),
        "an id with no path",
        invalid,
    )?;
    let big = "x".repeat(MAX_DOCUMENT_BYTES + 1);
    expect_err(
        d.put_document(
            samples::document("col/big", &["space"], &big, "t"),
            Expect::Any,
        ),
        "a document past the byte cap",
        |e| matches!(e, StoreError::TooLarge(_)),
    )?;
    let mid = "y".repeat(1024 * 1024);
    d.put_document(
        samples::document("col/mid", &["space"], &mid, "t"),
        Expect::Any,
    )
    .ctx("a 1 MiB document")?;
    let got = d
        .get_document("col/mid", &everyone())
        .ctx("get")?
        .ok_or("the 1 MiB document vanished")?;
    ensure_eq(
        got.bytes.len(),
        mid.len(),
        "a large document reads back whole",
    )?;
    let mut huge = samples::document("col/meta", &["space"], "x", "t");
    huge.frontmatter.insert(
        "k".to_owned(),
        serde_json::Value::String("z".repeat(300 * 1024)),
    );
    expect_err(
        d.put_document(huge, Expect::Any),
        "metadata past its cap",
        |e| matches!(e, StoreError::TooLarge(_)),
    )?;
    pass()
}

fn self_consistency(env: &Env<'_>) -> CaseResult {
    let s = env.fresh()?;
    let d = &s.stores.documents;
    let mut doc = samples::document("a/doc", &["space"], "x", "t");
    doc.envelope.access = vec!["group:eng".to_owned()];
    expect_err(
        d.put_document(doc, Expect::Any),
        "an envelope whose access differs from the document's",
        invalid,
    )?;
    let mut doc = samples::document("a/doc", &["space"], "x", "t");
    doc.envelope.sensitivity = Some(crate::Sensitivity::Restricted);
    expect_err(
        d.put_document(doc, Expect::Any),
        "an envelope whose sensitivity differs",
        invalid,
    )?;
    let mut doc = samples::document("a/doc", &["space"], "x", "t");
    doc.version = 2;
    expect_err(
        d.put_document(doc, Expect::Any),
        "an unknown record version",
        invalid,
    )?;
    ensure_eq(d.head().ctx("head")?, 0, "nothing was written")?;
    let _ = reader(&["space"]);
    pass()
}

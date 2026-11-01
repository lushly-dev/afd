//! Group `records`: plugin records share the revision sequence and the rules of documents.

use serde_json::json;

use super::{CaseResult, Ctx, Env, conflict, ensure, ensure_eq, everyone, expect_err, invalid, pass, reader, samples};
use crate::{ChangeKind, Expect, MAX_RECORD_BYTES, ReaderFilter, StoreError};

pub(super) const CASES: &[(&str, super::CaseFn)] = &[
    ("put_then_get_and_namespaces_are_separate", roundtrip),
    ("records_share_the_revision_sequence", shared_revisions),
    ("expect_is_a_compare_and_set", expect_cas),
    ("listing_pages_by_id_within_a_kind", listing),
    ("coordinates_and_size_limits", limits),
];

fn env_for(trace: &str, access: &[&str]) -> crate::Envelope {
    samples::envelope(access, trace, "2026-11-02T10:00:00.000Z")
}

fn roundtrip(env: &Env<'_>) -> CaseResult {
    let s = env.fresh()?;
    let d = &s.stores.documents;
    let body = json!({"b": [1, {"z": true, "a": null}], "a": "x"});
    let meta = d
        .put_record("knowledge", "proposal", "p1", body.clone(), env_for("t1", &["space"]), Expect::Absent)
        .ctx("put_record")?;
    ensure_eq(meta.rev, 1, "the first record takes revision 1")?;
    let got = d.get_record("knowledge", "proposal", "p1", &everyone()).ctx("get_record")?.ok_or("the record is not readable")?;
    ensure_eq(got.body, body.clone(), "the body reads back")?;
    ensure_eq(got.content_hash.clone(), meta.content_hash.clone(), "the hash is the body's")?;
    ensure_eq(
        meta.content_hash,
        crate::ContentHash::of(crate::canonical_json(&body).as_bytes()),
        "the hash is over canonical JSON, whatever the key order",
    )?;
    d.put_record("sources", "proposal", "p1", json!({"other": 1}), env_for("t2", &["space"]), Expect::Absent)
        .ctx("the same coordinates in another namespace")?;
    let other = d.get_record("sources", "proposal", "p1", &everyone()).ctx("get")?.ok_or("the other record is gone")?;
    ensure_eq(other.body, json!({"other": 1}), "namespaces do not share records")?;
    ensure(
        d.get_record("knowledge", "sync", "p1", &everyone()).ctx("get")?.is_none(),
        "kinds do not share records",
    )?;
    pass()
}

fn shared_revisions(env: &Env<'_>) -> CaseResult {
    let s = env.fresh()?;
    let d = &s.stores.documents;
    d.put_document(samples::document("a/doc", &["space"], "x", "t1"), Expect::Any).ctx("put document")?;
    let meta = d.put_record("k", "sync", "r", json!({}), env_for("t2", &["space"]), Expect::Any).ctx("put record")?;
    ensure_eq(meta.rev, 2, "a record takes the next revision after a document")?;
    d.put_document(samples::document("a/doc2", &["space"], "x", "t3"), Expect::Any).ctx("put document")?;
    ensure_eq(d.head().ctx("head")?, 3, "head counts documents and records")?;
    let changes = d.changes(0, 10, &ReaderFilter::derivation(), None).ctx("changes")?;
    ensure_eq(changes.iter().map(|c| c.kind).collect::<Vec<_>>(), vec![ChangeKind::Put, ChangeKind::Record, ChangeKind::Put], "kinds")?;
    ensure_eq(changes[1].target.as_str(), "k/sync/r", "a record's change targets ns/kind/id")?;
    pass()
}

fn expect_cas(env: &Env<'_>) -> CaseResult {
    let s = env.fresh()?;
    let d = &s.stores.documents;
    let first = d.put_record("k", "sync", "r", json!({"v": 1}), env_for("t", &["space"]), Expect::Absent).ctx("create")?;
    expect_err(
        d.put_record("k", "sync", "r", json!({"v": 2}), env_for("t", &["space"]), Expect::Absent),
        "Absent against an existing record",
        conflict,
    )?;
    expect_err(
        d.put_record("k", "sync", "r", json!({"v": 2}), env_for("t", &["space"]), Expect::Hash(crate::ContentHash::of(b"x"))),
        "a wrong hash",
        conflict,
    )?;
    d.put_record("k", "sync", "r", json!({"v": 2}), env_for("t", &["space"]), Expect::Hash(first.content_hash)).ctx("a matching hash")?;
    ensure_eq(d.head().ctx("head")?, 2, "refused writes took no revision")?;
    let got = d.get_record("k", "sync", "r", &everyone()).ctx("get")?.ok_or("the record vanished")?;
    ensure_eq(got.body, json!({"v": 2}), "the replacement is stored")?;
    pass()
}

fn listing(env: &Env<'_>) -> CaseResult {
    let s = env.fresh()?;
    let d = &s.stores.documents;
    for id in ["r3", "r1", "r5", "r2", "r4"] {
        d.put_record("k", "sync", id, json!({"id": id}), env_for("t", &["space"]), Expect::Any).ctx("put")?;
    }
    d.put_record("k", "other", "r0", json!({}), env_for("t", &["space"]), Expect::Any).ctx("put")?;
    let page = d.list_records("k", "sync", None, 2, &everyone()).ctx("list")?;
    ensure_eq(page.items.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(), vec!["r1", "r2"], "first page")?;
    ensure_eq(page.next.as_deref(), Some("r2"), "cursor")?;
    let page = d.list_records("k", "sync", page.next.as_deref(), 10, &everyone()).ctx("list")?;
    ensure_eq(page.items.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(), vec!["r3", "r4", "r5"], "second page")?;
    ensure(page.next.is_none(), "last page")?;
    expect_err(d.list_records("k", "sync", None, 0, &everyone()), "a zero limit", invalid)?;
    pass()
}

fn limits(env: &Env<'_>) -> CaseResult {
    let s = env.fresh()?;
    let d = &s.stores.documents;
    let put = |ns: &str, kind: &str, id: &str, body: serde_json::Value| {
        d.put_record(ns, kind, id, body, env_for("t", &["space"]), Expect::Any)
    };
    expect_err(put("Bad", "k", "r", json!({})), "a namespace that is not a slug", invalid)?;
    expect_err(put("k", "bad kind", "r", json!({})), "a kind that is not a slug", invalid)?;
    expect_err(put("k", "k", "", json!({})), "an empty id", invalid)?;
    expect_err(put("k", "k", &"x".repeat(513), json!({})), "an id past 512 bytes", invalid)?;
    let big = json!({"text": "x".repeat(MAX_RECORD_BYTES)});
    expect_err(put("k", "k", "big", big), "a body past 2 MiB", |e| matches!(e, StoreError::TooLarge(_)))?;
    put("k", "k", "ok", json!({"text": "x".repeat(MAX_RECORD_BYTES / 2)})).ctx("a 1 MiB body")?;
    let mut e = env_for("t", &["space"]);
    e.origin = crate::Origin::Unspecified;
    expect_err(d.put_record("k", "k", "r", json!({}), e, Expect::Any), "an unspecified origin", invalid)?;
    ensure_eq(d.head().ctx("head")?, 1, "refusals took no revision")?;
    let _ = reader(&["space"]);
    pass()
}

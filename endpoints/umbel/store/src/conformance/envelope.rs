//! Group `envelope`: the refusals of section 2.1, on every write path.

use serde_json::json;

use super::{CaseResult, Ctx, Env, ensure_eq, expect_err, invalid, pass, samples};
use crate::{DocumentStore, Envelope, Expect, Origin, Source};

pub(super) const CASES: &[(&str, super::CaseFn)] = &[
    ("origin_unspecified_is_refused", unspecified),
    ("missing_access_or_sensitivity_is_refused", missing),
    ("malformed_values_are_refused", malformed),
    ("reserved_fields_do_not_parse", reserved),
];

fn base() -> Envelope {
    samples::envelope(&["space"], "t", "2026-11-02T10:00:00.000Z")
}

/// Every refusal must hold on all three write paths and leave the store untouched.
fn refused(
    d: &dyn DocumentStore,
    mutate: impl Fn(&mut Envelope),
    what: &str,
) -> Result<(), String> {
    let mut doc = samples::document("a/doc", &["space"], "x", "t");
    mutate(&mut doc.envelope);
    expect_err(
        d.put_document(doc, Expect::Any),
        &format!("put_document with {what}"),
        invalid,
    )?;
    let mut e = base();
    mutate(&mut e);
    expect_err(
        d.put_record("k", "sync", "r", json!({}), e.clone(), Expect::Any),
        &format!("put_record with {what}"),
        invalid,
    )?;
    d.put_document(
        samples::document("a/seed", &["space"], "x", "t"),
        Expect::Any,
    )
    .ctx("seed")?;
    let before = d.head().ctx("head")?;
    expect_err(
        d.delete_document("a/seed", Expect::Any, e),
        &format!("delete_document with {what}"),
        invalid,
    )?;
    ensure_eq(
        d.head().ctx("head")?,
        before,
        &format!("{what} took a revision"),
    )?;
    // Leave the store as it was found for the next refusal.
    d.delete_document("a/seed", Expect::Any, base())
        .ctx("unseed")?;
    Ok(())
}

fn unspecified(env: &Env<'_>) -> CaseResult {
    let s = env.fresh()?;
    refused(
        &*s.stores.documents,
        |e| e.origin = Origin::Unspecified,
        "origin `unspecified`",
    )?;
    pass()
}

fn missing(env: &Env<'_>) -> CaseResult {
    let s = env.fresh()?;
    let d = &*s.stores.documents;
    refused(d, |e| e.access.clear(), "no access")?;
    refused(d, |e| e.sensitivity = None, "no sensitivity")?;
    pass()
}

fn malformed(env: &Env<'_>) -> CaseResult {
    let s = env.fresh()?;
    let d = &*s.stores.documents;
    refused(
        d,
        |e| e.access = vec!["everybody".to_owned()],
        "an access token that is not a token",
    )?;
    refused(d, |e| e.version = 0, "version 0")?;
    refused(d, |e| e.space = "other".to_owned(), "another space")?;
    refused(
        d,
        |e| e.principal = Some("robot:x".to_owned()),
        "a principal of an unknown kind",
    )?;
    refused(d, |e| e.confidence = Some(1.5), "confidence above 1")?;
    refused(
        d,
        |e| e.content_hash = Some("md5:abc".to_owned()),
        "a content hash that is not sha256",
    )?;
    refused(
        d,
        |e| {
            e.sources = Some(
                (0..65)
                    .map(|n| Source {
                        resource: format!("/r{n}"),
                        id: None,
                        title: None,
                        author: None,
                        last_modified: None,
                    })
                    .collect(),
            )
        },
        "65 sources",
    )?;
    pass()
}

fn reserved(_: &Env<'_>) -> CaseResult {
    for field in ["redactions", "delegationChain", "tenant", "surprise"] {
        let mut value = serde_json::to_value(base()).map_err(|e| e.to_string())?;
        value[field] = json!("x");
        expect_err(
            Envelope::from_value(value),
            &format!("the reserved field `{field}`"),
            invalid,
        )?;
    }
    pass()
}

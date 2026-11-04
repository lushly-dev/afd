//! Determinism (phase 4 specification, section 4.6): `curator-plan`'s batch is a pure function of
//! the caller's readable records and documents, the pack, the caller's curator records and `now`.
//! Candidates come in id order, then re-verifications in document id order, at most
//! `max_proposals` per run.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::Value;
use support::*;
use umbel_okf::draft;
use umbel_store::MemoryWrite;
use umbel_store::memory::format_instant;

/// The facts and documents every workspace here holds.
fn facts() -> Vec<MemoryWrite> {
    (1..=4)
        .map(|n| {
            constrained(
                fact(
                    n,
                    "human:ada",
                    &["space"],
                    &format!("Subject {n}"),
                    &format!("Text {n}, with a constraint."),
                ),
                &["only on weekdays"],
            )
        })
        .collect()
}

/// A workspace with `facts` written in `order`, each observed in two sessions, and two documents
/// due for re-verification, written in `docs` order.
fn workspace(order: &[usize], docs: &[&str]) -> Fx {
    let mut fx = Fx::new();
    let all = facts();
    for &i in order {
        let entry = all[i].clone();
        let n = 1 + i as u64;
        fx.remember_twice(entry, n + 100);
    }
    for name in docs {
        fx.markdown(&format!("notes/{name}"), &format!("# {name}\n"), |write| {
            write.stale_after = Some(format_instant(day(15)));
        });
    }
    fx.at(day(8));
    fx
}

/// The batch a run submitted, in the order the stand-in stored it: key, document, op and the
/// item's hash.
fn batch(fx: &Fx) -> Vec<(String, String, String, String)> {
    let mut stubs = fx.stubs();
    stubs.sort_by_key(|s| s["rev"].as_u64().unwrap());
    stubs
        .iter()
        .map(|s| {
            let text = |key: &str| s[key].as_str().unwrap_or_default().to_owned();
            (text("key"), text("doc"), text("op"), text("itemHash"))
        })
        .collect()
}

/// A report without its run's trace id.
fn without_run(mut report: Value) -> Value {
    report["run"] = Value::Null;
    report
}

#[tokio::test]
async fn the_same_records_and_documents_in_any_order_give_the_same_batch() {
    let one = workspace(&[0, 1, 2, 3], &["x", "y"]);
    let two = workspace(&[3, 1, 0, 2], &["y", "x"]);
    let (a, b) = (one.report().await, two.report().await);
    assert_eq!(a["counts"]["drafted"], 4, "{a}");
    assert_eq!(a["counts"]["reverify"], 2);
    assert_eq!(without_run(a), without_run(b));
    let (first, second) = (batch(&one), batch(&two));
    assert_eq!(first.len(), 6);
    assert_eq!(first, second);

    // Candidates in id order, then the reviews in document id order.
    let mut ids: Vec<String> = (1..=4)
        .map(|n| draft::candidate_id("main", "human:local", &mem(n)))
        .collect();
    ids.sort();
    let keys: Vec<&str> = first.iter().map(|(key, ..)| key.as_str()).collect();
    for (at, id) in ids.iter().enumerate() {
        assert_eq!(keys[at], format!("curator/{id}/0"));
    }
    let docs: Vec<&str> = first[4..].iter().map(|(_, doc, ..)| doc.as_str()).collect();
    assert_eq!(docs, ["notes/x", "notes/y"]);
}

#[tokio::test]
async fn a_rerun_at_the_same_instant_renders_the_same_batch() {
    // The same workspace twice from scratch: the same bytes to the batch, and the second run of
    // each finds everything drafted.
    let one = workspace(&[0, 1, 2, 3], &["x"]);
    let two = workspace(&[0, 1, 2, 3], &["x"]);
    one.report().await;
    two.report().await;
    assert_eq!(batch(&one), batch(&two));
    let again = one.report().await;
    assert_eq!(again["counts"]["drafted"], 0, "{again}");
    assert_eq!(again["counts"]["reverify"], 0);
    assert_eq!(batch(&one).len(), 5);
}

#[tokio::test]
async fn max_proposals_cuts_candidates_first_then_reviews_in_order() {
    let mut fx = workspace(&[0, 1], &["y", "x"]);
    fx.pack(|pack| pack.replace("max_proposals = 20", "max_proposals = 3"));
    let report = fx.report().await;
    assert_eq!(report["counts"]["drafted"], 2, "{report}");
    assert_eq!(report["counts"]["reverify"], 1);
    assert_eq!(report["counts"]["remaining"], 1);
    let docs: Vec<String> = batch(&fx).into_iter().map(|(_, doc, ..)| doc).collect();
    assert_eq!(docs[2], "notes/x", "{docs:?}");
}

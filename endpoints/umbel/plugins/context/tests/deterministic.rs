//! Determinism (section 9.6): a byte-equal repeat, an equal digest across write orders with
//! fixed ids on a rebuilt index, and `state` kept out of the digest.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::*;
use umbel_store::{
    Authority, DocumentStore, DocumentWrite, Expect, IndexChunk, MemoryClass, MemoryWrite,
    SearchIndex,
};
use umbel_store_embedded::{SqliteStore, StoreOptions, TantivyIndex};

fn docs() -> Vec<(DocumentWrite, Vec<IndexChunk>)> {
    (0..8)
        .map(|n| {
            doc(
                "main",
                &format!("handbook/d{n}"),
                &format!("Doc {n}"),
                &format!(
                    "detq canary rollback {}\n\nsecond detq part {n}",
                    "word ".repeat(n)
                ),
            )
        })
        .collect()
}

fn memories() -> Vec<MemoryWrite> {
    let mut out = Vec::new();
    for n in 1..=6u64 {
        let authority = if n % 2 == 0 {
            Authority::Person
        } else {
            Authority::Agent
        };
        let class = if n % 3 == 0 {
            MemoryClass::Procedural
        } else {
            MemoryClass::Semantic
        };
        out.push(entry(
            n,
            "main",
            "human:ada",
            class,
            authority,
            &format!("Note {n}"),
            &format!("detq note {n} {}", "more ".repeat(n as usize)),
        ));
    }
    out
}

/// A workspace whose stores hold `docs` and `memories`, written in the given orders.
fn workspace(order: &[usize], memory_order: &[usize]) -> Fx {
    let mut fx = Fx::with(&config(
        "[plugins.context.config]\npush_authorities = [\"person\", \"agent\"]\n",
    ));
    let all = docs();
    fx.index("main", order.iter().map(|&n| all[n].clone()).collect());
    let notes = memories();
    fx.remember(
        "main",
        memory_order.iter().map(|&n| notes[n].clone()).collect(),
    );
    fx
}

const INPUT: &str = r#"{ "task": "detq canary", "sections": ["knowledge", "semantic", "procedural"], "render": "text" }"#;

fn input() -> Value {
    serde_json::from_str(INPUT).unwrap()
}

#[tokio::test]
async fn a_repeat_is_byte_equal() {
    let mut fx = workspace(&[0, 1, 2, 3, 4, 5, 6, 7], &[0, 1, 2, 3, 4, 5]);
    let first = serde_json::to_string(data(&fx.ada(input()).await)).unwrap();
    let second = serde_json::to_string(data(&fx.ada(input()).await)).unwrap();
    assert_eq!(first, second);
    fx.reopen();
    let reopened = serde_json::to_string(data(&fx.ada(input()).await)).unwrap();
    assert_eq!(first, reopened);
    // With no task too.
    let a = serde_json::to_string(data(&fx.ada(json!({})).await)).unwrap();
    let b = serde_json::to_string(data(&fx.ada(json!({})).await)).unwrap();
    assert_eq!(a, b);
}

#[tokio::test]
async fn equal_contents_written_in_other_orders_give_an_equal_digest() {
    let a = workspace(&[0, 1, 2, 3, 4, 5, 6, 7], &[0, 1, 2, 3, 4, 5]);
    let b = workspace(&[5, 2, 7, 0, 3, 6, 1, 4], &[3, 5, 0, 4, 1, 2]);
    for query in [
        input(),
        json!({}),
        json!({ "task": "rollback", "maxBytes": 3000 }),
    ] {
        let left = a.ada(query.clone()).await;
        let right = b.ada(query.clone()).await;
        assert_eq!(data(&left)["digest"], data(&right)["digest"], "{query}");
        assert_eq!(data(&left)["sections"], data(&right)["sections"], "{query}");
        assert_eq!(
            data(&left)["omissions"],
            data(&right)["omissions"],
            "{query}"
        );
        valid(&left);
    }
    // Something was placed and something left out, so the digest covers both.
    let full = a.ada(input()).await;
    assert!(!ids(&full, "knowledge").is_empty());
    assert!(!ids(&full, "semantic").is_empty());
    let small = a.ada(json!({ "task": "rollback", "maxBytes": 3000 })).await;
    assert!(
        !omitted(&small, "knowledge", "budget").is_empty(),
        "{small}"
    );
}

#[tokio::test]
async fn state_is_not_in_the_digest() {
    let a = workspace(&[0, 1, 2, 3, 4, 5, 6, 7], &[0, 1, 2, 3, 4, 5]);
    let mut b = workspace(&[0, 1, 2, 3, 4, 5, 6, 7], &[0, 1, 2, 3, 4, 5]);
    // A document written and deleted again moves the index's applied revision and nothing else.
    {
        let dir = b.space_dir("main");
        let store = SqliteStore::open(&dir, "main", StoreOptions::default()).unwrap();
        let index = TantivyIndex::open(&dir, "main", StoreOptions::default()).unwrap();
        let (write, _) = doc("main", "handbook/gone", "Gone", "temporary");
        let envelope = write.envelope.clone();
        store.put_document(write, Expect::Any).unwrap();
        store
            .delete_document("handbook/gone", Expect::Any, envelope)
            .unwrap();
        let mut writer = index.writer().unwrap();
        writer
            .replace(&"handbook/gone".to_owned(), Vec::new())
            .unwrap();
        writer.commit(store.head().unwrap()).unwrap();
    }
    b.reopen();
    let left = a.ada(input()).await;
    let right = b.ada(input()).await;
    assert_ne!(data(&left)["state"], data(&right)["state"]);
    assert_eq!(data(&left)["digest"], data(&right)["digest"]);
    assert!(data(&left)["state"]["indexApplied"].as_u64().unwrap() > 0);
    assert!(data(&left)["state"]["memoryHead"].as_u64().unwrap() > 0);
    // And the digest moves when what was placed does.
    let other = a.ada(json!({ "task": "rollback" })).await;
    assert_ne!(data(&left)["digest"], data(&other)["digest"]);
}

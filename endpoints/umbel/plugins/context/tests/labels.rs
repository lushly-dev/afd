//! Labels (section 9.5): every item's provenance and verification, omissions that name and count
//! only what the caller can read, and the AFD `sources`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::*;
use umbel_store::{AccessSet, Authority, Flag, MemoryClass};

fn items(result: &Value) -> Vec<Value> {
    data(result)["sections"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|s| s["items"].as_array().unwrap().clone())
        .collect()
}

fn bob_only(write: &mut umbel_store::DocumentWrite) {
    write.access = AccessSet::new(["principal:human:bob"]).unwrap();
    write.envelope.access = write.access.tokens().to_vec();
}

#[tokio::test]
async fn every_item_carries_provenance_and_a_verification_label() {
    let mut fx = Fx::new();
    fx.index(
        "main",
        vec![doc(
            "main",
            "handbook/deploy",
            "Deploying",
            "labelq the canary",
        )],
    );
    let note = entry(
        1,
        "main",
        "human:ada",
        MemoryClass::Semantic,
        Authority::Agent,
        "Staging uses the canary",
        "labelq staging rollbacks use the canary flag",
    );
    fx.remember("main", vec![note]);
    // Not in the default push until a person confirms it.
    let before = fx.ada(json!({ "task": "labelq" })).await;
    assert!(ids(&before, "semantic").is_empty());
    assert_eq!(count(&before, "semantic", "authority"), 1);
    fx.confirm(
        "main",
        &mem(1),
        "Staging uses the canary",
        "labelq staging rollbacks use the canary flag",
        "human:ada",
    );
    let result = fx.ada(json!({ "task": "labelq" })).await;
    assert_eq!(count(&result, "semantic", "authority"), 0);
    let all = items(&result);
    assert_eq!(all.len(), 2, "{result}");
    let document = &all[0];
    assert_eq!(document["kind"], "document");
    assert_eq!(document["verification"], "human");
    assert_eq!(document["trust"], "content");
    assert_eq!(document["status"], "stable");
    assert_eq!(document["stale"], false);
    assert_eq!(
        document["provenance"],
        json!({
            "origin": "document-derived",
            "authority": null,
            "generated": { "by": "human:ada", "at": "2026-11-01T09:00:00Z" },
        })
    );
    assert!(
        document["locator"]
            .as_str()
            .unwrap()
            .starts_with("umbel:main/handbook/deploy#L1-L1@")
    );
    let memory = &all[1];
    assert_eq!(memory["kind"], "memory");
    assert_eq!(memory["verification"], "unverified");
    assert_eq!(memory["trust"], "content");
    assert_eq!(memory["flags"], json!([]));
    assert_eq!(memory["class"], "semantic");
    assert_eq!(memory["title"], "Staging uses the canary");
    let provenance = &memory["provenance"];
    assert_eq!(provenance["authority"], "person");
    assert_eq!(provenance["origin"], "agent-inferred");
    assert_eq!(provenance["principal"], "human:ada");
    assert_eq!(provenance["confirmation"]["by"], "human:ada");
    assert_eq!(provenance["confirmation"]["priorAuthority"], "agent");
    for key in [
        "recordedAt",
        "validFrom",
        "validUntil",
        "expiresAt",
        "confidence",
        "constraints",
    ] {
        assert!(provenance.get(key).is_some(), "{key}");
    }
    assert_eq!(provenance["validFrom"], at_text());
    // The result's own labels.
    assert_eq!(result["metadata"]["dev.umbel/trust"], "content");
    assert!(warning(&result, "UNVERIFIED_CONTENT").is_some());
    assert!(
        result["reasoning"]
            .as_str()
            .unwrap()
            .contains("1 knowledge and 1 memory")
    );
    assert!(result.get("confidence").is_none_or(Value::is_null));
    valid(&result);
    // Knowledge alone holds no memory, so it is not UNVERIFIED_CONTENT.
    let knowledge = fx
        .ada(json!({ "task": "labelq", "sections": ["knowledge"] }))
        .await;
    assert!(warning(&knowledge, "UNVERIFIED_CONTENT").is_none());
}

#[tokio::test]
async fn omissions_name_and_count_only_what_the_caller_can_read() {
    let mut fx = Fx::new();
    let bob = |n, authority| {
        entry(
            n,
            "main",
            "human:bob",
            MemoryClass::Semantic,
            authority,
            &format!("Bob {n}"),
            "leakq bob",
        )
    };
    fx.remember(
        "main",
        vec![
            bob(1, Authority::Person),
            bob(2, Authority::Agent),
            flagged(bob(3, Authority::Person)),
            entry(
                4,
                "main",
                "human:ada",
                MemoryClass::Semantic,
                Authority::Agent,
                "Ada",
                "leakq ada",
            ),
        ],
    );
    fx.index(
        "main",
        vec![
            with(doc("main", "handbook/bob", "Bob", "leakq bob"), bob_only),
            with(
                with(
                    doc("main", "handbook/bob-flagged", "BobF", "leakq bob"),
                    bob_only,
                ),
                scan_flag(Flag::HiddenText),
            ),
            doc("main", "handbook/open", "Open", "leakq open"),
        ],
    );
    for input in [json!({ "task": "leakq" }), json!({})] {
        let result = fx.ada(input).await;
        let text = serde_json::to_string(&result).unwrap();
        for hidden in ["handbook/bob", &mem(1), &mem(2), &mem(3), "Bob "] {
            assert!(!text.contains(hidden), "{hidden} in {text}");
        }
        // Ada's own agent note is readable and not admitted: counted, never named.
        assert_eq!(count(&result, "semantic", "authority"), 1);
        assert_eq!(count(&result, "semantic", "flagged"), 0);
        assert_eq!(count(&result, "knowledge", "flagged"), 0);
    }
    // Bob reads his own: the person record pushed, the agent note and the flagged one counted.
    let as_bob = fx.bundle(human("bob"), json!({ "task": "leakq" })).await;
    assert_eq!(ids(&as_bob, "semantic"), [format!("main:{}", mem(1))]);
    assert_eq!(count(&as_bob, "semantic", "authority"), 1);
    assert_eq!(count(&as_bob, "semantic", "flagged"), 1);
    assert_eq!(count(&as_bob, "knowledge", "flagged"), 1);
    assert_eq!(
        ids(&as_bob, "knowledge"),
        ["main:handbook/bob", "main:handbook/open"]
    );
    let as_ada = fx.ada(json!({ "task": "leakq" })).await;
    assert_eq!(ids(&as_ada, "knowledge"), ["main:handbook/open"]);
}

#[tokio::test]
async fn budget_omissions_name_only_readable_items() {
    let mut fx = Fx::new();
    let docs = (0..30)
        .map(|n| {
            let id = format!("handbook/d{n:02}");
            if n % 2 == 0 {
                with(doc("main", &id, "D", "omitq"), bob_only)
            } else {
                doc("main", &id, "D", "omitq")
            }
        })
        .collect();
    fx.index("main", docs);
    let result = fx
        .ada(json!({ "task": "omitq", "sections": ["knowledge"], "maxBytes": 2500 }))
        .await;
    let named: Vec<&str> = omitted(&result, "knowledge", "budget")
        .iter()
        .map(|o| o["id"].as_str().unwrap())
        .collect();
    assert!(!named.is_empty(), "{result}");
    let placed = ids(&result, "knowledge");
    for id in named
        .iter()
        .copied()
        .chain(placed.iter().map(String::as_str))
    {
        let n: u32 = id.trim_start_matches("main:handbook/d").parse().unwrap();
        assert_eq!(n % 2, 1, "{id} is bob's");
    }
    assert_eq!(named.len() + placed.len(), 15);
}

#[tokio::test]
async fn sources_list_each_placed_item() {
    let mut fx = Fx::new();
    fx.index(
        "main",
        vec![doc(
            "main",
            "handbook/s",
            "Source doc",
            "srcq one\n\nsrcq two",
        )],
    );
    fx.remember(
        "main",
        vec![entry(
            1,
            "main",
            "human:ada",
            MemoryClass::Procedural,
            Authority::Person,
            "How",
            "srcq steps",
        )],
    );
    let result = fx.ada(json!({ "task": "srcq" })).await;
    let sources = result["sources"].as_array().unwrap();
    assert_eq!(sources.len(), 2, "{result}");
    assert_eq!(sources[0]["type"], "document");
    assert_eq!(sources[0]["id"], "main:handbook/s");
    assert_eq!(sources[0]["title"], "Source doc");
    assert!(sources[0]["location"].as_str().unwrap().starts_with('L'));
    assert_eq!(sources[1]["type"], "memory");
    assert_eq!(sources[1]["id"], format!("main:{}", mem(1)));
    assert_eq!(sources[1]["title"], "How");
    // An empty bundle is a success with no sources.
    let empty = fx.ada(json!({ "task": "nothingmatches" })).await;
    assert!(empty["sources"].as_array().is_none_or(Vec::is_empty));
    assert!(data(&empty)["sections"].as_array().unwrap().is_empty());
}

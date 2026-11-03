//! Absent lanes (sections 9.1 and 9.4): each optional grant missing, a `memory` grant and no
//! file, a missing or foreign key file (knowledge kept, success, the warning), empty stores, and
//! memory-only and index-only deployments.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::*;
use umbel_store::{Authority, MemoryClass};

const MEMORY_SECTIONS: [&str; 3] = ["semantic", "procedural", "episodic"];

fn all_sections() -> Value {
    json!({ "task": "laneq", "sections": ["knowledge", "semantic", "procedural", "episodic"] })
}

fn seeded(config: &str) -> Fx {
    let mut fx = Fx::with(config);
    fx.index("main", vec![doc("main", "handbook/a", "A", "laneq")]);
    fx.remember(
        "main",
        vec![entry(
            1,
            "main",
            "human:ada",
            MemoryClass::Semantic,
            Authority::Person,
            "F",
            "laneq",
        )],
    );
    fx
}

fn denied(grants: &str) -> String {
    config(&format!("deny = [{grants}]"))
}

fn unavailable(result: &Value, section: &str) -> bool {
    omitted(result, section, "lane-unavailable").len() == 1
}

#[tokio::test]
async fn each_optional_grant_missing_leaves_its_lane_unavailable() {
    for grants in ["\"index\"", "\"documents\""] {
        let fx = seeded(&denied(grants));
        let result = fx.ada(all_sections()).await;
        assert!(unavailable(&result, "knowledge"), "{grants}: {result}");
        assert_eq!(ids(&result, "semantic"), [format!("main:{}", mem(1))]);
        assert_eq!(data(&result)["state"]["indexApplied"], Value::Null);
        valid(&result);
    }
    let fx = seeded(&denied("\"memory\""));
    let result = fx.ada(all_sections()).await;
    for section in MEMORY_SECTIONS {
        assert!(unavailable(&result, section), "{section}: {result}");
    }
    assert_eq!(ids(&result, "knowledge"), ["main:handbook/a"]);
    assert_eq!(data(&result)["state"]["memoryHead"], Value::Null);
    assert!(warning(&result, "MEMORY_KEYS_MISSING").is_none());
    valid(&result);
}

#[tokio::test]
async fn a_memory_grant_and_no_file_is_unavailable_and_creates_nothing() {
    let fx = Fx::new();
    let result = fx
        .ada(json!({ "sections": ["semantic", "procedural", "episodic"], "render": "text" }))
        .await;
    for section in MEMORY_SECTIONS {
        assert!(unavailable(&result, section), "{section}: {result}");
    }
    assert!(warning(&result, "MEMORY_KEYS_MISSING").is_none());
    assert_eq!(data(&result)["text"], Value::Null);
    let store = fx.space_dir("main").join("store");
    assert!(!store.join("memory.sqlite3").exists());
    assert!(!store.join("memory.keys").exists());
    valid(&result);
}

#[tokio::test]
async fn a_missing_key_file_keeps_knowledge_and_says_why() {
    let mut fx = seeded(&config(""));
    std::fs::remove_file(fx.space_dir("main").join("store/memory.keys")).unwrap();
    fx.reopen();
    let result = fx.ada(all_sections()).await;
    assert_eq!(result["success"], true);
    assert_eq!(ids(&result, "knowledge"), ["main:handbook/a"]);
    for section in MEMORY_SECTIONS {
        assert!(unavailable(&result, section), "{section}: {result}");
        assert_eq!(omitted(&result, section, "authority").len(), 0);
    }
    assert!(warning(&result, "MEMORY_KEYS_MISSING").is_some());
    // The warning is the result's, never a silent empty memory.
    assert!(!fx.space_dir("main").join("store/memory.keys").exists());
    valid(&result);
}

#[tokio::test]
async fn a_foreign_key_file_keeps_knowledge_and_says_why() {
    let mut fx = seeded(&config(""));
    fx.remember(
        "beta",
        vec![entry(
            2,
            "beta",
            "human:ada",
            MemoryClass::Semantic,
            Authority::Person,
            "B",
            "b",
        )],
    );
    let beta = std::fs::read(fx.space_dir("beta").join("store/memory.keys")).unwrap();
    std::fs::write(fx.space_dir("main").join("store/memory.keys"), beta).unwrap();
    fx.reopen();
    let result = fx.ada(all_sections()).await;
    assert_eq!(ids(&result, "knowledge"), ["main:handbook/a"]);
    for section in MEMORY_SECTIONS {
        assert!(unavailable(&result, section), "{section}");
    }
    assert!(
        warning(&result, "MEMORY_KEYS_MISMATCH").is_some(),
        "{result}"
    );
}

#[tokio::test]
async fn empty_stores_give_an_empty_bundle_that_succeeds() {
    let mut fx = Fx::new();
    // An index that holds nothing yet.
    fx.index("main", Vec::new());
    let result = fx.ada(all_sections()).await;
    assert_eq!(result["success"], true);
    assert_eq!(omitted(&result, "knowledge", "index-empty").len(), 1);
    assert!(data(&result)["sections"].as_array().unwrap().is_empty());
    assert!(warning(&result, "BUNDLE_LIMITED").is_none());
    valid(&result);
}

#[tokio::test]
async fn memory_only_and_index_only_deployments_work() {
    let memory_only = seeded(&denied("\"index\", \"documents\""));
    let result = memory_only.ada(all_sections()).await;
    assert!(unavailable(&result, "knowledge"));
    assert_eq!(section_names(&result), ["semantic"]);
    let index_only = seeded(&denied("\"memory\""));
    let result = index_only.ada(json!({ "task": "laneq" })).await;
    assert_eq!(section_names(&result), ["knowledge"]);
    assert!(unavailable(&result, "semantic") && unavailable(&result, "procedural"));
    // A stale index still serves, and says so.
    let mut stale = seeded(&config(""));
    let (later, _) = doc("main", "handbook/b", "B", "laneq later");
    stale.put_only("main", vec![later]);
    let result = stale.ada(json!({ "task": "laneq" })).await;
    let warned = warning(&result, "INDEX_STALE").unwrap();
    assert_eq!(warned["details"]["space"], "main");
    assert_eq!(ids(&result, "knowledge"), ["main:handbook/a"]);
}

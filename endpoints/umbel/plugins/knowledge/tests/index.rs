//! `knowledge-index` (specification section 8.7): the procedure, bounded runs, rebuilds, and the
//! output filtered to totals plus readable ids.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::json;
use support::*;

const SECRET: &str = "---\naccess: [group:platform]\ntitle: The acquisition plan\n---\n# Secret\n\nThe quarterly zebra plan.\n";

fn write_docs(fx: &Fx, count: usize) {
    for n in 0..count {
        fx.handbook(
            &format!("doc-{n:03}.md"),
            &format!("# Doc {n}\n\nalpha number{n}\n"),
        );
    }
}

#[tokio::test]
async fn an_index_run_reports_totals_and_is_idempotent() {
    let fx = Fx::new();
    write_docs(&fx, 3);
    let sync = fx.cli("sources-sync", json!({})).await;
    assert_eq!(sync["success"], true, "{sync}");
    let first = fx.cli("knowledge-index", json!({})).await;
    let report = data(&first);
    assert_eq!(report["documents"], json!({ "indexed": 3, "removed": 0 }));
    assert!(report["chunks"].as_u64().unwrap() >= 3);
    assert_eq!(report["remaining"], false);
    assert_eq!(report["fromRev"], 0);
    assert!(report["toRev"].as_u64().unwrap() >= 3);
    assert_eq!(report["applied"], report["toRev"]);
    let again = fx.cli("knowledge-index", json!({})).await;
    assert_eq!(
        data(&again)["documents"],
        json!({ "indexed": 0, "removed": 0 })
    );
    assert_eq!(data(&again)["fromRev"], report["applied"]);
}

#[tokio::test]
async fn a_changed_and_a_deleted_document_are_reindexed_and_removed() {
    let fx = Fx::new();
    fx.handbook("keep.md", "# Keep\n\nzulu one\n");
    fx.handbook("change.md", "# Change\n\nzulu two\n");
    fx.handbook("gone.md", "# Gone\n\nzulu three\n");
    fx.refresh("main").await;
    let before = fx.search(human("local"), json!({ "query": "zulu" })).await;
    assert_eq!(hit_ids(&before).len(), 3);

    fx.handbook("change.md", "# Change\n\nyankee two\n");
    fx.remove("spaces/main/handbook/gone.md");
    fx.refresh("main").await;

    let zulu = fx.search(human("local"), json!({ "query": "zulu" })).await;
    assert_eq!(hit_ids(&zulu), ["handbook/keep"], "{zulu}");
    let yankee = fx
        .search(human("local"), json!({ "query": "yankee" }))
        .await;
    assert_eq!(hit_ids(&yankee), ["handbook/change"]);
}

#[tokio::test]
async fn limit_bounds_a_run_and_the_next_run_continues() {
    let fx = Fx::new();
    write_docs(&fx, 5);
    let sync = fx.cli("sources-sync", json!({})).await;
    assert_eq!(sync["success"], true);
    let mut indexed = 0;
    let mut runs = 0;
    loop {
        let run = fx.cli("knowledge-index", json!({ "limit": 2 })).await;
        let report = data(&run);
        indexed += report["documents"]["indexed"].as_u64().unwrap();
        runs += 1;
        assert!(runs < 20, "does not finish: {run}");
        if report["remaining"] == false {
            break;
        }
        assert!(warning(&run, "INDEX_REMAINING").is_some(), "{run}");
    }
    assert!(runs >= 2, "a limit of two changes needs several runs");
    // Every document is found, each once.
    assert_eq!(indexed, 5);
    let all = fx
        .search(human("local"), json!({ "query": "alpha", "limit": 50 }))
        .await;
    assert_eq!(hit_ids(&all).len(), 5, "{all}");
}

#[tokio::test]
async fn rebuild_clears_and_derives_again_whatever_the_limit() {
    let fx = Fx::new();
    write_docs(&fx, 4);
    fx.refresh("main").await;
    let rebuilt = fx
        .cli("knowledge-index", json!({ "rebuild": true, "limit": 1 }))
        .await;
    let report = data(&rebuilt);
    assert_eq!(report["rebuild"], true);
    assert_eq!(report["documents"]["indexed"], 4);
    assert_eq!(report["remaining"], false, "a rebuild is one run");
    assert_eq!(report["fromRev"], 0);
    let found = fx
        .search(human("local"), json!({ "query": "alpha", "limit": 50 }))
        .await;
    assert_eq!(hit_ids(&found).len(), 4);
}

#[tokio::test]
async fn an_outsider_running_the_index_sees_totals_and_only_readable_ids() {
    let fx = Fx::new();
    fx.handbook("public.md", "# Public\n\nFor everyone.\n");
    fx.handbook("secret-plan.md", SECRET);
    let sync = fx.as_actor(outsider(), "sources-sync", json!({})).await;
    assert_eq!(sync["success"], true, "{sync}");
    let run = fx.as_actor(outsider(), "knowledge-index", json!({})).await;
    let report = data(&run);
    assert_eq!(
        report["documents"]["indexed"], 2,
        "totals count every document"
    );
    let ids: Vec<&str> = report["ids"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, ["handbook/public"]);
    never_mentions(&run, &["secret-plan", "acquisition", "zebra"]);

    // A member sees both ids.
    fx.handbook("secret-plan.md", &format!("{SECRET}\nMore.\n"));
    fx.cli("sources-sync", json!({})).await;
    let run = fx.as_actor(member(), "knowledge-index", json!({})).await;
    let ids: Vec<String> = data(&run)["ids"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["id"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(ids, ["handbook/secret-plan"]);
}

#[tokio::test]
async fn a_removal_is_named_only_to_a_reader_of_the_deleted_version() {
    let fx = Fx::new();
    fx.handbook("secret-plan.md", SECRET);
    fx.handbook("public.md", "# Public\n\nFor everyone.\n");
    fx.refresh("main").await;
    fx.remove("spaces/main/handbook/secret-plan.md");
    fx.remove("spaces/main/handbook/public.md");
    let sync = fx.cli("sources-sync", json!({})).await;
    assert_eq!(sync["success"], true);
    let run = fx.as_actor(outsider(), "knowledge-index", json!({})).await;
    let report = data(&run);
    assert_eq!(report["documents"]["removed"], 2);
    let ids: Vec<&str> = report["ids"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, ["handbook/public"]);
    never_mentions(&run, &["secret-plan"]);
}

#[tokio::test]
async fn the_index_is_journaled_as_a_mutation_with_a_record() {
    let fx = Fx::new();
    write_docs(&fx, 1);
    fx.refresh("main").await;
    let events = fx.cli("event-list", json!({})).await;
    let list = data(&events)["events"].as_array().unwrap().clone();
    let index = list
        .iter()
        .find(|event| event["command"] == "knowledge-index")
        .unwrap_or_else(|| panic!("no knowledge-index event in {events}"));
    assert_eq!(index["version"], 1, "{index}");
    assert_eq!(index["record"]["kind"], "index");
    assert_eq!(index["record"]["id"], "main");
}

#[tokio::test]
async fn code_documents_are_indexed_as_plain_text() {
    let fx = Fx::new();
    fx.write(
        "spaces/main/code/src/lib.rs",
        b"pub fn rollback_canary() {\n    // revert the canary\n}\n",
    );
    fx.refresh("main").await;
    let found = fx
        .search(
            human("local"),
            json!({ "query": "rollback_canary", "filters": { "type": "code" } }),
        )
        .await;
    assert_eq!(hit_ids(&found), ["code/src/lib.rs"], "{found}");
    let described = fx
        .as_actor(
            human("local"),
            "knowledge-describe",
            json!({ "doc": "code/src/lib.rs" }),
        )
        .await;
    assert_eq!(data(&described)["codeIndexing"], "plain-text");
}

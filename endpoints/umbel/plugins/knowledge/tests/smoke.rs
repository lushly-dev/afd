//! A first end to end run: sync, index, search, open.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::json;
use support::*;

#[tokio::test]
async fn sync_index_search_open() {
    let fx = Fx::new();
    fx.handbook(
        "deploy/rollback.md",
        "---\ntitle: Rolling back\ntype: runbook\ntags: [ops]\n---\n# Rolling back\n\nRevert the canary before the fleet.\n",
    );
    fx.refresh("main").await;
    let found = fx
        .search(human("local"), json!({ "query": "canary" }))
        .await;
    assert_eq!(hit_ids(&found), ["handbook/deploy/rollback"], "{found}");
    let hit = &data(&found)["hits"][0];
    assert_eq!(hit["title"], "Rolling back");
    let locator = hit["locator"].as_str().unwrap().to_owned();
    let opened = fx
        .as_actor(
            human("local"),
            "knowledge-open",
            json!({ "locator": locator }),
        )
        .await;
    assert!(
        data(&opened)["text"].as_str().unwrap().contains("canary"),
        "{opened}"
    );
}

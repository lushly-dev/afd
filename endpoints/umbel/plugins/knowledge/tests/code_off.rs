//! Without the `code` feature (specification section 7.4): code collections are indexed as plain
//! text, and `knowledge-describe` says so.
#![cfg(not(feature = "code"))]
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::json;
use support::*;
use umbel_plugin_knowledge::code::{self, Budget, Mode, Reason};

#[test]
fn a_known_language_is_plain_text_because_the_feature_is_off() {
    let analysis = code::analyse("src/lib.rs", "pub fn a() {}\n", &Budget::default());
    assert_eq!(analysis.mode, Mode::PlainText(Reason::FeatureDisabled));
    assert!(!Reason::FeatureDisabled.degraded());
    assert!(analysis.symbols.is_empty());
    assert_eq!(analysis.language, Some("rust"));
}

#[tokio::test]
async fn code_is_searchable_as_text_and_described_as_plain_text() {
    let fx = Fx::new();
    fx.write("spaces/main/code/lib.rs", b"pub fn pluck_the_zebra() {}\n");
    fx.handbook("g.md", "# G\n\nSee `pluck_the_zebra`.\n");
    fx.refresh("main").await;
    let found = fx
        .search(human("local"), json!({ "query": "pluck_the_zebra" }))
        .await;
    assert!(hit_ids(&found).contains(&"code/lib.rs".to_owned()));
    let described = fx
        .as_actor(
            human("local"),
            "knowledge-describe",
            json!({ "doc": "code/lib.rs" }),
        )
        .await;
    assert_eq!(data(&described)["codeIndexing"], "plain-text");
    assert_eq!(data(&described)["code"]["reason"], "feature-disabled");
    // No symbol nodes, so no mention is served.
    let node = fx
        .as_actor(
            human("local"),
            "knowledge-neighbors",
            json!({ "node": "symbol:rust:pluck_the_zebra" }),
        )
        .await;
    assert_eq!(code(&node), "NODE_NOT_FOUND");
}

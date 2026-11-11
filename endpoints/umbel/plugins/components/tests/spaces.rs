//! Spaces do not mix, the proposal's criterion 7: with no override only the example is served, and a
//! space's override replaces it for that space alone, for every command.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::*;

#[tokio::test]
async fn with_no_override_the_default_pack_is_served() {
    let host = default_host();
    let result: Value =
        serde_json::to_value(host.call("components-list", json!({})).await).unwrap();
    assert_eq!(tags(&result).len(), 4);
    assert_eq!(data(&result)["libraries"][0]["library"], "example");
}

#[tokio::test]
async fn an_override_replaces_the_default_in_its_space_alone() {
    let mut pack = Pack::default();
    pack.add_synthetic("own", 2);
    let fx = pack.host();
    let own = fx.list(json!({ "space": "main" })).await;
    assert_eq!(data(&own)["libraries"][0]["library"], "own");
    assert_eq!(tags(&own), ["own-item-0000", "own-item-0001"]);
    let other = fx.list(json!({ "space": "beta" })).await;
    assert_eq!(data(&other)["libraries"][0]["library"], "example");
    assert_eq!(tags(&other).len(), 4);
}

#[tokio::test]
async fn a_brief_with_no_override_serves_only_the_example() {
    let host = default_host();
    let result = brief_on(
        &host,
        json!({ "tags": ["example-select", "own-item-0000"] }),
    )
    .await;
    assert_eq!(tags(&result), ["example-select"]);
    assert_eq!(data(&result)["libraries"][0]["library"], "example");
    assert_eq!(data(&result)["libraries"].as_array().unwrap().len(), 1);
    assert_eq!(data(&result)["unknown"][0]["tag"], "own-item-0000");
}

#[tokio::test]
async fn a_brief_in_an_overridden_space_serves_its_override_alone() {
    let mut pack = Pack::default();
    pack.add_synthetic("own", 2);
    let fx = pack.host();
    let tags_asked = json!(["example-select", "own-item-0000"]);
    let own = fx
        .brief(json!({ "space": "main", "tags": tags_asked }))
        .await;
    assert_eq!(tags(&own), ["own-item-0000"]);
    assert_eq!(data(&own)["unknown"][0]["tag"], "example-select");
    assert_eq!(data(&own)["libraries"][0]["library"], "own");
    let other = fx
        .brief(json!({ "space": "beta", "tags": tags_asked }))
        .await;
    assert_eq!(tags(&other), ["example-select"]);
    assert_eq!(data(&other)["unknown"][0]["tag"], "own-item-0000");
}

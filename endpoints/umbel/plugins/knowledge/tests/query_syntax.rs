//! Every form of specification section 8.1, the limits, and the field that cannot be named.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::*;

async fn corpus() -> Fx {
    let fx = Fx::new();
    fx.handbook(
        "a.md",
        "---\ntitle: Rollback runbook\ntype: runbook\ntags: [ops]\ngenerated: { by: \"human:ada\", at: \"2026-03-01T00:00:00+00:00\" }\n---\n# Rollback\n\nrevert the canary before the fleet, then rollback.\n",
    );
    fx.handbook(
        "b.md",
        "---\ntitle: Blue green deployment\ntype: guide\ntags: [ops, deploy]\ngenerated: { by: \"human:ada\", at: \"2026-03-01T00:00:00+00:00\" }\n---\n# Blue green\n\nblue green switch traffic; feature flag rollout follows.\n",
    );
    fx.handbook(
        "c.md",
        "---\ntitle: Feature flags\ntype: guide\ntags: [product]\n---\n# Flags\n\na feature flag controls exposure; legacy flags removed.\n",
    );
    fx.handbook(
        "d.md",
        "---\ntitle: Legacy migration\ntype: note\n---\n# Legacy\n\nlegacy system migration plan with canary.\n",
    );
    fx.refresh("main").await;
    fx
}

async fn ids(fx: &Fx, query: &str) -> Vec<String> {
    let mut found = hit_ids(&fx.search(human("local"), json!({ "query": query })).await);
    found.sort();
    found
}

async fn refused(fx: &Fx, query: &str) -> Value {
    let result = fx.search(human("local"), json!({ "query": query })).await;
    assert_eq!(code(&result), "QUERY_INVALID", "{query}: {result}");
    assert!(
        result["error"]["suggestion"]
            .as_str()
            .unwrap()
            .contains("title"),
        "the suggestion names the fields: {result}"
    );
    result
}

#[tokio::test]
async fn terms_are_or_by_default() {
    let fx = corpus().await;
    assert_eq!(ids(&fx, "canary").await, ["handbook/a", "handbook/d"]);
    assert_eq!(
        ids(&fx, "canary flag").await,
        ["handbook/a", "handbook/b", "handbook/c", "handbook/d"]
    );
    // The best match is first.
    let result = fx
        .search(human("local"), json!({ "query": "rollback canary" }))
        .await;
    assert_eq!(hit_ids(&result)[0], "handbook/a");
}

#[tokio::test]
async fn required_excluded_and_boolean_forms() {
    let fx = corpus().await;
    assert_eq!(ids(&fx, "+canary -legacy").await, ["handbook/a"]);
    assert_eq!(
        ids(&fx, "canary AND (rollback OR migration) NOT legacy").await,
        ["handbook/a"]
    );
    assert_eq!(ids(&fx, "canary AND legacy").await, ["handbook/d"]);
}

#[tokio::test]
async fn phrases_and_slop() {
    let fx = corpus().await;
    assert_eq!(
        ids(&fx, "\"feature flag\"").await,
        ["handbook/b", "handbook/c"]
    );
    assert_eq!(ids(&fx, "\"flag rollout\"").await, ["handbook/b"]);
    assert!(ids(&fx, "\"feature rollout\"").await.is_empty());
    assert_eq!(ids(&fx, "\"feature rollout\"~1").await, ["handbook/b"]);
}

#[tokio::test]
async fn fields_name_what_they_search() {
    let fx = corpus().await;
    assert_eq!(ids(&fx, "title:rollback").await, ["handbook/a"]);
    assert_eq!(ids(&fx, "tags:deploy").await, ["handbook/b"]);
    assert_eq!(ids(&fx, "type:guide").await, ["handbook/b", "handbook/c"]);
    assert_eq!(
        ids(&fx, "type:guide AND body:flag").await,
        ["handbook/b", "handbook/c"]
    );
    assert_eq!(
        ids(&fx, "collection:handbook AND title:legacy").await,
        ["handbook/d"]
    );
    assert_eq!(ids(&fx, "headings:blue").await, ["handbook/b"]);
}

#[tokio::test]
async fn boost_changes_the_order() {
    let fx = corpus().await;
    let plain = fx
        .search(human("local"), json!({ "query": "canary flag" }))
        .await;
    let boosted = fx
        .search(human("local"), json!({ "query": "canary^20 flag" }))
        .await;
    let first = |result: &Value| hit_ids(result)[0].clone();
    assert!(
        ["handbook/a", "handbook/d"].contains(&first(&boosted).as_str()),
        "{boosted}"
    );
    // Both rank the same documents; the boost only reorders.
    let mut a = hit_ids(&plain);
    let mut b = hit_ids(&boosted);
    a.sort();
    b.sort();
    assert_eq!(a, b);
}

#[tokio::test]
async fn ranges_on_dates() {
    let fx = corpus().await;
    assert_eq!(
        ids(&fx, "updated:[2026-02-01T00:00:00Z TO *]").await,
        ["handbook/a", "handbook/b"]
    );
    assert_eq!(
        ids(&fx, "updated:[* TO 2026-02-01T00:00:00Z]").await,
        ["handbook/c", "handbook/d"]
    );
}

#[tokio::test]
async fn a_trailing_star_is_a_bounded_prefix() {
    let fx = corpus().await;
    // `rollout` and `rollback` share the prefix.
    assert_eq!(ids(&fx, "roll*").await, ["handbook/a", "handbook/b"]);
    assert_eq!(ids(&fx, "rollb*").await, ["handbook/a"]);
    assert_eq!(ids(&fx, "title:roll*").await, ["handbook/a"]);
    assert_eq!(ids(&fx, "mig*").await, ["handbook/d"]);
    refused(&fx, "r*").await;
    refused(&fx, "*ollback").await;
    refused(&fx, "ro*ll").await;
    refused(&fx, "tags:ops*").await;
}

#[tokio::test]
async fn limits_refuse_what_would_be_expensive() {
    let fx = corpus().await;
    let many = (0..65)
        .map(|n| format!("w{n}"))
        .collect::<Vec<_>>()
        .join(" ");
    refused(&fx, &many).await;
    let fields = [
        "title",
        "aliases",
        "description",
        "headings",
        "body",
        "code",
        "tags",
        "owners",
        "type",
    ]
    .iter()
    .map(|f| format!("{f}:x"))
    .collect::<Vec<_>>()
    .join(" ");
    refused(&fx, &fields).await;
    let deep = format!("{}a{}", "(a OR ".repeat(17), ")".repeat(17));
    refused(&fx, &deep).await;
    let shallow = format!("{}a{}", "(a OR ".repeat(15), ")".repeat(15));
    let result = fx.search(human("local"), json!({ "query": shallow })).await;
    assert_eq!(result["success"], true, "{result}");
    refused(&fx, "\"a b\"~9").await;
    refused(&fx, "canary^101").await;
    refused(&fx, "canary^0").await;
    // Just inside each limit works.
    let ok_fields = [
        "title",
        "aliases",
        "description",
        "headings",
        "body",
        "code",
        "tags",
        "owners",
    ]
    .iter()
    .map(|f| format!("{f}:canary"))
    .collect::<Vec<_>>()
    .join(" ");
    let result = fx
        .search(human("local"), json!({ "query": ok_fields }))
        .await;
    assert_eq!(result["success"], true, "{result}");
    let result = fx
        .search(
            human("local"),
            json!({ "query": "\"flag rollout\"~8 canary^100" }),
        )
        .await;
    assert_eq!(result["success"], true, "{result}");
}

#[tokio::test]
async fn the_access_field_cannot_be_queried_in_any_position() {
    let fx = corpus().await;
    for query in [
        "access:space",
        "+access:space",
        "-access:group:platform",
        "canary AND access:space",
        "canary OR (access:space)",
        "access:[a TO z]",
        "access:sp*",
        "access:\"space\"",
        "title:x access:space",
    ] {
        let result = fx.search(human("local"), json!({ "query": query })).await;
        assert_eq!(code(&result), "QUERY_INVALID", "{query}: {result}");
    }
}

#[tokio::test]
async fn unknown_fields_wildcards_and_syntax_errors_are_refused_with_the_valid_fields() {
    let fx = corpus().await;
    for query in [
        "nosuch:thing",
        "*",
        "title:*",
        "/roll.*/",
        "(canary",
        "\"canary",
        "title:",
        "canary^",
    ] {
        refused(&fx, query).await;
    }
    let blank = fx.search(human("local"), json!({ "query": "   " })).await;
    assert_eq!(code(&blank), "QUERY_INVALID");
}

#[tokio::test]
async fn a_query_cannot_override_the_reader_filter() {
    let fx = Fx::new();
    fx.handbook("pub.md", "# Pub\n\nzebra public text\n");
    fx.handbook(
        "sec.md",
        "---\naccess: [group:platform]\n---\n# Sec\n\nzebra secret text\n",
    );
    fx.refresh("main").await;
    for query in [
        "zebra",
        "zebra OR access:group:platform",
        "zebra -nothing",
        "+zebra",
        "zebra^100",
        "(zebra)",
    ] {
        let result = fx.search(outsider(), json!({ "query": query })).await;
        if result["success"] == true {
            assert_eq!(hit_ids(&result), ["handbook/pub"], "{query}: {result}");
        } else {
            assert_eq!(code(&result), "QUERY_INVALID", "{query}: {result}");
        }
    }
    let member = fx.search(member(), json!({ "query": "zebra" })).await;
    assert_eq!(hit_ids(&member).len(), 2);
}

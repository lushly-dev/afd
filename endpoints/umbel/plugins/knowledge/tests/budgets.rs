//! Output budgets (specification section 8.6, decision D64): each read command fits its result to
//! the call's budget structurally and says so; one that cannot fit is refused by AFD's own check,
//! never truncated.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::*;

fn used(result: &Value) -> u64 {
    result["metadata"]["dev.afd/outputBudget"]["usedBytes"]
        .as_u64()
        .unwrap()
}

fn limit(result: &Value) -> u64 {
    result["metadata"]["dev.afd/outputBudget"]["limitBytes"]
        .as_u64()
        .unwrap()
}

async fn many_documents(count: usize) -> Fx {
    let fx = Fx::new();
    let description = "d".repeat(900);
    for n in 0..count {
        fx.handbook(
            &format!("doc-{n:03}.md"),
            &format!("---\ndescription: {description}\n---\n# Doc {n}\n\ncanary text for document number {n}\n"),
        );
    }
    fx.refresh("main").await;
    fx
}

#[tokio::test]
async fn the_default_budgets_are_the_manifests() {
    let fx = many_documents(1).await;
    for (command, input, default) in [
        ("knowledge-search", json!({ "query": "canary" }), 24_000),
        (
            "knowledge-open",
            json!({ "doc": "handbook/doc-000" }),
            32_000,
        ),
        (
            "knowledge-find",
            json!({ "doc": "handbook/doc-000", "pattern": "canary" }),
            16_000,
        ),
        (
            "knowledge-describe",
            json!({ "doc": "handbook/doc-000" }),
            16_000,
        ),
        ("knowledge-list", json!({}), 16_000),
        ("knowledge-changes", json!({}), 16_000),
    ] {
        let result = fx.as_actor(human("local"), command, input).await;
        assert_eq!(limit(&result), default, "{command}: {result}");
        assert!(used(&result) <= default);
    }
    // An ask above the maximum is clamped to it; one below is honoured.
    let big = fx
        .with_budget(
            human("local"),
            "knowledge-search",
            json!({ "query": "canary" }),
            10_000_000,
        )
        .await;
    assert_eq!(limit(&big), 96_000);
    let small = fx
        .with_budget(
            human("local"),
            "knowledge-search",
            json!({ "query": "canary" }),
            5_000,
        )
        .await;
    assert_eq!(limit(&small), 5_000);
}

#[tokio::test]
async fn search_returns_fewer_hits_and_says_so() {
    let fx = many_documents(40).await;
    let full = fx
        .with_budget(
            human("local"),
            "knowledge-search",
            json!({ "query": "canary", "limit": 40, "format": "detailed" }),
            96_000,
        )
        .await;
    assert_eq!(hit_ids(&full).len(), 40, "{}", full.to_string().len());
    assert!(warning(&full, "RESULTS_LIMITED").is_none());
    let full_size = used(&full);
    assert!(
        full_size > 24_000,
        "the fixture must be bigger than the default budget: {full_size}"
    );

    let default = fx
        .as_actor(
            human("local"),
            "knowledge-search",
            json!({ "query": "canary", "limit": 40, "format": "detailed" }),
        )
        .await;
    assert_eq!(default["success"], true, "{default}");
    let shown = hit_ids(&default).len();
    assert!(shown > 0 && shown < 40, "{shown}");
    assert!(used(&default) <= 24_000);
    let limited = warning(&default, "RESULTS_LIMITED").expect("RESULTS_LIMITED");
    assert_eq!(limited["details"]["found"], 40);
    assert_eq!(limited["details"]["shown"], shown);
    // The hits that remain are the best ones, in order.
    assert_eq!(hit_ids(&default), hit_ids(&full)[..shown]);
    // Every source belongs to a hit that is shown.
    assert_eq!(default["sources"].as_array().unwrap().len(), shown);
}

#[tokio::test]
async fn a_result_that_exactly_fits_is_not_limited_and_one_byte_less_is() {
    let fx = many_documents(12).await;
    let input = json!({ "query": "canary", "limit": 12 });
    let full = fx
        .with_budget(human("local"), "knowledge-search", input.clone(), 96_000)
        .await;
    let size = used(&full);
    let exact = fx
        .with_budget(human("local"), "knowledge-search", input.clone(), size)
        .await;
    assert_eq!(
        hit_ids(&exact).len(),
        12,
        "the measured size is exactly enough: {size}"
    );
    assert!(warning(&exact, "RESULTS_LIMITED").is_none(), "{exact}");
    let under = fx
        .with_budget(human("local"), "knowledge-search", input, size - 1)
        .await;
    assert_eq!(under["success"], true, "{under}");
    assert!(hit_ids(&under).len() < 12);
    assert!(warning(&under, "RESULTS_LIMITED").is_some());
    assert!(used(&under) < size);
}

#[tokio::test]
async fn a_result_that_cannot_fit_is_refused_not_truncated() {
    let fx = many_documents(3).await;
    for (command, input) in [
        ("knowledge-search", json!({ "query": "canary" })),
        ("knowledge-open", json!({ "doc": "handbook/doc-000" })),
        (
            "knowledge-find",
            json!({ "doc": "handbook/doc-000", "pattern": "canary" }),
        ),
        ("knowledge-describe", json!({ "doc": "handbook/doc-000" })),
        ("knowledge-list", json!({})),
        ("knowledge-changes", json!({})),
    ] {
        let result = fx.with_budget(human("local"), command, input, 1).await;
        assert_eq!(
            code(&result),
            "OUTPUT_BUDGET_EXCEEDED",
            "{command}: {result}"
        );
        assert!(
            result.get("data").is_none(),
            "{command}: nothing was returned in part"
        );
        assert!(result["error"]["suggestion"].as_str().is_some());
    }
}

#[tokio::test]
async fn a_window_is_shortened_by_whole_lines_with_a_way_to_read_on() {
    let fx = Fx::new();
    let text: String = (1..=400)
        .map(|n| format!("line {n}: {}\n", "x".repeat(60)))
        .collect();
    fx.handbook("long.md", &text);
    fx.refresh("main").await;
    let result = fx
        .with_budget(
            human("local"),
            "knowledge-open",
            json!({ "doc": "handbook/long", "lines": 400 }),
            4_000,
        )
        .await;
    let window = data(&result);
    let end = window["window"]["end"].as_u64().unwrap();
    assert!(end > 1 && end < 400, "{end}");
    assert!(used(&result) <= 4_000);
    assert_eq!(window["nextFromLine"], end + 1);
    let limited = warning(&result, "WINDOW_LIMITED").expect("WINDOW_LIMITED");
    assert_eq!(limited["details"]["requested"], 400);
    assert_eq!(limited["details"]["shown"], end);
    assert!(limited["details"]["cutLine"].is_null());
    // The text is whole lines: it ends on a line's last character.
    let shown = window["text"].as_str().unwrap();
    assert!(
        shown.ends_with(&"x".repeat(60)),
        "{}",
        &shown[shown.len().saturating_sub(40)..]
    );
    assert_eq!(shown.lines().count() as u64, end);
    // Reading on from nextFromLine continues where it stopped.
    let next = fx
        .with_budget(
            human("local"),
            "knowledge-open",
            json!({ "doc": "handbook/long", "from_line": end + 1, "lines": 400 }),
            4_000,
        )
        .await;
    assert!(
        data(&next)["text"]
            .as_str()
            .unwrap()
            .starts_with(&format!("line {}:", end + 1))
    );
}

#[tokio::test]
async fn a_single_line_longer_than_the_budget_is_cut_and_flagged() {
    let fx = Fx::new();
    fx.handbook(
        "wide.md",
        &format!("# Wide\n\n{}\n\nafter\n", "w".repeat(20_000)),
    );
    fx.refresh("main").await;
    let result = fx
        .with_budget(
            human("local"),
            "knowledge-open",
            json!({ "doc": "handbook/wide", "from_line": 3, "lines": 1 }),
            2_000,
        )
        .await;
    assert_eq!(result["success"], true, "{result}");
    assert!(used(&result) <= 2_000);
    let limited = warning(&result, "WINDOW_LIMITED").expect("WINDOW_LIMITED");
    assert_eq!(limited["details"]["cutLine"], 3);
    assert_eq!(data(&result)["nextFromLine"], 4);
}

#[tokio::test]
async fn find_list_changes_and_describe_fit_by_structure() {
    let fx = many_documents(40).await;
    let list = fx
        .with_budget(
            human("local"),
            "knowledge-list",
            json!({ "limit": 40 }),
            3_000,
        )
        .await;
    let shown = data(&list)["documents"].as_array().unwrap().len();
    assert!(shown > 0 && shown < 40, "{shown}");
    assert!(used(&list) <= 3_000);
    let cursor = data(&list)["nextAfter"].as_str().unwrap().to_owned();
    assert_eq!(cursor, format!("handbook/doc-{:03}", shown - 1));
    assert!(warning(&list, "RESULTS_LIMITED").is_some());

    let changes = fx
        .with_budget(
            human("local"),
            "knowledge-changes",
            json!({ "limit": 40 }),
            1_500,
        )
        .await;
    let shown = data(&changes)["changes"].as_array().unwrap().len();
    assert!(shown > 0 && shown < 40, "{shown}");
    assert_eq!(
        data(&changes)["nextAfterRev"],
        data(&changes)["changes"][shown - 1]["rev"]
    );

    let text: String = (0..300).map(|n| format!("canary line {n}\n")).collect();
    fx.handbook("many.md", &text);
    fx.refresh("main").await;
    let find = fx
        .with_budget(
            human("local"),
            "knowledge-find",
            json!({ "doc": "handbook/many", "pattern": "canary", "max_matches": 100 }),
            3_000,
        )
        .await;
    let shown = data(&find)["matches"].as_array().unwrap().len();
    assert!(shown > 0 && shown < 100, "{shown}");
    assert!(warning(&find, "RESULTS_LIMITED").is_some());

    // Describe drops the stored frontmatter and envelope first.
    let describe = fx
        .with_budget(
            human("local"),
            "knowledge-describe",
            json!({ "doc": "handbook/doc-000" }),
            2_300,
        )
        .await;
    assert_eq!(describe["success"], true, "{describe}");
    assert!(data(&describe).get("frontmatter").is_none(), "{describe}");
    assert!(warning(&describe, "RESULTS_LIMITED").is_some());
}

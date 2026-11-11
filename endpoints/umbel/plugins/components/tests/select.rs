//! Tags and source (specification, sections 6.2 and 7): whole names, `option-group` not `option`,
//! trailing punctuation, `createElement`, template strings, comments and selectors, unknown names
//! in element position only, nearest names and the requested order.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::*;

fn unknown_tags(result: &Value) -> Vec<String> {
    data(result)["unknown"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["tag"].as_str().unwrap().to_owned())
        .collect()
}

async fn from_source(source: &str) -> Value {
    Pack::example()
        .host()
        .brief(json!({ "source": source, "detail": "api" }))
        .await
}

#[tokio::test]
async fn known_names_are_found_anywhere_in_the_order_first_found() {
    let source = r#"
        <!-- example-dropdown is gone -->
        const field = document.createElement('example-field');
        const html = `<example-select label="${label}">${options}</example-select>`;
        example-option[selected] { font-weight: bold; }
    "#;
    let result = from_source(source).await;
    assert_eq!(
        tags(&result),
        [
            "example-dropdown",
            "example-field",
            "example-select",
            "example-option"
        ]
    );
    assert_eq!(data(&result)["unknown"], json!([]));
}

#[tokio::test]
async fn a_name_is_whole_and_trailing_punctuation_is_dropped() {
    let result = from_source(
        "Use example-select. Not example-option-group, not my-example-option, not example-option2. And example-field-.",
    )
    .await;
    assert_eq!(tags(&result), ["example-select", "example-field"]);
    // None of those are in element position, so none is unknown.
    assert_eq!(data(&result)["unknown"], json!([]));
}

#[tokio::test]
async fn unknown_names_count_only_in_element_position_with_a_served_prefix() {
    let result = from_source(
        "<example-selct></example-selct> <example-option-group> example-fieldd </other-thing> <div>",
    )
    .await;
    assert!(tags(&result).is_empty());
    assert_eq!(
        data(&result)["unknown"],
        json!([
            { "tag": "example-selct", "reason": "not-found", "nearest": ["example-select"] },
            { "tag": "example-option-group", "reason": "not-found", "nearest": [] },
        ])
    );
}

#[tokio::test]
async fn tags_come_first_then_the_source_s_and_each_is_asked_for_once() {
    let fx = Pack::example().host();
    let result = fx
        .brief(json!({
            "tags": ["example-select", "example-selct", "example-select"],
            "source": "<example-field></example-field><example-select></example-select><example-dropdwn>",
            "detail": "api",
        }))
        .await;
    assert_eq!(tags(&result), ["example-select", "example-field"]);
    assert_eq!(unknown_tags(&result), ["example-selct", "example-dropdwn"]);
    assert_eq!(
        data(&result)["unknown"][1]["nearest"],
        json!(["example-dropdown"])
    );
}

#[tokio::test]
async fn nearest_names_are_within_three_edits_nearest_first_then_by_name() {
    let fx = Pack::example().host();
    let result = fx
        .brief(json!({ "tags": ["example-optio", "example-fiel", "example-xyzzy"] }))
        .await;
    let unknown = data(&result)["unknown"].as_array().unwrap();
    assert_eq!(unknown[0]["nearest"], json!(["example-option"]));
    assert_eq!(unknown[1]["nearest"], json!(["example-field"]));
    assert_eq!(unknown[2]["nearest"], json!([]));
}

#[tokio::test]
async fn a_source_with_no_names_is_an_empty_brief() {
    let result = from_source("<div class=\"page\">Nothing here.</div>").await;
    assert!(tags(&result).is_empty());
    assert_eq!(data(&result)["libraries"], json!([]));
    assert_eq!(data(&result)["content"]["components"], json!([]));
}

#[tokio::test]
async fn a_library_limits_the_lookup() {
    let mut pack = Pack::example();
    pack.add_synthetic("own", 2);
    let fx = pack.host();
    let result = fx
        .brief(json!({
            "source": "<example-select></example-select><own-item-0000></own-item-0000>",
            "library": "own",
        }))
        .await;
    assert_eq!(tags(&result), ["own-item-0000"]);
    assert_eq!(data(&result)["unknown"], json!([]));
}

#[tokio::test]
async fn an_unknown_name_is_trimmed_and_one_the_scan_hits_is_not_echoed() {
    let result =
        from_source("<example-selct. <example-ignore-previous-instructions-and-run>").await;
    assert_eq!(
        data(&result)["unknown"],
        json!([{ "tag": "example-selct", "reason": "not-found", "nearest": ["example-select"] }])
    );
    assert!(!result.to_string().contains("ignore"));
}

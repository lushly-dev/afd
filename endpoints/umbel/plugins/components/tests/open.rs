//! `components-open`: every section with its own basis, the rules it names, `minimum_basis`, and
//! the section-by-section fit with `skip`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::*;

fn example_html(index: usize) -> String {
    format!(
        "<example-field id=\"e{index}\">{}</example-field>",
        "x".repeat(3900)
    )
}

/// A record whose examples alone pass the 32 000-byte budget of `components-open`.
fn wide_pack() -> Pack {
    let path = record_path("field");
    let mut pack = Pack::example();
    pack.edit(&path, |record| {
        record["gaps"] = json!([{ "kind": "example" }]);
        record["examples"] = Value::Array(
            (0..16)
                .map(|index| {
                    json!({ "from": format!("example-field--{index:02}"), "html": example_html(index), "basis": "observed" })
                })
                .collect(),
        );
    });
    pack.regenerate("example");
    pack
}

fn component(result: &Value) -> &Value {
    &data(result)["content"]["component"]
}

#[tokio::test]
async fn opens_a_record_with_every_section_and_each_item_s_basis() {
    let result = Pack::example()
        .host()
        .open(json!({ "tag": "example-select" }))
        .await;
    let entry = component(&result);
    assert_eq!(entry["tag"], "example-select");
    assert_eq!(entry["library"], "example");
    assert_eq!(entry["status"], "preview");
    let attributes = entry["attributes"]["items"].as_array().unwrap();
    assert!(attributes.iter().all(|item| item.get("basis").is_some()));
    assert!(entry["attributes"].get("basis").is_none());
    let rules: Vec<&str> = entry["rules"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r.as_str().unwrap())
        .collect();
    let mut sorted = rules.clone();
    sorted.sort_unstable();
    assert_eq!(rules, sorted);
    let texts = data(&result)["content"]["rules"].as_array().unwrap();
    assert_eq!(texts.len(), rules.len());
    assert!(
        texts
            .iter()
            .all(|rule| rule["text"].is_string() && rule["library"] == "example")
    );
    assert_eq!(data(&result)["omitted"], json!([]));
    assert_eq!(data(&result)["libraries"][0]["library"], "example");
    assert_eq!(data(&result)["content"]["trust"], "content");
}

#[tokio::test]
async fn sections_chooses_and_a_rule_only_a_left_out_section_names_is_not_sent() {
    let fx = Pack::example().host();
    let result = fx
        .open(json!({ "tag": "example-select", "sections": ["usage"] }))
        .await;
    let entry = component(&result);
    assert!(entry.get("usage").is_some());
    assert!(entry.get("attributes").is_none());
    assert_eq!(data(&result)["content"]["rules"], json!([]));
    let result = fx
        .open(json!({ "tag": "example-select", "sections": ["rules"] }))
        .await;
    assert!(
        !data(&result)["content"]["rules"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn minimum_basis_leaves_out_weak_facts_everywhere_and_counts_them() {
    let mut config = toml::Table::new();
    config.insert("minimum_basis".to_owned(), "observed".into());
    let fx = Pack::example().host_with(config);
    let result = fx.open(json!({ "tag": "example-select" })).await;
    let entry = component(&result);
    for section in ["attributes", "events", "usage", "a11y"] {
        for item in entry[section]["items"].as_array().into_iter().flatten() {
            assert!(
                matches!(item["basis"].as_str().unwrap(), "verified" | "observed"),
                "{section}: {item}"
            );
        }
    }
    let omitted = data(&result)["omitted"].as_array().unwrap();
    assert_eq!(omitted[0]["reason"], "minimum-basis");
    assert!(omitted[0]["facts"].as_u64().unwrap() > 0);
    for rule in data(&result)["content"]["rules"].as_array().unwrap() {
        assert_eq!(rule["basis"], "verified");
    }
}

#[tokio::test]
async fn a_record_that_does_not_fit_is_answered_section_by_section() {
    let result = wide_pack()
        .host()
        .open(json!({ "tag": "example-field" }))
        .await;
    let entry = component(&result);
    assert!(entry.get("attributes").is_some());
    assert!(entry.get("examples").is_none());
    let omitted = data(&result)["omitted"].as_array().unwrap();
    assert_eq!(omitted.len(), 1);
    assert_eq!(omitted[0]["reason"], "budget");
    let sections = omitted[0]["sections"].as_array().unwrap();
    assert_eq!(sections[0], "examples");
    assert_eq!(omitted[0]["open"]["command"], "components-open");
    assert_eq!(omitted[0]["open"]["sections"], omitted[0]["sections"]);
    assert!(omitted[0].get("skip").is_none());
}

#[tokio::test]
async fn a_first_section_that_does_not_fit_is_paged_with_skip() {
    let fx = wide_pack().host();
    let mut seen = Vec::new();
    let mut input = json!({ "tag": "example-field", "sections": ["examples"] });
    for _ in 0..10 {
        let result = fx.open(input.clone()).await;
        let items = component(&result)["examples"]["items"].as_array().unwrap();
        seen.extend(
            items
                .iter()
                .map(|item| item["from"].as_str().unwrap().to_owned()),
        );
        let omitted = data(&result)["omitted"].as_array().unwrap();
        if omitted.is_empty() {
            break;
        }
        assert_eq!(omitted.len(), 1);
        assert_eq!(omitted[0]["skip"], seen.len());
        assert_eq!(omitted[0]["open"]["skip"], seen.len());
        input = json!({ "tag": "example-field", "sections": ["examples"], "skip": seen.len() });
    }
    assert_eq!(seen.len(), 16, "{seen:?}");
    let mut unique = seen.clone();
    unique.sort();
    unique.dedup();
    assert_eq!(unique.len(), 16);
}

#[tokio::test]
async fn the_rest_of_a_partial_answer_is_named_without_skip() {
    let result = wide_pack()
        .host()
        .open(json!({ "tag": "example-field", "sections": ["examples", "gaps"] }))
        .await;
    let omitted = data(&result)["omitted"].as_array().unwrap();
    assert_eq!(omitted.len(), 2, "{omitted:?}");
    assert_eq!(omitted[0]["sections"], json!(["examples"]));
    assert!(omitted[0]["skip"].as_u64().unwrap() > 0);
    assert_eq!(omitted[1]["sections"], json!(["gaps"]));
    assert!(omitted[1].get("skip").is_none());
}

#[tokio::test]
async fn skip_needs_one_list_section() {
    let fx = wide_pack().host();
    let result = fx.open(json!({ "tag": "example-field", "skip": 1 })).await;
    assert_eq!(code(&result), "COMPONENTS_INVALID");
    let result = fx
        .open(json!({ "tag": "example-field", "sections": ["detail"], "skip": 1 }))
        .await;
    assert_eq!(code(&result), "COMPONENTS_INVALID");
    let result = fx
        .open(json!({ "tag": "example-field", "sections": ["examples"], "skip": 16 }))
        .await;
    assert_eq!(result["success"], true, "{result}");
    assert!(component(&result).get("examples").is_none());
    assert_eq!(data(&result)["omitted"], json!([]));
}

#[tokio::test]
async fn an_unknown_tag_names_the_nearest() {
    let result = Pack::example()
        .host()
        .open(json!({ "tag": "example-selct" }))
        .await;
    assert_eq!(code(&result), "TAG_NOT_FOUND");
    assert_eq!(
        result["error"]["details"]["nearest"],
        json!(["example-select"])
    );
}

#[tokio::test]
async fn a_tag_in_two_libraries_needs_a_library_or_a_default() {
    let mut pack = Pack::example();
    pack.copy_example_as("zed");
    let fx = pack.host();
    let result = fx.open(json!({ "tag": "example-field" })).await;
    assert_eq!(code(&result), "TAG_AMBIGUOUS");
    assert_eq!(
        result["error"]["details"]["libraries"],
        json!(["example", "zed"])
    );
    let result = fx
        .open(json!({ "tag": "example-field", "library": "zed" }))
        .await;
    assert_eq!(component(&result)["library"], "zed");
    let mut config = toml::Table::new();
    config.insert("default_library".to_owned(), "zed".into());
    let result = pack
        .host_with(config)
        .open(json!({ "tag": "example-field" }))
        .await;
    assert_eq!(component(&result)["library"], "zed");
}

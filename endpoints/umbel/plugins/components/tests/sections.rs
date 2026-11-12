//! `components-brief`'s answer: `detail` and `sections`, a basis once per section with ties to
//! the stronger, `minimum_basis`, `known`, rules stated once, qualified ids with two libraries,
//! `versions`, and the input the schema subset cannot check.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::*;

fn keys(entry: &Value) -> Vec<&str> {
    let mut keys: Vec<&str> = entry
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort_unstable();
    keys
}

fn rule_ids(result: &Value) -> Vec<String> {
    data(result)["content"]["rules"]
        .as_array()
        .unwrap()
        .iter()
        .map(|rule| rule["id"].as_str().unwrap().to_owned())
        .collect()
}

#[tokio::test]
async fn a_brief_states_each_section_s_basis_once_and_each_shared_rule_once() {
    let fx = Pack::example().host();
    let result = fx
        .brief(json!({ "tags": ["example-select", "example-field"] }))
        .await;
    assert_eq!(tags(&result), ["example-select", "example-field"]);
    let select = entry(&result, "example-select");
    assert_eq!(select["status"], "preview");
    assert_eq!(select["import"], "example-components/select.js");
    let attributes = &select["attributes"];
    assert_eq!(attributes["basis"], "observed");
    let items = attributes["items"].as_array().unwrap();
    let by_name = |name: &str| items.iter().find(|item| item["name"] == name).unwrap();
    assert!(by_name("disabled").get("basis").is_none());
    assert_eq!(by_name("open")["basis"], "verified");
    assert_eq!(by_name("required")["basis"], "declared");
    assert_eq!(
        select["form"],
        json!({ "basis": "observed", "items": [{ "associated": true }] })
    );
    assert_eq!(
        select["rules"],
        json!(["field.labelling", "popup.focus-return"])
    );
    assert!(
        select.get("detail").is_none(),
        "detail is served only when asked"
    );
    // field.labelling is named by both entries and stated once.
    assert_eq!(
        rule_ids(&result),
        [
            "field.invalid-message",
            "field.labelling",
            "popup.focus-return"
        ]
    );
    assert!(
        data(&result)["content"]["rules"]
            .as_array()
            .unwrap()
            .iter()
            .all(|rule| rule["text"].is_string() && rule["basis"].is_string())
    );
    assert_eq!(data(&result)["unknown"], json!([]));
    assert_eq!(data(&result)["omitted"], json!([]));
    assert_eq!(data(&result)["content"]["trust"], "content");
    assert_eq!(
        data(&result)["libraries"],
        json!([{
            "library": "example", "package": "example-components", "version": "1.0.0",
            "digest": "sha256:588a55a888a46a60a1a633779e5afc959010a14efc6012131bfdee906f9b6487",
            "prefix": "example-",
        }])
    );
}

#[tokio::test]
async fn an_attribute_s_values_carry_a_basis_only_when_it_differs_from_the_attribute_s() {
    let fx = Pack::example().host();
    let result = fx.brief(json!({ "tags": ["example-field"] })).await;
    let items = entry(&result, "example-field")["attributes"]["items"]
        .as_array()
        .unwrap()
        .clone();
    let size = items.iter().find(|item| item["name"] == "size").unwrap();
    let raw = Pack::example().json(&record_path("field"));
    let raw_size = raw["api"]["attributes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["name"] == "size")
        .unwrap()
        .clone();
    let own = raw_size["basis"].as_str().unwrap();
    for (served, stored) in size["values"]
        .as_array()
        .unwrap()
        .iter()
        .zip(raw_size["values"].as_array().unwrap())
    {
        assert_eq!(served["value"], stored["value"]);
        if stored["basis"] == own {
            assert!(served.get("basis").is_none(), "{served}");
        } else {
            assert_eq!(served["basis"], stored["basis"]);
        }
    }
}

#[tokio::test]
async fn a_tie_goes_to_the_stronger_basis() {
    let mut pack = Pack::example();
    pack.edit(&record_path("option"), |record| {
        // Two observed and two verified attributes.
        record["api"]["attributes"] = json!([
            { "name": "a-one", "type": "boolean", "basis": "observed" },
            { "name": "b-two", "type": "boolean", "basis": "verified" },
            { "name": "c-three", "type": "boolean", "basis": "observed" },
            { "name": "d-four", "type": "boolean", "basis": "verified" },
        ]);
        record["gaps"] = json!([]);
    });
    pack.regenerate("example");
    let result = pack
        .host()
        .brief(json!({ "tags": ["example-option"], "sections": ["attributes"] }))
        .await;
    let attributes = &entry(&result, "example-option")["attributes"];
    assert_eq!(attributes["basis"], "verified");
    let bases: Vec<&Value> = attributes["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| &item["basis"])
        .collect();
    assert_eq!(
        bases,
        [
            &json!("observed"),
            &Value::Null,
            &json!("observed"),
            &Value::Null
        ]
    );
}

#[tokio::test]
async fn detail_chooses_the_sections() {
    let fx = Pack::example().host();
    let api = fx
        .brief(json!({ "tags": ["example-select"], "detail": "api" }))
        .await;
    assert_eq!(
        keys(entry(&api, "example-select")),
        [
            "attributes",
            "commands",
            "events",
            "form",
            "import",
            "library",
            "rules",
            "slots",
            "status",
            "summary",
            "tag",
        ]
    );
    assert!(
        data(&api)["content"].get("rules").is_none(),
        "api sends rule ids only"
    );
    let full = fx
        .brief(json!({ "tags": ["example-field"], "detail": "full" }))
        .await;
    assert!(entry(&full, "example-field")["detail"].is_string());
    let brief = fx.brief(json!({ "tags": ["example-field"] })).await;
    assert!(entry(&brief, "example-field").get("detail").is_none());
    assert!(entry(&brief, "example-field").get("examples").is_some());
}

#[tokio::test]
async fn sections_are_exactly_those_named_in_place_of_detail() {
    let fx = Pack::example().host();
    let result = fx
        .brief(json!({
            "tags": ["example-field"],
            "detail": "api",
            "sections": ["detail", "usage", "usage"],
        }))
        .await;
    assert_eq!(
        keys(entry(&result, "example-field")),
        [
            "detail", "import", "library", "status", "summary", "tag", "usage"
        ]
    );
    // No section that names a rule was asked for, so no rule text is sent.
    assert_eq!(data(&result)["content"]["rules"], json!([]));
}

#[tokio::test]
async fn the_floor_is_kept_and_a_deprecated_component_names_its_replacement_only() {
    let fx = Pack::example().host();
    let result = fx.brief(json!({ "tags": ["example-dropdown"] })).await;
    let dropdown = entry(&result, "example-dropdown");
    assert_eq!(dropdown["status"], "deprecated");
    assert_eq!(dropdown["replacedBy"], "example-select");
    assert!(dropdown.get("summary").is_none());
    assert_eq!(tags(&result), ["example-dropdown"]);
}

#[tokio::test]
async fn minimum_basis_leaves_out_weaker_facts_and_counts_them() {
    let mut config = toml::Table::new();
    config.insert("minimum_basis".to_owned(), "observed".into());
    let fx = Pack::example().host_with(config);
    let result = fx
        .brief(json!({ "tags": ["example-select", "example-field"], "detail": "full" }))
        .await;
    let text = data(&result)["content"].to_string();
    for weak in [
        "\"declared\"",
        "\"authored\"",
        "select.label-required",
        "field.labelling",
    ] {
        assert!(!text.contains(weak), "{weak} in {text}");
    }
    let select = entry(&result, "example-select");
    assert!(select.get("a11y").is_none() && select.get("usage").is_none());
    assert_eq!(rule_ids(&result), ["popup.focus-return"]);
    let omitted = data(&result)["omitted"].as_array().unwrap();
    assert_eq!(omitted[0]["reason"], "minimum-basis");
    assert!(omitted[0]["facts"].as_u64().unwrap() > 0);
}

#[tokio::test]
async fn known_rules_keep_their_ids_and_lose_their_text() {
    let fx = Pack::example().host();
    let result = fx
        .brief(json!({
            "tags": ["example-select", "example-field"],
            "known": ["field.labelling", "example/popup.focus-return"],
        }))
        .await;
    assert_eq!(rule_ids(&result), ["field.invalid-message"]);
    assert_eq!(
        entry(&result, "example-select")["rules"],
        json!(["field.labelling", "popup.focus-return"])
    );
    assert!(
        data(&result)["omitted"]
            .as_array()
            .unwrap()
            .iter()
            .all(|o| o["reason"] != "budget")
    );
    // A qualified id of another library does not match.
    let other = fx
        .brief(json!({ "tags": ["example-select"], "known": ["zed/popup.focus-return"] }))
        .await;
    assert_eq!(rule_ids(&other), ["field.labelling", "popup.focus-return"]);
}

fn two_libraries() -> Pack {
    let mut pack = Pack::example();
    pack.copy_example_as("zed");
    pack
}

#[tokio::test]
async fn with_two_libraries_in_an_answer_every_rule_id_is_qualified() {
    let mut config = toml::Table::new();
    config.insert("default_library".to_owned(), "zed".into());
    let mut pack = two_libraries();
    pack.add_synthetic("solo", 1);
    let fx = pack.host_with(config);
    // example-select is in both, and default_library picks zed; solo-item-0000 is in solo alone.
    let result = fx
        .brief(json!({ "tags": ["example-select", "solo-item-0000"] }))
        .await;
    assert_eq!(entry(&result, "example-select")["library"], "zed");
    assert_eq!(
        entry(&result, "example-select")["rules"],
        json!(["zed/field.labelling", "zed/popup.focus-return"])
    );
    assert_eq!(
        rule_ids(&result),
        ["zed/field.labelling", "zed/popup.focus-return"]
    );
    let libraries: Vec<&Value> = data(&result)["libraries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|l| &l["library"])
        .collect();
    assert_eq!(libraries, [&json!("solo"), &json!("zed")]);
    // One library in the answer: ids stay bare.
    let one = fx.brief(json!({ "tags": ["example-select"] })).await;
    assert_eq!(rule_ids(&one), ["field.labelling", "popup.focus-return"]);
    // With two libraries in the answer a bare known id matches nothing; a qualified one does.
    let known = fx
        .brief(json!({
            "tags": ["example-select", "solo-item-0000"],
            "known": ["field.labelling", "zed/popup.focus-return"],
        }))
        .await;
    assert_eq!(rule_ids(&known), ["zed/field.labelling"]);
}

#[tokio::test]
async fn a_tag_in_two_libraries_is_ambiguous_unless_something_decides() {
    let fx = two_libraries().host();
    let result = fx
        .brief(json!({ "tags": ["example-select", "example-zzz"] }))
        .await;
    assert_eq!(
        data(&result)["unknown"],
        json!([
            { "tag": "example-select", "reason": "ambiguous", "libraries": ["example", "zed"] },
            { "tag": "example-zzz", "reason": "not-found", "nearest": [] },
        ])
    );
    assert_eq!(data(&result)["libraries"], json!([]));
    let decided = fx
        .brief(json!({ "tags": ["example-select"], "library": "zed" }))
        .await;
    assert_eq!(entry(&decided, "example-select")["library"], "zed");
    let mut config = toml::Table::new();
    config.insert("default_library".to_owned(), "nowhere".into());
    let missing = two_libraries()
        .host_with(config)
        .brief(json!({ "tags": ["example-select"] }))
        .await;
    assert_eq!(code(&missing), "LIBRARY_NOT_FOUND");
}

#[tokio::test]
async fn versions_warn_once_per_library_whose_installed_version_differs() {
    let fx = Pack::example().host();
    let result = fx
        .brief(json!({
            "tags": ["example-select"],
            "versions": { "example-components": "1.1.0", "unrelated": "2.0.0" },
        }))
        .await;
    let warnings = result["warnings"].as_array().unwrap();
    assert_eq!(warnings.len(), 1, "{warnings:?}");
    assert_eq!(warnings[0]["code"], "LIBRARY_VERSION_MISMATCH");
    assert_eq!(
        warnings[0]["details"],
        json!({ "library": "example", "package": "example-components", "installed": "1.1.0", "pack": "1.0.0" })
    );
    assert!(
        data(&result)["content"]["components"]
            .as_array()
            .unwrap()
            .len()
            == 1
    );
    let same = fx
        .brief(json!({ "tags": ["example-select"], "versions": { "example-components": "1.0.0" } }))
        .await;
    assert!(
        same.get("warnings")
            .is_none_or(|w| w.as_array().unwrap().is_empty())
    );
}

#[tokio::test]
async fn input_the_schema_cannot_check_is_refused() {
    let fx = Pack::example().host();
    for input in [
        json!({}),
        json!({ "library": "example" }),
        json!({ "tags": ["Example-Select"] }),
        json!({ "tags": ["noprefix"] }),
        json!({ "tags": ["example-select"], "known": ["Not An Id"] }),
        json!({ "tags": ["example-select"], "known": ["Bad Library/field.labelling"] }),
        json!({ "tags": ["example-select"], "versions": { "example-components": "latest" } }),
        json!({ "tags": ["example-select"], "versions": { "Not A Package": "1.0.0" } }),
        json!({ "tags": ["example-select"], "library": "Example" }),
        json!({ "source": "x".repeat(262_145) }),
    ] {
        let result = fx.brief(input.clone()).await;
        assert_eq!(code(&result), "COMPONENTS_INVALID", "{input}");
        assert!(result["error"]["suggestion"].is_string());
    }
    let many: Vec<Value> = (0..33)
        .map(|i| json!([format!("package-{i}"), "1.0.0"]))
        .collect();
    let versions: serde_json::Map<String, Value> = many
        .iter()
        .map(|pair| (pair[0].as_str().unwrap().to_owned(), pair[1].clone()))
        .collect();
    let result = fx
        .brief(json!({ "tags": ["example-select"], "versions": versions }))
        .await;
    assert_eq!(code(&result), "COMPONENTS_INVALID");
    // The longest source allowed is read.
    let longest = format!("<example-select>{}", " ".repeat(262_144 - 16));
    let result = fx.brief(json!({ "source": longest })).await;
    assert_eq!(tags(&result), ["example-select"]);
}

#[tokio::test]
async fn more_than_128_tags_in_all_is_too_many() {
    let mut pack = Pack::default();
    pack.add_synthetic("many", 130);
    let fx = pack.host();
    let tags: Vec<String> = (0..64).map(|i| format!("many-item-{i:04}")).collect();
    let source: String = (64..130)
        .map(|i| format!("<many-item-{i:04}></many-item-{i:04}>"))
        .collect();
    let result = fx.brief(json!({ "tags": tags, "source": source })).await;
    assert_eq!(code(&result), "TOO_MANY_TAGS");
    assert_eq!(result["error"]["details"]["count"], 130);
    let source: String = (64..128).map(|i| format!("<many-item-{i:04}>")).collect();
    let result = fx.brief(json!({ "tags": tags, "source": source })).await;
    assert_eq!(support::tags(&result).len(), 128);
}

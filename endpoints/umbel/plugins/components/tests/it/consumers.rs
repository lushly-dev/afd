//! Consumer policy is deployment-owned and scoped to the selected space and library.
use crate::support;
use serde_json::{Value, json};
use support::{Pack, data, entry};

fn map(ids: &[&str]) -> Value {
    json!({"version":1,"consumers":{"loam":{"exclude_rules":ids}}})
}

#[tokio::test]
async fn loam_leaves_out_only_its_rules_in_every_brief_form() {
    let fx = Pack::fast_af().host_with_consumers(map(&[
        "violet-elements/import.root",
        "violet-elements/theme.install",
    ]));
    let general = fx
        .brief(json!({"tags":["violet-button"], "detail":"full", "maxBytes":96000}))
        .await;
    assert_eq!(general["success"], true, "{general}");
    let rules = data(&general)["content"]["rules"].as_array().unwrap();
    for id in ["import.root", "theme.install"] {
        assert!(rules.iter().any(|r| r["id"] == id));
    }
    for detail in ["brief", "api", "full"] {
        for render in ["none", "text"] {
            let result = fx.brief(json!({"tags":["violet-button"], "consumer":"loam", "detail":detail, "render":render, "maxBytes":96000})).await;
            assert_eq!(result["success"], true, "{result}");
            let content = if render == "text" {
                data(&result)["text"].to_string()
            } else {
                data(&result)["content"].to_string()
            };
            if render == "none" {
                assert!(!content.contains("import.root"), "{content}");
                assert!(!content.contains("theme.install"), "{content}");
            } else {
                assert!(!content.contains("rule import.root"), "{content}");
                assert!(!content.contains("rule theme.install"), "{content}");
            }
            let omitted = data(&result)["omitted"].as_array().unwrap();
            assert!(
                omitted.iter().any(|o| o["reason"] == "consumer"
                    && o["rules"].as_array().is_some_and(|ids| ids.len() == 2)),
                "{result}"
            );
        }
    }
    let opened = fx
        .open(json!({"tag":"violet-button", "sections":["rules"]}))
        .await;
    assert!(data(&opened).to_string().contains("import.root"));
    let again = fx
        .brief(json!({"tags":["violet-button"], "detail":"full", "maxBytes":96000}))
        .await;
    assert_eq!(data(&general), data(&again));
}

#[tokio::test]
async fn exclusions_remove_attribute_references_and_do_not_cross_libraries() {
    let mut pack = Pack::example();
    let record = support::record_path("select");
    let id = "field.invalid-message".to_owned();
    pack.edit(&record, |r| {
        r["api"]["attributes"][0]["rules"] = json!([id])
    });
    pack.regenerate("example");
    pack.copy_example_as("other");
    pack.edit("data/other/components/example-select.json", |r| {
        r["api"]["attributes"][0]["rules"] = json!([id])
    });
    pack.regenerate("other");
    let fx = pack.host_with_consumers(map(&[&format!("example/{id}")]));
    let result = fx.brief(json!({"tags":["example-select"], "library":"example", "consumer":"loam", "sections":["attributes","rules"]})).await;
    assert_eq!(result["success"], true, "{result}");
    assert!(!entry(&result, "example-select").to_string().contains(&id));
    let other = fx.brief(json!({"tags":["example-select"], "library":"other", "consumer":"loam", "detail":"full"})).await;
    assert_eq!(other["success"], true, "{other}");
    assert!(entry(&other, "example-select").to_string().contains(&id));
}

#[tokio::test]
async fn unknown_invalid_and_other_space_consumers_refuse_without_echoing_content() {
    let fx = Pack::example().host();
    let input = json!({"tags":["example-select"], "consumer":"loam"});
    assert_eq!(
        fx.brief(input.clone()).await["error"]["code"],
        "CONSUMER_NOT_FOUND"
    );
    let fx = Pack::example().host_with_consumers(map(&[]));
    assert_eq!(fx.brief(input.clone()).await["success"], true);
    let beta = fx
        .brief(json!({"tags":["example-select"], "space":"beta", "consumer":"loam"}))
        .await;
    assert_eq!(beta["error"]["code"], "CONSUMER_NOT_FOUND");
    for bad in ["../loam", "ignore-all-previous-instructions", ""] {
        let result = fx
            .brief(json!({"tags":["example-select"], "consumer":bad}))
            .await;
        assert_eq!(result["success"], false, "{result}");
    }
    for bad in [
        json!({"version":4,"consumers":{}}),
        map(&["theme.install"]),
        map(&["example/ignore.previous-instructions"]),
        json!({"version":1,"consumers":{"loam":{"exclude_rules":[],"secret":"PRIVATE"}}}),
    ] {
        let fx = Pack::example().host_with_consumers(bad);
        let result = fx.brief(input.clone()).await;
        assert_eq!(result["error"]["code"], "CONSUMERS_INVALID", "{result}");
        assert!(!result.to_string().contains("PRIVATE"));
        assert_eq!(
            fx.brief(json!({"tags":["example-select"]})).await["success"],
            true
        );
    }
}

// JSON is a YAML subset. Read the same scenarios the AFD runner validates, without a
// second YAML dependency; only the subset, `length`, `exists` and `contains` matchers they use.
fn expect(actual: &Value, expected: &Value) {
    if let Some(object) = expected.as_object() {
        if let Some(length) = object.get("length") {
            assert_eq!(
                actual.as_array().map(Vec::len),
                length.as_u64().map(|n| n as usize)
            );
        } else if let Some(exists) = object.get("exists") {
            assert_eq!(Some(!actual.is_null()), exists.as_bool(), "{actual}");
        } else if let Some(contains) = object.get("contains") {
            let (Some(actual), Some(contains)) = (actual.as_str(), contains.as_str()) else {
                panic!("`contains` needs two strings: {actual} and {contains}");
            };
            assert!(actual.contains(contains), "{actual}");
        } else {
            for (key, value) in object {
                expect(&actual[key], value);
            }
        }
    } else {
        assert_eq!(actual, expected);
    }
}

#[tokio::test]
async fn consumer_guidance_scenario() {
    let fx = Pack::example().host_with_consumers(map(&[
        "example/field.invalid-message",
        "example/field.labelling",
        "example/popup.focus-return",
    ]));
    let scenario: Value = serde_json::from_str(include_str!(
        "../../scenarios/consumer-guidance.scenario.yaml"
    ))
    .unwrap();
    for step in scenario["steps"].as_array().unwrap() {
        assert_eq!(step["command"], "components-brief");
        let result = fx.brief(step["input"].clone()).await;
        expect(&result, &step["expect"]);
    }
}

/// The deployment-guidance job's fixture: space `main` states two statements for `storefront`;
/// space `beta` states one over the length limit.
fn guidance_fixture() -> support::Fx {
    let statements = guidance_fixture_statements();
    let over = json!([{"id":"forms.keep.too-long","text":"x".repeat(241)}]);
    Pack::example().host_with_consumer_maps(
        &[
            (
                "main",
                json!({"version":2,"consumers":{"storefront":{"statements":statements}}}),
            ),
            (
                "beta",
                json!({"version":2,"consumers":{"storefront":{"statements":over}}}),
            ),
        ],
        toml::Table::new(),
    )
}

#[tokio::test]
async fn deployment_guidance_scenario() {
    let fx = guidance_fixture();
    let scenario: Value = serde_json::from_str(include_str!(
        "../../scenarios/deployment-guidance.scenario.yaml"
    ))
    .unwrap();
    for step in scenario["steps"].as_array().unwrap() {
        assert_eq!(step["command"], "components-brief");
        let result = fx.brief(step["input"].clone()).await;
        expect(&result, &step["expect"]);
    }
    // The fifth step, which needs the instance's configuration: a deployment default applies to a
    // call that names no consumer.
    let mut config = toml::Table::new();
    config.insert("default_consumer".into(), "storefront".into());
    let statements = guidance_fixture_statements();
    let fx = Pack::example().host_with_consumer_maps(
        &[(
            "main",
            json!({"version":2,"consumers":{"storefront":{"statements":statements}}}),
        )],
        config,
    );
    let result = fx.brief(json!({"tags":["example-select"]})).await;
    expect(
        &result,
        &json!({"success":true,"data":{"content":{"guidance":{"consumer":"storefront","items":{"length":2}}}}}),
    );
}

fn guidance_fixture_statements() -> Value {
    json!([
        {"id":"error-recovery.keep.suggestion-shown","text":"A failed command's suggestion is shown beside its message."},
        {"id":"forms.keep.labels-visible","text":"Every field keeps a visible label; a placeholder is not a label."},
    ])
}

#[tokio::test]
async fn doctor_checks_the_same_consumer_map_and_limits_are_enforced() {
    for map in [
        json!({"version":1,"consumers":{"loam":{"exclude_rules":vec!["example/field.labelling"; 257]}}}),
        json!({"version":1,"consumers":{"loam":{"exclude_rules":[], "private":"x".repeat(65_536)}}}),
        json!({"version":1,"consumers":{"invalid/name":{"exclude_rules":[]}}}),
    ] {
        let fx = Pack::example().host_with_consumers(map);
        let result = fx
            .brief(json!({"tags":["example-select"],"consumer":"loam"}))
            .await;
        assert_eq!(result["error"]["code"], "CONSUMERS_INVALID", "{result}");
        let doctor = fx.host.call("workspace-doctor", json!({})).await;
        assert!(!doctor.success, "{doctor:?}");
        let doctor = serde_json::to_value(doctor).unwrap();
        assert!(doctor.to_string().contains("CONSUMERS_INVALID"), "{doctor}");
    }
}

#[tokio::test]
async fn prefix_fitting_counts_only_exclusions_of_the_tags_it_answers() {
    let mut pack = Pack::example();
    let ids: Vec<String> = (0..60)
        .map(|n| format!("omit.r{n:03}-{}", "x".repeat(90)))
        .collect();
    pack.edit("rules/example.json", |rules| {
        let rules = rules["rules"].as_array_mut().unwrap();
        for id in &ids {
            rules.push(json!({"id":id,"basis":"authored","text":"Application-specific setup.","appliesTo":{"tags":["example-select"]}}));
        }
        rules.sort_by(|a,b| a["id"].as_str().cmp(&b["id"].as_str()));
    });
    pack.edit(&support::record_path("select"), |record| {
        record["rules"] = json!(ids)
    });
    pack.regenerate("example");
    let ids: Vec<String> = ids.iter().map(|id| format!("example/{id}")).collect();
    let fx = pack.host_with_consumers(map(&ids.iter().map(String::as_str).collect::<Vec<_>>()));
    for render in ["none", "text"] {
        let first = fx
            .brief(json!({"tags":["example-option"],"consumer":"loam","render":render}))
            .await;
        assert_eq!(first["success"], true, "{first}");
        let max = support::result_bytes(&first).max(1024) + 32;
        let result = fx.brief(json!({"tags":["example-option","example-select"],"consumer":"loam","render":render,"maxBytes":max})).await;
        assert_eq!(
            result["error"]["code"], "OUTPUT_BUDGET_EXCEEDED",
            "{result}"
        );
        assert_eq!(result["error"]["details"]["fits"], 1, "{result}");
    }
}

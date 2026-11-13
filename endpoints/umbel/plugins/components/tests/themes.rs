//! A record's `themes` (Specimen's pack format): the themes a component supports, declared or
//! observed. The reader accepts it as Specimen's checker does and refuses what that refuses, and a
//! brief and `components-open` serve it as the `themes` section (specification, section 5.3).
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::*;

const OPTION: &str = "data/example/components/example-option.json";
const LIGHT: &str = "Matches the marketing site.";

fn light() -> Value {
    json!({ "supported": ["light"], "basis": "declared", "reason": LIGHT })
}

fn with_themes(themes: Value) -> Pack {
    let mut pack = Pack::example();
    pack.edit(OPTION, |record| record["themes"] = themes);
    pack.regenerate("example");
    pack
}

#[tokio::test]
async fn serves_a_record_that_declares_or_observes_its_themes() {
    for themes in [
        json!({ "supported": ["light"], "basis": "declared", "reason": "Matches the marketing site." }),
        json!({ "supported": ["dark", "high-contrast", "light"], "basis": "observed" }),
    ] {
        let fx = with_themes(themes.clone()).host();
        let result = fx.list(json!({})).await;
        assert!(
            data(&result)["content"]["components"]
                .as_array()
                .unwrap()
                .iter()
                .any(|item| item["tag"] == "example-option"),
            "{themes}: {result}"
        );
    }
}

#[tokio::test]
async fn refuses_themes_as_specimen_does() {
    let at = |pointer: &str| (OPTION.to_owned(), Some(pointer.to_owned()));
    let cases = [
        (
            json!({ "supported": ["light", "dark"], "basis": "declared" }),
            at("/themes/supported/1"),
            "NOT_CANONICAL",
        ),
        (
            json!({ "supported": ["light", "light"], "basis": "declared" }),
            at("/themes/supported/1"),
            "DUPLICATE_ID",
        ),
        (
            json!({ "supported": [], "basis": "declared" }),
            at("/themes/supported"),
            "SCHEMA_INVALID",
        ),
        (
            json!({ "supported": ["sepia"], "basis": "declared" }),
            at("/themes/supported/0"),
            "SCHEMA_INVALID",
        ),
        (
            json!({ "supported": ["light"], "basis": "verified" }),
            at("/themes/basis"),
            "SCHEMA_INVALID",
        ),
        (
            json!({ "supported": ["light"], "basis": "declared", "extra": 1 }),
            at("/themes"),
            "SCHEMA_INVALID",
        ),
        (
            json!({ "supported": ["light"], "basis": "declared", "reason": "a\nb" }),
            at("/themes/reason"),
            "TEXT_INVALID",
        ),
    ];
    for (themes, (path, pointer), wanted) in cases {
        let (found_path, found_at, found_code) = the_problem(&with_themes(themes.clone())).await;
        assert_eq!(
            (found_path, found_at, found_code.as_str()),
            (path, pointer, wanted),
            "{themes}"
        );
    }
}

#[tokio::test]
async fn a_brief_and_open_serve_the_themes_section() {
    let fx = with_themes(light()).host();
    let section = json!({
        "basis": "declared",
        "items": [{ "supported": ["light"], "reason": LIGHT }],
    });
    let result = fx.brief(json!({ "tags": ["example-option"] })).await;
    assert_eq!(
        entry(&result, "example-option")["themes"],
        section,
        "{result}"
    );
    let result = fx
        .brief(json!({ "tags": ["example-option"], "sections": ["themes"] }))
        .await;
    let keys: Vec<&String> = entry(&result, "example-option")
        .as_object()
        .unwrap()
        .keys()
        .collect();
    assert!(keys.iter().any(|key| *key == "themes"), "{result}");
    assert!(!keys.iter().any(|key| *key == "attributes"), "{result}");
    let result = fx
        .open(json!({ "tag": "example-option", "sections": ["themes"] }))
        .await;
    // Open keeps each fact's own basis.
    assert_eq!(
        data(&result)["content"]["component"]["themes"],
        json!({ "items": [{ "supported": ["light"], "reason": LIGHT, "basis": "declared" }] }),
        "{result}"
    );
    // A record without it has no section.
    let result = Pack::example()
        .host()
        .brief(json!({ "tags": ["example-option"] }))
        .await;
    assert!(entry(&result, "example-option").get("themes").is_none());
}

#[tokio::test]
async fn the_text_block_reads_a_limit_or_the_list() {
    for (themes, header, line) in [
        (
            light(),
            "[themes declared]",
            format!("> light only: {LIGHT}"),
        ),
        (
            json!({ "supported": ["dark", "high-contrast", "light"], "basis": "observed" }),
            "[themes observed]",
            "> dark, high-contrast, light".to_owned(),
        ),
    ] {
        let fx = with_themes(themes).host();
        let result = fx
            .brief(json!({ "tags": ["example-option"], "render": "text" }))
            .await;
        let text = data(&result)["text"].as_str().unwrap();
        assert!(text.contains(&format!("{header}\n{line}\n")), "{text}");
    }
}

#[tokio::test]
async fn minimum_basis_leaves_out_a_declared_one() {
    let mut config = toml::Table::new();
    config.insert("minimum_basis".into(), "observed".into());
    let fx = with_themes(light()).host_with(config);
    let result = fx.brief(json!({ "tags": ["example-option"] })).await;
    assert!(entry(&result, "example-option").get("themes").is_none());
    assert_eq!(data(&result)["omitted"][0]["reason"], "minimum-basis");
}

#[tokio::test]
async fn it_sheds_last_with_gaps_and_rules() {
    // Every record declares, with a long reason, so the last steps are reached above the smallest
    // `maxBytes`.
    const NAMES: [&str; 4] = ["dropdown", "field", "option", "select"];
    const TAGS: [&str; 4] = [
        "example-dropdown",
        "example-field",
        "example-option",
        "example-select",
    ];
    let mut pack = Pack::example();
    for name in NAMES {
        pack.edit(&record_path(name), |record| {
            record["themes"] = json!({
                "supported": ["light"], "basis": "declared", "reason": "x".repeat(200),
            });
        });
    }
    pack.regenerate("example");
    let fx = pack.host();
    let full = fx.brief(json!({ "tags": TAGS })).await;
    let mut kept_alone = false;
    let mut shed = false;
    for max in (1024..result_bytes(&full)).rev().step_by(20) {
        let result = fx.brief(json!({ "tags": TAGS, "maxBytes": max })).await;
        if result["success"] == false {
            break;
        }
        for tag in TAGS {
            let entry = entry(&result, tag);
            let others = ["attributes", "slots", "roles", "a11y"]
                .iter()
                .any(|name| entry.get(*name).is_some());
            if entry.get("themes").is_some() {
                kept_alone |= !others;
            } else {
                assert!(!others, "themes went before another section: {result}");
                let budget = data(&result)["omitted"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|o| o["reason"] == "budget")
                    .unwrap();
                let sections = budget["sections"].as_array().unwrap();
                assert!(sections.contains(&json!("themes")), "{result}");
                shed = true;
            }
        }
    }
    assert!(kept_alone && shed, "the budget never reached the last step");
}

//! A record's `themes` (Specimen's pack format): the themes a component supports, declared or
//! observed. The reader accepts it as Specimen's checker does and refuses what that refuses; a
//! brief does not show it yet.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::*;

const OPTION: &str = "data/example/components/example-option.json";

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

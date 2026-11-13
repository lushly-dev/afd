//! The vocabulary pack (specification, section 5): the default pack is read; a missing file, each
//! file's missing key and each value past its ceiling refuse with `VALIDATION_ERROR`, naming the
//! file and the key, as a deployer's fault.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::json;
use support::*;

const TYPES: &str = include_str!("../packs/vocabulary/data/types.toml");
const MATCHING: &str = include_str!("../packs/vocabulary/data/matching.toml");
const LIMITS: &str = include_str!("../packs/vocabulary/data/limits.toml");

#[tokio::test]
async fn the_default_pack_is_read() {
    let fx = Fx::new();
    let guide = fx.agent("ideas-guide", json!({})).await;
    let d = data(&guide);
    let names: Vec<&str> = d["types"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["name"].as_str().unwrap())
        .collect();
    assert_eq!(
        names,
        [
            "evidence",
            "example",
            "model",
            "position",
            "principle",
            "question",
            "synthesis"
        ]
    );
    assert_eq!(d["bands"]["provisional"], true);
    assert_eq!(d["bands"]["words"]["likelySame"], 0.8857);
    assert_eq!(d["bands"]["words"]["related"], 0.0869);
    assert_eq!(d["bands"]["candidates"], 5);
    assert_eq!(d["limits"]["statementChars"], 600);
    assert_eq!(d["limits"]["captureMax"], 64);
    assert_eq!(d["limits"]["reportMin"], 50);
}

/// Override `file` with `text` in `main`, and expect the guide refused naming `file` and `key`.
async fn refused(file: &str, text: Option<&str>, key: &str) {
    let mut fx = Fx::new();
    fx.pack_override("main", file, text);
    let result = fx.agent("ideas-guide", json!({})).await;
    assert_eq!(code(&result), "VALIDATION_ERROR", "{file} {key}: {result}");
    let details = &result["error"]["details"];
    assert_eq!(details["reason"], "pack", "{result}");
    assert_eq!(details["file"], file, "{result}");
    assert_eq!(details["key"], key, "{result}");
    // The other space keeps the default pack.
    let other = fx.agent("ideas-guide", json!({ "space": "beta" })).await;
    assert_eq!(other["success"], true, "{other}");
}

fn without(text: &str, key: &str) -> String {
    text.lines()
        .filter(|line| !line.trim_start().starts_with(&format!("{key} ")))
        .collect::<Vec<_>>()
        .join("\n")
}

fn with(text: &str, key: &str, value: &str) -> String {
    text.lines()
        .map(|line| {
            if line.trim_start().starts_with(&format!("{key} ")) {
                format!("{key} = {value}")
            } else {
                line.to_owned()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[tokio::test]
async fn a_missing_file_refuses() {
    for file in ["data/types.toml", "data/matching.toml", "data/limits.toml"] {
        refused(file, None, "(file)").await;
    }
    refused("data/limits.toml", Some("not = [toml"), "(file)").await;
}

#[tokio::test]
async fn each_limit_missing_or_past_its_ceiling_refuses() {
    let ceilings = [
        ("statement_chars", 2000),
        ("capture_max", 64),
        ("stage_max", 500),
        ("review_max", 2000),
        ("part_max", 500),
        ("ask_default", 25),
        ("ask_max", 200),
        ("page_items", 20),
        ("page_chars", 5800),
        ("report_min", 50),
    ];
    for (key, ceiling) in ceilings {
        refused("data/limits.toml", Some(&without(LIMITS, key)), key).await;
        refused(
            "data/limits.toml",
            Some(&with(LIMITS, key, &(ceiling + 1).to_string())),
            key,
        )
        .await;
    }
    // At its ceiling a limit is served.
    let mut fx = Fx::new();
    fx.pack_override(
        "main",
        "data/limits.toml",
        Some(&with(LIMITS, "statement_chars", "2000")),
    );
    let guide = fx.agent("ideas-guide", json!({})).await;
    assert_eq!(data(&guide)["limits"]["statementChars"], 2000);
}

#[tokio::test]
async fn each_matching_key_missing_or_out_of_range_refuses() {
    refused(
        "data/matching.toml",
        Some(&without(MATCHING, "candidates")),
        "candidates",
    )
    .await;
    refused(
        "data/matching.toml",
        Some(&without(MATCHING, "max_candidates")),
        "max_candidates",
    )
    .await;
    refused(
        "data/matching.toml",
        Some(&with(MATCHING, "max_candidates", "11")),
        "max_candidates",
    )
    .await;
    refused(
        "data/matching.toml",
        Some(&with(MATCHING, "candidates", "11")),
        "candidates",
    )
    .await;
    refused(
        "data/matching.toml",
        Some(&without(MATCHING, "likely_same")),
        "bands.words.likely_same",
    )
    .await;
    refused(
        "data/matching.toml",
        Some(&with(MATCHING, "related", "1.5")),
        "bands.words.related",
    )
    .await;
    refused(
        "data/matching.toml",
        Some(&with(MATCHING, "related", "0.95")),
        "bands.words.related",
    )
    .await;
    refused(
        "data/matching.toml",
        Some("candidates = 5\nmax_candidates = 10\n"),
        "bands",
    )
    .await;
}

#[tokio::test]
async fn a_type_without_its_meaning_or_badly_named_refuses() {
    refused(
        "data/types.toml",
        Some(&TYPES.replace("means = \"A view the person holds or argues.\"", "")),
        "types.position.means",
    )
    .await;
    refused(
        "data/types.toml",
        Some("[types.Position]\nmeans = \"A view.\"\n"),
        "types.Position",
    )
    .await;
    refused("data/types.toml", Some("title = \"none\"\n"), "types").await;
}

#[tokio::test]
async fn a_spaces_own_types_are_the_ones_capture_takes() {
    let mut fx = Fx::new();
    fx.pack_override(
        "main",
        "data/types.toml",
        Some("[types.seasonal]\nmeans = \"A rule that holds in one season.\"\n"),
    );
    let refused = fx
        .agent(
            "ideas-capture",
            json!({ "ideas": [{ "statement": "Sow peas in early spring.", "type": "principle" }] }),
        )
        .await;
    assert_eq!(code(&refused), "VALIDATION_ERROR");
    assert_eq!(refused["error"]["details"]["valid"], json!(["seasonal"]));
    let taken = fx
        .agent(
            "ideas-capture",
            json!({ "ideas": [{ "statement": "Sow peas in early spring.", "type": "seasonal" }] }),
        )
        .await;
    assert_eq!(data(&taken)["captured"], 1);
}

//! Every invalid case of Specimen's fixtures fails with its problems and the failure code of the
//! specification's section 3.3; the exported form is served and the committed form refused.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::*;

const INCONSISTENT: [&str; 5] = [
    "catalog-summary",
    "record-not-listed",
    "record-missing",
    "record-digest",
    "pack-digest",
];

fn expected(case: &Value) -> Vec<(String, Option<String>, String)> {
    let mut problems: Vec<_> = case["problems"]
        .as_array()
        .unwrap()
        .iter()
        .map(|problem| {
            (
                problem["path"].as_str().unwrap().to_owned(),
                problem["at"].as_str().map(str::to_owned),
                problem["code"].as_str().unwrap().to_owned(),
            )
        })
        .collect();
    problems.sort();
    problems
}

#[tokio::test]
async fn every_invalid_case_agrees_with_specimen() {
    let root = specimen_fixtures().join("invalid");
    let manifest: Value =
        serde_json::from_slice(&std::fs::read(root.join("cases.json")).unwrap()).unwrap();
    let cases = manifest["cases"].as_array().unwrap();
    assert!(cases.len() >= 26, "{} cases", cases.len());
    for case in cases {
        let name = case["name"].as_str().unwrap();
        let mut pack = Pack::example();
        for path in case["remove"].as_array().into_iter().flatten() {
            pack.files.remove(path.as_str().unwrap());
        }
        for (path, bytes) in read_tree(&root.join(name)) {
            pack.files.insert(path, bytes);
        }
        let result = pack.host().list(json!({})).await;
        assert_eq!(result["success"], false, "{name}: {result}");
        let mut found = problems(&result);
        found.sort();
        assert_eq!(found, expected(case), "{name}");
        let wanted = if INCONSISTENT.contains(&name) {
            "PACK_INCONSISTENT"
        } else {
            "PACK_INVALID"
        };
        assert_eq!(code(&result), wanted, "{name}");
        assert_eq!(
            result["error"]["details"]["refused"],
            json!(["example"]),
            "{name}"
        );
    }
}

#[tokio::test]
async fn the_exported_form_is_served() {
    let result = Pack::example().host().list(json!({})).await;
    assert_eq!(
        tags(&result),
        [
            "example-dropdown",
            "example-field",
            "example-option",
            "example-select"
        ]
    );
}

#[tokio::test]
async fn the_committed_form_is_refused() {
    let pack = Pack {
        files: read_tree(&specimen_fixtures().join("committed")),
    };
    let result = pack.host().list(json!({})).await;
    assert_eq!(code(&result), "PACK_INVALID");
    assert_eq!(
        problems(&result),
        [(
            "data/example/library.json".to_owned(),
            None,
            "LAYOUT_INVALID".to_owned()
        )]
    );
}

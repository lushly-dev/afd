//! A graceful refusal (specification, section 9.1), on packs of several libraries.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::*;

const CANARY: &str = "CANARY-7f3a-sentinel";

fn three() -> Pack {
    let mut pack = Pack::example();
    pack.copy_example_as("alpha");
    pack.copy_example_as("gamma");
    pack
}

fn break_schema(pack: &mut Pack, library: &str) {
    let path = format!("data/{library}/components/example-field.json");
    pack.edit(&path, |record| {
        record["usage"][0]["text"] = json!(format!("{CANARY} {}", "x".repeat(300)));
    });
    pack.regenerate(library);
}

fn break_digest(pack: &mut Pack, library: &str) {
    let path = format!("data/{library}/components/example-option.json");
    pack.edit(&path, |record| {
        record["summary"] = json!("Changed after the catalog was written.");
        record.as_object_mut().unwrap();
    });
    // The catalog's summary now differs too: a digest and a catalog mismatch, nothing else.
}

fn details(result: &Value) -> &Value {
    &result["error"]["details"]
}

fn no_content(result: &Value) {
    assert_eq!(result["success"], false);
    assert!(result.get("data").is_none_or(Value::is_null), "{result}");
    let text = result.to_string();
    assert!(!text.contains(CANARY), "pack text in a failure: {text}");
    assert!(!text.contains("content"), "{text}");
}

#[tokio::test]
async fn one_bad_library_fails_a_call_with_no_library_and_names_the_good_ones() {
    let mut pack = three();
    break_schema(&mut pack, "alpha");
    let fx = pack.host();
    let result = fx.list(json!({})).await;
    assert_eq!(code(&result), "PACK_INVALID");
    no_content(&result);
    assert_eq!(details(&result)["library"], "alpha");
    assert_eq!(details(&result)["refused"], json!(["alpha"]));
    assert_eq!(details(&result)["servable"], json!(["example", "gamma"]));
    assert!(!result["error"]["retryable"].as_bool().unwrap_or(false));

    let served = fx.list(json!({ "library": "gamma" })).await;
    assert_eq!(tags(&served).len(), 4);
    let opened = fx
        .open(json!({ "library": "example", "tag": "example-field" }))
        .await;
    assert_eq!(opened["success"], true, "{opened}");
}

#[tokio::test]
async fn naming_the_bad_library_fails_with_no_servable() {
    let mut pack = three();
    break_schema(&mut pack, "alpha");
    let result = pack
        .host()
        .open(json!({ "library": "alpha", "tag": "example-field" }))
        .await;
    assert_eq!(code(&result), "PACK_INVALID");
    no_content(&result);
    assert_eq!(details(&result)["refused"], json!(["alpha"]));
    assert!(details(&result).get("servable").is_none(), "{result}");
}

#[tokio::test]
async fn several_bad_libraries_are_all_named_with_the_first_detailed() {
    let mut pack = three();
    break_schema(&mut pack, "gamma");
    break_schema(&mut pack, "alpha");
    let result = pack.host().list(json!({})).await;
    assert_eq!(details(&result)["library"], "alpha");
    assert_eq!(details(&result)["refused"], json!(["alpha", "gamma"]));
    assert_eq!(details(&result)["servable"], json!(["example"]));
}

#[tokio::test]
async fn only_digest_and_catalog_problems_are_inconsistent_and_retryable() {
    let mut pack = three();
    break_digest(&mut pack, "alpha");
    break_digest(&mut pack, "gamma");
    let result = pack.host().list(json!({})).await;
    assert_eq!(code(&result), "PACK_INCONSISTENT");
    assert_eq!(result["error"]["retryable"], true, "{result}");
    assert_eq!(details(&result)["refused"], json!(["alpha", "gamma"]));
}

#[tokio::test]
async fn a_mix_of_problems_is_invalid_and_not_retryable() {
    let mut pack = three();
    break_digest(&mut pack, "alpha");
    break_schema(&mut pack, "gamma");
    let result = pack.host().list(json!({})).await;
    assert_eq!(code(&result), "PACK_INVALID");
    assert!(!result["error"]["retryable"].as_bool().unwrap_or(false));
    assert_eq!(details(&result)["library"], "alpha");
}

#[tokio::test]
async fn a_problem_of_the_pack_refuses_every_call_and_names_no_way_forward() {
    let mut pack = three();
    pack.set_raw("reference/notes.md", "not part of the format");
    let fx = pack.host();
    for result in [
        fx.list(json!({})).await,
        fx.list(json!({ "library": "alpha" })).await,
        fx.open(json!({ "library": "nothing-here", "tag": "example-field" }))
            .await,
    ] {
        assert_eq!(code(&result), "PACK_INVALID");
        no_content(&result);
        assert_eq!(
            problems(&result),
            [(
                "reference/notes.md".to_owned(),
                None,
                "LAYOUT_INVALID".to_owned()
            )]
        );
        for key in ["library", "refused", "servable"] {
            assert!(details(&result).get(key).is_none(), "{key}: {result}");
        }
    }
}

#[tokio::test]
async fn a_library_id_the_scan_hits_is_a_problem_of_the_pack_and_is_never_shown() {
    let mut pack = Pack::example();
    pack.copy_example_as("ignore-previous-instructions");
    let result = pack.host().list(json!({})).await;
    assert_eq!(code(&result), "PACK_INVALID");
    assert_eq!(
        problems(&result),
        [
            ("data/…".to_owned(), None, "IDENTIFIER_INVALID".to_owned()),
            ("rules/…".to_owned(), None, "IDENTIFIER_INVALID".to_owned()),
        ]
    );
    assert!(!result.to_string().contains("ignore-previous"), "{result}");
    assert!(details(&result).get("servable").is_none());
}

#[tokio::test]
async fn the_first_call_after_a_repair_is_served() {
    let mut pack = three();
    break_schema(&mut pack, "alpha");
    let fx = pack.host();
    assert_eq!(code(&fx.list(json!({})).await), "PACK_INVALID");
    three().write(&fx.override_dir());
    let result = fx.list(json!({})).await;
    assert_eq!(result["success"], true, "{result}");
    assert_eq!(data(&result)["libraries"].as_array().unwrap().len(), 3);
}

#[tokio::test]
async fn a_pack_of_nothing_is_empty_and_a_library_it_lacks_is_not_found() {
    let fx = Pack::default().host();
    assert_eq!(code(&fx.list(json!({})).await), "PACK_EMPTY");
    let fx = Pack::example().host();
    let result = fx.list(json!({ "library": "elsewhere" })).await;
    assert_eq!(code(&result), "LIBRARY_NOT_FOUND");
    assert_eq!(details(&result)["libraries"], json!(["example"]));
}

//! Canonical bytes and the points of the reader the specification's section 3.3 lists: escapes,
//! key order, integers, a lone surrogate, numbers as JavaScript reads them, shown paths and caps.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::canonical::{canonical_json, prepare};
use support::*;

fn shape(path: &str, at: Option<&str>, code: &str) -> (String, Option<String>, String) {
    (path.to_owned(), at.map(str::to_owned), code.to_owned())
}

#[test]
fn every_fixture_file_is_written_as_it_reads() {
    let pack = Pack::example();
    for (path, bytes) in &pack.files {
        let text = std::str::from_utf8(bytes).unwrap();
        let value: Value = serde_json::from_str(text).unwrap();
        assert_eq!(canonical_json(&value), text, "{path}");
    }
}

#[test]
fn writes_json_stringify_escapes() {
    let value: Value =
        serde_json::from_str(r#"{"a":"\" \\ \b \f \n \r \t \u0001 \u001f / é \u2028 \u007f 😀"}"#)
            .unwrap();
    assert_eq!(
        canonical_json(&value),
        "{\n\t\"a\": \"\\\" \\\\ \\b \\f \\n \\r \\t \\u0001 \\u001f / é \u{2028} \u{7f} 😀\"\n}\n"
    );
}

#[test]
fn sorts_keys_by_utf16_code_unit_and_writes_empty_containers_flat() {
    let value: Value =
        serde_json::from_str(r#"{"😀":1,"\uffff":2,"b":{"d":[],"c":{}},"a":[1,[2]]}"#).unwrap();
    assert_eq!(
        canonical_json(&value),
        "{\n\t\"a\": [\n\t\t1,\n\t\t[\n\t\t\t2\n\t\t]\n\t],\n\t\"b\": {\n\t\t\"c\": {},\n\t\t\"d\": []\n\t},\n\t\"😀\": 1,\n\t\"\u{ffff}\": 2\n}\n"
    );
}

#[test]
fn writes_integers_however_they_were_spelled() {
    for (text, written) in [
        ("1.0", "1\n"),
        ("1e2", "100\n"),
        ("-0", "0\n"),
        ("7", "7\n"),
    ] {
        let value: Value = serde_json::from_str(text).unwrap();
        assert_eq!(canonical_json(&value), written, "{text}");
    }
}

#[test]
fn prepare_replaces_only_unpaired_surrogate_escapes() {
    let prepared = prepare(r#"{"a":"x\ud800y","b":"\uD83D\uDE00","c":"\\ud800","d":"\udc00"}"#);
    let marker = prepared.marker.unwrap();
    assert_eq!(marker, '\u{FDD0}');
    assert_eq!(
        prepared.text,
        r#"{"a":"x\ufdd0y","b":"\uD83D\uDE00","c":"\\ud800","d":"\ufdd0"}"#
    );
    let untouched = prepare(r#"{"a":"plain","b":1.5}"#);
    assert!(untouched.marker.is_none());
    assert!(matches!(untouched.text, std::borrow::Cow::Borrowed(_)));
}

#[test]
fn prepare_picks_a_marker_the_file_does_not_use() {
    let prepared = prepare("{\"a\":\"\u{FDD0}\",\"b\":\"\\uFDD1\",\"c\":\"\\ud800\"}");
    assert_eq!(prepared.marker, Some('\u{FDD2}'));
}

#[test]
fn prepare_makes_an_overflowing_number_unreadable_as_a_number() {
    assert_eq!(prepare("[1e999,-1E400,2]").text, "[{},{},2]");
    assert_eq!(prepare("[01e999,1.e999,1e]").text, "[01e999,1.e999,1e]");
}

fn with_usage_text(raw_text: &str) -> Pack {
    let path = record_path("field");
    let mut pack = Pack::example();
    let mut value = pack.json(&path);
    value["usage"][0]["text"] = json!("PLACEHOLDER");
    let text = canonical_json(&value).replace("PLACEHOLDER", raw_text);
    pack.set_raw(&path, &text);
    pack.regenerate("example");
    pack
}

#[tokio::test]
async fn a_lone_surrogate_in_text_is_text_invalid_at_its_pointer() {
    let found = the_problem(&with_usage_text(r"before \ud800 after")).await;
    assert_eq!(
        found,
        shape(&record_path("field"), Some("/usage/0/text"), "TEXT_INVALID")
    );
}

#[tokio::test]
async fn an_escaped_backslash_is_not_a_surrogate() {
    let result = with_usage_text(r"before \\ud800 after")
        .host()
        .list(json!({}))
        .await;
    assert_eq!(result["success"], true, "{result}");
}

#[tokio::test]
async fn a_lone_surrogate_in_an_identifier_or_a_key_takes_that_field_s_code() {
    let path = record_path("field");
    let mut pack = Pack::example();
    let mut value = pack.json(&path);
    value["usage"][0]["id"] = json!("PLACEHOLDER");
    pack.set_raw(
        &path,
        &canonical_json(&value).replace("PLACEHOLDER", r"a.\ud800"),
    );
    pack.regenerate("example");
    assert_eq!(
        the_problem(&pack).await,
        shape(&path, Some("/usage/0/id"), "IDENTIFIER_INVALID")
    );

    let mut pack = Pack::example();
    let raw = String::from_utf8(pack.files[&path].clone()).unwrap();
    pack.set_raw(&path, &raw.replacen('{', "{\n\t\"\\ud800\": 1,", 1));
    pack.regenerate("example");
    assert_eq!(
        the_problem(&pack).await,
        shape(&path, None, "SCHEMA_INVALID")
    );
}

#[tokio::test]
async fn a_whole_number_written_oddly_is_not_canonical_with_no_pointer() {
    for spelling in ["1.0", "1e0", "1E0"] {
        let path = record_path("select");
        let mut pack = Pack::example();
        let raw = String::from_utf8(pack.files[&path].clone()).unwrap();
        assert!(
            raw.contains("\"violations\": 0"),
            "the fixture still has violations: 0"
        );
        pack.set_raw(
            &path,
            &raw.replacen(
                "\"violations\": 0",
                &format!("\"violations\": {spelling}"),
                1,
            ),
        );
        pack.regenerate("example");
        assert_eq!(
            the_problem(&pack).await,
            shape(&path, None, "NOT_CANONICAL"),
            "{spelling}"
        );
    }
}

#[tokio::test]
async fn a_number_that_is_no_integer_is_schema_invalid_at_its_pointer() {
    for spelling in ["1.5", "9007199254740993", "1e999"] {
        let path = record_path("select");
        let mut pack = Pack::example();
        let raw = String::from_utf8(pack.files[&path].clone()).unwrap();
        pack.set_raw(
            &path,
            &raw.replacen(
                "\"violations\": 0",
                &format!("\"violations\": {spelling}"),
                1,
            ),
        );
        pack.regenerate("example");
        assert_eq!(
            the_problem(&pack).await,
            shape(&path, Some("/a11y/axe/violations"), "SCHEMA_INVALID"),
            "{spelling}"
        );
    }
}

#[tokio::test]
async fn a_repeated_key_keeps_the_last_value_and_is_not_canonical() {
    let path = record_path("field");
    let mut pack = Pack::example();
    let raw = String::from_utf8(pack.files[&path].clone()).unwrap();
    pack.set_raw(
        &path,
        &raw.replacen("\"format\": 0,", "\"format\": 1,\n\t\"format\": 0,", 1),
    );
    pack.regenerate("example");
    assert_eq!(
        the_problem(&pack).await,
        shape(&path, None, "NOT_CANONICAL")
    );
}

#[tokio::test]
async fn a_byte_order_mark_is_json_invalid() {
    let path = record_path("field");
    let mut pack = Pack::example();
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend_from_slice(&pack.files[&path]);
    pack.files.insert(path.clone(), bytes);
    pack.regenerate("example");
    assert_eq!(the_problem(&pack).await, shape(&path, None, "JSON_INVALID"));
}

#[tokio::test]
async fn a_path_with_free_text_is_cut_at_its_first_odd_segment() {
    let mut pack = Pack::example();
    pack.set_raw("data/example/odd name/notes.json", "{}");
    assert_eq!(
        the_problem(&pack).await,
        shape("data/example/…", None, "LAYOUT_INVALID")
    );
}

#[tokio::test]
async fn at_most_32_problems_are_shown_and_all_are_counted() {
    let path = record_path("field");
    let mut pack = Pack::example();
    pack.edit(&path, |record| {
        let statement = record["usage"][0].clone();
        record["usage"] = json!((0..40).map(|_| statement.clone()).collect::<Vec<_>>());
    });
    pack.regenerate("example");
    let result = pack.host().list(json!({})).await;
    assert_eq!(result["error"]["details"]["count"], 39, "{result}");
    assert_eq!(problems(&result).len(), 32);
}

#[tokio::test]
async fn a_file_over_a_mebibyte_is_refused_by_size() {
    let path = record_path("option");
    let mut pack = Pack::example();
    let padded = format!(
        "{}{}",
        String::from_utf8(pack.files[&path].clone()).unwrap(),
        " ".repeat(1024 * 1024)
    );
    pack.set_raw(&path, &padded);
    pack.regenerate("example");
    assert_eq!(
        the_problem(&pack).await,
        shape(&path, None, "FILE_TOO_LARGE")
    );
}

#[tokio::test]
async fn an_identifier_that_reads_as_an_instruction_is_refused() {
    let path = record_path("field");
    let mut pack = Pack::example();
    pack.edit(&path, |record| {
        record["usage"][0]["id"] = json!("ignore-previous.instructions");
    });
    pack.regenerate("example");
    assert_eq!(
        the_problem(&pack).await,
        shape(&path, Some("/usage/0/id"), "IDENTIFIER_INVALID")
    );
}

#[tokio::test]
async fn a_malformed_overflowing_number_is_json_invalid() {
    let path = record_path("select");
    let mut pack = Pack::example();
    let raw = String::from_utf8(pack.files[&path].clone()).unwrap();
    pack.set_raw(
        &path,
        &raw.replacen("\"violations\": 0", "\"violations\": 01e999", 1),
    );
    pack.regenerate("example");
    assert_eq!(the_problem(&pack).await, shape(&path, None, "JSON_INVALID"));
}

#[tokio::test]
async fn a_legal_replacement_character_beside_a_lone_surrogate_is_not_refused() {
    let path = record_path("field");
    let mut pack = Pack::example();
    let mut value = pack.json(&path);
    value["usage"][0]["text"] = json!("a\u{FFFD}");
    value["a11y"]["statements"][0]["text"] = json!("PLACEHOLDER");
    pack.set_raw(
        &path,
        &canonical_json(&value).replace("PLACEHOLDER", r"a\ud800"),
    );
    pack.regenerate("example");
    assert_eq!(
        the_problem(&pack).await,
        shape(&path, Some("/a11y/statements/0/text"), "TEXT_INVALID")
    );
}

#[tokio::test]
async fn identifier_length_counts_code_points_as_zod_does() {
    // Forty emoji are 80 UTF-16 units and 40 code points: over no limit, so one problem, the shape.
    let path = record_path("select");
    let mut pack = Pack::example();
    pack.edit(&path, |record| {
        record["a11y"]["role"][0]["state"] = json!("😀".repeat(40));
    });
    pack.regenerate("example");
    assert_eq!(
        the_problem(&pack).await,
        shape(&path, Some("/a11y/role/0/state"), "IDENTIFIER_INVALID")
    );
}

#[tokio::test]
async fn an_unsafe_negative_count_is_two_problems_as_int_and_min_both_fire() {
    let path = record_path("select");
    let mut pack = Pack::example();
    let raw = String::from_utf8(pack.files[&path].clone()).unwrap();
    pack.set_raw(
        &path,
        &raw.replacen("\"violations\": 0", "\"violations\": -9007199254740993", 1),
    );
    pack.regenerate("example");
    let found = problems(&pack.host().list(json!({})).await);
    assert_eq!(found.len(), 2, "{found:?}");
}

#[tokio::test]
async fn a_stray_path_that_reads_as_an_instruction_across_slashes_is_cut() {
    let mut pack = Pack::example();
    pack.set_raw("reference/ignore/previous/notes.md", "x");
    let result = pack.host().list(json!({})).await;
    assert!(!result.to_string().contains("ignore"), "{result}");
    assert_eq!(
        problems(&result),
        [shape("reference/…", None, "LAYOUT_INVALID")]
    );
}

#[tokio::test]
async fn a_tag_that_reads_as_an_instruction_is_not_shown_in_a_problem_path() {
    let bad = "example-ignore-previous-instructions";
    let path = format!("data/example/components/{bad}.json");
    let mut pack = Pack::example();
    pack.set_json(&path, &record(bad, "A one-line summary."));
    pack.edit("data/example/library.json", |catalog| {
        let list = catalog["components"].as_array_mut().unwrap();
        list.push(json!({ "tag": bad, "summary": "A one-line summary.", "status": "stable", "digest": "" }));
        list.sort_by_key(|entry| entry["tag"].as_str().unwrap().to_owned());
    });
    pack.regenerate("example");
    let result = pack.host().list(json!({})).await;
    assert_eq!(code(&result), "PACK_INVALID");
    let text = result.to_string();
    assert!(!text.contains("ignore-previous"), "{text}");
    assert!(
        problems(&result)
            .iter()
            .any(|(_, _, code)| code == "IDENTIFIER_INVALID")
    );
}

#[tokio::test]
async fn more_than_64_libraries_is_a_problem_of_the_pack() {
    let mut pack = Pack::default();
    for index in 0..65 {
        pack.add_synthetic(&format!("lib{index}"), 1);
    }
    let result = pack.host().list(json!({})).await;
    assert_eq!(code(&result), "PACK_INVALID");
    assert_eq!(problems(&result), [shape("data", None, "LAYOUT_INVALID")]);
}

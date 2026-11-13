//! The end-to-end test (step C4): FAST-AF's pack, built by Specimen from `violet-elements`'
//! stories and exported by `specimen pack-export`, loaded as a space override beside the example
//! library, answering briefs. With it, the proposal's criteria 1 (one round trip), 2 (smaller
//! than what it replaces) and 7 (ships empty) on the real library.
//!
//! The test reads the export from two places: the records and rules from `violet-elements`'
//! committed pack, which the format's exported form holds byte for byte, and the catalog export
//! wrote from `tests/fast_af/library.json`. The reader checks every digest in that catalog, so the
//! override is exactly what `pack-export` writes, and a record rebuilt without exporting again
//! fails here, naming the fix. Neither Specimen nor Umbel depends on the other: this test reads
//! files, as `default_pack.rs` reads Specimen's fixture.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::*;

/// The library id `violet-elements`' configuration gives its pack.
const LIBRARY: &str = "violet-elements";

/// A host serving FAST-AF's export beside the example in space `main`, failing with the way to
/// export again when the catalog no longer matches the records.
async fn fast_af_host() -> Fx {
    let fx = Pack::fast_af().host();
    let result = fx.list(json!({ "library": LIBRARY })).await;
    assert!(
        result["success"] == true,
        "FAST-AF's committed records no longer match the catalog export wrote; {REEXPORT}. {result}"
    );
    fx
}

fn pages() -> Vec<(String, u64, Vec<String>)> {
    let pages: Value =
        serde_json::from_slice(&std::fs::read(fast_af_fixtures().join("pages.json")).unwrap())
            .unwrap();
    pages["pages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|page| {
            (
                page["page"].as_str().unwrap().to_owned(),
                page["declarations"].as_u64().unwrap(),
                page["tags"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|tag| tag.as_str().unwrap().to_owned())
                    .collect(),
            )
        })
        .collect()
}

fn unknown_tags(result: &Value) -> Vec<String> {
    data(result)["unknown"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["tag"].as_str().unwrap().to_owned())
        .collect()
}

#[tokio::test]
async fn the_export_is_served_whole_beside_the_example_library() {
    let fx = fast_af_host().await;
    let result = fx.list(json!({})).await;
    let libraries: Vec<&str> = data(&result)["libraries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|library| library["library"].as_str().unwrap())
        .collect();
    assert_eq!(libraries, ["example", LIBRARY]);
    let catalog = Pack::fast_af().json("data/violet-elements/library.json");
    let listed = fx
        .list(json!({ "library": LIBRARY, "prefix": "violet-" }))
        .await;
    let library = &data(&listed)["libraries"][0];
    assert_eq!(library["package"], catalog["package"]["name"]);
    assert_eq!(library["digest"], catalog["digest"]);
    // Every record the catalog lists is a record the committed pack holds, and the reverse.
    let committed = read_tree(&fast_af_committed().join("data/violet-elements/components"));
    assert_eq!(
        catalog["components"].as_array().unwrap().len(),
        committed.len(),
        "{REEXPORT}"
    );
    assert_eq!(
        committed.len(),
        77,
        "B4's pack covers every tag of the library"
    );
}

/// Criterion 1: twenty of FAST-AF's tags in one call inside the default budget, from an override
/// that also holds the example library, with no requested tag missing from both lists.
#[tokio::test]
async fn twenty_components_are_briefed_in_one_call_inside_the_default_budget() {
    let fx = fast_af_host().await;
    let (_, _, requested) = pages()
        .into_iter()
        .find(|(page, _, _)| page == "Twenty-component page")
        .unwrap();
    assert_eq!(requested.len(), 20);
    // The time a call takes on the real pack (debug build, as the tests run), printed with no
    // threshold for the cache follow-up: the median of five calls.
    let mut times = Vec::new();
    let mut result = Value::Null;
    for _ in 0..5 {
        let started = std::time::Instant::now();
        result = fx.brief(json!({ "tags": requested })).await;
        times.push(started.elapsed().as_millis());
    }
    times.sort_unstable();
    let (used, limit) = measured(&result);
    assert_eq!(limit, 40_000, "the default budget");
    assert!(used <= limit, "{used} of {limit}");
    let answered = tags(&result);
    let unknown = unknown_tags(&result);
    for tag in &requested {
        assert!(
            answered.contains(tag) || unknown.contains(tag),
            "{tag} is in neither components nor unknown"
        );
    }
    assert_eq!(
        answered, requested,
        "every tag answered, in the order asked"
    );
    assert!(unknown.is_empty());
    eprintln!(
        "fast_af: twenty components, {used} of {limit} bytes in {} ms (median of five; {times:?}); omitted {}",
        times[2],
        data(&result)["omitted"]
    );
}

/// Criterion 2, as the owner reset it on 2026-11-13: for each page of step 0.1's set, a default
/// brief is smaller than the same components' declarations, and the API alone (`detail: "api"`) is
/// at most half of them. The default brief is measured whole, at the largest budget a call can ask
/// for, where nothing is shed to fit (it leaves out only what plugin specification A24 leaves out
/// of every default brief), and at the default budget, which can only be smaller. The proposal's
/// first target, a default brief at most half, does not hold on FAST-AF's real pack (step C4's
/// record in the Component Briefs status) and is printed, not asserted.
#[tokio::test]
async fn each_page_s_brief_is_smaller_than_its_declarations() {
    let fx = fast_af_host().await;
    for (page, declarations, requested) in pages() {
        let target = declarations / 2;
        let default = fx.brief(json!({ "tags": requested })).await;
        let (used, limit) = measured(&default);
        assert_eq!(tags(&default), requested, "{page}");
        assert!(used <= limit, "{page}");
        let whole = fx
            .brief_with_budget(json!({ "tags": requested }), 96_000)
            .await;
        let (whole_used, _) = measured(&whole);
        let api = fx
            .brief_with_budget(json!({ "tags": requested, "detail": "api" }), 96_000)
            .await;
        let (api_used, _) = measured(&api);
        assert_eq!(
            data(&api)["omitted"],
            json!([]),
            "{page}: the API alone shed something"
        );
        eprintln!(
            "fast_af: {page}: {} components, declarations {declarations}, half {target}; brief {used} at the default budget (omitted {}), {whole_used} at 96 000 (omitted {}), api {api_used}",
            requested.len(),
            data(&default)["omitted"],
            data(&whole)["omitted"],
        );
        assert_eq!(
            data(&whole)["omitted"]
                .as_array()
                .unwrap()
                .iter()
                .map(|entry| entry["reason"].as_str().unwrap())
                .collect::<Vec<_>>(),
            ["detail"],
            "{page}: the whole brief shed something to fit"
        );
        assert!(
            whole_used < declarations,
            "{page}: the whole brief, {whole_used}, is not smaller than {declarations}"
        );
        assert!(
            api_used <= target,
            "{page}: the API alone, {api_used}, is over {target}"
        );
    }
}

/// Criterion 7 with the real library: the override is space `main`'s alone; `beta` keeps the
/// example the plugin ships, and knows none of FAST-AF's tags.
#[tokio::test]
async fn the_override_is_its_space_s_alone() {
    let fx = fast_af_host().await;
    let asked = json!(["violet-button", "example-select"]);
    let own = fx.brief(json!({ "space": "main", "tags": asked })).await;
    assert_eq!(tags(&own), ["violet-button", "example-select"]);
    let other = fx.brief(json!({ "space": "beta", "tags": asked })).await;
    assert_eq!(tags(&other), ["example-select"]);
    assert_eq!(unknown_tags(&other), ["violet-button"]);
}

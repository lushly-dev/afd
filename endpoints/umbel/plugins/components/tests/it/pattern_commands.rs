//! `components-pattern-list` and `components-pattern-open` (amendments A31.2–A31.4, A31.6, A31.9):
//! Job 1 (`01-find-by-need`), Job 3 (`03-derive-an-implementation`), Job 9 (`09-stay-out-of-context`),
//! `default_library`, `minimum_basis`, pagination, budget fitting, and refusals.

use crate::support;
use serde_json::json;
use support::*;

/// Adds a second library `desktop` whose `desk-select` claims `example/select` with viewport
/// contexts and `out-of-context` on `pattern.select.fits-narrow` (Job 9 setup).
fn add_desktop_claiming_example_select(pack: &mut Pack) {
    let mut rec = record("desk-select", "Desktop-only select implementation.");
    rec["format"] = json!(2);
    rec["patterns"] = json!([{
        "library": "example",
        "pattern": "select",
        "contexts": {
            "viewport": { "minWidth": 1024 },
            "reason": "Used only in the desktop console."
        },
        "keep": [
            { "id": "pattern.select.named", "basis": "verified" },
            { "id": "pattern.select.escape-closes", "basis": "verified" },
            { "id": "pattern.select.fits-narrow", "basis": "out-of-context", "reason": "Used only in the desktop console." },
            { "id": "pattern.select.concise-labels", "basis": "ungated" }
        ]
    }]);
    pack.set_json("data/desktop/components/desk-select.json", &rec);
    pack.set_json(
        "rules/desktop.json",
        &json!({ "format": 2, "library": "desktop", "rules": [] }),
    );
    pack.set_json(
        "data/desktop/library.json",
        &json!({
            "format": 2,
            "library": "desktop",
            "title": "Desktop components",
            "package": { "name": "desktop-components", "version": "1.0.0" },
            "prefix": "desk-",
            "digest": "",
            "rules": "",
            "components": [{
                "tag": "desk-select",
                "summary": "Desktop-only select implementation.",
                "status": "stable",
                "digest": ""
            }],
            "patterns": [],
            "copies": []
        }),
    );
    pack.regenerate("desktop");
}

/// Builds a synthetic format 2 library with `count` patterns for pagination and budget tests.
fn add_synthetic_patterns(pack: &mut Pack, library: &str, count: usize) {
    let prefix = format!("{library}-");
    let mut patterns = Vec::new();
    for i in 0..count {
        let name = format!("pat-{i:03}");
        let summary = format!("Pattern {i:03} guides one reusable interaction region.");
        let mut pat = json!({
            "format": 2,
            "pattern": name,
            "summary": summary,
            "status": "stable",
            "scope": if i % 2 == 0 { "control" } else { "composition" },
            "facets": { "purpose": [format!("goal-{}", i % 3)] },
            "useWhen": [{ "id": format!("pat.{i:03}.use"), "text": "Use when this need arises." }],
            "avoidWhen": [{ "id": format!("pat.{i:03}.avoid"), "text": "Avoid otherwise." }],
            "keep": [{ "id": format!("pat.{i:03}.keep"), "text": "Keep this invariant." }],
            "customize": [{ "id": format!("pat.{i:03}.custom"), "text": "Customize freely." }],
            "setups": {},
            "gates": {},
            "implementations": []
        });
        pack.set_json(&format!("data/{library}/patterns/{name}.json"), &pat);
        patterns.push(json!({
            "pattern": name,
            "summary": pat["summary"].take(),
            "status": "stable",
            "scope": pat["scope"].take(),
            "facets": pat["facets"].take(),
            "digest": ""
        }));
    }
    pack.set_json(
        &format!("rules/{library}.json"),
        &json!({ "format": 2, "library": library, "rules": [] }),
    );
    pack.set_json(
        &format!("data/{library}/library.json"),
        &json!({
            "format": 2,
            "library": library,
            "title": format!("Synthetic patterns {library}"),
            "package": { "name": format!("{library}-patterns"), "version": "1.0.0" },
            "prefix": prefix,
            "digest": "",
            "rules": "",
            "components": [],
            "patterns": patterns,
            "copies": []
        }),
    );
    pack.regenerate(library);
}

#[tokio::test]
async fn job_01_find_by_need_filters_facets_words_and_returns_available_facets_on_miss() {
    let fx = Pack::example().host();

    // Step 1: need stated as a facet finds the pattern and its component implementation.
    let by_facet = fx
        .pattern_list(json!({ "facets": { "purpose": ["single-choice"] } }))
        .await;
    let d = data(&by_facet);
    assert_eq!(d["libraries"][0]["library"], "example");
    assert_eq!(d["libraries"][0]["patternCount"], 2);
    assert_eq!(d["content"]["trust"], "content");
    let patterns = d["content"]["patterns"].as_array().unwrap();
    assert_eq!(patterns.len(), 1);
    assert_eq!(patterns[0]["library"], "example");
    assert_eq!(patterns[0]["pattern"], "select");
    assert_eq!(patterns[0]["scope"], "control");
    assert_eq!(patterns[0]["implementations"].as_array().unwrap().len(), 1);
    assert_eq!(patterns[0]["implementations"][0]["library"], "example");
    assert_eq!(patterns[0]["implementations"][0]["kind"], "component");
    assert_eq!(patterns[0]["implementations"][0]["tag"], "example-select");
    assert_eq!(patterns[0]["implementations"][0]["linkage"], "instance");
    assert_eq!(patterns[0]["implementations"][0]["status"], "preview");
    // Filtered non-empty call omits availableFacets.
    assert!(d["content"].get("availableFacets").is_none());

    // Step 2: need in words + scope finds the matching pattern (case-insensitive).
    let by_words = fx
        .pattern_list(json!({ "contains": "SINGLE-LINE TEXT", "scope": "control" }))
        .await;
    let patterns = data(&by_words)["content"]["patterns"].as_array().unwrap();
    assert_eq!(patterns.len(), 1);
    assert_eq!(patterns[0]["pattern"], "field");
    assert_eq!(patterns[0]["implementations"][0]["tag"], "example-field");

    // Step 3: zero-match is a success with availableFacets so an agent sees valid facets.
    let miss = fx
        .pattern_list(json!({ "facets": { "purpose": ["show-a-trend"] } }))
        .await;
    let d = data(&miss);
    assert_eq!(d["content"]["patterns"], json!([]));
    assert_eq!(
        d["content"]["availableFacets"]["purpose"],
        json!(["single-choice", "text-entry"])
    );
    assert_eq!(
        d["content"]["availableFacets"]["structure"],
        json!(["inline", "popup"])
    );
    assert!(d["next"].is_null());

    // Unfiltered call also includes availableFacets and lists ascending by pattern.
    let all = fx.pattern_list(json!({})).await;
    let d = data(&all);
    let names: Vec<&str> = d["content"]["patterns"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["pattern"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["field", "select"]);
    assert!(d["content"]["availableFacets"].is_object());
}

#[tokio::test]
async fn pattern_list_ignores_default_library_and_aggregates_across_libraries() {
    let mut pack = Pack::example();
    add_desktop_claiming_example_select(&mut pack);
    let mut config = toml::Table::new();
    config.insert("default_library".to_owned(), "desktop".into());
    let fx = pack.host_with(config);

    // Omitting `library` ignores `default_library = "desktop"` and searches all libraries.
    let res = fx.pattern_list(json!({})).await;
    let d = data(&res);
    assert_eq!(d["libraries"].as_array().unwrap().len(), 2);
    let select = d["content"]["patterns"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["pattern"] == "select")
        .unwrap();
    // Owning library (`example`) precedes foreign library (`desktop`).
    let impls: Vec<(&str, &str)> = select["implementations"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| (i["library"].as_str().unwrap(), i["tag"].as_str().unwrap()))
        .collect();
    assert_eq!(
        impls,
        [("example", "example-select"), ("desktop", "desk-select")]
    );

    // Passing `library: "desktop"` touches only `desktop` (which owns 0 patterns).
    let desktop_only = fx.pattern_list(json!({ "library": "desktop" })).await;
    assert_eq!(
        data(&desktop_only)["libraries"].as_array().unwrap().len(),
        1
    );
    assert_eq!(data(&desktop_only)["content"]["patterns"], json!([]));
}

#[tokio::test]
async fn pattern_list_pages_with_budget_and_qualified_cursors() {
    let mut pack = Pack::default();
    add_synthetic_patterns(&mut pack, "alpha", 12);
    add_synthetic_patterns(&mut pack, "beta", 12);
    let fx = pack.host();

    let mut seen: Vec<(String, String)> = Vec::new();
    let mut input = json!({});
    let mut pages = 0;
    loop {
        pages += 1;
        let res = fx.pattern_list_with_budget(input.clone(), 4000).await;
        let d = data(&res);
        for item in d["content"]["patterns"].as_array().unwrap() {
            seen.push((
                item["library"].as_str().unwrap().to_owned(),
                item["pattern"].as_str().unwrap().to_owned(),
            ));
        }
        let next = &d["next"];
        if next.is_null() {
            break;
        }
        let cursor = next["after"].as_str().unwrap();
        assert!(
            cursor.contains('/'),
            "multi-library cursor must be qualified: {cursor}"
        );
        input = json!({ "after": cursor });
        assert!(pages < 30, "pagination did not terminate");
    }
    assert!(pages > 1, "expected multiple pages");
    assert_eq!(seen.len(), 24);
    let mut sorted = seen.clone();
    sorted.sort();
    sorted.dedup();
    assert_eq!(seen, sorted);
}

#[tokio::test]
async fn job_03_and_job_09_pattern_open_returns_guidance_gates_and_out_of_context_implementations()
{
    let mut pack = Pack::example();
    add_desktop_claiming_example_select(&mut pack);
    let fx = pack.host();

    // Job 3: open all default sections.
    let opened = fx
        .pattern_open(json!({
            "library": "example",
            "pattern": "select",
            "sections": ["keep", "customize", "setups", "gates", "implementations"]
        }))
        .await;
    let d = data(&opened);
    assert_eq!(d["content"]["trust"], "content");
    // Envelope carries both owning (`example`) and contributing (`desktop`) libraries in library order.
    let lib_ids: Vec<&str> = d["libraries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|l| l["library"].as_str().unwrap())
        .collect();
    assert_eq!(lib_ids, ["desktop", "example"]);
    let pat = &d["content"]["pattern"];
    assert_eq!(pat["library"], "example");
    assert_eq!(pat["pattern"], "select");
    assert_eq!(pat["keep"][0]["id"], "pattern.select.named");
    assert_eq!(pat["keep"][0]["gate"], "named");
    assert_eq!(pat["customize"][0]["id"], "pattern.select.option-order");
    assert!(pat["setups"]["default"]["text"].is_string());
    assert_eq!(pat["gates"]["named"]["setup"], "default");

    // Job 9: cross-library aggregation with owning library first, preserving contexts & out-of-context.
    let impls = pat["implementations"].as_array().unwrap();
    assert_eq!(impls.len(), 2);
    assert_eq!(impls[0]["library"], "example");
    assert_eq!(impls[0]["tag"], "example-select");
    assert_eq!(impls[0]["keep"][0]["id"], "pattern.select.named");
    assert_eq!(impls[0]["keep"][0]["basis"], "verified");
    assert_eq!(impls[1]["library"], "desktop");
    assert_eq!(impls[1]["tag"], "desk-select");
    assert_eq!(impls[1]["contexts"]["viewport"]["minWidth"], 1024);
    assert_eq!(
        impls[1]["contexts"]["reason"],
        "Used only in the desktop console."
    );
    assert_eq!(impls[1]["keep"][2]["id"], "pattern.select.fits-narrow");
    assert_eq!(impls[1]["keep"][2]["basis"], "out-of-context");
    assert_eq!(
        impls[1]["keep"][2]["reason"],
        "Used only in the desktop console."
    );
    assert_eq!(d["omitted"], json!([]));

    // `implementation` filter narrows to one entry (bare or qualified) and trims `libraries` envelope.
    let filtered = fx
        .pattern_open(json!({
            "library": "example",
            "pattern": "select",
            "sections": ["implementations"],
            "implementation": "desktop/desk-select"
        }))
        .await;
    let impls = data(&filtered)["content"]["pattern"]["implementations"]
        .as_array()
        .unwrap();
    assert_eq!(impls.len(), 1);
    assert_eq!(impls[0]["tag"], "desk-select");

    let keep_only = fx
        .pattern_open(json!({
            "library": "example",
            "pattern": "select",
            "sections": ["keep"]
        }))
        .await;
    let lib_ids: Vec<&str> = data(&keep_only)["libraries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|l| l["library"].as_str().unwrap())
        .collect();
    assert_eq!(lib_ids, ["example"]);
}

#[tokio::test]
async fn minimum_basis_omits_authored_pattern_text_while_keeping_out_of_context_visible() {
    let mut pack = Pack::example();
    add_desktop_claiming_example_select(&mut pack);
    let mut config = toml::Table::new();
    config.insert("minimum_basis".to_owned(), "observed".into());
    let fx = pack.host_with(config);

    let opened = fx
        .pattern_open(json!({ "library": "example", "pattern": "select" }))
        .await;
    let d = data(&opened);
    let pat = &d["content"]["pattern"];
    // Authored text omitted: useWhen, avoidWhen, customize, ungated keep.
    assert!(pat.get("useWhen").is_none());
    assert!(pat.get("avoidWhen").is_none());
    assert!(pat.get("customize").is_none());
    let keep_ids: Vec<&str> = pat["keep"]
        .as_array()
        .unwrap()
        .iter()
        .map(|k| k["id"].as_str().unwrap())
        .collect();
    assert_eq!(
        keep_ids,
        [
            "pattern.select.named",
            "pattern.select.escape-closes",
            "pattern.select.fits-narrow"
        ]
    );

    // Out-of-context stays visible on `desktop/desk-select` with its reason, while `ungated` is omitted.
    let desk = &pat["implementations"][1];
    assert_eq!(desk["tag"], "desk-select");
    assert!(desk["contexts"]["reason"].is_string());
    let desk_keeps: Vec<(&str, &str)> = desk["keep"]
        .as_array()
        .unwrap()
        .iter()
        .map(|k| (k["id"].as_str().unwrap(), k["basis"].as_str().unwrap()))
        .collect();
    assert_eq!(
        desk_keeps,
        [
            ("pattern.select.named", "verified"),
            ("pattern.select.escape-closes", "verified"),
            ("pattern.select.fits-narrow", "out-of-context"),
        ]
    );
    assert!(desk["keep"][2]["reason"].is_string());

    // `omitted` records `minimum-basis` fact count.
    let omitted = d["omitted"].as_array().unwrap();
    assert_eq!(omitted[0]["reason"], "minimum-basis");
    // 1 useWhen + 1 avoidWhen + 1 ungated keep + 1 customize + 2 ungated impl keep entries = 6
    assert_eq!(omitted[0]["facts"], 6);
}

#[tokio::test]
async fn pattern_open_pages_gates_in_key_order_and_fits_budget_with_callable_omitted() {
    let fx = Pack::example().host();

    // `gates` on `example/select` are `escape-closes`, `fits-narrow`, `named` (ascending ASCII key order).
    let skipped = fx
        .pattern_open(json!({
            "library": "example",
            "pattern": "select",
            "sections": ["gates"],
            "skip": 1
        }))
        .await;
    let keys: Vec<&str> = data(&skipped)["content"]["pattern"]["gates"]
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(keys, ["fits-narrow", "named"]);

    // Skip past the end omits `gates` cleanly with empty `omitted`.
    let past_end = fx
        .pattern_open(json!({
            "library": "example",
            "pattern": "select",
            "sections": ["gates"],
            "skip": 10
        }))
        .await;
    assert!(data(&past_end)["content"]["pattern"].get("gates").is_none());
    assert_eq!(data(&past_end)["omitted"], json!([]));

    // Tight budget sheds trailing sections and emits a directly callable `omitted[].open`.
    let tight = fx
        .pattern_open_with_budget(json!({ "library": "example", "pattern": "select" }), 2400)
        .await;
    let d = data(&tight);
    let omitted = d["omitted"].as_array().unwrap();
    assert!(!omitted.is_empty(), "expected budget shedding: {tight}");
    assert_eq!(omitted[0]["reason"], "budget");
    assert_eq!(omitted[0]["open"]["command"], "components-pattern-open");
    assert_eq!(omitted[0]["open"]["library"], "example");
    assert_eq!(omitted[0]["open"]["pattern"], "select");
    assert!(omitted[0]["open"]["sections"].as_array().is_some());

    // Tight budget on `gates` alone triggers partial pagination with `skip`.
    // Full `gates` response is ~1 579 bytes, so 1 500 bytes fits a prefix and paginates the rest.
    let gates_paged = fx
        .pattern_open_with_budget(
            json!({ "library": "example", "pattern": "select", "sections": ["gates"] }),
            1500,
        )
        .await;
    let d = data(&gates_paged);
    let served_gates = d["content"]["pattern"]["gates"].as_object().unwrap().len();
    assert!(
        (1..3).contains(&served_gates),
        "served {served_gates}: {gates_paged}"
    );
    let omitted = d["omitted"].as_array().unwrap();
    assert_eq!(omitted[0]["reason"], "budget");
    assert_eq!(omitted[0]["sections"], json!(["gates"]));
    assert_eq!(omitted[0]["skip"], served_gates);
    assert_eq!(omitted[0]["open"]["skip"], served_gates);

    // Follow the emitted `omitted[0].open` call to retrieve the remaining gates.
    let rest = fx
        .pattern_open(json!({
            "library": omitted[0]["open"]["library"],
            "pattern": omitted[0]["open"]["pattern"],
            "sections": omitted[0]["open"]["sections"],
            "skip": omitted[0]["open"]["skip"],
        }))
        .await;
    let rest_gates = data(&rest)["content"]["pattern"]["gates"]
        .as_object()
        .unwrap()
        .len();
    assert_eq!(served_gates + rest_gates, 3);
    assert_eq!(data(&rest)["omitted"], json!([]));

    // `skip` on `implementations` slices in owning-library-first order.
    let mut multi = Pack::example();
    add_desktop_claiming_example_select(&mut multi);
    let multi_fx = multi.host();
    let second_impl = multi_fx
        .pattern_open(json!({
            "library": "example",
            "pattern": "select",
            "sections": ["implementations"],
            "skip": 1
        }))
        .await;
    let impls = data(&second_impl)["content"]["pattern"]["implementations"]
        .as_array()
        .unwrap();
    assert_eq!(impls.len(), 1);
    assert_eq!(impls[0]["library"], "desktop");
    assert_eq!(impls[0]["tag"], "desk-select");
}

#[tokio::test]
async fn pattern_open_failures_and_input_validation() {
    let mut pack = Pack::example();
    pack.copy_example_as("zed");
    let fx = pack.host();

    // Ambiguous pattern across two libraries.
    let amb = fx.pattern_open(json!({ "pattern": "select" })).await;
    assert_eq!(code(&amb), "PATTERN_AMBIGUOUS");
    assert_eq!(amb["error"]["details"]["pattern"], "select");
    assert_eq!(
        amb["error"]["details"]["libraries"],
        json!(["example", "zed"])
    );

    // Disambiguated by `default_library`.
    let mut config = toml::Table::new();
    config.insert("default_library".to_owned(), "zed".into());
    let resolved = pack
        .host_with(config)
        .pattern_open(json!({ "pattern": "select" }))
        .await;
    assert_eq!(data(&resolved)["content"]["pattern"]["library"], "zed");

    // Unknown pattern reports nearest ids and suggests `components-pattern-list`.
    let missing = fx.pattern_open(json!({ "pattern": "selct" })).await;
    assert_eq!(code(&missing), "PATTERN_NOT_FOUND");
    assert_eq!(missing["error"]["details"]["pattern"], "selct");
    assert_eq!(missing["error"]["details"]["nearest"], json!(["select"]));
    assert!(
        missing["error"]["suggestion"]
            .as_str()
            .unwrap()
            .contains("components-pattern-list")
    );

    // Invalid inputs refused as COMPONENTS_INVALID without echoing caller strings.
    for bad_open in [
        json!({ "pattern": "Not A Pattern" }),
        json!({ "pattern": "select", "sections": ["keep", "keep"] }),
        json!({ "pattern": "select", "skip": 1 }),
        json!({ "pattern": "select", "sections": ["keep"], "skip": 1 }),
        json!({ "pattern": "select", "sections": ["gates", "implementations"], "skip": 1 }),
        json!({ "pattern": "select", "implementation": "Bad Impl" }),
    ] {
        let res = fx.pattern_open(bad_open).await;
        assert_eq!(code(&res), "COMPONENTS_INVALID", "{res}");
    }

    for bad_list in [
        json!({ "library": "Bad Lib" }),
        json!({ "facets": { "Bad Key": ["ok"] } }),
        json!({ "facets": { "purpose": ["Bad Value"] } }),
        json!({ "facets": {
            "a": ["x"], "b": ["x"], "c": ["x"], "d": ["x"],
            "e": ["x"], "f": ["x"], "g": ["x"], "h": ["x"], "i": ["x"]
        } }),
        json!({ "after": "not valid cursor" }),
    ] {
        let res = fx.pattern_list(bad_list).await;
        assert_eq!(code(&res), "COMPONENTS_INVALID", "{res}");
    }

    // Slice 1 schema refuses `sections: ["source"]` cleanly (not silently dropped).
    let src_err = fx
        .pattern_open(json!({ "library": "example", "pattern": "select", "sections": ["source"] }))
        .await;
    assert_eq!(src_err["success"], false, "{src_err}");
}

#[tokio::test]
async fn pattern_commands_edge_cases_format_1_facets_minimum_basis_verified_and_budget() {
    // Format 1 library: empty pattern list + availableFacets: {}, PATTERN_NOT_FOUND on open.
    let mut f1 = Pack::default();
    f1.add_synthetic("legacy", 2);
    let f1_fx = f1.host();
    let listed = f1_fx.pattern_list(json!({})).await;
    assert_eq!(data(&listed)["libraries"][0]["patternCount"], 0);
    assert_eq!(data(&listed)["content"]["patterns"], json!([]));
    assert_eq!(data(&listed)["content"]["availableFacets"], json!({}));
    let opened = f1_fx.pattern_open(json!({ "pattern": "select" })).await;
    assert_eq!(code(&opened), "PATTERN_NOT_FOUND");

    // Multi-key AND / multi-value OR facets, and empty `facets: {}` treated as unfiltered.
    let fx = Pack::example().host();
    let empty_facets = fx.pattern_list(json!({ "facets": {} })).await;
    assert_eq!(
        data(&empty_facets)["content"]["patterns"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert!(data(&empty_facets)["content"]["availableFacets"].is_object());

    let multi = fx
        .pattern_list(json!({
            "facets": {
                "purpose": ["single-choice", "show-a-trend"],
                "structure": ["popup"]
            }
        }))
        .await;
    assert_eq!(
        data(&multi)["content"]["patterns"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(data(&multi)["content"]["patterns"][0]["pattern"], "select");

    let and_miss = fx
        .pattern_list(json!({
            "facets": { "purpose": ["single-choice"], "structure": ["inline"] }
        }))
        .await;
    assert_eq!(data(&and_miss)["content"]["patterns"], json!([]));
    assert!(data(&and_miss)["content"]["availableFacets"].is_object());

    // `sections: []` returns floor only, and `skip: 0` on empty implementations keeps `[]`.
    let floor_only = fx
        .pattern_open(json!({ "library": "example", "pattern": "select", "sections": [] }))
        .await;
    let pat = &data(&floor_only)["content"]["pattern"];
    assert_eq!(pat["pattern"], "select");
    assert!(pat.get("keep").is_none());
    assert!(pat.get("implementations").is_none());

    let skip_zero_empty = fx
        .pattern_open(json!({
            "library": "example",
            "pattern": "select",
            "sections": ["implementations"],
            "implementation": "nonexistent-tag",
            "skip": 0
        }))
        .await;
    assert_eq!(
        data(&skip_zero_empty)["content"]["pattern"]["implementations"],
        json!([])
    );

    // Fits-whole-before-Take::Sections(0): when the whole response is smaller than Take::Sections(0)'s
    // `omitted` block (e.g. `implementations: []`), a budget matching the whole size succeeds.
    let whole_bytes = result_bytes(&skip_zero_empty) as u64;
    let exact_fit = fx
        .pattern_open_with_budget(
            json!({
                "library": "example",
                "pattern": "select",
                "sections": ["implementations"],
                "implementation": "nonexistent-tag"
            }),
            whole_bytes,
        )
        .await;
    assert_eq!(exact_fit["success"], true, "{exact_fit}");

    // Tiny budget refuses with OUTPUT_BUDGET_EXCEEDED on both commands.
    let too_small_open = fx
        .pattern_open_with_budget(json!({ "library": "example", "pattern": "select" }), 200)
        .await;
    assert_eq!(code(&too_small_open), "OUTPUT_BUDGET_EXCEEDED");
    let too_small_list = fx.pattern_list_with_budget(json!({}), 100).await;
    assert_eq!(code(&too_small_list), "OUTPUT_BUDGET_EXCEEDED");

    // `minimum_basis = "verified"` still keeps `out-of-context` + `reason` + `contexts` visible.
    let mut multi_pack = Pack::example();
    add_desktop_claiming_example_select(&mut multi_pack);
    let mut verified_cfg = toml::Table::new();
    verified_cfg.insert("minimum_basis".to_owned(), "verified".into());
    let verified_fx = multi_pack.host_with(verified_cfg);
    let verified_open = verified_fx
        .pattern_open(json!({ "library": "example", "pattern": "select" }))
        .await;
    let desk = &data(&verified_open)["content"]["pattern"]["implementations"][1];
    assert_eq!(desk["tag"], "desk-select");
    assert_eq!(desk["keep"][2]["basis"], "out-of-context");
    assert!(desk["keep"][2]["reason"].is_string());
    assert!(desk["contexts"]["reason"].is_string());

    // `LIBRARY_NOT_FOUND` on explicit unknown library.
    let missing_lib = verified_fx
        .pattern_open(json!({ "library": "absent", "pattern": "select" }))
        .await;
    assert_eq!(code(&missing_lib), "LIBRARY_NOT_FOUND");
}

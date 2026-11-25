//! Patterns in `components-brief` and `components-open` (amendments A31.5, A31.6, A31.8):
//! Job 2 (`02-brief-with-patterns`), compact links with `out-of-context` preservation,
//! cross-library pattern ownership in `libraries`, `known` pattern statement ids, `detail: "api"`,
//! `minimum_basis`, Phase 0.4 shedding order (Step 5b `patternCustomize`, Step 10b `patternKeep`,
//! Step 13 `patterns`), and `render: "text"` quoting.

use crate::support;
use serde_json::{Value, json};
use support::*;

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

#[tokio::test]
async fn job_02_brief_with_patterns_compact_links_dedup_and_known() {
    // Step 1: two components of two patterns -> compact string links and two content.patterns entries.
    let fx = Pack::example().host();
    let two = fx
        .brief(json!({ "tags": ["example-select", "example-field"] }))
        .await;
    let d = data(&two);
    assert_eq!(d["content"]["trust"], "content");
    assert_eq!(d["unknown"], json!([]));
    assert_eq!(entry(&two, "example-select")["patterns"], json!(["select"]));
    assert_eq!(entry(&two, "example-field")["patterns"], json!(["field"]));
    let pats = d["content"]["patterns"].as_array().unwrap();
    assert_eq!(pats.len(), 2);
    // First-referenced order: select, then field.
    assert_eq!(pats[0]["library"], "example");
    assert_eq!(pats[0]["pattern"], "select");
    assert_eq!(pats[1]["library"], "example");
    assert_eq!(pats[1]["pattern"], "field");

    // Step 2: two components implementing the SAME pattern bring its statements once.
    let mut pack = Pack::example();
    let select_patterns = pack.json(&record_path("select"))["patterns"].clone();
    pack.edit(&record_path("dropdown"), |rec| {
        rec["patterns"] = select_patterns;
    });
    pack.regenerate("example");
    let dedup_fx = pack.host();
    let shared = dedup_fx
        .brief(json!({ "tags": ["example-select", "example-dropdown"] }))
        .await;
    let pats = data(&shared)["content"]["patterns"].as_array().unwrap();
    assert_eq!(pats.len(), 1);
    assert_eq!(pats[0]["library"], "example");
    assert_eq!(pats[0]["pattern"], "select");
    assert_eq!(pats[0]["keep"][0]["id"], "pattern.select.named");
    assert!(pats[0]["keep"][0]["text"].is_string());
    assert_eq!(pats[0]["customize"][0]["id"], "pattern.select.option-order");
    assert!(pats[0]["customize"][0]["text"].is_string());

    // Step 3: `known` omits `text` without losing `id` (both qualified and bare in single-library brief).
    let with_known = fx
        .brief(json!({
            "tags": ["example-select"],
            "known": ["example/pattern.select.named", "pattern.select.option-order"]
        }))
        .await;
    let pat = &data(&with_known)["content"]["patterns"][0];
    assert_eq!(pat["keep"][0]["id"], "pattern.select.named");
    assert!(pat["keep"][0].get("text").is_none());
    assert!(pat["keep"][1]["text"].is_string());
    assert_eq!(pat["customize"][0]["id"], "pattern.select.option-order");
    assert!(pat["customize"][0].get("text").is_none());
    // `known` statements are never recorded in `omitted`.
    assert!(
        !data(&with_known)["omitted"]
            .to_string()
            .contains("pattern.select.named")
    );
}

#[tokio::test]
async fn cross_library_pattern_owner_joins_envelope_and_out_of_context_uses_object_link() {
    let mut pack = Pack::example();
    add_desktop_claiming_example_select(&mut pack);
    let fx = pack.host();

    // Briefing `desk-select` alone pulls cross-library owner `example` into `libraries` and
    // emits the object link form preserving `contexts` and `outOfContext`.
    let single = fx.brief(json!({ "tags": ["desk-select"] })).await;
    let lib_ids: Vec<&str> = data(&single)["libraries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|l| l["library"].as_str().unwrap())
        .collect();
    assert_eq!(lib_ids, ["desktop", "example"]);
    let link = &entry(&single, "desk-select")["patterns"][0];
    assert_eq!(link["pattern"], "example/select");
    assert_eq!(link["contexts"]["viewport"]["minWidth"], 1024);
    assert_eq!(
        link["outOfContext"],
        json!([{
            "id": "pattern.select.fits-narrow",
            "reason": "Used only in the desktop console."
        }])
    );
    assert_eq!(data(&single)["content"]["patterns"][0]["pattern"], "select");

    // Multi-library brief qualifies same-library compact links too (`example/select`).
    let both = fx
        .brief(json!({ "tags": ["example-select", "desk-select"] }))
        .await;
    assert_eq!(
        entry(&both, "example-select")["patterns"],
        json!(["example/select"])
    );
    assert_eq!(
        entry(&both, "desk-select")["patterns"][0]["pattern"],
        "example/select"
    );
    assert_eq!(
        data(&both)["content"]["patterns"].as_array().unwrap().len(),
        1
    );

    // `minimum_basis = "verified"` omits authored pattern text (`customize` + ungated `keep`)
    // while keeping `outOfContext` + `reason` + `contexts` visible on `desk-select`.
    let mut cfg = toml::Table::new();
    cfg.insert("minimum_basis".to_owned(), "verified".into());
    let verified_fx = pack.host_with(cfg);
    let strict = verified_fx.brief(json!({ "tags": ["desk-select"] })).await;
    let link = &entry(&strict, "desk-select")["patterns"][0];
    assert_eq!(link["outOfContext"][0]["id"], "pattern.select.fits-narrow");
    assert!(link["outOfContext"][0]["reason"].is_string());
    assert!(link["contexts"]["reason"].is_string());
    let pat = &data(&strict)["content"]["patterns"][0];
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
    let min_basis = data(&strict)["omitted"]
        .as_array()
        .unwrap()
        .iter()
        .find(|o| o["reason"] == "minimum-basis")
        .unwrap();
    // 1 ungated keep + 1 customize = 2 pattern facts omitted (desk-select itself has 0 component facts below verified).
    assert_eq!(min_basis["facts"], 2);
}

#[tokio::test]
async fn phase_04_shedding_order_sheds_customize_before_usage_and_keep_after_rule_text() {
    // Give `select` three customize statements so Step 5b shrinks total bytes more than the
    // callable per-pattern `omitted` entry it adds, letting the sweep land squarely on Step 5b.
    let mut pack = Pack::example();
    pack.edit("data/example/patterns/select.json", |pat| {
        pat["customize"] = json!([
            {
                "id": "pattern.select.option-order",
                "text": "Order options by the user's most likely choice or natural sequence so common choices appear first."
            },
            {
                "id": "pattern.select.width",
                "text": "Size the trigger to the longest expected option label without forcing truncation on standard viewports."
            },
            {
                "id": "pattern.select.placeholder",
                "text": "Provide a neutral prompt when no option is preselected so the user knows a choice is required."
            }
        ]);
    });
    pack.regenerate("example");
    let fx = pack.host();
    let full = fx
        .brief(json!({ "tags": ["example-select", "example-field"], "detail": "full" }))
        .await;
    let full_bytes = result_bytes(&full);

    let mut saw_customize_before_usage = false;
    let mut saw_keep_after_rule_text_before_a11y = false;
    let mut saw_step_13_patterns_link_shed = false;

    let mut target = full_bytes.saturating_sub(20);
    while target >= 1_024 {
        let res = fx
            .brief(json!({
                "tags": ["example-select", "example-field"],
                "detail": "full",
                "maxBytes": target
            }))
            .await;
        if res["success"] == false {
            break;
        }
        assert!(result_bytes(&res) <= target);
        let d = data(&res);
        let omitted = d["omitted"].as_array().unwrap();
        let comp_omitted = omitted
            .iter()
            .find(|o| o["reason"] == "budget" && o.get("pattern").is_none());
        let pat_omitted: Vec<&Value> = omitted
            .iter()
            .filter(|o| o["reason"] == "budget" && o.get("pattern").is_some())
            .collect();

        let comp_sections: Vec<&str> = comp_omitted
            .and_then(|o| o["sections"].as_array())
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .collect();
        let comp_pieces: Vec<&str> = comp_omitted
            .and_then(|o| o["pieces"].as_array())
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .collect();

        let customize_shed = pat_omitted.iter().any(|o| {
            o["pieces"]
                .as_array()
                .is_some_and(|p| p.contains(&json!("patternCustomize")))
        });
        let keep_shed = pat_omitted.iter().any(|o| {
            o["pieces"]
                .as_array()
                .is_some_and(|p| p.contains(&json!("patternKeep")))
        });

        // Invariant: if `usage` is shed, `patternCustomize` MUST already be shed.
        if comp_sections.contains(&"usage") {
            assert!(
                customize_shed,
                "usage shed before patternCustomize at {target}: {omitted:?}"
            );
        }
        // Invariant: if `patternCustomize` is shed and `usage` is NOT yet shed, `declaredAttributes` is already shed.
        if customize_shed && !comp_sections.contains(&"usage") {
            assert!(
                comp_pieces.contains(&"declaredAttributes"),
                "patternCustomize shed before declaredAttributes at {target}: {omitted:?}"
            );
            saw_customize_before_usage = true;
            // Verify per-pattern entry is directly callable via `components-pattern-open`.
            let open_spec = &pat_omitted[0]["open"];
            assert_eq!(open_spec["command"], "components-pattern-open");
            assert_eq!(open_spec["sections"], json!(["customize"]));
            let recovered = fx
                .pattern_open(json!({
                    "library": open_spec["library"],
                    "pattern": open_spec["pattern"],
                    "sections": open_spec["sections"],
                }))
                .await;
            assert_eq!(recovered["success"], true, "{recovered}");
        }

        // Invariant: if `a11y` is shed, `patternKeep` MUST already be shed.
        if comp_sections.contains(&"a11y") {
            assert!(
                keep_shed,
                "a11y shed before patternKeep at {target}: {omitted:?}"
            );
        }
        // Invariant: if `patternKeep` is shed and `a11y` is NOT yet shed, `ruleText` is already shed and component `patterns` links stay.
        if keep_shed && !comp_sections.contains(&"a11y") {
            assert!(
                comp_pieces.contains(&"ruleText"),
                "patternKeep shed before ruleText at {target}: {omitted:?}"
            );
            assert!(d["content"].get("patterns").is_none());
            assert!(entry(&res, "example-select").get("patterns").is_some());
            saw_keep_after_rule_text_before_a11y = true;
        }

        // Step 13 sheds component `patterns` links and names `"patterns"` for `components-open`.
        if comp_sections.contains(&"patterns") {
            assert!(entry(&res, "example-select").get("patterns").is_none());
            let open_secs = comp_omitted.unwrap()["open"]["sections"]
                .as_array()
                .unwrap();
            assert!(open_secs.contains(&json!("patterns")));
            // Recover via `components-open { sections: ["patterns"] }`.
            let opened = fx
                .open(json!({ "tag": "example-select", "sections": ["patterns"] }))
                .await;
            assert_eq!(
                data(&opened)["content"]["component"]["patterns"],
                json!(["select"])
            );
            saw_step_13_patterns_link_shed = true;
        }

        target = target.saturating_sub(30);
    }

    assert!(
        saw_customize_before_usage,
        "never observed Step 5b before usage"
    );
    assert!(
        saw_keep_after_rule_text_before_a11y,
        "never observed Step 10b after ruleText and before a11y"
    );
    assert!(
        saw_step_13_patterns_link_shed,
        "never observed Step 13 shedding component patterns links"
    );
}

#[tokio::test]
async fn render_text_quotes_out_of_context_patterns_and_omitted_pattern_open() {
    let mut pack = Pack::example();
    add_desktop_claiming_example_select(&mut pack);
    let fx = pack.host();

    let text_res = fx
        .brief(json!({
            "tags": ["desk-select"],
            "known": ["example/pattern.select.named"],
            "render": "text"
        }))
        .await;
    let block = data(&text_res)["text"].as_str().unwrap();
    assert!(block.contains("[patterns example/select]\n"), "{block}");
    assert!(
        block.contains("> example/select contexts: Used only in the desktop console.\n"),
        "{block}"
    );
    assert!(
        block.contains(
            "> pattern.select.fits-narrow (out-of-context): Used only in the desktop console.\n"
        ),
        "{block}"
    );
    assert!(
        block.contains("[pattern example/select stable]\n"),
        "{block}"
    );
    assert!(
        block.contains("> keep pattern.select.named: (known)\n"),
        "{block}"
    );
    assert!(
        block.contains("> customize pattern.select.option-order: "),
        "{block}"
    );

    // `detail: "api"` with `render: "text"` emits `components-pattern-open` in omitted header.
    let api_text = fx
        .brief(json!({
            "tags": ["example-select"],
            "detail": "api",
            "render": "text"
        }))
        .await;
    let block = data(&api_text)["text"].as_str().unwrap();
    assert!(
        block.contains("[left out of a brief: example/select (patterns); components-pattern-open returns them]\n"),
        "{block}"
    );
}

#[tokio::test]
async fn brief_patterns_edge_cases_deprecated_multi_known_api_open_skip_and_consumer_render() {
    // 1. Deprecated pattern (`replacedBy`) in JSON and `render: "text"`.
    let mut dep = Pack::example();
    dep.edit("data/example/patterns/select.json", |pat| {
        pat["status"] = json!("deprecated");
        pat["replacedBy"] = json!("field");
    });
    dep.edit("data/example/library.json", |cat| {
        for pat in cat["patterns"].as_array_mut().unwrap() {
            if pat["pattern"] == "select" {
                pat["status"] = json!("deprecated");
                pat["replacedBy"] = json!("field");
            }
        }
    });
    dep.regenerate("example");
    let dep_fx = dep.host();
    let dep_json = dep_fx.brief(json!({ "tags": ["example-select"] })).await;
    assert_eq!(
        data(&dep_json)["content"]["patterns"][0]["status"],
        "deprecated"
    );
    assert_eq!(
        data(&dep_json)["content"]["patterns"][0]["replacedBy"],
        "field"
    );
    let dep_text = dep_fx
        .brief(json!({ "tags": ["example-select"], "render": "text" }))
        .await;
    assert!(
        data(&dep_text)["text"]
            .as_str()
            .unwrap()
            .contains("[pattern example/select deprecated replaced-by field]\n")
    );

    // 2. Multi-library `known`: bare pattern statement id matches nothing; `<lib>/<id>` matches.
    let mut multi = Pack::example();
    add_desktop_claiming_example_select(&mut multi);
    let multi_fx = multi.host();
    let known_multi = multi_fx
        .brief(json!({
            "tags": ["example-select", "desk-select"],
            "known": ["pattern.select.named", "example/pattern.select.escape-closes"]
        }))
        .await;
    let keep = data(&known_multi)["content"]["patterns"][0]["keep"]
        .as_array()
        .unwrap();
    assert!(
        keep[0]["text"].is_string(),
        "bare id must not match in multi-library brief"
    );
    assert!(
        keep[1].get("text").is_none(),
        "qualified id must match in multi-library brief"
    );

    // 3. Cross-library `desk-select` under `detail: "api"` omits `example` from `libraries`
    //    because `content.patterns` is omitted, while `sections: ["patterns"]` overrides `detail: "api"`.
    let api_cross = multi_fx
        .brief(json!({ "tags": ["desk-select"], "detail": "api" }))
        .await;
    assert_eq!(
        data(&api_cross)["libraries"]
            .as_array()
            .unwrap()
            .iter()
            .map(|l| l["library"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["desktop"]
    );
    assert!(data(&api_cross)["content"].get("patterns").is_none());
    assert_eq!(data(&api_cross)["omitted"][0]["reason"], "detail");
    assert_eq!(data(&api_cross)["omitted"][0]["pattern"], "example/select");

    let override_api = multi_fx
        .brief(json!({
            "tags": ["desk-select"],
            "detail": "api",
            "sections": ["patterns"]
        }))
        .await;
    assert_eq!(
        data(&override_api)["content"]["patterns"][0]["pattern"],
        "select"
    );

    // 4. `components-open` with `sections: ["patterns"]` on `desk-select` preserves `outOfContext`
    //    and supports `skip` pagination on a multi-pattern component.
    let open_desk = multi_fx
        .open(json!({ "tag": "desk-select", "sections": ["patterns"] }))
        .await;
    assert_eq!(
        data(&open_desk)["content"]["component"]["patterns"][0]["outOfContext"][0]["id"],
        "pattern.select.fits-narrow"
    );

    let mut two_pat = Pack::example();
    let field_pat = two_pat.json(&record_path("field"))["patterns"][0].clone();
    two_pat.edit(&record_path("select"), |rec| {
        // Canonical order on `patterns` is ascending by `(library, pattern)`: `field` before `select`.
        rec["patterns"].as_array_mut().unwrap().insert(0, field_pat);
    });
    two_pat.regenerate("example");
    let skipped = two_pat
        .host()
        .open(json!({ "tag": "example-select", "sections": ["patterns"], "skip": 1 }))
        .await;
    assert_eq!(
        data(&skipped)["content"]["component"]["patterns"],
        json!(["select"])
    );

    // 5. Consumer omission alongside pattern omission in `render: "text"` emits no bogus
    //    `[left out to fit: ; components-open returns them]` header.
    let consumers = json!({
        "version": 1,
        "consumers": {
            "app": { "exclude_rules": ["example/field.labelling"] }
        }
    });
    let cons_fx = Pack::example().host_with_consumers(consumers);
    let cons_text = cons_fx
        .brief(json!({
            "tags": ["example-select"],
            "consumer": "app",
            "detail": "api",
            "render": "text"
        }))
        .await;
    let block = data(&cons_text)["text"].as_str().unwrap();
    assert!(
        block.contains("[omitted consumer app example/field.labelling]\n"),
        "{block}"
    );
    assert!(
        block.contains("[left out of a brief: example/select (patterns); components-pattern-open returns them]\n"),
        "{block}"
    );
    assert!(
        !block.contains("[left out to fit: ; components-open returns them]"),
        "consumer omission fell through: {block}"
    );
}

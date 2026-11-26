//! Agent-First Design Phase B3 (#2560): `approvalStatus`, `includeProposed`, `derivedFrom`,
//! `patterns[]` on `components-brief`, and compiled `patternBindings` in Pack Format 2
//! (`library.json`) and `consumers.json` (version 3), verified against Scenarios 02, 06 (steps
//! 4 & 6), and 09 (step 2) using the bundled `afd-defaults@1.0.0` Pack Format 2 library.

use std::path::Path;

use crate::support;
use serde_json::{Value, json};
use support::*;

fn afd_defaults_pack_dir() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../../foundations/specimen/defaults/pack")
}

/// Loads `Pack::example()` plus the real bundled `afd-defaults@1.0.0` Pack Format 2 library.
fn pack_with_afd_defaults() -> Pack {
    let mut pack = Pack::example();
    for (rel, bytes) in read_tree(&afd_defaults_pack_dir()) {
        pack.files.insert(rel, bytes);
    }
    pack
}

/// Adds a `bookshop-ui` pattern-only library holding a copied `error-recovery` pattern with the
/// given `approval_status` and `derivedFrom` metadata.
fn add_bookshop_copied_error_recovery(
    pack: &mut Pack,
    approval_status: &str,
    catalog_bindings: Option<Value>,
) {
    let digest_a = format!("sha256:{}", "a".repeat(64));
    let digest_b = format!("sha256:{}", "b".repeat(64));
    let pat = json!({
        "format": 2,
        "pattern": "error-recovery",
        "summary": "Bookshop kiosk error recovery copy.",
        "status": "stable",
        "approvalStatus": approval_status,
        "derivedFrom": {
            "library": "afd-defaults",
            "pattern": "error-recovery",
            "version": "1.0.0",
            "revision": digest_a,
            "statements": {
                "error-recovery.keep.suggestion-visible": digest_b
            }
        },
        "waivedKeep": [
            {
                "id": "error-recovery.keep.focus-returns",
                "reason": "Bookshop kiosk is touch-only with no hardware keyboard focus ring."
            }
        ],
        "scope": "composition",
        "facets": { "purpose": ["error-recovery"] },
        "useWhen": [
            {
                "id": "bookshop.error-recovery.use.kiosk",
                "text": "Use when a kiosk command fails."
            }
        ],
        "avoidWhen": [],
        "keep": [
            {
                "id": "bookshop.error-recovery.keep.suggestion-visible",
                "text": "Show the recovery suggestion beside the error message on the kiosk banner."
            },
            {
                "id": "bookshop.error-recovery.keep.proposed-only",
                "text": "Draft kiosk retry timer rule under review.",
                "approvalStatus": "proposed"
            }
        ],
        "customize": [
            {
                "id": "bookshop.error-recovery.customize.tone",
                "text": "Use friendly neighbourhood bookshop wording."
            }
        ],
        "setups": {},
        "gates": {},
        "implementations": []
    });
    pack.set_json("data/bookshop-ui/patterns/error-recovery.json", &pat);
    pack.set_json(
        "rules/bookshop-ui.json",
        &json!({ "format": 2, "library": "bookshop-ui", "rules": [] }),
    );
    let mut stamp = json!({
        "title": "Bookshop UI patterns",
        "package": { "name": "bookshop-ui", "version": "1.0.0" },
        "prefix": "bookshop-",
    });
    if let Some(bindings) = catalog_bindings {
        stamp["patternBindings"] = bindings;
    }
    let catalog = export_catalog(&pack.files, "bookshop-ui", &stamp);
    pack.files
        .insert("data/bookshop-ui/library.json".to_owned(), catalog);
}

#[tokio::test]
async fn scenario_02_good_defaults_approval_filtering_and_explicit_patterns_brief() {
    let mut pack = pack_with_afd_defaults();
    // Add one proposed pattern (`alternatives-draft`) in `afd-defaults` (alphabetically right
    // after `alternatives-and-confidence`) to prove proposed patterns stay hidden by default and
    // appear only when `includeProposed: true`.
    let mut proposed = pack.json("data/afd-defaults/patterns/alternatives-and-confidence.json");
    proposed["pattern"] = json!("alternatives-draft");
    proposed["approvalStatus"] = json!("proposed");
    proposed["useWhen"] = json!([]);
    proposed["avoidWhen"] = json!([]);
    proposed["keep"] = json!([
        {
            "id": "alternatives-draft.keep.visible",
            "text": "Draft proposed requirement under review."
        }
    ]);
    proposed["customize"] = json!([]);
    proposed["setups"] = json!({});
    proposed["gates"] = json!({});
    pack.set_json(
        "data/afd-defaults/patterns/alternatives-draft.json",
        &proposed,
    );
    // Also add one `approvalStatus: "deprecated"` pattern that stays hidden even with includeProposed.
    let mut deprecated_approval = proposed.clone();
    deprecated_approval["pattern"] = json!("zzz-retired-approval");
    deprecated_approval["approvalStatus"] = json!("deprecated");
    deprecated_approval["keep"] = json!([]);
    pack.set_json(
        "data/afd-defaults/patterns/zzz-retired-approval.json",
        &deprecated_approval,
    );
    let existing_cat = pack.json("data/afd-defaults/library.json");
    let stamp = json!({
        "title": existing_cat["title"],
        "package": existing_cat["package"],
        "prefix": existing_cat["prefix"],
    });
    let rebuilt = export_catalog(&pack.files, "afd-defaults", &stamp);
    pack.files
        .insert("data/afd-defaults/library.json".to_owned(), rebuilt);

    let fx = pack.host();

    // Scenario 02 Step 1: Default listing serves only approved patterns alphabetically.
    let listed = fx.pattern_list(json!({ "library": "afd-defaults" })).await;
    let d = data(&listed);
    assert_eq!(d["libraries"][0]["library"], "afd-defaults");
    assert_eq!(d["libraries"][0]["version"], "1.0.0");
    assert_eq!(d["libraries"][0]["patternCount"], 10);
    let patterns = d["content"]["patterns"].as_array().unwrap();
    assert_eq!(patterns.len(), 10);
    assert_eq!(patterns[0]["pattern"], "alternatives-and-confidence");
    assert_eq!(patterns[0]["approvalStatus"], "approved");
    assert!(
        patterns
            .iter()
            .all(|p| p["approvalStatus"] == "approved" && p["pattern"] != "alternatives-draft")
    );

    // Scenario 02 Step 2: `includeProposed: true` exposes proposed patterns, never deprecated approvalStatus.
    let with_proposed = fx
        .pattern_list(json!({ "library": "afd-defaults", "includeProposed": true }))
        .await;
    let d = data(&with_proposed);
    assert_eq!(d["libraries"][0]["library"], "afd-defaults");
    assert_eq!(d["libraries"][0]["patternCount"], 11);
    let patterns = d["content"]["patterns"].as_array().unwrap();
    assert_eq!(patterns.len(), 11);
    assert_eq!(patterns[0]["pattern"], "alternatives-and-confidence");
    assert_eq!(patterns[0]["approvalStatus"], "approved");
    assert_eq!(patterns[1]["pattern"], "alternatives-draft");
    assert_eq!(patterns[1]["approvalStatus"], "proposed");
    assert!(
        patterns
            .iter()
            .all(|p| p["pattern"] != "zzz-retired-approval")
    );

    // Scenario 02 Step 3: `components-brief` serves approved defaults directly via `patterns[]`.
    let brief = fx
        .brief(json!({
            "tags": ["example-field", "example-select"],
            "patterns": ["afd-defaults/error-recovery", "afd-defaults/destructive-confirm"]
        }))
        .await;
    let d = data(&brief);
    assert_eq!(d["content"]["trust"], "content");
    let briefed_pats = d["content"]["patterns"].as_array().unwrap();
    // Component-referenced patterns (`field`, `select`) come first, followed by explicit patterns.
    let err_rec = briefed_pats
        .iter()
        .find(|p| p["pattern"] == "error-recovery")
        .unwrap();
    assert_eq!(err_rec["library"], "afd-defaults");
    assert_eq!(err_rec["approvalStatus"], "approved");
    assert!(!err_rec["keep"].as_array().unwrap().is_empty());

    // Calling `components-brief` with `patterns[]` alone (no `tags` or `source`) works too.
    let patterns_only = fx
        .brief(json!({
            "patterns": ["afd-defaults/error-recovery", "afd-defaults/destructive-confirm"]
        }))
        .await;
    let d = data(&patterns_only);
    assert_eq!(d["content"]["trust"], "content");
    assert_eq!(d["content"]["patterns"][0]["pattern"], "error-recovery");
    assert_eq!(d["content"]["patterns"][0]["approvalStatus"], "approved");
    assert_eq!(
        d["content"]["patterns"][1]["pattern"],
        "destructive-confirm"
    );
    assert_eq!(d["content"]["patterns"][1]["approvalStatus"], "approved");
}

#[tokio::test]
async fn scenario_06_steps_4_and_6_compiled_pattern_bindings_pending_and_active() {
    let consumers_v3 = json!({
        "version": 3,
        "consumers": {
            "bookshop-ui": {
                "patternBindings": {
                    "afd-defaults/error-recovery": "bookshop-ui/error-recovery"
                }
            }
        }
    });

    // Step 4: While `bookshop-ui/error-recovery` is `proposed`, `components-brief` falls back to
    // the approved upstream `afd-defaults/error-recovery`.
    let mut pending_pack = pack_with_afd_defaults();
    add_bookshop_copied_error_recovery(&mut pending_pack, "proposed", None);
    let pending_fx = pending_pack.host_with_consumers(consumers_v3.clone());

    let while_proposed = pending_fx
        .brief(json!({
            "tags": ["example-field"],
            "patterns": ["afd-defaults/error-recovery"],
            "consumer": "bookshop-ui"
        }))
        .await;
    let pats = data(&while_proposed)["content"]["patterns"]
        .as_array()
        .unwrap();
    let resolved = pats
        .iter()
        .find(|p| p["pattern"] == "error-recovery")
        .unwrap();
    assert_eq!(resolved["library"], "afd-defaults");
    assert_eq!(resolved["pattern"], "error-recovery");
    assert_eq!(resolved["approvalStatus"], "approved");

    // With `includeProposed: true`, the pending binding resolves to the proposed local copy, and
    // proposed statements inside it become visible.
    let preview = pending_fx
        .brief(json!({
            "patterns": ["afd-defaults/error-recovery"],
            "consumer": "bookshop-ui",
            "includeProposed": true
        }))
        .await;
    let preview_pat = &data(&preview)["content"]["patterns"][0];
    assert_eq!(preview_pat["library"], "bookshop-ui");
    assert_eq!(preview_pat["pattern"], "error-recovery");
    assert_eq!(preview_pat["approvalStatus"], "proposed");
    assert_eq!(preview_pat["keep"].as_array().unwrap().len(), 2);

    // Step 6: Once approved, default `components-brief` resolves through `patternBindings` to
    // `bookshop-ui/error-recovery` while still filtering out its proposed child statement.
    let mut approved_pack = pack_with_afd_defaults();
    add_bookshop_copied_error_recovery(&mut approved_pack, "approved", None);
    let approved_fx = approved_pack.host_with_consumers(consumers_v3);

    let after_approval = approved_fx
        .brief(json!({
            "patterns": ["afd-defaults/error-recovery"],
            "consumer": "bookshop-ui"
        }))
        .await;
    let pat = &data(&after_approval)["content"]["patterns"][0];
    assert_eq!(pat["library"], "bookshop-ui");
    assert_eq!(pat["pattern"], "error-recovery");
    assert_eq!(pat["approvalStatus"], "approved");
    let keep = pat["keep"].as_array().unwrap();
    assert_eq!(keep.len(), 1);
    assert_eq!(
        keep[0]["id"],
        "bookshop.error-recovery.keep.suggestion-visible"
    );

    // Catalog-level `patternBindings` in `library.json` also resolves without a consumers pack.
    let mut catalog_bound_pack = pack_with_afd_defaults();
    add_bookshop_copied_error_recovery(
        &mut catalog_bound_pack,
        "approved",
        Some(json!({
            "afd-defaults/error-recovery": "bookshop-ui/error-recovery"
        })),
    );
    let catalog_fx = catalog_bound_pack.host();
    let catalog_brief = catalog_fx
        .brief(json!({ "patterns": ["afd-defaults/error-recovery"] }))
        .await;
    let pat = &data(&catalog_brief)["content"]["patterns"][0];
    assert_eq!(pat["library"], "bookshop-ui");
    assert_eq!(pat["pattern"], "error-recovery");
    assert_eq!(pat["approvalStatus"], "approved");
}

#[tokio::test]
async fn scenario_09_step_2_and_pattern_open_derived_from_and_approval_filtering() {
    let mut pack = pack_with_afd_defaults();
    add_bookshop_copied_error_recovery(&mut pack, "proposed", None);
    let fx = pack.host();

    // Scenario 09 Step 2: `components-brief` returns approved `batch-partial-failure` statements directly.
    let res = fx
        .brief(json!({
            "patterns": ["afd-defaults/batch-partial-failure"]
        }))
        .await;
    let d = data(&res);
    assert_eq!(d["content"]["trust"], "content");
    assert_eq!(
        d["content"]["patterns"][0]["pattern"],
        "batch-partial-failure"
    );
    assert_eq!(d["content"]["patterns"][0]["approvalStatus"], "approved");
    assert!(d["content"]["patterns"][0]["keep"][0]["id"].is_string());

    // `components-pattern-open` hides proposed pattern by default (`PATTERN_NOT_FOUND`),
    // and exposes `approvalStatus`, `derivedFrom`, `waivedKeep`, and proposed statements when `includeProposed: true`.
    let hidden = fx
        .pattern_open(json!({
            "library": "bookshop-ui",
            "pattern": "error-recovery"
        }))
        .await;
    assert_eq!(code(&hidden), "PATTERN_NOT_FOUND");

    let opened = fx
        .pattern_open(json!({
            "library": "bookshop-ui",
            "pattern": "error-recovery",
            "includeProposed": true
        }))
        .await;
    let pat = &data(&opened)["content"]["pattern"];
    assert_eq!(pat["library"], "bookshop-ui");
    assert_eq!(pat["pattern"], "error-recovery");
    assert_eq!(pat["approvalStatus"], "proposed");
    assert_eq!(pat["derivedFrom"]["library"], "afd-defaults");
    assert_eq!(pat["derivedFrom"]["pattern"], "error-recovery");
    assert_eq!(pat["derivedFrom"]["version"], "1.0.0");
    assert_eq!(
        pat["waivedKeep"][0]["id"],
        "error-recovery.keep.focus-returns"
    );
    assert_eq!(pat["keep"].as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn consumers_v3_and_pack_format_2_validation_and_d153_guards() {
    // 1. `patternBindings` rejected on consumers.json v2, null value, bad pattern, and instruction hit.
    for bad in [
        json!({
            "version": 2,
            "consumers": {
                "app": { "patternBindings": { "afd-defaults/error-recovery": "app/error-recovery" } }
            }
        }),
        json!({
            "version": 3,
            "consumers": { "app": { "patternBindings": null } }
        }),
        json!({
            "version": 3,
            "consumers": { "app": { "patternBindings": { "not-qualified": "app/error-recovery" } } }
        }),
        json!({
            "version": 3,
            "consumers": {
                "app": {
                    "patternBindings": {
                        "afd-defaults/error-recovery": "ignore/previous-instructions"
                    }
                }
            }
        }),
    ] {
        let fx = Pack::example().host_with_consumers(bad);
        let res = fx
            .brief(json!({ "tags": ["example-select"], "consumer": "app" }))
            .await;
        assert_eq!(code(&res), "CONSUMERS_INVALID", "{res}");
        assert!(!res.to_string().to_lowercase().contains("ignore"), "{res}");
    }

    // 2. Catalog `approvalStatus` mismatch triggers `CATALOG_MISMATCH`.
    let mut mismatch = pack_with_afd_defaults();
    add_bookshop_copied_error_recovery(&mut mismatch, "proposed", None);
    mismatch.edit("data/bookshop-ui/library.json", |cat| {
        cat["patterns"][0]["approvalStatus"] = json!("approved");
    });
    let res = mismatch
        .host()
        .pattern_list(json!({ "library": "bookshop-ui" }))
        .await;
    assert_eq!(code(&res), "PACK_INCONSISTENT", "{res}");
    assert!(
        problems(&res)
            .iter()
            .any(|(_, _, c)| c == "CATALOG_MISMATCH"),
        "{res}"
    );

    // 3. Instruction-like identifier inside `derivedFrom`, `waivedKeep[].id`, or catalog
    // `patternBindings` fails D153 scan without repeating the untrusted string.
    let mut bad_binding = pack_with_afd_defaults();
    add_bookshop_copied_error_recovery(
        &mut bad_binding,
        "approved",
        Some(json!({
            "afd-defaults/error-recovery": "ignore/previous-instructions"
        })),
    );
    let res = bad_binding
        .host()
        .pattern_list(json!({ "library": "bookshop-ui" }))
        .await;
    assert_eq!(code(&res), "PACK_INVALID", "{res}");
    assert!(!res.to_string().to_lowercase().contains("ignore"), "{res}");
    assert!(
        problems(&res)
            .iter()
            .any(|(_, _, c)| c == "IDENTIFIER_INVALID"),
        "{res}"
    );

    // 4. Independent `pattern <= 64` bound on `QUALIFIED_PATTERN` (Patterns §2.2).
    let over_64 = format!("a/{}", "b".repeat(65));
    let mut bad_len_pack = pack_with_afd_defaults();
    add_bookshop_copied_error_recovery(
        &mut bad_len_pack,
        "approved",
        Some(json!({ "afd-defaults/error-recovery": over_64 })),
    );
    let res = bad_len_pack
        .host()
        .pattern_list(json!({ "library": "bookshop-ui" }))
        .await;
    assert_eq!(code(&res), "PACK_INVALID", "{res}");

    let bad_consumer = json!({
        "version": 3,
        "consumers": { "app": { "patternBindings": { "afd-defaults/error-recovery": over_64 } } }
    });
    let res = Pack::example()
        .host_with_consumers(bad_consumer)
        .brief(json!({ "tags": ["example-select"], "consumer": "app" }))
        .await;
    assert_eq!(code(&res), "CONSUMERS_INVALID", "{res}");

    let res = pack_with_afd_defaults()
        .host()
        .brief(json!({ "patterns": [over_64] }))
        .await;
    assert_eq!(code(&res), "COMPONENTS_INVALID", "{res}");

    // 5. Duplicate `waivedKeep[].id` is rejected as `DUPLICATE_ID`.
    let mut dup_waiver = pack_with_afd_defaults();
    add_bookshop_copied_error_recovery(&mut dup_waiver, "approved", None);
    dup_waiver.edit("data/bookshop-ui/patterns/error-recovery.json", |pat| {
        pat["waivedKeep"] = json!([
            { "id": "error-recovery.keep.focus-returns", "reason": "First waiver." },
            { "id": "error-recovery.keep.focus-returns", "reason": "Duplicate waiver." }
        ]);
    });
    dup_waiver.regenerate("bookshop-ui");
    let res = dup_waiver
        .host()
        .pattern_list(json!({ "library": "bookshop-ui" }))
        .await;
    assert_eq!(code(&res), "PACK_INVALID", "{res}");
    assert!(
        problems(&res).iter().any(|(_, _, c)| c == "DUPLICATE_ID"),
        "{res}"
    );
}

#[tokio::test]
async fn component_pattern_links_follow_bindings_and_approval_visibility() {
    // Component `example-select` claims `example/select`. Add a second library `product` owning
    // `product/select` and bind `example/select -> product/select`.
    let mut pack = Pack::example();
    let select_pat = pack.json("data/example/patterns/select.json");
    let mut product_pat = select_pat.clone();
    product_pat["summary"] = json!("Product override of select.");
    product_pat["approvalStatus"] = json!("approved");
    product_pat["implementations"] = json!([]);
    pack.set_json(
        "rules/product.json",
        &json!({ "format": 2, "library": "product", "rules": [] }),
    );
    pack.set_json("data/product/patterns/select.json", &product_pat);
    pack.set_json(
        "data/product/library.json",
        &json!({
            "format": 2,
            "library": "product",
            "title": "Product",
            "package": { "name": "@product/ui", "version": "1.0.0" },
            "prefix": "prod-",
            "digest": format!("sha256:{}", "0".repeat(64)),
            "rules": format!("sha256:{}", "0".repeat(64)),
            "components": [],
            "patterns": [{
                "pattern": "select",
                "summary": "Product override of select.",
                "status": "stable",
                "approvalStatus": "approved",
                "scope": select_pat["scope"],
                "facets": select_pat["facets"],
                "digest": format!("sha256:{}", "0".repeat(64)),
            }],
            "copies": [],
            "patternBindings": {
                "example/select": "product/select"
            }
        }),
    );
    pack.regenerate("product");

    let briefed = pack
        .host()
        .brief(json!({ "tags": ["example-select"] }))
        .await;
    assert_eq!(briefed["success"], true, "{briefed}");
    let content = &data(&briefed)["content"];
    // Both `content.components[0].patterns` and `content.patterns` agree on `product/select`.
    let comp_patterns = content["components"][0]["patterns"].as_array().unwrap();
    assert_eq!(comp_patterns, &vec![json!("product/select")]);
    assert_eq!(content["patterns"][0]["library"], "product");
    assert_eq!(content["patterns"][0]["pattern"], "select");

    // When `example/select` itself is `proposed` (no binding) and `includeProposed` is false,
    // both `content.patterns` and the component's `patterns` link omit it.
    let mut hidden_pack = Pack::example();
    hidden_pack.edit("data/example/patterns/select.json", |pat| {
        pat["approvalStatus"] = json!("proposed");
    });
    hidden_pack.edit("data/example/library.json", |cat| {
        for entry in cat["patterns"].as_array_mut().unwrap() {
            if entry["pattern"] == "select" {
                entry["approvalStatus"] = json!("proposed");
            }
        }
    });
    hidden_pack.regenerate("example");
    let hidden = hidden_pack
        .host()
        .brief(json!({ "tags": ["example-select"] }))
        .await;
    assert_eq!(hidden["success"], true, "{hidden}");
    assert!(data(&hidden)["content"].get("patterns").is_none());
    assert!(
        data(&hidden)["content"]["components"][0]
            .get("patterns")
            .is_none()
    );
}

#[tokio::test]
async fn brief_explicit_patterns_report_unknown_ambiguous_detail_api_text_and_budget() {
    let mut pack = pack_with_afd_defaults();
    add_bookshop_copied_error_recovery(&mut pack, "approved", None);

    // 1. Typo in explicit `patterns[]` is reported in `unknown[]` with visible `nearest`.
    let typo = pack
        .host()
        .brief(json!({ "patterns": ["afd-defaults/error-recvoery"] }))
        .await;
    assert_eq!(typo["success"], true, "{typo}");
    let unk = data(&typo)["unknown"].as_array().unwrap();
    assert_eq!(unk.len(), 1);
    assert_eq!(unk[0]["pattern"], "afd-defaults/error-recvoery");
    assert_eq!(unk[0]["reason"], "not-found");
    assert!(
        unk[0]["nearest"]
            .as_array()
            .unwrap()
            .contains(&json!("afd-defaults/error-recovery"))
    );

    // 2. Ambiguous bare pattern across two libraries is reported as `ambiguous` with `libraries`.
    let ambig = pack
        .host()
        .brief(json!({ "patterns": ["error-recovery"] }))
        .await;
    assert_eq!(ambig["success"], true, "{ambig}");
    let unk = data(&ambig)["unknown"].as_array().unwrap();
    assert_eq!(unk[0]["pattern"], "error-recovery");
    assert_eq!(unk[0]["reason"], "ambiguous");
    let libs = unk[0]["libraries"].as_array().unwrap();
    assert!(libs.contains(&json!("afd-defaults")));
    assert!(libs.contains(&json!("bookshop-ui")));

    // 3. Invalid `default_library` fails with `LIBRARY_NOT_FOUND`; valid one disambiguates.
    let bad_default = pack
        .host_with(toml::toml! { default_library = "missing-lib" })
        .brief(json!({ "patterns": ["error-recovery"] }))
        .await;
    assert_eq!(code(&bad_default), "LIBRARY_NOT_FOUND", "{bad_default}");

    let resolved = pack
        .host_with(toml::toml! { default_library = "bookshop-ui" })
        .brief(json!({ "patterns": ["error-recovery"] }))
        .await;
    assert_eq!(resolved["success"], true, "{resolved}");
    assert_eq!(
        data(&resolved)["content"]["patterns"][0]["library"],
        "bookshop-ui"
    );

    // 4. `detail: "api"` omits pattern text and emits callable `omitted[].open` with `includeProposed`.
    let mut proposed_pack = pack_with_afd_defaults();
    add_bookshop_copied_error_recovery(&mut proposed_pack, "proposed", None);
    let api = proposed_pack
        .host()
        .brief(json!({
            "patterns": ["bookshop-ui/error-recovery"],
            "detail": "api",
            "includeProposed": true
        }))
        .await;
    assert_eq!(api["success"], true, "{api}");
    assert!(data(&api)["content"].get("patterns").is_none());
    let omitted = data(&api)["omitted"].as_array().unwrap();
    assert_eq!(omitted[0]["reason"], "detail");
    assert_eq!(omitted[0]["open"]["command"], "components-pattern-open");
    assert_eq!(omitted[0]["open"]["includeProposed"], true);

    // 5. `render: "text"` preserves `proposed` marker on proposed pattern and statements, and renders
    // unknown patterns cleanly.
    let text = proposed_pack
        .host()
        .brief(json!({
            "patterns": ["bookshop-ui/error-recovery", "afd-defaults/missing-pat"],
            "includeProposed": true,
            "render": "text"
        }))
        .await;
    assert_eq!(text["success"], true, "{text}");
    let body = data(&text)["text"].as_str().unwrap();
    assert!(
        body.contains("[pattern bookshop-ui/error-recovery stable proposed]"),
        "{body}"
    );
    assert!(
        body.contains("keep (proposed) bookshop.error-recovery.keep.proposed-only:"),
        "{body}"
    );
    assert!(
        body.contains("[unknown pattern afd-defaults/missing-pat not-found"),
        "{body}"
    );

    // 6. Tight budget on `patterns`-only brief sheds cleanly and propagates `includeProposed: true`,
    // while an impossible budget returns `OUTPUT_BUDGET_EXCEEDED` with a patterns-aware suggestion.
    let shed = proposed_pack
        .host()
        .brief(json!({
            "patterns": ["bookshop-ui/error-recovery"],
            "includeProposed": true,
            "maxBytes": 1_024
        }))
        .await;
    assert_eq!(shed["success"], true, "{shed}");
    let shed_omitted = data(&shed)["omitted"].as_array().unwrap();
    assert!(shed_omitted.iter().any(|o| {
        o["reason"] == "budget"
            && o["open"]["command"] == "components-pattern-open"
            && o["open"]["includeProposed"] == true
    }));

    let too_small = proposed_pack
        .host()
        .brief(json!({
            "patterns": [
                "afd-defaults/confirmation",
                "afd-defaults/decision-card",
                "afd-defaults/empty-state",
                "afd-defaults/error-recovery",
                "afd-defaults/evidence-and-sources",
                "afd-defaults/progress-and-plan",
                "afd-defaults/undo-offer",
                "afd-defaults/warnings-banner",
                "bookshop-ui/error-recovery"
            ],
            "includeProposed": true,
            "maxBytes": 1_024
        }))
        .await;
    assert_eq!(code(&too_small), "OUTPUT_BUDGET_EXCEEDED", "{too_small}");
    assert!(
        too_small["error"]["suggestion"]
            .as_str()
            .unwrap()
            .contains("fewer patterns"),
        "{too_small}"
    );

    // 7. Hidden proposed pattern is reported as `not-found` and never appears in `nearest`.
    let hidden_req = proposed_pack
        .host()
        .brief(json!({ "patterns": ["bookshop-ui/error-recovery"] }))
        .await;
    assert_eq!(hidden_req["success"], true, "{hidden_req}");
    let unk = data(&hidden_req)["unknown"].as_array().unwrap();
    assert_eq!(unk[0]["reason"], "not-found");
    assert!(!unk[0]["nearest"].to_string().contains("bookshop-ui"));
}

#[tokio::test]
async fn binding_precedence_multihop_cycles_and_depth_limit() {
    // Build a pack with `chain` library having `p0..=p9` plus a consumer v3 override.
    let mut pack = Pack::example();
    let mut cat_patterns = Vec::new();
    for i in 0..=9 {
        let name = format!("p{i}");
        let rec = json!({
            "format": 2,
            "pattern": name,
            "summary": format!("Pattern {i}."),
            "status": "stable",
            "approvalStatus": "approved",
            "scope": "composition",
            "facets": { "kind": ["flow"] },
            "useWhen": [{ "id": format!("p{i}.use.always"), "text": format!("Use p{i}.") }],
            "avoidWhen": [],
            "keep": [{ "id": format!("p{i}.keep.rule"), "text": format!("Keep p{i}.") }],
            "customize": [],
            "setups": {},
            "gates": {},
            "implementations": []
        });
        pack.set_json(&format!("data/chain/patterns/{name}.json"), &rec);
        cat_patterns.push(json!({
            "pattern": name,
            "summary": format!("Pattern {i}."),
            "status": "stable",
            "approvalStatus": "approved",
            "scope": "composition",
            "facets": { "kind": ["flow"] },
            "digest": format!("sha256:{}", "0".repeat(64))
        }));
    }
    pack.set_json(
        "rules/chain.json",
        &json!({ "format": 2, "library": "chain", "rules": [] }),
    );
    pack.set_json(
        "data/chain/library.json",
        &json!({
            "format": 2,
            "library": "chain",
            "title": "Chain",
            "package": { "name": "@chain/ui", "version": "1.0.0" },
            "prefix": "ch-",
            "digest": format!("sha256:{}", "0".repeat(64)),
            "rules": format!("sha256:{}", "0".repeat(64)),
            "components": [],
            "patterns": cat_patterns,
            "copies": [],
            "patternBindings": {
                "chain/p0": "chain/p1",
                "chain/p1": "chain/p2"
            }
        }),
    );
    pack.regenerate("chain");

    // 1. Multi-hop `p0 -> p1 -> p2` resolves to `p2`.
    let res = pack.host().brief(json!({ "patterns": ["chain/p0"] })).await;
    assert_eq!(res["success"], true, "{res}");
    assert_eq!(data(&res)["content"]["patterns"][0]["pattern"], "p2");

    // 2. Consumer v3 `patternBindings` overrides catalog binding (`p0 -> p3`).
    let consumers = json!({
        "version": 3,
        "consumers": {
            "app": { "patternBindings": { "chain/p0": "chain/p3" } }
        }
    });
    let res = pack
        .host_with_consumers(consumers)
        .brief(json!({ "patterns": ["chain/p0"], "consumer": "app" }))
        .await;
    assert_eq!(res["success"], true, "{res}");
    assert_eq!(data(&res)["content"]["patterns"][0]["pattern"], "p3");

    // 3. Mid-chain pending-approval fallback: `p0 -> p1 (approved) -> p2 (proposed)` resolves to `p1`.
    let mut mid_pack = pack.clone();
    mid_pack.edit("data/chain/patterns/p2.json", |p| {
        p["approvalStatus"] = json!("proposed");
    });
    mid_pack.edit("data/chain/library.json", |cat| {
        cat["patterns"][2]["approvalStatus"] = json!("proposed");
    });
    mid_pack.regenerate("chain");
    let res = mid_pack
        .host()
        .brief(json!({ "patterns": ["chain/p0"] }))
        .await;
    assert_eq!(res["success"], true, "{res}");
    assert_eq!(data(&res)["content"]["patterns"][0]["pattern"], "p1");

    // 4. Cycle (`p0 -> p1 -> p0`) is refused with `PATTERN_BINDING_INVALID` (`reason: "cycle"`).
    let cycle_consumers = json!({
        "version": 3,
        "consumers": {
            "app": { "patternBindings": { "chain/p1": "chain/p0" } }
        }
    });
    let res = pack
        .host_with_consumers(cycle_consumers)
        .brief(json!({ "patterns": ["chain/p0"], "consumer": "app" }))
        .await;
    assert_eq!(code(&res), "PATTERN_BINDING_INVALID", "{res}");
    assert_eq!(res["error"]["details"]["reason"], "cycle");

    // 5. >8-hop chain (`p0 -> p1 -> ... -> p9`, 9 hops) is refused with `depth-exceeded`.
    let deep_consumers = json!({
        "version": 3,
        "consumers": {
            "app": {
                "patternBindings": {
                    "chain/p2": "chain/p3",
                    "chain/p3": "chain/p4",
                    "chain/p4": "chain/p5",
                    "chain/p5": "chain/p6",
                    "chain/p6": "chain/p7",
                    "chain/p7": "chain/p8",
                    "chain/p8": "chain/p9"
                }
            }
        }
    });
    let res = pack
        .host_with_consumers(deep_consumers)
        .brief(json!({ "patterns": ["chain/p0"], "consumer": "app" }))
        .await;
    assert_eq!(code(&res), "PATTERN_BINDING_INVALID", "{res}");
    assert_eq!(res["error"]["details"]["reason"], "depth-exceeded");
}

#[tokio::test]
async fn copy_approval_hidden_keeps_facets_minimum_basis_and_cursor() {
    let mut pack = Pack::example();
    let rev = format!("sha256:{}", "1".repeat(64));
    let fp = format!("sha256:{}", "2".repeat(64));
    let copy_pat = "select";
    let copy_name = "basic";
    let copy_path = format!("data/example/patterns/{copy_pat}/{copy_name}.json");
    let pat_path = format!("data/example/patterns/{copy_pat}.json");
    pack.set_json(
        &copy_path,
        &json!({
            "format": 2,
            "pattern": copy_pat,
            "name": copy_name,
            "status": "stable",
            "approvalStatus": "proposed",
            "html": "<example-select label=\"Choice\"></example-select>",
            "css": "",
            "dependencies": ["example-select"],
            "tokens": [],
            "revision": rev,
            "fingerprint": fp,
            "origin": { "id": "copy-origin-1" },
            "keep": [
                { "id": "select.keep.proposed-rule", "basis": "ungated" }
            ]
        }),
    );
    pack.edit(&pat_path, |pat| {
        pat["keep"].as_array_mut().unwrap().push(json!({
            "id": "select.keep.proposed-rule",
            "text": "Proposed keep rule.",
            "approvalStatus": "proposed"
        }));
        pat["implementations"].as_array_mut().unwrap().push(json!({
            "kind": "copy",
            "name": copy_name,
            "linkage": "copy"
        }));
    });
    // Also attach the proposed `keep` statement to the visible `example-select` component record so
    // `build_implementation`'s `hidden_keep_ids` filter and `minimum-basis` accounting are exercised
    // on a visible implementation.
    pack.edit(&record_path("select"), |rec| {
        for link in rec["patterns"].as_array_mut().unwrap() {
            if link["pattern"] == "select" {
                link["keep"].as_array_mut().unwrap().push(json!({
                    "id": "select.keep.proposed-rule",
                    "basis": "ungated"
                }));
            }
        }
    });
    pack.edit("data/example/library.json", |cat| {
        cat["copies"].as_array_mut().unwrap().push(json!({
            "pattern": copy_pat,
            "name": copy_name,
            "status": "stable",
            "approvalStatus": "proposed",
            "revision": rev,
            "fingerprint": fp,
            "digest": format!("sha256:{}", "0".repeat(64))
        }));
    });
    pack.regenerate("example");

    // 1. Default `components-pattern-open` hides proposed copy AND proposed `keep` (including from
    // the visible `example-select` component implementation, without counting hidden ungated keeps
    // toward `minimum-basis` omissions).
    let opened = pack
        .host_with(toml::toml! { minimum_basis = "verified" })
        .pattern_open(json!({ "library": "example", "pattern": copy_pat }))
        .await;
    assert_eq!(opened["success"], true, "{opened}");
    let impls = data(&opened)["content"]["pattern"]["implementations"]
        .as_array()
        .unwrap();
    assert!(impls.iter().all(|i| i["kind"] != "copy"), "{impls:?}");
    let comp_impl = impls
        .iter()
        .find(|i| i["kind"] == "component" && i["tag"] == "example-select")
        .unwrap();
    assert!(
        comp_impl["keep"]
            .as_array()
            .unwrap()
            .iter()
            .all(|k| k["id"] != "select.keep.proposed-rule"),
        "hidden proposed keep leaked into component implementation: {comp_impl}"
    );
    let pat_obj = &data(&opened)["content"]["pattern"];
    assert!(
        pat_obj
            .get("keep")
            .and_then(Value::as_array)
            .is_none_or(|items| items.iter().all(|k| k["id"] != "select.keep.proposed-rule"))
    );
    let min_basis_without = data(&opened)["omitted"]
        .as_array()
        .unwrap()
        .iter()
        .find(|o| o["reason"] == "minimum-basis")
        .map_or(0, |o| o["facts"].as_u64().unwrap());
    let opened_verified_prop = pack
        .host_with(toml::toml! { minimum_basis = "verified" })
        .pattern_open(json!({
            "library": "example",
            "pattern": copy_pat,
            "includeProposed": true
        }))
        .await;
    let min_basis_with = data(&opened_verified_prop)["omitted"]
        .as_array()
        .unwrap()
        .iter()
        .find(|o| o["reason"] == "minimum-basis")
        .map_or(0, |o| o["facts"].as_u64().unwrap());
    // Including the proposed ungated keep adds omissions for pattern.keep + component + copy.
    assert!(
        min_basis_with > min_basis_without,
        "expected more minimum-basis omissions with includeProposed=true ({min_basis_with} vs {min_basis_without})"
    );

    // 2. With `includeProposed: true`, proposed copy and proposed `keep` appear with
    // `"approvalStatus": "proposed"`.
    let opened_prop = pack
        .host()
        .pattern_open(json!({
            "library": "example",
            "pattern": copy_pat,
            "includeProposed": true
        }))
        .await;
    assert_eq!(opened_prop["success"], true, "{opened_prop}");
    let pat = &data(&opened_prop)["content"]["pattern"];
    let copy_impl = pat["implementations"]
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["kind"] == "copy")
        .unwrap();
    assert_eq!(copy_impl["approvalStatus"], "proposed");
    let proposed_keep_id = "select.keep.proposed-rule";
    assert!(
        pat["keep"]
            .as_array()
            .unwrap()
            .iter()
            .any(|k| k["id"] == proposed_keep_id && k["approvalStatus"] == "proposed")
    );

    // 3. Catalog mismatch on copy `approvalStatus` triggers `CATALOG_MISMATCH`.
    let mut bad_copy = pack.clone();
    bad_copy.edit("data/example/library.json", |cat| {
        cat["copies"][0]["approvalStatus"] = json!("approved");
    });
    let res = bad_copy
        .host()
        .pattern_list(json!({ "library": "example" }))
        .await;
    assert_eq!(code(&res), "PACK_INCONSISTENT", "{res}");
    assert!(
        problems(&res)
            .iter()
            .any(|(_, _, c)| c == "CATALOG_MISMATCH"),
        "{res}"
    );

    // 4. `availableFacets` (inside `content.availableFacets`) excludes proposed-only facet values
    // by default and exposes them when `includeProposed: true`.
    let mut facet_pack = pack_with_afd_defaults();
    add_bookshop_copied_error_recovery(&mut facet_pack, "proposed", None);
    facet_pack.edit("data/bookshop-ui/patterns/error-recovery.json", |pat| {
        pat["facets"] = json!({ "exclusive": ["proposed-only"] });
    });
    facet_pack.edit("data/bookshop-ui/library.json", |cat| {
        cat["patterns"][0]["facets"] = json!({ "exclusive": ["proposed-only"] });
    });
    facet_pack.regenerate("bookshop-ui");
    let listed = facet_pack.host().pattern_list(json!({})).await;
    assert_eq!(listed["success"], true, "{listed}");
    let facets_default = data(&listed)["content"]["availableFacets"]
        .as_object()
        .expect("content.availableFacets must be an object");
    assert!(
        !facets_default.contains_key("exclusive"),
        "proposed-only facet leaked: {facets_default:?}"
    );
    let listed_prop = facet_pack
        .host()
        .pattern_list(json!({ "includeProposed": true }))
        .await;
    assert_eq!(listed_prop["success"], true, "{listed_prop}");
    let facets_prop = data(&listed_prop)["content"]["availableFacets"]
        .as_object()
        .expect("content.availableFacets must be an object");
    assert_eq!(
        facets_prop.get("exclusive"),
        Some(&json!(["proposed-only"]))
    );

    // 5. Bare `after` cursor skips a hidden proposed pattern in an alphabetically EARLIER library:
    // mark `afd-defaults/error-recovery` (earlier library) as `proposed` and `bookshop-ui/error-recovery`
    // (later library) as `approved`, then paginate with bare `after: "error-recovery"`.
    // Without `is_visible_approval` in `cursor()`, `after` would anchor on `afd-defaults` and
    // wrongly return `afd-defaults/evidence-and-sources` AND `bookshop-ui/error-recovery`!
    let mut cursor_pack = pack_with_afd_defaults();
    add_bookshop_copied_error_recovery(&mut cursor_pack, "approved", None);
    cursor_pack.edit("data/afd-defaults/patterns/error-recovery.json", |pat| {
        pat["approvalStatus"] = json!("proposed");
    });
    cursor_pack.edit("data/afd-defaults/library.json", |cat| {
        for entry in cat["patterns"].as_array_mut().unwrap() {
            if entry["pattern"] == "error-recovery" {
                entry["approvalStatus"] = json!("proposed");
            }
        }
    });
    cursor_pack.regenerate("afd-defaults");
    let paged = cursor_pack
        .host()
        .pattern_list(json!({ "after": "error-recovery" }))
        .await;
    assert_eq!(paged["success"], true, "{paged}");
    let rows: Vec<(&str, &str)> = data(&paged)["content"]["patterns"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| {
            (
                p["library"].as_str().unwrap(),
                p["pattern"].as_str().unwrap(),
            )
        })
        .collect();
    // Anchored on `bookshop-ui/error-recovery` (skipping hidden `afd-defaults/error-recovery`),
    // so neither `afd-defaults/*` nor `bookshop-ui/error-recovery` appears; only later libraries do.
    assert!(
        rows.iter().all(|(lib, _)| *lib > "bookshop-ui"),
        "bare cursor anchored on hidden earlier library: {rows:?}"
    );
    assert!(rows.contains(&("example", "field")), "{rows:?}");
}

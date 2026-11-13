//! Export and import (specification, section 10): export in pages; an import into an empty
//! second host restores every record and affirmation, with `restored` added; the second host's
//! export has the same manifest digest and counts; importing again adds nothing; an import
//! refused at its first affirmation leaves its records unaffirmed, and run again as the person
//! adds nothing and affirms. Both commands are the command line's only.
//!
//! Version 1's only way to affirm before step C3 is the import itself, so the first store's
//! affirmation is made by importing its own export with one wording marked affirmed.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use afd::CommandInterface;
use serde_json::{Value, json};
use support::*;

const STATEMENTS: [&str; 3] = [
    "Oil wooden handles every winter.",
    "Sharpen the hoe before the first weeding.",
    "A dull spade bruises roots.",
];

/// Every page of the operator's export, with `limit`.
async fn export_all(fx: &Fx, limit: u64) -> (Vec<Value>, Value) {
    let mut items = Vec::new();
    let mut after: Option<String> = None;
    loop {
        let mut input = json!({ "limit": limit });
        if let Some(after) = &after {
            input["after"] = json!(after);
        }
        let page = fx.operator("ideas-export", input).await;
        let d = data(&page).clone();
        items.extend(d["items"].as_array().unwrap().iter().cloned());
        match d["next"].as_str() {
            Some(next) => {
                assert!(
                    d.get("manifest").is_none(),
                    "only the last page has the manifest"
                );
                after = Some(next.to_owned());
            }
            None => return (items, d["manifest"].clone()),
        }
    }
}

/// A store with three ideas, the second's wording affirmed by its person.
async fn first_store() -> Fx {
    let fx = Fx::new();
    fx.capture(&STATEMENTS).await;
    let (mut items, _) = export_all(&fx, 500).await;
    let wording = items
        .iter_mut()
        .find(|item| item["kind"] == "wording" && item["body"]["statement"] == STATEMENTS[1])
        .unwrap();
    wording["affirmed"] = json!({ "at": "2025-12-31T09:00:00.000Z", "level": "terminal" });
    let imported = fx.person("ideas-import", json!({ "items": items })).await;
    let d = data(&imported);
    assert_eq!(
        d["added"],
        json!({ "idea": 0, "wording": 0, "review": 0, "proposal": 0 })
    );
    assert_eq!(d["affirmed"], 1);
    fx
}

#[tokio::test]
async fn export_in_pages_is_the_whole_in_order() {
    let fx = first_store().await;
    let (whole, manifest) = export_all(&fx, 1000).await;
    let (paged, paged_manifest) = export_all(&fx, 2).await;
    assert_eq!(whole, paged);
    assert_eq!(manifest, paged_manifest);
    let kinds: Vec<&str> = whole.iter().map(|i| i["kind"].as_str().unwrap()).collect();
    assert_eq!(
        kinds,
        ["idea", "idea", "idea", "wording", "wording", "wording"]
    );
    assert_eq!(manifest["format"], "ideas-archive/1");
    assert_eq!(
        manifest["counts"],
        json!({ "idea": 3, "wording": 3, "review": 0, "proposal": 0, "affirmed": 1 })
    );
    assert!(manifest["digest"].as_str().unwrap().starts_with("sha256:"));
    let affirmed: Vec<&Value> = whole.iter().filter(|i| !i["affirmed"].is_null()).collect();
    assert_eq!(affirmed.len(), 1);
    assert_eq!(affirmed[0]["affirmed"]["level"], "terminal");
    // The first store's own wording was in the store before the archive marked it: no
    // `restored`, since the put found it there.
    assert!(affirmed[0]["body"].get("restored").is_none());
}

#[tokio::test]
async fn an_empty_store_restores_everything_and_exports_the_same() {
    let first = first_store().await;
    let (items, manifest) = export_all(&first, 1000).await;
    let second = Fx::new();
    let restored = second
        .person(
            "ideas-import",
            json!({ "items": items, "manifest": manifest }),
        )
        .await;
    let d = data(&restored);
    assert_eq!(
        d["added"],
        json!({ "idea": 3, "wording": 3, "review": 0, "proposal": 0 })
    );
    assert_eq!(d["affirmed"], 1);
    assert_eq!(d["matches"], true);
    assert_eq!(d["differs"]["count"], 0);
    let (again, again_manifest) = export_all(&second, 1000).await;
    assert_eq!(again_manifest["digest"], manifest["digest"]);
    assert_eq!(again_manifest["counts"], manifest["counts"]);
    // The affirmation is a new decision, made now; the archive's is kept in `restored`.
    let wording = again.iter().find(|i| !i["affirmed"].is_null()).unwrap();
    assert_eq!(wording["affirmed"]["at"], "2026-01-01T00:00:00.000Z");
    assert_eq!(wording["affirmed"]["level"], "terminal");
    let first_affirmed = items.iter().find(|i| !i["affirmed"].is_null()).unwrap();
    assert_eq!(
        wording["body"]["restored"],
        json!({ "affirmedAt": first_affirmed["affirmed"]["at"], "level": "terminal" })
    );
    let opened = second
        .agent("ideas-open", json!({ "id": wording["body"]["idea"] }))
        .await;
    assert_eq!(data(&opened)["standing"], "affirmed");

    // Imported again: nothing added, all the same, and the affirmation already there.
    let twice = second
        .person(
            "ideas-import",
            json!({ "items": items, "manifest": manifest }),
        )
        .await;
    let t = data(&twice);
    assert_eq!(
        t["added"],
        json!({ "idea": 0, "wording": 0, "review": 0, "proposal": 0 })
    );
    assert_eq!(
        t["same"],
        json!({ "idea": 3, "wording": 3, "review": 0, "proposal": 0 })
    );
    assert_eq!(t["matches"], true);
}

#[tokio::test]
async fn a_refused_import_leaves_records_unaffirmed_until_the_person_runs_it() {
    let first = first_store().await;
    let (items, manifest) = export_all(&first, 1000).await;
    let second = Fx::new();
    let input = json!({ "items": items, "manifest": manifest });
    // At a terminal, but with an agent's variable set: the gate asks and passes, and the host
    // gives no proof, so the first affirmation is refused.
    let (refused, asked) = second
        .terminal(
            "ideas-import",
            input.clone(),
            true,
            &[],
            &[("CLAUDECODE", "1")],
        )
        .await;
    assert_eq!(asked.len(), 1, "{asked:?}");
    assert!(asked[0].contains("re-affirming the wordings the archive says you affirmed"));
    assert_eq!(code(&refused), "FORBIDDEN", "{refused}");
    assert_eq!(
        refused["error"]["details"]["host"],
        "RECORD_DECISION_NOT_GATED"
    );
    assert!(
        refused["error"]["suggestion"]
            .as_str()
            .unwrap()
            .contains("Have the space's person confirm it")
    );
    // What was put before the refusal stays, unaffirmed.
    let guide = second.agent("ideas-guide", json!({})).await;
    assert_eq!(data(&guide)["totals"]["affirmed"], 0);
    assert!(data(&guide)["totals"]["ideas"].as_u64().unwrap() >= 1);
    // `--yes` is refused before the handler runs, and asks nothing.
    let (yes, asked) = second
        .terminal("ideas-import", input.clone(), true, &["--yes"], &[])
        .await;
    assert_eq!(yes["success"], false, "{yes}");
    assert!(asked.is_empty());
    // As the person: what was there is the same, the rest is added, and the wording affirmed.
    let done = second.person("ideas-import", input).await;
    let d = data(&done);
    assert_eq!(d["affirmed"], 1);
    assert_eq!(d["matches"], true);
    let guide = second.agent("ideas-guide", json!({})).await;
    assert_eq!(data(&guide)["totals"]["affirmed"], 1);
}

#[tokio::test]
async fn neither_is_offered_to_an_agent() {
    let fx = Fx::new();
    for (command, input) in [
        ("ideas-export", json!({})),
        (
            "ideas-import",
            json!({ "items": [{ "kind": "idea", "id": "idea-000000000000000000000000", "body": {}, "affirmed": null }] }),
        ),
    ] {
        for interface in [CommandInterface::Mcp, CommandInterface::Agent] {
            let refused = fx
                .call(
                    agent_for("gardener-bot", "ada"),
                    interface,
                    command,
                    input.clone(),
                )
                .await;
            assert_eq!(code(&refused), "COMMAND_NOT_EXPOSED", "{refused}");
        }
    }
}

#[tokio::test]
async fn an_item_that_is_not_its_kinds_body_refuses_the_whole_import() {
    let fx = Fx::new();
    let bad = json!({ "items": [
        { "kind": "idea", "id": "idea-000000000000000000000000", "body": { "id": "idea-000000000000000000000001" }, "affirmed": null },
    ] });
    let refused = fx.person("ideas-import", bad).await;
    assert_eq!(code(&refused), "VALIDATION_ERROR");
    assert_eq!(refused["error"]["details"]["field"], "items[0].body");
    let guide = fx.agent("ideas-guide", json!({})).await;
    assert_eq!(data(&guide)["totals"]["ideas"], 0);
}

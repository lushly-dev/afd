//! What reaches the journal, the log and the event streams (specification, sections 3 and 13):
//! no statement, text query, reason or idempotency key of any command, review commands included, whose journal keeps only ids,
//! enums and counts; and the manifest declares a `digest` journal on every command that carries
//! text.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::json;
use support::*;

const STATEMENT: &str = "Comfrey tea feeds tomatoes better than anything bought";
const OTHER: &str = "Nettles make a sharper tea for leafy greens";
const QUERY: &str = "comfrey tomatoes";
const QUESTION: &str = "Does comfrey tea feed tomatoes?";
const KEY: &str = "allotment-memo-1124";
const REASON: &str = "Brewed comfrey reads better than bought feed";
const REWORD: &str = "Comfrey tea feeds tomatoes as well as any feed bought in";
const STAGE_KEY: &str = "potting-shed-triage-7";

#[tokio::test]
async fn no_statement_query_or_key_is_journaled_logged_or_in_an_event() {
    let fx = Fx::new();
    let captured = fx
        .agent(
            "ideas-capture",
            json!({ "ideas": [
                { "statement": STATEMENT, "type": "position", "tags": ["tomatoes"], "said": "person" },
                { "statement": OTHER, "type": "position" },
            ], "idempotencyKey": KEY }),
        )
        .await;
    let id = data(&captured)["ideas"][0]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    data(
        &fx.agent("ideas-match", json!({ "statements": [OTHER], "ids": [id] }))
            .await,
    );
    data(
        &fx.agent("ideas-find", json!({ "text": QUERY, "order": "rank" }))
            .await,
    );
    data(&fx.agent("ideas-ask", json!({ "question": QUESTION })).await);
    data(&fx.agent("ideas-open", json!({ "id": id })).await);
    data(&fx.agent("ideas-guide", json!({})).await);
    // A review: staged with a reason and a reworded statement, shown, previewed, applied, and a
    // second proposal unstaged.
    let other = data(&captured)["ideas"][1]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let staged = fx
        .agent(
            "ideas-review-stage",
            json!({ "idempotencyKey": STAGE_KEY, "proposals": [
                { "decide": "reword", "idea": id, "version": 1, "statement": REWORD, "reason": REASON, "group": "tea" },
                { "decide": "affirm", "idea": other, "version": 1, "reason": REASON, "group": "later" },
            ] }),
        )
        .await;
    let review = data(&staged)["review"].as_str().unwrap().to_owned();
    let second = data(&staged)["proposals"][1].as_str().unwrap().to_owned();
    data(
        &fx.agent("ideas-review-show", json!({ "part": "tea" }))
            .await,
    );
    data(
        &fx.agent("ideas-review-unstage", json!({ "proposals": [second] }))
            .await,
    );
    let shown = fx.agent("ideas-review-show", json!({})).await;
    let digest = data(&shown)["digest"].as_str().unwrap().to_owned();
    let decision = json!({ "review": review, "part": "*", "digest": digest });
    data(&fx.operator("ideas-review-preview", decision.clone()).await);
    data(&fx.person("ideas-review-apply", decision).await);
    let exported = fx.operator("ideas-export", json!({})).await;
    let items = data(&exported)["items"].clone();
    data(&fx.person("ideas-import", json!({ "items": items })).await);

    let text = fx.journaled_text();
    assert!(text.contains("ideas-capture"), "the calls are journaled");
    never_mentions(
        &text,
        &[
            STATEMENT,
            OTHER,
            "Comfrey",
            "Nettles",
            QUERY,
            QUESTION,
            KEY,
            "allotment-memo",
            REASON,
            "Brewed comfrey",
            REWORD,
            STAGE_KEY,
            "potting-shed",
        ],
    );
    // The ids are kept where the manifest says.
    assert!(text.contains(&id));
    assert!(text.contains(&review));
}

#[test]
fn every_command_carrying_text_journals_a_digest() {
    let manifest: toml::Table = include_str!("../umbel-plugin.toml").parse().unwrap();
    for command in manifest["commands"].as_array().unwrap() {
        let name = command["name"].as_str().unwrap();
        let journal = command["journal"].as_table().unwrap();
        let mode = journal["mode"].as_str().unwrap();
        if name == "ideas-guide" {
            assert_eq!(mode, "plain", "ideas-guide takes no text");
            continue;
        }
        assert_eq!(mode, "digest", "{name}");
        for kept in journal["keep"].as_array().unwrap() {
            let kept = kept.as_str().unwrap();
            assert!(
                !matches!(
                    kept,
                    "statement"
                        | "statements"
                        | "ideas"
                        | "question"
                        | "text"
                        | "reason"
                        | "proposals"
                        | "items"
                        | "idempotencyKey"
                        | "name"
                ),
                "{name} keeps {kept}"
            );
        }
    }
}

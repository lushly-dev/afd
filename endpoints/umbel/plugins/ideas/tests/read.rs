//! `ideas-find` and `ideas-open` (specification, sections 7.4 and 7.5): orders, cursors, totals,
//! filters; `NOT_FOUND` alike for an idea that is absent and one the caller may not read; and
//! `pending` on every read. `ideas-ask` is step C2's.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::*;

fn ids(result: &Value) -> Vec<String> {
    data(result)["ideas"]
        .as_array()
        .unwrap()
        .iter()
        .map(|idea| idea["id"].as_str().unwrap().to_owned())
        .collect()
}

/// Five ideas: two principles about water, a position about beds with a tag, an example the
/// agent said, and a question.
async fn garden(fx: &Fx) -> Vec<String> {
    let result = fx
        .agent(
            "ideas-capture",
            json!({ "ideas": [
                { "statement": "Water when the soil asks for it, not when the calendar says so.", "type": "principle", "said": "person" },
                { "statement": "Water deeply and rarely, so roots grow down.", "type": "principle", "said": "person" },
                { "statement": "Raised beds warm earlier in spring.", "type": "position", "tags": ["beds", "spring"], "said": "person" },
                { "statement": "The north bed flooded after the March storm.", "type": "example", "tags": ["beds"], "said": "agent" },
                { "statement": "Does mulch keep slugs away?", "type": "question" },
            ] }),
        )
        .await;
    ids(&result)
}

#[tokio::test]
async fn find_orders_by_recency_and_by_id_with_cursors_and_totals() {
    let fx = Fx::new();
    let captured = garden(&fx).await;
    let by_id = fx
        .agent("ideas-find", json!({ "order": "id", "limit": 2 }))
        .await;
    let d = data(&by_id);
    assert_eq!(d["total"], 5);
    let mut sorted = captured.clone();
    sorted.sort();
    assert_eq!(ids(&by_id), sorted[..2]);
    let next = d["next"].as_str().unwrap().to_owned();
    let page_two = fx
        .agent(
            "ideas-find",
            json!({ "order": "id", "limit": 2, "after": next }),
        )
        .await;
    assert_eq!(ids(&page_two), sorted[2..4]);
    // A cursor of another order is refused on `after`.
    let wrong = fx
        .agent("ideas-find", json!({ "order": "recent", "after": next }))
        .await;
    assert_eq!(code(&wrong), "VALIDATION_ERROR");
    assert_eq!(wrong["error"]["details"]["field"], "after");
    // Recent is the default, newest first; one call's ideas share a time, so by id within it.
    let recent = fx.agent("ideas-find", json!({})).await;
    assert_eq!(ids(&recent).len(), 5);
    assert_eq!(data(&recent)["total"], 5);
    // Without a total.
    let untotalled = fx.agent("ideas-find", json!({ "total": false })).await;
    assert!(data(&untotalled)["total"].is_null());
}

#[tokio::test]
async fn find_filters_by_type_tags_said_standing_state_and_text() {
    let fx = Fx::new();
    let captured = garden(&fx).await;
    let count = |input: Value| {
        let fx = &fx;
        async move { data(&fx.agent("ideas-find", input).await)["total"].clone() }
    };
    assert_eq!(count(json!({ "type": "principle" })).await, 2);
    assert_eq!(count(json!({ "tags": ["beds"] })).await, 2);
    assert_eq!(count(json!({ "tags": ["spring", "nothing"] })).await, 1);
    assert_eq!(count(json!({ "said": "agent" })).await, 1);
    assert_eq!(count(json!({ "said": "unknown" })).await, 1);
    assert_eq!(count(json!({ "standing": ["seed"] })).await, 5);
    assert_eq!(count(json!({ "standing": ["affirmed"] })).await, 0);
    assert_eq!(count(json!({ "state": "declined" })).await, 0);
    assert_eq!(count(json!({ "text": "water" })).await, 2);
    let ranked = fx
        .agent(
            "ideas-find",
            json!({ "text": "water deeply roots", "order": "rank" }),
        )
        .await;
    assert_eq!(ids(&ranked)[0], captured[1]);
    let shown = &data(&ranked)["ideas"][0];
    assert_eq!(
        shown["statement"],
        "Water deeply and rarely, so roots grow down."
    );
    assert_eq!(shown["version"], 1);
    assert_eq!(shown["type"], "principle");
    assert_eq!(shown["said"], "person");
    assert_eq!(shown["standing"], "seed");
    assert!(shown["label"].is_object());
    // Refusals name the field, and list the valid values.
    for (input, field) in [
        (json!({ "order": "rank" }), "order"),
        (json!({ "type": "note" }), "type"),
        (json!({ "tags": ["Beds"] }), "tags"),
        (json!({ "text": "!!!" , "order": "rank" }), "text"),
    ] {
        let refused = fx.agent("ideas-find", input).await;
        assert_eq!(code(&refused), "VALIDATION_ERROR", "{refused}");
        assert_eq!(refused["error"]["details"]["field"], field, "{refused}");
    }
    let typed = fx.agent("ideas-find", json!({ "type": "note" })).await;
    assert_eq!(
        typed["error"]["details"]["valid"].as_array().unwrap().len(),
        7
    );
}

#[tokio::test]
async fn open_shows_the_idea_its_wordings_and_its_standing() {
    let fx = Fx::new();
    let captured = garden(&fx).await;
    let opened = fx.agent("ideas-open", json!({ "id": captured[2] })).await;
    let o = data(&opened);
    assert_eq!(o["id"], captured[2].as_str());
    assert_eq!(o["state"], "live");
    assert_eq!(o["type"], "position");
    assert_eq!(o["tags"], json!(["beds", "spring"]));
    assert_eq!(o["sightings"], 1);
    assert!(o["into"].is_null());
    assert_eq!(o["statement"], "Raised beds warm earlier in spring.");
    assert_eq!(o["said"], "person");
    assert_eq!(o["version"], 1);
    assert_eq!(o["standing"], "seed");
    assert_eq!(o["history"][0]["capturedAt"], "2026-01-01T00:00:00.000Z");
    assert!(o["offered"].is_array());
    assert!(o["staged"].is_null());
    assert_eq!(o["decisions"], json!([]));
}

#[tokio::test]
async fn an_absent_idea_and_an_unreadable_one_are_the_same_not_found() {
    let fx = Fx::with(&config_with(""));
    let theirs = data(
        &fx.stranger(
            "ideas-capture",
            json!({ "ideas": [{ "statement": "Sow peas early.", "type": "principle" }] }),
        )
        .await,
    )["ideas"][0]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut answers = Vec::new();
    for id in [
        theirs.as_str(),
        "idea-000000000000000000000000",
        "not-an-id",
    ] {
        let refused = fx.agent("ideas-open", json!({ "id": id })).await;
        assert_eq!(code(&refused), "NOT_FOUND");
        answers.push((
            refused["error"]["message"].clone(),
            refused["error"]["suggestion"].clone(),
        ));
    }
    assert!(
        answers.windows(2).all(|pair| pair[0] == pair[1]),
        "{answers:?}"
    );
    // Nor is it found, counted or pending for me.
    let found = fx.agent("ideas-find", json!({})).await;
    assert_eq!(data(&found)["total"], 0);
    assert_eq!(data(&found)["pending"]["unreviewed"], 0);
}

#[tokio::test]
async fn every_read_returns_pending() {
    let fx = Fx::new();
    let captured = garden(&fx).await;
    let expected = json!({ "staged": 0, "unreviewed": 5 });
    for (command, input) in [
        ("ideas-find", json!({})),
        ("ideas-open", json!({ "id": captured[0] })),
        ("ideas-match", json!({ "statements": ["Water the beds."] })),
        ("ideas-guide", json!({})),
        (
            "ideas-capture",
            json!({ "ideas": [{ "statement": "Sow peas early.", "type": "principle" }] }),
        ),
    ] {
        let result = fx.agent(command, input).await;
        let pending = &data(&result)["pending"];
        assert!(pending.is_object(), "{command}: {result}");
        if command != "ideas-capture" {
            assert_eq!(*pending, expected, "{command}");
        }
    }
}

#[tokio::test]
async fn find_and_match_fit_the_output_budget_and_page_on() {
    let fx = Fx::new();
    let statements: Vec<String> = (0..40)
        .map(|n| {
            format!("Bed {n} of the allotment wants compost and a mulch of straw every autumn.")
        })
        .collect();
    let refs: Vec<&str> = statements.iter().map(String::as_str).collect();
    fx.capture(&refs).await;
    let fitted = fx
        .agent_with_budget("ideas-find", json!({ "order": "id", "limit": 40 }), 4000)
        .await;
    let shown = ids(&fitted);
    assert!(!shown.is_empty() && shown.len() < 40, "{}", shown.len());
    assert!(fitted.to_string().len() <= 4200);
    assert_eq!(
        warning(&fitted, "RESULTS_LIMITED").unwrap()["details"]["omitted"],
        40 - shown.len()
    );
    let next = data(&fitted)["next"].as_str().unwrap().to_owned();
    let rest = fx
        .agent(
            "ideas-find",
            json!({ "order": "id", "limit": 200, "after": next }),
        )
        .await;
    assert_eq!(
        shown.len() + ids(&rest).len(),
        40,
        "the next page starts after the last shown"
    );

    let matched = fx
        .agent_with_budget(
            "ideas-match",
            json!({ "statements": ["Compost the allotment beds in autumn."], "k": 10 }),
            2500,
        )
        .await;
    let candidates = data(&matched)["results"][0]["candidates"]
        .as_array()
        .unwrap()
        .len();
    assert!(candidates < 10, "{candidates}");
    assert!(warning(&matched, "RESULTS_LIMITED").is_some());
}

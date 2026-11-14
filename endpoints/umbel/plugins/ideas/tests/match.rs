//! `ideas-match` (specification, section 7.2): statements and ids in order; an id's own idea
//! dropped from its candidates; `verifiedOnly` passed as the host's flag, never as a list of
//! standings; an id absent and one the caller may not read refused alike; nothing written.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::*;

const BEDS: &str =
    "Raised beds warm earlier in spring, so they lengthen the season in cool climates.";
const LIFTED: &str = "In cold regions a bed lifted off the ground heats up sooner after winter, which gives more growing weeks.";
const MULCH: &str = "Mulch is the cheapest irrigation I have.";

fn ids_of(candidates: &Value) -> Vec<String> {
    candidates
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["id"].as_str().unwrap().to_owned())
        .collect()
}

#[tokio::test]
async fn statements_and_ids_in_order_without_an_ids_own_idea() {
    let fx = Fx::new();
    let held = fx.capture(&[BEDS, LIFTED, MULCH]).await;
    let result = fx
        .agent(
            "ideas-match",
            json!({ "statements": ["A raised bed warms early in a cool spring."], "ids": [held[0]], "k": 2 }),
        )
        .await;
    let d = data(&result);
    let results = d["results"].as_array().unwrap();
    assert_eq!(results.len(), 2);
    assert_eq!(
        results[0]["statement"],
        "A raised bed warms early in a cool spring."
    );
    assert!(ids_of(&results[0]["candidates"]).contains(&held[0]));
    assert_eq!(results[1]["id"], held[0].as_str());
    let own = ids_of(&results[1]["candidates"]);
    assert!(!own.contains(&held[0]), "its own idea is dropped: {own:?}");
    assert!(own.len() <= 2, "k holds after the drop: {own:?}");
    assert_eq!(own[0], held[1], "the lifted bed is the nearest");
    assert_eq!(d["meaning"], "off");
    assert_eq!(d["cut"], false);
    assert_eq!(d["pending"]["unreviewed"], 3);
    // Nothing written.
    let guide = fx.agent("ideas-guide", json!({})).await;
    assert_eq!(data(&guide)["totals"]["ideas"], 3);
}

#[tokio::test]
async fn verified_only_is_the_hosts_flag() {
    let fx = Fx::new();
    fx.capture(&[BEDS]).await;
    let all = fx
        .agent("ideas-match", json!({ "statements": [LIFTED] }))
        .await;
    assert_eq!(ids_of(&data(&all)["results"][0]["candidates"]).len(), 1);
    // A seed is never verified content, whatever the caller asks: the host's flag leaves it out.
    let verified = fx
        .agent(
            "ideas-match",
            json!({ "statements": [LIFTED], "verifiedOnly": true }),
        )
        .await;
    let d = data(&verified);
    assert_eq!(d["results"][0]["candidates"], json!([]));
    assert!(
        !d["admitted"]
            .as_array()
            .unwrap()
            .contains(&json!("unverified")),
        "{d}"
    );
}

#[tokio::test]
async fn an_absent_id_and_an_unreadable_one_are_the_same_not_found() {
    // Records private to their writer, so another person's idea is not readable here.
    let fx = Fx::with(&config_with(""));
    let theirs = data(
        &fx.stranger(
            "ideas-capture",
            json!({ "ideas": [{ "statement": MULCH, "type": "position" }] }),
        )
        .await,
    )["ideas"][0]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let absent = "idea-000000000000000000000000".to_owned();
    for id in [&theirs, &absent] {
        let refused = fx.agent("ideas-match", json!({ "ids": [id] })).await;
        assert_eq!(code(&refused), "NOT_FOUND");
        assert_eq!(refused["error"]["details"]["ids"], json!([id]));
        assert_eq!(
            refused["error"]["message"], "1 idea(s) were not found",
            "the same answer for both"
        );
    }
    // Their idea is not a candidate of mine either.
    let mine = fx
        .agent("ideas-match", json!({ "statements": [MULCH] }))
        .await;
    assert_eq!(data(&mine)["results"][0]["candidates"], json!([]));
}

#[tokio::test]
async fn too_many_or_none_refuses() {
    let fx = Fx::new();
    let none = fx.agent("ideas-match", json!({})).await;
    assert_eq!(code(&none), "VALIDATION_ERROR");
    let many: Vec<String> = (0..65).map(|n| format!("Bed {n}.")).collect();
    let refused = fx.agent("ideas-match", json!({ "statements": many })).await;
    assert_eq!(code(&refused), "VALIDATION_ERROR");
    let k = fx
        .agent("ideas-match", json!({ "statements": [BEDS], "k": 11 }))
        .await;
    assert_eq!(code(&k), "VALIDATION_ERROR");
}

/// The owner's first use (amendment F-3): 64 ids in one call answered every result with no
/// candidates and `cut: false`, while groups of four worked. Fitting every result to the same
/// number of candidates had fitted them all to none. A match that cannot keep one candidate each
/// is now refused with the number of inputs that fit, never emptied.
#[tokio::test]
async fn a_match_too_large_for_its_budget_is_refused_never_emptied() {
    let fx = Fx::new();
    let statements: Vec<String> = (0..64)
        .map(|n| {
            format!(
                "Bed {n} of the allotment wants a barrow of compost and a mulch of straw before the first frost of autumn. The straw keeps the clay from capping in the winter rain, and by spring the worms have pulled most of the compost down into the top spade of soil."
            )
        })
        .collect();
    let refs: Vec<&str> = statements.iter().map(String::as_str).collect();
    let held = fx.capture(&refs).await;
    assert_eq!(held.len(), 64);

    let matched = fx.agent("ideas-match", json!({ "ids": held })).await;
    assert_eq!(code(&matched), "OUTPUT_BUDGET_EXCEEDED", "{matched}");
    let details = &matched["error"]["details"];
    assert_eq!(details["inputs"], 64);
    let fit = usize::try_from(details["fit"].as_u64().unwrap()).unwrap();
    assert!((1..64).contains(&fit), "{details}");
    let suggestion = matched["error"]["suggestion"].as_str().unwrap();
    assert!(
        suggestion.contains(&format!("at most {fit}")),
        "{suggestion}"
    );

    // The number it names fits, every result with a candidate.
    let fitted = fx.agent("ideas-match", json!({ "ids": held[..fit] })).await;
    let results = data(&fitted)["results"].as_array().unwrap().clone();
    assert_eq!(results.len(), fit);
    for result in &results {
        assert!(
            !result["candidates"].as_array().unwrap().is_empty(),
            "{result}"
        );
    }

    // Statements too: the same refusal, never a page of empty lists.
    let matched = fx
        .agent("ideas-match", json!({ "statements": statements }))
        .await;
    assert_eq!(code(&matched), "OUTPUT_BUDGET_EXCEEDED", "{matched}");
}

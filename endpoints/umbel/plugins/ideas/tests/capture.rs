//! `ideas-capture` (specification, section 7.1): one and 64 items; identical within a call;
//! identical to a held and to a declined idea is a sighting; a replay with the same key writes
//! nothing and answers the same, and finishes a call that stopped part way; candidates exclude
//! the call's own ideas; a failed match still captures, with the warning; bands at each
//! threshold; every fault refuses the call and writes nothing.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::*;

const BEDS: &str =
    "Raised beds warm earlier in spring, so they lengthen the season in cool climates.";
const LIFTED: &str = "In cold regions a bed lifted off the ground heats up sooner after winter, which gives more growing weeks.";

fn idea(statement: &str) -> Value {
    json!({ "statement": statement, "type": "position", "said": "person" })
}

async fn guide_totals(fx: &Fx) -> Value {
    data(&fx.agent("ideas-guide", json!({})).await)["totals"].clone()
}

#[tokio::test]
async fn one_idea_lands_as_a_seed_with_its_label() {
    let fx = Fx::new();
    let result = fx
        .agent(
            "ideas-capture",
            json!({ "ideas": [{ "statement": BEDS, "type": "position", "tags": ["beds", "beds"], "said": "person" }] }),
        )
        .await;
    let d = data(&result);
    assert_eq!(d["captured"], 1);
    assert_eq!(d["sightings"], 0);
    assert_eq!(d["replayed"], false);
    assert_eq!(d["meaning"], "off");
    assert_eq!(d["bandsOn"], "words");
    let first = &d["ideas"][0];
    assert_eq!(first["outcome"], "captured");
    assert_eq!(first["version"], 1);
    assert_eq!(first["standing"], "seed");
    assert_eq!(
        first["label"],
        json!({ "standing": "unverified", "affirmed": null, "source": null })
    );
    assert_eq!(first["candidates"], json!([]));
    let id = first["id"].as_str().unwrap();
    assert!(id.starts_with("idea-") && id.len() == 29, "{id}");
    assert_eq!(d["pending"], json!({ "staged": 0, "unreviewed": 1 }));

    let opened = fx.agent("ideas-open", json!({ "id": id })).await;
    let o = data(&opened);
    assert_eq!(o["statement"], BEDS);
    assert_eq!(o["tags"], json!(["beds"]), "sorted and unique");
    assert_eq!(o["said"], "person");
    assert_eq!(o["state"], "live");
    assert_eq!(o["sightings"], 1);
    assert_eq!(o["history"].as_array().unwrap().len(), 1);
    assert_eq!(o["history"][0]["role"], "held");
}

#[tokio::test]
async fn sixty_four_in_one_call_and_sixty_five_refused() {
    let fx = Fx::new();
    let many: Vec<Value> = (0..64)
        .map(|n| {
            idea(&format!(
                "Bed {n} of the allotment wants compost every autumn."
            ))
        })
        .collect();
    let result = fx.agent("ideas-capture", json!({ "ideas": many })).await;
    assert_eq!(data(&result)["captured"], 64);
    let mut more = many.clone();
    more.push(idea("One bed too many."));
    let refused = fx.agent("ideas-capture", json!({ "ideas": more })).await;
    assert_eq!(code(&refused), "VALIDATION_ERROR", "{refused}");
    assert_eq!(guide_totals(&fx).await["ideas"], 64);
}

#[tokio::test]
async fn the_same_words_within_a_call_are_one_idea_seen_twice() {
    let fx = Fx::new();
    let result = fx
        .agent(
            "ideas-capture",
            json!({ "ideas": [idea(BEDS), idea("  RAISED beds warm earlier in spring, so they lengthen the season in cool climates. ")] }),
        )
        .await;
    let d = data(&result);
    assert_eq!(d["captured"], 1);
    assert_eq!(d["sightings"], 1);
    assert_eq!(d["ideas"][1]["outcome"], "sighting");
    assert_eq!(d["ideas"][1]["id"], d["ideas"][0]["id"]);
    let opened = fx
        .agent("ideas-open", json!({ "id": d["ideas"][0]["id"] }))
        .await;
    assert_eq!(data(&opened)["sightings"], 2);
}

#[tokio::test]
async fn the_same_words_later_are_a_sighting_of_the_held_idea() {
    let fx = Fx::new();
    let ids = fx.capture(&[BEDS]).await;
    let again = fx
        .agent(
            "ideas-capture",
            json!({ "ideas": [idea(&BEDS.to_uppercase())] }),
        )
        .await;
    let d = data(&again);
    assert_eq!(d["captured"], 0);
    assert_eq!(d["sightings"], 1);
    let sighting = &d["ideas"][0];
    assert_eq!(sighting["outcome"], "sighting");
    assert_eq!(sighting["id"], ids[0].as_str());
    assert_eq!(sighting["identical"], true);
    assert_eq!(sighting["declined"], false);
    assert_eq!(sighting["standing"], "seed");
    assert_eq!(guide_totals(&fx).await["ideas"], 1);
    let opened = fx.agent("ideas-open", json!({ "id": ids[0] })).await;
    assert_eq!(data(&opened)["sightings"], 2);
}

#[tokio::test]
async fn a_replay_with_the_same_key_writes_nothing_and_answers_the_same() {
    let fx = Fx::new();
    let input = json!({
        "ideas": [idea(BEDS), idea("Mulch is the cheapest irrigation I have."), idea(BEDS)],
        "idempotencyKey": "chat-41/1",
    });
    let first = fx.agent("ideas-capture", input.clone()).await;
    let f = data(&first);
    assert_eq!(
        (f["captured"].clone(), f["sightings"].clone()),
        (json!(2), json!(1))
    );
    let second = fx.agent("ideas-capture", input.clone()).await;
    let s = data(&second);
    assert_eq!(s["replayed"], true);
    assert_eq!(s["captured"], 2);
    assert_eq!(s["sightings"], 1);
    for n in 0..3 {
        assert_eq!(s["ideas"][n]["id"], f["ideas"][n]["id"]);
        assert_eq!(s["ideas"][n]["outcome"], "replayed");
    }
    // Nothing written twice: two ideas, and the first seen twice (its sighting in the call).
    assert_eq!(guide_totals(&fx).await["ideas"], 2);
    let opened = fx
        .agent("ideas-open", json!({ "id": f["ideas"][0]["id"] }))
        .await;
    assert_eq!(data(&opened)["sightings"], 2);
    // The same key from another caller is another key: not a replay, so the space's held
    // ideas are sighted again.
    let other = fx.stranger("ideas-capture", input).await;
    let o = data(&other);
    assert_eq!(o["replayed"], false);
    assert_eq!(o["sightings"], 3);
    assert_eq!(o["ideas"][1]["outcome"], "sighting");
    assert_eq!(o["ideas"][1]["id"], f["ideas"][1]["id"]);
}

#[tokio::test]
async fn a_replayed_sighting_is_counted_once() {
    let fx = Fx::new();
    let ids = fx.capture(&[BEDS]).await;
    let input = json!({ "ideas": [idea(BEDS)], "idempotencyKey": "memo-7" });
    let first = fx.agent("ideas-capture", input.clone()).await;
    assert_eq!(data(&first)["ideas"][0]["outcome"], "sighting");
    let second = fx.agent("ideas-capture", input).await;
    assert_eq!(data(&second)["ideas"][0]["outcome"], "replayed");
    assert_eq!(data(&second)["sightings"], 1);
    let opened = fx.agent("ideas-open", json!({ "id": ids[0] })).await;
    assert_eq!(data(&opened)["sightings"], 2, "one sighting, not two");
}

#[tokio::test]
async fn candidates_name_the_nearest_held_ideas_but_never_the_calls_own() {
    let fx = Fx::new();
    let held = fx.capture(&[BEDS]).await;
    let result = fx
        .agent(
            "ideas-capture",
            json!({ "ideas": [idea(LIFTED), idea("A lifted bed in cold regions heats sooner after winter.")] }),
        )
        .await;
    let d = data(&result);
    let mine: Vec<&Value> = d["ideas"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| &i["id"])
        .collect();
    for item in d["ideas"].as_array().unwrap() {
        let candidates = item["candidates"].as_array().unwrap();
        assert!(!candidates.is_empty(), "{item}");
        assert_eq!(candidates[0]["id"], held[0].as_str());
        assert_eq!(candidates[0]["version"], 1);
        assert_eq!(candidates[0]["statement"], BEDS);
        assert_eq!(candidates[0]["type"], "principle");
        assert_eq!(candidates[0]["said"], "person");
        assert_eq!(candidates[0]["standing"], "seed");
        assert!(candidates[0]["words"].as_f64().unwrap() > 0.0);
        for candidate in candidates {
            assert!(!mine.contains(&&candidate["id"]), "{candidate}");
        }
    }
    // The first wording keeps what it was offered.
    let opened = fx.agent("ideas-open", json!({ "id": mine[0] })).await;
    let offered = &data(&opened)["offered"];
    assert_eq!(offered[0]["idea"], held[0].as_str());
    assert_eq!(offered[0]["rank"], 1);
}

#[test]
fn a_failed_match_still_captures_with_the_warning() {
    // A host cannot be made to refuse a match and accept the puts after it, so the handler is
    // called on a stub whose match fails as the host's does past its matching size.
    let stub = support::stub::Stub::default();
    stub.state.lock().unwrap().match_error = Some(umbel_sdk::HostError::Invalid(
        "RECORD_QUERY_TOO_BROAD: the kind holds more postings than a match reads".to_owned(),
    ));
    let result = stub.call(
        "ideas-capture",
        json!({ "ideas": [idea(BEDS), idea(LIFTED)] }),
    );
    let d = data(&result);
    assert_eq!(d["captured"], 2);
    assert!(d["ideas"][0]["candidates"].is_null(), "{result}");
    let warned = warning(&result, "MATCH_UNAVAILABLE").unwrap();
    assert_eq!(warned["details"]["host"], "RECORD_QUERY_TOO_BROAD");
    // Both landed: an idea and a held wording each.
    let state = stub.state.lock().unwrap();
    assert_eq!(
        state
            .records
            .keys()
            .filter(|(kind, _)| kind == "idea")
            .count(),
        2
    );
    assert_eq!(
        state
            .records
            .keys()
            .filter(|(kind, _)| kind == "wording")
            .count(),
        2
    );
    // Counts and ids only in the log.
    assert!(state.logs.iter().all(|line| !line.contains("Raised beds")));
}

#[tokio::test]
async fn bands_at_each_threshold() {
    // The words thresholds of a space's pack, set so each band is met: likely-same at 0.9,
    // related at 0.05.
    let mut fx = Fx::new();
    let held = fx.capture(&[BEDS]).await;
    fx.pack_override(
        "main",
        "data/matching.toml",
        Some("candidates = 5\nmax_candidates = 10\nprovisional = true\n[bands.words]\nlikely_same = 0.0\nrelated = 0.0\n"),
    );
    let all = fx
        .agent("ideas-match", json!({ "statements": [LIFTED] }))
        .await;
    let candidate = &data(&all)["results"][0]["candidates"][0];
    assert_eq!(candidate["id"], held[0].as_str());
    assert_eq!(candidate["band"], "likely-same", "at the threshold");
    let words = candidate["words"].as_f64().unwrap();
    fx.pack_override(
        "main",
        "data/matching.toml",
        Some(&format!("candidates = 5\nmax_candidates = 10\n[bands.words]\nlikely_same = 1.0\nrelated = {words}\n")),
    );
    let related = fx
        .agent("ideas-match", json!({ "statements": [LIFTED] }))
        .await;
    assert_eq!(
        data(&related)["results"][0]["candidates"][0]["band"],
        "related"
    );
    fx.pack_override(
        "main",
        "data/matching.toml",
        Some(&format!(
            "candidates = 5\nmax_candidates = 10\n[bands.words]\nlikely_same = 1.0\nrelated = {}\n",
            (words + 0.0001).min(1.0)
        )),
    );
    let distant = fx
        .agent("ideas-match", json!({ "statements": [LIFTED] }))
        .await;
    assert_eq!(
        data(&distant)["results"][0]["candidates"][0]["band"],
        "distant"
    );
    // An identical hit is outside the bands.
    let same = fx
        .agent("ideas-match", json!({ "statements": [BEDS] }))
        .await;
    assert_eq!(
        data(&same)["results"][0]["candidates"][0]["band"],
        "identical"
    );
}

#[tokio::test]
async fn every_fault_refuses_the_call_and_writes_nothing() {
    let fx = Fx::new();
    let faults = [
        (
            json!({ "ideas": [idea(BEDS), { "statement": "Stake dahlias before they need it.", "type": "note" }] }),
            "ideas[1].type",
        ),
        (
            json!({ "ideas": [idea(BEDS), idea("two\nlines")] }),
            "ideas[1].statement",
        ),
        (
            json!({ "ideas": [idea(&"x".repeat(601))] }),
            "ideas[0].statement",
        ),
        (json!({ "ideas": [idea("   ")] }), "ideas[0].statement"),
        (
            json!({ "ideas": [{ "statement": BEDS, "type": "position", "tags": ["Beds"] }] }),
            "ideas[0].tags",
        ),
        (
            json!({ "ideas": [{ "statement": BEDS, "type": "position", "tags": ["a","b","c","d","e","f","g","h","i"] }] }),
            "ideas[0].tags",
        ),
        (
            json!({ "ideas": [idea(BEDS)], "idempotencyKey": "" }),
            "idempotencyKey",
        ),
        (json!({ "ideas": [idea(BEDS)], "k": 11 }), "k"),
    ];
    for (input, field) in faults {
        let refused = fx.agent("ideas-capture", input).await;
        assert_eq!(code(&refused), "VALIDATION_ERROR", "{refused}");
        if refused["error"]["details"]["field"].is_string() {
            assert_eq!(refused["error"]["details"]["field"], field, "{refused}");
        }
        // The plugin's own refusals name the guide; the host's schema check refuses the rest.
        if refused["error"]["details"]["field"].is_string() {
            assert!(
                refused["error"]["suggestion"]
                    .as_str()
                    .unwrap()
                    .contains("ideas-guide"),
                "{refused}"
            );
        }
    }
    let typed = fx
        .agent(
            "ideas-capture",
            json!({ "ideas": [{ "statement": BEDS, "type": "note" }] }),
        )
        .await;
    assert!(
        typed["error"]["details"]["valid"]
            .as_array()
            .unwrap()
            .contains(&json!("position"))
    );
    assert_eq!(guide_totals(&fx).await["ideas"], 0);
}

#[test]
fn a_call_that_stopped_part_way_is_finished_by_the_same_key() {
    // The first call wrote both ideas, and its second wording is lost as if the call had stopped
    // between the idea and its wording. Sent again with the same key, it writes only the wording.
    let stub = support::stub::Stub::default();
    stub.state.lock().unwrap().match_error = Some(umbel_sdk::HostError::Busy("busy".to_owned()));
    let input = json!({ "ideas": [idea(BEDS), idea(LIFTED)], "idempotencyKey": "chat-9" });
    let first = stub.call("ideas-capture", input.clone());
    let second_idea = data(&first)["ideas"][1]["id"].as_str().unwrap().to_owned();
    let lost = ("wording".to_owned(), format!("{second_idea}.1"));
    assert!(stub.state.lock().unwrap().records.remove(&lost).is_some());
    let again = stub.call("ideas-capture", input);
    let d = data(&again);
    assert_eq!(d["replayed"], true);
    assert_eq!(d["captured"], 2);
    assert_eq!(d["ideas"][1]["id"], second_idea.as_str());
    let state = stub.state.lock().unwrap();
    assert!(state.records.contains_key(&lost), "the wording is written");
    assert_eq!(state.records.len(), 4, "and nothing else");
}

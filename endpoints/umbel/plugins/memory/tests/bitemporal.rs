//! Bitemporal reads over the commands (sections 4.1 and 4.2): the four questions, the half-open
//! boundaries, backdating, expiry measured against now, a correction of a correction,
//! `recordedAt` clamped under a stale clock, and `MEMORY_HISTORY_PURGED`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::*;

fn at(offset: i64) -> String {
    umbel_store::memory::format_instant(NOW + offset)
}

/// The ids `memory-list` returns for Ada's records as of these instants.
async fn believed(fx: &Fx, valid: Option<i64>, recorded: Option<i64>) -> Vec<String> {
    let mut as_of = json!({});
    if let Some(v) = valid {
        as_of["valid"] = json!(at(v));
    }
    if let Some(r) = recorded {
        as_of["recorded"] = json!(at(r));
    }
    let result = fx
        .person("memory-list", json!({ "mine": true, "asOf": as_of }))
        .await;
    let mut ids: Vec<String> = data(&result)["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["id"].as_str().unwrap().to_owned())
        .collect();
    ids.sort();
    ids
}

/// X, backdated ten days, superseded by Y on day 5, and Y invalidated on day 8 as of day 7.
async fn history(fx: &mut Fx) -> (String, String) {
    let x = fx
        .remember(fact(
            "Build server",
            "Server alpha runs the build.",
            json!({ "project": "ci", "validFrom": at(-10 * DAY) }),
        ))
        .await;
    fx.at(NOW + 5 * DAY);
    let y = fx
        .remember(fact(
            "Build server",
            "Server beta runs the build.",
            json!({ "project": "ci", "supersedes": [x] }),
        ))
        .await;
    fx.at(NOW + 8 * DAY);
    let invalidated = fx
        .person(
            "memory-invalidate",
            json!({ "id": y, "at": at(7 * DAY), "reason": "outdated" }),
        )
        .await;
    assert_eq!(data(&invalidated)["recordVersion"], 2, "{invalidated}");
    assert_eq!(millis(&data(&invalidated)["validUntil"]), NOW + 7 * DAY);
    (x, y)
}

#[tokio::test]
async fn the_four_questions_are_answered_from_the_versions() {
    let mut fx = Fx::new();
    let (x, y) = history(&mut fx).await;
    // What holds now, as we now believe: neither.
    assert_eq!(believed(&fx, None, None).await, Vec::<String>::new());
    // What did we believe on day 6 about today: Y, which was not yet invalidated.
    assert_eq!(believed(&fx, None, Some(6 * DAY)).await, vec![y.clone()]);
    // What do we now believe held on day 6: Y; and on day 2: X.
    assert_eq!(believed(&fx, Some(6 * DAY), None).await, vec![y.clone()]);
    assert_eq!(believed(&fx, Some(2 * DAY), None).await, vec![x.clone()]);
    // What did we believe on day 1 about five days before the start: X, backdated; Y unwritten.
    assert_eq!(
        believed(&fx, Some(-5 * DAY), Some(DAY)).await,
        vec![x.clone()]
    );
    // Before X's backdated validFrom, nothing held.
    assert_eq!(
        believed(&fx, Some(-11 * DAY), None).await,
        Vec::<String>::new()
    );
    // The same through recall.
    let recalled = fx
        .person(
            "memory-recall",
            json!({ "query": "build", "asOf": { "valid": at(2 * DAY) } }),
        )
        .await;
    assert_eq!(data(&recalled)["hits"][0]["id"], x.as_str());
    assert_eq!(data(&recalled)["hits"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn intervals_are_half_open() {
    let mut fx = Fx::new();
    let (x, y) = history(&mut fx).await;
    // At Y's validFrom, which is X's validUntil: Y and not X.
    assert_eq!(believed(&fx, Some(5 * DAY), None).await, vec![y.clone()]);
    assert_eq!(
        believed(&fx, Some(5 * DAY - 1), None).await,
        vec![x.clone()]
    );
    // At Y's validUntil it no longer holds.
    assert_eq!(
        believed(&fx, Some(7 * DAY), None).await,
        Vec::<String>::new()
    );
    // Recorded one millisecond before the supersede, X's first version was still believed,
    // valid on day 6, and Y did not exist.
    assert_eq!(
        believed(&fx, Some(6 * DAY), Some(5 * DAY - 1)).await,
        vec![x.clone()]
    );
    // Recorded at the supersede: the new beliefs.
    assert_eq!(
        believed(&fx, Some(6 * DAY), Some(5 * DAY)).await,
        vec![y.clone()]
    );
    // The versions show the closed recorded intervals meeting.
    let shown = fx
        .person("memory-show", json!({ "id": x, "history": true }))
        .await;
    let versions = data(&shown)["history"].as_array().unwrap();
    assert_eq!(versions.len(), 2);
    assert_eq!(millis(&versions[0]["recordedUntil"]), NOW + 5 * DAY);
    assert_eq!(millis(&versions[1]["recordedAt"]), NOW + 5 * DAY);
    assert_eq!(versions[1]["supersededBy"], y.as_str());
    assert_eq!(data(&shown)["state"], "invalidated");
}

#[tokio::test]
async fn expiry_is_measured_against_now_even_for_an_as_of_read() {
    let mut fx = Fx::new();
    let id = fx
        .remember(fact("Short", "Lives one day.", json!({ "ttlDays": 1 })))
        .await;
    fx.at(NOW + 2 * DAY);
    // On day 0 it was valid and believed, but it has expired since.
    assert_eq!(believed(&fx, Some(0), Some(0)).await, Vec::<String>::new());
    let with = fx
        .person(
            "memory-list",
            json!({ "mine": true, "includeExpired": true, "asOf": { "valid": at(0), "recorded": at(0) } }),
        )
        .await;
    assert_eq!(data(&with)["items"][0]["id"], id.as_str());
    let recalled = fx
        .person(
            "memory-recall",
            json!({ "query": "lives", "includeExpired": true }),
        )
        .await;
    assert_eq!(data(&recalled)["hits"][0]["id"], id.as_str());
    let shown = fx.show(&id).await;
    assert_eq!(data(&shown)["state"], "expired");
}

#[tokio::test]
async fn a_correction_of_a_correction_is_on_the_record() {
    let mut fx = Fx::new();
    let (_, y) = history(&mut fx).await;
    // Invalidated on day 7; corrected a second later to day 6, which writes a third version.
    fx.at(NOW + 8 * DAY + 1000);
    let again = fx
        .person(
            "memory-invalidate",
            json!({ "id": y, "at": at(6 * DAY), "reason": "wrong", "note": "It stopped a day earlier." }),
        )
        .await;
    assert_eq!(data(&again)["recordVersion"], 3, "{again}");
    assert_eq!(
        believed(&fx, Some(6 * DAY + DAY / 2), None).await,
        Vec::<String>::new()
    );
    assert_eq!(
        believed(&fx, Some(6 * DAY + DAY / 2), Some(8 * DAY)).await,
        vec![y.clone()],
        "before the correction we believed it held until day 7"
    );
    let shown = fx
        .person("memory-show", json!({ "id": y, "history": true }))
        .await;
    let versions = data(&shown)["history"].as_array().unwrap();
    assert_eq!(versions.len(), 3);
    assert_eq!(versions[2]["invalidation"]["reason"], "wrong");
    assert_eq!(
        versions[2]["invalidation"]["note"],
        "It stopped a day earlier."
    );
    assert_eq!(versions[2]["invalidation"]["by"], "human:ada");
    assert_eq!(versions[1]["invalidation"]["reason"], "outdated");
    // An instant not after validFrom, or after now, is refused.
    for bad in [at(5 * DAY), at(9 * DAY), "soon".to_owned()] {
        let refused = fx
            .person(
                "memory-invalidate",
                json!({ "id": y, "at": bad, "reason": "wrong" }),
            )
            .await;
        assert_eq!(code(&refused), "MEMORY_INVALID", "{bad}: {refused}");
    }
}

#[tokio::test]
async fn recorded_at_is_clamped_under_a_stale_clock() {
    let mut fx = Fx::new();
    fx.at(NOW + 8 * DAY);
    let id = fx
        .remember(fact(
            "Backdated",
            "Held from the start.",
            json!({ "validFrom": at(0) }),
        ))
        .await;
    // A process whose clock is behind the store's last write.
    fx.at(NOW + 3 * DAY);
    let result = fx
        .person(
            "memory-invalidate",
            json!({ "id": id, "reason": "outdated" }),
        )
        .await;
    assert_eq!(millis(&data(&result)["validUntil"]), NOW + 3 * DAY);
    let shown = fx
        .person("memory-show", json!({ "id": id, "history": true }))
        .await;
    let versions: &Vec<Value> = data(&shown)["history"].as_array().unwrap();
    // The new version is recorded no earlier than the one it closes: no inverted interval.
    assert_eq!(millis(&versions[1]["recordedAt"]), NOW + 8 * DAY);
    assert_eq!(millis(&versions[0]["recordedUntil"]), NOW + 8 * DAY);
    assert_eq!(millis(&versions[1]["invalidation"]["at"]), NOW + 8 * DAY);
}

#[tokio::test]
async fn a_read_older_than_history_reaches_says_so() {
    let fx = Fx::new();
    fx.remember(fact("Any", "A record.", json!({}))).await;
    let read = |classes: Value, valid: i64| {
        fx.person(
            "memory-list",
            json!({ "classes": classes, "asOf": { "valid": at(valid) } }),
        )
    };
    // Semantic records are purged 90 days after they lapse; episodic ones after 30.
    let old = read(json!(["semantic"]), -100 * DAY).await;
    let purged = warning(&old, "MEMORY_HISTORY_PURGED").unwrap();
    assert_eq!(millis(&purged["details"]["before"]), NOW - 90 * DAY);
    let recent = read(json!(["semantic"]), -40 * DAY).await;
    assert!(
        warning(&recent, "MEMORY_HISTORY_PURGED").is_none(),
        "{recent}"
    );
    let episodic = read(json!(["episodic", "semantic"]), -40 * DAY).await;
    let purged = warning(&episodic, "MEMORY_HISTORY_PURGED").unwrap();
    assert_eq!(millis(&purged["details"]["before"]), NOW - 30 * DAY);
    let recalled = fx
        .person(
            "memory-recall",
            json!({ "query": "record", "asOf": { "recorded": at(-31 * DAY) } }),
        )
        .await;
    assert!(
        warning(&recalled, "MEMORY_HISTORY_PURGED").is_some(),
        "{recalled}"
    );
    // memory-show measures by the record's own class.
    let id = fx
        .remember(fact("Shown", "A shown record.", json!({})))
        .await;
    let shown = |valid: i64| {
        fx.person(
            "memory-show",
            json!({ "id": id, "asOf": { "valid": at(valid) } }),
        )
    };
    assert!(warning(&shown(-40 * DAY).await, "MEMORY_HISTORY_PURGED").is_none());
    let old = shown(-91 * DAY).await;
    let purged = warning(&old, "MEMORY_HISTORY_PURGED").unwrap();
    assert_eq!(millis(&purged["details"]["before"]), NOW - 90 * DAY);
}

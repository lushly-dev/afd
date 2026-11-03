//! Events of the writing commands (section 8.10): `memory-remember` names the record with the
//! record's access and the input's session; `memory-capture` names the capture with private
//! access; `event-list` filters them by that access; no event holds text; a replay makes none;
//! an observation makes one; the reading commands make none.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::*;

fn capture(key: &str) -> Value {
    json!({
        "version": 1,
        "harness": { "name": "claude-code", "version": "2.1.309" },
        "event": "stop",
        "session": "s-9",
        "project": "afd",
        "idempotencyKey": key,
        "episodes": [{ "subject": "canaryepisodesubjectq", "text": "canaryepisodetextq" }],
        "decisions": [{ "subject": "s", "text": "canarydecisionq", "constraints": ["canaryconstraintq"] }],
    })
}

/// The events `actor` reads in `main` through `event-list`.
async fn listed(fx: &Fx, actor: afd::Actor) -> Vec<Value> {
    let result = fx
        .as_actor(actor, "event-list", json!({ "space": "main" }))
        .await;
    data(&result)["events"].as_array().unwrap().clone()
}

#[tokio::test]
async fn a_remember_event_names_the_record_with_its_access_and_session() {
    let fx = Fx::new();
    let result = fx
        .person(
            "memory-remember",
            fact(
                "canarysubjectq",
                "canarytextq",
                json!({ "session": "s-1", "project": "afd", "tags": ["canarytagq"],
                        "sources": [{ "resource": "canarysourceq" }], "constraints": ["canaryconstraintq"] }),
            ),
        )
        .await;
    let id = data(&result)["id"].clone();
    let events = fx.events("main");
    assert_eq!(events.len(), 1);
    let event = &events[0];
    assert_eq!(event["command"], "memory-remember");
    assert_eq!(
        event["record"],
        json!({ "kind": "memory", "id": id, "version": 1 })
    );
    assert_eq!(event["changes"]["store"], "memory");
    assert_eq!(event["changes"]["count"], 1);
    let provenance = &event["provenance"];
    assert_eq!(provenance["access"], json!(["principal:human:ada"]));
    assert_eq!(provenance["session"], "s-1");
    assert_eq!(provenance["authority"], "person");
    assert_eq!(provenance["origin"], "user-stated");
    for field in [
        "sources",
        "contentHash",
        "derivedFrom",
        "constraints",
        "generated",
    ] {
        assert!(provenance[field].is_null(), "{field}: {event}");
    }
    never_mentions(
        &fx.journaled_text(),
        &[
            "canarysubjectq",
            "canarytextq",
            "canarytagq",
            "canarysourceq",
            "canaryconstraintq",
        ],
    );
}

#[tokio::test]
async fn a_capture_event_names_the_capture_and_is_private() {
    let fx = Fx::with(&config("default_access = \"space\""));
    let result = fx.person("memory-capture", capture("k1")).await;
    let d = data(&result);
    let events = fx.events("main");
    assert_eq!(events.len(), 1);
    let event = &events[0];
    assert_eq!(event["command"], "memory-capture");
    assert_eq!(event["record"]["kind"], "capture");
    assert_eq!(event["record"]["id"], d["captureId"]);
    assert_eq!(event["record"]["version"], event["changes"]["toRev"]);
    assert_eq!(event["changes"]["count"], 2);
    assert_eq!(
        event["provenance"]["access"],
        json!(["principal:human:ada"])
    );
    assert_eq!(event["provenance"]["session"], "s-9");
    assert_eq!(event["provenance"]["authority"], "transcript");
    // The event lists no record ids: they are in the result.
    let text = event.to_string();
    for id in d["records"].as_array().unwrap() {
        assert!(!text.contains(id.as_str().unwrap()), "{text}");
    }
    never_mentions(
        &fx.journaled_text(),
        &[
            "canaryepisodesubjectq",
            "canaryepisodetextq",
            "canarydecisionq",
            "canaryconstraintq",
        ],
    );
    // A replay makes no event; an observation under a new key makes one.
    let replay = fx.person("memory-capture", capture("k1")).await;
    assert_eq!(data(&replay)["replayed"], 2);
    assert_eq!(fx.events("main").len(), 1);
    let observed = fx.person("memory-capture", capture("k2")).await;
    assert_eq!(data(&observed)["observed"], 2);
    assert_eq!(fx.events("main").len(), 2);
}

#[tokio::test]
async fn event_list_filters_by_the_records_access() {
    let fx = Fx::new();
    fx.remember(fact("Private", "Ada's own note.", json!({})))
        .await;
    fx.remember(fact("Shared", "For everyone.", json!({ "share": "space" })))
        .await;
    fx.person("memory-capture", capture("k")).await;
    assert_eq!(fx.events("main").len(), 3);
    let ada = listed(&fx, human("ada")).await;
    assert_eq!(ada.len(), 3);
    // Ada's agent acts for ada and reads the same.
    assert_eq!(listed(&fx, agent_for("bot", "ada")).await.len(), 3);
    // Bob reads only the shared record's event.
    let bob = listed(&fx, human("bo")).await;
    assert_eq!(bob.len(), 1, "{bob:?}");
    assert_eq!(bob[0]["provenance"]["access"], json!(["space"]));
}

#[tokio::test]
async fn reads_and_refusals_make_no_event() {
    let fx = Fx::new();
    let id = fx.remember(fact("One", "One record.", json!({}))).await;
    assert_eq!(fx.events("main").len(), 1);
    fx.show(&id).await;
    fx.person("memory-status", json!({})).await;
    let refused = fx
        .person(
            "memory-remember",
            fact("s", "t", json!({ "ttlDays": 100_000 })),
        )
        .await;
    assert_eq!(refused["success"], false);
    let replay_key = fact("Twice", "Written twice.", json!({ "idempotencyKey": "x" }));
    fx.agent("memory-remember", replay_key.clone()).await;
    fx.agent("memory-remember", replay_key).await;
    assert_eq!(fx.events("main").len(), 2);
}

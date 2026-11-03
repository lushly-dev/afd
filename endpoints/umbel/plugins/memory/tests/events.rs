//! Events (section 8.10): `memory-remember` names the record with the record's access and the
//! input's session; `memory-capture` names the capture with private access; `memory-invalidate`
//! and `memory-confirm` name the record with its access and no session, the confirmation with
//! the host's authority and `confirmation`; `memory-forget` names the erasure by trace id, private,
//! with no ids; `memory-sweep` names the space, readable by the space, with counts only;
//! `event-list` filters them by that access; no event holds text; a replay, a forget that found
//! nothing, an empty sweep, a reindex and every read make none.
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

#[tokio::test]
async fn invalidate_and_confirm_events_name_the_record_with_its_access() {
    let mut fx = Fx::new();
    let note = fx
        .agent(
            "memory-remember",
            fact(
                "canarynotesubjectq",
                "canarynotetextq",
                json!({ "session": "s-1" }),
            ),
        )
        .await;
    let id = data(&note)["id"].as_str().unwrap().to_owned();
    let hash = fx.record(&id).await["contentHash"]
        .as_str()
        .unwrap()
        .to_owned();
    let (confirmed, _) = fx
        .terminal(
            "memory-confirm",
            json!({ "id": id, "contentHash": hash }),
            true,
        )
        .await;
    assert_eq!(data(&confirmed)["recordVersion"], 2, "{confirmed}");
    // An invalidation must follow validFrom.
    fx.at(NOW + 1000);
    let invalidated = fx
        .person(
            "memory-invalidate",
            json!({ "id": id, "reason": "outdated", "note": "canarynoteq" }),
        )
        .await;
    assert_eq!(data(&invalidated)["recordVersion"], 3, "{invalidated}");
    let events = fx.events("main");
    assert_eq!(events.len(), 3);
    let confirm = &events[1];
    assert_eq!(confirm["command"], "memory-confirm");
    assert_eq!(
        confirm["record"],
        json!({ "kind": "memory", "id": id, "version": 2 })
    );
    assert_eq!(confirm["changes"]["store"], "memory");
    assert_eq!(
        confirm["provenance"]["access"],
        json!(["principal:human:ada"])
    );
    assert!(confirm["provenance"]["session"].is_null(), "{confirm}");
    assert_eq!(confirm["provenance"]["authority"], "person");
    let confirmation = &confirm["provenance"]["confirmation"];
    assert_eq!(confirmation["by"], "human:ada");
    assert_eq!(confirmation["priorAuthority"], "agent");
    let invalidate = &events[2];
    assert_eq!(invalidate["command"], "memory-invalidate");
    assert_eq!(
        invalidate["record"],
        json!({ "kind": "memory", "id": id, "version": 3 })
    );
    assert!(invalidate["provenance"]["session"].is_null());
    // The host assigned no authority in an invalidate.
    assert!(
        invalidate["provenance"]["authority"].is_null(),
        "{invalidate}"
    );
    assert!(invalidate["provenance"]["confirmation"].is_null());
    for event in &events {
        for field in [
            "sources",
            "contentHash",
            "derivedFrom",
            "constraints",
            "generated",
        ] {
            assert!(event["provenance"][field].is_null(), "{field}: {event}");
        }
    }
    never_mentions(
        &fx.journaled_text(),
        &[
            "canarynotesubjectq",
            "canarynotetextq",
            "canarynoteq",
            &hash["sha256:".len()..][..16],
        ],
    );
}

#[tokio::test]
async fn a_forget_event_names_the_erasure_and_lists_no_ids() {
    let fx = Fx::new();
    let a = fx.remember(fact("canaryforgetq", "One.", json!({}))).await;
    let b = fx.remember(fact("Two", "Two.", json!({}))).await;
    let result = fx.person("memory-forget", json!({ "ids": [a, b] })).await;
    assert_eq!(data(&result)["erased"], 2);
    let events = fx.events("main");
    assert_eq!(events.len(), 3);
    let event = &events[2];
    assert_eq!(event["command"], "memory-forget");
    assert_eq!(event["record"]["kind"], "memory-erasure");
    assert_eq!(event["record"]["id"], event["traceId"]);
    assert_eq!(event["record"]["version"], event["changes"]["toRev"]);
    assert_eq!(event["changes"]["store"], "memory");
    assert_eq!(event["changes"]["count"], 2);
    assert_eq!(
        event["provenance"]["access"],
        json!(["principal:human:ada"])
    );
    assert!(event["provenance"]["session"].is_null());
    let text = event.to_string();
    assert!(!text.contains(&a) && !text.contains(&b), "{text}");
    never_mentions(&fx.journaled_text(), &["canaryforgetq"]);
    // A forget that finds nothing makes no event.
    fx.person("memory-forget", json!({ "ids": [a] })).await;
    assert_eq!(fx.events("main").len(), 3);
    // Bo does not read Ada's erasure.
    let bo = listed(&fx, human("bo")).await;
    assert!(bo.iter().all(|e| e["command"] != "memory-forget"), "{bo:?}");
}

#[tokio::test]
async fn a_sweep_event_is_the_spaces_with_counts_only() {
    let mut fx = Fx::new();
    for n in 0..2 {
        fx.remember(json!({ "class": "episodic", "subject": format!("canarysweepq {n}"), "text": "A run." }))
            .await;
    }
    fx.at(NOW + 61 * DAY);
    let swept = fx.cli_person("memory-sweep", json!({})).await;
    assert_eq!(data(&swept)["purged"], 2, "{swept}");
    let events = fx.events("main");
    assert_eq!(events.len(), 3);
    let event = &events[2];
    assert_eq!(event["command"], "memory-sweep");
    assert_eq!(event["record"]["kind"], "memory-sweep");
    assert_eq!(event["record"]["id"], "main");
    assert_eq!(event["changes"]["store"], "memory");
    assert_eq!(event["changes"]["count"], 2);
    assert_eq!(event["provenance"]["access"], json!(["space"]));
    // Anyone who reads the space reads that a sweep ran, and nothing of what it purged.
    let bo = listed(&fx, human("bo")).await;
    assert_eq!(bo.len(), 1, "{bo:?}");
    assert_eq!(bo[0]["command"], "memory-sweep");
    never_mentions(&fx.journaled_text(), &["canarysweepq"]);
    // An empty sweep, a reindex and the reads make no event.
    fx.cli_person("memory-sweep", json!({})).await;
    fx.cli_person("memory-reindex", json!({})).await;
    fx.person("memory-recall", json!({ "query": "run" })).await;
    fx.person("memory-list", json!({})).await;
    assert_eq!(fx.events("main").len(), 3);
}

//! Cursors and the cursor consumers (specification sections 3, 6 and 10, `cursors.rs`).
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use afd::{Actor, ActorKind, CommandResult};
use serde_json::{Value, json};
use std::fs;
use support::*;
use umbel::{Host, HostBuilder};

fn sealed(dir: &std::path::Path) -> Host {
    HostBuilder::open(dir)
        .unwrap()
        .register(remember("note-remember"))
        .seal()
        .unwrap()
}

async fn remember_n(host: &Host, space: &str, count: usize) {
    for index in 0..count {
        let result = call(
            host,
            agent("writer"),
            "note-remember",
            json!({"space": space, "text": format!("r{index}")}),
        )
        .await;
        assert!(result.success);
    }
}

fn data(result: CommandResult<Value>) -> Value {
    assert!(result.success, "{result:?}");
    result.data.unwrap()
}

fn code(result: CommandResult<Value>) -> String {
    assert!(!result.success, "{result:?}");
    let error = result.error.unwrap();
    assert!(error.suggestion.is_some(), "{error:?}");
    error.code
}

#[tokio::test]
async fn an_empty_stream_answers_the_zero_cursor_everywhere() {
    let dir = minimal();
    let host = sealed(dir.path());
    let listed = data(call(&host, agent("a"), "event-list", json!({})).await);
    assert_eq!(listed["space"], "main");
    assert_eq!(listed["consumer"], "default");
    assert_eq!(listed["events"], json!([]));
    assert_eq!(listed["cursor"], "v0:main:0");
    assert_eq!(listed["acknowledged"], "v0:main:0");
    assert_eq!(listed["head"], "v0:main:0");
    assert_eq!(listed["hasMore"], false);
    let spaces = data(call(&host, agent("a"), "space-list", json!({})).await);
    assert_eq!(spaces["spaces"][0]["head"], "v0:main:0");
    assert_eq!(spaces["spaces"][0]["events"], 0);
}

#[tokio::test]
async fn paging_with_limit_has_more_and_head() {
    let dir = minimal();
    let host = sealed(dir.path());
    remember_n(&host, "main", 5).await;
    let reader = agent("reader");

    let first = data(call(&host, reader.clone(), "event-list", json!({"limit": 2})).await);
    assert_eq!(first["events"].as_array().unwrap().len(), 2);
    assert_eq!(first["cursor"], "v0:main:2");
    assert_eq!(first["head"], "v0:main:5");
    assert_eq!(first["hasMore"], true);
    assert_eq!(first["acknowledged"], "v0:main:0", "cursor is not stored");
    let validator = schema_validator("event.v1");
    for event in first["events"].as_array().unwrap() {
        assert_event_valid(&validator, event);
    }

    let second = data(
        call(
            &host,
            reader.clone(),
            "event-list",
            json!({"limit": 2, "after": first["cursor"]}),
        )
        .await,
    );
    let seqs: Vec<u64> = second["events"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["seq"].as_u64().unwrap())
        .collect();
    assert_eq!(seqs, [3, 4]);
    assert_eq!(second["hasMore"], true);

    let last = data(
        call(
            &host,
            reader.clone(),
            "event-list",
            json!({"after": second["cursor"]}),
        )
        .await,
    );
    assert_eq!(last["events"].as_array().unwrap().len(), 1);
    assert_eq!(last["cursor"], "v0:main:5");
    assert_eq!(last["hasMore"], false);

    // At the head: nothing, and the cursor is the one asked after.
    let none = data(call(&host, reader, "event-list", json!({"after": "v0:main:5"})).await);
    assert_eq!(none["events"], json!([]));
    assert_eq!(none["cursor"], "v0:main:5");
}

#[tokio::test]
async fn without_after_reading_starts_after_the_acknowledged_cursor() {
    let dir = minimal();
    let host = sealed(dir.path());
    remember_n(&host, "main", 4).await;
    let reader = agent("reader");

    let acked = data(
        call(
            &host,
            reader.clone(),
            "event-ack",
            json!({"cursor": "v0:main:3"}),
        )
        .await,
    );
    assert_eq!(acked["acknowledged"], "v0:main:3");
    assert_eq!(acked["previous"], "v0:main:0");
    assert_eq!(acked["consumer"], "default");

    let listed = data(call(&host, reader.clone(), "event-list", json!({})).await);
    assert_eq!(listed["acknowledged"], "v0:main:3");
    assert_eq!(listed["events"].as_array().unwrap().len(), 1);
    assert_eq!(listed["events"][0]["seq"], 4);

    // An earlier cursor replays; `previous` reports what was stored.
    let replay = data(
        call(
            &host,
            reader.clone(),
            "event-ack",
            json!({"cursor": "v0:main:1"}),
        )
        .await,
    );
    assert_eq!(replay["previous"], "v0:main:3");
    let listed = data(call(&host, reader, "event-list", json!({})).await);
    assert_eq!(listed["events"].as_array().unwrap().len(), 3);
}

#[tokio::test]
async fn principals_and_consumers_are_independent() {
    let dir = minimal();
    let host = sealed(dir.path());
    remember_n(&host, "main", 3).await;
    let (ada, grace) = (agent("ada"), agent("grace"));
    let human_ada = Actor::new(ActorKind::Human).with_id("ada");

    call(
        &host,
        ada.clone(),
        "event-ack",
        json!({"cursor": "v0:main:3"}),
    )
    .await;
    call(
        &host,
        ada.clone(),
        "event-ack",
        json!({"cursor": "v0:main:1", "consumer": "session-2"}),
    )
    .await;

    let acknowledged = |result: Value| result["acknowledged"].as_str().unwrap().to_owned();
    assert_eq!(
        acknowledged(data(
            call(&host, ada.clone(), "event-list", json!({})).await
        )),
        "v0:main:3"
    );
    assert_eq!(
        acknowledged(data(
            call(&host, ada, "event-list", json!({"consumer": "session-2"})).await
        )),
        "v0:main:1"
    );
    assert_eq!(
        acknowledged(data(call(&host, grace, "event-list", json!({})).await)),
        "v0:main:0",
        "another principal has its own"
    );
    assert_eq!(
        acknowledged(data(call(&host, human_ada, "event-list", json!({})).await)),
        "v0:main:0",
        "the actor kind is part of the principal"
    );
    // A call with no principal has no acknowledged cursor.
    let bare = host.registry().execute("event-list", json!({}), None).await;
    assert_eq!(data(bare)["acknowledged"], "v0:main:0");
}

#[tokio::test]
async fn spaces_have_their_own_streams_and_cursors() {
    let dir = two_spaces();
    let host = sealed(dir.path());
    remember_n(&host, "main", 2).await;
    remember_n(&host, "second", 1).await;
    let reader = agent("reader");
    call(
        &host,
        reader.clone(),
        "event-ack",
        json!({"cursor": "v0:main:2"}),
    )
    .await;
    let main = data(call(&host, reader.clone(), "event-list", json!({})).await);
    let second = data(
        call(
            &host,
            reader.clone(),
            "event-list",
            json!({"space": "second"}),
        )
        .await,
    );
    assert_eq!(main["acknowledged"], "v0:main:2");
    assert_eq!(second["acknowledged"], "v0:second:0");
    assert_eq!(second["events"].as_array().unwrap().len(), 1);
    let spaces = data(call(&host, reader, "space-list", json!({})).await);
    assert_eq!(spaces["spaces"][0]["id"], "main");
    assert_eq!(spaces["spaces"][0]["events"], 2);
    assert_eq!(spaces["spaces"][1]["head"], "v0:second:1");
}

#[tokio::test]
async fn the_cursor_file_validates_and_sits_at_the_hashed_path() {
    let dir = minimal();
    let host = sealed(dir.path());
    remember_n(&host, "main", 1).await;
    call(
        &host,
        agent("ada"),
        "event-ack",
        json!({"cursor": "v0:main:1", "consumer": "c.1"}),
    )
    .await;
    let cursors = dir.path().join("state/spaces/main/cursors");
    let files: Vec<_> = fs::read_dir(&cursors).unwrap().flatten().collect();
    assert_eq!(files.len(), 1, "no temporary file stays behind");
    let name = files[0].file_name().to_string_lossy().into_owned();
    let stem = name.strip_suffix(".json").unwrap();
    assert_eq!(stem.len(), 64);
    assert!(
        stem.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    );
    let file: Value = serde_json::from_str(&fs::read_to_string(files[0].path()).unwrap()).unwrap();
    let validator = schema_validator("cursor-file.v0");
    assert!(validator.is_valid(&file), "{file}");
    assert_eq!(file["actor"], json!({"kind": "agent", "id": "ada"}));
    assert_eq!(file["consumer"], "c.1");
    assert_eq!(file["cursor"], "v0:main:1");
}

#[tokio::test]
async fn bad_cursors_spaces_and_arguments_are_refused_with_suggestions() {
    let dir = two_spaces();
    let host = sealed(dir.path());
    remember_n(&host, "main", 2).await;
    let reader = agent("reader");

    for bad in [
        "v0:second:0",
        "v0:main:3",
        "v0:main:01",
        "v1:main:1",
        "nonsense",
        "",
    ] {
        assert_eq!(
            code(call(&host, reader.clone(), "event-list", json!({"after": bad})).await),
            "INVALID_CURSOR",
            "after {bad:?}"
        );
        assert_eq!(
            code(call(&host, reader.clone(), "event-ack", json!({"cursor": bad})).await),
            "INVALID_CURSOR",
            "cursor {bad:?}"
        );
    }
    // Nothing was stored by the refused acknowledgements.
    let listed = data(call(&host, reader.clone(), "event-list", json!({})).await);
    assert_eq!(listed["acknowledged"], "v0:main:0");

    for (command, input) in [
        ("event-list", json!({"space": "nope"})),
        ("event-ack", json!({"space": "nope", "cursor": "v0:nope:0"})),
    ] {
        assert_eq!(
            code(call(&host, reader.clone(), command, input).await),
            "SPACE_NOT_FOUND",
            "{command}"
        );
    }
    for bad in [
        json!({"limit": 0}),
        json!({"limit": 1001}),
        json!({"consumer": "Upper"}),
        json!({"consumer": ""}),
    ] {
        assert_eq!(
            code(call(&host, reader.clone(), "event-list", bad).await),
            "VALIDATION_ERROR"
        );
    }
    assert_eq!(
        code(
            call(
                &host,
                reader.clone(),
                "event-ack",
                json!({"cursor": "v0:main:0", "consumer": "a b"})
            )
            .await
        ),
        "VALIDATION_ERROR"
    );
    assert_eq!(
        code(call(&host, reader, "event-ack", json!({})).await),
        "VALIDATION_ERROR"
    );
}

#[tokio::test]
async fn event_list_returns_at_most_a_thousand_events() {
    let dir = minimal();
    let host = sealed(dir.path());
    // Seed the stream through the projection itself.
    for index in 0..1005 {
        host.registry()
            .execute("note-remember", json!({"text": format!("{index}")}), None)
            .await;
    }
    let page = data(call(&host, agent("r"), "event-list", json!({"limit": 1000})).await);
    assert_eq!(page["events"].as_array().unwrap().len(), 1000);
    assert_eq!(page["hasMore"], true);
    assert_eq!(page["head"], "v0:main:1005");
}

#[tokio::test]
async fn event_ack_needs_a_caller_with_an_id() {
    let dir = minimal();
    let host = sealed(dir.path());
    let bare = host
        .registry()
        .execute("event-ack", json!({"cursor": "v0:main:0"}), None)
        .await;
    let error = bare.error.unwrap();
    assert_eq!(error.code, "UNAUTHORIZED");
    assert_eq!(
        error.suggestion.as_deref(),
        Some("Call through Host::context(actor) with an actor that has an id.")
    );
    let anonymous = Actor::new(ActorKind::Agent);
    let result = call(
        &host,
        anonymous,
        "event-ack",
        json!({"cursor": "v0:main:0"}),
    )
    .await;
    assert_eq!(result.error.unwrap().code, "UNAUTHORIZED");
    assert!(
        fs::read_dir(dir.path().join("state/spaces/main/cursors"))
            .unwrap()
            .next()
            .is_none()
    );
}

#[tokio::test]
async fn a_damaged_stored_cursor_does_not_block_acknowledging_again() {
    let dir = minimal();
    let host = sealed(dir.path());
    remember_n(&host, "main", 1).await;
    call(
        &host,
        agent("ada"),
        "event-ack",
        json!({"cursor": "v0:main:1"}),
    )
    .await;
    let file = fs::read_dir(dir.path().join("state/spaces/main/cursors"))
        .unwrap()
        .flatten()
        .next()
        .unwrap()
        .path();
    fs::write(&file, "not json").unwrap();
    assert_eq!(
        code(call(&host, agent("ada"), "event-list", json!({})).await),
        "INVALID_CURSOR"
    );
    let again = data(
        call(
            &host,
            agent("ada"),
            "event-ack",
            json!({"cursor": "v0:main:1"}),
        )
        .await,
    );
    assert_eq!(again["previous"], "v0:main:0");
    assert_eq!(
        data(call(&host, agent("ada"), "event-list", json!({})).await)["acknowledged"],
        "v0:main:1"
    );
}

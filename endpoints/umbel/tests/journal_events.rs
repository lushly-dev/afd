//! The journal and the event log (specification sections 6 and 10, `journal_events.rs`).
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use afd::CommandInterface;
use serde_json::{Value, json};
use std::fs;
use support::*;
use umbel::HostBuilder;

fn seal_with_fixtures(dir: &std::path::Path) -> umbel::Host {
    HostBuilder::open(dir)
        .unwrap()
        .register(remember("note-remember"))
        .register(failing_mutation("note-explode"))
        .register(fixture("note-peek", |_, _| afd::success(json!({}))))
        .seal()
        .unwrap()
}

#[tokio::test]
async fn events_only_for_successful_mutations_in_the_right_stream() {
    let dir = two_spaces();
    let host = seal_with_fixtures(dir.path());
    let validator = schema_validator("event.v0");
    let actor = agent("local");

    let first = call(&host, actor.clone(), "note-remember", json!({"text": "a"})).await;
    assert!(first.success);
    let second = call(
        &host,
        actor.clone(),
        "note-remember",
        json!({"space": "second", "text": "b"}),
    )
    .await;
    assert!(second.success);
    assert!(
        !call(&host, actor.clone(), "note-explode", json!({}))
            .await
            .success
    );
    call(&host, actor.clone(), "note-peek", json!({})).await;
    call(&host, actor.clone(), "event-list", json!({})).await;
    call(
        &host,
        actor.clone(),
        "event-ack",
        json!({"cursor": "v0:main:1"}),
    )
    .await;
    // A read and a failed call are journaled; none of the above made an event but the two writes.
    let journal = journal_entries(dir.path());
    assert_eq!(
        journal.iter().map(|e| e.seq).collect::<Vec<_>>(),
        (1..=journal.len() as u64).collect::<Vec<_>>()
    );
    let commands: Vec<&str> = journal.iter().map(|e| e.command.as_str()).collect();
    assert_eq!(
        commands,
        [
            "note-remember",
            "note-remember",
            "note-explode",
            "note-peek",
            "event-list",
            "event-ack"
        ]
    );
    assert!(!journal[2].result.success, "failures are journaled");

    let main = events(dir.path(), "main");
    let other = events(dir.path(), "second");
    assert_eq!((main.len(), other.len()), (1, 1));
    for event in main.iter().chain(&other) {
        assert_event_valid(&validator, event);
    }
    assert_eq!(main[0]["id"], "main:1");
    assert_eq!(main[0]["cursor"], "v0:main:1");
    assert_eq!(main[0]["journalSeq"], 1);
    assert_eq!(main[0]["command"], "note-remember");
    assert_eq!(main[0]["actor"], json!({"kind": "agent", "id": "local"}));
    assert_eq!(main[0]["record"], json!({"kind": "memory", "id": "a"}));
    assert_eq!(main[0]["provenance"]["origin"], "unspecified");
    assert_eq!(main[0]["provenance"]["space"], "main");
    assert_eq!(
        main[0]["provenance"]["agent"],
        json!({"kind": "agent", "id": "local"})
    );
    assert_eq!(main[0]["provenance"]["principal"], Value::Null);
    assert_eq!(main[0]["provenance"]["traceId"], main[0]["traceId"]);
    assert_eq!(main[0]["provenance"]["observedAt"], main[0]["timestamp"]);
    assert_eq!(other[0]["id"], "second:1");
    assert_eq!(other[0]["journalSeq"], 2);
    assert_eq!(other[0]["provenance"]["space"], "second");
}

#[tokio::test]
async fn record_and_provenance_come_from_the_result_metadata() {
    let dir = minimal();
    let host = seal_with_fixtures(dir.path());
    let actor = afd::Actor::new(afd::ActorKind::Agent)
        .with_id("local")
        .with_on_behalf_of("ada");
    let result = call(
        &host,
        actor,
        "note-remember",
        json!({"text": "m1", "origin": "user-stated", "confidence": "0.8", "session": "s-9"}),
    )
    .await;
    assert!(result.success);
    let event = &events(dir.path(), "main")[0];
    assert_event_valid(&schema_validator("event.v0"), event);
    let provenance = &event["provenance"];
    assert_eq!(provenance["origin"], "user-stated");
    assert_eq!(provenance["confidence"], 0.8);
    assert_eq!(provenance["session"], "s-9");
    assert_eq!(provenance["principal"], "ada");
    assert_eq!(provenance["validFrom"], Value::Null);
    assert_eq!(provenance["authority"], Value::Null);

    // A human acts for themself; a value of the wrong type reads as absent.
    let human = afd::Actor::new(afd::ActorKind::Human).with_id("grace");
    call(
        &host,
        human,
        "note-remember",
        json!({"text": "m2", "origin": "made-up", "confidence": "7"}),
    )
    .await;
    let second = &events(dir.path(), "main")[1];
    assert_eq!(second["provenance"]["origin"], "unspecified");
    assert_eq!(second["provenance"]["confidence"], Value::Null);
    assert_eq!(second["provenance"]["principal"], "grace");
    assert_eq!(second["provenance"]["agent"], Value::Null);
}

#[tokio::test]
async fn a_bare_execute_without_a_principal_is_still_projected() {
    let dir = minimal();
    let host = seal_with_fixtures(dir.path());
    host.registry()
        .execute("note-remember", json!({"text": "x"}), None)
        .await;
    let event = &events(dir.path(), "main")[0];
    assert_event_valid(&schema_validator("event.v0"), event);
    assert!(event.get("actor").is_none());
    assert!(event.get("traceId").is_none());
    assert_eq!(event["provenance"]["traceId"], Value::Null);
}

#[tokio::test]
async fn event_rebuild_is_journaled_but_never_projected() {
    let dir = minimal();
    let host = seal_with_fixtures(dir.path());
    call(&host, agent("local"), "note-remember", json!({"text": "a"})).await;
    let rebuilt = host
        .registry()
        .execute(
            "event-rebuild",
            json!({}),
            Some(host.context(agent("local"))),
        )
        .await;
    assert!(rebuilt.success, "{rebuilt:?}");
    assert_eq!(events(dir.path(), "main").len(), 1);
    let journal = journal_entries(dir.path());
    assert_eq!(journal.last().unwrap().command, "event-rebuild");
}

#[tokio::test]
async fn an_agent_cannot_reach_event_rebuild_but_the_cli_and_host_code_can() {
    let dir = minimal();
    let host = seal_with_fixtures(dir.path());
    let agent_client = afd::DirectClient::new(host.registry());
    let denied = agent_client.call("event-rebuild", json!({}), None).await;
    assert!(!denied.success);
    let cli = host.cli_client();
    assert!(cli.call("event-rebuild", json!({}), None).await.success);
    let mut context = host.context(agent("local"));
    context.interface = Some(CommandInterface::Mcp);
    let over_mcp = host
        .registry()
        .execute("event-rebuild", json!({}), Some(context))
        .await;
    assert!(!over_mcp.success);
    assert_eq!(over_mcp.error.unwrap().code, "COMMAND_NOT_EXPOSED");
}

// ── Repair ──────────────────────────────────────────────────────────────────────────────────────

/// Make the event append of `space` fail by putting a directory where its stream goes.
fn break_stream(dir: &std::path::Path, space: &str) -> std::path::PathBuf {
    let path = events_path(dir, space);
    fs::create_dir_all(&path).unwrap();
    path
}

#[tokio::test]
async fn a_failed_projection_leaves_the_marker_and_the_next_append_repairs_first() {
    let uninterrupted = two_spaces();
    let broken = two_spaces();
    let plain = seal_with_fixtures(uninterrupted.path());
    let host = seal_with_fixtures(broken.path());
    let actor = agent("local");
    let script = [
        ("main", "a"),
        ("second", "b"),
        ("second", "c"),
        ("main", "d"),
    ];
    for (space, text) in script {
        call(
            &plain,
            actor.clone(),
            "note-remember",
            json!({"space": space, "text": text}),
        )
        .await;
    }

    call(
        &host,
        actor.clone(),
        "note-remember",
        json!({"space": "main", "text": "a"}),
    )
    .await;
    let path = break_stream(broken.path(), "second");
    // The event append fails; the command still succeeds and its journal entry is written.
    let result = call(
        &host,
        actor.clone(),
        "note-remember",
        json!({"space": "second", "text": "b"}),
    )
    .await;
    assert!(result.success, "a sink failure never changes a result");
    assert!(broken.path().join("state/projection.pending").exists());
    assert_eq!(journal_entries(broken.path()).len(), 2);
    assert!(path.is_dir());

    // Repair the cause. The next mutation, in another space, first projects the missed event.
    fs::remove_dir(&path).unwrap();
    call(
        &host,
        actor.clone(),
        "note-remember",
        json!({"space": "second", "text": "c"}),
    )
    .await;
    call(
        &host,
        actor.clone(),
        "note-remember",
        json!({"space": "main", "text": "d"}),
    )
    .await;
    assert!(!broken.path().join("state/projection.pending").exists());
    for space in ["main", "second"] {
        let strip = |dir: &std::path::Path| -> Vec<Value> {
            events(dir, space)
                .into_iter()
                .map(|mut event| {
                    // Trace ids, times and journal timestamps differ between two runs.
                    for key in ["traceId", "timestamp"] {
                        event.as_object_mut().unwrap().remove(key);
                    }
                    let provenance = event["provenance"].as_object_mut().unwrap();
                    provenance.remove("traceId");
                    provenance.remove("observedAt");
                    event
                })
                .collect()
        };
        assert_eq!(strip(broken.path()), strip(uninterrupted.path()), "{space}");
    }
    let seqs: Vec<u64> = events(broken.path(), "second")
        .iter()
        .map(|e| e["seq"].as_u64().unwrap())
        .collect();
    assert_eq!(seqs, [1, 2]);
}

#[tokio::test]
async fn a_marker_and_a_missing_last_event_are_repaired_on_reopen_byte_for_byte() {
    let dir = minimal();
    let host = seal_with_fixtures(dir.path());
    for text in ["a", "b", "c"] {
        call(
            &host,
            agent("local"),
            "note-remember",
            json!({"text": text}),
        )
        .await;
    }
    let whole = stream_bytes(dir.path(), "main");
    drop(host);

    // The crash window: marker created, journal appended, event not.
    let text = String::from_utf8(whole.clone()).unwrap();
    let cut = text[..text.len() - 1].rfind('\n').unwrap() + 1;
    fs::write(events_path(dir.path(), "main"), &text[..cut]).unwrap();
    fs::write(dir.path().join("state/projection.pending"), "").unwrap();
    let _host = seal_with_fixtures(dir.path());
    assert_eq!(stream_bytes(dir.path(), "main"), whole);
    assert!(!dir.path().join("state/projection.pending").exists());
}

#[tokio::test]
async fn repair_events_restores_a_deleted_last_event_without_a_marker() {
    let dir = two_spaces();
    let host = seal_with_fixtures(dir.path());
    for (space, text) in [("main", "a"), ("second", "b"), ("main", "c")] {
        call(
            &host,
            agent("local"),
            "note-remember",
            json!({"space": space, "text": text}),
        )
        .await;
    }
    let (main, second) = (
        stream_bytes(dir.path(), "main"),
        stream_bytes(dir.path(), "second"),
    );
    let text = String::from_utf8(main.clone()).unwrap();
    let cut = text[..text.len() - 1].rfind('\n').unwrap() + 1;
    fs::write(events_path(dir.path(), "main"), &text[..cut]).unwrap();
    assert!(!dir.path().join("state/projection.pending").exists());

    let report = host.repair_events().unwrap();
    assert_eq!(report.projected(), 1);
    assert_eq!(stream_bytes(dir.path(), "main"), main);
    assert_eq!(stream_bytes(dir.path(), "second"), second);
    // A second repair finds nothing to do.
    assert_eq!(host.repair_events().unwrap().projected(), 0);
}

#[tokio::test]
async fn a_torn_event_line_is_cut_off_and_reprojected() {
    let dir = minimal();
    let host = seal_with_fixtures(dir.path());
    call(&host, agent("local"), "note-remember", json!({"text": "a"})).await;
    let good = stream_bytes(dir.path(), "main");
    let mut torn = good.clone();
    torn.extend_from_slice(b"{\"version\":0,\"id\":\"main:2\",\"se");
    fs::write(events_path(dir.path(), "main"), &torn).unwrap();
    // Readers skip the torn line; the next append repairs it.
    let listed = call(&host, agent("local"), "event-list", json!({})).await;
    assert_eq!(listed.data.unwrap()["events"].as_array().unwrap().len(), 1);
    call(&host, agent("local"), "note-remember", json!({"text": "b"})).await;
    let after = events(dir.path(), "main");
    assert_eq!(after.len(), 2);
    assert_eq!(after[1]["seq"], 2);
    assert!(stream_bytes(dir.path(), "main").starts_with(&good));
}

#[tokio::test]
async fn event_rebuild_is_byte_identical_to_the_live_streams_and_keeps_cursors() {
    let dir = two_spaces();
    let host = seal_with_fixtures(dir.path());
    let actor = agent("local");
    for (space, text) in [
        ("main", "a"),
        ("second", "b"),
        ("main", "c"),
        ("second", "d"),
    ] {
        call(
            &host,
            actor.clone(),
            "note-remember",
            json!({"space": space, "text": text, "origin": "agent-inferred", "confidence": "0.5"}),
        )
        .await;
    }
    let live = (
        stream_bytes(dir.path(), "main"),
        stream_bytes(dir.path(), "second"),
    );
    let acked = call(
        &host,
        actor.clone(),
        "event-ack",
        json!({"cursor": "v0:main:2"}),
    )
    .await;
    assert!(acked.success);

    // Damage both, then rebuild one space and all of them.
    fs::write(events_path(dir.path(), "main"), "garbage\n").unwrap();
    fs::write(events_path(dir.path(), "second"), "").unwrap();
    let one = host.cli_client();
    let rebuilt = one
        .call("event-rebuild", json!({"space": "main"}), None)
        .await;
    assert!(rebuilt.success, "{rebuilt:?}");
    assert_eq!(rebuilt.data.unwrap()["rebuilt"][0]["head"], "v0:main:2");
    assert_eq!(stream_bytes(dir.path(), "main"), live.0);
    let all = one.call("event-rebuild", json!({}), None).await;
    assert_eq!(all.data.unwrap()["rebuilt"].as_array().unwrap().len(), 2);
    assert_eq!(stream_bytes(dir.path(), "second"), live.1);
    assert!(!dir.path().join("state/projection.pending").exists());

    let next = call(&host, actor, "event-list", json!({})).await;
    let data = next.data.unwrap();
    assert_eq!(data["acknowledged"], "v0:main:2");
    assert_eq!(data["events"].as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn an_undeclared_space_cannot_be_rebuilt() {
    let dir = minimal();
    let host = seal_with_fixtures(dir.path());
    let result = host
        .cli_client()
        .call("event-rebuild", json!({"space": "nope"}), None)
        .await;
    assert_eq!(result.error.unwrap().code, "SPACE_NOT_FOUND");
}

#[tokio::test]
async fn the_doctor_agrees_with_the_projection() {
    let dir = minimal();
    let host = seal_with_fixtures(dir.path());
    call(&host, agent("local"), "note-remember", json!({"text": "a"})).await;
    let report = call(&host, agent("local"), "workspace-doctor", json!({})).await;
    let data = report.data.unwrap();
    let events = data["checks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|check| check["id"] == "events.consistent")
        .unwrap()
        .clone();
    assert_eq!(events["status"], "pass", "{events}");
}

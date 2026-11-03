//! Digest journaling (phase 3 specification, section 7.1, D72): a canary through a direct call,
//! `afd-call`, `afd-batch`, `afd-pipe`, a plugin pipeline, the CLI, a failing call and a call that
//! fails before any store never reaches the journal, while `parse_journal` reads every line,
//! events still project and `event-rebuild` gives the same lines. The stated limit holds too: a
//! plain `afd-pipe` step does journal what it was passed.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use afd::{Actor, ActorKind};
use serde_json::{Value, json};
use support::mcp::{Client, Era, Transport};
use support::memory::{MemoryProbe, NOW, config};
use support::plugins::seal;
use support::{Scripted, cli_with, journal_entries, journal_path, stream_bytes};
use umbel::plugins::sdk;

const CANARY: &str = "canarydigestzq";

fn ada() -> Actor {
    Actor::new(ActorKind::Human).with_id("ada")
}

fn args(n: u64, route: &str) -> Value {
    json!({ "space": "main", "args": { "n": n, "text": format!("{CANARY} {route}"), "subject": format!("{CANARY} subject {n}") } })
}

fn raw_journal(dir: &std::path::Path) -> String {
    std::fs::read_to_string(journal_path(dir)).unwrap()
}

#[tokio::test]
async fn no_route_writes_a_digest_commands_text_to_the_journal() {
    let dir = support::workspace(&config("", ""));
    let host = seal(dir.path(), |b| {
        b.with_compiled(sdk(MemoryProbe::new()))
            .with_clock(afd::fixed_clock(NOW))
    })
    .unwrap();
    // A direct call.
    let direct = support::call(&host, ada(), "mem-remember", args(1, "direct")).await;
    assert!(direct.success, "{direct:?}");
    // The plugin pipeline, which inherits digest from its step.
    let pipe = support::call(
        &host,
        ada(),
        "mem-pipe",
        json!({ "args": args(2, "pipeline")["args"] }),
    )
    .await;
    assert!(pipe.success, "{pipe:?}");
    // A failing call, and one that fails before any store is used.
    let failing = support::call(
        &host,
        ada(),
        "mem-change",
        json!({ "space": "main", "args": { "op": format!("{CANARY}-op") } }),
    )
    .await;
    assert!(!failing.success);
    let early = support::call(
        &host,
        ada(),
        "mem-remember",
        json!({ "space": "main", "args": { "n": 9, "share": format!("{CANARY}-share") } }),
    )
    .await;
    assert!(!early.success);
    // The MCP routes: afd-call, afd-batch and afd-pipe.
    let mut client = Client::connect(&host, Transport::Stdio, Era::Modern).await;
    let called = client.afd_call("mem-remember", args(3, "afd-call")).await;
    assert_eq!(called["success"], true, "{called}");
    let batch = client
        .call(
            "afd-batch",
            json!({ "commands": [{ "command": "mem-remember", "input": args(4, "afd-batch") }] }),
        )
        .await;
    assert_eq!(batch["results"][0]["result"]["success"], true, "{batch}");
    let piped = client
        .call(
            "afd-pipe",
            json!({ "steps": [{ "command": "mem-remember", "input": args(5, "afd-pipe") }] }),
        )
        .await;
    assert_eq!(piped["steps"][0]["status"], "success", "{piped}");
    drop(client);
    drop(host);
    // The CLI.
    let input = args(6, "cli").to_string();
    let run = cli_with(
        dir.path(),
        &["mem", "remember", &input],
        Scripted::no_terminal(),
        |b| {
            b.with_compiled(sdk(MemoryProbe::new()))
                .with_clock(afd::fixed_clock(NOW))
        },
    )
    .await;
    assert_eq!(run.code, 0, "{}", run.stdout);

    let text = raw_journal(dir.path());
    assert!(!text.contains(CANARY), "a canary reached the journal");
    let entries = journal_entries(dir.path());
    assert_eq!(
        entries.len(),
        text.lines().count(),
        "parse_journal reads every line"
    );
    let digests: Vec<&afd::JournalEntry> = entries
        .iter()
        .filter(|entry| entry.command.starts_with("mem-"))
        .collect();
    assert!(digests.len() >= 9, "{}", digests.len());
    for entry in &digests {
        assert_eq!(
            entry.input["dev.umbel/journal"], "digest",
            "{}",
            entry.command
        );
        let extra = &entry.result.metadata.as_ref().unwrap().extra;
        assert_eq!(extra["dev.umbel/replay"], "recorded", "{}", entry.command);
        assert_eq!(extra["dev.umbel/journal"], "digest");
        assert!(entry.result.data.is_none(), "{}", entry.command);
        if let Some(error) = &entry.result.error {
            assert_eq!(error.message, "(digest)");
            assert!(error.suggestion.is_none());
        }
    }
    // The kept key stays; the pipeline keeps none.
    let remembered = digests
        .iter()
        .find(|e| e.command == "mem-remember")
        .unwrap();
    assert_eq!(remembered.input["keep"], json!({ "space": "main" }));
    let pipeline = digests.iter().find(|e| e.command == "mem-pipe").unwrap();
    assert_eq!(pipeline.input["keep"], json!({}));
    // A failure keeps its code.
    assert!(digests.iter().any(|e| {
        e.result
            .error
            .as_ref()
            .is_some_and(|err| err.code == "INVALID")
    }));

    // Events still project from the digest entries, and a rebuild gives the same lines.
    let before = stream_bytes(dir.path(), "main");
    assert!(!before.is_empty());
    assert!(!String::from_utf8_lossy(&before).contains(CANARY));
    let rebuild = cli_with(
        dir.path(),
        &["event", "rebuild"],
        Scripted::no_terminal(),
        |b| b.with_compiled(sdk(MemoryProbe::new())),
    )
    .await;
    assert_eq!(rebuild.code, 0, "{}", rebuild.stdout);
    assert_eq!(stream_bytes(dir.path(), "main"), before);
}

#[tokio::test]
async fn a_plain_afd_pipe_step_journals_what_it_was_passed() {
    let dir = support::workspace(&config("", ""));
    let host = seal(dir.path(), |b| {
        b.with_compiled(sdk(MemoryProbe::new()))
            .with_clock(afd::fixed_clock(NOW))
    })
    .unwrap();
    let limit = "canarylimitzq";
    let written = support::call(
        &host,
        ada(),
        "mem-remember",
        json!({ "space": "main", "args": { "n": 1, "text": limit, "share": "space" } }),
    )
    .await;
    let id = written.data.unwrap()["ids"][0].as_str().unwrap().to_owned();
    // An agent's afd-pipe passes a memory result to a plain step through `$prev`: the plain
    // step's resolved input enters the journal as it is (section 7.1's stated limit).
    let mut client = Client::connect(&host, Transport::Stdio, Era::Modern).await;
    let piped = client
        .call(
            "afd-pipe",
            json!({ "steps": [
                { "command": "mem-read", "input": { "space": "main", "args": { "op": "show", "id": id } } },
                { "command": "mem-plain", "input": { "copied": "$prev.result.text" } },
            ] }),
        )
        .await;
    assert_eq!(piped["steps"][1]["status"], "success", "{piped}");
    let entries = journal_entries(dir.path());
    let read = entries.iter().find(|e| e.command == "mem-read").unwrap();
    assert!(!serde_json::to_string(read).unwrap().contains(limit));
    let plain = entries.iter().find(|e| e.command == "mem-plain").unwrap();
    assert_eq!(
        plain.input["copied"], limit,
        "the stated limit: {} {piped}",
        plain.input
    );
}

//! A pipeline's exposure and result (phase 4 specification, sections 2.2 and 10.1, D105).
//!
//! - **Seal refusal:** a manifest version 4 pipeline exposed to an interface that one of its
//!   steps is not exposed to is `PLUGIN_MANIFEST_INVALID`, naming the step and the interface; an
//!   optional instance is dropped instead and reported. A pipeline narrower than its steps seals.
//!   Versions 1 to 3 keep every pipeline exposed to every surface, unchecked.
//! - **Listing per surface:** a CLI-only pipeline is neither listed nor callable over MCP (every
//!   lane), refused to an in-process agent, and listed and callable on the CLI.
//! - **`result = "last"`:** the result is the last step's data alone, so the earlier steps' data
//!   is neither in the result, nor on the CLI's stdout, nor in the pipeline's journal entry.
//!   Each step is still journaled under its own name in its own mode: a digest step's text is in
//!   no entry at all. `result = "steps"` keeps phase 1's shape.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use afd::{CommandInterface, JournalEntry};
use serde_json::{Value, json};
use support::mcp::Client;
use support::plugins::{Raw, closure, config, seal};
use support::{Scripted, agent, call, cli_with, journal_entries};

const ANY: &str = "{ type = \"object\" }";
const CANARY: &str = "canary-plain-earlier-step";
const SECRET: &str = "canary-digest-earlier-step";

fn head(version: u32) -> String {
    format!(
        r#"manifest_version = {version}
protocol = 1

[plugin]
id = "expo"
title = "Expo"
version = "0.1.0"
description = "Pipelines and their exposure."
kind = "compiled"
domains = ["expo"]
"#
    )
}

/// A command `expo-<name>` with `keys` appended.
fn command(name: &str, keys: &str) -> String {
    format!(
        "\n[[commands]]\nname = \"expo-{name}\"\ndescription = \"Do {name}.\"\neffects = [\"inspect\"]\ninput_schema = {ANY}\n{keys}\n"
    )
}

/// A pipeline `expo-<name>` over `steps` (command suffixes), with `keys` appended.
fn pipeline(name: &str, keys: &str, steps: &[&str]) -> String {
    let steps: Vec<String> = steps
        .iter()
        .map(|step| format!("{{ command = \"expo-{step}\", as = \"{step}\" }}"))
        .collect();
    format!(
        "\n[[pipelines]]\nname = \"expo-{name}\"\ndescription = \"Run {name}.\"\neffects = [\"inspect\"]\ninput_schema = {ANY}\n{keys}\nsteps = [{}]\n",
        steps.join(", ")
    )
}

const CLI_ONLY: &str = "expose = { mcp = false, agent = false, cli = true }";

/// The commands every manifest here has.
fn commands() -> String {
    [
        command("everywhere", ""),
        command("cli", CLI_ONLY),
        command("mcp", "expose = { mcp = true, agent = true, cli = false }"),
        command("canary", ""),
        command("secret", "journal = { mode = \"digest\" }"),
        command("ids", ""),
    ]
    .concat()
}

fn plugin(text: String) -> Raw {
    Raw::new(text, |_| {
        Ok(vec![
            closure("expo-everywhere", |_, _| {
                afd::success(json!({ "at": "everywhere" }))
            }),
            closure("expo-cli", |_, _| afd::success(json!({ "at": "cli" }))),
            closure("expo-mcp", |_, _| afd::success(json!({ "at": "mcp" }))),
            closure("expo-canary", |_, _| {
                afd::success(json!({ "text": CANARY }))
            }),
            closure("expo-secret", |_, _| {
                afd::success(json!({ "text": SECRET }))
            }),
            closure("expo-ids", |_, _| {
                afd::success(json!({ "ids": ["p-1", "p-2"], "count": 2 }))
            }),
        ])
    })
}

/// A workspace enabling `expo`, with `body` in its instance table.
fn workspace(body: &str) -> tempfile::TempDir {
    support::workspace(&config(&[("expo", body)], ""))
}

fn seal_with(
    text: String,
    body: &str,
) -> (tempfile::TempDir, Result<umbel::Host, umbel::HostError>) {
    let dir = workspace(body);
    let host = seal(dir.path(), |b| b.with_compiled(plugin(text)));
    (dir, host)
}

/// The manifest every surface test uses: a CLI-only pipeline and the result pipelines.
fn surfaces() -> String {
    format!(
        "{}{}{}{}{}{}",
        head(4),
        commands(),
        pipeline("cli-run", CLI_ONLY, &["cli", "everywhere"]),
        pipeline("last", "result = \"last\"", &["canary", "ids"]),
        pipeline("last-secret", "result = \"last\"", &["secret", "ids"]),
        pipeline("steps", "result = \"steps\"", &["canary", "ids"]),
    )
}

// ── Seal refusal ─────────────────────────────────────────────────────────────────────────────

fn refused(text: String, step: &str, interface: &str) {
    let (_dir, host) = seal_with(text, "");
    let error = host.err().expect("the pipeline is wider than a step");
    assert_eq!(error.code(), "PLUGIN_MANIFEST_INVALID", "{error}");
    let message = error.message();
    assert!(message.contains("pipelines[0].expose"), "{message}");
    assert!(message.contains(&format!("`expo-{step}`")), "{message}");
    assert!(message.contains(interface), "{message}");
}

#[test]
fn a_version_4_pipeline_wider_than_a_step_is_refused_at_seal_naming_the_step() {
    // No `expose`: every surface, as a command's defaults; its CLI-only step is narrower.
    refused(
        format!(
            "{}{}{}",
            head(4),
            commands(),
            pipeline("wide", "", &["everywhere", "cli"])
        ),
        "cli",
        "mcp",
    );
    // MCP off but the agent on: the CLI-only step is not exposed to agents.
    refused(
        format!(
            "{}{}{}",
            head(4),
            commands(),
            pipeline("agentic", "expose = { mcp = false }", &["cli"])
        ),
        "cli",
        "agent",
    );
    // A CLI-only pipeline whose step the CLI cannot call.
    refused(
        format!(
            "{}{}{}",
            head(4),
            commands(),
            pipeline("terminal", CLI_ONLY, &["everywhere", "mcp"])
        ),
        "mcp",
        "cli",
    );
}

#[tokio::test]
async fn an_optional_instance_with_a_wide_pipeline_is_dropped_and_reported() {
    let text = format!(
        "{}{}{}",
        head(4),
        commands(),
        pipeline("wide", "", &["cli"])
    );
    let (_dir, host) = seal_with(text, "required = false");
    let host = host.unwrap();
    assert!(host.registry().get("expo-wide").is_none());
    assert!(host.registry().get("expo-cli").is_none());
    let listed = call(&host, agent("a"), "plugin-list", json!({}))
        .await
        .data
        .unwrap();
    assert_eq!(listed["plugins"][0]["status"], "failed", "{listed}");
    assert_eq!(
        listed["plugins"][0]["error"]["code"],
        "PLUGIN_MANIFEST_INVALID"
    );
}

#[test]
fn a_pipeline_narrower_than_its_steps_seals_with_its_own_exposure() {
    let (_dir, host) = seal_with(surfaces(), "");
    let host = host.unwrap();
    let run = host.registry().get("expo-cli-run").unwrap();
    assert!(run.expose.cli, "{:?}", run.expose);
    assert!(!run.expose.mcp && !run.expose.agent && !run.expose.palette);
    // Without `expose`, a version 4 pipeline is on every surface but the palette.
    let last = host.registry().get("expo-last").unwrap();
    assert!(last.expose.mcp && last.expose.agent && last.expose.cli && !last.expose.palette);
}

#[test]
fn versions_1_to_3_keep_every_pipeline_on_every_surface_unchecked() {
    for version in [1, 2, 3] {
        let text = format!(
            "{}{}{}",
            head(version),
            commands().replace("journal = { mode = \"digest\" }", ""),
            pipeline("wide", "", &["everywhere", "cli"])
        );
        let (_dir, host) = seal_with(text, "");
        let host = host.unwrap_or_else(|error| panic!("version {version}: {error}"));
        let wide = host.registry().get("expo-wide").unwrap();
        assert!(
            wide.expose.mcp && wide.expose.agent && wide.expose.cli && !wide.expose.palette,
            "version {version}"
        );
    }
}

// ── Listing per surface ──────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn a_cli_only_pipeline_is_listed_and_callable_only_on_the_cli() {
    let (dir, host) = seal_with(surfaces(), "");
    let host = host.unwrap();
    for mut client in Client::lanes(&host).await {
        let label = client.label();
        let discovered = client.call("afd-discover", json!({ "limit": 200 })).await;
        let names: Vec<String> = discovered["data"]["commands"]
            .as_array()
            .unwrap_or_else(|| panic!("{label}: {discovered}"))
            .iter()
            .map(|command| command["name"].as_str().unwrap().to_owned())
            .collect();
        assert!(
            names.contains(&"expo-last".to_owned()),
            "{label}: {names:?}"
        );
        assert!(
            !names.contains(&"expo-cli-run".to_owned()),
            "{label}: {names:?}"
        );
        assert!(
            !client
                .tool_names()
                .await
                .contains(&"expo-cli-run".to_owned())
        );
        let called = client.afd_call("expo-cli-run", json!({})).await;
        assert_eq!(called["success"], false, "{label}: {called}");
        assert_eq!(
            called["error"]["code"], "COMMAND_NOT_FOUND",
            "{label}: {called}"
        );
        let direct = client.call_raw("expo-cli-run", json!({})).await;
        assert!(
            !direct.to_string().contains("\"at\":\"cli\""),
            "{label}: {direct}"
        );
    }

    // An in-process agent is refused.
    let mut context = host.context(agent("a"));
    context.interface = Some(CommandInterface::Agent);
    let refused = host
        .registry()
        .execute("expo-cli-run", json!({}), Some(context))
        .await;
    assert_eq!(refused.error.unwrap().code, "COMMAND_NOT_EXPOSED");

    // The CLI lists and runs it.
    let configure = |b: umbel::HostBuilder| b.with_compiled(plugin(surfaces()));
    let help = cli_with(dir.path(), &["help"], Scripted::no_terminal(), configure).await;
    assert!(help.stdout.contains("expo-cli-run"), "{}", help.stdout);
    let run = cli_with(
        dir.path(),
        &["call", "expo-cli-run"],
        Scripted::no_terminal(),
        configure,
    )
    .await;
    assert_eq!(run.code, 0, "{}", run.stdout);
    assert_eq!(run.json()["data"]["steps"][0]["data"]["at"], "cli");
}

// ── result = "last" ──────────────────────────────────────────────────────────────────────────

/// The journal entries of `command`.
fn entries<'a>(journal: &'a [JournalEntry], command: &str) -> Vec<&'a JournalEntry> {
    journal
        .iter()
        .filter(|entry| entry.command == command)
        .collect()
}

#[tokio::test]
async fn result_last_returns_and_journals_only_the_last_steps_data() {
    let (dir, host) = seal_with(surfaces(), "");
    let host = host.unwrap();
    let ids = json!({ "ids": ["p-1", "p-2"], "count": 2 });

    let result = call(&host, agent("a"), "expo-last", json!({})).await;
    assert!(result.success, "{result:?}");
    assert_eq!(result.data, Some(ids.clone()));
    assert!(!serde_json::to_string(&result).unwrap().contains(CANARY));

    // The CLI prints the last step's data and nothing of the step before it.
    let configure = |b: umbel::HostBuilder| b.with_compiled(plugin(surfaces()));
    let run = cli_with(
        dir.path(),
        &["call", "expo-last"],
        Scripted::no_terminal(),
        configure,
    )
    .await;
    assert_eq!(run.code, 0, "{}", run.stdout);
    assert_eq!(run.json()["data"], ids);
    assert!(!run.stdout.contains(CANARY), "{}", run.stdout);

    // The pipeline's own entries hold the last step's data alone. The earlier step is journaled
    // under its own name, as every call is, in its own (plain) mode.
    let journal = journal_entries(dir.path());
    let own = entries(&journal, "expo-last");
    assert_eq!(own.len(), 2);
    for entry in &own {
        assert_eq!(entry.result.data, Some(ids.clone()));
        assert!(!serde_json::to_string(entry).unwrap().contains(CANARY));
    }
    assert_eq!(entries(&journal, "expo-canary").len(), 2);

    // With a digest step first, its text is in no entry and on no output.
    let secret = call(&host, agent("a"), "expo-last-secret", json!({})).await;
    assert_eq!(secret.data, Some(ids));
    let run = cli_with(
        dir.path(),
        &["call", "expo-last-secret"],
        Scripted::no_terminal(),
        configure,
    )
    .await;
    assert_eq!(run.code, 0, "{}", run.stdout);
    assert!(!run.stdout.contains(SECRET), "{}", run.stdout);
    let text = std::fs::read_to_string(support::journal_path(dir.path())).unwrap();
    assert!(
        !text.contains(SECRET),
        "a digest step's text reached the journal"
    );
    let journal = journal_entries(dir.path());
    for entry in entries(&journal, "expo-last-secret") {
        // A pipeline with a digest step is digest itself: no data at all.
        assert_eq!(entry.result.data, None);
    }
}

#[tokio::test]
async fn result_steps_keeps_every_steps_data() {
    let (dir, host) = seal_with(surfaces(), "");
    let host = host.unwrap();
    let result = call(&host, agent("a"), "expo-steps", json!({})).await;
    let steps = result.data.unwrap()["steps"].clone();
    assert_eq!(steps.as_array().unwrap().len(), 2);
    assert_eq!(steps[0]["as"], "canary");
    assert_eq!(steps[0]["data"]["text"], CANARY);
    assert_eq!(steps[1]["data"]["count"], 2);
    let journal = journal_entries(dir.path());
    let entry = entries(&journal, "expo-steps")[0];
    assert_eq!(
        entry.result.data.as_ref().unwrap()["steps"][0]["data"]["text"],
        Value::from(CANARY)
    );
}

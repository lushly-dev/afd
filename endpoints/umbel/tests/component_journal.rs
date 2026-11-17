//! The deployer's journal mode for a component instance (the component journal specification,
//! D195 to D197): `[plugins.<id>.journal]` journals a component's calls as digest on every
//! recorded route, a command entry replaces the instance's mode, pipelines inherit it and refuse
//! a plain step fed a digest step's output, `plugin-show` reports who set each mode, and the key
//! is refused on a compiled instance and for a command the plugin does not declare.
#![cfg(feature = "component")]
#![allow(clippy::unwrap_used, clippy::expect_used)]

#[path = "support/components.rs"]
mod components;
mod support;

use std::path::Path;

use components::{BEHAVIORS, behaviors_dir, component_dir, fixture_manifest};
use serde_json::{Value, json};
use support::journal_entries;
use support::mcp::{Client, Era, Transport};
use umbel::doctor::{self, CheckStatus};
use umbel::testkit::{TestHost, TestHostBuilder};

const CANARY: &str = "canaryjournalzq";

fn keys(text: &str) -> toml::Table {
    text.parse().unwrap()
}

/// The behaviors fixture with `journal` (TOML of the `journal` table's body, as
/// `[plugins.probe]` keys) and `extra` appended to its manifest.
fn probe(parent: &Path, extra: &str, journal: &str) -> TestHostBuilder {
    let manifest = fixture_manifest(
        "probe",
        "probe.wasm",
        &["clock", "random"],
        BEHAVIORS,
        extra,
    );
    let dir = component_dir(
        parent,
        "probe",
        &manifest,
        "umbel_fixture_behaviors",
        "probe.wasm",
    );
    let builder = TestHost::directory(dir);
    if journal.is_empty() {
        builder
    } else {
        builder.instance_keys(keys(journal))
    }
}

fn raw_journal(dir: &Path) -> String {
    std::fs::read_to_string(support::journal_path(dir)).unwrap()
}

fn echo_input(route: &str) -> Value {
    json!({ "tag": "kept", "text": format!("{CANARY} {route}") })
}

#[tokio::test(flavor = "multi_thread")]
async fn a_digest_component_call_keeps_no_text_on_any_route() {
    let parent = tempfile::tempdir().unwrap();
    let host = probe(
        parent.path(),
        "",
        "journal = { mode = \"digest\", keep = [\"tag\"] }",
    )
    .boot()
    .unwrap();
    let direct = host.call("probe-echo", echo_input("direct")).await;
    assert!(direct.success, "{direct:?}");
    // The call itself saw the text: only the journal does not.
    assert!(direct.data.unwrap().to_string().contains(CANARY));
    let mut client = Client::connect(host.host(), Transport::Stdio, Era::Modern).await;
    let batch = client
        .call(
            "afd-batch",
            json!({ "commands": [{ "command": "probe-echo", "input": echo_input("afd-batch") }] }),
        )
        .await;
    assert_eq!(batch["results"][0]["result"]["success"], true, "{batch}");
    let piped = client
        .call(
            "afd-pipe",
            json!({ "steps": [{ "command": "probe-echo", "input": echo_input("afd-pipe") }] }),
        )
        .await;
    assert_eq!(piped["steps"][0]["status"], "success", "{piped}");
    drop(client);

    let raw = raw_journal(host.workspace_dir());
    assert!(!raw.contains(CANARY), "the journal holds the canary: {raw}");
    let entries = journal_entries(host.workspace_dir());
    let echoes: Vec<_> = entries
        .iter()
        .filter(|entry| entry.command == "probe-echo")
        .collect();
    assert_eq!(echoes.len(), 3, "{raw}");
    let seqs: Vec<u64> = echoes.iter().map(|entry| entry.seq).collect();
    for entry in echoes {
        assert_eq!(entry.input["dev.umbel/journal"], "digest", "{raw}");
        assert_eq!(entry.input["keep"], json!({ "tag": "kept" }), "{raw}");
        assert!(entry.input["bytes"].as_u64().unwrap() > 0, "{raw}");
        assert!(entry.result.data.is_none(), "{raw}");
        let metadata = serde_json::to_value(entry.result.metadata.as_ref().unwrap()).unwrap();
        assert_eq!(metadata["dev.umbel/journal"], "digest", "{metadata}");
        assert_eq!(metadata["dev.umbel/replay"], "recorded", "{metadata}");
    }
    // The test kit's replay skips each recorded entry and names it.
    let replay = host.replay().await.unwrap();
    assert_eq!(replay.skipped, seqs, "{replay:?}");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_digest_failure_keeps_only_its_code() {
    let parent = tempfile::tempdir().unwrap();
    let host = probe(parent.path(), "", "journal = { mode = \"digest\" }")
        .boot()
        .unwrap();
    let bad = host.call("probe-bad", json!({ "text": CANARY })).await;
    assert!(!bad.success, "{bad:?}");
    let entries = journal_entries(host.workspace_dir());
    let entry = entries
        .iter()
        .find(|entry| entry.command == "probe-bad")
        .unwrap();
    let error = entry.result.error.as_ref().unwrap();
    assert_eq!(error.code, bad.error.as_ref().unwrap().code);
    assert_eq!(error.message, "(digest)");
    assert!(error.suggestion.is_none());
    assert!(!raw_journal(host.workspace_dir()).contains(CANARY));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_command_entry_replaces_the_instance_mode_and_no_table_journals_in_full() {
    let parent = tempfile::tempdir().unwrap();
    let host = probe(
        parent.path(),
        "",
        "[journal]\nmode = \"digest\"\n\n[journal.commands]\nprobe-echo = { mode = \"plain\" }\n",
    )
    .boot()
    .unwrap();
    assert!(host.call("probe-echo", echo_input("plain")).await.success);
    let raw = raw_journal(host.workspace_dir());
    assert!(
        raw.contains(CANARY),
        "a plain entry journals in full: {raw}"
    );

    let parent = tempfile::tempdir().unwrap();
    let host = probe(parent.path(), "", "").boot().unwrap();
    assert!(host.call("probe-echo", echo_input("default")).await.success);
    let raw = raw_journal(host.workspace_dir());
    assert!(raw.contains(CANARY), "with no journal, as today: {raw}");
}

/// A pipeline of the fixture: `probe-echo`, then `second` given the first step's output.
fn relay(second: &str) -> String {
    format!(
        "[[pipelines]]\nname = \"probe-relay\"\ndescription = \"Echo, then pass it on.\"\neffects = [\"inspect\"]\ninput_schema = {{ type = \"object\", properties = {{ text = {{ type = \"string\" }} }}, additionalProperties = false }}\nsteps = [\n  {{ command = \"probe-echo\", input = {{ text = \"$input.text\" }} }},\n  {{ command = \"{second}\", input = {{ copied = \"$prev\" }} }},\n]\n"
    )
}

#[tokio::test(flavor = "multi_thread")]
async fn a_pipeline_inherits_the_deployers_digest_and_refuses_a_plain_step_after_it() {
    // probe-echo digest, probe-env plain: the plain step would journal the echoed text.
    let parent = tempfile::tempdir().unwrap();
    let error = probe(
        parent.path(),
        &relay("probe-env"),
        "[journal.commands]\nprobe-echo = { mode = \"digest\" }\n",
    )
    .boot()
    .err()
    .expect("the pipeline's flow is refused, and the instance is required");
    let message = error.to_string();
    assert!(message.contains("PLUGIN_MANIFEST_INVALID"), "{message}");
    assert!(message.contains("steps[1]"), "{message}");
    assert!(
        message.contains("(digest by plugins.probe.journal)"),
        "{message}"
    );

    // Both digest: the pipeline loads, journals as digest, and plugin-show says so.
    let parent = tempfile::tempdir().unwrap();
    let host = probe(
        parent.path(),
        &relay("probe-env"),
        "[journal]\nmode = \"digest\"\n",
    )
    .boot()
    .unwrap();
    let shown = host.call("plugin-show", json!({ "plugin": "probe" })).await;
    let data = shown.data.unwrap();
    let pipeline = &data["pipelines"][0];
    assert_eq!(pipeline["state"], "registered", "{data}");
    assert_eq!(
        pipeline["journal"],
        json!({ "mode": "digest", "keep": [], "setBy": "steps" })
    );
    let ran = host.call("probe-relay", json!({ "text": CANARY })).await;
    assert!(ran.success, "{ran:?}");
    assert!(!raw_journal(host.workspace_dir()).contains(CANARY));
}

#[tokio::test(flavor = "multi_thread")]
async fn plugin_show_reports_who_set_each_mode() {
    let parent = tempfile::tempdir().unwrap();
    let host = probe(
        parent.path(),
        "",
        "[journal.commands]\nprobe-echo = { mode = \"digest\", keep = [\"space\"] }\nprobe-big = { mode = \"plain\" }\n",
    )
    .boot()
    .unwrap();
    let data = host
        .call("plugin-show", json!({ "plugin": "probe" }))
        .await
        .data
        .unwrap();
    let journal = |name: &str| {
        data["commands"]
            .as_array()
            .unwrap()
            .iter()
            .find(|command| command["name"] == name)
            .unwrap()["journal"]
            .clone()
    };
    assert_eq!(
        journal("probe-echo"),
        json!({ "mode": "digest", "keep": ["space"], "setBy": "deployer" })
    );
    assert_eq!(
        journal("probe-big"),
        json!({ "mode": "plain", "keep": [], "setBy": "deployer" })
    );
    assert_eq!(
        journal("probe-env"),
        json!({ "mode": "plain", "keep": [], "setBy": "default" })
    );
}

#[test]
fn the_key_is_refused_on_a_compiled_instance() {
    let error = TestHost::compiled(umbel::plugins::sdk(umbel_plugin_hello::plugin()))
        .instance_keys(keys("journal = { mode = \"digest\" }"))
        .boot()
        .err()
        .expect("a compiled plugin's manifest declares its own modes");
    let message = error.to_string();
    assert!(message.contains("PLUGIN_CONFIG_INVALID"), "{message}");
    assert!(message.contains("journal"), "{message}");
    assert!(
        message.contains("applies only to a component plugin"),
        "{message}"
    );
}

#[test]
fn a_command_the_plugin_does_not_declare_is_refused_and_the_doctor_says_so() {
    let parent = tempfile::tempdir().unwrap();
    let error = probe(
        parent.path(),
        "",
        "[journal.commands]\nprobe-nothing = { mode = \"digest\" }\n",
    )
    .boot()
    .err()
    .expect("the entry names no command of the plugin");
    let message = error.to_string();
    assert!(message.contains("PLUGIN_CONFIG_INVALID"), "{message}");
    assert!(
        message.contains("journal.commands.probe-nothing"),
        "{message}"
    );

    // The doctor, without a sealed host: plugins.sources fails for the required instance.
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path();
    behaviors_dir(&root.join("plugins"), &["clock", "random"]);
    std::fs::write(
        root.join("umbel.toml"),
        "config_version = 7\ndefault_space = \"main\"\n\n[spaces.main]\n\n[plugins]\nenabled = [\"probe\"]\n\n[plugins.probe]\nsource = \"plugins/probe\"\n\n[plugins.probe.journal.commands]\nprobe-nothing = { mode = \"digest\" }\n",
    )
    .unwrap();
    let report = doctor::run(root);
    let sources = report
        .checks
        .iter()
        .find(|check| check.id == "plugins.sources")
        .unwrap();
    assert_eq!(sources.status, CheckStatus::Fail, "{}", sources.message);
    assert!(
        sources.message.contains("probe-nothing"),
        "{}",
        sources.message
    );
}

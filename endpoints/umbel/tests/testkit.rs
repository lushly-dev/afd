//! The test kit (phase 1 specification, section 10.1): `TestHost` boots with only the plugin, its
//! MCP and CLI drivers, and `replay` skips entries that are recorded only.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use umbel::plugins::sdk;
use umbel::testkit::{DEFAULT_CLOCK_MS, Era, TestHost};

fn hello() -> impl umbel::plugins::CompiledPlugin {
    sdk(umbel_plugin_hello::plugin())
}

fn config(pairs: &[(&str, &str)]) -> toml::Table {
    pairs
        .iter()
        .map(|(key, value)| ((*key).to_owned(), toml::Value::from(*value)))
        .collect()
}

#[tokio::test]
async fn a_test_host_boots_with_only_the_plugin_under_test() {
    let host = TestHost::compiled(hello()).boot().unwrap();
    assert_eq!(host.instance(), "hello");
    let list = host.call("plugin-list", json!({})).await;
    let plugins = list.data.unwrap()["plugins"].clone();
    assert_eq!(plugins.as_array().unwrap().len(), 1);
    assert_eq!(plugins[0]["id"], "hello");
    assert_eq!(plugins[0]["trust"], "trusted, not sandboxed");

    // One space, `main`, and the fixed clock on every call.
    let greeting = host.call("hello-greet", json!({"name": "Ada"})).await;
    let data = greeting.data.unwrap();
    assert_eq!(data["greeting"], "Hello, Ada!");
    assert_eq!(data["space"], "main");
    assert_eq!(data["at"], "2026-01-01T00:00:00.000Z");
    assert_eq!(DEFAULT_CLOCK_MS, 1_767_225_600_000);
}

#[tokio::test]
async fn the_builder_sets_the_configuration_the_spaces_and_the_clock() {
    let host = TestHost::compiled(hello())
        .config(config(&[("default_name", "team")]))
        .spaces(&["main", "other"])
        .clock(1_000)
        .boot()
        .unwrap();
    let result = host.call("hello-greet", json!({"space": "other"})).await;
    let data = result.data.unwrap();
    assert_eq!(data["greeting"], "Hello, team!");
    assert_eq!(data["space"], "other");
    assert_eq!(data["at"], "1970-01-01T00:00:01.000Z");
}

#[tokio::test]
async fn the_mcp_drivers_serve_the_host_in_both_eras() {
    let host = TestHost::compiled(hello()).boot().unwrap();
    for era in [Era::Modern, Era::Legacy] {
        for mut client in [host.mcp(era).await, host.http(era).await] {
            let label = client.label();
            // Not first-class until step 2b adds suggestions, but callable by name (H7).
            let result = client.call("hello-greet", json!({"name": "Ada"})).await;
            assert_eq!(result["success"], true, "{label}: {result}");
            assert_eq!(result["data"]["greeting"], "Hello, Ada!", "{label}");
            // The fixed clock applies on the MCP surface too.
            assert_eq!(result["data"]["at"], "2026-01-01T00:00:00.000Z", "{label}");
        }
    }
}

#[tokio::test]
async fn the_cli_driver_runs_the_cli_in_process_with_the_plugin_and_the_clock() {
    let host = TestHost::compiled(hello()).boot().unwrap();
    let output = host.cli(&["hello", "greet", "name=Ada"]).await;
    assert_eq!(output.code, 0, "{}", output.stdout);
    let json = output.json();
    assert_eq!(json["data"]["greeting"], "Hello, Ada!");
    assert_eq!(json["data"]["at"], "2026-01-01T00:00:00.000Z");
}

#[tokio::test]
async fn replay_reproduces_every_entry_and_skips_the_ones_recorded_only() {
    let host = TestHost::compiled(hello()).boot().unwrap();
    for name in ["Ada", "Grace"] {
        assert!(
            host.call("hello-greet", json!({"name": name}))
                .await
                .success
        );
    }
    let replay = host.replay().await.unwrap();
    assert_eq!(replay.report.entries.len(), 2);
    assert_eq!(replay.report.same, 2, "{:?}", replay.report);
    assert!(!replay.report.diverged);
    assert!(replay.skipped.is_empty());

    // A mounted result is marked `recorded` in the journal; replay leaves its entry out.
    let journal = host.workspace_dir().join("state/journal.jsonl");
    let text = std::fs::read_to_string(&journal).unwrap();
    let mut entry: Value = serde_json::from_str(text.lines().next().unwrap()).unwrap();
    entry["seq"] = json!(1000);
    entry["result"]["metadata"] = json!({"dev.umbel/replay": "recorded"});
    std::fs::write(&journal, format!("{text}{entry}\n")).unwrap();
    let replay = host.replay().await.unwrap();
    assert_eq!(replay.skipped, [1000]);
    assert_eq!(replay.report.entries.len(), 2);
    assert_eq!(replay.report.same, 2);
}

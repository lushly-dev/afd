//! `plugin-list`, `plugin-show` and the new `workspace-show` fields (phase 1 specification,
//! sections 8.6 and 3).
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::plugins::{Probe, config, echo, seal};
use support::{Scripted, agent, call, cli_with};
use umbel::plugins::sdk;

fn data(result: &afd::CommandResult<Value>) -> Value {
    assert!(result.success, "{result:?}");
    result.data.clone().unwrap()
}

/// `raw` (loaded), `probe` (loaded, with grants) and `ghost` (optional, with no source).
fn host() -> (tempfile::TempDir, umbel::Host) {
    let dir = support::workspace(&config(
        &[("raw", ""), ("probe", ""), ("ghost", "required = false")],
        "",
    ));
    let host = seal(dir.path(), |b| {
        b.with_compiled(echo("raw"))
            .with_compiled(sdk(Probe::new(&["config", "clock"])))
    })
    .unwrap();
    (dir, host)
}

#[tokio::test]
async fn plugin_list_reports_every_instance_including_a_failed_optional_one() {
    let (_dir, host) = host();
    let list = data(&call(&host, agent("a"), "plugin-list", json!({})).await);
    let plugins = list["plugins"].as_array().unwrap();
    let ids: Vec<_> = plugins.iter().map(|p| p["id"].as_str().unwrap()).collect();
    assert_eq!(ids, ["raw", "probe", "ghost"]);

    let raw = &plugins[0];
    assert_eq!(raw["kind"], "compiled");
    assert_eq!(raw["version"], "1.2.3");
    assert_eq!(raw["status"], "loaded");
    assert_eq!(raw["commands"], 1);
    assert_eq!(raw["packs"], 0);
    assert_eq!(raw["skills"], 0);
    assert_eq!(raw["required"], true);
    assert_eq!(raw["trust"], "trusted, not sandboxed");

    let probe = &plugins[1];
    assert_eq!(probe["commands"], 5);
    assert_eq!(probe["packs"], 1);
    assert_eq!(probe["skills"], 1);

    let ghost = &plugins[2];
    assert_eq!(ghost["status"], "failed");
    assert_eq!(ghost["required"], false);
    assert_eq!(ghost["error"]["code"], "PLUGIN_NOT_FOUND");
    assert!(!ghost["error"]["suggestion"].as_str().unwrap().is_empty());
    assert!(ghost.get("kind").is_none(), "no manifest was read");
    assert_eq!(list["diagnostics"], json!([]));
}

#[tokio::test]
async fn plugin_show_reports_the_manifest_grants_commands_and_effects() {
    let (_dir, host) = host();
    let shown = data(&call(&host, agent("a"), "plugin-show", json!({"plugin": "probe"})).await);
    assert_eq!(shown["plugin"]["title"], "Probe");
    assert_eq!(shown["plugin"]["domains"], json!(["probe"]));
    assert_eq!(shown["instance"]["spaces"], json!(["main", "second"]));
    assert_eq!(shown["instance"]["source"], "compiled:probe");

    let grants = shown["grants"]["items"].as_array().unwrap();
    let names: Vec<_> = grants.iter().map(|g| g["name"].as_str().unwrap()).collect();
    assert_eq!(names, ["config", "clock"]);
    assert!(
        grants
            .iter()
            .all(|g| g["status"] == "granted" && g["required"] == true)
    );

    let commands = shown["commands"].as_array().unwrap();
    let note = commands.iter().find(|c| c["name"] == "probe-note").unwrap();
    assert_eq!(note["effects"], json!(["plugin-state"]));
    assert_eq!(note["mutation"], true);
    assert_eq!(note["origin"]["plugin"], "probe");
    assert_eq!(note["origin"]["kind"], "compiled");
    assert_eq!(note["origin"]["version"], "0.3.0");
    let grants_command = commands
        .iter()
        .find(|c| c["name"] == "probe-grants")
        .unwrap();
    assert_eq!(grants_command["mutation"], false);
    assert_eq!(grants_command["expose"]["mcp"], true);
    assert_eq!(grants_command["expose"]["palette"], false);

    // A failed instance still shows what failed.
    let ghost = data(&call(&host, agent("a"), "plugin-show", json!({"plugin": "ghost"})).await);
    assert_eq!(ghost["instance"]["status"], "failed");
    assert_eq!(ghost["instance"]["error"]["code"], "PLUGIN_NOT_FOUND");
    assert!(ghost.get("plugin").is_none());
}

#[tokio::test]
async fn plugin_show_refuses_an_unknown_instance_and_a_missing_argument() {
    let (_dir, host) = host();
    let unknown = call(
        &host,
        agent("a"),
        "plugin-show",
        json!({"plugin": "nobody"}),
    )
    .await;
    let error = unknown.error.unwrap();
    assert_eq!(error.code, "PLUGIN_NOT_FOUND");
    assert!(error.suggestion.unwrap().contains("plugin-list"));
    let missing = call(&host, agent("a"), "plugin-show", json!({})).await;
    assert!(!missing.success);
}

#[tokio::test]
async fn workspace_show_lists_the_plugins_and_the_versions() {
    let (_dir, host) = host();
    let shown = data(&call(&host, agent("a"), "workspace-show", json!({})).await);
    assert_eq!(
        shown["plugins"],
        json!([
            {"id": "raw", "kind": "compiled", "version": "1.2.3", "status": "loaded"},
            {"id": "probe", "kind": "compiled", "version": "0.3.0", "status": "loaded"},
            {"id": "ghost", "status": "failed"},
        ])
    );
    assert_eq!(shown["versions"]["config"], 3);
    assert_eq!(shown["versions"]["manifest"], json!([1, 2]));
    assert_eq!(shown["versions"]["provenance"], 1);
    assert_eq!(shown["versions"]["event"], 1);
    for shape in ["store", "document", "locator", "proposal"] {
        assert_eq!(shown["versions"][shape], 1, "{shape}");
    }
    assert_eq!(shown["versions"]["protocol"], 1);
    assert_eq!(shown["versions"]["wit"], "umbel:plugin/plugin@1.0.0");
    assert_eq!(shown["versions"]["pack"], 1);
}

#[tokio::test]
async fn the_plugin_commands_are_projected_into_the_cli() {
    let dir = support::workspace(&config(&[("raw", "")], ""));
    let configure = |b: umbel::HostBuilder| b.with_compiled(echo("raw"));
    let list = cli_with(
        dir.path(),
        &["plugin", "list"],
        Scripted::no_terminal(),
        configure,
    )
    .await;
    assert_eq!(list.code, 0, "{}", list.stdout);
    assert_eq!(list.json()["data"]["plugins"][0]["id"], "raw");
    let show = cli_with(
        dir.path(),
        &["plugin", "show", "plugin=raw"],
        Scripted::no_terminal(),
        configure,
    )
    .await;
    assert_eq!(show.code, 0, "{}", show.stdout);
    assert_eq!(show.json()["data"]["plugin"]["id"], "raw");
}

#[tokio::test]
async fn with_no_plugin_the_default_first_class_set_and_lists_are_unchanged() {
    let dir = support::minimal();
    let host = support::host(dir.path());
    let list = data(&call(&host, agent("a"), "plugin-list", json!({})).await);
    assert_eq!(list["plugins"], json!([]));
    assert_eq!(host.first_class_tools(), ["workspace-show", "event-list"]);
}

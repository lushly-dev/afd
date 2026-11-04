//! Not in the request path, never approving (phase 4 specification, section 3.3; principle 4):
//! `curator-run` and every curator command are command line only and never first-class. Over
//! MCP, on every lane of the host's server (the stdio and HTTP servers the binary runs, in both
//! eras), `tools/list` and `afd-discover` list none of them, and `afd-call`, `afd-batch`,
//! `afd-pipe` and a direct `tools/call` run none; an in-process agent is refused. The host refuses
//! at seal to expose the pipeline wider than its steps, and to name any of them a first-class tool. The
//! run's own steps refuse any call that is not a step of it, whoever calls. The pipeline holds no
//! decision, and a run writes no memory.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::sync::Arc;

use afd::{Actor, ActorKind, CommandInterface, fixed_clock};
use serde_json::{Value, json};
use support::*;
use umbel::HostBuilder;
use umbel::plugins::sdk;
use umbel::testkit::mcp::Client;
use umbel_sdk::{Asset, Cx, Outcome, Plugin, failure};
use umbel_store::MemoryStore;

/// Every command the curator ships, its pipeline included.
const CURATOR: [&str; 6] = [
    "curator-candidates",
    "curator-promote",
    "curator-status",
    "curator-plan",
    "curator-finish",
    "curator-run",
];

/// A workspace with a settled shared fact, so a run that ran would draft.
fn settled() -> Fx {
    let mut fx = Fx::new();
    fx.remember_twice(fact(1, "human:ada", &["space"], "Shared", "Words."), 101);
    fx.at(day(8));
    fx
}

/// That no run took place: no lock, no stub.
fn nothing_ran(fx: &Fx) {
    assert!(
        fx.curator_records("state").is_empty(),
        "a run took the lock"
    );
    assert!(fx.stubs().is_empty(), "a run drafted");
}

#[tokio::test]
async fn no_curator_command_is_listed_discovered_or_callable_over_mcp() {
    let fx = settled();
    for name in CURATOR {
        let definition = fx
            .host
            .registry()
            .get(name)
            .unwrap_or_else(|| panic!("{name}"));
        assert!(
            definition.expose.cli && !definition.expose.mcp && !definition.expose.agent,
            "{name}: {:?}",
            definition.expose
        );
        assert!(!definition.expose.palette, "{name}");
    }
    for mut client in Client::lanes(&fx.host).await {
        let label = client.label();
        let tools = client.tool_names().await;
        let discovered = client.call("afd-discover", json!({ "limit": 200 })).await;
        let listed: Vec<String> = discovered["data"]["commands"]
            .as_array()
            .unwrap_or_else(|| panic!("{label}: {discovered}"))
            .iter()
            .map(|c| c["name"].as_str().unwrap().to_owned())
            .collect();
        assert!(
            listed.iter().any(|name| name == "knowledge-propose-batch"),
            "{label}: the stand-in's batch is on every surface, so the listing is real"
        );
        for name in CURATOR {
            assert!(
                !tools.iter().any(|t| t == name),
                "{label}: {name} in tools/list"
            );
            assert!(
                !listed.iter().any(|t| t == name),
                "{label}: {name} discovered"
            );
            let called = client.afd_call(name, json!({ "space": "main" })).await;
            assert_eq!(called["success"], false, "{label}: {name}: {called}");
            assert_eq!(
                called["error"]["code"], "COMMAND_NOT_FOUND",
                "{label}: {name}"
            );
            let direct = client.call_raw(name, json!({ "space": "main" })).await;
            assert!(
                direct.get("error").is_some() || direct["result"]["isError"] == true,
                "{label}: {name}: {direct}"
            );
            let batch = client
                .call(
                    "afd-batch",
                    json!({ "commands": [{ "command": name, "input": { "space": "main" } }] }),
                )
                .await;
            assert_eq!(
                batch["results"][0]["result"]["success"], false,
                "{label}: {name}: {batch}"
            );
            let pipe = client
                .call(
                    "afd-pipe",
                    json!({ "steps": [{ "command": name, "input": { "space": "main" } }] }),
                )
                .await;
            assert_ne!(
                pipe["steps"][0]["status"], "success",
                "{label}: {name}: {pipe}"
            );
            assert!(
                !pipe.to_string().contains("\"counts\""),
                "{label}: {name}: {pipe}"
            );
        }
    }
    nothing_ran(&fx);
}

#[tokio::test]
async fn an_in_process_agent_and_the_mcp_interface_are_refused() {
    let fx = settled();
    for (actor, interface) in [
        (
            Actor::new(ActorKind::Agent).with_id("helper"),
            CommandInterface::Agent,
        ),
        (human("local"), CommandInterface::Mcp),
        (
            Actor::new(ActorKind::Agent)
                .with_id("helper")
                .with_on_behalf_of("local"),
            CommandInterface::Mcp,
        ),
    ] {
        for name in CURATOR {
            let refused = fx
                .call(actor.clone(), interface, name, json!({ "space": "main" }))
                .await;
            assert_eq!(code(&refused), "COMMAND_NOT_EXPOSED", "{name}");
        }
    }
    nothing_ran(&fx);
}

#[test]
fn naming_a_curator_command_as_a_first_class_tool_is_refused_at_seal() {
    for name in CURATOR {
        let fx = Fx::with(&config(""));
        let text = std::fs::read_to_string(fx.path("umbel.toml"))
            .unwrap()
            .replace(
                "[principal]",
                &format!("[mcp]\nfirst_class_tools = [\"{name}\"]\n\n[principal]"),
            );
        std::fs::write(fx.path("umbel.toml"), text).unwrap();
        let refused = HostBuilder::open(fx.dir.path())
            .unwrap()
            .with_compiled(Arc::new(sdk(umbel_plugin_curator::plugin())))
            .with_compiled(Arc::new(sdk(knowledge::StandIn)))
            .seal()
            .err()
            .unwrap_or_else(|| panic!("{name} named first-class sealed"));
        assert_eq!(
            refused.code(),
            "WORKSPACE_CONFIG_INVALID",
            "{name}: {refused}"
        );
        assert!(refused.message().contains("first_class_tools"), "{name}");
        assert!(
            refused.message().contains("not exposed over MCP"),
            "{name}: {refused}"
        );
    }
}

/// The curator with its manifest edited: the same handlers and files.
struct Edited(&'static str);

impl Plugin for Edited {
    fn manifest(&self) -> &'static str {
        self.0
    }

    fn assets(&self) -> &'static [Asset] {
        umbel_plugin_curator::plugin().assets()
    }

    fn handle(&self, name: &str, input: Value, cx: &mut Cx) -> Outcome {
        umbel_plugin_curator::plugin().handle(name, input, cx)
    }
}

#[test]
fn the_host_refuses_at_seal_to_expose_the_run_wider_than_its_steps() {
    let shipped = "result = \"last\"\njournal = { mode = \"digest\" }";
    assert!(umbel_plugin_curator::MANIFEST.contains(shipped));
    for (wide, interface) in [
        ("expose = { mcp = true, agent = false, cli = true }", "mcp"),
        (
            "expose = { mcp = false, agent = true, cli = true }",
            "agent",
        ),
    ] {
        let text = umbel_plugin_curator::MANIFEST.replace(
            &format!("expose = {{ mcp = false, agent = false, cli = true }}\n{shipped}"),
            &format!("{wide}\n{shipped}"),
        );
        assert_ne!(text, umbel_plugin_curator::MANIFEST);
        let fx = Fx::new();
        let refused = HostBuilder::open(fx.dir.path())
            .unwrap()
            .with_compiled(Arc::new(sdk(Edited(Box::leak(text.into_boxed_str())))))
            .with_compiled(Arc::new(sdk(knowledge::StandIn)))
            .with_clock(fixed_clock(day(8)))
            .seal()
            .err()
            .expect("a pipeline wider than its steps is refused");
        assert_eq!(refused.code(), "PLUGIN_MANIFEST_INVALID", "{refused}");
        let message = refused.message();
        assert!(message.contains("pipelines[0].expose"), "{message}");
        assert!(message.contains("`curator-plan`"), "{message}");
        assert!(message.contains(interface), "{message}");
    }
}

/// Another plugin whose pipelines call the curator's steps.
struct Sneak;

impl Plugin for Sneak {
    fn manifest(&self) -> &'static str {
        r#"manifest_version = 4
protocol = 1

[plugin]
id = "sneak"
title = "Sneak"
version = "0.1.0"
description = "Pipelines that call the curator's run steps from outside its run."
kind = "compiled"
domains = ["sneak"]

[[commands]]
name = "sneak-noop"
description = "Nothing."
effects = ["inspect"]
input_schema = { type = "object" }
expose = { mcp = false, agent = false, cli = true }

[[pipelines]]
name = "sneak-plan"
description = "Take the curator's lock and read its drafts."
effects = ["store-write"]
input_schema = { type = "object" }
expose = { mcp = false, agent = false, cli = true }
journal = { mode = "digest" }
steps = [{ command = "curator-plan", input = { space = "main" } }]

[[pipelines]]
name = "sneak-finish"
description = "Feed the curator invented results."
effects = ["store-write"]
input_schema = { type = "object" }
expose = { mcp = false, agent = false, cli = true }
journal = { mode = "digest" }
steps = [{ command = "curator-finish", input = { space = "main", run = "r", plan = {}, results = [], withdrawals = [], feed = { decisions = [], next = 0 } } }]
"#
    }

    fn handle(&self, name: &str, _input: Value, _cx: &mut Cx) -> Outcome {
        failure("COMMAND_NOT_FOUND", name, "Run a pipeline.")
    }
}

#[tokio::test]
async fn the_runs_steps_refuse_any_call_that_is_not_a_step_of_it() {
    let fx = settled();
    // At the command line, directly.
    for name in ["curator-plan", "curator-finish"] {
        let input = if name == "curator-plan" {
            json!({ "space": "main" })
        } else {
            json!({ "run": "r", "plan": {}, "results": [], "withdrawals": [], "feed": {} })
        };
        let refused = fx
            .call(human("local"), CommandInterface::Cli, name, input)
            .await;
        assert_eq!(code(&refused), "CURATOR_RUN_REQUIRED", "{name}");
    }
    // As steps of another plugin's pipeline: attested, but to the wrong plugin and pipeline.
    let enabled = std::fs::read_to_string(fx.path("umbel.toml"))
        .unwrap()
        .replace(
            "enabled = [\"curator\", \"knowledge\"]",
            "enabled = [\"curator\", \"knowledge\", \"sneak\"]\n\n[plugins.sneak]\nsource = \"compiled:sneak\"",
        );
    std::fs::write(fx.path("umbel.toml"), enabled).unwrap();
    let host = HostBuilder::open(fx.dir.path())
        .unwrap()
        .with_compiled(Arc::new(sdk(umbel_plugin_curator::plugin())))
        .with_compiled(Arc::new(sdk(knowledge::StandIn)))
        .with_compiled(Arc::new(sdk(Sneak)))
        .with_clock(fixed_clock(day(8)))
        .seal()
        .unwrap();
    for pipeline in ["sneak-plan", "sneak-finish"] {
        let context = host
            .context(human("local"))
            .with_interface(CommandInterface::Cli);
        let result = json_of(
            host.registry()
                .execute(pipeline, json!({}), Some(context))
                .await,
        );
        assert_eq!(
            code(&result),
            "CURATOR_RUN_REQUIRED",
            "{pipeline}: {result}"
        );
    }
    nothing_ran(&fx);
}

#[test]
fn the_run_holds_no_decision_and_no_write_to_memory_or_knowledge() {
    let manifest: toml::Value = toml::from_str(umbel_plugin_curator::MANIFEST).unwrap();
    let steps: Vec<&str> = manifest["pipelines"][0]["steps"]
        .as_array()
        .unwrap()
        .iter()
        .map(|step| step["command"].as_str().unwrap())
        .collect();
    for decision in [
        "knowledge-approve",
        "knowledge-reject",
        "knowledge-verify",
        "knowledge-auto-approve",
        "knowledge-withdraw",
        "memory-confirm",
        "memory-invalidate",
        "memory-forget",
    ] {
        assert!(!steps.contains(&decision), "{decision}");
    }
    let grants: Vec<&str> = manifest["grants"]
        .as_array()
        .unwrap()
        .iter()
        .map(|g| g["name"].as_str().unwrap())
        .collect();
    for write in [
        "memory_write",
        "documents_write",
        "content_write",
        "index_write",
        "graph_write",
    ] {
        assert!(!grants.contains(&write), "{write}");
    }
}

#[tokio::test]
async fn a_run_writes_no_memory() {
    let fx = settled();
    let store = umbel_store_embedded::SqliteMemoryStore::open(
        &fx.space_dir("main"),
        "main",
        umbel_store_embedded::StoreOptions::default(),
    )
    .unwrap();
    let reader = umbel_store::ReaderFilter::tokens(["space"]).unwrap();
    let before = store.changes(0, 1000, &reader, None).unwrap();
    let report = fx.report().await;
    assert_eq!(report["counts"]["drafted"], 1, "{report}");
    let after = store.changes(0, 1000, &reader, None).unwrap();
    assert_eq!(before, after, "the memory store took no change");
}

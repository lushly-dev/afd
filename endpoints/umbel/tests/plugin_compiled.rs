//! Compiled plugins (phase 1 specification, sections 6.1 and 8.1): an SDK plugin and a raw
//! `CompiledPlugin` load from `with_compiled`, a binary built through `cli::run`'s `configure`
//! hook serves them, and the plugin gate sees to what a result may carry.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use afd::{ApprovalPolicy, CommandContext, CommandDefinition, ExecutionTime, success};
use serde_json::{Value, json};
use support::plugins::{Probe, Raw, closure, config, echo, echo_manifest, seal};
use support::{Scripted, agent, call, cli_with, events};
use umbel::plugins::{PluginCommand, sdk};

fn workspace_with(instances: &[(&str, &str)]) -> tempfile::TempDir {
    support::workspace(&config(instances, ""))
}

fn data(result: &afd::CommandResult<Value>) -> Value {
    assert!(result.success, "{result:?}");
    result.data.clone().unwrap()
}

#[tokio::test]
async fn an_sdk_plugin_loads_with_its_packs_and_skills_from_assets() {
    let dir = workspace_with(&[("probe", "")]);
    let probe = Probe::new(&["config", "packs", "clock"]);
    let host = seal(dir.path(), |b| b.with_compiled(sdk(probe))).unwrap();

    // The plugin's pack files came from `assets()`: the grant reads one.
    let result = call(&host, agent("a"), "probe-grants", json!({})).await;
    let report = data(&result);
    assert_eq!(report["packs"], "ok", "{report}");
    assert_eq!(report["config"], "ok");
    assert_eq!(report["clock"], "ok");

    // plugin-show reports the pack and the skill the manifest declares.
    let shown = data(&call(&host, agent("a"), "plugin-show", json!({"plugin": "probe"})).await);
    assert_eq!(shown["packs"][0]["id"], "p");
    assert_eq!(shown["skills"][0]["name"], "probe-guide");
    assert_eq!(shown["instance"]["status"], "loaded");
}

#[tokio::test]
async fn a_raw_compiled_plugin_loads_and_is_called_like_any_command() {
    let dir = workspace_with(&[("raw", "")]);
    let host = seal(dir.path(), |b| b.with_compiled(echo("raw"))).unwrap();
    let result = call(&host, agent("a"), "raw-echo", json!({"text": "hi"})).await;
    assert_eq!(data(&result), json!({"text": "hi"}));
    // The input schema is the manifest's, closed.
    let refused = call(&host, agent("a"), "raw-echo", json!({"other": 1})).await;
    assert!(!refused.success);
}

#[tokio::test]
async fn a_binary_built_through_the_configure_hook_serves_the_plugins() {
    let dir = workspace_with(&[("raw", ""), ("probe", "")]);
    let run = cli_with(
        dir.path(),
        &["raw", "echo", "text=fromcli"],
        Scripted::no_terminal(),
        |b| {
            b.with_compiled(echo("raw"))
                .with_compiled(sdk(Probe::new(&[])))
        },
    )
    .await;
    assert_eq!(run.code, 0, "{}", run.stdout);
    assert_eq!(run.json()["data"], json!({"text": "fromcli"}));

    // `umbel help` lists the plugin commands.
    let help = cli_with(dir.path(), &["help"], Scripted::no_terminal(), |b| {
        b.with_compiled(echo("raw"))
            .with_compiled(sdk(Probe::new(&[])))
    })
    .await;
    assert_eq!(help.code, 0);
    assert!(help.stdout.contains("raw-echo"), "{}", help.stdout);
    assert!(help.stdout.contains("probe-grants"), "{}", help.stdout);

    // Without the hook the binary has no such plugin, and the open says so.
    let bare = cli_with(
        dir.path(),
        &["raw", "echo", "text=x"],
        Scripted::no_terminal(),
        |b| b,
    )
    .await;
    assert_eq!(bare.code, 1);
    assert_eq!(bare.error_code(), "PLUGIN_NOT_FOUND");
}

#[tokio::test]
async fn a_catalog_plugin_that_is_not_enabled_is_not_loaded() {
    let dir = workspace_with(&[]);
    let host = seal(dir.path(), |b| b.with_compiled(echo("raw"))).unwrap();
    assert!(!host.registry().has("raw-echo"));
    let list = data(&call(&host, agent("a"), "plugin-list", json!({})).await);
    assert_eq!(list["plugins"], json!([]));
}

#[tokio::test]
async fn definitions_carry_the_manifests_metadata_and_expose_flags() {
    let manifest = echo_manifest(
        "meta",
        r#"category = "demo"
tags = ["a", "b"]
version = "2.0.0"
confirm_prompt = "Really?"
destructive = true
approval = "required"
execution_time = "slow"
expose = { mcp = false, agent = true, cli = true, palette = true }
examples = [{ title = "Say hi", input = { text = "hi" } }]
"#,
    )
    .replace("effects = [\"inspect\"]", "effects = [\"plugin-state\"]");
    let dir = workspace_with(&[("meta", "")]);
    let plugin = Raw::new(manifest, |_| {
        Ok(vec![closure("meta-echo", |input, _| success(input))])
    });
    let host = seal(dir.path(), |b| b.with_compiled(plugin)).unwrap();
    let command = host.registry().get("meta-echo").unwrap();
    assert_eq!(command.description, "Answer the input.");
    assert_eq!(command.category.as_deref(), Some("demo"));
    assert_eq!(command.tags, Some(vec!["a".to_owned(), "b".to_owned()]));
    assert_eq!(command.version.as_deref(), Some("2.0.0"));
    assert_eq!(command.confirm_prompt.as_deref(), Some("Really?"));
    assert_eq!(command.destructive, Some(true));
    assert!(matches!(command.approval, Some(ApprovalPolicy::Required)));
    assert_eq!(command.execution_time, Some(ExecutionTime::Slow));
    assert!(command.mutation, "plugin-state is a mutation");
    assert_eq!(command.examples.as_ref().map(Vec::len), Some(1));
    assert!(!command.expose.mcp);
    assert!(command.expose.agent && command.expose.cli && command.expose.palette);
}

#[tokio::test]
async fn a_missing_handler_and_an_extra_handler_are_refused() {
    let dir = workspace_with(&[("raw", "")]);
    let missing = Raw::new(echo_manifest("raw", ""), |_| Ok(vec![]));
    let error = seal(dir.path(), |b| b.with_compiled(missing))
        .err()
        .unwrap();
    assert_eq!(error.code(), "PLUGIN_MANIFEST_INVALID");
    assert!(error.message().contains("raw-echo"), "{error}");

    let extra = Raw::new(echo_manifest("raw", ""), |_| {
        Ok(vec![
            closure("raw-echo", |input, _| success(input)),
            closure("raw-other", |input, _| success(input)),
        ])
    });
    let error = seal(dir.path(), |b| b.with_compiled(extra)).err().unwrap();
    assert_eq!(error.code(), "PLUGIN_MANIFEST_INVALID");
    assert!(error.message().contains("raw-other"), "{error}");
}

#[tokio::test]
async fn a_finished_definition_is_checked_against_the_manifest_entry() {
    let schema = json!({
        "type": "object",
        "properties": { "text": { "type": "string" } },
        "additionalProperties": false,
    });
    let build = |description: &'static str, mutation: bool| {
        let schema = schema.clone();
        Raw::new(echo_manifest("raw", ""), move |_| {
            let mut definition = CommandDefinition::new(
                "raw-echo",
                description,
                vec![],
                support::plugins::Closure(Box::new(|input, _| success(input))),
            );
            definition.mutation = mutation;
            Ok(vec![PluginCommand::definition(definition, schema.clone())])
        })
    };
    let dir = workspace_with(&[("raw", "")]);

    // The same description, schema and mutation load; the host sets the expose flags itself.
    let host = seal(dir.path(), |b| {
        b.with_compiled(build("Answer the input.", false))
    })
    .unwrap();
    let command = host.registry().get("raw-echo").unwrap();
    assert!(command.expose.mcp && command.expose.cli && !command.expose.palette);
    assert_eq!(
        data(&call(&host, agent("a"), "raw-echo", json!({"text": "x"})).await),
        json!({"text": "x"})
    );

    for (description, mutation, what) in [
        ("Something else.", false, "description"),
        ("Answer the input.", true, "mutation"),
    ] {
        let error = seal(dir.path(), |b| {
            b.with_compiled(build(description, mutation))
        })
        .err()
        .unwrap();
        assert_eq!(error.code(), "PLUGIN_MANIFEST_INVALID", "{what}");
        assert!(error.message().contains(what), "{error}");
    }
}

#[tokio::test]
async fn a_panic_is_command_execution_error_and_the_next_call_works() {
    let dir = workspace_with(&[("probe", ""), ("raw", "")]);
    let panicking = Raw::new(echo_manifest("raw", ""), |_| {
        Ok(vec![closure("raw-echo", |input, _: CommandContext| {
            assert!(input.get("text").is_none(), "boom");
            success(json!({"ok": true}))
        })])
    });
    let host = seal(dir.path(), |b| {
        b.with_compiled(sdk(Probe::new(&[])))
            .with_compiled(panicking)
    })
    .unwrap();

    for (command, input) in [
        ("probe-panic", json!({})),
        ("raw-echo", json!({"text": "x"})),
    ] {
        let result = call(&host, agent("a"), command, input).await;
        assert!(!result.success, "{command}");
        assert_eq!(
            result.error.as_ref().unwrap().code,
            "COMMAND_EXECUTION_ERROR",
            "{command}"
        );
    }
    // The instances stay loaded and the next call works.
    assert!(
        call(&host, agent("a"), "probe-grants", json!({}))
            .await
            .success
    );
    assert!(call(&host, agent("a"), "raw-echo", json!({})).await.success);
}

#[tokio::test]
async fn a_results_provenance_keeps_only_the_fields_a_command_may_supply() {
    let dir = workspace_with(&[("probe", "")]);
    let host = seal(dir.path(), |b| b.with_compiled(sdk(Probe::new(&[])))).unwrap();
    let result = call(&host, agent("agent-1"), "probe-forge", json!({})).await;
    assert!(result.success, "{result:?}");
    let extra = &result.metadata.as_ref().unwrap().extra;

    // Only the supplied fields of the right type survive.
    assert_eq!(
        extra["dev.umbel/provenance"],
        json!({"origin": "user-stated", "confidence": 0.75, "session": "s1"})
    );
    // The gate stamps the plugin; a forged stamp, replay marker and unknown key are gone.
    assert_eq!(
        extra["dev.umbel/plugin"],
        json!({"id": "probe", "kind": "compiled"})
    );
    assert!(!extra.contains_key("dev.umbel/replay"));
    assert!(!extra.contains_key("dev.umbel/zzz"));
    // The record is kept, and the host's own keys are the host's: the mutation is stamped true,
    // in the default space the command has no input for.
    assert_eq!(
        extra["dev.umbel/record"],
        json!({"kind": "forged-ok", "id": "r1"})
    );
    assert_eq!(extra["dev.umbel/mutation"], json!(true));
    assert_eq!(extra["dev.umbel/space"], json!("main"));

    // The event the host projected has the host-filled fields from the journal entry, not the
    // plugin's.
    let stream = events(dir.path(), "main");
    assert_eq!(stream.len(), 1, "{stream:?}");
    let provenance = &stream[0]["provenance"];
    assert_eq!(provenance["origin"], "user-stated");
    assert_eq!(provenance["space"], "main");
    assert_eq!(provenance["principal"], json!(null));
    assert_eq!(provenance["agent"]["id"], "agent-1");
    assert_ne!(provenance["traceId"], "forged");
    assert_ne!(provenance["observedAt"], "2000-01-01T00:00:00Z");
    assert_eq!(provenance["session"], "s1");
    assert_eq!(provenance["confidence"], 0.75);
}

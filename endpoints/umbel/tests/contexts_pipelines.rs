//! AFD contexts and pipelines as data (phase 1 specification, section 8.5, D3): plugin contexts
//! are registered once, by the server, before the middleware snapshot; a pipeline runs its steps
//! with `$input`; a pipeline naming a missing command is not registered and the instance still
//! loads; its effects must cover its steps'; a pipeline with a confirm-gated step gets the union
//! of its steps' prompts (M2 of the 2026-11-01 review).
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use afd::{CommandResult, ResultMetadata};
use serde_json::{Value, json};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use support::mcp::{Client, Era, Transport};
use support::plugins::{Raw, closure, config, seal};
use support::{agent, call, events};

const PLAIN: &str = "{ type = \"object\", properties = {}, additionalProperties = false }";
const TEXT: &str = "{ type = \"object\", properties = { text = { type = \"string\" } }, additionalProperties = false }";

/// The `ctxp` plugin's manifest; `pipelines` is appended.
fn manifest(pipelines: &str) -> String {
    format!(
        r#"manifest_version = 1
protocol = 1

[plugin]
id = "ctxp"
title = "Ctxp"
version = "1.0.0"
description = "Contexts and pipelines."
kind = "compiled"
domains = ["ctxp"]

[[contexts]]
name = "ctxp"
description = "The ctxp commands."
triggers = ["scope"]
priority = 5

[[contexts]]
name = "ctxp-other"
description = "Another scope."

[[commands]]
name = "ctxp-in"
description = "Echo the text; available in the ctxp context."
effects = ["inspect"]
input_schema = {TEXT}
contexts = ["ctxp"]

[[commands]]
name = "ctxp-out"
description = "Echo the text; available in every context."
effects = ["inspect"]
input_schema = {TEXT}

[[commands]]
name = "ctxp-other"
description = "Available only in the other context."
effects = ["inspect"]
input_schema = {PLAIN}
contexts = ["ctxp-other"]

[[commands]]
name = "ctxp-note"
description = "Record a note."
effects = ["plugin-state"]
input_schema = {TEXT}

[[commands]]
name = "ctxp-bump"
description = "Count a call."
effects = ["plugin-state"]
input_schema = {PLAIN}

[[commands]]
name = "ctxp-clear"
description = "Clear every note."
effects = ["plugin-state"]
input_schema = {PLAIN}
confirm_prompt = "Clear every note."
destructive = true

[[commands]]
name = "ctxp-guarded"
description = "Needs an approval."
effects = ["plugin-state"]
input_schema = {PLAIN}
approval = "required"
{pipelines}"#
    )
}

const PIPELINES: &str = r#"
[[pipelines]]
name = "ctxp-twice"
description = "Echo two texts in one call."
effects = ["inspect"]
input_schema = { type = "object", properties = { first = { type = "string" }, second = { type = "string" } }, required = ["first", "second"], additionalProperties = false }
steps = [
  { command = "ctxp-in", input = { text = "$input.first" }, as = "one" },
  { command = "ctxp-out", input = { text = "$steps.one.text" }, as = "two" },
  { command = "ctxp-out", input = { text = "$input.second" } },
]

[[pipelines]]
name = "ctxp-reset"
description = "Count a call, then clear every note."
effects = ["plugin-state"]
input_schema = { type = "object", properties = {}, additionalProperties = false }
steps = [
  { command = "ctxp-bump" },
  { command = "ctxp-clear" },
]

[[pipelines]]
name = "ctxp-noted"
description = "Record a note through a step."
effects = ["plugin-state"]
input_schema = { type = "object", properties = { text = { type = "string" } }, additionalProperties = false }
steps = [ { command = "ctxp-note", input = { text = "$input.text" } } ]

[[pipelines]]
name = "ctxp-guard-run"
description = "Runs a step that needs an approval."
effects = ["plugin-state"]
input_schema = { type = "object", properties = {}, additionalProperties = false }
steps = [ { command = "ctxp-bump" }, { command = "ctxp-guarded" } ]

[[pipelines]]
name = "ctxp-ghost"
description = "Names a command nobody provides."
effects = ["inspect"]
input_schema = { type = "object", properties = {}, additionalProperties = false }
steps = [ { command = "ctxp-in" }, { command = "nobody-home" } ]

[[pipelines]]
name = "ctxp-nest"
description = "Names another pipeline."
effects = ["inspect"]
input_schema = { type = "object", properties = {}, additionalProperties = false }
steps = [ { command = "ctxp-twice" } ]

[[pipelines]]
name = "ctxp-ack"
description = "Names a host mutation."
effects = ["inspect"]
input_schema = { type = "object", properties = {}, additionalProperties = false }
steps = [ { command = "event-ack" } ]
"#;

#[derive(Clone, Default)]
struct Counters {
    bump: Arc<AtomicUsize>,
    clear: Arc<AtomicUsize>,
    guarded: Arc<AtomicUsize>,
}

fn with_record(mut result: CommandResult<Value>, record: Value) -> CommandResult<Value> {
    result
        .metadata
        .get_or_insert_with(ResultMetadata::new)
        .extra
        .insert("dev.umbel/record".to_owned(), record);
    result
}

fn plugin(manifest: String, counters: &Counters) -> Raw {
    let counters = counters.clone();
    Raw::new(manifest, move |_| {
        let echo = |name: &'static str| {
            closure(name, |input, _| {
                afd::success(json!({ "text": input.get("text").cloned().unwrap_or(Value::Null) }))
            })
        };
        let bump = Arc::clone(&counters.bump);
        let clear = Arc::clone(&counters.clear);
        let guarded = Arc::clone(&counters.guarded);
        Ok(vec![
            echo("ctxp-in"),
            echo("ctxp-out"),
            closure("ctxp-other", |_, _| afd::success(json!({}))),
            closure("ctxp-note", |input, _| {
                let text = input["text"].as_str().unwrap_or("note").to_owned();
                with_record(
                    afd::success(json!({ "noted": text })),
                    json!({ "kind": "note", "id": text }),
                )
            }),
            closure("ctxp-bump", move |_, _| {
                bump.fetch_add(1, Ordering::SeqCst);
                afd::success(json!({ "bumped": true }))
            }),
            closure("ctxp-clear", move |_, _| {
                clear.fetch_add(1, Ordering::SeqCst);
                afd::success(json!({ "cleared": true }))
            }),
            closure("ctxp-guarded", move |_, _| {
                guarded.fetch_add(1, Ordering::SeqCst);
                afd::success(json!({ "guarded": true }))
            }),
        ])
    })
}

fn host_with(extra: &str, counters: &Counters) -> (tempfile::TempDir, umbel::Host) {
    let dir = support::workspace(&config(&[("ctxp", "")], extra));
    let host = seal(dir.path(), |b| {
        b.with_compiled(plugin(manifest(PIPELINES), counters))
    })
    .unwrap();
    (dir, host)
}

fn registered(host: &umbel::Host, name: &str) -> usize {
    host.registry()
        .list()
        .iter()
        .filter(|command| command.name == name)
        .count()
}

// ── Contexts ─────────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn plugin_contexts_are_registered_once_by_the_server() {
    let (_dir, host) = host_with("", &Counters::default());
    for name in ["afd-context-list", "afd-context-enter", "afd-context-exit"] {
        assert_eq!(registered(&host, name), 1, "{name}");
    }
    let listed = call(&host, agent("a"), "afd-context-list", json!({})).await;
    // The tools have no session here, but the list answers from the configured contexts.
    let text = serde_json::to_string(&listed).unwrap();
    assert!(text.contains("ctxp-other"), "{text}");
    assert!(text.contains("The ctxp commands."), "{text}");

    // The doctor's surface re-check does not register them a second time.
    let report = call(&host, agent("a"), "workspace-doctor", json!({})).await;
    let surface = report.data.unwrap()["checks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|check| check["id"] == "mcp.surface")
        .unwrap()
        .clone();
    assert_eq!(surface["status"], "pass", "{surface}");
    assert_eq!(registered(&host, "afd-context-enter"), 1);
}

#[tokio::test]
async fn a_host_with_no_plugin_context_configures_none() {
    let dir = support::workspace(&config(&[("hello", "")], ""));
    let host = seal(dir.path(), |b| {
        b.with_compiled(umbel::plugins::sdk(umbel_plugin_hello::plugin()))
    })
    .unwrap();
    assert_eq!(registered(&host, "afd-context-list"), 0);
}

#[tokio::test]
async fn entering_a_context_scopes_the_plugins_commands() {
    let (_dir, host) = host_with("", &Counters::default());
    let mut client = Client::connect(&host, Transport::Stdio, Era::Legacy).await;
    let entered = client
        .afd_call("afd-context-enter", json!({ "context": "ctxp-other" }))
        .await;
    assert_eq!(entered["success"], true, "{entered}");

    let blocked = client.afd_call("ctxp-in", json!({ "text": "x" })).await;
    assert_eq!(
        blocked["error"]["code"], "COMMAND_NOT_IN_CONTEXT",
        "{blocked}"
    );
    assert_eq!(
        client.afd_call("ctxp-other", json!({})).await["success"],
        true
    );
    // A command with no contexts is available in every context.
    assert_eq!(
        client.afd_call("ctxp-out", json!({ "text": "x" })).await["success"],
        true
    );

    client
        .afd_call("afd-context-enter", json!({ "context": "ctxp" }))
        .await;
    assert_eq!(
        client.afd_call("ctxp-in", json!({ "text": "x" })).await["success"],
        true
    );
    let blocked = client.afd_call("ctxp-other", json!({})).await;
    assert_eq!(
        blocked["error"]["code"], "COMMAND_NOT_IN_CONTEXT",
        "{blocked}"
    );

    // Outside any context everything is available again.
    client.afd_call("afd-context-exit", json!({})).await;
    client.afd_call("afd-context-exit", json!({})).await;
    assert_eq!(
        client.afd_call("ctxp-other", json!({})).await["success"],
        true
    );
}

// ── Pipelines ────────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn a_pipeline_runs_its_steps_with_input_and_earlier_steps() {
    let (_dir, host) = host_with("", &Counters::default());
    let result = call(
        &host,
        agent("a"),
        "ctxp-twice",
        json!({ "first": "ada", "second": "grace" }),
    )
    .await;
    assert!(result.success, "{result:?}");
    let steps = result.data.unwrap()["steps"].clone();
    assert_eq!(steps.as_array().unwrap().len(), 3);
    assert_eq!(steps[0]["command"], "ctxp-in");
    assert_eq!(steps[0]["as"], "one");
    assert_eq!(steps[0]["data"]["text"], "ada");
    // `$steps.one.text` is the first step's data.
    assert_eq!(steps[1]["data"]["text"], "ada");
    assert_eq!(steps[2]["data"]["text"], "grace");
    assert_eq!(steps[2]["status"], "success");
    assert!(steps[2].get("as").is_none());

    // The input is validated against the pipeline's own schema before any step runs.
    let refused = call(&host, agent("a"), "ctxp-twice", json!({ "first": "ada" })).await;
    assert!(!refused.success);

    // Over MCP and the CLI it is a command like any other.
    for mut client in Client::lanes(&host).await {
        let over = client
            .call("ctxp-twice", json!({ "first": "a", "second": "b" }))
            .await;
        assert_eq!(over["success"], true, "{}: {over}", client.label());
        assert_eq!(over["data"]["steps"][2]["data"]["text"], "b");
    }
}

#[tokio::test]
async fn a_failing_step_fails_the_pipeline_with_the_step_named() {
    let counters = Counters::default();
    let (_dir, host) = host_with("", &counters);
    let failed = call(&host, agent("a"), "ctxp-guard-run", json!({})).await;
    assert!(!failed.success);
    let error = failed.error.unwrap();
    // The approval middleware runs at the registry, so it still checks the step inside.
    assert_eq!(error.code, "APPROVAL_REQUIRED", "{error:?}");
    let details = error.details.unwrap();
    assert_eq!(details["pipeline"], "ctxp-guard-run");
    assert_eq!(details["command"], "ctxp-guarded");
    assert_eq!(details["step"], 1);
    assert_eq!(counters.guarded.load(Ordering::SeqCst), 0);
    // The step before it ran: a pipeline is not a transaction.
    assert_eq!(counters.bump.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a_pipeline_naming_a_missing_command_is_not_registered_and_the_instance_loads() {
    let (_dir, host) = host_with("", &Counters::default());
    assert!(host.registry().get("ctxp-ghost").is_none());
    assert!(host.registry().get("ctxp-twice").is_some());
    // A step may not name a pipeline, or a host mutation no plugin effect covers.
    assert!(host.registry().get("ctxp-nest").is_none());
    assert!(host.registry().get("ctxp-ack").is_none());

    let shown = call(
        &host,
        agent("a"),
        "plugin-show",
        json!({ "plugin": "ctxp" }),
    )
    .await;
    let pipelines = shown.data.unwrap()["pipelines"].clone();
    let by_name = |name: &str| {
        pipelines
            .as_array()
            .unwrap()
            .iter()
            .find(|pipeline| pipeline["name"] == name)
            .unwrap()
            .clone()
    };
    assert_eq!(by_name("ctxp-twice")["state"], "registered");
    let ghost = by_name("ctxp-ghost");
    assert_eq!(ghost["state"], "not-registered");
    assert!(
        ghost["reason"].as_str().unwrap().contains("nobody-home"),
        "{ghost}"
    );
    assert!(
        by_name("ctxp-nest")["reason"]
            .as_str()
            .unwrap()
            .contains("do not nest")
    );
    assert!(
        by_name("ctxp-ack")["reason"]
            .as_str()
            .unwrap()
            .contains("host mutation")
    );

    let report = call(&host, agent("a"), "workspace-doctor", json!({})).await;
    let check = report.data.unwrap()["checks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|check| check["id"] == "plugins.pipelines")
        .unwrap()
        .clone();
    assert_eq!(check["status"], "warn", "{check}");
    assert!(check["message"].as_str().unwrap().contains("nobody-home"));
}

#[test]
fn a_pipeline_whose_effects_do_not_cover_its_steps_fails_its_instance() {
    let weak = r#"
[[pipelines]]
name = "ctxp-weak"
description = "Declares too little."
effects = ["inspect"]
input_schema = { type = "object", properties = {}, additionalProperties = false }
steps = [ { command = "ctxp-note" } ]
"#;
    let dir = support::workspace(&config(&[("ctxp", "")], ""));
    let error = seal(dir.path(), |b| {
        b.with_compiled(plugin(manifest(weak), &Counters::default()))
    })
    .err()
    .unwrap();
    assert_eq!(error.code(), "PLUGIN_MANIFEST_INVALID");
    assert!(error.message().contains("pipelines[0].effects"), "{error}");
    assert!(error.message().contains("plugin-state"), "{error}");
    assert!(error.message().contains("ctxp-note"), "{error}");

    // An optional instance is dropped instead, and plugin-list says why.
    let dir = support::workspace(&config(&[("ctxp", "required = false")], ""));
    let host = seal(dir.path(), |b| {
        b.with_compiled(plugin(manifest(weak), &Counters::default()))
    })
    .unwrap();
    assert!(host.registry().get("ctxp-note").is_none());
    let runtime = tokio::runtime::Builder::new_current_thread()
        .build()
        .unwrap();
    let listed = runtime
        .block_on(call(&host, agent("a"), "plugin-list", json!({})))
        .data
        .unwrap();
    assert_eq!(listed["plugins"][0]["status"], "failed");
    assert_eq!(
        listed["plugins"][0]["error"]["code"],
        "PLUGIN_MANIFEST_INVALID"
    );
}

#[tokio::test]
async fn a_pipelines_steps_project_events_and_the_pipeline_adds_none() {
    let (dir, host) = host_with("", &Counters::default());
    let result = call(&host, agent("a"), "ctxp-noted", json!({ "text": "hello" })).await;
    assert!(result.success, "{result:?}");
    // One event from the step's own record; the pipeline command is a mutation but is not
    // projected a second time.
    assert_eq!(events(dir.path(), "main").len(), 1);
    assert_eq!(events(dir.path(), "main")[0]["record"]["id"], "hello");
}

// ── Confirmations ────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn a_pipeline_with_a_confirm_gated_step_gets_the_union_of_its_steps_prompts() {
    let (_dir, host) = host_with(
        "\n[mcp]\nconfirmations = \"enforce\"\n",
        &Counters::default(),
    );
    let definition = host.registry().get("ctxp-reset").unwrap();
    assert_eq!(
        definition.confirm_prompt.as_deref(),
        Some("ctxp-clear: Clear every note.")
    );
    assert_eq!(definition.destructive, Some(true));
    // A pipeline with no gated step asks for nothing.
    assert!(
        host.registry()
            .get("ctxp-twice")
            .unwrap()
            .confirm_prompt
            .is_none()
    );
}

#[tokio::test]
async fn an_unconfirmed_pipeline_call_fails_before_any_step_runs_and_a_confirmed_one_runs_them_all()
{
    let counters = Counters::default();
    let (_dir, host) = host_with("\n[mcp]\nconfirmations = \"enforce\"\n", &counters);
    let mut expected = 0;
    for mut client in Client::lanes(&host).await {
        let label = client.label();
        let refused = client.call("ctxp-reset", json!({})).await;
        assert_eq!(
            refused["error"]["code"], "CONFIRMATION_REQUIRED",
            "{label}: {refused}"
        );
        assert_eq!(
            counters.bump.load(Ordering::SeqCst),
            expected,
            "{label}: no step ran"
        );
        assert_eq!(counters.clear.load(Ordering::SeqCst), expected, "{label}");

        let ran = client.call("ctxp-reset", json!({ "confirm": true })).await;
        assert_eq!(ran["success"], true, "{label}: {ran}");
        expected += 1;
        assert_eq!(
            counters.bump.load(Ordering::SeqCst),
            expected,
            "{label}: every step ran"
        );
        assert_eq!(counters.clear.load(Ordering::SeqCst), expected, "{label}");
    }
}

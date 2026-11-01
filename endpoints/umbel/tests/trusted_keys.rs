//! The host-owned keys (specification section 3, "Trusted keys"): the principal, and the result
//! keys the space and stamp middleware own, with the cursors and events that read them. The cases
//! over MCP (`afd-batch`) arrive with the MCP surfaces.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use afd::{
    Actor, ActorKind, BatchCommand, BatchRequest, CommandContext, CommandInterface, success,
};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use support::*;
use umbel::HostBuilder;
use umbel::principal::{Authentication, PRINCIPAL_KEY, Principal, Transport};

fn whoami() -> afd::CommandDefinition {
    fixture("fixture-whoami", |_, context| {
        success(match Principal::from_context(&context) {
            Some(principal) => principal.to_value(),
            None => Value::Null,
        })
    })
}

#[tokio::test]
async fn host_context_fills_the_principal_and_a_bare_execute_has_none() {
    let dir = minimal();
    let host = HostBuilder::open(dir.path())
        .unwrap()
        .register(whoami())
        .seal()
        .unwrap();
    let actor = Actor::new(ActorKind::Service).with_id("embedder-7");
    let context = host.context(actor.clone());
    assert!(context.trace_id.is_some());
    let principal = Principal::from_context(&context).unwrap();
    assert_eq!(
        principal,
        Principal::new(actor, Transport::Library, Authentication::Embedder)
    );

    let called = host
        .registry()
        .execute("fixture-whoami", json!({}), Some(context))
        .await;
    assert_eq!(called.data.unwrap()["transport"], "library");
    let bare = host
        .registry()
        .execute("fixture-whoami", json!({}), None)
        .await;
    assert_eq!(bare.data.unwrap(), Value::Null);
}

#[tokio::test]
async fn a_forged_principal_in_a_batch_context_changes_nothing() {
    let dir = minimal();
    let host = HostBuilder::open(dir.path())
        .unwrap()
        .register(whoami())
        .seal()
        .unwrap();
    let forged = json!({"version": 0, "actor": {"kind": "human", "id": "root"}, "transport": "cli", "authentication": "process"});
    let mut request = BatchRequest::new(vec![BatchCommand::new("fixture-whoami", json!({}))]);
    request.context = Some(HashMap::from([(PRINCIPAL_KEY.to_owned(), forged)]));
    let mut context = host.context(Actor::new(ActorKind::Agent).with_id("real"));
    context.interface = Some(CommandInterface::Agent);
    let result = host
        .registry()
        .execute_batch_with_context(request, context)
        .await;
    let seen = &result.results[0].result.data.as_ref().unwrap();
    assert_eq!(seen["actor"]["id"], "real");
    assert_eq!(seen["transport"], "library");
}

#[tokio::test]
async fn the_cli_sets_its_own_principal_and_ignores_a_forged_one_in_umbel_batch() {
    let dir = minimal();
    let request = json!({
        "commands": [{"command": "fixture-whoami"}],
        "context": {PRINCIPAL_KEY: {"version": 0, "actor": {"kind": "human", "id": "root"}, "transport": "library", "authentication": "embedder"}},
    })
    .to_string();
    let run = cli_with(
        dir.path(),
        &["batch", &request],
        Scripted::no_terminal(),
        |b| b.register(whoami()),
    )
    .await;
    assert_eq!(run.code, 0, "{}", run.stdout);
    let seen = run.json()["results"][0]["result"]["data"].clone();
    assert_eq!(seen["actor"], json!({"kind": "human", "id": "local"}));
    assert_eq!(seen["transport"], "cli");
    assert_eq!(seen["authentication"], "process");

    let single = cli_with(
        dir.path(),
        &["call", "fixture-whoami"],
        Scripted::no_terminal(),
        |b| b.register(whoami()),
    )
    .await;
    assert_eq!(single.json()["data"]["actor"]["id"], "local");
}

#[tokio::test]
async fn principal_local_id_names_the_cli_actor() {
    let dir = workspace("config_version = 1\n[principal]\nlocal_id = \"ada-laptop\"\n");
    let run = cli_with(
        dir.path(),
        &["call", "fixture-whoami"],
        Scripted::no_terminal(),
        |b| b.register(whoami()),
    )
    .await;
    assert_eq!(run.json()["data"]["actor"]["id"], "ada-laptop");
}

#[tokio::test]
async fn result_keys_a_read_sets_are_removed_and_a_mutation_is_stamped_with_the_host_space() {
    let dir = two_spaces();
    let host = HostBuilder::open(dir.path())
        .unwrap()
        .register(forging_read("fixture-forge-read"))
        .register(forging_mutation("fixture-forge-write"))
        .register(fixture("fixture-failing-write", |_, _| {
            let mut result = afd::failure::<Value>(afd::CommandError::new("X", "no"));
            result
                .metadata
                .get_or_insert_with(afd::ResultMetadata::new)
                .extra
                .insert("dev.umbel/mutation".into(), json!(true));
            result
        }))
        .seal()
        .unwrap();
    let context = || host.context(Actor::new(ActorKind::Test).with_id("t"));
    let run = |name: &'static str| {
        let registry = host.registry();
        let context = context();
        async move { registry.execute(name, json!({}), Some(context)).await }
    };

    let read = run("fixture-forge-read").await;
    let extra = &read.metadata.as_ref().unwrap().extra;
    assert!(!extra.contains_key("dev.umbel/mutation"), "{extra:?}");
    assert!(!extra.contains_key("dev.umbel/space"), "{extra:?}");

    let write = run("fixture-forge-write").await;
    let extra = &write.metadata.as_ref().unwrap().extra;
    assert_eq!(extra["dev.umbel/mutation"], true);
    // The handler said `second`; the host stamps the default space of a command with no space input.
    assert_eq!(extra["dev.umbel/space"], "main");

    let failed = run("fixture-failing-write").await;
    assert!(!failed.success);
    assert!(
        !failed
            .metadata
            .unwrap()
            .extra
            .contains_key("dev.umbel/mutation")
    );

    // The built-in reads carry neither key.
    let shown = run("workspace-show").await;
    assert!(
        !shown
            .metadata
            .unwrap()
            .extra
            .contains_key("dev.umbel/space")
    );
}

#[tokio::test]
async fn a_command_with_a_space_input_reads_the_space_the_middleware_stamps() {
    let dir = two_spaces();
    let seen = Arc::new(AtomicUsize::new(0));
    let workspace = umbel::Workspace::open(dir.path()).unwrap();
    let counted = {
        let seen = Arc::clone(&seen);
        move |_: Value, _: CommandContext| {
            seen.fetch_add(1, Ordering::SeqCst);
            success(json!({}))
        }
    };
    let host = HostBuilder::open(dir.path())
        .unwrap()
        .register(spaced("fixture-spaced", workspace))
        .register(
            afd::CommandDefinition::new(
                "fixture-counted",
                "Counts runs",
                vec![afd::CommandParameter::optional_string("space", "The space")],
                SpaceCounter(Box::new(counted)),
            )
            .with_expose(afd::ExposeOptions::new().with_mcp(true).with_cli(true)),
        )
        .seal()
        .unwrap();
    let call = |name: &'static str, input: Value| {
        let registry = host.registry();
        let context = host.context(Actor::new(ActorKind::Test).with_id("t"));
        async move { registry.execute(name, input, Some(context)).await }
    };

    for (input, expected) in [(json!({}), "main"), (json!({"space": "second"}), "second")] {
        let result = call("fixture-spaced", input).await;
        assert_eq!(result.data.as_ref().unwrap()["space"], expected);
        assert_eq!(result.metadata.unwrap().extra["dev.umbel/space"], expected);
    }

    let refused = call("fixture-counted", json!({"space": "nowhere"})).await;
    let error = refused.error.unwrap();
    assert_eq!(error.code, "SPACE_NOT_FOUND");
    assert!(error.suggestion.unwrap().contains("space-list"));
    assert_eq!(seen.load(Ordering::SeqCst), 0, "the handler never ran");
    let ran = call("fixture-counted", json!({"space": "second"})).await;
    assert!(ran.success);
    assert_eq!(seen.load(Ordering::SeqCst), 1);
}

struct SpaceCounter(Box<dyn Fn(Value, CommandContext) -> afd::CommandResult<Value> + Send + Sync>);

#[async_trait::async_trait]
impl afd::CommandHandler for SpaceCounter {
    async fn execute(&self, input: Value, context: CommandContext) -> afd::CommandResult<Value> {
        (self.0)(input, context)
    }
}

#[test]
fn resolve_space_takes_the_default_or_the_given_declared_space() {
    let dir = two_spaces();
    let workspace = umbel::Workspace::open(dir.path()).unwrap();
    let context = CommandContext::new();
    assert_eq!(
        workspace
            .resolve_space(&json!({}), &context)
            .unwrap()
            .as_str(),
        "main"
    );
    assert_eq!(
        workspace
            .resolve_space(&json!({"space": "second"}), &context)
            .unwrap()
            .as_str(),
        "second"
    );
    for bad in [
        json!({"space": "third"}),
        json!({"space": ""}),
        json!({"space": 3}),
        json!({"space": "Main"}),
    ] {
        let error = workspace.resolve_space(&bad, &context).unwrap_err();
        assert_eq!(error.code, "SPACE_NOT_FOUND", "{bad}");
    }
    let long = "x".repeat(10_000);
    let error = workspace
        .resolve_space(&json!({ "space": long }), &context)
        .unwrap_err();
    assert!(error.message.len() < 200);
}

// ── With events ─────────────────────────────────────────────────────────────────────────────────

fn forged_principal() -> Value {
    json!({"version": 0, "actor": {"kind": "agent", "id": "forger"}, "transport": "library", "authentication": "embedder"})
}

async fn acknowledged(host: &umbel::Host, actor: Actor) -> String {
    let result = host
        .registry()
        .execute("event-list", json!({}), Some(host.context(actor)))
        .await;
    result.data.unwrap()["acknowledged"]
        .as_str()
        .unwrap()
        .to_owned()
}

#[tokio::test]
async fn event_ack_in_a_batch_with_a_forged_principal_stores_under_the_real_one() {
    let dir = minimal();
    let host = HostBuilder::open(dir.path())
        .unwrap()
        .register(remember("note-remember"))
        .seal()
        .unwrap();
    let real = Actor::new(ActorKind::Agent).with_id("real");
    call(&host, real.clone(), "note-remember", json!({"text": "a"})).await;

    let mut request = BatchRequest::new(vec![BatchCommand::new(
        "event-ack",
        json!({"cursor": "v0:main:1"}),
    )]);
    request.context = Some(HashMap::from([(
        PRINCIPAL_KEY.to_owned(),
        forged_principal(),
    )]));
    let mut context = host.context(real.clone());
    context.interface = Some(CommandInterface::Agent);
    let batch = host
        .registry()
        .execute_batch_with_context(request, context)
        .await;
    assert!(batch.results[0].result.success, "{batch:?}");

    assert_eq!(acknowledged(&host, real).await, "v0:main:1");
    let forger = Actor::new(ActorKind::Agent).with_id("forger");
    assert_eq!(acknowledged(&host, forger).await, "v0:main:0");
}

#[tokio::test]
async fn umbel_batch_stores_the_cursor_under_the_cli_principal_not_a_forged_one() {
    let dir = minimal();
    let configure = |b: HostBuilder| b.register(remember("note-remember"));
    let remembered = cli_with(
        dir.path(),
        &["call", "note-remember", "text=a"],
        Scripted::no_terminal(),
        configure,
    )
    .await;
    assert_eq!(remembered.code, 0, "{}", remembered.stdout);
    let request = json!({
        "commands": [{"command": "event-ack", "input": {"cursor": "v0:main:1"}}],
        "context": {PRINCIPAL_KEY: forged_principal()},
    })
    .to_string();
    let run = cli_with(
        dir.path(),
        &["batch", &request],
        Scripted::no_terminal(),
        configure,
    )
    .await;
    assert_eq!(run.code, 0, "{}", run.stdout);

    let listed = cli_with(
        dir.path(),
        &["event", "list"],
        Scripted::no_terminal(),
        configure,
    )
    .await;
    assert_eq!(listed.json()["data"]["acknowledged"], "v0:main:1");
}

#[tokio::test]
async fn a_read_that_sets_the_host_keys_makes_no_event() {
    let dir = two_spaces();
    let host = HostBuilder::open(dir.path())
        .unwrap()
        .register(forging_read("fixture-forge-read"))
        .seal()
        .unwrap();
    let actor = Actor::new(ActorKind::Test).with_id("t");
    let result = call(&host, actor, "fixture-forge-read", json!({})).await;
    let extra = &result.metadata.as_ref().unwrap().extra;
    assert!(!extra.contains_key("dev.umbel/mutation") && !extra.contains_key("dev.umbel/space"));
    assert!(events(dir.path(), "main").is_empty());
    assert!(events(dir.path(), "second").is_empty());
    // The journal holds the stamped result, so the keys are absent there too.
    let entry = &journal_entries(dir.path())[0];
    let journaled = &entry.result.metadata.as_ref().unwrap().extra;
    assert!(
        !journaled.contains_key("dev.umbel/mutation") && !journaled.contains_key("dev.umbel/space")
    );
}

#[tokio::test]
async fn a_mutation_that_names_another_space_is_projected_into_the_resolved_space() {
    let dir = two_spaces();
    let host = HostBuilder::open(dir.path())
        .unwrap()
        .register(forging_mutation("fixture-forge-write"))
        .seal()
        .unwrap();
    let actor = Actor::new(ActorKind::Test).with_id("t");
    let result = call(&host, actor, "fixture-forge-write", json!({})).await;
    assert!(result.success);
    // The handler said `second`; the command has no space input, so the event is in `main`.
    assert_eq!(events(dir.path(), "main").len(), 1);
    assert!(events(dir.path(), "second").is_empty());
    assert_eq!(events(dir.path(), "main")[0]["provenance"]["space"], "main");
}

#[tokio::test]
async fn a_bare_execute_of_event_ack_is_unauthorized_and_stores_nothing() {
    let dir = minimal();
    let host = HostBuilder::open(dir.path()).unwrap().seal().unwrap();
    let result = host
        .registry()
        .execute("event-ack", json!({"cursor": "v0:main:0"}), None)
        .await;
    assert_eq!(result.error.unwrap().code, "UNAUTHORIZED");
    let stored = std::fs::read_dir(dir.path().join("state/spaces/main/cursors"))
        .unwrap()
        .count();
    assert_eq!(stored, 0);
}

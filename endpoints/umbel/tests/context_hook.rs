//! The context hook, version 0 (specification sections 4 and 10; AFD's
//! `server_context_hook.rs`): the principal per transport, nothing taken from the request, and
//! what the journal keeps.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use afd::{
    Actor, ActorKind, CommandContext, CommandInterface, SYSTEM_CLOCK, SYSTEM_RANDOM,
    create_context_digest, success,
};
use jsonschema::Validator;
use serde_json::{Value, json};
use std::path::Path;
use support::mcp::{Client, Era, Http, Transport, command_result};
use support::*;
use umbel::HostBuilder;

fn principal_schema() -> Validator {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("schemas/principal.v0.json");
    let schema: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    jsonschema::validator_for(&schema).unwrap()
}

/// A workspace whose `fixture-whoami` is first-class and reports what it sees on its context.
fn whoami_host(config: &str) -> (tempfile::TempDir, umbel::Host) {
    let dir = workspace(&format!(
        "config_version = 1\n\n[mcp]\nfirst_class_tools = [\"workspace-show\", \"fixture-whoami\"]\n{config}"
    ));
    let host = HostBuilder::open(dir.path())
        .unwrap()
        .register(fixture("fixture-whoami", |_, context| {
            let mut keys: Vec<&String> = context.extra.keys().collect();
            keys.sort();
            success(json!({
                "actor": context.actor,
                "interface": context.interface.map(|interface| interface.as_str().to_owned()),
                "principal": context.extra.get("dev.umbel/principal"),
                "extraKeys": keys,
            }))
        }))
        .seal()
        .unwrap();
    (dir, host)
}

fn expect_valid(validator: &Validator, principal: &Value) {
    assert!(
        validator.is_valid(principal),
        "principal.v0.json refuses {principal}"
    );
}

#[tokio::test]
async fn stdio_calls_are_the_local_agent_with_process_authentication() {
    let validator = principal_schema();
    let (_dir, host) = whoami_host("");
    for era in [Era::Modern, Era::Legacy] {
        let mut client = Client::connect(&host, Transport::Stdio, era).await;
        let result = client.call("fixture-whoami", json!({})).await;
        assert_eq!(result["success"], true, "{era:?}: {result}");
        let data = &result["data"];
        assert_eq!(data["actor"], json!({ "kind": "agent", "id": "local" }));
        assert_eq!(
            data["principal"],
            json!({
                "version": 0,
                "actor": { "kind": "agent", "id": "local" },
                "transport": "stdio",
                "authentication": "process",
            })
        );
        expect_valid(&validator, &data["principal"]);
        assert_eq!(data["interface"], "mcp");
        // The principal is the only key the hook adds.
        assert_eq!(data["extraKeys"], json!(["dev.umbel/principal"]));
    }
}

#[tokio::test]
async fn stdio_calls_carry_the_configured_local_id_and_on_behalf_of() {
    let validator = principal_schema();
    let (_dir, host) =
        whoami_host("\n[principal]\nlocal_id = \"ada-laptop\"\non_behalf_of = \"ada\"\n");
    let mut client = Client::connect(&host, Transport::Stdio, Era::Modern).await;
    let result = client.call("fixture-whoami", json!({})).await;
    assert_eq!(
        result["data"]["principal"]["actor"],
        json!({ "kind": "agent", "id": "ada-laptop", "onBehalfOf": "ada" })
    );
    expect_valid(&validator, &result["data"]["principal"]);
}

#[tokio::test]
async fn http_calls_are_the_loopback_agent_with_no_authentication() {
    let validator = principal_schema();
    // The configured local id applies to local callers only; HTTP callers are all "loopback".
    let (_dir, host) =
        whoami_host("\n[principal]\nlocal_id = \"ada-laptop\"\non_behalf_of = \"ada\"\n");
    for era in [Era::Modern, Era::Legacy] {
        let mut client = Client::connect(&host, Transport::Http, era).await;
        let result = client.call("fixture-whoami", json!({})).await;
        assert_eq!(result["success"], true, "{era:?}: {result}");
        let data = &result["data"];
        assert_eq!(data["actor"], json!({ "kind": "agent", "id": "loopback" }));
        assert_eq!(
            data["principal"],
            json!({
                "version": 0,
                "actor": { "kind": "agent", "id": "loopback" },
                "transport": "http",
                "authentication": "none",
            })
        );
        expect_valid(&validator, &data["principal"]);
        assert_eq!(data["extraKeys"], json!(["dev.umbel/principal"]));
    }
}

#[tokio::test]
async fn nothing_in_the_request_changes_the_principal() {
    let (_dir, host) = whoami_host("");
    let http = Http::new(&host);
    let call = |extra: Vec<(&'static str, &'static str)>, meta: Value| {
        let http = http.clone();
        async move {
            let mut params = json!({ "name": "fixture-whoami", "arguments": {} });
            params["_meta"] = support::mcp::modern_meta();
            for (key, value) in meta.as_object().unwrap() {
                params["_meta"][key] = value.clone();
            }
            let reply = http.modern_reply("tools/call", params, &extra).await;
            assert_eq!(reply.status, 200, "{}", reply.text);
            command_result(&reply.json())
        }
    };
    let baseline = call(vec![], json!({})).await;
    // Headers are never read.
    let with_headers = call(
        vec![
            ("x-actor", "admin"),
            ("x-actor-id", "mallory"),
            ("x-forwarded-user", "root"),
            ("x-umbel-principal", "{\"version\":0}"),
        ],
        json!({}),
    )
    .await;
    assert_eq!(with_headers["data"], baseline["data"]);
    // Neither is a forged principal in `_meta`, nor in the tool's arguments.
    let forged = json!({ "dev.umbel/principal": { "version": 0, "actor": { "kind": "human", "id": "root" } } });
    let with_meta = call(vec![], forged).await;
    assert_eq!(with_meta["data"], baseline["data"]);
    let params = json!({
        "name": "fixture-whoami",
        "arguments": { "dev.umbel/principal": { "actor": { "kind": "human", "id": "root" } } },
    });
    let reply = http.modern_reply("tools/call", params, &[]).await;
    let by_arguments = command_result(&reply.json());
    // The arguments are refused by the closed input schema, or ignored; either way no principal
    // other than the loopback one appears.
    assert!(
        by_arguments["success"] == false
            || by_arguments["data"]["principal"] == baseline["data"]["principal"],
        "{by_arguments}"
    );
    assert_eq!(baseline["data"]["actor"]["id"], "loopback");
}

#[tokio::test]
async fn the_hook_runs_for_every_route_and_a_forged_batch_context_cannot_replace_it() {
    let (_dir, host) = whoami_host("");
    for mut client in Client::lanes(&host).await {
        let label = client.label();
        let expected_id = if client.transport == Transport::Http {
            "loopback"
        } else {
            "local"
        };
        // afd-call
        let result = client.afd_call("fixture-whoami", json!({})).await;
        assert_eq!(result["data"]["actor"]["id"], expected_id, "{label}");
        // afd-batch with a request context that tries to set the principal and the actor.
        let batch = client
            .call(
                "afd-batch",
                json!({
                    "commands": [{ "command": "fixture-whoami", "input": {} }],
                    "context": {
                        "dev.umbel/principal": { "version": 0, "actor": { "kind": "human", "id": "root" }, "transport": "cli", "authentication": "process" },
                    },
                }),
            )
            .await;
        let item = &batch["results"][0]["result"];
        assert_eq!(item["data"]["actor"]["id"], expected_id, "{label}: {batch}");
        assert_eq!(
            item["data"]["principal"]["actor"]["id"], expected_id,
            "{label}: {batch}"
        );
        // afd-pipe
        let pipe = client
            .call(
                "afd-pipe",
                json!({ "steps": [{ "command": "fixture-whoami", "input": {} }] }),
            )
            .await;
        assert_eq!(
            pipe["steps"][0]["data"]["actor"]["id"], expected_id,
            "{label}: {pipe}"
        );
    }
}

/// The journal's entries, none before the first call creates the file.
fn journal_so_far(dir: &Path) -> Vec<afd::JournalEntry> {
    if journal_path(dir).exists() {
        journal_entries(dir)
    } else {
        Vec::new()
    }
}

#[tokio::test]
async fn the_journal_keeps_the_expected_actor_and_a_digest_of_the_expected_context() {
    let (dir, host) = whoami_host("");

    for (transport, actor, principal_transport, authentication) in [
        (
            Transport::Stdio,
            Actor::new(ActorKind::Agent).with_id("local"),
            "stdio",
            "process",
        ),
        (
            Transport::Http,
            Actor::new(ActorKind::Agent).with_id("loopback"),
            "http",
            "none",
        ),
    ] {
        let before = journal_so_far(dir.path()).len();
        let mut client = Client::connect(&host, transport, Era::Modern).await;
        let result = client.call("fixture-whoami", json!({})).await;
        assert_eq!(result["success"], true, "{result}");

        let entries = journal_so_far(dir.path());
        assert_eq!(entries.len(), before + 1, "one entry per call");
        let entry = entries.last().unwrap();
        assert_eq!(entry.command, "fixture-whoami");
        assert_eq!(entry.actor.as_ref(), Some(&actor));
        assert_eq!(entry.context_digest.interface.as_deref(), Some("mcp"));

        // The digest covers the actor, the interface, the trace id and the *names* of the other
        // context keys: here the defaults the server fills and the principal key.
        let principal = json!({
            "version": 0,
            "actor": serde_json::to_value(&actor).unwrap(),
            "transport": principal_transport,
            "authentication": authentication,
        });
        let expected = CommandContext::new()
            .with_actor(actor.clone())
            .with_interface(CommandInterface::Mcp)
            .with_trace_id(entry.trace_id.clone().expect("a trace id"))
            .with_clock(SYSTEM_CLOCK)
            .with_random(SYSTEM_RANDOM)
            .with_extra("dev.umbel/principal", principal);
        assert_eq!(
            entry.context_digest.hash,
            create_context_digest(&expected).hash,
            "{transport:?}"
        );
        // The principal enters the journal by name, inside the hash, never as a declared value.
        assert!(entry.context.is_none());
    }
}

#[test]
fn a_library_context_carries_the_embedders_actor_with_embedder_authentication() {
    let validator = principal_schema();
    let (_dir, host) = whoami_host("");
    let actor = Actor::new(ActorKind::Service).with_id("billing");
    let context = host.context(actor.clone());
    assert_eq!(context.actor, Some(actor));
    let principal = context.extra.get("dev.umbel/principal").unwrap();
    assert_eq!(principal["transport"], "library");
    assert_eq!(principal["authentication"], "embedder");
    expect_valid(&validator, principal);
}

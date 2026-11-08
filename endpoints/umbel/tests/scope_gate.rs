//! What a call needs (phase 5 specification, sections 3.3, 5.1 and 5.2; step 3), end to end over
//! HTTP with `umbel-testkit-idp`'s tokens: space-qualified scopes and their order, the union of
//! 5.2's rows (read, write, approve and erase in each space, unqualified verbs for space-less
//! commands), the 403 before dispatch naming every missing scope of a batch, any Umbel scope for
//! everything else, the listings filtered by what a token could call, and the scope gate inside
//! the registry for a call that reaches it another way.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::sync::Arc;
use std::sync::atomic::AtomicUsize;

use afd::{Actor, ActorKind, Credentials};
use serde_json::{Value, json};
use support::hosted::{PUBLIC_URL, Reply};
use support::oauth::{Running, Setup, modern};

/// `alpha` and `beta` are ada's, `private` is bo's; `main`, the default, is anyone's.
const SPACES: &str = r#"[spaces.alpha]
readers = ["human:corp/ada"]

[spaces.beta]
readers = ["human:corp/ada"]

[spaces.private]
readers = ["human:corp/bo"]
"#;

/// Runs of `fixture-spaced-write`, a mutation with a `space` input and an open schema.
static SPACED_RUNS: AtomicUsize = AtomicUsize::new(0);

async fn running() -> Running {
    Running::start_configured(
        Setup {
            rest: SPACES,
            ..Setup::default()
        },
        |builder| {
            let mut erase = support::fixture("fixture-erase", |_, _| afd::success(json!("erased")));
            erase.mutation = true;
            let mut spaced = support::fixture("fixture-spaced-write", |_, _| {
                SPACED_RUNS.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                afd::success(json!(true))
            });
            spaced.mutation = true;
            builder
                .register(support::needs_approval(
                    "fixture-approved",
                    Arc::new(AtomicUsize::new(0)),
                ))
                .register(erase)
                .register_with_schema(
                    spaced,
                    json!({
                        "type": "object",
                        "properties": { "space": { "type": "string" } },
                        "additionalProperties": true,
                    }),
                )
        },
    )
    .await
}

fn token(running: &Running, scopes: &[&str]) -> String {
    running.token().scopes(scopes.iter().copied()).sign()
}

/// `command` with `input` through `afd-call`.
async fn call(running: &Running, token: &str, command: &str, input: Value) -> Reply {
    running
        .call(
            Some(token),
            "afd-call",
            json!({ "command": command, "input": input }),
        )
        .await
}

/// The `CommandResult` of a call that reached the registry.
fn result(reply: &Reply) -> Value {
    assert_eq!(reply.status, 200, "{}", reply.text);
    reply.json()["result"]["structuredContent"].clone()
}

/// The scopes a 403 names, from its challenge, in order.
fn forbidden(reply: &Reply) -> Vec<String> {
    assert_eq!(reply.status, 403, "{}", reply.text);
    let challenge = reply
        .headers
        .get("www-authenticate")
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned();
    assert!(
        challenge.contains("error=\"insufficient_scope\""),
        "{challenge}"
    );
    let body: Value = serde_json::from_str(&reply.text).unwrap();
    assert_eq!(body["error"], json!("INSUFFICIENT_SCOPE"), "{body}");
    challenge
        .split("scope=\"")
        .nth(1)
        .and_then(|rest| rest.split('"').next())
        .map(|scopes| scopes.split(' ').map(str::to_owned).collect())
        .unwrap_or_default()
}

fn cursor(space: &str) -> Value {
    json!({ "space": space, "cursor": format!("v0:{space}:0") })
}

#[tokio::test]
async fn a_qualified_scope_grants_its_verb_in_its_space_and_every_verb_implies_read_there() {
    let running = running().await;
    let read_alpha = token(&running, &["umbel:read:alpha"]);
    let listed = result(
        &call(
            &running,
            &read_alpha,
            "event-list",
            json!({ "space": "alpha" }),
        )
        .await,
    );
    assert_eq!(listed["success"], json!(true), "{listed}");
    // A mutation in alpha needs write there, and only that is named.
    assert_eq!(
        forbidden(&call(&running, &read_alpha, "event-ack", cursor("alpha")).await),
        ["umbel:write:alpha"]
    );
    // write:alpha implies read:alpha, and grants the mutation.
    let write_alpha = token(&running, &["umbel:write:alpha"]);
    for (command, input) in [
        ("event-list", json!({ "space": "alpha" })),
        ("event-ack", cursor("alpha")),
    ] {
        let done = result(&call(&running, &write_alpha, command, input).await);
        assert_eq!(done["success"], json!(true), "{command}: {done}");
    }
    // ...and nothing in beta, which the token grants no verb in: the registry answers, never a
    // 403 naming beta.
    let other = call(&running, &write_alpha, "event-ack", cursor("beta")).await;
    assert_eq!(result(&other)["error"]["code"], json!("SPACE_NOT_READABLE"));
    // An unqualified verb grants it in every space; write does not imply approve or erase.
    let write = token(&running, &["umbel:write"]);
    for space in ["alpha", "beta", "main"] {
        let done = result(&call(&running, &write, "event-ack", cursor(space)).await);
        assert_eq!(done["success"], json!(true), "{space}: {done}");
    }
}

#[tokio::test]
async fn approve_and_erase_are_needed_in_the_space_beside_write() {
    let running = running().await;
    let write = token(&running, &["umbel:write"]);
    // The commands take no space input: they run in the default space, main.
    assert_eq!(
        forbidden(&call(&running, &write, "fixture-approved", json!({})).await),
        ["umbel:approve:main"]
    );
    assert_eq!(
        forbidden(&call(&running, &write, "fixture-erase", json!({})).await),
        ["umbel:erase:main"]
    );
    // approve:main implies read:main: the call passes the gate and the approval middleware
    // holds it.
    let approve = token(&running, &["umbel:approve:main"]);
    let held = result(&call(&running, &approve, "fixture-approved", json!({})).await);
    assert_eq!(held["error"]["code"], json!("APPROVAL_REQUIRED"), "{held}");
    // erase needs write too: erase:main alone is refused for write:main, and both run it.
    let erase = token(&running, &["umbel:erase:main"]);
    assert_eq!(
        forbidden(&call(&running, &erase, "fixture-erase", json!({})).await),
        ["umbel:write:main"]
    );
    let both = token(&running, &["umbel:write:main", "umbel:erase:main"]);
    let erased = result(&call(&running, &both, "fixture-erase", json!({})).await);
    assert_eq!(erased["data"], json!("erased"), "{erased}");
}

#[tokio::test]
async fn a_batch_with_any_missing_step_is_one_403_naming_every_missing_scope() {
    let running = running().await;
    let reads = token(&running, &["umbel:read:alpha", "umbel:read:beta"]);
    let batch = json!({ "commands": [
        { "command": "event-ack", "input": cursor("alpha") },
        { "command": "event-list", "input": { "space": "alpha" } },
        { "command": "event-ack", "input": cursor("beta") },
    ] });
    let reply = running.call(Some(&reads), "afd-batch", batch).await;
    assert_eq!(forbidden(&reply), ["umbel:write:alpha", "umbel:write:beta"]);
    // A step in a space the caller may not read (bo's) is deferred, never named: the 403 names
    // only the readable step's scope.
    let with_private = token(&running, &["umbel:read:alpha", "umbel:read:private"]);
    let batch = json!({ "commands": [
        { "command": "event-ack", "input": cursor("private") },
        { "command": "event-ack", "input": cursor("alpha") },
    ] });
    let reply = running.call(Some(&with_private), "afd-batch", batch).await;
    assert_eq!(forbidden(&reply), ["umbel:write:alpha"]);
    assert!(!reply.text.contains("private"), "{}", reply.text);
    // afd-pipe is decided step by step the same way.
    let pipe = json!({ "steps": [
        { "command": "event-list", "input": { "space": "alpha" } },
        { "command": "event-ack", "input": cursor("beta") },
    ] });
    let reply = running.call(Some(&reads), "afd-pipe", pipe).await;
    assert_eq!(forbidden(&reply), ["umbel:write:beta"]);
}

#[tokio::test]
async fn space_less_commands_need_any_umbel_scope_and_a_token_without_one_gets_nothing() {
    let running = running().await;
    // A qualified scope is an Umbel scope: the space-less built-ins run on it.
    let read_alpha = token(&running, &["umbel:read:alpha"]);
    for command in ["workspace-show", "auth-show", "space-list", "plugin-list"] {
        let done = result(&call(&running, &read_alpha, command, json!({})).await);
        assert_eq!(done["success"], json!(true), "{command}: {done}");
    }
    // A scope naming a space nobody declared is one too, decided on its text alone: the same
    // answers as a scope naming a space that exists and that the caller may not read.
    let ghost = token(&running, &["umbel:read:ghost"]);
    let private = token(&running, &["umbel:read:private"]);
    for command in ["workspace-show", "space-list", "auth-show"] {
        let one = call(&running, &ghost, command, json!({})).await;
        let two = call(&running, &private, command, json!({})).await;
        assert_eq!(one.status, 200, "{}", one.text);
        let strip = |reply: &Reply| {
            let mut value = result(reply);
            // auth-show echoes the token's own scopes, which differ by construction.
            if command == "auth-show" {
                value["data"]["scopes"] = Value::Null;
            }
            value
        };
        assert_eq!(strip(&one), strip(&two), "{command}");
    }
    // Without any Umbel scope every request is refused, whatever it names.
    let none = token(&running, &["openid", "other:read"]);
    assert_eq!(
        forbidden(&call(&running, &none, "workspace-show", json!({})).await),
        ["umbel:read"]
    );
    for method in [
        "tools/list",
        "resources/list",
        "server/discover",
        "prompts/list",
    ] {
        let reply = modern(&running.client, method, json!({}), Some(&none)).await;
        assert_eq!(forbidden(&reply), ["umbel:read"], "{method}");
    }
}

#[tokio::test]
async fn a_hidden_or_unknown_command_needs_only_an_umbel_scope() {
    let running = running().await;
    let read_alpha = token(&running, &["umbel:read:alpha"]);
    // workspace-doctor is the operator's in a hosted mode, exposed to no MCP caller: no scope is
    // named for it, and the answer is an unknown command's.
    let hidden = call(&running, &read_alpha, "workspace-doctor", json!({})).await;
    let unknown = call(&running, &read_alpha, "workspace-nothing", json!({})).await;
    assert_eq!(hidden.status, 200, "{}", hidden.text);
    assert!(hidden.headers.get("www-authenticate").is_none());
    assert_eq!(
        result(&hidden)["error"]["code"],
        result(&unknown)["error"]["code"]
    );
}

#[tokio::test]
async fn the_listings_show_what_the_token_could_call_in_spaces_the_caller_reads() {
    let running = running().await;
    let names = |token: String| {
        let running = &running;
        async move {
            let reply = modern(&running.client, "tools/list", json!({}), Some(&token)).await;
            assert_eq!(reply.status, 200, "{}", reply.text);
            let tools: Vec<String> = reply.json()["result"]["tools"]
                .as_array()
                .unwrap()
                .iter()
                .map(|tool| tool["name"].as_str().unwrap().to_owned())
                .collect();
            (tools, reply.text)
        }
    };
    let discovered = |token: String| {
        let running = &running;
        async move {
            let result = running
                .result(&token, "afd-discover", json!({ "limit": 200 }))
                .await;
            result.to_string()
        }
    };
    // read:alpha: event-list could run in alpha; fixture-whoami runs in main, which the token
    // grants nothing in; event-ack needs write somewhere.
    let (tools, _) = names(token(&running, &["umbel:read:alpha"])).await;
    assert!(tools.contains(&"event-list".to_owned()), "{tools:?}");
    assert!(!tools.contains(&"fixture-whoami".to_owned()), "{tools:?}");
    let text = discovered(token(&running, &["umbel:read:alpha"])).await;
    assert!(!text.contains("event-ack"), "{text}");
    assert!(!text.contains("fixture-touch"), "{text}");
    // write:alpha adds event-ack, and still nothing that runs in main.
    let text = discovered(token(&running, &["umbel:write:alpha"])).await;
    assert!(text.contains("event-ack"), "{text}");
    assert!(!text.contains("fixture-touch"), "{text}");
    // A token for bo's space and one for a space nobody declared list the same: only what spaces
    // the caller reads decide, never which spaces exist.
    let (private, private_text) = names(token(&running, &["umbel:read:private"])).await;
    let (ghost, ghost_text) = names(token(&running, &["umbel:read:ghost"])).await;
    assert_eq!(private, ghost);
    assert_eq!(private_text, ghost_text);
    assert!(!private.contains(&"event-list".to_owned()), "{private:?}");
}

#[tokio::test]
async fn the_scope_gate_decides_a_call_that_reaches_the_registry_another_way() {
    let running = running().await;
    let host = &running.host;
    // An in-process call carrying credentials: no bearer layer, no AFD check at execution (the
    // registry is not the authorized server's). The scope gate decides it on its own.
    let mut context = host.context(
        Actor::new(ActorKind::Agent)
            .with_id("corp/test-client")
            .with_on_behalf_of("corp/ada"),
    );
    context.credentials = Some(Arc::new(
        Credentials::new(
            running.kit.authorization_server().issuer(),
            "ada",
            "test-client",
            PUBLIC_URL,
            1,
            i64::MAX,
        )
        .with_scopes(["umbel:read:alpha"]),
    ));
    let held = host
        .registry()
        .execute("event-ack", cursor("alpha"), Some(context.clone()))
        .await;
    let error = held.error.unwrap();
    assert_eq!(error.code, "INSUFFICIENT_SCOPE");
    assert_eq!(
        error.details.unwrap()["scopes"],
        json!(["umbel:write:alpha"])
    );
    let listed = host
        .registry()
        .execute(
            "event-list",
            json!({ "space": "alpha" }),
            Some(context.clone()),
        )
        .await;
    assert!(listed.success, "{:?}", listed.error);
    // A space the credentials grant nothing in is the access check's, never the gate's.
    let other = host
        .registry()
        .execute("event-list", json!({ "space": "beta" }), Some(context))
        .await;
    assert_eq!(other.error.unwrap().code, "SPACE_NOT_READABLE");
}

#[tokio::test]
async fn a_space_member_the_command_does_not_declare_is_refused_before_anything_reads_it() {
    let running = running().await;
    // write:main (the default space) and read:alpha: the scope rules decide a space-only command
    // on its `space`, so a `spaces` member naming alpha must never reach the handler.
    let token = token(&running, &["umbel:write:main", "umbel:read:alpha"]);
    let before = SPACED_RUNS.load(std::sync::atomic::Ordering::SeqCst);
    for input in [
        json!({ "spaces": ["alpha"] }),
        json!({ "space": "main", "spaces": ["alpha"] }),
    ] {
        let refused = result(&call(&running, &token, "fixture-spaced-write", input.clone()).await);
        assert_eq!(
            refused["error"]["code"],
            json!("VALIDATION_ERROR"),
            "{input}: {refused}"
        );
        assert!(
            refused["error"]["message"]
                .as_str()
                .unwrap()
                .contains("`spaces`"),
            "{refused}"
        );
    }
    assert_eq!(
        SPACED_RUNS.load(std::sync::atomic::Ordering::SeqCst),
        before
    );
    // The declared member runs.
    let done = result(
        &call(
            &running,
            &token,
            "fixture-spaced-write",
            json!({ "space": "main" }),
        )
        .await,
    );
    assert_eq!(done["success"], json!(true), "{done}");
}

//! #532 through Umbel (phase 5 specification, sections 3.1, 10.2 and 13.2; step 3): a confirmation
//! `requestState` and an approval are bound to the principal that was asked, across every
//! instance serving one workspace behind one URL.
//!
//! - **Confirmations.** Two instances share `state/keys/confirmation.key`, so a state one mints
//!   is read by the other, and AFD binds it to the principal binding: the actor and the verified
//!   issuer, subject and client (M8). Another person, or another client of the same person,
//!   presenting it is asked again and nothing runs; the same person and client with a new token
//!   is not refused.
//! - **Approvals.** An approval token binds the actor it was minted for, and its nonce is spent
//!   once across instances in the shared nonce store: another actor cannot use it on any
//!   instance, and its own actor cannot use it twice.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::{Value, json};
use support::hosted::{Client, Reply, Served};
use support::mcp::modern_meta;
use support::oauth::{Running, Setup};

/// `fixture-clear` through `afd-call` from a 2026-07-28 client that can elicit, sending `token`,
/// with the answer and state of an earlier round in `extra`.
async fn elicited(client: &Client, token: &str, extra: Value) -> Value {
    let tool = "afd-call";
    let mut meta = modern_meta();
    meta["io.modelcontextprotocol/clientCapabilities"] = json!({ "elicitation": {} });
    let mut params = json!({
        "name": tool,
        "arguments": { "command": "fixture-clear", "input": {} },
        "_meta": meta,
    });
    if let Value::Object(extra) = extra {
        for (key, value) in extra {
            params[key] = value;
        }
    }
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": params });
    let bearer = format!("Bearer {token}");
    let headers = [
        ("content-type", "application/json"),
        ("accept", "application/json, text/event-stream"),
        ("mcp-protocol-version", "2026-07-28"),
        ("mcp-method", "tools/call"),
        ("mcp-name", tool),
        ("authorization", bearer.as_str()),
    ];
    let reply: Reply = client
        .send(client.request("POST", "/mcp", &headers, body.to_string()))
        .await;
    assert_eq!(reply.status, 200, "{}", reply.text);
    reply.json()
}

fn accept() -> Value {
    json!({ "confirm": { "action": "accept", "content": { "confirm": true } } })
}

fn state_of(asked: &Value) -> String {
    assert_eq!(asked["result"]["resultType"], "input_required", "{asked}");
    asked["result"]["requestState"].as_str().unwrap().to_owned()
}

fn answered(state: &str) -> Value {
    json!({ "inputResponses": accept(), "requestState": state })
}

#[tokio::test]
async fn a_confirmation_is_bound_to_its_principal_across_instances() {
    let runs = Arc::new(AtomicUsize::new(0));
    let counted = Arc::clone(&runs);
    let running = Running::start_configured(Setup::default(), move |builder| {
        builder.register(support::needs_confirmation("fixture-clear", counted))
    })
    .await;
    // A second instance on the same workspace, served on its own port.
    let second = support::oauth::host_with(
        running.dir.path(),
        &running.kit,
        Some(&running.clock),
        None,
        {
            let runs = Arc::clone(&runs);
            move |builder| builder.register(support::needs_confirmation("fixture-clear", runs))
        },
    );
    let served = Served::start(&second).await;
    let other = Client::plain(served.address);
    let ada = running.token().scopes(["umbel:write"]).sign();

    // Asked on the first instance, answered on the second: it runs.
    let state = state_of(&elicited(&running.client, &ada, json!({})).await);
    let ran = elicited(&other, &ada, answered(&state)).await;
    assert_eq!(
        ran["result"]["structuredContent"]["success"],
        json!(true),
        "{ran}"
    );
    assert_eq!(runs.load(Ordering::SeqCst), 1);

    // Another person presenting ada's state, on either instance, is asked again.
    let state = state_of(&elicited(&running.client, &ada, json!({})).await);
    let bo = running.token().subject("bo").scopes(["umbel:write"]).sign();
    for client in [&running.client, &other] {
        let again = elicited(client, &bo, answered(&state)).await;
        state_of(&again);
    }
    // So is another client of ada's.
    let other_client = running
        .token()
        .client_id("other-client")
        .scopes(["umbel:write"])
        .sign();
    state_of(&elicited(&other, &other_client, answered(&state)).await);
    assert_eq!(runs.load(Ordering::SeqCst), 1);
    // The same person and client with another token is the same principal: it runs.
    let renewed = running.token().scopes(["umbel:write", "umbel:read"]).sign();
    let ran = elicited(&other, &renewed, answered(&state)).await;
    assert_eq!(
        ran["result"]["structuredContent"]["success"],
        json!(true),
        "{ran}"
    );
    assert_eq!(runs.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn an_approval_is_bound_to_its_actor_and_spent_once_across_instances() {
    // A hosted workspace: there approvals are spent in the shared nonce store (mode none keeps
    // AFD's store in memory).
    let dir = support::workspace(
        "config_version = 5\n[principal]\nlocal_id = \"corp/ada\"\n[http]\npublic_url = \"https://umbel.example.com/mcp\"\nallowed_hosts = [\"umbel.example.com\"]\n[auth]\nmode = \"oauth\"\n[auth.namespaces.corp]\n[auth.issuers.as]\nissuer = \"https://as.example.com\"\nnamespace = \"corp\"\n",
    );
    let runs = Arc::new(AtomicUsize::new(0));
    let tokens: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let host = |runs: &Arc<AtomicUsize>| {
        let tokens = Arc::clone(&tokens);
        umbel::HostBuilder::open(dir.path())
            .unwrap()
            .register(support::needs_approval("fixture-gated", Arc::clone(runs)))
            .with_approval_observer(move |request| {
                tokens.lock().unwrap().push(request.approval_token);
            })
            .seal()
            .unwrap()
    };
    let first = host(&runs);
    let second = host(&runs);
    let held = support::call(&first, support::agent("ada"), "fixture-gated", json!({})).await;
    assert_eq!(held.error.unwrap().code, "APPROVAL_REQUIRED");
    let token = tokens.lock().unwrap().pop().unwrap();
    let present = |host: &umbel::Host, actor: &str| {
        let mut context = host.context(support::agent(actor));
        context.approval = Some(token.clone());
        let registry = host.registry();
        async move {
            registry
                .execute("fixture-gated", json!({}), Some(context))
                .await
        }
    };
    // Another actor cannot use it, on either instance.
    for instance in [&first, &second] {
        let refused = present(instance, "bo").await;
        assert!(!refused.success);
    }
    assert_eq!(runs.load(Ordering::SeqCst), 0);
    // Its own actor uses it once, on the second instance, and never again on the first.
    assert!(present(&second, "ada").await.success);
    assert!(!present(&first, "ada").await.success);
    assert_eq!(runs.load(Ordering::SeqCst), 1);
}

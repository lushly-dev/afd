//! Approval evidence from an approver client beyond the shared vectors
//! (`spec/vectors/approver-client.json`): a 2025-era connection, a panicking predicate, and an
//! `approval` the context hook sets.
#![cfg(all(feature = "server", feature = "approval"))]

mod common;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use afd::server::{McpServer, AFD_APPROVAL_META_KEY};
use afd::{
    create_approval_middleware, success, Actor, ActorKind, ApprovalMiddlewareOptions,
    ApprovalPolicy, CommandContext, CommandDefinition, CommandHandler, CommandParameter,
    CommandRegistry, CommandResult,
};
use async_trait::async_trait;
use common::{command_result, modern_post_with_meta, Stdio};
use serde_json::{json, Value};

const SECRET: &str = "test-approver-secret-0123456789abcdef";

struct Delete(Arc<AtomicUsize>);

#[async_trait]
impl CommandHandler for Delete {
    async fn execute(&self, input: Value, _: CommandContext) -> CommandResult<Value> {
        self.0.fetch_add(1, Ordering::SeqCst);
        success(json!({ "deleted": input["id"] }))
    }
}

/// A server whose callers are told apart by the actor the hook maps from `x-test-actor` (the
/// shell is the approver), with tokens kept off MCP for everyone else.
fn server() -> (McpServer, Arc<AtomicUsize>) {
    let runs = Arc::new(AtomicUsize::new(0));
    let registry = CommandRegistry::new();
    let mut delete = CommandDefinition::new(
        "todo-delete",
        "Delete a todo",
        vec![CommandParameter::required_number("id", "Todo ID")],
        Delete(Arc::clone(&runs)),
    )
    .as_mutation()
    .with_approval(ApprovalPolicy::Required);
    delete.expose.mcp = true;
    registry.register(delete).unwrap();
    let options = ApprovalMiddlewareOptions::new(SECRET, registry.list()).with_include_token(false);
    registry.add_middleware(create_approval_middleware(options).unwrap());
    let server = McpServer::new(Arc::new(registry), "approver", "1.0.0")
        .with_context_hook(|request, context| async move {
            let id = request.header("x-test-actor").unwrap_or("shell").to_owned();
            let context = context.with_actor(Actor::new(ActorKind::Agent).with_id(id));
            Ok(match request.header("x-test-approval") {
                Some(token) => context.with_approval(token),
                None => context,
            })
        })
        .with_approver(|context| {
            context
                .actor
                .as_ref()
                .is_some_and(|actor| actor.id.as_deref() == Some("shell"))
        });
    (server, runs)
}

async fn call(server: &McpServer, meta: Value, headers: &[(&str, &str)]) -> Value {
    let params = json!({ "name": "todo-delete", "arguments": { "id": 7 } });
    command_result(&modern_post_with_meta(server, "tools/call", params, meta, headers).await)
}

#[tokio::test]
async fn gives_an_approver_its_token_on_a_2025_connection_and_refuses_the_key_there() {
    let (server, runs) = server();
    let mut stdio = Stdio::connect(server).await;
    let params = json!({ "name": "todo-delete", "arguments": { "id": 7 } });
    let held = command_result(&stdio.request("tools/call", params).await);
    assert_eq!(held["error"]["code"], "APPROVAL_REQUIRED", "{held}");
    // A person approves (`spec/recovery.md`, "Engine errors").
    assert_eq!(held["error"]["recovery"], json!({ "kind": "external" }));
    let token = held["error"]["details"]["approvalToken"].as_str().unwrap();
    let retry = stdio
        .request(
            "tools/call",
            json!({
                "name": "todo-delete",
                "arguments": { "id": 7 },
                "_meta": { AFD_APPROVAL_META_KEY: token },
            }),
        )
        .await;
    let retry = command_result(&retry);
    assert_eq!(retry["error"]["code"], "APPROVAL_REQUIRED", "{retry}");
    assert!(retry["error"]["message"]
        .as_str()
        .unwrap()
        .contains("one command"));
    // An approved call resent the wrong way: the caller reshapes it, so no recovery.
    assert!(retry["error"].get("recovery").is_none(), "{retry}");
    assert_eq!(runs.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn a_panicking_predicate_fails_the_call() {
    let (server, runs) = server();
    let server = server.with_approver(|_| panic!("directory down"));
    let params = json!({ "name": "todo-delete", "arguments": { "id": 7 } });
    let response = modern_post_with_meta(&server, "tools/call", params, json!({}), &[]).await;
    // The panic guard answers a panicking call with a generic internal error.
    assert_eq!(
        command_result(&response)["error"]["code"],
        "INTERNAL_ERROR",
        "{response}"
    );
    assert!(!response.to_string().contains("directory down"));
    assert_eq!(runs.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn verifies_every_token_on_an_approvers_call_against_its_principal() {
    let (server, runs) = server();
    let held = call(&server, json!({}), &[]).await;
    let token = held["error"]["details"]["approvalToken"]
        .as_str()
        .unwrap()
        .to_owned();
    // The hook sets the shell's token on another caller's call: bound to another principal.
    let outside = call(
        &server,
        json!({}),
        &[("x-test-actor", "agent"), ("x-test-approval", &token)],
    )
    .await;
    assert_eq!(outside["error"]["details"]["reason"], "actor-mismatch");
    assert!(outside["error"]["details"]["approvalToken"].is_null());
    // On the approver's own call the hook's evidence holds, verified against the principal.
    let host = call(&server, json!({}), &[("x-test-approval", &token)]).await;
    assert_eq!(host["success"], true, "{host}");
    assert_eq!(runs.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn ignores_the_key_from_a_caller_that_is_not_an_approver() {
    let (server, runs) = server();
    let held = call(&server, json!({}), &[]).await;
    let token = held["error"]["details"]["approvalToken"].as_str().unwrap();
    let agent = call(
        &server,
        json!({ AFD_APPROVAL_META_KEY: token }),
        &[("x-test-actor", "agent")],
    )
    .await;
    assert_eq!(agent["error"]["code"], "APPROVAL_REQUIRED");
    assert!(agent["error"]["details"]["reason"].is_null(), "{agent}");
    assert!(agent["error"]["details"]["approvalToken"].is_null());
    assert_eq!(runs.load(Ordering::SeqCst), 0);
}

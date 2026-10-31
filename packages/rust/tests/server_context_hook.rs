//! The per-request context hook (`McpServer::with_context_hook`), over Streamable HTTP and a
//! stdio-shaped connection.
#![cfg(feature = "server")]

mod common;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use afd::server::{ConfirmationMode, McpServer};
use afd::{
    success, Actor, ActorKind, CommandContext, CommandDefinition, CommandError, CommandHandler,
    CommandRegistry, CommandResult,
};
use async_trait::async_trait;
use common::{command_result, modern_post, Stdio};
use serde_json::{json, Value};

/// Reports what the handler sees on its context, and counts runs.
struct Probe(Arc<AtomicUsize>);

#[async_trait]
impl CommandHandler for Probe {
    async fn execute(&self, _input: Value, context: CommandContext) -> CommandResult<Value> {
        self.0.fetch_add(1, Ordering::SeqCst);
        success(json!({
            "actor": context.actor,
            "interface": context.interface.map(|interface| interface.as_str()),
            "traceId": context.trace_id,
            "extra": context.extra,
        }))
    }
}

fn server() -> (McpServer, Arc<AtomicUsize>) {
    let runs = Arc::new(AtomicUsize::new(0));
    let registry = CommandRegistry::new();
    let mut probe = CommandDefinition::new(
        "context-probe",
        "Show the context",
        vec![],
        Probe(Arc::clone(&runs)),
    );
    probe.expose.mcp = true;
    registry.register(probe).unwrap();
    let mut clear = CommandDefinition::new(
        "todo-clear",
        "Delete todos",
        vec![],
        Probe(Arc::clone(&runs)),
    )
    .as_mutation()
    .with_destructive(true)
    .with_confirm_prompt("Delete every todo?");
    clear.expose.mcp = true;
    registry.register(clear).unwrap();
    // Not exposed to MCP.
    registry
        .register(CommandDefinition::new(
            "secret-rotate",
            "Private",
            vec![],
            Probe(Arc::clone(&runs)),
        ))
        .unwrap();
    (McpServer::new(Arc::new(registry), "hook", "1.0.0"), runs)
}

/// The documented shape: the actor from a header, or a refusal.
fn header_actor(server: McpServer) -> McpServer {
    server.with_context_hook(|request, context| async move {
        let Some(parts) = request.http_parts() else {
            // stdio: the process boundary is the trust boundary.
            return Ok(context.with_actor(Actor::new(ActorKind::Human).with_id("stdio-user")));
        };
        match request.header("x-test-actor") {
            Some(id) => Ok(context
                .with_actor(Actor::new(ActorKind::Service).with_id(id))
                .with_extra("uri", json!(parts.uri.to_string()))),
            None => Err(
                CommandError::new("UNAUTHORIZED", "Authentication is required")
                    .with_suggestion("Send credentials")
                    .with_retryable(false)
                    .with_details([("reason".to_owned(), json!("token expired for alice"))].into()),
            ),
        }
    })
}

async fn call_http(server: &McpServer, tool: &str, headers: &[(&str, &str)]) -> Value {
    let response = modern_post(
        server,
        "tools/call",
        json!({ "name": tool, "arguments": {} }),
        headers,
    )
    .await;
    assert!(
        response["result"]["structuredContent"].is_object(),
        "{response}"
    );
    response
}

#[tokio::test]
async fn the_hook_sets_the_actor_from_a_header_over_http() {
    let (server, _) = server();
    let server = header_actor(server);
    let response = call_http(&server, "context-probe", &[("x-test-actor", "alice")]).await;
    let result = command_result(&response);
    assert_eq!(result["success"], true, "{result}");
    assert_eq!(
        result["data"]["actor"],
        json!({ "kind": "service", "id": "alice" })
    );
    assert_eq!(result["data"]["extra"]["uri"], "/mcp");
    assert_eq!(result["metadata"]["actorKind"], "service");
    // The server's own invariants are intact.
    assert_eq!(result["data"]["interface"], "mcp");
    assert!(result["data"]["traceId"].is_string());
}

#[tokio::test]
async fn a_refusal_becomes_a_failed_result_and_runs_nothing() {
    let (server, runs) = server();
    let server = header_actor(server);
    let response = call_http(&server, "context-probe", &[]).await;
    assert_eq!(response["result"]["isError"], true);
    let result = command_result(&response);
    assert_eq!(result["success"], false);
    assert_eq!(result["error"]["code"], "UNAUTHORIZED");
    assert_eq!(result["error"]["suggestion"], "Send credentials");
    // `details` (where a host might put the reason) never reaches the caller.
    assert!(result["error"].get("details").is_none(), "{result}");
    assert!(!response.to_string().contains("alice"));
    assert_eq!(response["result"]["structuredContent"], result);
    assert_eq!(runs.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn a_refused_caller_cannot_tell_a_real_tool_from_a_missing_or_private_one() {
    let (server, runs) = server();
    let server = header_actor(server);
    let real = command_result(&call_http(&server, "context-probe", &[]).await);
    let missing = command_result(&call_http(&server, "no-such-tool", &[]).await);
    let private = command_result(&call_http(&server, "secret-rotate", &[]).await);
    assert_eq!(real, missing);
    assert_eq!(real, private);
    assert_eq!(runs.load(Ordering::SeqCst), 0);
    // Accepted, the same tools differ again.
    let headers = [("x-test-actor", "alice")];
    let missing = command_result(&call_http(&server, "no-such-tool", &headers).await);
    assert_eq!(missing["error"]["code"], "COMMAND_NOT_FOUND");
}

#[tokio::test]
async fn the_hook_works_over_a_stdio_shaped_connection() {
    let (server, _) = server();
    let mut client = Stdio::connect(header_actor(server)).await;
    let response = client
        .request(
            "tools/call",
            json!({ "name": "context-probe", "arguments": {} }),
        )
        .await;
    let result = command_result(&response);
    assert_eq!(result["success"], true, "{result}");
    assert_eq!(
        result["data"]["actor"],
        json!({ "kind": "human", "id": "stdio-user" })
    );
    assert_eq!(result["data"]["interface"], "mcp");
}

#[tokio::test]
async fn a_stdio_hook_can_refuse_too() {
    let (server, runs) = server();
    let server = server.with_context_hook(|_request, _context| async {
        Err(CommandError::new("FORBIDDEN", "Not allowed"))
    });
    let mut client = Stdio::connect(server).await;
    let response = client
        .request(
            "tools/call",
            json!({ "name": "context-probe", "arguments": {} }),
        )
        .await;
    assert_eq!(command_result(&response)["error"]["code"], "FORBIDDEN");
    assert_eq!(runs.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn the_hook_cannot_drop_the_servers_invariants() {
    let (server, _) = server();
    // A hook that returns a blank context: no interface, trace id or actor.
    let server = server.with_context_hook(|_request, _context| async { Ok(CommandContext::new()) });
    let result = command_result(&call_http(&server, "context-probe", &[]).await);
    assert_eq!(result["data"]["interface"], "mcp");
    assert!(result["data"]["traceId"].is_string());
    assert_eq!(result["data"]["actor"], json!({ "kind": "agent" }));
}

#[tokio::test]
async fn the_hook_sees_the_defaults_and_the_tool_name() {
    let (server, _) = server();
    let server = server
        .with_actor(Actor::new(ActorKind::Service).with_id("svc"))
        .with_context_hook(|request, context| async move {
            // Refine the default actor rather than replace it.
            let actor = context
                .actor
                .clone()
                .unwrap()
                .with_label(request.tool.clone());
            Ok(context.with_actor(actor))
        });
    let result = command_result(&call_http(&server, "context-probe", &[]).await);
    assert_eq!(
        result["data"]["actor"],
        json!({ "kind": "service", "id": "svc", "label": "context-probe" })
    );
}

#[tokio::test]
async fn a_panicking_hook_refuses_without_leaking_the_panic() {
    let (server, runs) = server();
    let server = server.with_context_hook(|_request, _context| async {
        if true {
            panic!("secret internal state");
        }
        Ok(CommandContext::new())
    });
    let response = call_http(&server, "context-probe", &[]).await;
    let result = command_result(&response);
    assert_eq!(result["error"]["code"], "INTERNAL_ERROR");
    assert!(!response.to_string().contains("secret internal state"));
    assert_eq!(runs.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn a_refusal_comes_before_the_confirmation_prompt() {
    let (server, runs) = server();
    let server = header_actor(server.with_confirmations(ConfirmationMode::Enforce));
    // Refused: neither an `input_required` prompt nor CONFIRMATION_REQUIRED.
    let response = modern_post(
        &server,
        "tools/call",
        json!({ "name": "todo-clear", "arguments": {} }),
        &[],
    )
    .await;
    let result = command_result(&response);
    assert_eq!(result["error"]["code"], "UNAUTHORIZED", "{response}");
    assert!(response["result"]["inputRequests"].is_null());

    // Accepted and acknowledged: the command runs as the hook's actor.
    let response = modern_post(
        &server,
        "tools/call",
        json!({ "name": "todo-clear", "arguments": { "confirm": true } }),
        &[("x-test-actor", "alice")],
    )
    .await;
    let result = command_result(&response);
    assert_eq!(result["success"], true, "{response}");
    assert_eq!(
        result["data"]["actor"],
        json!({ "kind": "service", "id": "alice" })
    );
    assert_eq!(runs.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn without_a_hook_nothing_changes() {
    let (server, _) = server();
    let result = command_result(&call_http(&server, "context-probe", &[]).await);
    assert_eq!(result["data"]["actor"], json!({ "kind": "agent" }));
}

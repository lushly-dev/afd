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

/// `tools/call` of `tool` with `arguments` over HTTP, as 2026-07-28.
async fn call_with(
    server: &McpServer,
    tool: &str,
    arguments: Value,
    headers: &[(&str, &str)],
) -> Value {
    let response = modern_post(
        server,
        "tools/call",
        json!({ "name": tool, "arguments": arguments }),
        headers,
    )
    .await;
    assert!(
        response["result"]["structuredContent"].is_object(),
        "{response}"
    );
    response
}

/// Every route that executes commands, with the arguments that run `context-probe` once (or,
/// for batch and pipeline, twice).
fn probe_routes() -> Vec<(&'static str, Value)> {
    vec![
        ("context-probe", json!({})),
        ("context", json!({ "action": "probe" })),
        ("afd-call", json!({ "command": "context-probe" })),
        (
            "afd-batch",
            json!({ "commands": [{ "command": "context-probe" }, { "command": "context-probe" }] }),
        ),
        (
            "afd-pipe",
            json!({ "steps": [{ "command": "context-probe" }, { "command": "context-probe" }] }),
        ),
    ]
}

/// The probe results inside any route's result.
fn probes(tool: &str, result: &Value) -> Vec<Value> {
    match tool {
        "afd-batch" => result["results"]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item["result"]["data"].clone())
            .collect(),
        "afd-pipe" => result["steps"]
            .as_array()
            .unwrap()
            .iter()
            .map(|step| step["data"].clone())
            .collect(),
        _ => vec![result["data"].clone()],
    }
}

#[tokio::test]
async fn every_route_runs_with_the_hooks_actor() {
    let (server, runs) = server();
    let server = header_actor(server);
    for (tool, arguments) in probe_routes() {
        let response = call_with(&server, tool, arguments, &[("x-test-actor", "alice")]).await;
        let result = command_result(&response);
        assert_eq!(response["result"]["isError"], false, "{tool}: {response}");
        let seen = probes(tool, &result);
        assert!(!seen.is_empty(), "{tool}: {result}");
        for data in seen {
            assert_eq!(
                data["actor"],
                json!({ "kind": "service", "id": "alice" }),
                "{tool}: {result}"
            );
            assert_eq!(data["interface"], "mcp", "{tool}");
            assert!(data["traceId"].is_string(), "{tool}");
        }
    }
    // One per route, two each for the batch and the pipeline.
    assert_eq!(runs.load(Ordering::SeqCst), 7);
}

#[tokio::test]
async fn every_route_is_refused_before_anything_runs() {
    let (server, runs) = server();
    let server = header_actor(server.with_confirmations(ConfirmationMode::Enforce));
    let mut routes = probe_routes();
    // Confirm-gated commands: the refusal still comes first, with no prompt.
    routes.push(("afd-call", json!({ "command": "todo-clear" })));
    routes.push((
        "afd-batch",
        json!({ "commands": [{ "command": "todo-clear" }] }),
    ));
    routes.push((
        "afd-pipe",
        json!({ "steps": [{ "command": "todo-clear" }] }),
    ));
    routes.push(("todo", json!({ "action": "clear" })));
    routes.push(("afd-discover", json!({})));
    routes.push(("afd-detail", json!({ "command": "context-probe" })));
    for (tool, arguments) in routes {
        let response = call_with(&server, tool, arguments, &[]).await;
        assert_eq!(response["result"]["isError"], true, "{tool}: {response}");
        assert!(response["result"]["inputRequests"].is_null(), "{tool}");
        let result = command_result(&response);
        assert_eq!(result["success"], false, "{tool}: {result}");
        assert_eq!(result["error"]["code"], "UNAUTHORIZED", "{tool}: {result}");
        assert!(result["error"].get("details").is_none(), "{tool}");
        assert_eq!(response["result"]["structuredContent"], result, "{tool}");
    }
    assert_eq!(runs.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn the_hook_runs_once_per_call_on_every_route() {
    let (server, _) = server();
    let calls = Arc::new(AtomicUsize::new(0));
    let counted = Arc::clone(&calls);
    let server = server.with_context_hook(move |_request, context| {
        counted.fetch_add(1, Ordering::SeqCst);
        async move { Ok(context) }
    });
    let mut routes = probe_routes();
    routes.push(("afd-discover", json!({})));
    routes.push(("afd-detail", json!({ "command": "context-probe" })));
    routes.push(("no-such-tool", json!({})));
    let count = routes.len();
    for (tool, arguments) in routes {
        call_with(&server, tool, arguments, &[]).await;
    }
    assert_eq!(calls.load(Ordering::SeqCst), count);
}

#[tokio::test]
async fn a_blank_hook_context_keeps_private_commands_private_on_every_route() {
    let (server, runs) = server();
    // A blank context drops the remote flag the server set; the server sets it again.
    let server = server.with_context_hook(|_request, _context| async { Ok(CommandContext::new()) });
    for (tool, arguments) in [
        ("secret-rotate", json!({})),
        ("afd-call", json!({ "command": "secret-rotate" })),
    ] {
        let result = command_result(&call_with(&server, tool, arguments, &[]).await);
        assert_eq!(
            result["error"]["code"], "COMMAND_NOT_FOUND",
            "{tool}: {result}"
        );
    }
    let batch = command_result(
        &call_with(
            &server,
            "afd-batch",
            json!({ "commands": [{ "command": "secret-rotate" }] }),
            &[],
        )
        .await,
    );
    assert_eq!(
        batch["results"][0]["result"]["error"]["code"], "COMMAND_NOT_FOUND",
        "{batch}"
    );
    let pipe = command_result(
        &call_with(
            &server,
            "afd-pipe",
            json!({ "steps": [{ "command": "secret-rotate" }] }),
            &[],
        )
        .await,
    );
    assert_eq!(
        pipe["steps"][0]["error"]["code"], "COMMAND_NOT_FOUND",
        "{pipe}"
    );
    assert_eq!(runs.load(Ordering::SeqCst), 0);
}

/// A server with contexts: `context-probe` belongs to `review` only.
fn scoped_server() -> McpServer {
    let registry = CommandRegistry::new();
    let mut probe = CommandDefinition::new(
        "context-probe",
        "Show the context",
        vec![],
        Probe(Arc::new(AtomicUsize::new(0))),
    )
    .with_contexts(["review"]);
    probe.expose.mcp = true;
    registry.register(probe).unwrap();
    McpServer::new(Arc::new(registry), "hook", "1.0.0")
        .with_contexts(vec![
            afd::ContextConfig::new("planning"),
            afd::ContextConfig::new("review"),
        ])
        .unwrap()
}

/// A 2026-07-28 `tools/call` with `_meta["dev.afd/context"]`.
async fn call_in_context(server: &McpServer, context: &str, tool: &str, arguments: Value) -> Value {
    let mut meta: Value = serde_json::from_str(common::META).unwrap();
    meta["dev.afd/context"] = json!(context);
    let body = json!({
        "jsonrpc": "2.0", "id": 1, "method": "tools/call",
        "params": { "name": tool, "arguments": arguments, "_meta": meta },
    });
    let headers = [
        ("mcp-protocol-version", "2026-07-28"),
        ("mcp-method", "tools/call"),
        ("mcp-name", tool),
    ];
    let (status, response) = common::http_post(server, body, &headers).await;
    assert_eq!(status, 200, "{response}");
    response
}

#[tokio::test]
async fn the_request_context_applies_after_the_hook_and_the_hook_cannot_set_it() {
    // The hook tries to enter `review`; only the request's `_meta` decides.
    let server = scoped_server().with_context_hook(|_request, context| async move {
        Ok(context
            .with_actor(Actor::new(ActorKind::Service).with_id("alice"))
            .with_active_context("review"))
    });
    for (tool, arguments) in [
        ("context-probe", json!({})),
        ("afd-call", json!({ "command": "context-probe" })),
    ] {
        let denied =
            command_result(&call_in_context(&server, "planning", tool, arguments.clone()).await);
        assert_eq!(
            denied["error"]["code"], "COMMAND_NOT_IN_CONTEXT",
            "{tool}: {denied}"
        );
        let allowed = command_result(&call_in_context(&server, "review", tool, arguments).await);
        assert_eq!(allowed["success"], true, "{tool}: {allowed}");
        assert_eq!(allowed["data"]["actor"]["id"], "alice", "{tool}");
    }
    let batch = command_result(
        &call_in_context(
            &server,
            "planning",
            "afd-batch",
            json!({ "commands": [{ "command": "context-probe" }] }),
        )
        .await,
    );
    assert_eq!(
        batch["results"][0]["result"]["error"]["code"], "COMMAND_NOT_IN_CONTEXT",
        "{batch}"
    );
    // The hook's context is ignored without `_meta` too: no active context, all commands.
    let open = command_result(
        &call_with(
            &server,
            "afd-call",
            json!({ "command": "context-probe" }),
            &[],
        )
        .await,
    );
    assert_eq!(open["success"], true, "{open}");
}

#[tokio::test]
async fn a_refusal_comes_before_an_unknown_request_context() {
    let server = scoped_server().with_context_hook(|_request, _context| async {
        Err(CommandError::new(
            "UNAUTHORIZED",
            "Authentication is required",
        ))
    });
    let response = call_in_context(&server, "no-such-context", "context-probe", json!({})).await;
    assert_eq!(
        command_result(&response)["error"]["code"],
        "UNAUTHORIZED",
        "{response}"
    );
}

#[tokio::test]
async fn a_stdio_connection_keeps_its_context_stack_with_a_hook() {
    let server = scoped_server().with_context_hook(|_request, context| async move {
        Ok(context.with_actor(Actor::new(ActorKind::Human).with_id("stdio-user")))
    });
    let mut client = Stdio::connect(server).await;
    let call =
        |tool: &'static str, arguments: Value| json!({ "name": tool, "arguments": arguments });
    let entered = client
        .request(
            "tools/call",
            call("afd-context-enter", json!({ "context": "planning" })),
        )
        .await;
    assert_eq!(command_result(&entered)["success"], true, "{entered}");
    let denied = client
        .request(
            "tools/call",
            call("afd-call", json!({ "command": "context-probe" })),
        )
        .await;
    assert_eq!(
        command_result(&denied)["error"]["code"],
        "COMMAND_NOT_IN_CONTEXT",
        "{denied}"
    );
    client
        .request("tools/call", call("afd-context-exit", json!({})))
        .await;
    let allowed = client
        .request(
            "tools/call",
            call("afd-call", json!({ "command": "context-probe" })),
        )
        .await;
    let result = command_result(&allowed);
    assert_eq!(result["data"]["actor"]["id"], "stdio-user", "{allowed}");
}

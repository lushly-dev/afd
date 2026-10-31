//! A panic while serving a tool call must still answer the request, on every route and
//! transport (issue #531). Every request runs under a timeout, so a regression fails the test
//! instead of hanging CI.
//!
//! A command handler's panic is caught by `CommandRegistry::execute` and answers
//! `COMMAND_EXECUTION_ERROR`; a panic in the server's own code (a `group_by` closure, here)
//! answers a generic `INTERNAL_ERROR`. Neither shows the panic message to the caller.
#![cfg(feature = "server")]

mod common;

use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use afd::server::{ConfirmationMode, McpServer, ToolStrategy};
use afd::{
    success, CommandContext, CommandDefinition, CommandError, CommandHandler, CommandMiddleware,
    CommandRegistry, CommandResult, ExposeOptions, JournalRecorder, MemoryJournalSink,
};
use async_trait::async_trait;
use common::{modern_post, Stdio};
use serde_json::{json, Value};

const SECRET: &str = "db password hunter2";

struct Boom;

#[async_trait]
impl CommandHandler for Boom {
    async fn execute(&self, _input: Value, _context: CommandContext) -> CommandResult<Value> {
        panic!("secret internal detail: {SECRET}");
    }
}

/// Panics with a payload that is not a string.
struct BoomWithValue;

#[async_trait]
impl CommandHandler for BoomWithValue {
    async fn execute(&self, _input: Value, _context: CommandContext) -> CommandResult<Value> {
        std::panic::panic_any(42_u8);
    }
}

struct Fine;

#[async_trait]
impl CommandHandler for Fine {
    async fn execute(&self, _input: Value, _context: CommandContext) -> CommandResult<Value> {
        success(json!({ "ok": true }))
    }
}

fn define(name: &str, handler: impl CommandHandler + 'static) -> CommandDefinition {
    CommandDefinition::new(name, name, vec![], handler)
        .with_category("todo")
        .with_expose(ExposeOptions::new().with_mcp(true))
}

fn registry() -> CommandRegistry {
    let registry = CommandRegistry::new();
    registry.register(define("todo-boom", Boom)).unwrap();
    registry
        .register(define("todo-boom-value", BoomWithValue))
        .unwrap();
    registry.register(define("todo-fine", Fine)).unwrap();
    // A confirm-gated command that panics once it is confirmed.
    registry
        .register(
            define("todo-wipe", Boom)
                .as_mutation()
                .with_destructive(true)
                .with_confirm_prompt("Wipe everything?"),
        )
        .unwrap();
    registry
}

fn server(strategy: ToolStrategy) -> McpServer {
    McpServer::new(Arc::new(registry()), "panic", "1.0.0").with_tool_strategy(strategy)
}

async fn within<T>(what: &str, future: impl Future<Output = T>) -> T {
    tokio::time::timeout(Duration::from_secs(10), future)
        .await
        .unwrap_or_else(|_| panic!("{what}: no response within the timeout (the request hung)"))
}

#[derive(Clone, Copy, Debug)]
enum Transport {
    Http,
    Stdio,
}

const TRANSPORTS: [Transport; 2] = [Transport::Http, Transport::Stdio];

/// A client of `server` over one transport. A stdio client keeps its connection, so a test can
/// check that the connection still works after a panic.
enum Client {
    Http(McpServer),
    Stdio(Stdio),
}

impl Client {
    async fn connect(server: McpServer, transport: Transport) -> Self {
        match transport {
            Transport::Http => Self::Http(server),
            Transport::Stdio => Self::Stdio(within("connect", Stdio::connect(server)).await),
        }
    }

    /// The JSON-RPC response to one request.
    async fn request(&mut self, method: &str, params: Value) -> Value {
        within(method, async {
            match self {
                Self::Http(server) => modern_post(server, method, params, &[]).await,
                Self::Stdio(stdio) => stdio.request(method, params).await,
            }
        })
        .await
    }

    /// A `tools/call` response whose result carries `structuredContent` equal to its JSON text.
    /// Returns that result and `isError`.
    async fn call(&mut self, tool: &str, arguments: Value) -> (Value, bool) {
        let response = self
            .request(
                "tools/call",
                json!({ "name": tool, "arguments": arguments }),
            )
            .await;
        let result = &response["result"];
        let text = result["content"][0]["text"]
            .as_str()
            .unwrap_or_else(|| panic!("{tool}: no tool result: {response}"));
        let parsed: Value = serde_json::from_str(text).unwrap();
        assert_eq!(
            result["structuredContent"], parsed,
            "{tool}: structuredContent must equal the text"
        );
        assert!(!response.to_string().contains(SECRET), "{response}");
        assert!(!response.to_string().contains("panicked at"), "{response}");
        (parsed, result["isError"] == true)
    }
}

/// The redacted failure a panicking handler answers with.
fn assert_handler_panic(error: &Value) {
    assert_eq!(error["code"], "COMMAND_EXECUTION_ERROR", "{error}");
    assert_eq!(error["message"], "An internal error occurred", "{error}");
    assert!(
        error["suggestion"].as_str().is_some_and(|s| !s.is_empty()),
        "{error}"
    );
}

#[tokio::test]
async fn a_command_tool_whose_handler_panics_answers_with_a_failure() {
    for transport in TRANSPORTS {
        let mut client = Client::connect(server(ToolStrategy::Individual), transport).await;
        for tool in ["todo-boom", "todo-boom-value"] {
            let (result, is_error) = client.call(tool, json!({})).await;
            assert!(
                is_error && result["success"] == false,
                "{transport:?} {result}"
            );
            assert_handler_panic(&result["error"]);
        }
        // The connection still serves.
        let (fine, is_error) = client.call("todo-fine", json!({})).await;
        assert!(!is_error, "{transport:?} {fine}");
        assert_eq!(fine["data"], json!({ "ok": true }));
    }
}

#[tokio::test]
async fn a_grouped_tool_whose_handler_panics_answers_with_a_failure() {
    for transport in TRANSPORTS {
        let mut client = Client::connect(server(ToolStrategy::Grouped), transport).await;
        let (result, is_error) = client.call("todo", json!({ "action": "boom" })).await;
        assert!(is_error, "{transport:?} {result}");
        assert_handler_panic(&result["error"]);
        let (fine, is_error) = client.call("todo", json!({ "action": "fine" })).await;
        assert!(!is_error, "{transport:?} {fine}");
    }
}

#[tokio::test]
async fn afd_call_whose_handler_panics_answers_with_a_failure() {
    for transport in TRANSPORTS {
        let mut client = Client::connect(server(ToolStrategy::Lazy), transport).await;
        let (result, is_error) = client
            .call("afd-call", json!({ "command": "todo-boom" }))
            .await;
        assert!(is_error, "{transport:?} {result}");
        assert_handler_panic(&result["error"]);
    }
}

#[tokio::test]
async fn a_confirmed_call_whose_handler_panics_answers_with_a_failure() {
    for transport in TRANSPORTS {
        let server = server(ToolStrategy::Individual).with_confirmations(ConfirmationMode::Enforce);
        let mut client = Client::connect(server, transport).await;
        let (result, is_error) = client.call("todo-wipe", json!({ "confirm": true })).await;
        assert!(is_error, "{transport:?} {result}");
        assert_handler_panic(&result["error"]);
    }
}

#[tokio::test]
async fn a_batch_item_that_panics_fails_alone() {
    let commands = json!([
        { "command": "todo-fine" },
        { "command": "todo-boom" },
        { "command": "todo-fine" },
    ]);
    for transport in TRANSPORTS {
        let mut client = Client::connect(server(ToolStrategy::Grouped), transport).await;

        // The default continues: only the panicking item failed.
        let (batch, _) = client
            .call("afd-batch", json!({ "commands": commands }))
            .await;
        assert_eq!(batch["success"], true, "{transport:?} {batch}");
        assert_eq!(
            batch["summary"],
            json!({ "total": 3, "successCount": 2, "failureCount": 1, "skippedCount": 0 })
        );
        assert_eq!(batch["results"][0]["result"]["success"], true);
        assert_handler_panic(&batch["results"][1]["result"]["error"]);
        assert_eq!(batch["results"][2]["result"]["success"], true);

        // `stopOnError` skips what had not started.
        let (stopped, _) = client
            .call(
                "afd-batch",
                json!({ "commands": commands, "options": { "stopOnError": true } }),
            )
            .await;
        assert_eq!(
            stopped["summary"]["successCount"], 1,
            "{transport:?} {stopped}"
        );
        assert_eq!(stopped["summary"]["failureCount"], 1);
        assert_eq!(stopped["summary"]["skippedCount"], 1);
        assert_handler_panic(&stopped["results"][1]["result"]["error"]);
        assert_eq!(
            stopped["results"][2]["result"]["error"]["code"],
            "COMMAND_SKIPPED"
        );

        // So does `maxFailures`, with the panic as the failure that counts.
        let (limited, _) = client
            .call(
                "afd-batch",
                json!({ "commands": commands, "options": { "maxFailures": 1 } }),
            )
            .await;
        assert_eq!(
            limited["summary"]["failureCount"], 1,
            "{transport:?} {limited}"
        );
        assert_eq!(limited["summary"]["skippedCount"], 1);

        // A parallel batch reports the panic on its own item too.
        let (parallel, _) = client
            .call(
                "afd-batch",
                json!({ "commands": commands, "options": { "parallelism": 3 } }),
            )
            .await;
        assert_eq!(
            parallel["summary"]["successCount"], 2,
            "{transport:?} {parallel}"
        );
        assert_handler_panic(&parallel["results"][1]["result"]["error"]);
    }
}

#[tokio::test]
async fn a_pipeline_step_that_panics_fails_the_pipeline() {
    for transport in TRANSPORTS {
        let mut client = Client::connect(server(ToolStrategy::Grouped), transport).await;
        let (pipe, is_error) = client
            .call(
                "afd-pipe",
                json!({ "steps": [
                    { "command": "todo-fine" },
                    { "command": "todo-boom" },
                    { "command": "todo-fine" },
                ] }),
            )
            .await;
        assert!(is_error, "{transport:?} {pipe}");
        assert_eq!(pipe["steps"][0]["status"], "success");
        assert_eq!(pipe["steps"][1]["status"], "failure");
        assert_handler_panic(&pipe["steps"][1]["error"]);
        assert_eq!(pipe["steps"][2]["status"], "skipped");
        assert_eq!(pipe["metadata"]["completedSteps"], 1);
    }
}

#[tokio::test]
async fn a_panic_in_the_servers_own_code_answers_with_a_generic_failure() {
    for transport in TRANSPORTS {
        // `group_by` runs in the server, outside the registry's guard.
        let panicking =
            server(ToolStrategy::Grouped).with_group_by(|_| panic!("group_by detail: {SECRET}"));
        let mut client = Client::connect(panicking, transport).await;

        let (result, is_error) = client.call("todo-fine", json!({})).await;
        assert!(
            is_error && result["success"] == false,
            "{transport:?} {result}"
        );
        assert_eq!(result["error"]["code"], "INTERNAL_ERROR");
        assert_eq!(
            result["error"]["message"],
            "The request could not be processed"
        );
        assert_eq!(
            result["error"]["suggestion"],
            "Retry later or contact the server operator"
        );
        assert_eq!(result["error"]["retryable"], true);

        // `tools/list` runs `group_by` too: a JSON-RPC error, not silence.
        let listed = client.request("tools/list", json!({})).await;
        assert_eq!(listed["error"]["code"], -32603, "{transport:?} {listed}");
        assert_eq!(
            listed["error"]["message"],
            "The request could not be processed"
        );
        assert!(!listed.to_string().contains(SECRET));

        // The connection is still alive.
        let (again, is_error) = client.call("afd-call", json!({ "command": "nope" })).await;
        assert!(is_error, "{transport:?} {again}");
    }
}

#[tokio::test]
async fn a_panicking_context_hook_still_answers_with_the_same_failure() {
    for transport in TRANSPORTS {
        let hooked = server(ToolStrategy::Individual)
            .with_context_hook(|_request, _context| async move { panic!("hook detail") });
        let mut client = Client::connect(hooked, transport).await;
        let (result, is_error) = client.call("todo-fine", json!({})).await;
        assert!(is_error, "{transport:?} {result}");
        assert_eq!(result["error"]["code"], "INTERNAL_ERROR");
        assert_eq!(
            result["error"]["message"],
            "The request could not be processed"
        );
    }
}

#[tokio::test]
async fn the_registry_returns_a_failure_for_a_panicking_handler_and_journals_it() {
    let registry = registry();
    let sink = Arc::new(MemoryJournalSink::new());
    registry.set_journal(JournalRecorder::new(sink.clone()).with_record_failures(true));
    let context = || CommandContext::new().with_trace_id("panic-trace");

    for name in ["todo-boom", "todo-boom-value"] {
        let result = within(name, registry.execute(name, json!({}), Some(context()))).await;
        assert!(!result.success);
        let error = result.error.expect("a failure carries an error");
        assert_eq!(error.code, "COMMAND_EXECUTION_ERROR");
        assert_eq!(error.message, "An internal error occurred");
        assert!(error.suggestion.is_some());
        assert!(error.details.is_none() && error.cause.is_none());
    }

    // The journal holds both failures, redacted the same way.
    let entries = sink.entries();
    assert_eq!(entries.len(), 2);
    for (entry, name) in entries.iter().zip(["todo-boom", "todo-boom-value"]) {
        assert_eq!(entry.command, name);
        assert_eq!(entry.trace_id.as_deref(), Some("panic-trace"));
        assert!(!entry.result.success);
        let error = entry.result.error.as_ref().unwrap();
        assert_eq!(error.code, "COMMAND_EXECUTION_ERROR");
        assert!(!serde_json::to_string(entry).unwrap().contains(SECRET));
    }

    // A later call still works and is recorded.
    let fine = registry.execute("todo-fine", json!({}), None).await;
    assert!(fine.success);
    assert_eq!(sink.entries().len(), 3);
}

#[tokio::test]
async fn a_panic_is_not_journaled_unless_failures_are() {
    let registry = registry();
    let sink = Arc::new(MemoryJournalSink::new());
    registry.set_journal(JournalRecorder::new(sink.clone()));
    let result = registry.execute("todo-boom", json!({}), None).await;
    assert!(!result.success);
    assert!(sink.entries().is_empty());
}

#[tokio::test]
async fn a_panicking_middleware_is_a_failure_too() {
    let registry = registry();
    let middleware: CommandMiddleware = Arc::new(|name, _input, _context, next| {
        Box::pin(async move {
            if name == "todo-fine" {
                panic!("middleware detail: {SECRET}");
            }
            next().await
        })
    });
    registry.add_middleware(middleware);
    let result = registry.execute("todo-fine", json!({}), None).await;
    let error: CommandError = result.error.expect("a failure carries an error");
    assert_eq!(error.code, "COMMAND_EXECUTION_ERROR");
    assert!(!format!("{error:?}").contains(SECRET));
}

//! `afd-pipe`'s up-front approval and the call's cancellation signal (#2708). While the human is
//! asked, no step runs and no deadline counts: the pipeline's deadline is measured from the run
//! after the approval. That run's deadline fires the steps' signal, a child of the call's, never
//! the call's own, and a call cancelled while its question is pending starts no step.
//!
//! A 2025 connection keeps the call open while it asks in band, so the question really is
//! pending while time passes; a 2026-07-28 call answers `input_required` and is sent again.
#![cfg(all(feature = "server", feature = "approval"))]

mod common;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use afd::server::{ConfirmationMode, McpServer};
use afd::{
    create_approval_middleware, success, ApprovalMiddlewareOptions, ApprovalPolicy, ApprovalRelay,
    CancellationSignal, CommandContext, CommandDefinition, CommandHandler, CommandRegistry,
    CommandResult,
};
use async_trait::async_trait;
use common::{legacy_call_with, modern_post_with_meta};
use serde_json::{json, Value};

const SECRET: &str = "test-approval-secret-0123456789abcdef";

/// Keeps the signal it ran with, then waits `sleep_ms` (ignoring it).
struct Sleeper {
    runs: Arc<AtomicUsize>,
    seen: Arc<Mutex<Vec<CancellationSignal>>>,
    sleep_ms: u64,
}

#[async_trait]
impl CommandHandler for Sleeper {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        self.runs.fetch_add(1, Ordering::SeqCst);
        if let Some(signal) = context.cancellation() {
            self.seen.lock().unwrap().push(signal.clone());
        }
        tokio::time::sleep(Duration::from_millis(self.sleep_ms)).await;
        success(input)
    }
}

struct Fixture {
    server: McpServer,
    runs: Arc<AtomicUsize>,
    seen: Arc<Mutex<Vec<CancellationSignal>>>,
}

impl Fixture {
    fn runs(&self) -> usize {
        self.runs.load(Ordering::SeqCst)
    }

    fn seen(&self) -> Vec<CancellationSignal> {
        self.seen.lock().unwrap().clone()
    }
}

/// A server whose one command needs approval over the form-mode relay, and whose context hook
/// gives every call `caller` as its signal. Paused tokio time drives the pipeline's deadline only:
/// the approval and its request state expire on the wall clock, which the tests never reach.
fn fixture(sleep_ms: u64, caller: CancellationSignal) -> Fixture {
    let runs = Arc::new(AtomicUsize::new(0));
    let seen = Arc::new(Mutex::new(Vec::new()));
    let registry = CommandRegistry::new();
    let mut purge = CommandDefinition::new(
        "item-purge",
        "Purge",
        vec![],
        Sleeper {
            runs: Arc::clone(&runs),
            seen: Arc::clone(&seen),
            sleep_ms,
        },
    )
    .with_approval(ApprovalPolicy::Required);
    purge.expose.mcp = true;
    registry.register(purge).unwrap();
    let options = ApprovalMiddlewareOptions::new(SECRET, registry.list())
        .with_include_token(false)
        .with_relay(ApprovalRelay::McpElicitation);
    registry.add_middleware(create_approval_middleware(options).unwrap());
    let server = McpServer::new(Arc::new(registry), "pipes", "1.0.0")
        .with_default_timeout_ms(None)
        .with_confirmations_key(ConfirmationMode::Off, vec![9u8; 32])
        .unwrap()
        .with_context_hook(move |_request, context| {
            let caller = caller.clone();
            async move { Ok(context.with_cancellation(caller)) }
        });
    Fixture { server, runs, seen }
}

/// The arguments of an `afd-pipe` of two gated steps with a `timeout_ms` deadline.
fn pipe_args(timeout_ms: u64) -> Value {
    json!({
        "steps": [{ "command": "item-purge" }, { "command": "item-purge" }],
        "options": { "timeoutMs": timeout_ms },
    })
}

/// A 2026-07-28 `afd-pipe` from a client that declares form elicitation, with `extra` (the
/// answer) added to the call's params.
async fn modern_pipe(server: &McpServer, timeout_ms: u64, extra: Value) -> Value {
    let mut params = json!({ "name": "afd-pipe", "arguments": pipe_args(timeout_ms) });
    if let Value::Object(extra) = extra {
        for (key, value) in extra {
            params[key] = value;
        }
    }
    let meta = json!({ "io.modelcontextprotocol/clientCapabilities": { "elicitation": {} } });
    modern_post_with_meta(server, "tools/call", params, meta, &[]).await
}

/// The answer that approves the question `asked` put.
fn modern_accept(asked: &Value) -> Value {
    let state = asked["result"]["requestState"]
        .as_str()
        .unwrap_or_else(|| panic!("no state: {asked}"));
    json!({
        "inputResponses": { "approval": { "action": "accept", "content": { "approve": true } } },
        "requestState": state,
    })
}

/// The pipeline result a 2025 `tools/call` response carries as JSON text.
fn legacy_result(response: &Value) -> Value {
    serde_json::from_str(
        response["result"]["content"][0]["text"]
            .as_str()
            .unwrap_or_else(|| panic!("no result: {response}")),
    )
    .unwrap()
}

fn accept() -> Value {
    json!({ "action": "accept", "content": { "approve": true } })
}

#[tokio::test(start_paused = true)]
async fn an_answer_after_the_deadline_times_out_only_the_steps_signal() {
    let caller = CancellationSignal::new();
    let f = fixture(10_000, caller.clone());
    let params = json!({ "name": "afd-pipe", "arguments": pipe_args(50) });
    let pending = caller.clone();
    let runs = Arc::clone(&f.runs);
    let (response, asked) = legacy_call_with(f.server.clone(), params, move |_| {
        let pending = pending.clone();
        let runs = Arc::clone(&runs);
        async move {
            // Ten times the deadline passes while the question is pending: nothing ran.
            tokio::time::sleep(Duration::from_millis(500)).await;
            assert_eq!(runs.load(Ordering::SeqCst), 0);
            assert!(!pending.is_cancelled(), "the call's signal is untouched");
            accept()
        }
    })
    .await;
    assert_eq!(asked.len(), 1, "{response}");
    let result = legacy_result(&response);
    // The deadline counts from the approved run, so it fires inside the first step.
    assert_eq!(
        result["steps"][0]["error"]["code"], "PIPELINE_TIMEOUT",
        "{result}"
    );
    assert_eq!(f.runs(), 1);
    assert!(
        f.seen()[0].is_cancelled(),
        "the running step's signal fired"
    );
    assert!(!caller.is_cancelled(), "the call's own signal is not fired");
}

#[tokio::test(start_paused = true)]
async fn a_call_cancelled_while_asked_starts_no_step() {
    let caller = CancellationSignal::new();
    let f = fixture(0, caller.clone());
    let params = json!({ "name": "afd-pipe", "arguments": pipe_args(10_000) });
    let cancel = caller.clone();
    let (response, asked) = legacy_call_with(f.server.clone(), params, move |_| {
        let cancel = cancel.clone();
        async move {
            cancel.cancel();
            accept()
        }
    })
    .await;
    assert_eq!(asked.len(), 1, "{response}");
    let result = legacy_result(&response);
    for step in result["steps"].as_array().expect("steps") {
        assert_eq!(step["status"], "skipped", "{result}");
        assert_eq!(step["error"]["code"], "COMMAND_CANCELLED", "{result}");
    }
    assert_eq!(f.runs(), 0);
}

#[tokio::test(start_paused = true)]
async fn a_granted_pipeline_deadline_fires_the_steps_signal_not_the_calls() {
    let caller = CancellationSignal::new();
    let f = fixture(10_000, caller.clone());
    let asked = modern_pipe(&f.server, 50, json!({})).await;
    assert_eq!(asked["result"]["resultType"], "input_required", "{asked}");
    assert_eq!(f.runs(), 0, "nothing runs while the question is pending");
    let ran = modern_pipe(&f.server, 50, modern_accept(&asked)).await;
    let result = ran["result"]["structuredContent"].clone();
    assert_eq!(
        result["steps"][0]["error"]["code"], "PIPELINE_TIMEOUT",
        "{ran}"
    );
    assert_eq!(f.runs(), 1);
    assert!(
        f.seen()[0].is_cancelled(),
        "the running step's signal fired"
    );
    assert!(!caller.is_cancelled(), "the call's own signal is not fired");
}

#[tokio::test(start_paused = true)]
async fn a_granted_pipeline_within_its_deadline_runs_on_a_signal_linked_to_the_calls() {
    let caller = CancellationSignal::new();
    let f = fixture(10, caller.clone());
    let asked = modern_pipe(&f.server, 10_000, json!({})).await;
    let ran = modern_pipe(&f.server, 10_000, modern_accept(&asked)).await;
    let result = ran["result"]["structuredContent"].clone();
    assert_eq!(result["steps"][1]["status"], "success", "{ran}");
    let seen = f.seen();
    assert_eq!(seen.len(), 2);
    assert!(seen.iter().all(|signal| !signal.is_cancelled()));
    assert!(!caller.is_cancelled());
    // The steps' signal is linked to the call's: cancelling the call reaches it. That it is a
    // child, not the call's own, is what the two deadline tests show.
    caller.cancel();
    assert!(seen.iter().all(CancellationSignal::is_cancelled));
}

//! `afd-pipe` and the call's cancellation signal (#1599): the pipeline deadline fires a child of
//! the call's signal that each step's command sees, never the call's own, and a cancelled call
//! starts no step.
#![cfg(feature = "server")]

mod common;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use afd::server::McpServer;
use afd::{
    success, CancellationSignal, CommandContext, CommandDefinition, CommandHandler,
    CommandRegistry, CommandResult,
};
use async_trait::async_trait;
use common::modern_post;
use serde_json::{json, Value};

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

/// A server whose context hook gives every call `caller` as its signal.
fn fixture(sleep_ms: u64, caller: CancellationSignal) -> Fixture {
    let runs = Arc::new(AtomicUsize::new(0));
    let seen = Arc::new(Mutex::new(Vec::new()));
    let registry = CommandRegistry::new();
    let mut scan = CommandDefinition::new(
        "item-scan",
        "Scan",
        vec![],
        Sleeper {
            runs: Arc::clone(&runs),
            seen: Arc::clone(&seen),
            sleep_ms,
        },
    );
    scan.expose.mcp = true;
    registry.register(scan).unwrap();
    let server = McpServer::new(Arc::new(registry), "pipes", "1.0.0")
        .with_default_timeout_ms(None)
        .with_context_hook(move |_request, context| {
            let caller = caller.clone();
            async move { Ok(context.with_cancellation(caller)) }
        });
    Fixture { server, runs, seen }
}

async fn pipe(server: &McpServer, options: Value) -> Value {
    let response = modern_post(
        server,
        "tools/call",
        json!({
            "name": "afd-pipe",
            "arguments": {
                "steps": [{ "command": "item-scan" }, { "command": "item-scan" }],
                "options": options,
            },
        }),
        &[],
    )
    .await;
    response["result"]["structuredContent"].clone()
}

#[tokio::test(start_paused = true)]
async fn the_pipeline_deadline_fires_the_steps_signal_not_the_calls() {
    let caller = CancellationSignal::new();
    let f = fixture(10_000, caller.clone());
    let result = pipe(&f.server, json!({ "timeoutMs": 50 })).await;
    assert_eq!(
        result["steps"][0]["error"]["code"], "PIPELINE_TIMEOUT",
        "{result}"
    );
    assert_eq!(f.runs.load(Ordering::SeqCst), 1);
    let seen = f.seen.lock().unwrap();
    assert!(seen[0].is_cancelled(), "the running step's signal fired");
    assert!(!caller.is_cancelled(), "the call's own signal is not fired");
}

#[tokio::test]
async fn a_cancelled_call_starts_no_step_without_a_deadline() {
    let caller = CancellationSignal::new();
    caller.cancel();
    let f = fixture(0, caller);
    let result = pipe(&f.server, json!({ "continueOnFailure": true })).await;
    for step in result["steps"].as_array().expect("steps") {
        assert_eq!(step["status"], "skipped", "{result}");
        assert_eq!(step["error"]["code"], "COMMAND_CANCELLED", "{result}");
    }
    assert_eq!(f.runs.load(Ordering::SeqCst), 0);
}

#[tokio::test(start_paused = true)]
async fn a_pipeline_within_its_deadline_fires_nothing() {
    let caller = CancellationSignal::new();
    let f = fixture(10, caller.clone());
    let result = pipe(&f.server, json!({ "timeoutMs": 10_000 })).await;
    assert_eq!(result["steps"][1]["status"], "success", "{result}");
    assert!(f
        .seen
        .lock()
        .unwrap()
        .iter()
        .all(|signal| !signal.is_cancelled()));
    assert!(!caller.is_cancelled());
}

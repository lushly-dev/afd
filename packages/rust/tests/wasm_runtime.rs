//! Browser/Node WebAssembly runtime verification for `afd` (#1765).
//!
//! Runs on `wasm32-unknown-unknown` under `wasm-bindgen-test` (Node by default) to prove that
//! monotonic durations (`Instant::now`) and wall-clock timestamps (`SystemTime::now`) work without
//! trapping on `wasm32-unknown-unknown` (selected by target via `web-time`) and that approval
//! nonces work via `getrandom/wasm_js` when the `approval` feature is enabled. It also pins the
//! dispatch id there: `None` without the `wasm` feature, which has no random source, and a
//! well-formed id from `crypto.getRandomValues` with it.

#![cfg(all(target_family = "wasm", target_os = "unknown"))]

use std::sync::Arc;

use afd::{
    success, BatchCommand, BatchRequest, CommandContext, CommandDefinition, CommandHandler,
    CommandParameter, CommandRegistry, CommandResult,
};
use async_trait::async_trait;
use serde_json::{json, Value};
use wasm_bindgen_test::wasm_bindgen_test;

struct EchoHandler;

#[async_trait]
impl CommandHandler for EchoHandler {
    async fn execute(&self, input: Value, _context: CommandContext) -> CommandResult<Value> {
        success(json!({ "echo": input }))
    }
}

/// Reports the call's dispatch id as its data.
struct DispatchIdHandler;

#[async_trait]
impl CommandHandler for DispatchIdHandler {
    async fn execute(&self, _input: Value, context: CommandContext) -> CommandResult<Value> {
        success(json!({ "dispatchId": context.dispatch_id() }))
    }
}

fn echo_command() -> CommandDefinition {
    CommandDefinition::new(
        "wasm-echo",
        "Echo input for wasm runtime tests",
        vec![CommandParameter::required_string("text", "Text to echo")],
        EchoHandler,
    )
}

#[wasm_bindgen_test]
async fn execute_and_batch_work_on_wasm32() {
    let registry = Arc::new(CommandRegistry::new());
    registry
        .register(echo_command())
        .expect("register echo command");

    // Exercises `crate::time::Instant::now()` for execution timing.
    let single = registry
        .execute("wasm-echo", json!({ "text": "hello" }), None)
        .await;
    assert!(single.success, "expected single execute to succeed");
    assert_eq!(single.data, Some(json!({ "echo": { "text": "hello" } })));

    // Exercises batch execution timing on wasm32.
    let batch = registry
        .execute_batch(BatchRequest::new(vec![BatchCommand::new(
            "wasm-echo",
            json!({ "text": "batch-item" }),
        )]))
        .await;
    assert!(batch.success, "expected batch to succeed");
    assert_eq!(batch.results.len(), 1);
}

#[cfg(feature = "approval")]
#[wasm_bindgen_test]
async fn approval_middleware_uses_wasm_random_and_wall_clock() {
    use afd::{
        create_approval_middleware, ApprovalMiddlewareOptions, ApprovalPolicy, CommandInterface,
        ExposeOptions,
    };

    let registry = CommandRegistry::new();
    registry.add_middleware(
        create_approval_middleware(
            ApprovalMiddlewareOptions::from_secret("wasm-test-secret-0123456789abcdef")
                .with_include_token(true),
        )
        .expect("create approval middleware"),
    );
    registry
        .register(
            echo_command()
                .with_expose(ExposeOptions {
                    cli: true,
                    ..ExposeOptions::new()
                })
                .with_approval(ApprovalPolicy::Required),
        )
        .expect("register gated command");

    // Exercises `crate::time::SystemTime::now()` for token expiry and `getrandom/wasm_js`
    // for the approval token nonce.
    let ctx = CommandContext::new().with_interface(CommandInterface::Cli);
    let held = registry
        .execute("wasm-echo", json!({ "text": "gated" }), Some(ctx))
        .await;
    assert!(!held.success);
    let err = held.error.expect("expected APPROVAL_REQUIRED error");
    assert_eq!(err.code, afd::error_codes::APPROVAL_REQUIRED);
    let token = err
        .details
        .as_ref()
        .and_then(|d| d.get("approvalToken"))
        .and_then(Value::as_str)
        .expect("CLI hold should include an approval token");
    assert!(!token.is_empty());
}

#[wasm_bindgen_test]
async fn dispatch_id_follows_the_wasm_feature() {
    let registry = CommandRegistry::new();
    registry
        .register(CommandDefinition::new(
            "wasm-dispatch",
            "Report the dispatch id",
            vec![],
            DispatchIdHandler,
        ))
        .expect("register dispatch id command");
    let result = registry.execute("wasm-dispatch", json!({}), None).await;
    assert!(
        result.success,
        "expected the call to succeed: {:?}",
        result.error
    );
    let id = result.data.expect("data")["dispatchId"].clone();
    if cfg!(feature = "wasm") {
        // `spec/dispatch.md`, "The dispatch id": 21 base64url characters, then one of `AQgw`.
        let id = id.as_str().expect("a dispatch id with the wasm feature");
        let base64url = |c: char| c.is_ascii_alphanumeric() || c == '-' || c == '_';
        assert_eq!(id.len(), 22, "{id}");
        assert!(id.chars().take(21).all(base64url), "{id}");
        assert!(id.ends_with(['A', 'Q', 'g', 'w']), "{id}");
    } else {
        assert_eq!(id, Value::Null, "no random source without the wasm feature");
    }
}

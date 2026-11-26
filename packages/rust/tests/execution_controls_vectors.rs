//! Specification-authored execution-controls vectors (`spec/vectors/execution-controls.json`;
//! `spec/execution-controls.md`, #1737, #2130).
//!
//! Runs every vector case and verifies that `gaps.rust` is absent.

#[cfg(feature = "server")]
mod common;

use afd::{
    success, BatchCommand, BatchOptions, BatchRequest, CancellationSignal, CommandContext,
    CommandDefinition, CommandHandler, CommandParameter, CommandRegistry, CommandResult,
    JsonSchema, JsonSchemaType, DEFAULT_COMMAND_TIMEOUT_MS, DEFAULT_MAX_BATCH_PARALLELISM,
    DEFAULT_MAX_BATCH_SIZE, DEFAULT_MAX_VALIDATION_ISSUES,
};
use async_trait::async_trait;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
#[cfg(feature = "native")]
use std::sync::Mutex;

fn load_vectors() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../spec/vectors/execution-controls.json");
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("cannot read {}: {error}", path.display()));
    serde_json::from_str(&text)
        .unwrap_or_else(|error| panic!("{} is not valid JSON: {error}", path.display()))
}

fn find_case<'a>(vectors: &'a Value, id: &str) -> &'a Value {
    vectors["cases"]
        .as_array()
        .expect("cases is an array")
        .iter()
        .find(|entry| entry["id"] == id)
        .unwrap_or_else(|| panic!("missing case `{id}`"))
}

struct CountingHandler {
    calls: Arc<AtomicUsize>,
}

#[async_trait]
impl CommandHandler for CountingHandler {
    async fn execute(&self, input: Value, _context: CommandContext) -> CommandResult<Value> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        success(input)
    }
}

#[test]
fn defaults_and_no_remaining_rust_gaps() {
    let vectors = load_vectors();
    assert_eq!(
        vectors["defaults"],
        json!({
            "defaultTimeoutMs": DEFAULT_COMMAND_TIMEOUT_MS,
            "maxBatchSize": DEFAULT_MAX_BATCH_SIZE,
            "maxBatchParallelism": DEFAULT_MAX_BATCH_PARALLELISM,
            "maxValidationIssues": DEFAULT_MAX_VALIDATION_ISSUES,
        })
    );
    assert!(
        vectors["gaps"].get("rust").is_none(),
        "gaps.rust should be empty/absent"
    );
    let executed = [
        "deadline",
        "defaultDeadline",
        "singleCancellation",
        "batchCancellation",
        "batchLimits",
        "validationIssueCap",
        "retryMutation",
    ];
    for case in vectors["cases"].as_array().expect("cases is an array") {
        let control = case["control"].as_str().expect("case control is a string");
        assert!(
            executed.contains(&control),
            "control `{control}` must be executed by Rust"
        );
    }
}

#[cfg(feature = "native")]
#[tokio::test(start_paused = true)]
async fn per_call_deadline_times_out_and_cancels_signal() {
    use std::time::Duration;

    struct SlowHandler {
        delay_ms: u64,
        observed: Arc<Mutex<Option<CancellationSignal>>>,
    }

    #[async_trait]
    impl CommandHandler for SlowHandler {
        async fn execute(&self, _input: Value, context: CommandContext) -> CommandResult<Value> {
            *self.observed.lock().unwrap() = context.cancellation().cloned();
            tokio::time::sleep(Duration::from_millis(self.delay_ms)).await;
            success(json!({ "done": true }))
        }
    }

    let vectors = load_vectors();
    let case = find_case(&vectors, "per-call-deadline-timeout");
    let command_name = case["call"]["command"].as_str().unwrap();
    let timeout_ms = case["call"]["timeoutMs"].as_u64().unwrap();
    let delay_ms = case["call"]["handler"]["delayMs"].as_u64().unwrap();

    let observed = Arc::new(Mutex::new(None));
    let registry = CommandRegistry::new();
    registry
        .register(CommandDefinition::new(
            command_name,
            "Slow handler for deadline vector",
            vec![],
            SlowHandler {
                delay_ms,
                observed: Arc::clone(&observed),
            },
        ))
        .expect("register slow handler");

    let result = registry
        .execute(
            command_name,
            json!({}),
            Some(CommandContext::new().with_timeout(timeout_ms)),
        )
        .await;

    assert_eq!(result.success, case["expect"]["success"].as_bool().unwrap());
    let err = result.error.expect("expected TIMEOUT error");
    assert_eq!(err.code, case["expect"]["code"].as_str().unwrap());
    assert_eq!(err.retryable, case["expect"]["retryable"].as_bool());
    let details = err.details.expect("TIMEOUT details");
    assert_eq!(details.get("command"), Some(&json!(command_name)));
    assert_eq!(details.get("timeoutMs"), Some(&json!(timeout_ms)));
    let signal = observed
        .lock()
        .unwrap()
        .clone()
        .expect("handler observed deadline signal");
    assert_eq!(
        signal.is_cancelled(),
        case["expect"]["signalAborted"].as_bool().unwrap()
    );
}

#[cfg(feature = "native")]
#[tokio::test(start_paused = true)]
async fn server_default_deadline_times_out_and_cancels_signal() {
    use std::time::Duration;

    struct SlowHandler {
        delay_ms: u64,
        observed: Arc<Mutex<Option<CancellationSignal>>>,
    }

    #[async_trait]
    impl CommandHandler for SlowHandler {
        async fn execute(&self, _input: Value, context: CommandContext) -> CommandResult<Value> {
            *self.observed.lock().unwrap() = context.cancellation().cloned();
            tokio::time::sleep(Duration::from_millis(self.delay_ms)).await;
            success(json!({ "done": true }))
        }
    }

    let vectors = load_vectors();
    let case = find_case(&vectors, "server-default-deadline");
    let default_timeout_ms = case["server"]["defaultTimeoutMs"].as_u64().unwrap();
    let command_name = case["call"]["command"].as_str().unwrap();
    let delay_ms = case["call"]["handler"]["delayMs"].as_u64().unwrap();

    let observed = Arc::new(Mutex::new(None));
    let registry = CommandRegistry::new();
    registry.set_default_timeout_ms(Some(default_timeout_ms));
    registry
        .register(CommandDefinition::new(
            command_name,
            "Slow handler for default deadline vector",
            vec![],
            SlowHandler {
                delay_ms,
                observed: Arc::clone(&observed),
            },
        ))
        .expect("register slow handler");

    let result = registry.execute(command_name, json!({}), None).await;
    assert_eq!(result.success, case["expect"]["success"].as_bool().unwrap());
    let err = result.error.expect("expected TIMEOUT error");
    assert_eq!(err.code, case["expect"]["code"].as_str().unwrap());
    assert_eq!(err.retryable, case["expect"]["retryable"].as_bool());
    let details = err.details.expect("TIMEOUT details");
    assert_eq!(details.get("command"), Some(&json!(command_name)));
    assert_eq!(details.get("timeoutMs"), Some(&json!(default_timeout_ms)));
    let signal = observed
        .lock()
        .unwrap()
        .clone()
        .expect("handler observed default deadline signal");
    assert_eq!(
        signal.is_cancelled(),
        case["expect"]["signalAborted"].as_bool().unwrap()
    );
}

#[tokio::test]
async fn pre_cancelled_single_command_skips_middleware_and_handler() {
    let vectors = load_vectors();
    let case = find_case(&vectors, "pre-cancelled-single-command");
    let command_name = case["call"]["command"].as_str().unwrap();

    let calls = Arc::new(AtomicUsize::new(0));
    let mw_calls = Arc::new(AtomicUsize::new(0));
    let registry = CommandRegistry::new();
    registry
        .register(CommandDefinition::new(
            command_name,
            "Command for cancellation vector",
            vec![],
            CountingHandler {
                calls: Arc::clone(&calls),
            },
        ))
        .expect("register handler");
    let mw_counter = Arc::clone(&mw_calls);
    registry.add_middleware(Arc::new(move |_name, _input, ctx, next| {
        mw_counter.fetch_add(1, Ordering::SeqCst);
        Box::pin(async move { next(ctx).await })
    }));

    let signal = CancellationSignal::new();
    signal.cancel();
    let result = registry
        .execute(
            command_name,
            json!({}),
            Some(CommandContext::new().with_cancellation(signal)),
        )
        .await;

    assert_eq!(result.success, case["expect"]["success"].as_bool().unwrap());
    let err = result.error.expect("expected COMMAND_CANCELLED error");
    assert_eq!(err.code, case["expect"]["code"].as_str().unwrap());
    assert_eq!(err.retryable, case["expect"]["retryable"].as_bool());
    assert_eq!(
        calls.load(Ordering::SeqCst) > 0,
        case["expect"]["handlerRan"].as_bool().unwrap()
    );
    assert_eq!(mw_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn pre_cancelled_batch_starts_no_commands() {
    let vectors = load_vectors();
    let case = find_case(&vectors, "pre-cancelled-batch");
    let calls = Arc::new(AtomicUsize::new(0));
    let registry = CommandRegistry::new();
    registry
        .register(CommandDefinition::new(
            "work-run",
            "Command for batch cancellation vector",
            vec![],
            CountingHandler {
                calls: Arc::clone(&calls),
            },
        ))
        .expect("register handler");

    let request: BatchRequest<Value> =
        serde_json::from_value(case["request"].clone()).expect("valid batch request");
    let signal = CancellationSignal::new();
    signal.cancel();

    let result = registry
        .execute_batch_with_context(request, CommandContext::new().with_cancellation(signal))
        .await;

    assert_eq!(result.success, case["expect"]["success"].as_bool().unwrap());
    assert_eq!(
        calls.load(Ordering::SeqCst),
        case["expect"]["calls"].as_u64().unwrap() as usize
    );
    assert_eq!(result.results.len(), 2);
    for item in &result.results {
        assert!(!item.result.success);
        let err = item.result.error.as_ref().expect("item error");
        assert_eq!(err.code, case["expect"]["itemCode"].as_str().unwrap());
        assert_eq!(
            item.duration_ms,
            case["expect"]["durationMs"].as_f64().unwrap()
        );
    }
}

#[tokio::test]
async fn batch_size_and_parallelism_limits_vectors() {
    let vectors = load_vectors();
    for case_id in [
        "batch-at-max-size-allowed",
        "batch-over-max-size-refused",
        "batch-at-max-parallelism-allowed",
        "batch-over-max-parallelism-refused",
    ] {
        let case = find_case(&vectors, case_id);
        let max_size = case["limits"]["maxBatchSize"].as_u64().unwrap() as usize;
        let max_parallelism = case["limits"]["maxBatchParallelism"].as_u64().unwrap() as usize;
        let count = case["commandCount"].as_u64().unwrap() as usize;
        let parallelism = case["parallelism"].as_u64().unwrap() as usize;

        let calls = Arc::new(AtomicUsize::new(0));
        let registry = CommandRegistry::new();
        registry.set_max_batch_size(max_size).unwrap();
        registry.set_max_batch_parallelism(max_parallelism).unwrap();
        registry
            .register(CommandDefinition::new(
                "work-run",
                "Batch limit vector command",
                vec![],
                CountingHandler {
                    calls: Arc::clone(&calls),
                },
            ))
            .unwrap();

        let commands = (0..count)
            .map(|i| BatchCommand::new("work-run", json!({ "index": i })))
            .collect();
        let request = BatchRequest::new(commands)
            .with_options(BatchOptions::new().with_parallelism(parallelism));
        let result = registry.execute_batch(request).await;

        let expect = &case["expect"];
        assert_eq!(
            result.success,
            expect["success"].as_bool().unwrap(),
            "{case_id}"
        );
        if result.success {
            assert_eq!(
                result.summary.total,
                expect["total"].as_u64().unwrap() as usize,
                "{case_id}"
            );
            assert_eq!(
                result.summary.success_count,
                expect["successCount"].as_u64().unwrap() as usize,
                "{case_id}"
            );
        } else {
            assert_eq!(
                calls.load(Ordering::SeqCst),
                expect["calls"].as_u64().unwrap() as usize,
                "{case_id}"
            );
            assert_eq!(
                result.results.len(),
                expect["resultsLength"].as_u64().unwrap() as usize,
                "{case_id}"
            );
            let err = result.error.expect("expected INVALID_BATCH_REQUEST");
            assert_eq!(err.code, expect["code"].as_str().unwrap(), "{case_id}");
            assert_eq!(err.retryable, expect["retryable"].as_bool(), "{case_id}");
            let suggestion = err.suggestion.expect("suggestion");
            assert!(
                suggestion.contains(&max_size.to_string()),
                "{case_id}: {suggestion}"
            );
            assert!(
                suggestion.contains(&max_parallelism.to_string()),
                "{case_id}: {suggestion}"
            );
        }
    }
}

#[tokio::test]
async fn validation_issue_cap_vectors() {
    let vectors = load_vectors();
    for case_id in [
        "validation-issues-at-cap-not-truncated",
        "validation-issues-over-cap-truncated",
    ] {
        let case = find_case(&vectors, case_id);
        let limit = case["limit"].as_u64().unwrap() as usize;
        let count = case["invalidItemCount"].as_u64().unwrap() as usize;
        let expect = &case["expect"];

        // Test both whole-schema validation and legacy CommandParameter validation.
        let registry = CommandRegistry::new();
        registry.set_max_validation_issues(limit).unwrap();
        let calls = Arc::new(AtomicUsize::new(0));
        registry
            .register_with_schema(
                CommandDefinition::new(
                    "validate-schema",
                    "Whole-schema validation cap test",
                    vec![],
                    CountingHandler {
                        calls: Arc::clone(&calls),
                    },
                ),
                json!({
                    "type": "object",
                    "properties": { "values": { "type": "array", "items": { "type": "string" } } },
                    "required": ["values"]
                }),
            )
            .unwrap();
        let mut legacy_param = CommandParameter::required_string("values", "Array of strings");
        legacy_param.param_type = JsonSchemaType::Array;
        legacy_param.schema = Some(JsonSchema {
            schema_type: Some(JsonSchemaType::Array),
            items: Some(Box::new(JsonSchema {
                schema_type: Some(JsonSchemaType::String),
                ..JsonSchema::default()
            })),
            ..JsonSchema::default()
        });
        registry
            .register(CommandDefinition::new(
                "validate-legacy",
                "Legacy parameter validation cap test",
                vec![legacy_param],
                CountingHandler {
                    calls: Arc::clone(&calls),
                },
            ))
            .unwrap();

        let payload = json!({ "values": vec![0; count] });
        for cmd in ["validate-schema", "validate-legacy"] {
            let result = registry.execute(cmd, payload.clone(), None).await;
            assert_eq!(
                result.success,
                expect["success"].as_bool().unwrap(),
                "{case_id} ({cmd})"
            );
            let err = result.error.expect("VALIDATION_ERROR");
            assert_eq!(
                err.code,
                expect["code"].as_str().unwrap(),
                "{case_id} ({cmd})"
            );
            assert_eq!(
                err.retryable.unwrap_or(false),
                expect["retryable"].as_bool().unwrap(),
                "{case_id} ({cmd})"
            );
            let details = err.details.expect("details");
            let reported = details["errors"].as_array().unwrap().len();
            assert_eq!(
                reported,
                expect["reportedErrors"].as_u64().unwrap() as usize,
                "{case_id} ({cmd})"
            );
            if expect["truncated"].as_bool().unwrap() {
                assert_eq!(
                    details.get("truncated"),
                    Some(&json!(true)),
                    "{case_id} ({cmd})"
                );
                assert_eq!(
                    details.get("limit"),
                    Some(&json!(expect["detailsLimit"])),
                    "{case_id} ({cmd})"
                );
                assert_eq!(
                    details.get("totalErrors"),
                    Some(&json!(count)),
                    "{case_id} ({cmd})"
                );
                let suggestion = err.suggestion.expect("suggestion");
                assert!(
                    suggestion.contains(&format!("Showing first {limit} validation issues")),
                    "{case_id} ({cmd}): {suggestion}"
                );
            } else {
                assert!(!details.contains_key("truncated"), "{case_id} ({cmd})");
                assert!(!details.contains_key("limit"), "{case_id} ({cmd})");
                assert!(!details.contains_key("totalErrors"), "{case_id} ({cmd})");
            }
        }
    }
}

#[cfg(feature = "server")]
#[tokio::test(start_paused = true)]
async fn mcp_server_enforces_default_deadline_and_batch_limits_before_confirmations() {
    use afd::server::{ConfirmationMode, McpServer};
    use afd::ExposeOptions;
    use common::modern_post;
    use std::time::Duration;

    struct SlowHandler {
        delay_ms: u64,
        observed: Arc<Mutex<Option<CancellationSignal>>>,
    }

    #[async_trait]
    impl CommandHandler for SlowHandler {
        async fn execute(&self, _input: Value, context: CommandContext) -> CommandResult<Value> {
            *self.observed.lock().unwrap() = context.cancellation().cloned();
            tokio::time::sleep(Duration::from_millis(self.delay_ms)).await;
            success(json!({ "done": true }))
        }
    }

    let observed = Arc::new(Mutex::new(None));
    let calls = Arc::new(AtomicUsize::new(0));
    let registry = Arc::new(CommandRegistry::new());
    registry.set_max_batch_size(2).unwrap();
    registry.set_max_batch_parallelism(2).unwrap();
    registry
        .register(
            CommandDefinition::new(
                "slow-work",
                "Slow handler",
                vec![],
                SlowHandler {
                    delay_ms: 500,
                    observed: Arc::clone(&observed),
                },
            )
            .with_expose(ExposeOptions::new().with_mcp(true)),
        )
        .unwrap();
    registry
        .register(
            CommandDefinition::new(
                "gated-work",
                "Confirmation-gated handler",
                vec![],
                CountingHandler {
                    calls: Arc::clone(&calls),
                },
            )
            .with_expose(ExposeOptions::new().with_mcp(true))
            .with_confirm_prompt("Confirm gated work?"),
        )
        .unwrap();

    // McpServer defaults to 30_000ms and lets callers override via with_default_timeout_ms.
    let server = McpServer::new(Arc::clone(&registry), "exec-controls-test", "1.0.0")
        .with_confirmations(ConfirmationMode::Enforce)
        .with_default_timeout_ms(Some(40));

    let timeout_resp = modern_post(
        &server,
        "tools/call",
        json!({ "name": "afd-call", "arguments": { "command": "slow-work", "input": {} } }),
        &[],
    )
    .await;
    let timeout_text = timeout_resp["result"]["content"][0]["text"]
        .as_str()
        .expect("JSON text");
    let timeout_result: Value = serde_json::from_str(timeout_text).expect("CommandResult");
    assert_eq!(timeout_result["success"], false);
    assert_eq!(timeout_result["error"]["code"], "TIMEOUT");
    assert_eq!(timeout_result["error"]["retryable"], true);
    assert_eq!(timeout_result["error"]["details"]["timeoutMs"], 40);
    assert!(observed
        .lock()
        .unwrap()
        .as_ref()
        .expect("deadline signal")
        .is_cancelled());

    // Over-limit afd-batch is refused with INVALID_BATCH_REQUEST before confirmation elicitation.
    let batch_resp = modern_post(
        &server,
        "tools/call",
        json!({
            "name": "afd-batch",
            "arguments": {
                "commands": [
                    { "command": "gated-work", "input": {} },
                    { "command": "gated-work", "input": {} },
                    { "command": "gated-work", "input": {} }
                ]
            }
        }),
        &[],
    )
    .await;
    let batch_text = batch_resp["result"]["content"][0]["text"]
        .as_str()
        .expect("JSON text");
    let batch_result: Value = serde_json::from_str(batch_text).expect("BatchResult");
    assert_eq!(batch_result["success"], false);
    assert_eq!(batch_result["error"]["code"], "INVALID_BATCH_REQUEST");
    assert_eq!(batch_result["error"]["retryable"], false);
    assert_eq!(calls.load(Ordering::SeqCst), 0);
}

#[cfg(feature = "server")]
#[tokio::test(start_paused = true)]
async fn mcp_server_default_timeout_preserves_journal_digest_and_can_disable_registry_default() {
    use afd::server::McpServer;
    use afd::{ExposeOptions, JournalRange, JournalRecorder, JournalSink, MemoryJournalSink};
    use common::modern_post;
    use std::time::Duration;

    struct QuickSlowHandler {
        delay_ms: u64,
    }

    #[async_trait]
    impl CommandHandler for QuickSlowHandler {
        async fn execute(&self, _input: Value, _context: CommandContext) -> CommandResult<Value> {
            if self.delay_ms > 0 {
                tokio::time::sleep(Duration::from_millis(self.delay_ms)).await;
            }
            success(json!({ "ok": true }))
        }
    }

    // 1. Inline MCP calls with default_timeout_ms do NOT pollute JournalContextDigest with "timeoutMs".
    let sink = Arc::new(MemoryJournalSink::new());
    let registry = Arc::new(CommandRegistry::new());
    registry.set_journal(JournalRecorder::new(
        Arc::clone(&sink) as Arc<dyn JournalSink>
    ));
    registry
        .register(
            CommandDefinition::new(
                "ping-now",
                "Instant command",
                vec![],
                QuickSlowHandler { delay_ms: 0 },
            )
            .with_expose(ExposeOptions::new().with_mcp(true)),
        )
        .unwrap();
    let server = McpServer::new(Arc::clone(&registry), "digest-test", "1.0.0")
        .with_context_hook(|_req, ctx| async move { Ok(ctx.with_trace_id("fixed-trace")) });
    let server_no_timeout = McpServer::new(Arc::clone(&registry), "digest-test", "1.0.0")
        .with_default_timeout_ms(None)
        .with_context_hook(|_req, ctx| async move { Ok(ctx.with_trace_id("fixed-trace")) });
    let server_explicit_timeout = McpServer::new(Arc::clone(&registry), "digest-test", "1.0.0")
        .with_context_hook(|_req, ctx| async move {
            Ok(ctx
                .with_trace_id("fixed-trace")
                .with_timeout(DEFAULT_COMMAND_TIMEOUT_MS))
        });
    for srv in [&server, &server_no_timeout, &server_explicit_timeout] {
        let resp = modern_post(
            srv,
            "tools/call",
            json!({ "name": "afd-call", "arguments": { "command": "ping-now", "input": {} } }),
            &[],
        )
        .await;
        let body: Value =
            serde_json::from_str(resp["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(body["success"], true);
    }
    let entries = sink.read(JournalRange::default()).await.unwrap();
    assert_eq!(entries.len(), 3);
    assert_eq!(
        entries[0].context_digest.hash, entries[1].context_digest.hash,
        "server default_timeout_ms must produce the exact same journal context digest as disabled default"
    );
    assert_ne!(
        entries[0].context_digest.hash, entries[2].context_digest.hash,
        "explicit timeoutMs changes the digest hash, proving default_timeout_ms stayed out"
    );

    // 2. McpServer::with_default_timeout_ms(None) overrides a registry-level default timeout.
    let reg2 = Arc::new(CommandRegistry::new());
    reg2.set_default_timeout_ms(Some(20));
    reg2.register(
        CommandDefinition::new(
            "slow-override",
            "Slow command",
            vec![],
            QuickSlowHandler { delay_ms: 60 },
        )
        .with_expose(ExposeOptions::new().with_mcp(true)),
    )
    .unwrap();
    let disabled_server = McpServer::new(Arc::clone(&reg2), "disabled-timeout", "1.0.0")
        .with_default_timeout_ms(None);
    let resp2 = modern_post(
        &disabled_server,
        "tools/call",
        json!({ "name": "afd-call", "arguments": { "command": "slow-override", "input": {} } }),
        &[],
    )
    .await;
    let body2: Value =
        serde_json::from_str(resp2["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(
        body2["success"], true,
        "with_default_timeout_ms(None) should disable the registry default: {body2}"
    );
}

#[cfg(feature = "native")]
#[tokio::test(start_paused = true)]
async fn batch_deadline_signals_handler_cancellation() {
    use std::time::Duration;

    struct WatchingHandler {
        observed: Arc<Mutex<Option<CancellationSignal>>>,
    }

    #[async_trait]
    impl CommandHandler for WatchingHandler {
        async fn execute(&self, _input: Value, context: CommandContext) -> CommandResult<Value> {
            *self.observed.lock().unwrap() = context.cancellation().cloned();
            tokio::time::sleep(Duration::from_millis(500)).await;
            success(json!({ "done": true }))
        }
    }

    let observed = Arc::new(Mutex::new(None));
    let registry = CommandRegistry::new();
    registry
        .register(CommandDefinition::new(
            "slow-batch-item",
            "Slow batch item",
            vec![],
            WatchingHandler {
                observed: Arc::clone(&observed),
            },
        ))
        .unwrap();

    let request = BatchRequest::new(vec![BatchCommand::new("slow-batch-item", json!({}))])
        .with_options(BatchOptions::new().with_timeout(25.0));
    let result = registry.execute_batch(request).await;
    assert!(result.success);
    assert_eq!(
        result.results[0].result.error.as_ref().unwrap().code,
        "BATCH_TIMEOUT"
    );
    assert!(observed
        .lock()
        .unwrap()
        .as_ref()
        .expect("batch item observed deadline cancellation signal")
        .is_cancelled());
}

/// Fails its first run with the vector's code, then succeeds, counting its runs.
struct FailFirstHandler {
    code: String,
    runs: Arc<AtomicUsize>,
}

#[async_trait]
impl CommandHandler for FailFirstHandler {
    async fn execute(&self, _input: Value, _context: CommandContext) -> CommandResult<Value> {
        if self.runs.fetch_add(1, Ordering::SeqCst) == 0 {
            return afd::failure(afd::CommandError::new(&self.code, "Downstream timed out"));
        }
        success(json!({ "runs": self.runs.load(Ordering::SeqCst) }))
    }
}

/// The retry middleware repeats a mutation only with `retry_mutations` (#2673).
#[tokio::test]
async fn retry_mutation_vectors() {
    let vectors = load_vectors();
    let cases: Vec<&Value> = vectors["cases"]
        .as_array()
        .expect("cases is an array")
        .iter()
        .filter(|case| case["control"] == "retryMutation")
        .collect();
    let ids: Vec<&str> = cases
        .iter()
        .map(|case| case["id"].as_str().unwrap())
        .collect();
    assert_eq!(
        ids,
        [
            "retry-read-after-timeout",
            "retry-mutation-not-repeated",
            "retry-mutation-with-option",
        ]
    );
    for case in cases {
        let id = case["id"].as_str().unwrap();
        let name = case["command"]["name"].as_str().unwrap();
        let runs = Arc::new(AtomicUsize::new(0));
        let mut command = CommandDefinition::new(
            name,
            "Fails once, then succeeds",
            vec![],
            FailFirstHandler {
                code: case["handler"]["failFirst"]["code"]
                    .as_str()
                    .unwrap()
                    .to_string(),
                runs: Arc::clone(&runs),
            },
        );
        if case["command"]["mutation"].as_bool().unwrap() {
            command = command.as_mutation();
        }
        let registry = CommandRegistry::new();
        registry.register(command).expect("register handler");
        let retry = &case["retry"];
        let sleep: afd::middleware::SleepFn = Arc::new(|_| Box::pin(async {}));
        registry.add_middleware(
            afd::middleware::create_retry_middleware(afd::middleware::RetryOptions {
                max_retries: u32::try_from(retry["maxRetries"].as_u64().unwrap()).unwrap(),
                retry_delay_ms: retry["retryDelayMs"].as_u64().unwrap(),
                jitter: retry["jitter"].as_bool().unwrap(),
                retry_mutations: retry["retryMutations"].as_bool().unwrap_or(false),
                sleep: Some(sleep),
                ..Default::default()
            })
            .expect("retry middleware"),
        );

        let result = registry.execute(name, json!({}), None).await;
        let expected = &case["expect"];
        assert_eq!(
            runs.load(Ordering::SeqCst) as u64,
            expected["handlerRuns"].as_u64().unwrap(),
            "{id}: handler runs"
        );
        assert_eq!(
            result.success,
            expected["success"].as_bool().unwrap(),
            "{id}"
        );
        if let Some(code) = expected["code"].as_str() {
            assert_eq!(result.error.expect("an error").code, code, "{id}");
        }
    }
}

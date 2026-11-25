use super::*;
use crate::batch::{BatchCommand, BatchOptions};
use crate::result::success;
use std::sync::atomic::{AtomicUsize, Ordering};

struct TestHandler;

/// Panics when the input has `"panic": true`; otherwise echoes the input.
struct PanickingHandler;

#[async_trait]
impl CommandHandler for PanickingHandler {
    async fn execute(
        &self,
        input: serde_json::Value,
        _context: CommandContext,
    ) -> CommandResult<serde_json::Value> {
        if input.get("panic") == Some(&serde_json::Value::Bool(true)) {
            panic!("handler bug");
        }
        success(input)
    }
}

fn work_registry() -> (CommandRegistry, Arc<AtomicUsize>) {
    let peak = Arc::new(AtomicUsize::new(0));
    let registry = CommandRegistry::new();
    registry
        .register(CommandDefinition::new(
            "work-run",
            "Runs controlled work",
            vec![
                CommandParameter {
                    required: false,
                    ..CommandParameter::required_boolean("fail", "Fail")
                },
                CommandParameter {
                    required: false,
                    ..CommandParameter::required_number("index", "Index")
                },
                CommandParameter {
                    required: false,
                    ..CommandParameter::required_boolean("slow", "Slow")
                },
            ],
            ControlledHandler {
                active: Arc::new(AtomicUsize::new(0)),
                peak: Arc::clone(&peak),
            },
        ))
        .unwrap();
    (registry, peak)
}

struct ControlledHandler {
    active: Arc<AtomicUsize>,
    peak: Arc<AtomicUsize>,
}

#[async_trait]
impl CommandHandler for ControlledHandler {
    async fn execute(
        &self,
        input: serde_json::Value,
        _context: CommandContext,
    ) -> CommandResult<serde_json::Value> {
        let active = self.active.fetch_add(1, Ordering::SeqCst) + 1;
        self.peak.fetch_max(active, Ordering::SeqCst);
        // Slow work outlasts a short deadline by many timer ticks: Windows' are about 15.6ms, so a
        // 10ms sleep and a 1ms deadline can both have passed when the runtime next wakes.
        let slow = input.get("slow") == Some(&serde_json::Value::Bool(true));
        tokio::time::sleep(std::time::Duration::from_millis(if slow {
            500
        } else {
            10
        }))
        .await;
        self.active.fetch_sub(1, Ordering::SeqCst);
        if input.get("fail") == Some(&serde_json::Value::Bool(true)) {
            failure(CommandError::new("EXPECTED", "controlled failure"))
        } else {
            success(input)
        }
    }
}

#[async_trait]
impl CommandHandler for TestHandler {
    async fn execute(
        &self,
        input: serde_json::Value,
        _context: CommandContext,
    ) -> CommandResult<serde_json::Value> {
        success(serde_json::json!({ "echo": input }))
    }
}

#[tokio::test]
async fn test_command_registry() {
    let registry = CommandRegistry::new();

    let cmd = CommandDefinition::new(
        "test-echo",
        "Echoes input back",
        vec![CommandParameter::required_string(
            "message",
            "Message to echo",
        )],
        TestHandler,
    );

    registry.register(cmd).unwrap();
    assert!(registry.has("test-echo"));

    let result = registry
        .execute("test-echo", serde_json::json!({"message": "hello"}), None)
        .await;

    assert!(result.success);
}

#[tokio::test]
async fn test_batch_bounds_concurrency_and_preserves_order() {
    let (registry, peak) = work_registry();
    let request = BatchRequest::new(
        (0..4)
            .map(|index| {
                BatchCommand::new("work-run", serde_json::json!({"index": index}))
                    .with_id(format!("request-{index}"))
            })
            .collect(),
    )
    .with_options(BatchOptions::new().with_parallelism(2));

    let result = registry.execute_batch(request).await;

    assert_eq!(peak.load(Ordering::SeqCst), 2);
    assert_eq!(
        result
            .results
            .iter()
            .map(|result| (result.id.as_str(), result.index))
            .collect::<Vec<_>>(),
        vec![
            ("request-0", 0),
            ("request-1", 1),
            ("request-2", 2),
            ("request-3", 3)
        ]
    );
    assert!(result
        .metadata
        .as_ref()
        .and_then(|metadata| metadata.trace_id.as_deref())
        .is_some_and(|trace_id| trace_id.starts_with("batch-")));
}

#[tokio::test]
async fn test_batch_continues_after_failure_by_default() {
    let (registry, _) = work_registry();
    let request = BatchRequest::new(vec![
        BatchCommand::new("work-run", serde_json::json!({"fail": true})).with_id("first"),
        BatchCommand::new("work-run", serde_json::json!({})),
        BatchCommand::new("missing-command", serde_json::json!({})),
    ]);

    let result = registry.execute_batch(request).await;

    assert!(result.success, "a batch that ran is successful");
    assert_eq!(result.summary.success_count, 1);
    assert_eq!(result.summary.failure_count, 2);
    assert_eq!(result.summary.skipped_count, 0);
    assert!(result.results[1].result.success);
    assert_eq!(result.results[0].id, "first");
    assert_eq!(result.results[1].id, "cmd-1");
    assert_eq!(result.results[2].id, "cmd-2");
    assert_eq!(
        result.results[2].result.error.as_ref().unwrap().code,
        "COMMAND_NOT_FOUND"
    );
    assert_eq!(
        result.reasoning,
        "Executed 3 commands: 1 succeeded, 2 failed"
    );
}

#[tokio::test]
async fn test_batch_stop_on_error_retains_skipped_correlation() {
    let (registry, _) = work_registry();
    let request = BatchRequest::new(vec![
        BatchCommand::new("work-run", serde_json::json!({"fail": true})).with_id("first"),
        BatchCommand::new("work-run", serde_json::json!({})).with_id("second"),
    ])
    .with_options(BatchOptions::new().with_stop_on_error(true));

    let result = registry.execute_batch(request).await;

    assert!(result.success);
    assert_eq!(result.summary.failure_count, 1);
    assert_eq!(result.summary.skipped_count, 1);
    assert_eq!(result.results[1].id, "second");
    assert_eq!(result.results[1].index, 1);
    assert_eq!(result.results[1].command, "work-run");
    assert_eq!(
        result.results[1].result.error.as_ref().unwrap().code,
        "COMMAND_SKIPPED"
    );
}

#[tokio::test]
async fn test_batch_honors_deadline_and_max_failures() {
    let (registry, peak) = work_registry();
    let timed_out = registry
        .execute_batch(
            BatchRequest::new(vec![BatchCommand::new(
                "work-run",
                serde_json::json!({"slow": true}),
            )
            .with_id("slow")])
            .with_options(BatchOptions::new().with_timeout(1.0)),
        )
        .await;
    #[cfg(feature = "native")]
    assert_eq!(
        timed_out.results[0].result.error.as_ref().unwrap().code,
        "BATCH_TIMEOUT"
    );
    #[cfg(not(feature = "native"))]
    {
        assert!(!timed_out.success);
        assert_eq!(timed_out.error.as_ref().unwrap().code, "UNSUPPORTED_OPTION");
        assert!(timed_out.results.is_empty());
        assert_eq!(peak.load(Ordering::SeqCst), 0);
    }

    let failure_limited = registry
        .execute_batch(
            BatchRequest::new(vec![
                BatchCommand::new("work-run", serde_json::json!({"fail": true})).with_id("one"),
                BatchCommand::new("work-run", serde_json::json!({"fail": true})).with_id("two"),
                BatchCommand::new("work-run", serde_json::json!({})).with_id("three"),
            ])
            .with_options(BatchOptions::new().with_max_failures(2)),
        )
        .await;
    assert_eq!(failure_limited.summary.failure_count, 2);
    assert_eq!(failure_limited.summary.skipped_count, 1);
    assert_eq!(failure_limited.results[2].id, "three");
    let _ = peak;
}

#[tokio::test]
async fn test_batch_rejects_invalid_envelopes_before_running() {
    let (registry, peak) = work_registry();
    let command = || BatchCommand::new("work-run", serde_json::json!({}));
    let with_options = |options| BatchRequest::new(vec![command()]).with_options(options);
    for request in [
        BatchRequest::new(vec![]),
        BatchRequest::new(vec![
            command(),
            BatchCommand::new(" \t", serde_json::json!({})),
        ]),
        with_options(BatchOptions::new().with_parallelism(0)),
        with_options(BatchOptions::new().with_max_failures(0)),
        with_options(BatchOptions::new().with_timeout(-5.0)),
        with_options(BatchOptions::new().with_timeout(f64::NAN)),
    ] {
        let result = registry.execute_batch(request).await;
        assert!(!result.success);
        assert!(result.results.is_empty());
        let error = result.error.as_ref().unwrap();
        assert_eq!(error.code, "INVALID_BATCH_REQUEST");
        assert_eq!(error.message, "Invalid batch request envelope");
    }
    assert_eq!(peak.load(Ordering::SeqCst), 0);
}

/// Deadlines and durations read Tokio's clock (see `mod time` in `lib.rs`),
/// so they agree with `tokio::time::timeout` when a test pauses it.
#[cfg(feature = "native")]
#[tokio::test(start_paused = true)]
async fn test_batch_times_follow_a_paused_tokio_clock() {
    let (registry, _) = work_registry();
    let result = registry
        .execute_batch(
            BatchRequest::new(vec![
                BatchCommand::new("work-run", serde_json::json!({})),
                BatchCommand::new("work-run", serde_json::json!({})),
            ])
            .with_options(BatchOptions::new().with_timeout(15.0)),
        )
        .await;

    // work-run takes 10 ms, so the second command has 5 ms left.
    assert!(result.results[0].result.success);
    assert_eq!(result.results[0].duration_ms, 10.0);
    let error = result.results[1].result.error.as_ref().unwrap();
    assert_eq!(error.code, "BATCH_TIMEOUT");
    assert_eq!(error.message, "Batch timeout exceeded (15ms)");
    assert_eq!(result.results[1].duration_ms, 5.0);
    assert_eq!(result.timing.total_ms, 15.0);
}

#[tokio::test]
async fn test_batch_huge_timeout_does_not_overflow() {
    let (registry, _) = work_registry();
    let result = registry
        .execute_batch(
            BatchRequest::new(vec![BatchCommand::new("work-run", serde_json::json!({}))])
                .with_options(BatchOptions::new().with_timeout(f64::MAX)),
        )
        .await;
    assert_eq!(result.success, cfg!(feature = "native"));
}

#[tokio::test]
async fn test_batch_panicking_handler_keeps_other_results() {
    let registry = panic_registry();
    let request = BatchRequest::new(vec![
        BatchCommand::new("panic-run", serde_json::json!({"n": 1})),
        BatchCommand::new("panic-run", serde_json::json!({"panic": true})),
        BatchCommand::new("panic-run", serde_json::json!({"n": 3})),
    ])
    .with_options(BatchOptions::new().with_parallelism(2));

    let result = registry.execute_batch(request).await;

    assert!(result.success);
    assert_eq!(result.results.len(), 3);
    assert_eq!(
        result.results[0].result.data,
        Some(serde_json::json!({"n": 1}))
    );
    assert_execution_failure(&result.results[1].result);
    assert_eq!(
        result.results[2].result.data,
        Some(serde_json::json!({"n": 3}))
    );
    assert_eq!(result.summary.success_count, 2);
    assert_eq!(result.summary.failure_count, 1);
}

fn panic_registry() -> CommandRegistry {
    let registry = CommandRegistry::new();
    registry
        .register(CommandDefinition::new(
            "panic-run",
            "Panics on request",
            vec![
                CommandParameter {
                    required: false,
                    ..CommandParameter::required_boolean("panic", "Panic")
                },
                CommandParameter {
                    required: false,
                    ..CommandParameter::required_number("n", "Number")
                },
            ],
            PanickingHandler,
        ))
        .unwrap();
    registry
}

/// Asserts `result` is the redacted crash failure, with no panic text.
fn assert_execution_failure(result: &CommandResult<serde_json::Value>) {
    assert!(!result.success);
    let error = result.error.as_ref().unwrap();
    assert_eq!(error.code, error_codes::COMMAND_EXECUTION_ERROR);
    assert_eq!(error.message, "An internal error occurred");
    assert_eq!(
        error.suggestion.as_deref(),
        Some("Contact support if this persists")
    );
    assert!(error.details.is_none());
}

#[tokio::test]
async fn test_execute_turns_a_handler_panic_into_execution_failure() {
    let registry = panic_registry();

    let result = registry
        .execute("panic-run", serde_json::json!({"panic": true}), None)
        .await;
    assert_execution_failure(&result);

    // The registry is still usable after a handler panicked.
    let result = registry
        .execute("panic-run", serde_json::json!({"n": 1}), None)
        .await;
    assert_eq!(result.data, Some(serde_json::json!({"n": 1})));
}

#[cfg(feature = "native")]
#[tokio::test]
async fn test_execute_with_timeout_turns_a_handler_panic_into_execution_failure() {
    let result = panic_registry()
        .execute(
            "panic-run",
            serde_json::json!({"panic": true}),
            Some(CommandContext::new().with_timeout(5_000)),
        )
        .await;
    assert_execution_failure(&result);
}

#[tokio::test]
async fn test_execute_turns_a_middleware_panic_into_execution_failure() {
    // One layer panics while building its future, the other while it runs.
    for panic_while_building in [true, false] {
        let registry = panic_registry();
        registry.add_middleware(Arc::new(move |_name, _input, context, next| {
            if panic_while_building {
                panic!("middleware bug before the future");
            }
            Box::pin(async move {
                let _ = next(context).await;
                panic!("middleware bug in the future");
            })
        }));

        let result = registry
            .execute("panic-run", serde_json::json!({"n": 1}), None)
            .await;
        assert_execution_failure(&result);
    }
}

#[test]
fn test_validate_command_name() {
    assert!(validate_command_name("todo-create").is_ok());
    assert!(validate_command_name("create").is_err());
    assert!(validate_command_name("TodoCreate").is_err());
}

#[test]
fn test_default_expose_values() {
    let expose = default_expose();
    assert!(expose.palette);
    assert!(expose.agent);
    assert!(!expose.mcp);
    assert!(!expose.cli);
}

#[tokio::test]
async fn test_command_not_found() {
    let registry = CommandRegistry::new();

    let result = registry
        .execute("nonexistent", serde_json::json!({}), None)
        .await;

    assert!(!result.success);
    assert_eq!(result.error.as_ref().unwrap().code, "COMMAND_NOT_FOUND");
}

/// The `COMMAND_NOT_FOUND` suggestion for `name`, called through `interface`.
async fn not_found_suggestion_for(
    registry: &CommandRegistry,
    name: &str,
    interface: Option<CommandInterface>,
) -> String {
    let context = interface.map(|interface| CommandContext::new().with_interface(interface));
    let result = registry.execute(name, serde_json::json!({}), context).await;
    let error = result.error.expect("an unknown command fails");
    assert_eq!(error.code, "COMMAND_NOT_FOUND");
    assert_eq!(error.retryable, Some(false));
    let suggestion = error
        .suggestion
        .expect("COMMAND_NOT_FOUND has a suggestion");
    // The suggestion and the recovery name the same command, or neither names one
    // (`spec/recovery.md`, "Engine errors").
    let recovery = if suggestion.ends_with("Use afd-help to list all commands.") {
        serde_json::json!({ "kind": "call", "command": "afd-help" })
    } else {
        serde_json::Value::Null
    };
    assert_eq!(
        serde_json::to_value(&error.recovery).unwrap(),
        recovery,
        "{suggestion}"
    );
    suggestion
}

/// `spec/recovery.md`, "Engine errors": a remote MCP caller can always call `afd-discover`, and
/// an in-process registry with no `afd-help` points to no command.
#[tokio::test]
async fn command_not_found_recovers_through_the_command_its_suggestion_names() {
    let registry = Arc::new(CommandRegistry::new());
    let local = registry
        .execute("item-missing", serde_json::json!({}), None)
        .await
        .error
        .unwrap();
    assert_eq!(
        local.suggestion.as_deref(),
        Some("Check the command name against the available commands.")
    );
    assert!(local.recovery.is_none());

    let mut remote = CommandContext::new();
    remote.server_mut().remote = true;
    let remote = registry
        .execute("item-missing", serde_json::json!({}), Some(remote))
        .await
        .error
        .unwrap();
    assert_eq!(
        remote.suggestion.as_deref(),
        Some("Use afd-discover to list all commands.")
    );
    assert_eq!(
        serde_json::to_value(&remote.recovery).unwrap(),
        serde_json::json!({ "kind": "call", "command": "afd-discover" })
    );

    // A batch item carries the single call's answer: here afd-help, once it is registered.
    crate::bootstrap::register_bootstrap_commands(&registry).unwrap();
    let batch = registry
        .execute_batch(crate::BatchRequest::new(vec![BatchCommand::new(
            "item-missing",
            serde_json::json!({}),
        )]))
        .await;
    assert_eq!(
        serde_json::to_value(&batch.results[0].result.error.as_ref().unwrap().recovery).unwrap(),
        serde_json::json!({ "kind": "call", "command": "afd-help" })
    );
}

#[tokio::test]
async fn test_command_not_found_suggests_close_matches_like_typescript() {
    let registry = CommandRegistry::new();
    for name in [
        "todo-create",
        "todo-list",
        "todo-get",
        "todo-update",
        "user-get",
    ] {
        registry
            .register(CommandDefinition::new(name, name, vec![], TestHandler))
            .unwrap();
    }

    // Expected strings are TypeScript `notFoundSuggestion` output for the same
    // names, with its afd-discover pointer replaced (no afd-help is registered).
    assert_eq!(
        not_found_suggestion_for(&registry, "todo-crate", None).await,
        "Did you mean 'todo-create'? Other close matches: 'todo-update', 'todo-list'. \
         Check the command name against the available commands."
    );
    assert_eq!(
        not_found_suggestion_for(&registry, "zzzzzzz", None).await,
        "Check the command name against the available commands."
    );
    // An oversized name is not fuzzy-matched, and is never echoed.
    let oversized = "todo-crate".repeat(20);
    let suggestion = not_found_suggestion_for(&registry, &oversized, None).await;
    assert_eq!(
        suggestion,
        "Check the command name against the available commands."
    );
}

#[tokio::test]
async fn test_command_not_found_suggests_only_callable_commands() {
    let registry = Arc::new(CommandRegistry::new());
    registry
        .register(CommandDefinition::new(
            "todo-create",
            "Create",
            vec![],
            TestHandler,
        ))
        .unwrap();
    registry
        .register(
            CommandDefinition::new("todo-list", "List", vec![], TestHandler)
                .with_expose(ExposeOptions::new().with_mcp(true)),
        )
        .unwrap();
    crate::bootstrap::register_bootstrap_commands(&registry).unwrap();

    // Without an interface every command is a candidate, afd-help included.
    assert_eq!(
        not_found_suggestion_for(&registry, "todo-lis", None).await,
        "Did you mean 'todo-list'? Other close matches: 'todo-create'. \
         Use afd-help to list all commands."
    );
    assert_eq!(
        not_found_suggestion_for(&registry, "afd-hepl", None).await,
        "Did you mean 'afd-help'? Other close matches: 'afd-schema', 'afd-docs'. \
         Use afd-help to list all commands."
    );

    // todo-create is not exposed to MCP, so an MCP caller never sees its name.
    assert_eq!(
        not_found_suggestion_for(&registry, "todo-crate", Some(CommandInterface::Mcp)).await,
        "Did you mean 'todo-list'? Use afd-help to list all commands."
    );
    assert_eq!(
        not_found_suggestion_for(&registry, "todo-crate", Some(CommandInterface::Agent)).await,
        "Did you mean 'todo-create'? Other close matches: 'todo-list'. \
         Use afd-help to list all commands."
    );

    // Nothing, afd-help included, is exposed to the CLI: no names and no pointer
    // to a command the caller cannot run.
    assert_eq!(
        not_found_suggestion_for(&registry, "todo-lis", Some(CommandInterface::Cli)).await,
        "Check the command name against the available commands."
    );
}

#[test]
fn test_command_to_mcp_tool() {
    let cmd = CommandDefinition::new(
        "test-create",
        "Creates a test",
        vec![
            CommandParameter::required_string("name", "Test name"),
            CommandParameter::optional_string("description", "Test description"),
        ],
        TestHandler,
    );

    let tool = command_to_mcp_tool(&cmd);

    assert_eq!(tool.name, "test-create");
    assert_eq!(tool.input_schema.required, vec!["name"]);
    assert!(tool.input_schema.properties.contains_key("name"));
    assert!(tool.input_schema.properties.contains_key("description"));
}

#[test]
fn test_handoff_command() {
    let cmd = CommandDefinition::new("stream-connect", "Connect to stream", vec![], TestHandler)
        .as_handoff_with_protocol("websocket");

    assert!(cmd.handoff);
    assert_eq!(cmd.handoff_protocol, Some("websocket".to_string()));
    assert!(crate::handoff::is_handoff_command(&cmd));
}

#[test]
fn test_list_handoff_commands() {
    let registry = CommandRegistry::new();

    let cmd1 = CommandDefinition::new("test-regular", "Regular command", vec![], TestHandler);

    let cmd2 = CommandDefinition::new("stream-connect", "Connect to stream", vec![], TestHandler)
        .as_handoff_with_protocol("websocket");

    let cmd3 = CommandDefinition::new(
        "events-subscribe",
        "Subscribe to events",
        vec![],
        TestHandler,
    )
    .with_tags(vec!["handoff".to_string(), "events".to_string()]);

    registry.register(cmd1).unwrap();
    registry.register(cmd2).unwrap();
    registry.register(cmd3).unwrap();

    let handoff_commands = registry.list_handoff_commands();
    assert_eq!(handoff_commands.len(), 2);
}

// ═══════════════════════════════════════════════════════════════════════════════
// METADATA ENFORCEMENT
// ═══════════════════════════════════════════════════════════════════════════════

/// Echoes the input and the context it was called with, and counts calls.
struct ContextEchoHandler {
    calls: Arc<AtomicUsize>,
}

#[async_trait]
impl CommandHandler for ContextEchoHandler {
    async fn execute(
        &self,
        input: serde_json::Value,
        context: CommandContext,
    ) -> CommandResult<serde_json::Value> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        success(serde_json::json!({
            "input": input,
            "traceId": context.trace_id,
            "interface": context.interface,
            "extra": context.extra,
        }))
    }
}

/// A registry with `todo-create` (title required, priority enum with a
/// default) and a call counter for its handler.
fn validating_registry() -> (CommandRegistry, Arc<AtomicUsize>) {
    let calls = Arc::new(AtomicUsize::new(0));
    let registry = CommandRegistry::new();
    registry
        .register(CommandDefinition::new(
            "todo-create",
            "Create a todo",
            vec![
                CommandParameter::required_string("title", "Title"),
                CommandParameter::optional_string("priority", "Priority")
                    .with_enum(vec![
                        serde_json::json!("low"),
                        serde_json::json!("medium"),
                        serde_json::json!("high"),
                    ])
                    .with_default(serde_json::json!("medium")),
            ],
            ContextEchoHandler {
                calls: Arc::clone(&calls),
            },
        ))
        .unwrap();
    (registry, calls)
}

#[tokio::test]
async fn test_execute_validates_input_before_the_handler() {
    let (registry, calls) = validating_registry();

    let missing = registry
        .execute("todo-create", serde_json::json!({}), None)
        .await;
    let wrong_enum = registry
        .execute(
            "todo-create",
            serde_json::json!({"title": "Buy milk", "priority": "urgent"}),
            None,
        )
        .await;
    let wrong_type = registry
        .execute("todo-create", serde_json::json!({"title": 7}), None)
        .await;

    for result in [&missing, &wrong_enum, &wrong_type] {
        let error = result.error.as_ref().unwrap();
        assert_eq!(error.code, "VALIDATION_ERROR");
        assert!(error
            .suggestion
            .as_deref()
            .is_some_and(|suggestion| suggestion.ends_with("Expected fields: priority, title")));
    }
    assert!(missing
        .error
        .as_ref()
        .unwrap()
        .suggestion
        .as_deref()
        .is_some_and(|suggestion| suggestion
            .starts_with("title: Invalid input: expected string, received undefined")));
    assert_eq!(calls.load(Ordering::SeqCst), 0, "the handler must not run");
}

#[tokio::test]
async fn test_execute_passes_validated_input_with_defaults() {
    let (registry, calls) = validating_registry();

    let result = registry
        .execute(
            "todo-create",
            serde_json::json!({"title": "Buy milk"}),
            None,
        )
        .await;

    assert!(result.success);
    assert_eq!(
        result.data.unwrap()["input"],
        serde_json::json!({"title": "Buy milk", "priority": "medium"})
    );
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[test]
fn test_expose_flags_default_individually() {
    let expose: ExposeOptions = serde_json::from_value(serde_json::json!({"mcp": true})).unwrap();
    assert_eq!(expose, ExposeOptions::new().with_mcp(true));
    assert!(expose.is_exposed_to(CommandInterface::Mcp));
    assert!(expose.is_exposed_to(CommandInterface::Agent));
    assert!(expose.is_exposed_to(CommandInterface::Palette));
    assert!(!expose.is_exposed_to(CommandInterface::Cli));

    let hidden: ExposeOptions =
        serde_json::from_value(serde_json::json!({"agent": false})).unwrap();
    assert!(!hidden.is_exposed_to(CommandInterface::Agent));
    assert!(hidden.is_exposed_to(CommandInterface::Palette));
    assert!(!hidden.is_exposed_to(CommandInterface::Mcp));
}

#[tokio::test]
async fn test_execute_enforces_exposure_for_the_calling_interface() {
    let (registry, calls) = validating_registry();
    registry
        .register(
            CommandDefinition::new(
                "todo-list",
                "List todos",
                vec![],
                ContextEchoHandler {
                    calls: Arc::clone(&calls),
                },
            )
            .with_expose(ExposeOptions::new().with_mcp(true)),
        )
        .unwrap();
    let input = serde_json::json!({"title": "Buy milk"});
    let via = |interface| Some(CommandContext::new().with_interface(interface));

    let mcp = registry
        .execute("todo-create", input.clone(), via(CommandInterface::Mcp))
        .await;
    let cli = registry
        .execute("todo-create", input.clone(), via(CommandInterface::Cli))
        .await;
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    for (result, interface) in [(&mcp, "mcp"), (&cli, "cli")] {
        let error = result.error.as_ref().unwrap();
        assert_eq!(error.code, "COMMAND_NOT_EXPOSED");
        assert!(error.message.contains(interface));
        assert!(error
            .suggestion
            .as_deref()
            .is_some_and(|suggestion| suggestion.contains(&format!("expose.{interface}"))));
    }

    for interface in [CommandInterface::Agent, CommandInterface::Palette] {
        assert!(
            registry
                .execute("todo-create", input.clone(), via(interface))
                .await
                .success
        );
    }
    assert!(registry.execute("todo-create", input, None).await.success);
    assert!(
        registry
            .execute(
                "todo-list",
                serde_json::json!({}),
                via(CommandInterface::Mcp)
            )
            .await
            .success
    );

    let names = |commands: Vec<Arc<CommandDefinition>>| {
        commands
            .iter()
            .map(|command| command.name.clone())
            .collect::<Vec<_>>()
    };
    assert_eq!(
        names(registry.list_by_exposure(CommandInterface::Mcp)),
        vec!["todo-list"]
    );
    assert_eq!(
        names(registry.list_by_exposure(CommandInterface::Agent)),
        vec!["todo-create", "todo-list"]
    );
    assert!(is_exposed_to(
        &registry.get("todo-list").unwrap(),
        CommandInterface::Mcp
    ));
}

/// Sleeps for `input.sleepMs` milliseconds, then succeeds.
struct SleepHandler {
    calls: Arc<AtomicUsize>,
}

#[async_trait]
impl CommandHandler for SleepHandler {
    async fn execute(
        &self,
        input: serde_json::Value,
        _context: CommandContext,
    ) -> CommandResult<serde_json::Value> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let sleep_ms = input.get("sleepMs").and_then(|ms| ms.as_u64()).unwrap_or(0);
        tokio::time::sleep(Duration::from_millis(sleep_ms)).await;
        success(serde_json::json!({"slept": sleep_ms}))
    }
}

#[tokio::test]
async fn test_execute_honors_context_timeout() {
    let calls = Arc::new(AtomicUsize::new(0));
    let registry = CommandRegistry::new();
    registry
        .register(CommandDefinition::new(
            "work-sleep",
            "Sleeps",
            vec![CommandParameter {
                required: false,
                ..CommandParameter::required_number("sleepMs", "Sleep milliseconds")
            }],
            SleepHandler {
                calls: Arc::clone(&calls),
            },
        ))
        .unwrap();

    let slow = registry
        .execute(
            "work-sleep",
            serde_json::json!({"sleepMs": 5_000}),
            Some(CommandContext::new().with_timeout(10)),
        )
        .await;
    let fast = registry
        .execute(
            "work-sleep",
            serde_json::json!({"sleepMs": 0}),
            Some(CommandContext::new().with_timeout(5_000)),
        )
        .await;

    #[cfg(feature = "native")]
    {
        let error = slow.error.as_ref().unwrap();
        assert_eq!(error.code, "TIMEOUT");
        assert_eq!(error.retryable, Some(true));
        assert!(error.message.contains("work-sleep"));
        assert!(fast.success);
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }
    #[cfg(not(feature = "native"))]
    {
        for result in [&slow, &fast] {
            let error = result.error.as_ref().unwrap();
            assert_eq!(error.code, "UNSUPPORTED_OPTION");
            assert!(error.suggestion.is_some());
        }
        assert_eq!(calls.load(Ordering::SeqCst), 0, "the handler must not run");
    }
}

type Log = Arc<std::sync::Mutex<Vec<String>>>;

fn recording_middleware(label: &'static str, log: Log) -> CommandMiddleware {
    Arc::new(move |name, input, context, next| {
        let log = Arc::clone(&log);
        Box::pin(async move {
            log.lock()
                .unwrap()
                .push(format!("{label}:before:{name}:{}", input["priority"]));
            let result = next(context).await;
            log.lock().unwrap().push(format!("{label}:after"));
            result
        })
    })
}

#[tokio::test]
async fn test_middleware_wraps_execution_in_order() {
    let (registry, calls) = validating_registry();
    let log: Log = Arc::default();
    registry.add_middleware(recording_middleware("outer", Arc::clone(&log)));
    registry.add_middleware(recording_middleware("inner", Arc::clone(&log)));

    let result = registry
        .execute(
            "todo-create",
            serde_json::json!({"title": "Buy milk"}),
            None,
        )
        .await;

    assert!(result.success);
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(
        *log.lock().unwrap(),
        vec![
            r#"outer:before:todo-create:"medium""#,
            r#"inner:before:todo-create:"medium""#,
            "inner:after",
            "outer:after",
        ],
        "middleware sees validated input with defaults, first added outermost"
    );

    // Invalid input never reaches the middleware.
    log.lock().unwrap().clear();
    let invalid = registry
        .execute("todo-create", serde_json::json!({}), None)
        .await;
    assert!(!invalid.success);
    assert!(log.lock().unwrap().is_empty());
}

#[tokio::test]
async fn test_middleware_can_short_circuit_and_retry() {
    let (registry, calls) = validating_registry();
    registry.add_middleware(Arc::new(|_name, input, context, next| {
        Box::pin(async move {
            if input["title"] == "blocked" {
                return failure(
                    CommandError::new("FORBIDDEN", "Blocked by policy")
                        .with_suggestion("Use another title"),
                );
            }
            let first = next(context.clone()).await;
            if input["title"] == "twice" {
                return next(context.clone()).await;
            }
            first
        })
    }));

    let blocked = registry
        .execute("todo-create", serde_json::json!({"title": "blocked"}), None)
        .await;
    assert_eq!(blocked.error.unwrap().code, "FORBIDDEN");
    assert_eq!(calls.load(Ordering::SeqCst), 0);

    let twice = registry
        .execute("todo-create", serde_json::json!({"title": "twice"}), None)
        .await;
    assert!(twice.success);
    assert_eq!(calls.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn test_batch_propagates_request_and_caller_context() {
    let (registry, _) = validating_registry();
    let mut request = BatchRequest::new(vec![
        BatchCommand::new("todo-create", serde_json::json!({"title": "one"})),
        BatchCommand::new("todo-create", serde_json::json!({"title": "two"})),
    ]);
    request.context = Some(HashMap::from([
        ("tenant".to_string(), serde_json::json!("acme")),
        ("userId".to_string(), serde_json::json!("from-request")),
    ]));
    let caller = CommandContext::new()
        .with_trace_id("req-7")
        .with_interface(CommandInterface::Agent)
        .with_extra("userId", serde_json::json!("from-host"));

    let result = registry.execute_batch_with_context(request, caller).await;

    assert!(result.success);
    for (index, entry) in result.results.iter().enumerate() {
        let data = entry.result.data.as_ref().unwrap();
        assert_eq!(data["traceId"], format!("req-7-{index}"));
        assert_eq!(data["interface"], "agent");
        assert_eq!(data["extra"]["tenant"], "acme");
        assert_eq!(
            data["extra"]["userId"], "from-host",
            "request context must not replace host values"
        );
    }
    assert_eq!(
        result.metadata.as_ref().unwrap().trace_id.as_deref(),
        Some("req-7")
    );
}

#[tokio::test]
async fn test_batch_entries_get_exposure_checks_and_validation() {
    let (registry, calls) = validating_registry();
    let request = BatchRequest::new(vec![
        BatchCommand::new("todo-create", serde_json::json!({"title": "one"})),
        BatchCommand::new("todo-create", serde_json::json!({})),
    ]);

    let over_mcp = registry
        .execute_batch_with_context(
            request.clone(),
            CommandContext::new().with_interface(CommandInterface::Mcp),
        )
        .await;
    assert_eq!(over_mcp.summary.failure_count, 2);
    assert!(over_mcp
        .results
        .iter()
        .all(|entry| entry.result.error.as_ref().unwrap().code == "COMMAND_NOT_EXPOSED"));

    let direct = registry.execute_batch(request).await;
    assert_eq!(direct.summary.success_count, 1);
    assert_eq!(
        direct.results[1].result.error.as_ref().unwrap().code,
        "VALIDATION_ERROR"
    );
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[test]
fn test_requires_and_contexts_metadata() {
    let command = CommandDefinition::new("todo-update", "Update a todo", vec![], TestHandler)
        .with_requires(["todo-get"])
        .with_contexts(vec!["editing".to_string(), "review".to_string()]);

    assert_eq!(command.requires, Some(vec!["todo-get".to_string()]));
    assert!(command.is_accessible_in_context(None));
    assert!(command.is_accessible_in_context(Some("review")));
    assert!(!command.is_accessible_in_context(Some("admin")));

    let everywhere = CommandDefinition::new("todo-get", "Get a todo", vec![], TestHandler);
    assert!(everywhere.is_accessible_in_context(Some("admin")));
    assert!(everywhere.requires.is_none());
}

#[test]
fn test_shared_registry_registers_through_arc_in_order() {
    let registry = Arc::new(CommandRegistry::new());
    for name in ["zeta-run", "alpha-run", "mid-run"] {
        Arc::clone(&registry)
            .register(CommandDefinition::new(name, "Runs", vec![], TestHandler))
            .unwrap();
    }

    let names: Vec<_> = registry
        .list()
        .iter()
        .map(|command| command.name.clone())
        .collect();
    assert_eq!(names, vec!["zeta-run", "alpha-run", "mid-run"]);
    assert!(registry
        .register(CommandDefinition::new(
            "alpha-run",
            "Again",
            vec![],
            TestHandler
        ))
        .is_err());
    assert_eq!(registry.list().len(), 3);
}

#[tokio::test]
async fn test_command_not_found_truncates_long_names() {
    let registry = CommandRegistry::new();
    let name = "x".repeat(10_000);

    let result = registry.execute(&name, serde_json::json!({}), None).await;

    let message = result.error.unwrap().message;
    assert!(message.len() < 200, "{} bytes echoed", message.len());
    assert!(message.contains('…'));
}

// ═══════════════════════════════════════════════════════════════════════════════
// PARITY WITH THE TYPESCRIPT ENGINE
// ═══════════════════════════════════════════════════════════════════════════════
//
// Expected values come from running the same input through
// `packages/server/src/execution.ts` and `packages/core/src/similarity.ts`.

#[tokio::test]
async fn test_validation_failure_matches_typescript() {
    let (registry, _) = validating_registry();

    let result = registry
        .execute(
            "todo-create",
            serde_json::json!({"title": 7, "priority": "urgent", "typo": true}),
            None,
        )
        .await;

    let error = result.error.unwrap();
    assert_eq!(error.message, "Input validation failed");
    assert_eq!(
        error.suggestion.as_deref(),
        Some(
            "- priority: Invalid option: expected one of \"low\"|\"medium\"|\"high\"\n\
             - title: Invalid input: expected string, received number. \
             Unknown field(s): typo. Expected fields: priority, title"
        )
    );
    assert_eq!(
        serde_json::to_value(error.details.unwrap()).unwrap(),
        serde_json::json!({
            "errors": [
                {
                    "path": "priority",
                    "message": "Invalid option: expected one of \"low\"|\"medium\"|\"high\"",
                    "code": "invalid_value",
                },
                {
                    "path": "title",
                    "message": "Invalid input: expected string, received number",
                    "code": "invalid_type",
                    "expected": "string",
                },
            ],
            "expectedFields": ["priority", "title"],
            "unexpectedFields": ["typo"],
        })
    );
}

#[tokio::test]
async fn test_missing_field_failure_matches_typescript() {
    let (registry, _) = validating_registry();

    let result = registry
        .execute("todo-create", serde_json::json!({}), None)
        .await;

    let error = result.error.unwrap();
    assert_eq!(error.message, "Input validation failed");
    assert_eq!(
        error.suggestion.as_deref(),
        Some(
            "title: Invalid input: expected string, received undefined. \
             Missing required field(s): title. \
             Expected fields: priority, title"
        )
    );
    assert_eq!(
        serde_json::to_value(error.details.unwrap()).unwrap(),
        serde_json::json!({
            "errors": [{
                "path": "title",
                "message": "Invalid input: expected string, received undefined",
                "code": "invalid_type",
                "expected": "string",
            }],
            "expectedFields": ["priority", "title"],
            "missingFields": ["title"],
        })
    );
}

#[tokio::test]
async fn test_handler_and_middleware_never_see_undeclared_keys() {
    let (registry, _) = validating_registry();
    let seen: Log = Arc::default();
    let log = Arc::clone(&seen);
    registry.add_middleware(Arc::new(move |_name, input, context, next| {
        log.lock().unwrap().push(input.to_string());
        next(context.clone())
    }));

    let result = registry
        .execute(
            "todo-create",
            serde_json::json!({"title": "Buy milk", "typo": true, "__proto__": {}}),
            None,
        )
        .await;

    let expected = serde_json::json!({"title": "Buy milk", "priority": "medium"});
    assert_eq!(result.data.unwrap()["input"], expected);
    assert_eq!(*seen.lock().unwrap(), vec![expected.to_string()]);
}

#[test]
fn test_truncate_name_counts_utf16_code_units() {
    let emoji = "\u{1F600}";
    // A surrogate pair that would straddle the cut is dropped whole.
    assert_eq!(
        truncate_name(&format!("{}{emoji}tail", "a".repeat(127))),
        format!("{}…", "a".repeat(127))
    );
    assert_eq!(
        truncate_name(&format!("{}{emoji}", "a".repeat(128))),
        format!("{}…", "a".repeat(128))
    );
    // 64 emoji are 128 code units: not cut. 65 are cut after 64.
    assert_eq!(truncate_name(&emoji.repeat(64)), emoji.repeat(64));
    assert_eq!(
        truncate_name(&emoji.repeat(65)),
        format!("{}…", emoji.repeat(64))
    );
    // A BMP character is one code unit however many bytes it takes.
    assert_eq!(
        truncate_name(&"é".repeat(200)),
        format!("{}…", "é".repeat(128))
    );
    assert_eq!(truncate_name("todo-create"), "todo-create");
}

/// Reports the actor, clock and random source the handler sees.
struct ContextProbe;

#[async_trait]
impl CommandHandler for ContextProbe {
    async fn execute(
        &self,
        _input: serde_json::Value,
        context: CommandContext,
    ) -> CommandResult<serde_json::Value> {
        success(serde_json::json!({
            "actor": context.actor,
            "hasClock": context.clock.is_some(),
            "hasRandom": context.random.is_some(),
            "now": context.clock().now(),
            "random": context.random().next(),
        }))
    }
}

fn probe_registry() -> CommandRegistry {
    let registry = CommandRegistry::new();
    registry
        .register(CommandDefinition::new(
            "context-probe",
            "Show the context",
            vec![],
            ContextProbe,
        ))
        .unwrap();
    registry
}

#[tokio::test]
async fn execute_fills_clock_and_random_and_reports_no_actor_by_default() {
    let result = probe_registry()
        .execute("context-probe", serde_json::json!({}), None)
        .await;
    let data = result.data.unwrap();
    assert_eq!(data["actor"], serde_json::Value::Null);
    assert_eq!(data["hasClock"], true);
    assert_eq!(data["hasRandom"], true);
    assert!(result
        .metadata
        .is_none_or(|metadata| metadata.actor_kind.is_none()));
}

#[tokio::test]
async fn execute_passes_the_callers_clock_random_and_actor() {
    let context = CommandContext::new()
        .with_clock(crate::fixed_clock(42))
        .with_random(crate::seeded_random("abc"))
        .with_actor(crate::Actor::new(crate::ActorKind::Human).with_id("user-1"));
    let result = probe_registry()
        .execute("context-probe", serde_json::json!({}), Some(context))
        .await;
    let metadata = result.metadata.clone().unwrap();
    assert_eq!(metadata.actor_kind, Some(crate::ActorKind::Human));
    assert!(!serde_json::to_string(&metadata).unwrap().contains("user-1"));
    let data = result.data.unwrap();
    assert_eq!(
        data["actor"],
        serde_json::json!({"kind": "human", "id": "user-1"})
    );
    assert_eq!(data["now"], 42);
    assert_eq!(data["random"], 0.5166419988963753);
}

#[tokio::test]
async fn middleware_sees_the_filled_context_and_batches_keep_the_actor() {
    let registry = probe_registry();
    let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
    let record = Arc::clone(&seen);
    registry.add_middleware(Arc::new(move |_name, _input, context, next| {
        record.lock().unwrap().push((
            context.clock.is_some(),
            context.actor.as_ref().map(|actor| actor.kind),
        ));
        Box::pin(async move { next(context).await })
    }));
    let request = BatchRequest::new(vec![
        BatchCommand::new("context-probe", serde_json::json!({})),
        BatchCommand::new("context-probe", serde_json::json!({})),
    ]);
    let batch = registry
        .execute_batch_with_context(
            request,
            CommandContext::new().with_actor(crate::ActorKind::Script),
        )
        .await;
    for item in &batch.results {
        assert_eq!(
            item.result.metadata.as_ref().unwrap().actor_kind,
            Some(crate::ActorKind::Script)
        );
    }
    assert_eq!(
        *seen.lock().unwrap(),
        vec![(true, Some(crate::ActorKind::Script)); 2]
    );
}

/// Writes `actorKind` into `extra`, as code written for 0.1.0 might.
struct ExtraActorKind;

#[async_trait]
impl CommandHandler for ExtraActorKind {
    async fn execute(
        &self,
        _input: serde_json::Value,
        _context: CommandContext,
    ) -> CommandResult<serde_json::Value> {
        let mut result = success(serde_json::json!({}));
        result.metadata =
            Some(ResultMetadata::new().with_extra("actorKind", serde_json::json!("human")));
        result
    }
}

#[tokio::test]
async fn the_stamped_actor_kind_replaces_one_in_extra() {
    let registry = probe_registry();
    registry
        .register(CommandDefinition::new(
            "legacy-kind",
            "Writes actorKind into extra",
            vec![],
            ExtraActorKind,
        ))
        .unwrap();
    let result = registry
        .execute(
            "legacy-kind",
            serde_json::json!({}),
            Some(CommandContext::new().with_actor(crate::ActorKind::Agent)),
        )
        .await;
    let json = serde_json::to_string(&result).unwrap();
    assert_eq!(json.matches("actorKind").count(), 1, "{json}");
    assert!(json.contains(r#""actorKind":"agent""#), "{json}");
}

#[tokio::test]
async fn short_circuits_and_panics_carry_no_actor_kind() {
    let registry = probe_registry();
    registry
        .register(CommandDefinition::new(
            "panic-run",
            "Panics on request",
            vec![CommandParameter {
                required: false,
                ..CommandParameter::required_boolean("panic", "Panic")
            }],
            PanickingHandler,
        ))
        .unwrap();
    let context = || Some(CommandContext::new().with_actor(crate::ActorKind::Agent));
    let panicked = registry
        .execute("panic-run", serde_json::json!({"panic": true}), context())
        .await;
    assert!(!panicked.success);
    assert!(panicked
        .metadata
        .is_none_or(|metadata| metadata.actor_kind.is_none()));

    registry.add_middleware(Arc::new(|_name, _input, _context, _next| {
        Box::pin(async { success(serde_json::json!("blocked")) })
    }));
    let blocked = registry
        .execute("context-probe", serde_json::json!({}), context())
        .await;
    assert_eq!(blocked.data, Some(serde_json::json!("blocked")));
    assert!(blocked
        .metadata
        .is_none_or(|metadata| metadata.actor_kind.is_none()));
}

/// A step of a batch or pipeline approved up front runs on the input validated then, not on a
/// second validation of what was sent (#1414).
#[tokio::test]
async fn a_step_approved_up_front_runs_on_the_input_validated_then() {
    use crate::approval::relay::{ApprovalRelayChannel, UpFrontApproval, UpFrontStep};

    let registry = CommandRegistry::new();
    registry
        .register(
            CommandDefinition::new(
                "note-add",
                "Adds a note",
                vec![
                    CommandParameter::required_string("text", "Text"),
                    CommandParameter::optional_string("id", "ID"),
                ],
                PanickingHandler,
            )
            .with_approval(ApprovalPolicy::Required),
        )
        .unwrap();
    registry
        .register(CommandDefinition::new(
            "note-list",
            "Lists notes",
            vec![CommandParameter::optional_string("id", "ID")],
            PanickingHandler,
        ))
        .unwrap();
    // Stands in for the approval step that admitted each step up front (#1886).
    registry.add_middleware(Arc::new(|name, input, context, next| {
        if let Some(admission) = &context.approval_admission {
            admission.admit(
                0,
                &name,
                crate::approval::admission::Decided::of(
                    crate::canonical::exact(&input).ok(),
                    &input,
                ),
            );
        }
        next(context)
    }));
    // An input a second validation would not give: the id the human was shown.
    let step = |index: usize, id: &str| UpFrontStep {
        index,
        command: "note-add".into(),
        dynamic: false,
        input: Some(serde_json::json!({ "text": "milk", "id": id })),
        sent: Some(serde_json::json!({ "text": "milk" })),
        approval: Some(ApprovalPolicy::Required),
        confirm_prompt: None,
    };
    let mut context = CommandContext::new();
    context.server_mut().up_front_approval = Some(Arc::new(UpFrontApproval::new(
        "afd-batch",
        "[]".into(),
        false,
        vec![
            step(0, "first"),
            step(1, "second"),
            // A command that declares no approval policy runs on it too: an approval
            // middleware's commands list can gate it.
            UpFrontStep {
                index: 2,
                command: "note-list".into(),
                dynamic: false,
                input: Some(serde_json::json!({ "id": "kept" })),
                sent: Some(serde_json::json!({})),
                approval: None,
                confirm_prompt: None,
            },
        ],
        Arc::new(ApprovalRelayChannel::never_asks()),
    )));
    let run = |input: serde_json::Value| {
        let registry = &registry;
        let context = context.clone();
        async move {
            registry
                .execute("note-add", input, Some(context))
                .await
                .data
        }
    };
    let sent = serde_json::json!({ "text": "milk" });
    // Another input is validated as usual, and takes no step's input.
    assert_eq!(
        run(serde_json::json!({ "text": "eggs" })).await,
        Some(serde_json::json!({ "text": "eggs" }))
    );
    // Two steps sent alike take one approved input each, in order.
    assert_eq!(
        run(sent.clone()).await,
        Some(serde_json::json!({ "text": "milk", "id": "first" }))
    );
    assert_eq!(
        run(sent.clone()).await,
        Some(serde_json::json!({ "text": "milk", "id": "second" }))
    );
    // Each is handed out once: a third run is validated as usual.
    assert_eq!(run(sent.clone()).await, Some(sent));
    // The step is still validated as sent: an invalid input fails, and takes nothing.
    let invalid = registry
        .execute("note-add", serde_json::json!({}), Some(context.clone()))
        .await;
    assert_eq!(
        invalid.error.map(|error| error.code),
        Some(crate::error_codes::VALIDATION_ERROR.to_owned())
    );
    let listed = registry
        .execute("note-list", serde_json::json!({}), Some(context.clone()))
        .await;
    assert_eq!(listed.data, Some(serde_json::json!({ "id": "kept" })));
}

/// Echoes what the handler's context holds: the trace ID, an `extra` field and the actor kind.
struct ContextEcho;

#[async_trait]
impl CommandHandler for ContextEcho {
    async fn execute(
        &self,
        _input: serde_json::Value,
        context: CommandContext,
    ) -> CommandResult<serde_json::Value> {
        success(serde_json::json!({
            "traceId": context.trace_id,
            "tenant": context.extra.get("tenant"),
            "clock": context.clock.is_some(),
            "random": context.random.is_some(),
            "padding": "x".repeat(64),
        }))
    }
}

#[tokio::test]
async fn a_middleware_refines_the_context_the_handler_sees() {
    let registry = CommandRegistry::new();
    registry
        .register(CommandDefinition::new(
            "context-echo",
            "Echo the context",
            vec![],
            ContextEcho,
        ))
        .unwrap();
    // The outer layer refines the context; the inner one passes it on unchanged.
    registry.add_middleware(Arc::new(|_, _, mut context, next| {
        context.trace_id = Some("trace-1".into());
        context
            .extra
            .insert("tenant".into(), serde_json::json!("acme"));
        context = context.with_actor(crate::Actor::new(crate::ActorKind::Agent));
        next(context)
    }));
    let seen = Arc::new(std::sync::Mutex::new(None));
    let inner = Arc::clone(&seen);
    registry.add_middleware(Arc::new(move |_, _, context, next| {
        *inner.lock().unwrap() = context.trace_id.clone();
        next(context)
    }));

    let result = registry
        .execute("context-echo", serde_json::json!({}), None)
        .await;
    assert!(result.success, "{result:?}");
    let data = result.data.as_ref().unwrap();
    assert_eq!(data["traceId"], "trace-1");
    assert_eq!(data["tenant"], "acme");
    assert_eq!(seen.lock().unwrap().as_deref(), Some("trace-1"));
    assert_eq!(
        result.metadata.and_then(|metadata| metadata.actor_kind),
        Some(crate::ActorKind::Agent)
    );
}

#[tokio::test]
async fn a_middleware_cannot_drop_the_call_state_by_replacing_the_context() {
    // A middleware that passes a new context keeps its public fields but not the call's
    // crate-owned state: the output budget `execute` set still applies.
    let registry = CommandRegistry::new();
    registry
        .register(
            CommandDefinition::new("context-echo", "Echo the context", vec![], ContextEcho)
                .with_output_budget(20, 40),
        )
        .unwrap();
    registry.add_middleware(Arc::new(|_, _, _context, next| {
        next(CommandContext::new().with_trace_id("fresh"))
    }));

    let result = registry
        .execute("context-echo", serde_json::json!({}), None)
        .await;
    assert!(!result.success);
    assert_eq!(
        result.error.map(|error| error.code),
        Some(error_codes::OUTPUT_BUDGET_EXCEEDED.to_string())
    );
}

#[tokio::test]
async fn a_replaced_context_keeps_the_calls_clock_and_random() {
    // `execute` gives every call a clock and a random source; a middleware that passes a new
    // context does not leave the handler without (the journal's tests check the recording
    // wrappers themselves).
    let registry = CommandRegistry::new();
    registry
        .register(CommandDefinition::new(
            "context-echo",
            "Echo the context",
            vec![],
            ContextEcho,
        ))
        .unwrap();
    registry.add_middleware(Arc::new(|_, _, _context, next| next(CommandContext::new())));

    let result = registry
        .execute("context-echo", serde_json::json!({}), None)
        .await;
    let data = result.data.expect("succeeds");
    assert_eq!(data["clock"], true);
    assert_eq!(data["random"], true);
}

#[tokio::test]
async fn an_inner_layer_sees_the_calls_state_whatever_the_outer_one_passes() {
    // The outer layer passes a fresh context; the inner layer (as an approval or scope check
    // would) still sees the call's interface, credentials and output budget.
    let registry = CommandRegistry::new();
    registry
        .register(
            CommandDefinition::new("context-echo", "Echo the context", vec![], ContextEcho)
                .with_output_budget(1000, 2000)
                .with_expose(ExposeOptions::new().with_mcp(true)),
        )
        .unwrap();
    registry.add_middleware(Arc::new(|_, _, _context, next| next(CommandContext::new())));
    let seen = Arc::new(std::sync::Mutex::new(None));
    let inner = Arc::clone(&seen);
    registry.add_middleware(Arc::new(move |_, _, context, next| {
        *inner.lock().unwrap() = Some((
            context.interface,
            context
                .credentials
                .as_ref()
                .map(|credentials| credentials.subject.clone()),
            context.output_budget,
        ));
        next(context)
    }));

    let credentials = crate::Credentials::new("issuer", "subject-1", "client", "resource", 0, 1);
    let context = CommandContext::new()
        .with_interface(CommandInterface::Mcp)
        .with_credentials(credentials);
    let result = registry
        .execute("context-echo", serde_json::json!({}), Some(context))
        .await;
    assert!(result.success, "{result:?}");
    assert_eq!(
        *seen.lock().unwrap(),
        Some((
            Some(CommandInterface::Mcp),
            Some("subject-1".to_string()),
            Some(1000)
        ))
    );
}

#[tokio::test]
async fn a_replaced_context_keeps_the_servers_default_deadline_choice() {
    // The server's choice of default deadline (`Some(None)`: none) reaches the inner layers and
    // the handler, and so the calls it makes, whatever context an outer layer passes on.
    let registry = CommandRegistry::new();
    registry
        .register(CommandDefinition::new(
            "context-echo",
            "Echo the context",
            vec![],
            ContextEcho,
        ))
        .unwrap();
    registry.add_middleware(Arc::new(|_, _, _context, next| next(CommandContext::new())));
    let seen = Arc::new(std::sync::Mutex::new(None));
    let inner = Arc::clone(&seen);
    registry.add_middleware(Arc::new(move |_, _, context, next| {
        *inner.lock().unwrap() = Some(context.default_timeout_override);
        next(context)
    }));

    let mut context = CommandContext::new();
    context.default_timeout_override = Some(None);
    let result = registry
        .execute("context-echo", serde_json::json!({}), Some(context))
        .await;
    assert!(result.success, "{result:?}");
    assert_eq!(*seen.lock().unwrap(), Some(Some(None)));
}

/// Reports whether the handler's context carries server state, and which of it.
struct ServerProbe;

#[async_trait]
impl CommandHandler for ServerProbe {
    async fn execute(
        &self,
        _input: serde_json::Value,
        context: CommandContext,
    ) -> CommandResult<serde_json::Value> {
        let server = context.server();
        success(serde_json::json!({
            "present": context.server.is_some(),
            "remote": server.remote,
            "upFront": server.up_front_approval.is_some(),
            "relayAsks": server.approval_relay.is_some(),
        }))
    }
}

fn server_probe_registry() -> CommandRegistry {
    let registry = CommandRegistry::new();
    registry
        .register(CommandDefinition::new(
            "server-probe",
            "Probe",
            vec![],
            ServerProbe,
        ))
        .unwrap();
    registry
}

fn server_context() -> CommandContext {
    use crate::approval::relay::{ApprovalRelayChannel, UpFrontApproval};
    let mut context = CommandContext::new();
    let server = context.server_mut();
    server.remote = true;
    server.up_front_approval = Some(Arc::new(UpFrontApproval::new(
        "afd-batch",
        "[]".into(),
        false,
        vec![],
        Arc::new(ApprovalRelayChannel::never_asks()),
    )));
    context
}

#[tokio::test]
async fn an_in_process_call_carries_no_server_state() {
    let result = server_probe_registry()
        .execute("server-probe", serde_json::json!({}), None)
        .await;
    assert_eq!(result.data.unwrap()["present"], false);
}

#[tokio::test]
async fn clearing_the_relay_state_for_the_handler_leaves_other_copies_alone() {
    // The handler's copy loses the up-front approval; the caller's context, a sibling clone and
    // the state a middleware layer sees after `next` keep theirs.
    let registry = server_probe_registry();
    let seen_after = Arc::new(std::sync::Mutex::new(None));
    let after = Arc::clone(&seen_after);
    registry.add_middleware(Arc::new(move |_name, _input, context, next| {
        let after = Arc::clone(&after);
        Box::pin(async move {
            let kept = context.clone();
            let result = next(context).await;
            *after.lock().unwrap() = Some(kept.server().up_front_approval.is_some());
            result
        })
    }));
    let context = server_context();
    let sibling = context.clone();
    let result = registry
        .execute("server-probe", serde_json::json!({}), Some(context.clone()))
        .await;
    let data = result.data.unwrap();
    assert_eq!(
        data["remote"], true,
        "the handler keeps the caller's server state"
    );
    assert_eq!(data["upFront"], false, "but never the up-front approval");
    assert!(context.server().up_front_approval.is_some());
    assert!(sibling.server().up_front_approval.is_some());
    assert_eq!(*seen_after.lock().unwrap(), Some(true));
}

#[tokio::test]
async fn a_replaced_context_keeps_the_calls_server_state() {
    // An outer layer passes a fresh context; the inner layer still sees the call's server state.
    let registry = server_probe_registry();
    registry.add_middleware(Arc::new(|_, _, _context, next| next(CommandContext::new())));
    let seen = Arc::new(std::sync::Mutex::new(None));
    let inner = Arc::clone(&seen);
    registry.add_middleware(Arc::new(move |_, _, context, next| {
        *inner.lock().unwrap() = Some((
            context.server().remote,
            context.server().up_front_approval.is_some(),
        ));
        next(context)
    }));
    let result = registry
        .execute(
            "server-probe",
            serde_json::json!({}),
            Some(server_context()),
        )
        .await;
    assert_eq!(*seen.lock().unwrap(), Some((true, true)));
    assert_eq!(result.data.unwrap()["remote"], true);
}

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
            vec![],
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
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
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
            BatchRequest::new(vec![
                BatchCommand::new("work-run", serde_json::json!({})).with_id("slow")
            ])
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
async fn test_batch_rejects_invalid_options() {
    let (registry, _) = work_registry();
    for options in [
        BatchOptions::new().with_parallelism(0),
        BatchOptions::new().with_timeout(-5.0),
        BatchOptions::new().with_timeout(f64::NAN),
    ] {
        let result = registry
            .execute_batch(
                BatchRequest::new(vec![BatchCommand::new("work-run", serde_json::json!({}))])
                    .with_options(options),
            )
            .await;
        assert!(!result.success);
        assert_eq!(result.error.as_ref().unwrap().code, "INVALID_BATCH_REQUEST");
    }
    let empty = registry.execute_batch(BatchRequest::new(vec![])).await;
    assert!(!empty.success);
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
    let registry = CommandRegistry::new();
    registry
        .register(CommandDefinition::new(
            "panic-run",
            "Panics on request",
            vec![],
            PanickingHandler,
        ))
        .unwrap();
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
    let error = result.results[1].result.error.as_ref().unwrap();
    assert_eq!(error.code, "INTERNAL_ERROR");
    assert!(!error.message.contains("handler bug"));
    assert_eq!(
        result.results[2].result.data,
        Some(serde_json::json!({"n": 3}))
    );
    assert_eq!(result.summary.success_count, 2);
    assert_eq!(result.summary.failure_count, 1);
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
            .is_some_and(|suggestion| suggestion.contains("title (string, required)")));
    }
    assert!(missing
        .error
        .as_ref()
        .unwrap()
        .message
        .contains("title is required"));
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
            vec![],
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
    Arc::new(move |name, input, _context, next| {
        let log = Arc::clone(&log);
        Box::pin(async move {
            log.lock()
                .unwrap()
                .push(format!("{label}:before:{name}:{}", input["priority"]));
            let result = next().await;
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
    registry.add_middleware(Arc::new(|_name, input, _context, next| {
        Box::pin(async move {
            if input["title"] == "blocked" {
                return failure(
                    CommandError::new("FORBIDDEN", "Blocked by policy")
                        .with_suggestion("Use another title"),
                );
            }
            let first = next().await;
            if input["title"] == "twice" {
                return next().await;
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

//! Output budgets (`spec/output-budgets.md`, B1 to B8): every case of the shared
//! `spec/output-budgets.json` in process (the registry, batches, pipelines, `DirectClient`, the
//! journal and replay) and, with the `server` feature, over Streamable HTTP and a stdio-shaped
//! connection in both MCP eras, plus the checks the cases cannot express (what the middleware and
//! the journal see, the hook winning, tool lists, `afd-detail`, `afd-help`).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use afd::{
    execute_pipeline, parse_journal, replay_journal, serialize_journal, BatchCommand, BatchRequest,
    CommandContext, CommandDefinition, CommandExecutor, CommandParameter, CommandRegistry,
    CommandResult, DirectClient, JournalRecorder, MemoryJournalSink, OutputBudget, PipelineRequest,
    PipelineStep, ReplayJournalOptions, ReplayStatus, AFD_OUTPUT_BUDGET_META_KEY,
};
use async_trait::async_trait;
use serde_json::{json, Value};

#[cfg(feature = "server")]
mod common;

fn cases() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../spec/output-budgets.json");
    serde_json::from_str(&std::fs::read_to_string(path).expect("spec/output-budgets.json"))
        .expect("spec/output-budgets.json is JSON")
}

fn section(name: &str) -> Vec<Value> {
    cases()[name].as_array().expect(name).clone()
}

fn text(case: &Value) -> &str {
    case["description"].as_str().expect("a description")
}

/// A command from a case: `declaration` is the case's value (`null` for none).
fn definition(
    name: &str,
    declaration: &Value,
    mutation: bool,
    parameters: Vec<CommandParameter>,
    handler: impl afd::CommandHandler + 'static,
) -> CommandDefinition {
    let mut command = CommandDefinition::new(name, "A test command", parameters, handler);
    if !declaration.is_null() {
        let budget = OutputBudget::from_value(declaration).expect("a valid declaration");
        command = command.with_output_budget(budget.default_bytes, budget.max_bytes);
    }
    if mutation {
        command = command.as_mutation();
    }
    command.expose.mcp = true;
    command
}

fn parse_result(value: &Value) -> CommandResult<Value> {
    serde_json::from_value(value.clone()).expect("a CommandResult")
}

/// A handler that returns one fixed result and records the effective budget it saw.
struct Fixed {
    result: CommandResult<Value>,
    seen: Arc<Mutex<Option<Option<u64>>>>,
}

impl Fixed {
    fn new(result: &Value) -> (Self, Arc<Mutex<Option<Option<u64>>>>) {
        let seen = Arc::new(Mutex::new(None));
        (
            Self {
                result: parse_result(result),
                seen: Arc::clone(&seen),
            },
            seen,
        )
    }
}

#[async_trait]
impl afd::CommandHandler for Fixed {
    async fn execute(&self, _input: Value, context: CommandContext) -> CommandResult<Value> {
        *self.seen.lock().unwrap() = Some(context.output_budget());
        self.result.clone()
    }
}

/// Returns, for the `id` input, the result a case lists under that id.
struct Table(HashMap<String, CommandResult<Value>>);

#[async_trait]
impl afd::CommandHandler for Table {
    async fn execute(&self, input: Value, _context: CommandContext) -> CommandResult<Value> {
        self.0[input["id"].as_str().expect("an id")].clone()
    }
}

/// The comparison the spec's `checks` section defines: the result as JSON, with `metadata`
/// compared only on the `dev.afd/outputBudget` member.
fn assert_same(actual: &Value, expected: &Value, label: &str) {
    let mut left = actual.clone();
    let mut right = expected.clone();
    let left_report = left
        .as_object_mut()
        .and_then(|object| object.remove("metadata"))
        .map(|metadata| metadata[AFD_OUTPUT_BUDGET_META_KEY].clone())
        .unwrap_or(Value::Null);
    let right_report = right
        .as_object_mut()
        .and_then(|object| object.remove("metadata"))
        .map(|metadata| metadata[AFD_OUTPUT_BUDGET_META_KEY].clone())
        .unwrap_or(Value::Null);
    assert_eq!(left, right, "{label}: {actual}");
    assert_eq!(left_report, right_report, "{label}: {actual}");
}

/// The in-process form of a case's ask: `None` for no ask or `null`, and the context for
/// `{ "maxBytes": <integer> }`. Anything else cannot be spelled in process (it arrives over MCP).
fn ask_context(ask: Option<&Value>) -> Option<Option<CommandContext>> {
    match ask {
        None | Some(Value::Null) => Some(None),
        Some(Value::Object(members)) if members.len() == 1 => members
            .get("maxBytes")
            .and_then(Value::as_u64)
            .map(|bytes| Some(CommandContext::new().with_output_budget_ask(bytes))),
        Some(_) => None,
    }
}

fn effective_case(case: &Value) -> Option<u64> {
    case["effective"].as_u64()
}

// ═══════════════════════════════════════════════════════════════════════════════
// DECLARATIONS (B1)
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn declarations_are_checked_when_the_command_is_defined_or_registered() {
    for case in section("declarations") {
        let value = &case["value"];
        let label = text(&case);
        let parsed = OutputBudget::from_value(value);
        assert_eq!(parsed.is_ok(), case["valid"] == true, "{label}: {parsed:?}");
        if let Err(error) = &parsed {
            assert!(error.contains("outputBudget"), "{label}: {error}");
        }
        // Registering a declaration made of two integers reaches the same verdict, naming the
        // command and the field.
        if let (Some(default), Some(max), 2) = (
            value["defaultBytes"].as_u64(),
            value["maxBytes"].as_u64(),
            value.as_object().map_or(0, serde_json::Map::len),
        ) {
            let (handler, _) = Fixed::new(&json!({"success": true}));
            let command = CommandDefinition::new("doc-search", "Search", vec![], handler)
                .with_output_budget(default, max);
            let registered = CommandRegistry::new().register(command);
            assert_eq!(registered.is_ok(), case["valid"] == true, "{label}");
            if let Err(error) = registered {
                assert!(error.contains("doc-search"), "{label}: {error}");
                assert!(error.contains("outputBudget."), "{label}: {error}");
            }
        }
    }
}

#[test]
fn every_registration_path_checks_the_declaration() {
    for register in [
        |registry: &CommandRegistry, command: CommandDefinition| registry.register(command),
        |registry: &CommandRegistry, command: CommandDefinition| {
            registry.register_with_schema(command, json!({"type": "object", "properties": {}}))
        },
        |registry: &CommandRegistry, command: CommandDefinition| {
            registry.register_with_schemas(
                command,
                json!({"type": "object", "properties": {}}),
                json!({"type": "object", "properties": {}}),
            )
        },
    ] {
        let (handler, _) = Fixed::new(&json!({"success": true}));
        let bad = CommandDefinition::new("doc-search", "Search", vec![], handler)
            .with_output_budget(10, 5);
        let error = register(&CommandRegistry::new(), bad).unwrap_err();
        assert!(
            error.contains("doc-search") && error.contains("defaultBytes"),
            "{error}"
        );
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// THE ASK AND THE EFFECTIVE BUDGET (B2 to B4)
// ═══════════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn the_effective_budget_follows_the_declaration_and_the_ask() {
    let mut run = 0;
    for case in section("asks") {
        let label = text(&case);
        let Some(context) = ask_context(case.get("ask")) else {
            continue; // spelled only over MCP
        };
        run += 1;
        let (handler, seen) = Fixed::new(&json!({"success": true}));
        let registry = CommandRegistry::new();
        registry
            .register(definition(
                "doc-search",
                &case["declaration"],
                false,
                vec![],
                handler,
            ))
            .unwrap();
        let result = registry.execute("doc-search", json!({}), context).await;
        if case["effective"] == "VALIDATION_ERROR" {
            assert!(!result.success, "{label}");
            let error = result.error.expect(label);
            assert_eq!(error.code, "VALIDATION_ERROR", "{label}");
            let details = error.details.expect(label);
            assert_eq!(details["field"], json!("outputBudget"), "{label}");
            assert_eq!(details["meta"], json!("dev.afd/outputBudget"), "{label}");
            assert!(
                error
                    .suggestion
                    .expect(label)
                    .contains("{ \"maxBytes\": <positive integer> }"),
                "{label}"
            );
            assert!(seen.lock().unwrap().is_none(), "{label}: the handler ran");
        } else {
            assert_eq!(
                *seen.lock().unwrap(),
                Some(effective_case(&case)),
                "{label}: {result:?}"
            );
        }
    }
    assert!(run >= 12, "only {run} cases ran in process");
}

#[tokio::test]
async fn an_invalid_ask_fails_before_the_middleware_and_the_handler() {
    let registry = CommandRegistry::new();
    let (handler, seen) = Fixed::new(&json!({"success": true}));
    // Without a declaration the ask is still validated (B2).
    registry
        .register(definition("doc-open", &Value::Null, false, vec![], handler))
        .unwrap();
    let middleware_ran = Arc::new(Mutex::new(false));
    let flag = Arc::clone(&middleware_ran);
    registry.add_middleware(Arc::new(move |_name, _input, _context, next| {
        *flag.lock().unwrap() = true;
        next()
    }));
    let result = registry
        .execute(
            "doc-open",
            json!({}),
            Some(CommandContext::new().with_output_budget_ask(0)),
        )
        .await;
    assert_eq!(result.error.unwrap().code, "VALIDATION_ERROR");
    assert!(!*middleware_ran.lock().unwrap());
    assert!(seen.lock().unwrap().is_none());
}

#[tokio::test]
async fn an_ask_to_a_command_without_a_declaration_is_ignored() {
    let (handler, seen) = Fixed::new(&json!({"success": true, "data": {"text": "x"}}));
    let registry = CommandRegistry::new();
    registry
        .register(definition("doc-open", &Value::Null, false, vec![], handler))
        .unwrap();
    let result = registry
        .execute(
            "doc-open",
            json!({}),
            Some(CommandContext::new().with_output_budget_ask(1)),
        )
        .await;
    assert!(result.success);
    assert_eq!(*seen.lock().unwrap(), Some(None));
    assert!(result
        .metadata
        .is_none_or(|metadata| metadata.extra.is_empty()));
}

// ═══════════════════════════════════════════════════════════════════════════════
// MEASURING AND THE CHECK (B5, B6)
// ═══════════════════════════════════════════════════════════════════════════════

/// The measure cases through the check itself: a budget of exactly the measured size lets the
/// result through with that `usedBytes`, and one byte less replaces it with `actualBytes` equal
/// to the measured size.
#[tokio::test]
async fn the_measured_size_is_the_canonical_json_without_metadata() {
    let mut run = 0;
    for case in section("measure") {
        let label = text(&case);
        let bytes = case["bytes"].as_u64().unwrap();
        // A lone surrogate cannot be a Rust string: serde_json refuses to parse it.
        let Ok(parsed) = serde_json::from_str::<Value>(case["json"].as_str().unwrap()) else {
            assert!(label.contains("lone surrogate"), "{label}");
            continue;
        };
        run += 1;
        let result = parse_result(&parsed);
        let (handler, _) = Fixed::new(&serde_json::to_value(&result).unwrap());
        let registry = CommandRegistry::new();
        registry
            .register(
                CommandDefinition::new("doc-search", "Search", vec![], handler)
                    .with_output_budget(bytes, bytes),
            )
            .unwrap();
        let fits = registry.execute("doc-search", json!({}), None).await;
        assert!(fits.success, "{label}: {fits:?}");
        assert_eq!(
            fits.metadata.unwrap().extra[AFD_OUTPUT_BUDGET_META_KEY],
            json!({"limitBytes": bytes, "usedBytes": bytes}),
            "{label}"
        );
        if bytes > 1 {
            let (handler, _) = Fixed::new(&serde_json::to_value(&result).unwrap());
            let registry = CommandRegistry::new();
            registry
                .register(
                    CommandDefinition::new("doc-search", "Search", vec![], handler)
                        .with_output_budget(bytes - 1, bytes - 1),
                )
                .unwrap();
            let over = registry.execute("doc-search", json!({}), None).await;
            let error = over
                .error
                .unwrap_or_else(|| panic!("{label}: not replaced"));
            assert_eq!(error.code, "OUTPUT_BUDGET_EXCEEDED", "{label}");
            assert_eq!(
                error.details.unwrap()["actualBytes"],
                json!(bytes),
                "{label}"
            );
        }
    }
    assert!(run >= 9, "only {run} measure cases ran");
}

#[tokio::test]
async fn the_check_produces_what_the_cases_expect() {
    for case in section("checks") {
        let label = text(&case);
        let (handler, _) = Fixed::new(&case["result"]);
        let registry = CommandRegistry::new();
        registry
            .register(definition(
                "doc-search",
                &case["declaration"],
                case["mutation"] == true,
                vec![],
                handler,
            ))
            .unwrap();
        let context = ask_context(case.get("ask")).expect(label);
        let result = registry.execute("doc-search", json!({}), context).await;
        assert_same(
            &serde_json::to_value(&result).unwrap(),
            &case["expected"],
            label,
        );
    }
}

#[tokio::test]
async fn middleware_and_the_journal_see_the_checked_result() {
    let big = json!({"success": true, "data": {"text": "x".repeat(200)}});
    let (handler, _) = Fixed::new(&big);
    let registry = CommandRegistry::new();
    registry
        .register(
            CommandDefinition::new("doc-search", "Search", vec![], handler)
                .with_output_budget(64, 128),
        )
        .unwrap();
    let seen_by_middleware = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&seen_by_middleware);
    registry.add_middleware(Arc::new(move |_name, _input, _context, next| {
        let sink = Arc::clone(&sink);
        Box::pin(async move {
            let result = next().await;
            sink.lock().unwrap().push(result.clone());
            result
        })
    }));
    let journal = Arc::new(MemoryJournalSink::new());
    registry.set_journal(JournalRecorder::new(journal.clone()).with_record_failures(true));

    let result = registry.execute("doc-search", json!({}), None).await;
    assert_eq!(
        result.error.as_ref().unwrap().code,
        "OUTPUT_BUDGET_EXCEEDED"
    );
    let middleware = seen_by_middleware.lock().unwrap();
    assert_eq!(middleware.len(), 1);
    assert_eq!(
        middleware[0].error.as_ref().unwrap().code,
        "OUTPUT_BUDGET_EXCEEDED"
    );
    let entries = journal.entries();
    assert_eq!(entries.len(), 1);
    assert_eq!(
        entries[0].result.error.as_ref().unwrap().code,
        "OUTPUT_BUDGET_EXCEEDED"
    );
    assert_eq!(entries[0].output_budget, Some(64));
}

#[tokio::test]
async fn a_stamped_actor_kind_reaches_a_replaced_failure() {
    let (handler, _) = Fixed::new(&json!({"success": true, "data": {"text": "x".repeat(200)}}));
    let registry = CommandRegistry::new();
    registry
        .register(
            CommandDefinition::new("doc-search", "Search", vec![], handler)
                .with_output_budget(64, 128),
        )
        .unwrap();
    let result = registry
        .execute(
            "doc-search",
            json!({}),
            Some(CommandContext::new().with_actor(afd::Actor::new(afd::ActorKind::Agent))),
        )
        .await;
    assert_eq!(result.error.unwrap().code, "OUTPUT_BUDGET_EXCEEDED");
    assert_eq!(
        result.metadata.unwrap().actor_kind,
        Some(afd::ActorKind::Agent)
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// BATCHES AND PIPELINES (B7)
// ═══════════════════════════════════════════════════════════════════════════════

fn batch_registry(case: &Value) -> Arc<CommandRegistry> {
    let table: HashMap<String, CommandResult<Value>> = case["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| {
            (
                item["id"].as_str().unwrap().to_owned(),
                parse_result(&item["result"]),
            )
        })
        .collect();
    let registry = Arc::new(CommandRegistry::new());
    for (name, command) in case["commands"].as_object().unwrap() {
        registry
            .register(definition(
                name,
                &command["declaration"],
                command["mutation"] == true,
                vec![CommandParameter::required_string("id", "The item")],
                Table(table.clone()),
            ))
            .unwrap();
    }
    registry
}

#[tokio::test]
async fn a_batch_ask_applies_to_every_item_against_its_own_command() {
    let case = cases()["batch"].clone();
    let registry = batch_registry(&case);
    let items = case["items"].as_array().unwrap();
    let request = BatchRequest::new(
        items
            .iter()
            .map(|item| {
                BatchCommand::new(item["command"].as_str().unwrap(), json!({"id": item["id"]}))
                    .with_id(item["id"].as_str().unwrap())
            })
            .collect(),
    );
    let ask = case["ask"]["maxBytes"].as_u64().unwrap();
    let result = registry
        .execute_batch_with_context(request, CommandContext::new().with_output_budget_ask(ask))
        .await;
    assert_eq!(result.results.len(), items.len());
    for (item, got) in items.iter().zip(&result.results) {
        assert_same(
            &serde_json::to_value(&got.result).unwrap(),
            &item["expected"],
            item["id"].as_str().unwrap(),
        );
    }
    assert_eq!(result.summary.failure_count, 1);
}

#[tokio::test]
async fn a_replaced_batch_item_stops_the_batch_when_stop_on_error_is_set() {
    let case = cases()["batch"].clone();
    let registry = batch_registry(&case);
    // Item "d" is over budget; the item after it must not run.
    let mut request = BatchRequest::new(vec![
        BatchCommand::new("doc-open", json!({"id": "d"})).with_id("d"),
        BatchCommand::new("doc-open", json!({"id": "b"})).with_id("b"),
    ]);
    request.options = Some(afd::BatchOptions::new().with_stop_on_error(true));
    let result = registry
        .execute_batch_with_context(request, CommandContext::new().with_output_budget_ask(96))
        .await;
    assert_eq!(
        result.results[0].result.error.as_ref().unwrap().code,
        "OUTPUT_BUDGET_EXCEEDED"
    );
    assert_eq!(
        result.results[1].result.error.as_ref().unwrap().code,
        "COMMAND_SKIPPED"
    );
}

#[tokio::test]
async fn a_pipeline_checks_every_step_and_stops_at_a_replaced_one() {
    let case = cases()["batch"].clone();
    let registry = batch_registry(&case);
    let request = PipelineRequest::new(vec![
        PipelineStep::new("doc-search").with_input(json!({"id": "a"})),
        PipelineStep::new("doc-open").with_input(json!({"id": "d"})),
        PipelineStep::new("doc-open").with_input(json!({"id": "b"})),
    ]);
    let shared = Arc::clone(&registry);
    let executor: CommandExecutor = Arc::new(move |command, input, _step| {
        let registry = Arc::clone(&shared);
        Box::pin(async move {
            registry
                .execute(
                    &command,
                    input,
                    Some(CommandContext::new().with_output_budget_ask(96)),
                )
                .await
        })
    });
    let result = execute_pipeline(&request, &executor, None).await;
    assert_eq!(result.steps[0].status, afd::StepStatus::Success);
    assert_eq!(result.steps[1].status, afd::StepStatus::Failure);
    assert_eq!(
        result.steps[1].error.as_ref().unwrap().code,
        "OUTPUT_BUDGET_EXCEEDED"
    );
    assert_ne!(result.steps[2].status, afd::StepStatus::Success);
}

// ═══════════════════════════════════════════════════════════════════════════════
// THE JOURNAL (B8)
// ═══════════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn the_journal_records_the_effective_budget_and_replay_restores_it_as_the_ask() {
    for case in section("journal") {
        let label = text(&case);
        let (handler, _) = Fixed::new(&json!({"success": true}));
        let registry = CommandRegistry::new();
        registry
            .register(definition(
                "doc-search",
                &case["declaration"],
                false,
                vec![],
                handler,
            ))
            .unwrap();
        let journal = Arc::new(MemoryJournalSink::new());
        registry.set_journal(JournalRecorder::new(journal.clone()));
        let context = ask_context(case.get("ask")).expect(label);
        let result = registry.execute("doc-search", json!({}), context).await;
        assert!(result.success, "{label}: {result:?}");
        let entries = journal.entries();
        assert_eq!(
            entries[0].output_budget,
            case["expected"].as_u64(),
            "{label}"
        );

        // On disk the field is `outputBudget`, after `contextDigest`'s siblings and before the
        // result; an entry without a budget has no such key.
        let line = serialize_journal(&entries);
        let value: Value = serde_json::from_str(line.trim()).unwrap();
        assert_eq!(
            value.get("outputBudget").and_then(Value::as_u64),
            case["expected"].as_u64(),
            "{label}"
        );
        assert_eq!(parse_journal(&line).unwrap(), entries, "{label}");

        // Replay: the recorded budget is the ask, so the same declaration gives the same one.
        let (handler, seen) = Fixed::new(&json!({"success": true}));
        let fresh = CommandRegistry::new();
        fresh
            .register(definition(
                "doc-search",
                &case["declaration"],
                false,
                vec![],
                handler,
            ))
            .unwrap();
        let report = replay_journal(&fresh, &entries, ReplayJournalOptions::default()).await;
        assert_eq!(report.entries[0].status, ReplayStatus::Same, "{label}");
        assert_eq!(
            *seen.lock().unwrap(),
            Some(case["expected"].as_u64()),
            "{label}"
        );
    }
}

#[tokio::test]
async fn a_lowered_maximum_changes_a_replayed_result_and_the_report_shows_why() {
    let body = json!({"success": true, "data": {"text": "x".repeat(40)}});
    let recorded_on = |max: u64| {
        let (handler, _) = Fixed::new(&body);
        let registry = CommandRegistry::new();
        registry
            .register(
                CommandDefinition::new("doc-search", "Search", vec![], handler)
                    .with_output_budget(32, max),
            )
            .unwrap();
        registry
    };
    let registry = recorded_on(128);
    let journal = Arc::new(MemoryJournalSink::new());
    registry.set_journal(JournalRecorder::new(journal.clone()).with_record_failures(true));
    let result = registry
        .execute(
            "doc-search",
            json!({}),
            Some(CommandContext::new().with_output_budget_ask(128)),
        )
        .await;
    assert!(result.success, "{result:?}");
    let entries = journal.entries();
    assert_eq!(entries[0].output_budget, Some(128));

    // The declaration has since lowered its maximum to 48 bytes; the result is 51.
    let report = replay_journal(&recorded_on(48), &entries, ReplayJournalOptions::default()).await;
    assert_eq!(report.entries[0].status, ReplayStatus::Different);
    assert_eq!(
        report.entries[0]
            .replayed
            .as_ref()
            .unwrap()
            .error
            .as_ref()
            .unwrap()
            .details
            .as_ref()
            .unwrap()["limitBytes"],
        json!(48)
    );
}

#[tokio::test]
async fn the_budget_joins_the_context_digest_only_when_the_call_has_one() {
    let registry = CommandRegistry::new();
    let (budgeted, _) = Fixed::new(&json!({"success": true}));
    let (plain, _) = Fixed::new(&json!({"success": true}));
    registry
        .register(
            CommandDefinition::new("doc-search", "Search", vec![], budgeted)
                .with_output_budget(64, 128),
        )
        .unwrap();
    registry
        .register(CommandDefinition::new("doc-open", "Open", vec![], plain))
        .unwrap();
    let journal = Arc::new(MemoryJournalSink::new());
    registry.set_journal(JournalRecorder::new(journal.clone()));
    let context = || CommandContext::new().with_trace_id("t-1");
    registry
        .execute("doc-search", json!({}), Some(context()))
        .await;
    registry
        .execute("doc-open", json!({}), Some(context()))
        .await;
    registry
        .execute(
            "doc-search",
            json!({}),
            Some(context().with_output_budget_ask(128)),
        )
        .await;
    let entries = journal.entries();
    // A call without a budget hashes as before the field existed (the existing journal vectors
    // and fixtures cover that); a budgeted call hashes differently for each effective budget:
    // 64 (the default) against 128 (the ask).
    assert_ne!(
        entries[0].context_digest.hash,
        entries[1].context_digest.hash
    );
    assert_ne!(
        entries[0].context_digest.hash,
        entries[2].context_digest.hash
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// DIRECT CLIENT AND IN-PROCESS CONTEXTS
// ═══════════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn direct_client_passes_the_ask_in_the_call_context() {
    let (handler, seen) = Fixed::new(&json!({"success": true}));
    let registry = Arc::new(CommandRegistry::new());
    registry
        .register(
            CommandDefinition::new("doc-search", "Search", vec![], handler)
                .with_output_budget(64, 128),
        )
        .unwrap();
    let client = DirectClient::new(Arc::clone(&registry));
    let result = client
        .call(
            "doc-search",
            json!({}),
            Some(CommandContext::new().with_output_budget_ask(100)),
        )
        .await;
    assert!(result.success, "{result:?}");
    assert_eq!(*seen.lock().unwrap(), Some(Some(100)));
    let result = client.call("doc-search", json!({}), None).await;
    assert!(result.success);
    assert_eq!(*seen.lock().unwrap(), Some(Some(64)));
}

#[test]
fn output_budget_names_are_reserved_for_context_fields() {
    for name in ["outputBudget", "output_budget"] {
        let registry = CommandRegistry::new();
        let error = registry
            .set_context_fields([afd::context_fields::ContextField::new(
                name,
                "dev.example/budget",
                json!({"type": "number"}),
            )])
            .unwrap_err();
        assert!(error.contains(name), "{error}");
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// OVER MCP, BOTH ERAS
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(feature = "server")]
mod mcp {
    use super::*;
    use afd::register_bootstrap_commands;
    use afd::server::{McpServer, ToolStrategy};
    use common::{command_result, modern_post_with_meta, Stdio};

    #[derive(Debug, Clone, Copy, PartialEq)]
    enum Lane {
        HttpModern,
        StdioModern,
        HttpLegacy,
        StdioLegacy,
    }

    const LANES: [Lane; 4] = [
        Lane::HttpModern,
        Lane::StdioModern,
        Lane::HttpLegacy,
        Lane::StdioLegacy,
    ];

    /// A client of one server on one lane: MCP 2026-07-28 (per-request `_meta` envelope) or a
    /// 2025 client, each sending `_meta` in `params`.
    struct Client {
        lane: Lane,
        server: McpServer,
        stdio: Option<Stdio>,
    }

    impl Client {
        async fn connect(server: McpServer, lane: Lane) -> Self {
            let stdio = match lane {
                Lane::StdioModern => Some(Stdio::connect_modern(server.clone())),
                Lane::StdioLegacy => Some(Stdio::connect(server.clone()).await),
                Lane::HttpModern | Lane::HttpLegacy => None,
            };
            Self {
                lane,
                server,
                stdio,
            }
        }

        fn is_modern(&self) -> bool {
            matches!(self.lane, Lane::HttpModern | Lane::StdioModern)
        }

        async fn request(&mut self, method: &str, params: Value, meta: Value) -> Value {
            if self.lane == Lane::HttpModern {
                return modern_post_with_meta(&self.server, method, params, meta, &[]).await;
            }
            let mut all = if self.is_modern() {
                serde_json::from_str(common::META).unwrap()
            } else {
                json!({})
            };
            if let Value::Object(extra) = meta {
                for (key, value) in extra {
                    all[key] = value;
                }
            }
            let mut params = params;
            params["_meta"] = all;
            if let Some(stdio) = &mut self.stdio {
                return stdio.request(method, params).await;
            }
            let name = params["name"].as_str().map(str::to_owned);
            let body = json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });
            let mut headers = vec![("mcp-protocol-version", "2025-11-25")];
            if let Some(name) = name.as_deref() {
                headers.push(("mcp-name", name));
            }
            let (status, response) = common::http_post(&self.server, body, &headers).await;
            assert_eq!(status, 200, "{response}");
            response
        }

        /// The `CommandResult` (or batch or pipeline result) of a `tools/call`.
        async fn call(&mut self, tool: &str, arguments: Value, meta: Value) -> Value {
            let response = self
                .request(
                    "tools/call",
                    json!({ "name": tool, "arguments": arguments }),
                    meta,
                )
                .await;
            let result = command_result(&response);
            assert_eq!(
                response["result"]["structuredContent"], result,
                "{:?}: {response}",
                self.lane
            );
            result
        }

        async fn tools(&mut self, meta: Value) -> Vec<Value> {
            let response = self.request("tools/list", json!({}), meta).await;
            response["result"]["tools"].as_array().unwrap().clone()
        }
    }

    fn ask_meta(ask: Option<&Value>) -> Value {
        match ask {
            Some(ask) => json!({ AFD_OUTPUT_BUDGET_META_KEY: ask }),
            None => json!({}),
        }
    }

    fn server(registry: Arc<CommandRegistry>) -> McpServer {
        McpServer::new(registry, "budget-test", "1.0.0")
    }

    /// Every ask case over MCP, on every lane: the handler sees the effective budget, and an
    /// invalid ask is a `VALIDATION_ERROR` naming the key.
    #[tokio::test]
    async fn the_ask_reaches_the_handler_on_every_lane() {
        for lane in LANES {
            for case in section("asks") {
                let label = format!("{lane:?}: {}", text(&case));
                let (handler, seen) = Fixed::new(&json!({"success": true}));
                let registry = Arc::new(CommandRegistry::new());
                registry
                    .register(definition(
                        "doc-search",
                        &case["declaration"],
                        false,
                        vec![],
                        handler,
                    ))
                    .unwrap();
                let mut client = Client::connect(server(registry), lane).await;
                let result = client
                    .call("doc-search", json!({}), ask_meta(case.get("ask")))
                    .await;
                if case["effective"] == "VALIDATION_ERROR" {
                    assert_eq!(result["success"], false, "{label}: {result}");
                    assert_eq!(result["error"]["code"], "VALIDATION_ERROR", "{label}");
                    assert_eq!(
                        result["error"]["details"],
                        json!({"field": "outputBudget", "meta": "dev.afd/outputBudget"}),
                        "{label}"
                    );
                    assert!(
                        result["error"]["suggestion"]
                            .as_str()
                            .unwrap()
                            .contains("{ \"maxBytes\": <positive integer> }"),
                        "{label}"
                    );
                    assert!(seen.lock().unwrap().is_none(), "{label}: the handler ran");
                } else {
                    // An ask below the result's size gets the over-budget failure; the effective
                    // budget is what the handler saw either way.
                    assert_eq!(
                        *seen.lock().unwrap(),
                        Some(effective_case(&case)),
                        "{label}: {result}"
                    );
                }
            }
        }
    }

    #[tokio::test]
    async fn the_check_produces_what_the_cases_expect_on_every_lane() {
        for lane in LANES {
            for case in section("checks") {
                let label = format!("{lane:?}: {}", text(&case));
                let (handler, _) = Fixed::new(&case["result"]);
                let registry = Arc::new(CommandRegistry::new());
                registry
                    .register(definition(
                        "doc-search",
                        &case["declaration"],
                        case["mutation"] == true,
                        vec![],
                        handler,
                    ))
                    .unwrap();
                let mut client = Client::connect(server(registry), lane).await;
                let response = client
                    .request(
                        "tools/call",
                        json!({ "name": "doc-search", "arguments": {} }),
                        ask_meta(case.get("ask")),
                    )
                    .await;
                let result = command_result(&response);
                assert_eq!(
                    response["result"]["isError"],
                    result["success"] == false,
                    "{label}: {response}"
                );
                assert_same(&result, &case["expected"], &label);
                // The report travels in `structuredContent` and in the text, like the rest.
                assert_eq!(response["result"]["structuredContent"], result, "{label}");
            }
        }
    }

    fn batch_server(case: &Value) -> McpServer {
        let registry = batch_registry(case);
        register_bootstrap_commands(&registry).unwrap();
        server(registry)
    }

    fn batch_items(case: &Value) -> Vec<Value> {
        case["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| {
                json!({
                    "id": item["id"],
                    "command": item["command"],
                    "input": {"id": item["id"]},
                })
            })
            .collect()
    }

    #[tokio::test]
    async fn an_afd_batch_ask_applies_per_item_from_meta_and_from_the_meta_argument() {
        let case = cases()["batch"].clone();
        let items = case["items"].as_array().unwrap();
        for lane in [Lane::HttpModern, Lane::StdioLegacy] {
            let mut client = Client::connect(batch_server(&case), lane).await;
            for by_argument in [false, true] {
                let (arguments, meta) = if by_argument {
                    (
                        json!({
                            "commands": batch_items(&case),
                            "meta": { AFD_OUTPUT_BUDGET_META_KEY: case["ask"] },
                        }),
                        json!({}),
                    )
                } else {
                    (
                        json!({ "commands": batch_items(&case) }),
                        ask_meta(Some(&case["ask"])),
                    )
                };
                let result = client.call("afd-batch", arguments, meta).await;
                let results = result["results"].as_array().unwrap();
                assert_eq!(results.len(), items.len(), "{lane:?}: {result}");
                for (item, got) in items.iter().zip(results) {
                    assert_same(
                        &got["result"],
                        &item["expected"],
                        &format!("{lane:?} {}", item["id"]),
                    );
                }
            }
        }
    }

    #[tokio::test]
    async fn an_afd_pipe_ask_applies_per_step() {
        let case = cases()["batch"].clone();
        let mut client = Client::connect(batch_server(&case), Lane::HttpModern).await;
        let result = client
            .call(
                "afd-pipe",
                json!({ "steps": [
                    {"command": "doc-search", "input": {"id": "a"}},
                    {"command": "doc-open", "input": {"id": "d"}},
                    {"command": "doc-open", "input": {"id": "b"}},
                ]}),
                ask_meta(Some(&case["ask"])),
            )
            .await;
        let steps = result["steps"].as_array().unwrap();
        assert_eq!(steps[0]["status"], "success", "{result}");
        assert_eq!(steps[1]["status"], "failure", "{result}");
        assert_eq!(
            steps[1]["error"]["code"], "OUTPUT_BUDGET_EXCEEDED",
            "{result}"
        );
        assert_ne!(steps[2]["status"], "success", "{result}");
    }

    #[tokio::test]
    async fn afd_call_and_grouped_tools_use_the_routed_commands_budget() {
        let case = cases()["batch"].clone();
        for (strategy, tool, arguments) in [
            (
                ToolStrategy::Individual,
                "afd-call",
                json!({"command": "doc-open", "input": {"id": "d"}}),
            ),
            (
                ToolStrategy::Grouped,
                "doc",
                json!({"action": "open", "params": {"id": "d"}}),
            ),
        ] {
            let mut client = Client::connect(
                batch_server(&case).with_tool_strategy(strategy),
                Lane::HttpModern,
            )
            .await;
            let result = client
                .call(tool, arguments, ask_meta(Some(&case["ask"])))
                .await;
            assert_eq!(
                result["error"]["code"], "OUTPUT_BUDGET_EXCEEDED",
                "{tool}: {result}"
            );
            assert_eq!(result["error"]["details"]["maxBytes"], 200, "{tool}");
            assert_eq!(result["error"]["details"]["limitBytes"], 96, "{tool}");
        }
    }

    #[tokio::test]
    async fn a_meta_argument_that_disagrees_with_meta_is_a_validation_error() {
        let case = cases()["batch"].clone();
        let mut client = Client::connect(batch_server(&case), Lane::HttpModern).await;
        let result = client
            .call(
                "afd-call",
                json!({
                    "command": "doc-open",
                    "input": {"id": "b"},
                    "meta": { AFD_OUTPUT_BUDGET_META_KEY: {"maxBytes": 100} },
                }),
                ask_meta(Some(&json!({"maxBytes": 90}))),
            )
            .await;
        assert_eq!(result["error"]["code"], "VALIDATION_ERROR", "{result}");
        assert_eq!(
            result["error"]["details"],
            json!({"meta": AFD_OUTPUT_BUDGET_META_KEY}),
            "{result}"
        );
        // The same value in both places is accepted.
        let result = client
            .call(
                "afd-call",
                json!({
                    "command": "doc-open",
                    "input": {"id": "b"},
                    "meta": { AFD_OUTPUT_BUDGET_META_KEY: {"maxBytes": 100} },
                }),
                ask_meta(Some(&json!({"maxBytes": 100}))),
            )
            .await;
        assert_eq!(result["success"], true, "{result}");
    }

    #[tokio::test]
    async fn the_hook_wins_over_meta() {
        let (handler, seen) = Fixed::new(&json!({"success": true}));
        let registry = Arc::new(CommandRegistry::new());
        registry
            .register(definition(
                "doc-search",
                &json!({"defaultBytes": 64, "maxBytes": 128}),
                false,
                vec![],
                handler,
            ))
            .unwrap();
        for lane in LANES {
            let hooked =
                server(Arc::clone(&registry)).with_context_hook(|_request, context| async move {
                    Ok(context.with_output_budget_ask(40))
                });
            let mut client = Client::connect(hooked, lane).await;
            let result = client
                .call(
                    "doc-search",
                    json!({}),
                    ask_meta(Some(&json!({"maxBytes": 128}))),
                )
                .await;
            assert!(result["success"].is_boolean());
            assert_eq!(*seen.lock().unwrap(), Some(Some(40)), "{lane:?}: {result}");
        }
    }

    fn listing_registry() -> Arc<CommandRegistry> {
        let registry = Arc::new(CommandRegistry::new());
        let (search, _) = Fixed::new(&json!({"success": true}));
        let (open, _) = Fixed::new(&json!({"success": true}));
        registry
            .register(definition(
                "doc-search",
                &json!({"defaultBytes": 64, "maxBytes": 128}),
                false,
                vec![],
                search,
            ))
            .unwrap();
        registry
            .register(definition("doc-open", &Value::Null, false, vec![], open))
            .unwrap();
        register_bootstrap_commands(&registry).unwrap();
        registry
    }

    fn individual() -> McpServer {
        server(listing_registry()).with_tool_strategy(ToolStrategy::Individual)
    }

    fn tool<'a>(tools: &'a [Value], name: &str) -> &'a Value {
        tools
            .iter()
            .find(|tool| tool["name"] == name)
            .unwrap_or_else(|| panic!("no tool {name}"))
    }

    #[tokio::test]
    async fn tools_carry_the_declaration_and_an_ask_never_changes_the_list() {
        for lane in LANES {
            let mut client = Client::connect(individual(), lane).await;
            let plain = client.tools(json!({})).await;
            assert_eq!(
                tool(&plain, "doc-search")["_meta"][AFD_OUTPUT_BUDGET_META_KEY],
                json!({"defaultBytes": 64, "maxBytes": 128}),
                "{lane:?}"
            );
            assert!(
                tool(&plain, "doc-open")["_meta"]
                    .get(AFD_OUTPUT_BUDGET_META_KEY)
                    .is_none(),
                "{lane:?}"
            );
            // The meta-tools carry no declaration.
            for meta_tool in [
                "afd-call",
                "afd-batch",
                "afd-pipe",
                "afd-discover",
                "afd-detail",
            ] {
                let tools = &plain;
                let found = tools.iter().find(|tool| tool["name"] == meta_tool);
                if let Some(found) = found {
                    assert!(
                        found["_meta"].get(AFD_OUTPUT_BUDGET_META_KEY).is_none(),
                        "{meta_tool}"
                    );
                }
            }
            let asked = client.tools(ask_meta(Some(&json!({"maxBytes": 10})))).await;
            assert_eq!(plain, asked, "{lane:?}");
        }
    }

    #[tokio::test]
    async fn grouped_actions_and_hybrid_first_class_tools_carry_the_declaration() {
        let mut client = Client::connect(
            server(listing_registry()).with_tool_strategy(ToolStrategy::Grouped),
            Lane::HttpModern,
        )
        .await;
        let tools = client.tools(json!({})).await;
        let actions = tool(&tools, "doc")["_meta"]["actions"]
            .as_array()
            .unwrap()
            .clone();
        let search = actions
            .iter()
            .find(|a| a["command"] == "doc-search")
            .unwrap();
        let open = actions.iter().find(|a| a["command"] == "doc-open").unwrap();
        assert_eq!(
            search[AFD_OUTPUT_BUDGET_META_KEY],
            json!({"defaultBytes": 64, "maxBytes": 128})
        );
        assert!(open.get(AFD_OUTPUT_BUDGET_META_KEY).is_none());
        // The grouped tool itself carries none.
        assert!(tool(&tools, "doc")["_meta"]
            .get(AFD_OUTPUT_BUDGET_META_KEY)
            .is_none());

        let mut client = Client::connect(
            server(listing_registry())
                .with_tool_strategy(ToolStrategy::Hybrid)
                .with_first_class_tools(["doc-search"]),
            Lane::StdioLegacy,
        )
        .await;
        let tools = client.tools(json!({})).await;
        assert_eq!(
            tool(&tools, "doc-search")["_meta"][AFD_OUTPUT_BUDGET_META_KEY],
            json!({"defaultBytes": 64, "maxBytes": 128})
        );
        let individual = Client::connect(individual(), Lane::StdioLegacy)
            .await
            .tools(json!({}))
            .await;
        assert_eq!(tool(&tools, "doc-search"), tool(&individual, "doc-search"));
    }

    #[tokio::test]
    async fn afd_detail_and_afd_help_report_the_declaration() {
        for strategy in [ToolStrategy::Individual, ToolStrategy::Lazy] {
            let mut client = Client::connect(
                server(listing_registry()).with_tool_strategy(strategy),
                Lane::HttpModern,
            )
            .await;
            let result = client
                .call(
                    "afd-call",
                    json!({"command": "afd-detail", "input": {"command": ["doc-search", "doc-open"]}}),
                    json!({}),
                )
                .await;
            let result = if result["data"].is_null() {
                client
                    .call(
                        "afd-detail",
                        json!({"command": ["doc-search", "doc-open"]}),
                        json!({}),
                    )
                    .await
            } else {
                result
            };
            let entries = result["data"]
                .as_array()
                .unwrap_or_else(|| panic!("{result}"));
            assert_eq!(
                entries[0]["outputBudget"],
                json!({"defaultBytes": 64, "maxBytes": 128}),
                "{strategy:?}: {result}"
            );
            assert!(entries[1].get("outputBudget").is_none(), "{strategy:?}");
        }
        let mut client = Client::connect(server(listing_registry()), Lane::HttpModern).await;
        let help = client
            .call("afd-help", json!({"format": "full"}), json!({}))
            .await;
        let commands = help["data"]["commands"].as_array().unwrap();
        let search = commands.iter().find(|c| c["name"] == "doc-search").unwrap();
        assert_eq!(
            search["outputBudget"],
            json!({"defaultBytes": 64, "maxBytes": 128})
        );
    }

    #[tokio::test]
    async fn the_server_journals_the_budget_over_mcp() {
        let registry = listing_registry();
        let journal = Arc::new(MemoryJournalSink::new());
        registry.set_journal(JournalRecorder::new(journal.clone()).with_record_failures(true));
        let mut client = Client::connect(server(registry), Lane::StdioModern).await;
        client
            .call(
                "doc-search",
                json!({}),
                ask_meta(Some(&json!({"maxBytes": 1000}))),
            )
            .await;
        client
            .call(
                "doc-open",
                json!({}),
                ask_meta(Some(&json!({"maxBytes": 1000}))),
            )
            .await;
        let entries = journal.entries();
        assert_eq!(entries[0].output_budget, Some(128));
        assert_eq!(entries[1].output_budget, None);
    }
}

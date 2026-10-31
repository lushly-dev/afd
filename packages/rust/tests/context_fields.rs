//! Declared context fields (`spec/context-fields.md`): declaration checks, validation on every
//! in-process call, and what the journal keeps and replay restores (`spec/journal.md`, "Declared
//! context fields"). Mirrors `packages/server/src/context-fields.test.ts`.

use afd::context_fields::ContextField;
use afd::journal::{journal_context_fields, MAX_JOURNAL_CONTEXT_BYTES};
use afd::{
    create_context_digest, fixed_clock, is_journal_entry, parse_journal, replay_journal,
    seeded_random, serialize_journal, success, BatchCommand, BatchRequest, CommandContext,
    CommandDefinition, CommandHandler, CommandRegistry, CommandResult, JournalEntry,
    JournalRecorder, MemoryJournalSink, ReplayJournalOptions, ReplayStatus,
};
use async_trait::async_trait;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

fn scope() -> ContextField {
    ContextField::new(
        "scope",
        "dev.example/scope",
        json!({
            "type": "object",
            "properties": {
                "project": {"type": "string"},
                "region": {"type": "string", "default": "eu"},
            },
            "required": ["project"],
        }),
    )
    .with_journal(true)
}

fn locale() -> ContextField {
    ContextField::new(
        "locale",
        "dev.example/locale",
        json!({"type": "string", "maxLength": 35}),
    )
}

/// `scope-echo` returns the declared fields the call sees and reads the clock once.
struct Echo;

#[async_trait]
impl CommandHandler for Echo {
    async fn execute(&self, _input: Value, context: CommandContext) -> CommandResult<Value> {
        context.clock().now();
        success(json!({
            "scope": context.extra.get("scope"),
            "locale": context.extra.get("locale"),
        }))
    }
}

fn registry(fields: Vec<ContextField>) -> CommandRegistry {
    let registry = CommandRegistry::new();
    registry
        .register(CommandDefinition::new(
            "scope-echo",
            "Return the declared fields the call sees",
            vec![afd::CommandParameter::optional_string("note", "A note")],
            Echo,
        ))
        .unwrap();
    registry.set_context_fields(fields).unwrap();
    registry
}

fn context() -> CommandContext {
    CommandContext::new()
        .with_trace_id("t")
        .with_clock(fixed_clock(0))
}

/// `entry` as JSON text without its result (which `scope-echo` fills with the fields it saw).
fn without_result(entry: &JournalEntry) -> String {
    let mut value = serde_json::to_value(entry).unwrap();
    value.as_object_mut().unwrap().remove("result");
    value.to_string()
}

fn error_details(result: &CommandResult<Value>) -> Value {
    let error = result.error.as_ref().expect("a failure");
    assert_eq!(error.code, "VALIDATION_ERROR");
    json!(error.details.clone().expect("details"))
}

// ═══════════════════════════════════════════════════════════════════════════════
// DECLARATIONS
// ═══════════════════════════════════════════════════════════════════════════════

/// Changes a valid field into one the declaration check refuses.
type Spoil = fn(&mut ContextField);

#[test]
fn declarations_are_checked() {
    let with = |change: Spoil| {
        let mut field = scope();
        change(&mut field);
        CommandRegistry::new()
            .set_context_fields([field])
            .unwrap_err()
    };
    let cases: [(Spoil, &str); 15] = [
        (|f| f.name = String::new(), "non-empty name"),
        (|f| f.name = "actor".into(), "name AFD sets itself"),
        (|f| f.name = "session".into(), "name AFD sets itself"),
        (|f| f.name = "source".into(), "name AFD sets itself"),
        (|f| f.name = "traceId".into(), "name AFD sets itself"),
        (|f| f.name = "trace_id".into(), "name AFD sets itself"),
        (|f| f.name = "timeout_ms".into(), "name AFD sets itself"),
        (|f| f.name = "active_context".into(), "name AFD sets itself"),
        (|f| f.meta = "scope".into(), "reverse-DNS prefix"),
        (|f| f.meta = "example/scope".into(), "reverse-DNS prefix"),
        (|f| f.meta = "dev.afd/scope".into(), "reserved meta prefix"),
        (
            |f| f.meta = "io.modelcontextprotocol/scope".into(),
            "reserved meta prefix",
        ),
        (
            |f| f.meta = "dev.mcp.tools/scope".into(),
            "reserved meta prefix",
        ),
        (
            |f| f.schema = json!({"pattern": "^p-"}),
            "unsupported schema",
        ),
        (|f| f.schema = json!("string"), "unsupported schema"),
    ];
    for (change, message) in cases {
        let error = with(change);
        assert!(error.contains(message), "{error} should contain {message}");
    }
    assert_eq!(
        with(|f| f.name = "clock".into()),
        "Context field 'clock' uses a name AFD sets itself; choose another name"
    );
}

#[test]
fn a_name_or_meta_key_declared_twice_is_refused() {
    let registry = CommandRegistry::new();
    let mut same_name = locale();
    same_name.name = "scope".into();
    let error = registry
        .set_context_fields([scope(), same_name])
        .unwrap_err();
    assert_eq!(error, "Context field 'scope' is declared twice");
    let mut same_meta = locale();
    same_meta.meta = scope().meta;
    let error = registry
        .set_context_fields([scope(), same_meta])
        .unwrap_err();
    assert!(
        error.contains("twice") && error.contains("'locale'"),
        "{error}"
    );
}

#[test]
fn a_refused_declaration_keeps_the_previous_one() {
    let registry = registry(vec![scope(), locale()]);
    let mut bad = locale();
    bad.name = "clock".into();
    assert!(registry.set_context_fields([bad]).is_err());
    assert_eq!(registry.context_fields(), [scope(), locale()]);
    registry.set_context_fields([]).unwrap();
    assert!(registry.context_fields().is_empty());
}

#[test]
fn fields_serialize_as_discovery_lists_them() {
    let value = serde_json::to_value(scope().with_required(true)).unwrap();
    assert_eq!(
        value,
        json!({
            "name": "scope",
            "meta": "dev.example/scope",
            "schema": scope().schema,
            "required": true,
            "journal": true,
        })
    );
    let parsed: ContextField = serde_json::from_value(json!({
        "name": "locale",
        "meta": "dev.example/locale",
        "schema": {"type": "string", "maxLength": 35},
    }))
    .unwrap();
    assert_eq!(parsed, locale());
}

// ═══════════════════════════════════════════════════════════════════════════════
// VALUES IN PROCESS
// ═══════════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn values_reach_the_handler_as_their_schema_outputs_them() {
    let registry = registry(vec![scope(), locale()]);
    let result = registry
        .execute(
            "scope-echo",
            json!({}),
            Some(
                context()
                    .with_extra("scope", json!({"project": "p-1", "stray": true}))
                    .with_extra("locale", json!("en-GB")),
            ),
        )
        .await;
    assert!(result.success, "{result:?}");
    // The default is applied and the undeclared key dropped, as for input.
    assert_eq!(
        result.data,
        Some(json!({"scope": {"project": "p-1", "region": "eu"}, "locale": "en-GB"}))
    );
}

#[tokio::test]
async fn a_call_without_optional_fields_runs() {
    let registry = registry(vec![scope(), locale()]);
    let result = registry
        .execute("scope-echo", json!({}), Some(context()))
        .await;
    assert_eq!(
        result.data,
        Some(json!({"scope": null, "locale": null})),
        "{result:?}"
    );
}

#[tokio::test]
async fn an_invalid_value_fails_with_validation_error_naming_the_field_and_its_meta_key() {
    let registry = registry(vec![scope(), locale()]);
    let calls = Arc::new(AtomicUsize::new(0));
    let seen = Arc::clone(&calls);
    registry.add_middleware(Arc::new(move |_name, _input, _context, next| {
        seen.fetch_add(1, Ordering::SeqCst);
        Box::pin(async move { next().await })
    }));

    let result = registry
        .execute(
            "scope-echo",
            json!({}),
            Some(context().with_extra("scope", json!({"project": 42}))),
        )
        .await;
    assert!(!result.success);
    let error = result.error.as_ref().unwrap();
    assert_eq!(error.message, "Context field 'scope' is not valid");
    assert_eq!(
        error_details(&result),
        json!({
            "field": "scope",
            "meta": "dev.example/scope",
            "errors": [{"path": "project", "message": "Invalid input: expected string, received number"}],
        })
    );
    let suggestion = error.suggestion.as_deref().unwrap();
    assert!(
        suggestion.contains("_meta[\"dev.example/scope\"]"),
        "{suggestion}"
    );
    assert!(suggestion.ends_with(", or leave it out"), "{suggestion}");
    // The middleware and the handler never ran.
    assert_eq!(calls.load(Ordering::SeqCst), 0);

    let result = registry
        .execute(
            "scope-echo",
            json!({}),
            Some(context().with_extra("locale", json!("x".repeat(36)))),
        )
        .await;
    assert_eq!(error_details(&result)["field"], json!("locale"));
    assert_eq!(error_details(&result)["errors"][0]["path"], json!(""));
}

#[tokio::test]
async fn input_is_validated_before_context_fields() {
    let registry = registry(vec![scope()]);
    let result = registry
        .execute(
            "scope-echo",
            json!({"note": 1}),
            Some(context().with_extra("scope", json!(1))),
        )
        .await;
    assert_eq!(
        result.error.unwrap().message,
        "Input validation failed",
        "input errors come first"
    );
}

#[tokio::test]
async fn a_call_without_a_required_field_fails() {
    let registry = registry(vec![scope().with_required(true)]);
    let result = registry
        .execute("scope-echo", json!({}), Some(context()))
        .await;
    let error = result.error.as_ref().unwrap();
    assert_eq!(error.message, "Context field 'scope' is required");
    assert_eq!(
        error_details(&result),
        json!({"field": "scope", "meta": "dev.example/scope", "errors": [{"path": "", "message": "Required"}]})
    );
    assert!(error
        .suggestion
        .as_deref()
        .unwrap()
        .ends_with("; it is required"));
}

#[tokio::test]
async fn a_batch_applies_its_values_to_every_item() {
    let registry = registry(vec![scope().with_required(true)]);
    let request = |scope: Value| {
        let mut request = BatchRequest::new(vec![
            BatchCommand::new("scope-echo", json!({})),
            BatchCommand::new("scope-echo", json!({})),
        ]);
        request.context = Some([("scope".to_string(), scope)].into_iter().collect());
        request
    };
    let batch = registry
        .execute_batch(request(json!({"project": "p-1"})))
        .await;
    assert!(batch
        .results
        .iter()
        .all(|item| item.result.data.as_ref().unwrap()["scope"]["project"] == "p-1"));
    let batch = registry.execute_batch(request(json!({}))).await;
    assert!(batch.results.iter().all(|item| {
        item.result.error.as_ref().unwrap().message == "Context field 'scope' is not valid"
    }));
}

#[tokio::test]
async fn null_counts_as_no_value() {
    // `null` would fail the object schema; as no value it is not validated.
    let lenient = registry(vec![scope(), locale()]);
    let result = lenient
        .execute(
            "scope-echo",
            json!({}),
            Some(context().with_extra("scope", Value::Null)),
        )
        .await;
    assert!(result.success, "{result:?}");
    assert_eq!(result.data.unwrap()["scope"], Value::Null);

    // It does not satisfy a required field.
    let strict = registry(vec![scope().with_required(true)]);
    let result = strict
        .execute(
            "scope-echo",
            json!({}),
            Some(context().with_extra("scope", Value::Null)),
        )
        .await;
    assert_eq!(
        result.error.unwrap().message,
        "Context field 'scope' is required"
    );

    // And the journal keeps nothing for it.
    let entry = record(&lenient, context().with_extra("scope", Value::Null)).await;
    assert_eq!((entry.context, entry.context_omitted), (None, None));
    let kept = journal_context_fields(
        &CommandContext::new().with_extra("scope", Value::Null),
        ["scope"],
    );
    assert_eq!((kept.context, kept.context_omitted), (None, None));
}

#[tokio::test]
async fn afd_commands_do_not_enforce_required_fields_but_validate_present_ones() {
    let registry = Arc::new(registry(vec![scope().with_required(true)]));
    afd::register_bootstrap_commands(&registry).unwrap();

    // A client can discover the fields before it sends them.
    let help = registry
        .execute("afd-help", json!({}), Some(context()))
        .await;
    assert!(help.success, "{help:?}");
    // A value that is present is still validated.
    let help = registry
        .execute(
            "afd-help",
            json!({}),
            Some(context().with_extra("scope", json!({"project": 1}))),
        )
        .await;
    assert_eq!(
        help.error.unwrap().message,
        "Context field 'scope' is not valid"
    );
    // Other commands still require it.
    let echo = registry
        .execute("scope-echo", json!({}), Some(context()))
        .await;
    assert_eq!(
        echo.error.unwrap().message,
        "Context field 'scope' is required"
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// THE JOURNAL
// ═══════════════════════════════════════════════════════════════════════════════

async fn record(registry: &CommandRegistry, context: CommandContext) -> JournalEntry {
    let sink = Arc::new(MemoryJournalSink::new());
    registry.set_journal(JournalRecorder::new(sink.clone()));
    registry
        .execute("scope-echo", json!({}), Some(context))
        .await;
    registry.clear_journal();
    sink.entries().pop().expect("a recorded entry")
}

#[tokio::test]
async fn journaled_values_are_kept_and_the_others_left_as_key_names() {
    let registry = registry(vec![scope(), locale()]);
    let entry = record(
        &registry,
        context()
            .with_extra("scope", json!({"project": "p-1"}))
            .with_extra("locale", json!("en")),
    )
    .await;
    // The kept value is the schema's output.
    assert_eq!(
        entry.context,
        json!({"scope": {"project": "p-1", "region": "eu"}})
            .as_object()
            .cloned()
    );
    assert_eq!(entry.context_omitted, None);
    let line = without_result(&entry);
    assert!(!line.contains("\"en\""), "locale's value leaked: {line}");

    let without_scope = create_context_digest(
        &context()
            .with_random(seeded_random("x"))
            .with_extra("locale", json!("en")),
    );
    assert_ne!(entry.context_digest.hash, without_scope.hash);
}

#[tokio::test]
async fn an_entry_without_journaled_values_hashes_exactly_as_before() {
    let registry = registry(vec![scope(), locale()]);
    let entry = record(&registry, context().with_extra("locale", json!("en"))).await;
    assert_eq!(entry.context, None);
    let expected = create_context_digest(
        &context()
            .with_random(seeded_random("x"))
            .with_extra("locale", json!("en")),
    );
    assert_eq!(entry.context_digest, expected);
}

#[tokio::test]
async fn a_value_over_the_cap_is_named_in_context_omitted_instead() {
    let registry = registry(vec![scope(), locale()]);
    // 2100 characters, 4200 bytes of UTF-8: the cap counts bytes.
    let entry = record(
        &registry,
        context().with_extra("scope", json!({"project": "é".repeat(2100)})),
    )
    .await;
    assert_eq!(entry.context, None);
    assert_eq!(entry.context_omitted, Some(vec!["scope".to_string()]));
    assert!(!without_result(&entry).contains("éé"));
}

#[test]
fn the_cap_is_inclusive_and_names_are_sorted() {
    // `{"project":""}` is 14 bytes.
    let fits = "x".repeat(MAX_JOURNAL_CONTEXT_BYTES - 14);
    let context = CommandContext::new()
        .with_extra("b-scope", json!({"project": fits}))
        .with_extra("a-scope", json!({"project": format!("{fits}x")}))
        .with_extra("c-scope", json!({"z": 1, "a": [{"y": 2, "b": 3}]}))
        .with_extra("unlisted", json!(1));
    let kept = journal_context_fields(&context, ["c-scope", "b-scope", "a-scope", "missing"]);
    assert_eq!(
        kept.context.as_ref().unwrap().keys().collect::<Vec<_>>(),
        ["b-scope", "c-scope"]
    );
    assert_eq!(kept.context_omitted, Some(vec!["a-scope".to_string()]));
    assert_eq!(
        serde_json::to_string(&kept.context.unwrap()["c-scope"]).unwrap(),
        r#"{"a":[{"b":3,"y":2}],"z":1}"#
    );
    let none = journal_context_fields(&context, Vec::<String>::new());
    assert_eq!((none.context, none.context_omitted), (None, None));
}

#[test]
fn entries_with_context_round_trip_and_are_checked() {
    let entry = json!({
        "seq": 1,
        "timestamp": "2026-01-01T00:00:00.000Z",
        "command": "scope-echo",
        "input": {},
        "contextDigest": {"hash": "sha256:00"},
        "context": {"scope": {"project": "p-1"}},
        "contextOmitted": ["space"],
        "result": {"success": true, "data": null},
        "durationMs": 0,
    });
    let text = format!("{entry}\n");
    let entries = parse_journal(&text).unwrap();
    assert_eq!(entries[0].context_omitted, Some(vec!["space".to_string()]));
    assert_eq!(
        serde_json::from_str::<Value>(serialize_journal(&entries).trim()).unwrap(),
        entry
    );
    for (key, bad) in [
        ("context", json!([1])),
        ("context", json!("scope")),
        ("contextOmitted", json!("scope")),
        ("contextOmitted", json!([1])),
    ] {
        let mut value = entry.clone();
        value[key] = bad;
        assert!(!is_journal_entry(&value), "{key}");
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// REPLAY
// ═══════════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn replay_drops_a_field_the_target_no_longer_declares_with_a_note() {
    let entry = record(
        &registry(vec![scope(), locale()]),
        context().with_extra("scope", json!({"project": "p-1"})),
    )
    .await;

    let report = replay_journal(
        &registry(vec![]),
        std::slice::from_ref(&entry),
        ReplayJournalOptions::default(),
    )
    .await;
    assert_eq!(report.entries[0].status, ReplayStatus::Different);
    assert_eq!(
        report.entries[0].notes,
        ["context field 'scope' is no longer declared; replayed without it"]
    );

    let restored = replay_journal(
        &registry(vec![scope(), locale()]),
        &[entry],
        ReplayJournalOptions::default(),
    )
    .await;
    assert_eq!(restored.entries[0].status, ReplayStatus::Same);
    assert!(restored.entries[0].notes.is_empty());
}

#[tokio::test]
async fn a_restored_value_that_no_longer_validates_fails_the_call() {
    let mut entry = record(
        &registry(vec![scope()]),
        context().with_extra("scope", json!({"project": "p-1"})),
    )
    .await;
    entry.context = json!({"scope": {"project": 7}}).as_object().cloned();
    let report = replay_journal(
        &registry(vec![scope()]),
        &[entry],
        ReplayJournalOptions::default(),
    )
    .await;
    assert_eq!(report.entries[0].status, ReplayStatus::Different);
    let replayed = report.entries[0].replayed.as_ref().unwrap();
    assert_eq!(
        replayed.error.as_ref().unwrap().message,
        "Context field 'scope' is not valid"
    );
}

#[tokio::test]
async fn field_notes_come_before_tape_notes() {
    let mut entry = record(
        &registry(vec![scope()]),
        context().with_extra("scope", json!({"project": "é".repeat(2100)})),
    )
    .await;
    // One more clock reading than the replay will take.
    entry.tape.as_mut().unwrap().clock.push(0.0);
    let report = replay_journal(
        &registry(vec![scope()]),
        &[entry],
        ReplayJournalOptions::default(),
    )
    .await;
    assert_eq!(
        report.entries[0].notes,
        [
            "context field 'scope' was too large to journal; replayed without it",
            "clock: the replay read 1 of 2 recorded readings",
        ]
    );
}

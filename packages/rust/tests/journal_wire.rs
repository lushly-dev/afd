//! The golden journal fixture, `spec/wire/journal.jsonl` (see `spec/journal.md`).
//!
//! TypeScript recorded the fixture. These tests read it, write it back, record the same session
//! in Rust and replay the file against a fresh registry. Entries compare as JSON values: the
//! text differs only in object key order (`parse_journal` documents why).
//!
//! The last two calls carry declared context fields (`spec/context-fields.md`): `scope` is
//! journaled, `locale` is not, and the sixth call's `scope` is too large to keep.

use afd::context_fields::ContextField;
use afd::journal::{create_context_digest_with_fields, journal_context_fields};
use afd::{
    create_context_digest, fixed_clock, parse_journal, replay_journal, seeded_random,
    serialize_journal, success, Actor, ActorKind, CommandContext, CommandDefinition, CommandError,
    CommandHandler, CommandInterface, CommandMiddleware, CommandParameter, CommandRegistry,
    CommandResult, ExposeOptions, JournalEntry, JournalRecorder, ManualClock, MemoryJournalSink,
    ReplayJournalOptions, ReplayStatus, ResultMetadata,
};
use async_trait::async_trait;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

fn fixture_text() -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../spec/wire/journal.jsonl");
    std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("cannot read {}: {error}", path.display()))
}

fn lines_as_values(text: &str) -> Vec<Value> {
    text.lines()
        .map(|line| serde_json::from_str(line).expect("each line is JSON"))
        .collect()
}

// ═══════════════════════════════════════════════════════════════════════════════
// THE FIXTURE'S COMMANDS
// ═══════════════════════════════════════════════════════════════════════════════

type Todos = Arc<Mutex<BTreeMap<u64, Value>>>;

/// The todo commands of `packages/server/src/journal-wire.test.ts`, in insertion order.
struct TodoHandler {
    command: &'static str,
    todos: Todos,
}

#[async_trait]
impl CommandHandler for TodoHandler {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let mut todos = self.todos.lock().unwrap();
        match self.command {
            "todo-create" => {
                let title = input["title"].as_str().unwrap_or_default().to_string();
                let id = format!(
                    "todo-{:x}",
                    (context.random().next() * 65536.0).floor() as u64
                );
                let created_at = chrono::DateTime::from_timestamp_millis(context.clock().now())
                    .unwrap()
                    .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
                let todo = json!({"id": id, "title": title, "createdAt": created_at});
                let order = todos.len() as u64;
                todos.insert(order, todo.clone());
                let mut result = success(todo);
                result.reasoning = Some(format!("Created \"{title}\""));
                result.confidence = Some(1.0);
                result
            }
            "todo-scope" => {
                let project = context
                    .extra
                    .get("scope")
                    .and_then(|scope| scope.get("project"))
                    .cloned()
                    .unwrap_or(Value::Null);
                success(json!({"project": project}))
            }
            "todo-get" => {
                let id = input["id"].as_str().unwrap_or_default();
                match todos.values().find(|todo| todo["id"] == id) {
                    Some(todo) => success(todo.clone()),
                    None => afd::failure(
                        CommandError::new("NOT_FOUND", format!("Todo {id} not found"))
                            .with_suggestion("Use todo-list to see the todo ids"),
                    ),
                }
            }
            _ => {
                let items: Vec<Value> = todos.values().cloned().collect();
                success(json!({"items": items, "count": items.len()}))
            }
        }
    }
}

fn string_parameter(name: &str) -> CommandParameter {
    CommandParameter::required_string(name, name)
}

/// The TypeScript server's metadata: `executionTimeMs` from two clock readings around the
/// handler (they are on the tape), `commandVersion` and `traceId`.
fn server_metadata() -> CommandMiddleware {
    Arc::new(|_name, _input, context, next| {
        Box::pin(async move {
            let start = context.clock().now();
            let mut result = next().await;
            let elapsed = context.clock().now() - start;
            let metadata = result.metadata.get_or_insert_with(ResultMetadata::new);
            metadata.execution_time_ms = Some(elapsed as f64);
            metadata.command_version = Some("1.0.0".to_string());
            metadata.trace_id.clone_from(&context.trace_id);
            result
        })
    })
}

/// The fixture's declared context fields: `scope` is journaled, `locale` is not.
fn context_fields() -> Vec<ContextField> {
    vec![
        ContextField::new(
            "scope",
            "dev.example/scope",
            json!({
                "type": "object",
                "properties": {"project": {"type": "string"}},
                "required": ["project"],
            }),
        )
        .with_journal(true),
        ContextField::new("locale", "dev.example/locale", json!({"type": "string"})),
    ]
}

fn todo_registry() -> CommandRegistry {
    let registry = CommandRegistry::new();
    let todos = Todos::default();
    for (command, parameters) in [
        ("todo-create", vec![string_parameter("title")]),
        ("todo-get", vec![string_parameter("id")]),
        ("todo-list", vec![]),
        ("todo-scope", vec![]),
    ] {
        let definition = CommandDefinition::new(
            command,
            command,
            parameters,
            TodoHandler {
                command,
                todos: Arc::clone(&todos),
            },
        )
        .with_expose(ExposeOptions {
            mcp: true,
            ..ExposeOptions::default()
        });
        registry.register(definition).unwrap();
    }
    registry.add_middleware(server_metadata());
    registry.set_context_fields(context_fields()).unwrap();
    registry
}

/// One call of the fixture session: command, input, actor, trace ID and context field values.
type FixtureCall = (
    &'static str,
    Value,
    Actor,
    &'static str,
    Vec<(&'static str, Value)>,
);

/// The calls of the fixture session.
fn fixture_calls() -> Vec<FixtureCall> {
    let agent = Actor::new(ActorKind::Agent)
        .with_label("Claude")
        .with_on_behalf_of("user-1");
    let human = Actor::new(ActorKind::Human).with_id("user-1");
    vec![
        (
            "todo-create",
            json!({"title": "Buy milk"}),
            agent.clone(),
            "trace-1",
            vec![],
        ),
        (
            "todo-create",
            json!({"title": "Walk the dog"}),
            human,
            "trace-2",
            vec![],
        ),
        (
            "todo-get",
            json!({"id": "todo-missing"}),
            agent.clone(),
            "trace-3",
            vec![],
        ),
        ("todo-list", json!({}), agent.clone(), "trace-4", vec![]),
        // Declared fields: `scope` is kept in `context`, `locale` stays a key name only.
        (
            "todo-scope",
            json!({}),
            agent.clone(),
            "trace-5",
            vec![
                ("scope", json!({"project": "p-1"})),
                ("locale", json!("en-GB")),
            ],
        ),
        // Over 4096 bytes: `scope` is named in `contextOmitted`, its value left out.
        (
            "todo-list",
            json!({}),
            agent,
            "trace-6",
            vec![("scope", json!({"project": "x".repeat(5000)}))],
        ),
    ]
}

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn fixture_round_trips_through_parse_and_serialize() {
    let text = fixture_text();
    let entries = parse_journal(&text).expect("the fixture parses");
    assert_eq!(
        entries.iter().map(|entry| entry.seq).collect::<Vec<_>>(),
        [1, 2, 3, 4, 5, 6]
    );
    let written = serialize_journal(&entries);
    assert!(written.ends_with('\n'));
    assert_eq!(written.lines().count(), 6);
    assert_eq!(lines_as_values(&written), lines_as_values(&text));
    // Entry fields keep the order of spec/journal.md, as TypeScript writes them.
    for (line, entry) in written.lines().zip(&entries) {
        assert!(
            line.starts_with(&format!("{{\"seq\":{},\"timestamp\":", entry.seq)),
            "{line}"
        );
        assert!(line.contains("\"durationMs\":0,"), "{line}");
    }
    // `context` and `contextOmitted` sit between `contextDigest` and `result`.
    let lines: Vec<&str> = written.lines().collect();
    assert!(lines[4].contains("\"},\"context\":{\"scope\":{\"project\":\"p-1\"}},\"result\":"));
    assert!(lines[5].contains("\"},\"contextOmitted\":[\"scope\"],\"result\":"));
    for line in &lines[..4] {
        assert!(!line.contains("\"context\":") && !line.contains("contextOmitted"));
    }
    // A second round trip is stable byte for byte.
    assert_eq!(
        serialize_journal(&parse_journal(&written).unwrap()),
        written
    );
}

#[test]
fn fixture_fields_are_typed() {
    let entries = parse_journal(&fixture_text()).unwrap();
    let first = &entries[0];
    assert_eq!(first.trace_id.as_deref(), Some("trace-1"));
    assert_eq!(
        first.actor.as_ref().map(|actor| actor.kind),
        Some(ActorKind::Agent)
    );
    assert_eq!(first.context_digest.interface.as_deref(), Some("mcp"));
    let tape = first.tape.as_ref().expect("a tape");
    assert_eq!(tape.clock, [1_767_225_600_000.0; 3]);
    assert_eq!(tape.random, [0.734_576_779_650_524_3]);
    assert!(!tape.truncated);
    assert!(!entries[2].result.success);

    assert_eq!(
        entries[4].context,
        json!({"scope": {"project": "p-1"}}).as_object().cloned()
    );
    assert_eq!(entries[4].context_omitted, None);
    assert_eq!(entries[5].context, None);
    assert_eq!(entries[5].context_omitted, Some(vec!["scope".to_string()]));
}

#[test]
fn context_digest_matches_typescript_for_the_same_context() {
    // TypeScript's fixture contexts held only clock, random and the call's context fields
    // besides the allowlist, as a Rust context does after the registry fills its defaults.
    let entries = parse_journal(&fixture_text()).unwrap();
    for (entry, (.., fields)) in entries.into_iter().zip(fixture_calls()) {
        let mut context = CommandContext::new()
            .with_trace_id(entry.trace_id.clone().unwrap())
            .with_actor(entry.actor.clone().unwrap())
            .with_interface(CommandInterface::Mcp)
            .with_clock(fixed_clock(0))
            .with_random(seeded_random("x"));
        for (name, value) in fields {
            context.extra.insert(name.into(), value);
        }
        let journaled = journal_context_fields(&context, ["scope"]);
        assert_eq!(journaled.context, entry.context);
        assert_eq!(journaled.context_omitted, entry.context_omitted);
        assert_eq!(
            create_context_digest_with_fields(&context, &journaled),
            entry.context_digest
        );
        if journaled.context.is_none() && journaled.context_omitted.is_none() {
            // Without journaled fields the hash is the one it always was.
            assert_eq!(create_context_digest(&context), entry.context_digest);
        }
        context.extra.insert("authToken".into(), json!("secret"));
        assert_ne!(
            create_context_digest_with_fields(&context, &journaled).hash,
            entry.context_digest.hash
        );
    }
}

async fn record_fixture_session() -> Vec<JournalEntry> {
    let sink = Arc::new(MemoryJournalSink::new());
    let registry = todo_registry();
    registry.set_journal(JournalRecorder::new(sink.clone()).with_record_failures(true));
    let clock: ManualClock = fixed_clock(afd::ClockInstant::parse("2026-01-01T00:00:00Z").unwrap());
    let random = Arc::new(seeded_random("journal-fixture"));
    for (command, input, actor, trace_id, fields) in fixture_calls() {
        let mut context = CommandContext::new()
            .with_trace_id(trace_id)
            .with_actor(actor)
            .with_interface(CommandInterface::Mcp)
            .with_clock(clock.clone());
        context.random = Some(random.clone());
        for (name, value) in fields {
            context.extra.insert(name.into(), value);
        }
        registry.execute(command, input, Some(context)).await;
        clock.advance(1000);
    }
    sink.entries()
}

#[tokio::test]
async fn recording_the_fixture_session_reproduces_the_fixture() {
    let recorded = serialize_journal(&record_fixture_session().await);
    assert_eq!(lines_as_values(&recorded), lines_as_values(&fixture_text()));
}

#[tokio::test]
async fn the_fixture_replays_to_the_same_results() {
    let entries = parse_journal(&fixture_text()).unwrap();
    let registry = todo_registry();
    // A recorder on the replaying registry records nothing.
    let sink = Arc::new(MemoryJournalSink::new());
    registry.set_journal(JournalRecorder::new(sink.clone()).with_record_failures(true));

    let report = replay_journal(
        &registry,
        &entries,
        ReplayJournalOptions::default().with_ignore(Vec::<String>::new()),
    )
    .await;
    let summary: Vec<(u64, ReplayStatus, Vec<String>)> = report
        .entries
        .iter()
        .map(|entry| (entry.seq, entry.status, entry.notes.clone()))
        .collect();
    let mut expected: Vec<(u64, ReplayStatus, Vec<String>)> = (1..=6)
        .map(|seq| (seq, ReplayStatus::Same, Vec::new()))
        .collect();
    expected[5].2 =
        vec!["context field 'scope' was too large to journal; replayed without it".to_string()];
    assert_eq!(summary, expected);
    assert!(!report.diverged);
    assert_eq!(report.same, 6);
    // `todo-scope` returns the scope it sees: the journaled value was restored.
    assert_eq!(
        report.entries[4].replayed.as_ref().unwrap().data,
        Some(json!({"project": "p-1"}))
    );
    assert!(sink.entries().is_empty());
}

#[tokio::test]
async fn replay_reports_divergence_against_a_changed_registry() {
    let mut entries = parse_journal(&fixture_text()).unwrap();
    // Without the tape, todo-create draws from the seeded fallback and gets another id.
    entries[0].tape = None;
    let report = replay_journal(
        &todo_registry(),
        &entries,
        ReplayJournalOptions::default().with_stop_on_divergence(true),
    )
    .await;
    assert_eq!(report.entries.len(), 1);
    assert_eq!(report.entries[0].status, ReplayStatus::Different);
    assert_eq!(report.skipped, 5);
    let paths: Vec<&str> = report.entries[0]
        .differences
        .iter()
        .map(|difference| difference.path.as_str())
        .collect();
    assert_eq!(paths, ["data.id"]);
}

use super::*;
use crate::actor::ActorKind;
use crate::clock::{fixed_clock, seeded_random, RandomSource};
use crate::commands::{CommandDefinition, CommandHandler, CommandParameter, CommandRegistry};
use crate::errors::CommandError;
use crate::result::{failure, success};
use serde_json::json;
use std::sync::Arc;

/// `secret-ping` echoes its input and reads the clock once and the random source twice.
/// `secret-fail` fails, `secret-panic` panics, `auth-sign-in` returns a token.
struct Handler(&'static str);

#[async_trait]
impl CommandHandler for Handler {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        match self.0 {
            "fail" => failure(CommandError::new("NOT_FOUND", "nothing here")),
            "panic" => panic!("leaked detail"),
            "token" => success(json!({"token": "issued-token"})),
            "many" => {
                for _ in 0..5 {
                    context.random().next();
                }
                success(Value::Null)
            }
            "quiet" => success(json!({"ok": true})),
            _ => {
                let at = context.clock().now();
                let a = context.random().next();
                let b = context.random().next();
                success(json!({"input": input, "at": at, "sum": a + b}))
            }
        }
    }
}

fn registry() -> CommandRegistry {
    let registry = CommandRegistry::new();
    for (name, kind) in [
        ("secret-ping", "ping"),
        ("secret-fail", "fail"),
        ("secret-panic", "panic"),
        ("secret-many", "many"),
        ("secret-quiet", "quiet"),
        ("auth-sign-in", "token"),
    ] {
        registry
            .register(CommandDefinition::new(
                name,
                name,
                vec![CommandParameter::optional_string("note", "A note")],
                Handler(kind),
            ))
            .unwrap();
    }
    registry
}

/// Set a recorder on `registry`, configured by `configure`, that writes to the returned sink.
fn recorded(
    registry: &CommandRegistry,
    configure: impl FnOnce(JournalRecorder) -> JournalRecorder,
) -> Arc<MemoryJournalSink> {
    let sink = Arc::new(MemoryJournalSink::new());
    registry.set_journal(configure(JournalRecorder::new(sink.clone())));
    sink
}

fn context() -> CommandContext {
    CommandContext::new()
        .with_trace_id("trace-1")
        .with_clock(fixed_clock(1_767_225_600_000))
        .with_random(seeded_random("journal-test"))
}

fn plain() -> JournalRecorder {
    JournalRecorder::new(Arc::new(MemoryJournalSink::new()))
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECRETS
// ═══════════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn entries_never_hold_auth_or_session_values() {
    let registry = registry();
    let sink = recorded(&registry, |recorder| recorder);
    let mut context = context()
        .with_actor(
            Actor::new(ActorKind::Agent)
                .with_id("agent-7")
                .with_on_behalf_of("user-1"),
        )
        .with_extra("authToken", json!("Bearer sk-live-SECRET"))
        .with_extra(
            "session",
            json!({"cookie": "sid=COOKIE-SECRET", "userId": "u1"}),
        )
        .with_extra("headers", json!({"authorization": "Basic HEADER-SECRET"}));
    context.interface = None;
    let result = registry
        .execute("secret-ping", json!({"note": "hi"}), Some(context))
        .await;
    assert!(result.success);

    let entries = sink.entries();
    assert_eq!(entries.len(), 1);
    let line = serialize_journal_entry(&entries[0]);
    for secret in [
        "SECRET",
        "authToken",
        "cookie",
        "authorization",
        "userId",
        "Bearer",
    ] {
        assert!(!line.contains(secret), "{secret} leaked into {line}");
    }
    let entry = &entries[0];
    assert_eq!(entry.trace_id.as_deref(), Some("trace-1"));
    assert_eq!(
        entry.actor.as_ref().and_then(|a| a.id.as_deref()),
        Some("agent-7")
    );
    assert_eq!(entry.context_digest.interface, None);
    assert!(entry.context_digest.hash.starts_with("sha256:"));
    assert_eq!(entry.context_digest.hash.len(), "sha256:".len() + 64);
}

#[test]
fn the_digest_hashes_key_names_but_not_values() {
    let base = context().with_extra("authToken", json!("one"));
    let other_value = context().with_extra("authToken", json!("two"));
    let other_key = context().with_extra("apiKey", json!("one"));
    assert_eq!(
        create_context_digest(&base),
        create_context_digest(&other_value)
    );
    assert_ne!(
        create_context_digest(&base).hash,
        create_context_digest(&other_key).hash
    );
    assert_eq!(
        context_key_names(&base.with_timeout(5)),
        ["authToken", "clock", "random", "timeoutMs"]
    );
}

#[test]
fn journal_actor_keeps_only_the_four_actor_fields() {
    let actor = journal_actor(&json!({
        "kind": "agent",
        "id": "a1",
        "label": "Claude",
        "onBehalfOf": "u1",
        "email": "someone@example.com",
        "token": "secret",
    }))
    .unwrap();
    assert_eq!(
        serde_json::to_value(&actor).unwrap(),
        json!({"kind": "agent", "id": "a1", "label": "Claude", "onBehalfOf": "u1"})
    );
    assert_eq!(journal_actor(&json!({"kind": "robot"})), None);
    assert_eq!(journal_actor(&json!("agent")), None);
}

// ═══════════════════════════════════════════════════════════════════════════════
// JSON LINES
// ═══════════════════════════════════════════════════════════════════════════════

fn entry(seq: u64) -> JournalEntry {
    JournalEntry {
        seq,
        timestamp: "2026-01-01T00:00:00.000Z".to_string(),
        trace_id: None,
        command: "secret-ping".to_string(),
        input: json!({}),
        actor: None,
        context_digest: JournalContextDigest {
            hash: "sha256:00".to_string(),
            interface: None,
        },
        context: None,
        context_omitted: None,
        result: success(Value::Null),
        duration_ms: 1.5,
        tape: None,
    }
}

#[test]
fn optional_fields_are_omitted_and_numbers_match_javascript() {
    let mut value = entry(1);
    value.duration_ms = 2.0;
    value.tape = Some(JournalTape {
        clock: vec![5.0],
        random: vec![0.0, 0.5],
        truncated: false,
    });
    assert_eq!(
        serialize_journal_entry(&value),
        r#"{"seq":1,"timestamp":"2026-01-01T00:00:00.000Z","command":"secret-ping","input":{},"contextDigest":{"hash":"sha256:00"},"result":{"success":true,"data":null},"durationMs":2,"tape":{"clock":[5],"random":[0,0.5]}}"#
    );
}

#[test]
fn fractional_clock_readings_from_typescript_parse() {
    let mut value = serde_json::to_value(entry(1)).unwrap();
    value["tape"] = json!({"clock": [1000.5], "random": []});
    let parsed = parse_journal(&value.to_string()).unwrap();
    assert_eq!(parsed[0].tape.as_ref().unwrap().clock, [1000.5]);
}

#[test]
fn parse_skips_blank_lines_and_accepts_crlf() {
    let text = format!(
        "\n{}\r\n  \n{}",
        serialize_journal_entry(&entry(1)),
        serialize_journal_entry(&entry(3))
    );
    let entries = parse_journal(&text).unwrap();
    assert_eq!(entries, [entry(1), entry(3)]);
    assert_eq!(parse_journal("").unwrap(), []);
}

#[test]
fn parse_errors_name_the_line() {
    let good = serialize_journal_entry(&entry(1));
    let error = parse_journal(&format!("{good}\n{{oops\n")).unwrap_err();
    assert!(
        error.starts_with("Journal line 2 is not valid JSON"),
        "{error}"
    );
    let error = parse_journal(&format!("{good}\n\n{{\"seq\":2}}\n")).unwrap_err();
    assert_eq!(error, "Journal line 3 is not a journal entry");
}

#[test]
fn is_journal_entry_checks_the_shape() {
    let valid = serde_json::to_value(entry(1)).unwrap();
    assert!(is_journal_entry(&valid));
    for (key, bad) in [
        ("seq", json!(0)),
        ("seq", json!(1.5)),
        ("seq", json!(9_007_199_254_740_992_u64)),
        ("timestamp", json!(1)),
        ("actor", json!({"kind": "robot"})),
        ("result", json!({"data": 1})),
        ("durationMs", json!("1")),
        ("tape", json!({"clock": []})),
        ("contextDigest", json!({})),
    ] {
        let mut value = valid.clone();
        value[key] = bad;
        assert!(!is_journal_entry(&value), "{key}");
    }
    let mut missing_input = valid.clone();
    missing_input.as_object_mut().unwrap().remove("input");
    assert!(!is_journal_entry(&missing_input));
    let mut null_input = valid;
    null_input["input"] = Value::Null;
    assert!(is_journal_entry(&null_input));
}

// ═══════════════════════════════════════════════════════════════════════════════
// SINKS
// ═══════════════════════════════════════════════════════════════════════════════

fn record() -> JournalRecord {
    let entry = entry(1);
    JournalRecord {
        timestamp: entry.timestamp,
        trace_id: None,
        command: entry.command,
        input: entry.input,
        actor: None,
        context_digest: entry.context_digest,
        context: None,
        context_omitted: None,
        result: entry.result,
        duration_ms: entry.duration_ms,
        tape: None,
    }
}

#[tokio::test]
async fn memory_sink_continues_numbering_and_reads_ranges() {
    let sink = MemoryJournalSink::with_entries([entry(7), entry(4)]);
    assert_eq!(sink.append(record()).await.unwrap().seq, 8);
    let seqs = |entries: Vec<JournalEntry>| entries.iter().map(|e| e.seq).collect::<Vec<_>>();
    assert_eq!(
        seqs(sink.read(JournalRange::all()).await.unwrap()),
        [4, 7, 8]
    );
    assert_eq!(
        seqs(sink.read(JournalRange::between(5, 8)).await.unwrap()),
        [7, 8]
    );
    let from = JournalRange {
        from: Some(8),
        to: None,
    };
    assert_eq!(seqs(sink.read(from).await.unwrap()), [8]);
}

#[cfg(feature = "journal-file")]
mod file_sink {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn temp_path(name: &str) -> PathBuf {
        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir()
            .join(format!("afd-journal-{}-{n}", std::process::id()))
            .join(name)
    }

    #[tokio::test]
    async fn appends_lines_and_continues_after_reopening() {
        let path = temp_path("nested/journal.jsonl");
        let sink = FileJournalSink::new(&path);
        assert_eq!(sink.read(JournalRange::all()).await.unwrap(), []);
        assert_eq!(sink.append(record()).await.unwrap().seq, 1);
        assert_eq!(sink.append(record()).await.unwrap().seq, 2);

        let reopened = FileJournalSink::new(&path);
        assert_eq!(reopened.append(record()).await.unwrap().seq, 3);
        let text = std::fs::read_to_string(&path).unwrap();
        assert_eq!(text.lines().count(), 3);
        assert!(text.ends_with('\n'));
        let entries = parse_journal(&text).unwrap();
        assert_eq!(reopened.read(JournalRange::all()).await.unwrap(), entries);
        let _ = std::fs::remove_dir_all(path.parent().unwrap().parent().unwrap());
    }

    #[tokio::test]
    async fn a_torn_last_line_is_skipped_then_removed() {
        let path = temp_path("journal.jsonl");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let first = serialize_journal_entry(&entry(1));
        std::fs::write(&path, format!("{first}\n{{\"seq\":2,\"times")).unwrap();

        let sink = FileJournalSink::new(&path);
        assert_eq!(sink.read(JournalRange::all()).await.unwrap(), [entry(1)]);
        assert_eq!(sink.append(record()).await.unwrap().seq, 2);
        let text = std::fs::read_to_string(&path).unwrap();
        assert_eq!(parse_journal(&text).unwrap().len(), 2);
        assert!(!text.contains("\"times\n"));
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[tokio::test]
    async fn a_last_line_cut_inside_a_character_is_torn() {
        let path = temp_path("journal.jsonl");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut bytes = format!("{}\n", serialize_journal_entry(&entry(1))).into_bytes();
        let mut cafe = entry(2);
        cafe.input = json!({"title": "Café"});
        let line = serialize_journal_entry(&cafe);
        let cut = line.find('é').unwrap() + 1; // inside the two-byte é
        bytes.extend_from_slice(&line.as_bytes()[..cut]);
        std::fs::write(&path, bytes).unwrap();

        let sink = FileJournalSink::new(&path);
        assert_eq!(sink.read(JournalRange::all()).await.unwrap(), [entry(1)]);
        assert_eq!(sink.append(record()).await.unwrap().seq, 2);
        let text = std::fs::read_to_string(&path).unwrap();
        assert_eq!(parse_journal(&text).unwrap().len(), 2);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[tokio::test]
    async fn a_complete_last_line_without_newline_is_kept() {
        let path = temp_path("journal.jsonl");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, serialize_journal_entry(&entry(5))).unwrap();

        let sink = FileJournalSink::new(&path);
        assert_eq!(sink.append(record()).await.unwrap().seq, 6);
        let text = std::fs::read_to_string(&path).unwrap();
        assert_eq!(
            parse_journal(&text)
                .unwrap()
                .iter()
                .map(|e| e.seq)
                .collect::<Vec<_>>(),
            [5, 6]
        );
        assert_eq!(text.lines().count(), 2);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}

#[cfg(feature = "journal-file-shared")]
mod shared_sink {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    fn temp_dir() -> PathBuf {
        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!("afd-journal-shared-{}-{n}", std::process::id()))
    }

    fn sink_in(dir: &std::path::Path) -> FileJournalSink {
        FileJournalSink::shared(dir.join("state/journal.jsonl"), dir.join("state/lock"))
    }

    fn seqs_in(path: &std::path::Path) -> Vec<u64> {
        let text = std::fs::read_to_string(path).unwrap();
        parse_journal(&text)
            .unwrap()
            .iter()
            .map(|e| e.seq)
            .collect()
    }

    #[tokio::test]
    async fn creates_the_files_and_continues_after_reopening() {
        let dir = temp_dir();
        let sink = sink_in(&dir);
        assert_eq!(sink.read(JournalRange::all()).await.unwrap(), []);
        assert_eq!(sink.append(record()).await.unwrap().seq, 1);
        assert_eq!(sink.append(record()).await.unwrap().seq, 2);
        assert!(dir.join("state/lock").exists());

        assert_eq!(sink_in(&dir).append(record()).await.unwrap().seq, 3);
        let text = std::fs::read_to_string(dir.join("state/journal.jsonl")).unwrap();
        assert_eq!(text.lines().count(), 3);
        assert!(text.ends_with('\n'));
        // The lines are the ones a sink made with `new` writes and reads.
        let plain = FileJournalSink::new(dir.join("state/journal.jsonl"));
        assert_eq!(plain.append(record()).await.unwrap().seq, 4);
        assert_eq!(
            sink_in(&dir).read(JournalRange::all()).await.unwrap().len(),
            4
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn another_sinks_append_is_seen_without_a_cache() {
        let dir = temp_dir();
        let (a, b) = (sink_in(&dir), sink_in(&dir));
        assert_eq!(a.append(record()).await.unwrap().seq, 1);
        assert_eq!(b.append(record()).await.unwrap().seq, 2);
        assert_eq!(a.append(record()).await.unwrap().seq, 3);
        assert_eq!(seqs_in(&dir.join("state/journal.jsonl")), [1, 2, 3]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn a_torn_last_line_is_removed_by_the_next_append() {
        let dir = temp_dir();
        let path = dir.join("state/journal.jsonl");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let first = serialize_journal_entry(&entry(1));
        std::fs::write(&path, format!("{first}\n{{\"seq\":2,\"times")).unwrap();

        let sink = sink_in(&dir);
        assert_eq!(sink.read(JournalRange::all()).await.unwrap(), [entry(1)]);
        assert_eq!(sink.append(record()).await.unwrap().seq, 2);
        assert_eq!(seqs_in(&path), [1, 2]);
        assert!(!std::fs::read_to_string(&path)
            .unwrap()
            .contains("\"seq\":2,\"times\n"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn a_last_line_cut_inside_a_character_is_torn() {
        let dir = temp_dir();
        let path = dir.join("state/journal.jsonl");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut bytes = format!("{}\n", serialize_journal_entry(&entry(1))).into_bytes();
        let mut cafe = entry(2);
        cafe.input = json!({"title": "Café"});
        let line = serialize_journal_entry(&cafe);
        let cut = line.find('é').unwrap() + 1; // inside the two-byte é
        bytes.extend_from_slice(&line.as_bytes()[..cut]);
        std::fs::write(&path, bytes).unwrap();

        assert_eq!(sink_in(&dir).append(record()).await.unwrap().seq, 2);
        assert_eq!(seqs_in(&path), [1, 2]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn a_complete_last_line_without_newline_is_kept() {
        let dir = temp_dir();
        let path = dir.join("state/journal.jsonl");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, serialize_journal_entry(&entry(5))).unwrap();

        assert_eq!(sink_in(&dir).append(record()).await.unwrap().seq, 6);
        assert_eq!(seqs_in(&path), [5, 6]);
        assert_eq!(std::fs::read_to_string(&path).unwrap().lines().count(), 2);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn a_lone_torn_line_leaves_an_empty_journal() {
        let dir = temp_dir();
        let path = dir.join("state/journal.jsonl");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "{\"seq\":1,\"tim").unwrap();

        assert_eq!(sink_in(&dir).append(record()).await.unwrap().seq, 1);
        assert_eq!(seqs_in(&path), [1]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn a_long_last_line_is_found_across_chunks() {
        let dir = temp_dir();
        let path = dir.join("state/journal.jsonl");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut long = entry(7);
        long.input = json!({"text": "x".repeat(40_000)});
        std::fs::write(
            &path,
            format!(
                "{}\n{}\n",
                serialize_journal_entry(&entry(6)),
                serialize_journal_entry(&long)
            ),
        )
        .unwrap();

        assert_eq!(sink_in(&dir).append(record()).await.unwrap().seq, 8);
        assert_eq!(seqs_in(&path), [6, 7, 8]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_held_lock_times_out_and_a_sink_made_with_new_has_none() {
        let dir = temp_dir();
        let sink = sink_in(&dir).with_lock_timeout(Duration::from_millis(50));
        let held = sink.lock().unwrap();
        assert_eq!(held.path(), dir.join("state/lock"));
        match sink.lock() {
            Err(JournalLockError::Timeout { waited_ms }) => assert!(waited_ms >= 50),
            other => panic!("expected a timeout, got {other:?}"),
        }
        drop(held);
        assert!(sink.lock().is_ok());

        let plain = FileJournalSink::new(dir.join("plain.jsonl"));
        assert!(matches!(plain.lock(), Err(JournalLockError::Io(_))));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn append_fails_while_the_lock_is_held() {
        let dir = temp_dir();
        let sink = sink_in(&dir).with_lock_timeout(Duration::from_millis(30));
        let held = sink.lock().unwrap();
        let error = sink.append(record()).await.unwrap_err();
        assert!(error.contains("not acquired within"), "{error}");
        drop(held);
        assert_eq!(sink.append(record()).await.unwrap().seq, 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn append_locked_refuses_another_sinks_lock() {
        let (one, two) = (temp_dir(), temp_dir());
        let (a, b) = (sink_in(&one), sink_in(&two));
        let lock = b.lock().unwrap();
        let error = a.append_locked(&lock, record()).unwrap_err();
        assert!(
            error.contains(&*one.join("state/lock").to_string_lossy()),
            "{error}"
        );
        assert!(
            error.contains(&*two.join("state/lock").to_string_lossy()),
            "{error}"
        );
        assert!(!one.join("state/journal.jsonl").exists());
        let lock = a.lock().unwrap();
        assert_eq!(a.append_locked(&lock, record()).unwrap().seq, 1);
        assert_eq!(a.append_locked(&lock, record()).unwrap().seq, 2);
        let _ = std::fs::remove_dir_all(&one);
        let _ = std::fs::remove_dir_all(&two);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// RECORDER
// ═══════════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn records_successes_with_their_tape() {
    let registry = registry();
    let sink = recorded(&registry, |recorder| recorder);
    let result = registry
        .execute(
            "secret-ping",
            json!({"note": "hi", "dropped": 1}),
            Some(context()),
        )
        .await;
    let entries = sink.entries();
    assert_eq!(entries.len(), 1);
    let entry = &entries[0];
    assert_eq!(entry.seq, 1);
    assert_eq!(entry.timestamp, "2026-01-01T00:00:00.000Z");
    assert_eq!(entry.command, "secret-ping");
    // The validated input: undeclared keys are dropped.
    assert_eq!(entry.input, json!({"note": "hi"}));
    assert_eq!(entry.result, result);
    assert_eq!(entry.duration_ms, 0.0);
    let tape = entry.tape.as_ref().unwrap();
    assert_eq!(tape.clock, [1_767_225_600_000.0]);
    let random = seeded_random("journal-test");
    assert_eq!(tape.random, [random.next(), random.next()]);
}

#[tokio::test]
async fn a_call_that_reads_nothing_has_no_tape() {
    let registry = registry();
    let sink = recorded(&registry, |recorder| recorder);
    registry
        .execute("secret-quiet", json!({}), Some(context()))
        .await;
    assert_eq!(sink.entries()[0].tape, None);
}

#[tokio::test]
async fn failures_are_recorded_only_when_asked() {
    let registry = registry();
    let sink = recorded(&registry, |recorder| recorder);
    registry.execute("secret-fail", json!({}), None).await;
    registry.execute("secret-panic", json!({}), None).await;
    // Rejected before the recorder: never recorded.
    registry
        .execute("secret-ping", json!({"note": 5}), None)
        .await;
    registry.execute("secret-missing", json!({}), None).await;
    assert!(sink.entries().is_empty());

    let sink = recorded(&registry, |recorder| recorder.with_record_failures(true));
    registry.execute("secret-fail", json!({}), None).await;
    let panicked = registry.execute("secret-panic", json!({}), None).await;
    registry
        .execute("secret-ping", json!({"note": 5}), None)
        .await;
    let entries = sink.entries();
    assert_eq!(entries.len(), 2);
    assert_eq!(
        entries[0].result.error.as_ref().map(|e| e.code.as_str()),
        Some("NOT_FOUND")
    );
    assert_eq!(entries[1].result, panicked);
    assert_eq!(
        entries[1].result.error.as_ref().map(|e| e.code.as_str()),
        Some("COMMAND_EXECUTION_ERROR")
    );
    assert!(!serialize_journal_entry(&entries[1]).contains("leaked detail"));
}

#[tokio::test]
async fn auth_commands_are_skipped_unless_the_filter_allows_them() {
    let registry = registry();
    let sink = recorded(&registry, |recorder| recorder);
    registry.execute("auth-sign-in", json!({}), None).await;
    assert!(sink.entries().is_empty());

    let sink = recorded(&registry, |recorder| {
        recorder.with_filter(|name| name == "auth-sign-in")
    });
    registry.execute("auth-sign-in", json!({}), None).await;
    registry.execute("secret-quiet", json!({}), None).await;
    let entries = sink.entries();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].command, "auth-sign-in");
}

#[tokio::test]
async fn redact_changes_or_drops_records() {
    let registry = registry();
    let sink = recorded(&registry, |recorder| {
        recorder.with_filter(|_| true).with_redact(|mut record| {
            if record.command == "secret-quiet" {
                return None;
            }
            record.result.data = Some(json!({"token": "[redacted]"}));
            record.tape = None;
            Some(record)
        })
    });
    let result = registry.execute("auth-sign-in", json!({}), None).await;
    registry.execute("secret-quiet", json!({}), None).await;
    // The caller still gets the real result.
    assert_eq!(result.data, Some(json!({"token": "issued-token"})));
    let entries = sink.entries();
    assert_eq!(entries.len(), 1);
    assert!(!serialize_journal_entry(&entries[0]).contains("issued-token"));
}

#[tokio::test]
async fn long_tapes_are_truncated() {
    let registry = registry();
    let sink = recorded(&registry, |recorder| recorder.with_max_tape_reads(3));
    registry
        .execute("secret-many", json!({}), Some(context()))
        .await;
    let tape = sink.entries()[0].tape.clone().unwrap();
    assert_eq!(tape.random.len(), 3);
    assert!(tape.truncated);
}

struct FailingSink;

#[async_trait]
impl JournalSink for FailingSink {
    async fn append(&self, _record: JournalRecord) -> Result<JournalEntry, String> {
        Err("disk full".to_string())
    }

    async fn read(&self, _range: JournalRange) -> Result<Vec<JournalEntry>, String> {
        Ok(Vec::new())
    }
}

#[tokio::test]
async fn sink_errors_go_to_on_error_and_leave_the_result_alone() {
    let registry = registry();
    let errors = Arc::new(Mutex::new(Vec::<String>::new()));
    let seen = Arc::clone(&errors);
    registry.set_journal(
        JournalRecorder::new(Arc::new(FailingSink))
            .with_on_error(move |message| seen.lock().unwrap().push(message.to_string())),
    );
    let result = registry.execute("secret-quiet", json!({}), None).await;
    assert!(result.success);
    assert_eq!(*errors.lock().unwrap(), ["disk full"]);

    // A panicking redact is reported too.
    let seen = Arc::clone(&errors);
    registry.set_journal(
        plain()
            .with_redact(|_| panic!("redact bug"))
            .with_on_error(move |message| seen.lock().unwrap().push(message.to_string())),
    );
    assert!(
        registry
            .execute("secret-quiet", json!({}), None)
            .await
            .success
    );
    assert_eq!(errors.lock().unwrap().len(), 2);

    registry.clear_journal();
    assert!(
        registry
            .execute("secret-quiet", json!({}), None)
            .await
            .success
    );
    assert_eq!(errors.lock().unwrap().len(), 2);
}

#[cfg(feature = "native")]
#[tokio::test]
async fn a_call_that_times_out_is_not_recorded() {
    struct Slow;

    #[async_trait]
    impl CommandHandler for Slow {
        async fn execute(&self, _input: Value, _context: CommandContext) -> CommandResult<Value> {
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            success(Value::Null)
        }
    }

    let registry = CommandRegistry::new();
    registry
        .register(CommandDefinition::new("slow-call", "Slow", vec![], Slow))
        .unwrap();
    let sink = recorded(&registry, |recorder| recorder.with_record_failures(true));
    let result = registry
        .execute(
            "slow-call",
            json!({}),
            Some(CommandContext::new().with_timeout(10)),
        )
        .await;
    assert_eq!(result.error.map(|e| e.code), Some("TIMEOUT".to_string()));
    assert!(sink.entries().is_empty());
}

#[tokio::test]
async fn a_replacement_replay_context_is_still_a_replay() {
    let registry = registry();
    let sink = recorded(&registry, |recorder| recorder);
    registry
        .execute("secret-quiet", json!({}), Some(context()))
        .await;
    let entries = sink.entries();
    let report = replay_journal(
        &registry,
        &entries,
        ReplayJournalOptions::default().with_context(|_, _| CommandContext::new()),
    )
    .await;
    assert_eq!(report.same, 1);
    assert_eq!(sink.entries().len(), 1, "the replay was recorded");

    let report = replay_journal(
        &registry,
        &[entries[0].clone(), entries[0].clone()],
        ReplayJournalOptions::default().with_context(|_, _| panic!("factory bug")),
    )
    .await;
    assert_eq!(report.errors, 2);
    assert_eq!(
        report.entries[0].error.as_deref(),
        Some("The replay context function panicked")
    );
}

#[tokio::test]
async fn a_panicking_filter_records_nothing() {
    let registry = registry();
    let errors = Arc::new(Mutex::new(0));
    let seen = Arc::clone(&errors);
    let sink = recorded(&registry, |recorder| {
        recorder
            .with_filter(|_| panic!("filter bug"))
            .with_on_error(move |_| *seen.lock().unwrap() += 1)
    });
    assert!(
        registry
            .execute("secret-quiet", json!({}), None)
            .await
            .success
    );
    assert!(sink.entries().is_empty());
    assert_eq!(*errors.lock().unwrap(), 1);
}

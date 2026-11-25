use super::*;
use crate::cancellation::CancellationSignal;
use crate::clock::{fixed_clock, seeded_random, ManualClock};
use crate::commands::{CommandDefinition, CommandHandler, CommandRegistry};
use crate::result::success;
use crate::telemetry::TelemetryEvent;
use async_trait::async_trait;
use serde_json::json;
use std::sync::atomic::{AtomicUsize, Ordering};

/// Echoes the trace ID it sees; fails with `code` for its first `failures` calls.
struct Echo {
    calls: Arc<AtomicUsize>,
    failures: usize,
    code: &'static str,
}

#[async_trait]
impl CommandHandler for Echo {
    async fn execute(&self, _input: Value, context: CommandContext) -> CommandResult<Value> {
        let call = self.calls.fetch_add(1, Ordering::SeqCst);
        if call < self.failures {
            return failure(CommandError::new(self.code, "Not yet").with_suggestion("Retry"));
        }
        success(json!({ "traceId": context.trace_id }))
    }
}

fn registry_with(failures: usize, code: &'static str) -> (CommandRegistry, Arc<AtomicUsize>) {
    let calls = Arc::new(AtomicUsize::new(0));
    let registry = CommandRegistry::new();
    let echo = Echo {
        calls: Arc::clone(&calls),
        failures,
        code,
    };
    registry
        .register(CommandDefinition::new("echo-run", "Echo", vec![], echo))
        .unwrap();
    (registry, calls)
}

fn lines() -> (Arc<Mutex<Vec<String>>>, LogFn) {
    let lines: Arc<Mutex<Vec<String>>> = Arc::default();
    let sink = Arc::clone(&lines);
    let log: LogFn = Arc::new(move |line: &str, data: Option<&Value>| {
        let line = match data {
            Some(data) => format!("{line} {data}"),
            None => line.to_string(),
        };
        sink.lock().unwrap().push(line);
    });
    (lines, log)
}

// ─── Trace ID ────────────────────────────────────────────────────────────────────

#[test]
fn random_uuid_is_a_version_4_uuid() {
    let random = seeded_random("uuid");
    let uuid = random_uuid(&random);
    assert_eq!(uuid.len(), 36);
    let parts: Vec<&str> = uuid.split('-').collect();
    assert_eq!(
        parts.iter().map(|part| part.len()).collect::<Vec<_>>(),
        [8, 4, 4, 4, 12]
    );
    assert!(parts[2].starts_with('4'), "{uuid}");
    assert!(matches!(&parts[3][..1], "8" | "9" | "a" | "b"), "{uuid}");
    assert!(uuid.chars().all(|c| c == '-' || c.is_ascii_hexdigit()));
    assert_ne!(uuid, random_uuid(&random));
}

#[tokio::test]
async fn the_trace_id_middleware_gives_the_handler_a_trace_id() {
    let (registry, _) = registry_with(0, "");
    let options = TraceIdOptions {
        random: Some(Arc::new(seeded_random("trace"))),
        ..TraceIdOptions::default()
    };
    registry.add_middleware(create_auto_trace_id_middleware(options));

    let result = registry.execute("echo-run", json!({}), None).await;
    let expected = random_uuid(&seeded_random("trace"));
    assert_eq!(result.data.unwrap()["traceId"], expected);
}

#[tokio::test]
async fn the_trace_id_middleware_keeps_the_callers_trace_id() {
    let (registry, _) = registry_with(0, "");
    let options = TraceIdOptions {
        generate: Some(Arc::new(|| "generated".to_string())),
        ..TraceIdOptions::default()
    };
    registry.add_middleware(create_auto_trace_id_middleware(options));

    let context = CommandContext::new().with_trace_id("caller");
    let result = registry.execute("echo-run", json!({}), Some(context)).await;
    assert_eq!(result.data.unwrap()["traceId"], "caller");
    let result = registry.execute("echo-run", json!({}), None).await;
    assert_eq!(result.data.unwrap()["traceId"], "generated");
}

// ─── Logging and timing ──────────────────────────────────────────────────────────

#[tokio::test]
async fn logging_names_the_trace_the_command_and_the_outcome() {
    let (registry, _) = registry_with(1, "NOT_FOUND");
    let (lines, log) = lines();
    let clock = Arc::new(fixed_clock(1_000));
    registry.add_middleware(create_logging_middleware(LoggingOptions {
        log: Some(log),
        log_input: true,
        clock: Some(clock),
        ..LoggingOptions::default()
    }));

    let context = CommandContext::new().with_trace_id("t-1");
    registry.execute("echo-run", json!({}), Some(context)).await;
    registry.execute("echo-run", json!({}), None).await;
    assert_eq!(
        *lines.lock().unwrap(),
        [
            r#"[t-1] Executing: echo-run {"input":{}}"#,
            "[t-1] Completed: echo-run (0ms) - FAILURE",
            r#"[no-trace] Executing: echo-run {"input":{}}"#,
            "[no-trace] Completed: echo-run (0ms) - SUCCESS",
        ]
    );
}

/// Steps forward by `step` milliseconds at every reading.
struct Stepping(Mutex<i64>, i64);

impl Clock for Stepping {
    fn now(&self) -> i64 {
        let mut at = self.0.lock().unwrap();
        *at += self.1;
        *at
    }
}

#[tokio::test]
async fn timing_reports_only_a_command_slower_than_the_threshold() {
    let slow: Arc<Mutex<Vec<(String, i64)>>> = Arc::default();
    for (step, reported) in [(1500, true), (1000, false)] {
        slow.lock().unwrap().clear();
        let (registry, _) = registry_with(0, "");
        let sink = Arc::clone(&slow);
        registry.add_middleware(create_timing_middleware(TimingOptions {
            on_slow: Some(Arc::new(move |name: &str, ms: i64| {
                sink.lock().unwrap().push((name.to_string(), ms));
            })),
            clock: Some(Arc::new(Stepping(Mutex::new(0), step))),
            ..TimingOptions::default()
        }));
        registry.execute("echo-run", json!({}), None).await;
        let expected = if reported {
            vec![("echo-run".to_string(), step)]
        } else {
            vec![]
        };
        assert_eq!(*slow.lock().unwrap(), expected, "step {step}");
    }
}

#[tokio::test]
async fn the_default_bundle_is_trace_id_then_logging_then_timing() {
    assert_eq!(
        default_middleware(DefaultMiddlewareOptions::default()).len(),
        3
    );
    let only_logging = DefaultMiddlewareOptions {
        trace_id: None,
        timing: None,
        ..DefaultMiddlewareOptions::default()
    };
    assert_eq!(default_middleware(only_logging).len(), 1);

    // Logging, second in the bundle, sees the trace ID the first one made.
    let (registry, _) = registry_with(0, "");
    let (lines, log) = lines();
    let options = DefaultMiddlewareOptions {
        trace_id: Some(TraceIdOptions {
            generate: Some(Arc::new(|| "made".to_string())),
            ..TraceIdOptions::default()
        }),
        logging: Some(LoggingOptions {
            log: Some(log),
            ..LoggingOptions::default()
        }),
        timing: None,
    };
    for middleware in default_middleware(options) {
        registry.add_middleware(middleware);
    }
    let result = registry.execute("echo-run", json!({}), None).await;
    assert_eq!(result.data.unwrap()["traceId"], "made");
    assert_eq!(lines.lock().unwrap()[0], "[made] Executing: echo-run");
}

// ─── Retry ───────────────────────────────────────────────────────────────────────

fn recorded_sleep() -> (Arc<Mutex<Vec<u64>>>, SleepFn) {
    let waits: Arc<Mutex<Vec<u64>>> = Arc::default();
    let sink = Arc::clone(&waits);
    let sleep: SleepFn = Arc::new(move |ms| {
        sink.lock().unwrap().push(ms);
        Box::pin(std::future::ready(()))
    });
    (waits, sleep)
}

#[tokio::test]
async fn retry_backs_off_exponentially_up_to_the_cap() {
    let (registry, calls) = registry_with(10, "TRANSIENT_ERROR");
    let (waits, sleep) = recorded_sleep();
    registry.add_middleware(
        create_retry_middleware(RetryOptions {
            max_retries: 4,
            max_delay_ms: 300,
            jitter: false,
            sleep: Some(sleep),
            ..RetryOptions::default()
        })
        .unwrap(),
    );

    let result = registry.execute("echo-run", json!({}), None).await;
    assert!(!result.success);
    assert_eq!(
        calls.load(Ordering::SeqCst),
        5,
        "the first attempt and 4 retries"
    );
    assert_eq!(*waits.lock().unwrap(), [100, 200, 300, 300]);
}

#[tokio::test]
async fn retry_stops_at_the_first_success_and_skips_other_codes() {
    let (registry, calls) = registry_with(2, "TIMEOUT");
    let (_, sleep) = recorded_sleep();
    let retry = RetryOptions {
        sleep: Some(sleep),
        ..RetryOptions::default()
    };
    registry.add_middleware(create_retry_middleware(retry.clone()).unwrap());
    assert!(registry.execute("echo-run", json!({}), None).await.success);
    assert_eq!(calls.load(Ordering::SeqCst), 3);

    let (registry, calls) = registry_with(1, "NOT_FOUND");
    registry.add_middleware(create_retry_middleware(retry).unwrap());
    let result = registry.execute("echo-run", json!({}), None).await;
    assert_eq!(result.error.unwrap().code, "NOT_FOUND");
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn retry_jitter_waits_between_half_and_all_of_the_backoff() {
    let (registry, _) = registry_with(10, "TRANSIENT_ERROR");
    let (waits, sleep) = recorded_sleep();
    registry.add_middleware(
        create_retry_middleware(RetryOptions {
            sleep: Some(sleep),
            random: Some(Arc::new(seeded_random("jitter"))),
            ..RetryOptions::default()
        })
        .unwrap(),
    );
    registry.execute("echo-run", json!({}), None).await;
    let waits = waits.lock().unwrap();
    for (wait, backoff) in waits.iter().zip([100, 200, 400]) {
        assert!(
            (backoff / 2..=backoff).contains(wait),
            "{wait} of {backoff}"
        );
    }
    assert_eq!(waits.len(), 3);
}

#[tokio::test]
async fn retry_stops_waiting_when_the_call_is_cancelled() {
    let (registry, calls) = registry_with(10, "TRANSIENT_ERROR");
    let signal = CancellationSignal::new();
    let fired = signal.clone();
    // The wait never ends on its own; firing the signal ends it.
    let sleep: SleepFn = Arc::new(move |_| {
        fired.cancel();
        Box::pin(std::future::pending())
    });
    registry.add_middleware(
        create_retry_middleware(RetryOptions {
            sleep: Some(sleep),
            ..RetryOptions::default()
        })
        .unwrap(),
    );
    let context = CommandContext::new().with_cancellation(signal);
    let result = registry.execute("echo-run", json!({}), Some(context)).await;
    assert_eq!(result.error.unwrap().code, "TRANSIENT_ERROR");
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

// ─── Rate limit ──────────────────────────────────────────────────────────────────

fn limited(clock: Arc<ManualClock>, key_fn: Option<KeyFn>, max_keys: usize) -> CommandRegistry {
    let (registry, _) = registry_with(0, "");
    registry.add_middleware(
        create_rate_limit_middleware(RateLimitOptions {
            max_requests: 2,
            window_ms: 1_500,
            max_keys,
            key_fn,
            clock: Some(clock),
        })
        .unwrap(),
    );
    registry
}

#[tokio::test]
async fn rate_limit_refuses_past_the_budget_until_the_window_ends() {
    let clock = Arc::new(fixed_clock(10_000));
    let registry = limited(Arc::clone(&clock), None, 10);
    for _ in 0..2 {
        assert!(registry.execute("echo-run", json!({}), None).await.success);
    }
    clock.advance(400);
    let refused = registry.execute("echo-run", json!({}), None).await;
    let error = refused.error.unwrap();
    assert_eq!(error.code, error_codes::RATE_LIMITED);
    assert_eq!(error.retryable, Some(true));
    assert_eq!(error.suggestion.as_deref(), Some("Try again in 2 seconds"));
    // The same whole number of seconds as the suggestion (`spec/recovery.md`, "Engine errors").
    assert_eq!(
        serde_json::to_value(&error.recovery).unwrap(),
        json!({ "kind": "retry", "afterMs": 2000 })
    );

    clock.advance(1_100);
    assert!(registry.execute("echo-run", json!({}), None).await.success);
}

#[tokio::test]
async fn rate_limit_keeps_a_budget_per_key_and_at_most_max_keys() {
    let clock = Arc::new(fixed_clock(0));
    let key_fn: KeyFn =
        Arc::new(|context: &CommandContext| context.trace_id.clone().unwrap_or_default());
    let registry = limited(Arc::clone(&clock), Some(key_fn), 2);
    let call = |key: &str| {
        let context = CommandContext::new().with_trace_id(key);
        registry.execute("echo-run", json!({}), Some(context))
    };
    assert!(call("a").await.success);
    assert!(call("b").await.success);
    let full = call("c").await.error.unwrap();
    assert_eq!(full.message, "Rate limit client capacity reached");
    assert_eq!(full.retryable, Some(true));
    assert_eq!(
        serde_json::to_value(&full.recovery).unwrap(),
        json!({ "kind": "retry" })
    );
    assert!(call("a").await.success, "a has its own budget");

    // Once the windows end, their keys are dropped and a new key fits.
    clock.advance(1_500);
    assert!(call("c").await.success);
}

#[test]
fn rate_limit_refuses_a_window_or_key_count_that_is_not_positive() {
    for options in [
        RateLimitOptions {
            window_ms: 0,
            ..RateLimitOptions::default()
        },
        RateLimitOptions {
            max_keys: 0,
            ..RateLimitOptions::default()
        },
    ] {
        assert!(create_rate_limit_middleware(options).is_err());
    }
}

// ─── Telemetry ───────────────────────────────────────────────────────────────────

#[derive(Default)]
struct Events(Mutex<Vec<TelemetryEvent>>);

impl TelemetrySink for Events {
    fn record(&self, event: &TelemetryEvent) {
        self.0.lock().unwrap().push(event.clone());
    }
}

struct Panics;

impl TelemetrySink for Panics {
    fn record(&self, _event: &TelemetryEvent) {
        panic!("sink bug");
    }
}

#[tokio::test]
async fn telemetry_records_each_call_from_the_contexts_clock() {
    let (registry, _) = registry_with(1, "NOT_FOUND");
    let events = Arc::new(Events::default());
    registry.add_middleware(create_telemetry_middleware(TelemetryOptions {
        include_input: true,
        filter: Some(Arc::new(|name: &str| name == "echo-run")),
        ..TelemetryOptions::new(events.clone())
    }));
    let context = || {
        CommandContext::new()
            .with_trace_id("t-9")
            .with_clock(fixed_clock(1_767_225_600_000))
    };
    registry
        .execute("echo-run", json!({}), Some(context()))
        .await;
    registry
        .execute("echo-run", json!({}), Some(context()))
        .await;

    let events = events.0.lock().unwrap();
    assert_eq!(events.len(), 2);
    let failed = &events[0];
    assert_eq!(failed.command_name, "echo-run");
    assert_eq!(failed.started_at, "2026-01-01T00:00:00.000Z");
    assert_eq!(failed.duration_ms, 0);
    assert!(!failed.success);
    assert_eq!(failed.error.as_ref().unwrap().code, "NOT_FOUND");
    assert_eq!(failed.trace_id.as_deref(), Some("t-9"));
    assert_eq!(failed.input, Some(json!({})));
    assert!(events[1].success);
    assert!(events[1].error.is_none());
}

#[tokio::test]
async fn telemetry_skips_filtered_commands_and_survives_a_panicking_sink() {
    let (registry, _) = registry_with(0, "");
    let events = Arc::new(Events::default());
    registry.add_middleware(create_telemetry_middleware(TelemetryOptions {
        filter: Some(Arc::new(|_: &str| false)),
        ..TelemetryOptions::new(events.clone())
    }));
    registry.add_middleware(create_telemetry_middleware(TelemetryOptions::new(
        Arc::new(Panics),
    )));
    assert!(registry.execute("echo-run", json!({}), None).await.success);
    assert!(events.0.lock().unwrap().is_empty());
}

// ─── Composition ─────────────────────────────────────────────────────────────────

fn tagging(tag: &'static str, log: Arc<Mutex<Vec<String>>>) -> CommandMiddleware {
    Arc::new(move |_name, _input, context, next| {
        let log = Arc::clone(&log);
        Box::pin(async move {
            log.lock().unwrap().push(format!("{tag}:before"));
            let result = next(context).await;
            log.lock().unwrap().push(format!("{tag}:after"));
            result
        })
    })
}

#[tokio::test]
async fn composition_runs_in_order_like_adding_each() {
    let (registry, _) = registry_with(0, "");
    let log: Arc<Mutex<Vec<String>>> = Arc::default();
    registry.add_middleware(compose_middleware(vec![
        tagging("a", Arc::clone(&log)),
        tagging("b", Arc::clone(&log)),
    ]));
    registry.add_middleware(tagging("c", Arc::clone(&log)));
    assert!(registry.execute("echo-run", json!({}), None).await.success);
    assert_eq!(
        *log.lock().unwrap(),
        ["a:before", "b:before", "c:before", "c:after", "b:after", "a:after"]
    );
}

#[tokio::test]
async fn a_composed_layer_cannot_strip_the_call_state_from_the_next() {
    let (registry, _) = registry_with(0, "");
    let seen = Arc::new(Mutex::new(None));
    let inner = Arc::clone(&seen);
    let replace: CommandMiddleware =
        Arc::new(|_name, _input, _context, next| next(CommandContext::new()));
    let probe: CommandMiddleware = Arc::new(move |_name, _input, context, next| {
        *inner.lock().unwrap() = Some(context.interface);
        next(context)
    });
    registry.add_middleware(compose_middleware(vec![replace, probe]));
    let context = CommandContext::new().with_interface(crate::CommandInterface::Agent);
    assert!(
        registry
            .execute("echo-run", json!({}), Some(context))
            .await
            .success
    );
    assert_eq!(
        *seen.lock().unwrap(),
        Some(Some(crate::CommandInterface::Agent))
    );
}

// ─── Panics, the journal's tape and the remaining fields ─────────────────────────

/// Panics, or reads the context's clock once and its random source once.
struct Reads {
    panics: bool,
}

#[async_trait]
impl CommandHandler for Reads {
    async fn execute(&self, _input: Value, context: CommandContext) -> CommandResult<Value> {
        if self.panics {
            panic!("handler bug");
        }
        let at = context.clock().now();
        let roll = context.random().next();
        let mut result = success(json!({ "at": at, "roll": roll }));
        let metadata = crate::ResultMetadata::new().with_command_version("2.1.0");
        result.metadata = Some(metadata);
        result.confidence = Some(0.75);
        result
    }
}

fn reads_registry(panics: bool) -> CommandRegistry {
    let registry = CommandRegistry::new();
    registry
        .register(CommandDefinition::new(
            "reads-run",
            "Reads",
            vec![],
            Reads { panics },
        ))
        .unwrap();
    registry
}

#[tokio::test]
async fn logging_and_telemetry_see_a_command_that_panics() {
    let registry = reads_registry(true);
    let (lines, log) = lines();
    let events = Arc::new(Events::default());
    registry.add_middleware(create_logging_middleware(LoggingOptions {
        log: Some(log),
        clock: Some(Arc::new(fixed_clock(0))),
        ..LoggingOptions::default()
    }));
    registry.add_middleware(create_telemetry_middleware(TelemetryOptions::new(
        events.clone(),
    )));
    let context = CommandContext::new().with_trace_id("t-p");
    let result = registry
        .execute("reads-run", json!({}), Some(context))
        .await;
    assert_eq!(
        result.error.unwrap().code,
        error_codes::COMMAND_EXECUTION_ERROR
    );
    assert_eq!(
        *lines.lock().unwrap(),
        ["[t-p] Executing: reads-run", "[t-p] Error: reads-run (0ms)"]
    );
    let events = events.0.lock().unwrap();
    assert_eq!(events.len(), 1);
    assert!(!events[0].success);
    assert_eq!(events[0].error.as_ref().unwrap().code, "UNHANDLED_ERROR");
}

/// Every built-in middleware that reads a clock or a random source, on a journaled registry.
fn with_every_middleware(registry: &CommandRegistry, events: Arc<Events>) {
    for middleware in default_middleware(DefaultMiddlewareOptions {
        logging: Some(LoggingOptions {
            log: Some(Arc::new(|_: &str, _: Option<&Value>| {})),
            ..LoggingOptions::default()
        }),
        timing: Some(TimingOptions {
            on_slow: Some(Arc::new(|_: &str, _: i64| {})),
            ..TimingOptions::default()
        }),
        ..DefaultMiddlewareOptions::default()
    }) {
        registry.add_middleware(middleware);
    }
    registry.add_middleware(create_rate_limit_middleware(RateLimitOptions::default()).unwrap());
    registry.add_middleware(create_telemetry_middleware(TelemetryOptions::new(events)));
}

#[tokio::test]
async fn the_built_in_middleware_leave_the_journals_tape_as_the_command_read_it() {
    let context = || {
        CommandContext::new()
            .with_clock(fixed_clock(1_767_225_600_000))
            .with_random(seeded_random("tape"))
    };
    let mut tapes = Vec::new();
    for middleware in [false, true] {
        let registry = reads_registry(false);
        let sink = Arc::new(crate::journal::MemoryJournalSink::new());
        registry.set_journal(crate::journal::JournalRecorder::new(sink.clone()));
        if middleware {
            with_every_middleware(&registry, Arc::new(Events::default()));
        }
        assert!(
            registry
                .execute("reads-run", json!({}), Some(context()))
                .await
                .success
        );
        tapes.push(sink.entries()[0].tape.clone().expect("a tape"));
    }
    assert_eq!(
        tapes[0].clock,
        [1_767_225_600_000.0],
        "one read by the command"
    );
    assert_eq!(tapes[0].random.len(), 1, "one read by the command");
    assert_eq!(tapes[0], tapes[1]);
}

#[tokio::test]
async fn a_journal_recorded_without_middleware_replays_with_them() {
    let recorded = reads_registry(false);
    let sink = Arc::new(crate::journal::MemoryJournalSink::new());
    recorded.set_journal(crate::journal::JournalRecorder::new(sink.clone()));
    // A clock that moves, so the handler's reading on the tape differs from the call's start.
    let context = CommandContext::new()
        .with_clock(Stepping(Mutex::new(1_767_225_600_000), 7))
        .with_random(seeded_random("replay"));
    recorded
        .execute("reads-run", json!({}), Some(context))
        .await;

    let replaying = reads_registry(false);
    let events = Arc::new(Events::default());
    with_every_middleware(&replaying, events.clone());
    let report = crate::journal::replay_journal(
        &replaying,
        &sink.entries(),
        crate::journal::ReplayJournalOptions::default(),
    )
    .await;
    assert!(!report.diverged, "{report:?}");
    assert_eq!(report.same, 1);
    // The handler read the tape's one reading, and nothing else read it.
    assert!(
        report.entries[0].notes.is_empty(),
        "{:?}",
        report.entries[0].notes
    );
    assert_eq!(
        events.0.lock().unwrap().len(),
        1,
        "telemetry saw the replayed call"
    );
}

#[tokio::test]
async fn telemetry_carries_the_actor_confidence_version_and_duration() {
    let registry = reads_registry(false);
    let events = Arc::new(Events::default());
    registry.add_middleware(create_telemetry_middleware(TelemetryOptions::new(
        events.clone(),
    )));
    let quiet = Arc::new(Events::default());
    registry.add_middleware(create_telemetry_middleware(TelemetryOptions {
        include_metadata: false,
        ..TelemetryOptions::new(quiet.clone())
    }));
    let context = CommandContext::new()
        .with_trace_id("")
        .with_actor(crate::Actor::new(crate::ActorKind::Agent))
        .with_clock(Stepping(Mutex::new(0), 5));
    assert!(
        registry
            .execute("reads-run", json!({"a": 1}), Some(context))
            .await
            .success
    );

    let event = events.0.lock().unwrap()[0].clone();
    assert_eq!(event.actor_kind, Some(crate::ActorKind::Agent));
    assert_eq!(event.confidence, Some(0.75));
    assert_eq!(event.command_version.as_deref(), Some("2.1.0"));
    assert_eq!(event.trace_id, None, "an empty trace ID is left out");
    assert_eq!(event.input, None, "the input only when asked for");
    assert!(event.metadata.is_some());
    // The outer layer's two readings bracket the inner layer's two and the handler's one.
    assert_eq!(event.duration_ms, 20);
    let quiet = quiet.0.lock().unwrap()[0].clone();
    assert_eq!(quiet.metadata, None);
    assert_eq!(quiet.command_version.as_deref(), Some("2.1.0"));
}

#[tokio::test]
async fn rate_limit_reopens_a_key_whose_window_ended_while_others_stay_open() {
    let clock = Arc::new(fixed_clock(0));
    let key_fn: KeyFn =
        Arc::new(|context: &CommandContext| context.trace_id.clone().unwrap_or_default());
    let registry = limited(Arc::clone(&clock), Some(key_fn), 2);
    let call = |key: &str| {
        let context = CommandContext::new().with_trace_id(key);
        registry.execute("echo-run", json!({}), Some(context))
    };
    assert!(call("a").await.success);
    clock.advance(1_000);
    assert!(call("b").await.success);
    assert!(call("b").await.success);
    // a's window ends at 1500, b's at 2500.
    clock.advance(600);
    assert!(call("a").await.success, "a reopened");
    assert!(call("a").await.success);
    assert_eq!(call("b").await.error.unwrap().message, "Too many requests");
    // A third key does not fit while both windows are open.
    assert_eq!(
        call("c").await.error.unwrap().message,
        "Rate limit client capacity reached"
    );
    clock.advance(1_000);
    assert!(call("c").await.success, "b's window ended at 2500");
}

#[tokio::test]
async fn logging_passes_the_result_and_the_trace_id_middleware_fills_an_empty_id() {
    let (registry, _) = registry_with(0, "");
    registry.add_middleware(create_auto_trace_id_middleware(TraceIdOptions {
        generate: Some(Arc::new(|| "filled".to_string())),
        ..TraceIdOptions::default()
    }));
    let (lines, log) = lines();
    registry.add_middleware(create_logging_middleware(LoggingOptions {
        log: Some(log),
        log_result: true,
        clock: Some(Arc::new(fixed_clock(0))),
        ..LoggingOptions::default()
    }));
    let context = CommandContext::new().with_trace_id("");
    let result = registry.execute("echo-run", json!({}), Some(context)).await;
    assert_eq!(result.data.unwrap()["traceId"], "filled");
    let lines = lines.lock().unwrap();
    assert!(
        lines[1].starts_with(
            r#"[filled] Completed: echo-run (0ms) - SUCCESS {"result":{"data":{"traceId":"filled"}"#
        ),
        "{}",
        lines[1]
    );
}

#[tokio::test]
async fn a_layer_that_panics_while_building_its_future_is_seen_too() {
    let (registry, _) = registry_with(0, "");
    let (lines, log) = lines();
    let events = Arc::new(Events::default());
    registry.add_middleware(create_logging_middleware(LoggingOptions {
        log: Some(log),
        clock: Some(Arc::new(fixed_clock(0))),
        ..LoggingOptions::default()
    }));
    registry.add_middleware(create_telemetry_middleware(TelemetryOptions::new(
        events.clone(),
    )));
    registry.add_middleware(Arc::new(|_, _, _, _| panic!("layer bug before its future")));
    let result = registry.execute("echo-run", json!({}), None).await;
    assert_eq!(
        result.error.unwrap().code,
        error_codes::COMMAND_EXECUTION_ERROR
    );
    assert_eq!(lines.lock().unwrap()[1], "[no-trace] Error: echo-run (0ms)");
    assert_eq!(
        events.0.lock().unwrap()[0].error.as_ref().unwrap().code,
        "UNHANDLED_ERROR"
    );
}

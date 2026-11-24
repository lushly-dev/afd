use super::*;
use crate::commands::{CommandDefinition, CommandHandler, CommandInterface, ExposeOptions};
use crate::result::{failure, success, CommandResult};
use crate::ResultMetadata;
use async_trait::async_trait;
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Answers with `data`, or fails with `error`; waits `sleep_ms` first (ignoring cancellation);
/// keeps the cancellation signal it ran with; cancels `cancel` when it runs.
#[derive(Default)]
struct Handler {
    data: Option<Value>,
    error: Option<CommandError>,
    sleep_ms: u64,
    seen: Arc<Mutex<Option<CancellationSignal>>>,
    cancel: Option<CancellationSignal>,
    /// Marked when the command starts.
    ran: Arc<AtomicBool>,
    /// Marked once the command's wait is over.
    finished: Arc<AtomicBool>,
    /// Fail with no error at all.
    fails_without_error: bool,
}

#[async_trait]
impl CommandHandler for Handler {
    async fn execute(&self, _input: Value, context: CommandContext) -> CommandResult<Value> {
        self.ran.store(true, Ordering::SeqCst);
        *self.seen.lock().unwrap() = context.cancellation().cloned();
        if let Some(signal) = &self.cancel {
            signal.cancel();
        }
        if self.sleep_ms > 0 {
            tokio::time::sleep(Duration::from_millis(self.sleep_ms)).await;
        }
        self.finished.store(true, Ordering::SeqCst);
        if self.fails_without_error {
            let mut result = failure(CommandError::new("UNUSED", "unused"));
            result.error = None;
            return result;
        }
        if let Some(error) = &self.error {
            return failure(error.clone());
        }
        let mut result = success(self.data.clone().unwrap_or(Value::Null));
        result.confidence = Some(0.9);
        result.reasoning = Some("because".into());
        result.metadata = Some(ResultMetadata::new().with_command_version("1.2.0"));
        result
    }
}

fn registry(handler: Handler) -> CommandRegistry {
    let registry = CommandRegistry::new();
    registry
        .register(CommandDefinition::new(
            "item-list",
            "List items",
            vec![],
            handler,
        ))
        .unwrap();
    registry
}

async fn collect(stream: BoxStream<'_, StreamChunk<Value>>) -> Vec<StreamChunk<Value>> {
    stream.collect().await
}

fn error_of(chunk: &StreamChunk<Value>) -> &ErrorChunk {
    match chunk {
        StreamChunk::Error(error) => error,
        other => panic!("expected an error chunk, got {other:?}"),
    }
}

#[tokio::test]
async fn an_array_is_one_data_chunk_per_item_then_complete() {
    let registry = registry(Handler {
        data: Some(json!(["a", "b", "c"])),
        ..Handler::default()
    });
    let chunks = collect(registry.execute_stream(
        "item-list",
        json!({}),
        None,
        StreamExecutorOptions::new(),
    ))
    .await;
    assert_eq!(chunks.len(), 4);
    for (index, item) in ["a", "b", "c"].into_iter().enumerate() {
        let StreamChunk::Data(chunk) = &chunks[index] else {
            panic!("expected data, got {:?}", chunks[index]);
        };
        assert_eq!((chunk.data.clone(), chunk.index), (json!(item), index));
        assert_eq!(chunk.is_last, index == 2);
    }
    let StreamChunk::Complete(complete) = &chunks[3] else {
        panic!("expected complete");
    };
    assert_eq!(complete.total_chunks, 3);
    assert_eq!(complete.confidence, Some(0.9));
    assert_eq!(complete.reasoning.as_deref(), Some("because"));
    assert_eq!(
        complete
            .metadata
            .as_ref()
            .unwrap()
            .command_version
            .as_deref(),
        Some("1.2.0")
    );
    assert_eq!(complete.data, None);
}

#[tokio::test]
async fn other_data_is_one_chunk_and_an_empty_array_none() {
    for (data, expected) in [
        (json!({"id": 1}), vec![json!({"id": 1})]),
        (Value::Null, vec![Value::Null]),
        (json!([]), vec![]),
    ] {
        let registry = registry(Handler {
            data: Some(data.clone()),
            ..Handler::default()
        });
        let chunks = collect(execute_stream(
            &registry,
            "item-list",
            json!({}),
            None,
            StreamExecutorOptions::default(),
        ))
        .await;
        let sent: Vec<Value> = chunks
            .iter()
            .filter_map(|chunk| match chunk {
                StreamChunk::Data(chunk) => Some(chunk.data.clone()),
                _ => None,
            })
            .collect();
        assert_eq!(sent, expected, "{data}");
        let StreamChunk::Complete(complete) = chunks.last().unwrap() else {
            panic!("expected complete for {data}");
        };
        assert_eq!(complete.total_chunks, expected.len());
    }
}

#[tokio::test]
async fn a_failure_is_one_error_chunk_recoverable_when_retryable() {
    for retryable in [true, false] {
        let registry = registry(Handler {
            error: Some(
                CommandError::new("UPSTREAM_DOWN", "Down")
                    .with_suggestion("Retry")
                    .with_retryable(retryable),
            ),
            ..Handler::default()
        });
        let chunks = collect(registry.execute_stream(
            "item-list",
            json!({}),
            None,
            StreamExecutorOptions::new(),
        ))
        .await;
        assert_eq!(chunks.len(), 1);
        let error = error_of(&chunks[0]);
        assert_eq!(error.error.code, "UPSTREAM_DOWN");
        assert_eq!(
            (error.chunks_before_error, error.recoverable),
            (0, retryable)
        );
        assert_eq!(error.resume_from, None);
    }
}

#[tokio::test]
async fn every_check_of_execute_applies() {
    let registry = CommandRegistry::new();
    registry
        .register(
            CommandDefinition::new("item-list", "List items", vec![], Handler::default())
                .with_expose(ExposeOptions::new().with_mcp(false)),
        )
        .unwrap();
    let context = CommandContext::new().with_interface(CommandInterface::Mcp);
    let chunks = collect(registry.execute_stream(
        "item-list",
        json!({}),
        Some(context),
        StreamExecutorOptions::new(),
    ))
    .await;
    assert_eq!(
        error_of(&chunks[0]).error.code,
        error_codes::COMMAND_NOT_EXPOSED
    );

    let chunks = collect(registry.execute_stream(
        "item-missing",
        json!({}),
        None,
        StreamExecutorOptions::new(),
    ))
    .await;
    assert_eq!(
        error_of(&chunks[0]).error.code,
        error_codes::COMMAND_NOT_FOUND
    );
}

#[tokio::test]
async fn a_cancelled_caller_stops_before_during_and_between_chunks() {
    // Before: the command never runs.
    let seen = Arc::new(Mutex::new(None));
    let registry_before = registry(Handler {
        seen: Arc::clone(&seen),
        ..Handler::default()
    });
    let signal = CancellationSignal::new();
    signal.cancel();
    let context = CommandContext::new().with_cancellation(signal);
    let chunks = collect(registry_before.execute_stream(
        "item-list",
        json!({}),
        Some(context),
        StreamExecutorOptions::new(),
    ))
    .await;
    let error = error_of(&chunks[0]);
    assert_eq!(error.error.code, error_codes::STREAM_ABORTED);
    assert_eq!(error.error.message, "Stream was aborted before starting");
    assert!(error.recoverable);
    assert!(seen.lock().unwrap().is_none(), "the command did not run");

    // During: the command fires the caller's signal.
    let signal = CancellationSignal::new();
    let during = registry(Handler {
        data: Some(json!([1, 2])),
        cancel: Some(signal.clone()),
        ..Handler::default()
    });
    let context = CommandContext::new().with_cancellation(signal);
    let chunks = collect(during.execute_stream(
        "item-list",
        json!({}),
        Some(context),
        StreamExecutorOptions::new(),
    ))
    .await;
    assert_eq!(chunks.len(), 1);
    assert_eq!(
        error_of(&chunks[0]).error.message,
        "Stream was aborted during execution"
    );

    // Between data chunks: after the first item, with `resumeFrom`.
    let signal = CancellationSignal::new();
    let between = registry(Handler {
        data: Some(json!([1, 2, 3])),
        ..Handler::default()
    });
    let context = CommandContext::new().with_cancellation(signal.clone());
    let mut stream = between.execute_stream(
        "item-list",
        json!({}),
        Some(context),
        StreamExecutorOptions::new(),
    );
    assert!(matches!(stream.next().await, Some(StreamChunk::Data(_))));
    signal.cancel();
    let next = stream.next().await.unwrap();
    let error = error_of(&next);
    assert_eq!(error.error.message, "Stream was aborted");
    assert_eq!((error.chunks_before_error, error.resume_from), (1, Some(1)));
    assert!(
        stream.next().await.is_none(),
        "the stream ends after the error"
    );
}

#[cfg(feature = "native")]
#[tokio::test(start_paused = true)]
async fn the_deadline_fires_the_commands_signal_and_ends_the_wait() {
    let seen = Arc::new(Mutex::new(None));
    let finished = Arc::new(AtomicBool::new(false));
    let registry = registry(Handler {
        sleep_ms: 10_000,
        seen: Arc::clone(&seen),
        finished: Arc::clone(&finished),
        ..Handler::default()
    });
    let caller = CancellationSignal::new();
    let context = CommandContext::new().with_cancellation(caller.clone());
    let begun = tokio::time::Instant::now();
    let chunks = collect(registry.execute_stream(
        "item-list",
        json!({}),
        Some(context),
        StreamExecutorOptions::new().with_timeout_ms(50),
    ))
    .await;
    assert_eq!(chunks.len(), 1);
    let error = error_of(&chunks[0]);
    assert_eq!(error.error.code, error_codes::STREAM_TIMEOUT);
    assert_eq!(error.error.message, "Stream timed out after 50ms");
    assert_eq!(error.error.retryable, Some(true));
    assert_eq!(error.resume_from, None);
    let command_signal = seen
        .lock()
        .unwrap()
        .clone()
        .expect("the command had a signal");
    assert!(
        command_signal.is_cancelled(),
        "the deadline fired the command's signal"
    );
    assert!(
        !caller.is_cancelled(),
        "the caller's own signal is not fired"
    );
    assert_eq!(
        begun.elapsed(),
        Duration::from_millis(50),
        "the deadline ended the wait"
    );
    assert!(
        !finished.load(Ordering::SeqCst),
        "the command's wait was cut short"
    );
}

#[cfg(feature = "native")]
#[tokio::test(start_paused = true)]
async fn the_deadline_ends_the_stream_between_data_chunks() {
    let registry = registry(Handler {
        data: Some(json!([1, 2, 3])),
        ..Handler::default()
    });
    let mut stream = registry.execute_stream(
        "item-list",
        json!({}),
        None,
        StreamExecutorOptions::new().with_timeout_ms(100),
    );
    assert!(matches!(stream.next().await, Some(StreamChunk::Data(_))));
    assert!(matches!(stream.next().await, Some(StreamChunk::Data(_))));
    tokio::time::advance(Duration::from_millis(150)).await;
    let next = stream.next().await.unwrap();
    let error = error_of(&next);
    assert_eq!(error.error.code, error_codes::STREAM_TIMEOUT);
    assert_eq!((error.chunks_before_error, error.resume_from), (2, Some(2)));
}

#[cfg(feature = "native")]
#[tokio::test(start_paused = true)]
async fn a_stream_within_its_deadline_completes() {
    let registry = registry(Handler {
        data: Some(json!([1])),
        sleep_ms: 20,
        ..Handler::default()
    });
    let chunks = collect(registry.execute_stream(
        "item-list",
        json!({}),
        None,
        StreamExecutorOptions::new().with_timeout_ms(100),
    ))
    .await;
    assert!(matches!(chunks.last(), Some(StreamChunk::Complete(_))));
}

#[cfg(not(feature = "native"))]
#[tokio::test]
async fn a_timeout_without_the_native_feature_is_refused_before_the_command_runs() {
    let ran = Arc::new(AtomicBool::new(false));
    let registry = registry(Handler {
        ran: Arc::clone(&ran),
        ..Handler::default()
    });
    let chunks = collect(registry.execute_stream(
        "item-list",
        json!({}),
        None,
        StreamExecutorOptions::new().with_timeout_ms(100),
    ))
    .await;
    assert_eq!(chunks.len(), 1);
    let error = error_of(&chunks[0]);
    assert_eq!(error.error.code, error_codes::UNSUPPORTED_OPTION);
    assert_eq!(error.error.retryable, Some(false));
    assert!(!error.recoverable);
    assert!(!ran.load(Ordering::SeqCst));
}

#[tokio::test]
async fn nothing_runs_until_the_stream_is_polled() {
    let ran = Arc::new(AtomicBool::new(false));
    let registry = registry(Handler {
        ran: Arc::clone(&ran),
        ..Handler::default()
    });
    let stream =
        registry.execute_stream("item-list", json!({}), None, StreamExecutorOptions::new());
    assert!(!ran.load(Ordering::SeqCst));
    drop(stream);
    assert!(!ran.load(Ordering::SeqCst));
}

#[cfg(feature = "native")]
#[tokio::test(start_paused = true)]
async fn dropping_the_stream_stops_the_command() {
    let finished = Arc::new(AtomicBool::new(false));
    let ran = Arc::new(AtomicBool::new(false));
    let registry = registry(Handler {
        sleep_ms: 1_000,
        ran: Arc::clone(&ran),
        finished: Arc::clone(&finished),
        ..Handler::default()
    });
    let mut stream =
        registry.execute_stream("item-list", json!({}), None, StreamExecutorOptions::new());
    // Poll until the command starts and waits, then drop the stream.
    let polled = tokio::time::timeout(Duration::from_millis(10), stream.next()).await;
    assert!(polled.is_err(), "the command is still waiting");
    assert!(ran.load(Ordering::SeqCst));
    drop(stream);
    tokio::time::sleep(Duration::from_millis(5_000)).await;
    assert!(
        !finished.load(Ordering::SeqCst),
        "the dropped command never finished"
    );
}

#[cfg(feature = "native")]
#[tokio::test(start_paused = true)]
async fn a_caller_cancel_under_a_deadline_is_an_abort_not_a_timeout() {
    let caller = CancellationSignal::new();
    let seen = Arc::new(Mutex::new(None));
    let registry = registry(Handler {
        data: Some(json!([1])),
        cancel: Some(caller.clone()),
        seen: Arc::clone(&seen),
        ..Handler::default()
    });
    let context = CommandContext::new().with_cancellation(caller);
    let chunks = collect(registry.execute_stream(
        "item-list",
        json!({}),
        Some(context),
        StreamExecutorOptions::new().with_timeout_ms(10_000),
    ))
    .await;
    assert_eq!(error_of(&chunks[0]).error.code, error_codes::STREAM_ABORTED);
    let command_signal = seen.lock().unwrap().clone().unwrap();
    assert!(
        command_signal.is_cancelled(),
        "the caller's cancel reached the command"
    );
}

#[cfg(feature = "native")]
#[tokio::test(start_paused = true)]
async fn the_commands_own_shorter_deadline_is_a_timeout_error_chunk() {
    let registry = registry(Handler {
        sleep_ms: 1_000,
        ..Handler::default()
    });
    let mut context = CommandContext::new();
    context.timeout_ms = Some(20);
    let chunks = collect(registry.execute_stream(
        "item-list",
        json!({}),
        Some(context),
        StreamExecutorOptions::new().with_timeout_ms(10_000),
    ))
    .await;
    assert_eq!(chunks.len(), 1);
    assert_eq!(error_of(&chunks[0]).error.code, error_codes::TIMEOUT);
}

#[tokio::test]
async fn a_stream_whose_items_were_all_sent_completes_whatever_the_signal_does() {
    let signal = CancellationSignal::new();
    let registry = registry(Handler {
        data: Some(json!([1, 2])),
        ..Handler::default()
    });
    let context = CommandContext::new().with_cancellation(signal.clone());
    let mut stream = registry.execute_stream(
        "item-list",
        json!({}),
        Some(context),
        StreamExecutorOptions::new(),
    );
    assert!(matches!(stream.next().await, Some(StreamChunk::Data(_))));
    let Some(StreamChunk::Data(last)) = stream.next().await else {
        panic!("expected the last data chunk");
    };
    assert!(last.is_last);
    signal.cancel();
    let Some(StreamChunk::Complete(complete)) = stream.next().await else {
        panic!("expected complete");
    };
    assert_eq!(complete.total_chunks, 2);
}

#[tokio::test]
async fn a_streamed_commands_output_budget_is_not_checked() {
    let registry = CommandRegistry::new();
    let items: Vec<Value> = (0..200).map(|index| json!({ "index": index })).collect();
    let handler = Handler {
        data: Some(Value::Array(items)),
        ..Handler::default()
    };
    registry
        .register(
            CommandDefinition::new("item-list", "List items", vec![], handler)
                .with_output_budget(100, 200),
        )
        .unwrap();
    // Executed, the result is over its budget.
    let executed = registry.execute("item-list", json!({}), None).await;
    assert_eq!(
        executed.error.unwrap().code,
        error_codes::OUTPUT_BUDGET_EXCEEDED
    );
    // Streamed, every item is sent (`spec/output-budgets.md`, B7).
    let chunks = collect(registry.execute_stream(
        "item-list",
        json!({}),
        None,
        StreamExecutorOptions::new(),
    ))
    .await;
    assert_eq!(chunks.len(), 201);
    assert!(matches!(chunks.last(), Some(StreamChunk::Complete(_))));
}

#[tokio::test]
async fn a_failure_without_an_error_is_command_failed() {
    let registry = registry(Handler {
        fails_without_error: true,
        ..Handler::default()
    });
    let chunks = collect(registry.execute_stream(
        "item-list",
        json!({}),
        None,
        StreamExecutorOptions::new(),
    ))
    .await;
    let error = error_of(&chunks[0]);
    assert_eq!(error.error.code, error_codes::COMMAND_FAILED);
    assert!(!error.recoverable);
}

#[cfg(feature = "native")]
#[tokio::test(start_paused = true)]
async fn a_deadline_too_far_away_is_none() {
    let registry = registry(Handler {
        data: Some(json!([1])),
        ..Handler::default()
    });
    let chunks = collect(registry.execute_stream(
        "item-list",
        json!({}),
        None,
        StreamExecutorOptions::new().with_timeout_ms(u64::MAX),
    ))
    .await;
    assert!(matches!(chunks.last(), Some(StreamChunk::Complete(_))));
}

/// Answers with the output budget it sees.
struct BudgetEcho;

#[async_trait]
impl CommandHandler for BudgetEcho {
    async fn execute(&self, _input: Value, context: CommandContext) -> CommandResult<Value> {
        success(json!({ "budget": context.output_budget }))
    }
}

fn budget_registry() -> CommandRegistry {
    let registry = CommandRegistry::new();
    registry
        .register(
            CommandDefinition::new("item-list", "List items", vec![], BudgetEcho)
                .with_output_budget(100, 200),
        )
        .unwrap();
    registry
}

#[tokio::test]
async fn a_streamed_command_still_sees_its_budget_and_a_bad_ask_is_refused() {
    let registry = budget_registry();
    let context = CommandContext::new().with_output_budget_ask(150);
    let chunks = collect(registry.execute_stream(
        "item-list",
        json!({}),
        Some(context),
        StreamExecutorOptions::new(),
    ))
    .await;
    let StreamChunk::Data(chunk) = &chunks[0] else {
        panic!("expected data, got {:?}", chunks[0]);
    };
    assert_eq!(chunk.data, json!({ "budget": 150 }));

    let context = CommandContext::new().with_output_budget_ask(0);
    let chunks = collect(registry.execute_stream(
        "item-list",
        json!({}),
        Some(context),
        StreamExecutorOptions::new(),
    ))
    .await;
    assert_eq!(
        error_of(&chunks[0]).error.code,
        error_codes::VALIDATION_ERROR
    );
}

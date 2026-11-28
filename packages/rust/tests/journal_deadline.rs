//! What the journal records for a call the engine stopped waiting for (#2678; `spec/journal.md`,
//! "Calls that end at a deadline"). The handler waits on a `Notify` only the test fires, and the
//! clock is Tokio's paused one, which moves to the next timer only when every task waits: the
//! deadline (a minute of paused time, no real time) always passes while the handler is waiting,
//! and no test here races a timer. The one exception, a handler that blocks its thread, runs on
//! the real clock: with no middleware and a memory sink the call completes in one poll, which
//! `tokio::time::timeout` makes before its timer, so the client's own check after the registry
//! returns is what gives `TIMEOUT`, however the thread is scheduled.

#![cfg(feature = "native")]

use afd::*;
use async_trait::async_trait;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Notify;

/// The deadline every test sets: in paused time, so it costs nothing to wait for.
const DEADLINE_MS: u64 = 60_000;

/// Fails the test, instead of hanging it, when a call outlives its deadline by far.
async fn bounded<T>(call: impl std::future::Future<Output = T>) -> T {
    tokio::time::timeout(Duration::from_secs(600), call)
        .await
        .expect("the call returned at its deadline")
}

#[derive(Default)]
struct Seen {
    started: AtomicBool,
    finished: AtomicBool,
    dropped: AtomicBool,
}

/// Sets `dropped` when the handler's future is dropped, finished or not.
struct DropFlag(Arc<Seen>);

impl Drop for DropFlag {
    fn drop(&mut self) {
        self.0.dropped.store(true, Ordering::SeqCst);
    }
}

/// Waits for `release`, then succeeds with `"late"`.
struct Held {
    release: Arc<Notify>,
    seen: Arc<Seen>,
}

#[async_trait]
impl CommandHandler for Held {
    async fn execute(&self, _input: Value, _context: CommandContext) -> CommandResult<Value> {
        let _flag = DropFlag(Arc::clone(&self.seen));
        self.seen.started.store(true, Ordering::SeqCst);
        self.release.notified().await;
        self.seen.finished.store(true, Ordering::SeqCst);
        success(json!("late"))
    }
}

struct Quick;

#[async_trait]
impl CommandHandler for Quick {
    async fn execute(&self, _input: Value, _context: CommandContext) -> CommandResult<Value> {
        success(json!("quick"))
    }
}

struct Fixture {
    registry: Arc<CommandRegistry>,
    sink: Arc<MemoryJournalSink>,
    release: Arc<Notify>,
    seen: Arc<Seen>,
}

fn fixture() -> Fixture {
    let registry = Arc::new(CommandRegistry::new());
    let release = Arc::new(Notify::new());
    let seen = Arc::new(Seen::default());
    let held = Held {
        release: Arc::clone(&release),
        seen: Arc::clone(&seen),
    };
    registry
        .register(CommandDefinition::new("work-slow", "Wait", vec![], held))
        .unwrap();
    registry
        .register(CommandDefinition::new(
            "work-quick",
            "Return",
            vec![],
            Quick,
        ))
        .unwrap();
    // Failures are recorded too, so an empty journal means no entry of any kind.
    let sink = Arc::new(MemoryJournalSink::new());
    registry.set_journal(JournalRecorder::new(sink.clone()).with_record_failures(true));
    Fixture {
        registry,
        sink,
        release,
        seen,
    }
}

impl Fixture {
    /// Release the handler, let the runtime run, and check that it never finished and that the
    /// journal stayed empty.
    async fn release_and_check_nothing_recorded(&self) {
        assert!(
            self.seen.started.load(Ordering::SeqCst),
            "the handler started"
        );
        assert!(
            self.seen.dropped.load(Ordering::SeqCst),
            "the handler's future was dropped at the deadline"
        );
        self.release.notify_one();
        for _ in 0..10 {
            tokio::task::yield_now().await;
        }
        assert!(
            !self.seen.finished.load(Ordering::SeqCst),
            "the handler never finished"
        );
        assert!(self.sink.entries().is_empty(), "no entry was recorded");
    }
}

#[tokio::test(start_paused = true)]
async fn a_timeout_drops_the_handler_and_records_nothing() {
    let f = fixture();
    let mut context = CommandContext::new();
    context.timeout_ms = Some(DEADLINE_MS);
    let result = bounded(f.registry.execute("work-slow", json!({}), Some(context))).await;
    assert_eq!(result.error.unwrap().code, error_codes::TIMEOUT);
    f.release_and_check_nothing_recorded().await;
}

#[tokio::test(start_paused = true)]
async fn a_direct_client_timeout_records_nothing() {
    let f = fixture();
    let mut context = CommandContext::new();
    context.timeout_ms = Some(DEADLINE_MS);
    let client = DirectClient::new(Arc::clone(&f.registry));
    let result = bounded(client.call("work-slow", json!({}), Some(context))).await;
    assert_eq!(result.error.unwrap().code, error_codes::TIMEOUT);
    f.release_and_check_nothing_recorded().await;
}

#[tokio::test(start_paused = true)]
async fn a_batch_timeout_records_neither_the_running_item_nor_the_unstarted_one() {
    let f = fixture();
    let request = BatchRequest::new(vec![
        BatchCommand::new("work-slow", json!({})),
        BatchCommand::new("work-quick", json!({})),
    ])
    .with_options(
        BatchOptions::new()
            .with_timeout(DEADLINE_MS as f64)
            .with_parallelism(1),
    );
    let batch = bounded(f.registry.execute_batch(request)).await;
    let codes: Vec<_> = batch
        .results
        .iter()
        .map(|item| item.result.error.as_ref().unwrap().code.clone())
        .collect();
    assert_eq!(
        codes,
        [error_codes::BATCH_TIMEOUT, error_codes::BATCH_TIMEOUT]
    );
    f.release_and_check_nothing_recorded().await;
}

#[tokio::test(start_paused = true)]
async fn a_pipeline_timeout_records_neither_the_running_step_nor_the_later_one() {
    let f = fixture();
    let registry = Arc::clone(&f.registry);
    let executor: CommandExecutor = Arc::new(move |command, input, _step| {
        let registry = Arc::clone(&registry);
        Box::pin(async move { registry.execute(&command, input, None).await })
    });
    let request = PipelineRequest::new(vec![
        PipelineStep::new("work-slow"),
        PipelineStep::new("work-quick"),
    ])
    .with_options(PipelineOptions::new().with_timeout_ms(DEADLINE_MS as f64));
    let pipeline = bounded(execute_pipeline(&request, &executor, None::<HashMap<_, _>>)).await;
    let codes: Vec<_> = pipeline
        .steps
        .iter()
        .map(|step| step.error.as_ref().unwrap().code.clone())
        .collect();
    assert_eq!(
        codes,
        [error_codes::PIPELINE_TIMEOUT, error_codes::PIPELINE_TIMEOUT]
    );
    f.release_and_check_nothing_recorded().await;
}

/// Blocks its thread for `block_ms` without yielding, then succeeds with `"blocked"`.
struct Blocking {
    block_ms: u64,
}

#[async_trait]
impl CommandHandler for Blocking {
    async fn execute(&self, _input: Value, _context: CommandContext) -> CommandResult<Value> {
        std::thread::sleep(Duration::from_millis(self.block_ms));
        success(json!("blocked"))
    }
}

/// `DirectClient` reads the clock after the registry returns: a handler that blocked past the
/// deadline is recorded with its result, and the caller is given `TIMEOUT`. The block is five
/// times the deadline, so the deadline has always passed when the handler returns.
#[tokio::test]
async fn a_direct_client_records_a_handler_that_blocks_past_its_deadline() {
    let registry = Arc::new(CommandRegistry::new());
    registry
        .register(CommandDefinition::new(
            "work-block",
            "Block",
            vec![],
            Blocking { block_ms: 500 },
        ))
        .unwrap();
    let sink = Arc::new(MemoryJournalSink::new());
    registry.set_journal(JournalRecorder::new(sink.clone()));
    let mut context = CommandContext::new();
    context.timeout_ms = Some(100);
    let client = DirectClient::new(Arc::clone(&registry));
    let result = tokio::time::timeout(
        Duration::from_secs(30),
        client.call("work-block", json!({}), Some(context)),
    )
    .await
    .expect("the call returned");
    assert_eq!(result.error.unwrap().code, error_codes::TIMEOUT);
    let entries = sink.entries();
    assert_eq!(entries.len(), 1, "the blocked handler was recorded");
    assert_eq!(entries[0].command, "work-block");
    assert_eq!(entries[0].result.data, Some(json!("blocked")));
}

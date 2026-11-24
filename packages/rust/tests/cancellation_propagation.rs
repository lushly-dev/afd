//! The call's cancellation signal through `DirectClient` and pipeline deadlines, and a call
//! cancelled while its approval was pending (#1599).

#![cfg(feature = "native")]

use afd::*;
use async_trait::async_trait;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Keeps the cancellation signal it ran with, then waits `sleep_ms` (ignoring the signal).
struct Sleeper {
    runs: Arc<AtomicUsize>,
    seen: Arc<Mutex<Option<CancellationSignal>>>,
    sleep_ms: u64,
}

#[async_trait]
impl CommandHandler for Sleeper {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        self.runs.fetch_add(1, Ordering::SeqCst);
        *self.seen.lock().unwrap() = context.cancellation().cloned();
        tokio::time::sleep(Duration::from_millis(self.sleep_ms)).await;
        success(input)
    }
}

struct Fixture {
    registry: Arc<CommandRegistry>,
    runs: Arc<AtomicUsize>,
    seen: Arc<Mutex<Option<CancellationSignal>>>,
}

fn fixture(sleep_ms: u64) -> Fixture {
    let registry = Arc::new(CommandRegistry::new());
    let runs = Arc::new(AtomicUsize::new(0));
    let seen = Arc::new(Mutex::new(None));
    let handler = Sleeper {
        runs: Arc::clone(&runs),
        seen: Arc::clone(&seen),
        sleep_ms,
    };
    registry
        .register(
            CommandDefinition::new("item-scan", "Scan", vec![], handler)
                .with_expose(ExposeOptions::new().with_agent(true)),
        )
        .unwrap();
    Fixture {
        registry,
        runs,
        seen,
    }
}

#[tokio::test(start_paused = true)]
async fn a_direct_client_deadline_fires_the_commands_signal_not_the_callers() {
    let f = fixture(10_000);
    let caller = CancellationSignal::new();
    let mut context = CommandContext::new().with_cancellation(caller.clone());
    context.timeout_ms = Some(50);
    let result = DirectClient::new(Arc::clone(&f.registry))
        .call("item-scan", json!({}), Some(context))
        .await;
    assert_eq!(result.error.unwrap().code, error_codes::TIMEOUT);
    let command = f
        .seen
        .lock()
        .unwrap()
        .clone()
        .expect("the command had a signal");
    assert!(
        command.is_cancelled(),
        "the deadline fired the command's signal"
    );
    assert!(
        !caller.is_cancelled(),
        "the caller's own signal is not fired"
    );
}

#[tokio::test]
async fn a_direct_client_call_already_cancelled_does_not_run() {
    let f = fixture(0);
    let caller = CancellationSignal::new();
    caller.cancel();
    let context = CommandContext::new().with_cancellation(caller);
    let result = DirectClient::new(Arc::clone(&f.registry))
        .call("item-scan", json!({}), Some(context))
        .await;
    assert_eq!(result.error.unwrap().code, error_codes::COMMAND_CANCELLED);
    assert_eq!(f.runs.load(Ordering::SeqCst), 0);
}

#[cfg(feature = "approval")]
#[tokio::test]
async fn a_call_cancelled_while_its_approval_was_pending_does_not_resume() {
    // The person approves, but the caller cancelled while waiting: the approved retry is refused
    // before the handler, as TypeScript's COMMAND_CANCELLED guard does.
    let registry = Arc::new(CommandRegistry::new());
    let runs = Arc::new(AtomicUsize::new(0));
    let handler = Sleeper {
        runs: Arc::clone(&runs),
        seen: Arc::default(),
        sleep_ms: 0,
    };
    registry
        .register(
            CommandDefinition::new("item-delete", "Delete", vec![], handler)
                .with_approval(ApprovalPolicy::Required),
        )
        .unwrap();
    let options =
        ApprovalMiddlewareOptions::from_secret("test-private-approval-secret-0123456789abcdef");
    registry.add_middleware(create_approval_middleware(options).unwrap());
    let caller = CancellationSignal::new();
    let cancel = caller.clone();
    let client = DirectClient::new(Arc::clone(&registry)).with_on_approval_needed(Arc::new(
        move |_request| {
            cancel.cancel();
            Box::pin(async { Ok(true) })
        },
    ));
    let context = CommandContext::new().with_cancellation(caller);
    let result = client.call("item-delete", json!({}), Some(context)).await;
    assert_eq!(result.error.unwrap().code, error_codes::COMMAND_CANCELLED);
    assert_eq!(
        runs.load(Ordering::SeqCst),
        0,
        "the approved call never ran"
    );
}

#[tokio::test(start_paused = true)]
async fn a_pipeline_deadline_fires_the_signal_its_steps_see() {
    let f = fixture(10_000);
    let signal = CancellationSignal::new();
    let registry = Arc::clone(&f.registry);
    let step_signal = signal.clone();
    let executor: CommandExecutor = Arc::new(move |command, input, _step| {
        let registry = Arc::clone(&registry);
        let context = CommandContext::new().with_cancellation(step_signal.child());
        Box::pin(async move { registry.execute(&command, input, Some(context)).await })
    });
    let request = PipelineRequest::new(vec![
        PipelineStep::new("item-scan"),
        PipelineStep::new("item-scan"),
    ])
    .with_options(PipelineOptions::new().with_timeout_ms(50.0));
    let result = execute_pipeline_with_cancellation(
        &request,
        &executor,
        None::<HashMap<_, _>>,
        Some(signal.clone()),
    )
    .await;
    assert_eq!(
        result.steps[0].error.as_ref().unwrap().code,
        error_codes::PIPELINE_TIMEOUT
    );
    assert!(
        signal.is_cancelled(),
        "the pipeline deadline fired its signal"
    );
    let command = f
        .seen
        .lock()
        .unwrap()
        .clone()
        .expect("the step had a signal");
    assert!(
        command.is_cancelled(),
        "the running step's signal fired with it"
    );
    assert_eq!(
        f.runs.load(Ordering::SeqCst),
        1,
        "the second step never started"
    );
}

#[tokio::test]
async fn a_pipeline_within_its_deadline_leaves_the_signal_alone() {
    let f = fixture(0);
    let signal = CancellationSignal::new();
    let registry = Arc::clone(&f.registry);
    let executor: CommandExecutor = Arc::new(move |command, input, _step| {
        let registry = Arc::clone(&registry);
        Box::pin(async move { registry.execute(&command, input, None).await })
    });
    let request = PipelineRequest::new(vec![PipelineStep::new("item-scan")])
        .with_options(PipelineOptions::new().with_timeout_ms(10_000.0));
    let result =
        execute_pipeline_with_cancellation(&request, &executor, None, Some(signal.clone())).await;
    assert!(result.steps[0].error.is_none());
    assert!(!signal.is_cancelled());
}

/// Blocks its thread for `ms` (no await), so a deadline cannot cut it short.
struct Blocking(u64);

#[async_trait]
impl CommandHandler for Blocking {
    async fn execute(&self, input: Value, _context: CommandContext) -> CommandResult<Value> {
        std::thread::sleep(Duration::from_millis(self.0));
        success(input)
    }
}

fn blocking_executor(ms: u64) -> CommandExecutor {
    let registry = Arc::new(CommandRegistry::new());
    registry
        .register(CommandDefinition::new(
            "item-block",
            "Block",
            vec![],
            Blocking(ms),
        ))
        .unwrap();
    Arc::new(move |command, input, _step| {
        let registry = Arc::clone(&registry);
        Box::pin(async move { registry.execute(&command, input, None).await })
    })
}

#[tokio::test]
async fn a_step_that_ends_past_the_deadline_fires_the_signal_when_steps_remain() {
    let signal = CancellationSignal::new();
    let request = PipelineRequest::new(vec![
        PipelineStep::new("item-block"),
        PipelineStep::new("item-block"),
    ])
    .with_options(PipelineOptions::new().with_timeout_ms(20.0));
    let result = execute_pipeline_with_cancellation(
        &request,
        &blocking_executor(60),
        None,
        Some(signal.clone()),
    )
    .await;
    assert!(result.steps[0].error.is_none(), "the first step finished");
    assert_eq!(
        result.steps[1].error.as_ref().unwrap().code,
        error_codes::PIPELINE_TIMEOUT
    );
    assert!(signal.is_cancelled());
}

#[tokio::test]
async fn a_last_step_that_ends_past_the_deadline_fires_nothing() {
    let signal = CancellationSignal::new();
    let request = PipelineRequest::new(vec![PipelineStep::new("item-block")])
        .with_options(PipelineOptions::new().with_timeout_ms(20.0));
    let result = execute_pipeline_with_cancellation(
        &request,
        &blocking_executor(60),
        None,
        Some(signal.clone()),
    )
    .await;
    assert!(result.steps[0].error.is_none());
    assert!(!signal.is_cancelled(), "nothing was left to stop");
}

#[tokio::test]
async fn a_signal_fired_during_a_step_skips_the_rest_with_command_cancelled() {
    let f = fixture(0);
    let signal = CancellationSignal::new();
    let registry = Arc::clone(&f.registry);
    let fired = signal.clone();
    let executor: CommandExecutor = Arc::new(move |command, input, _step| {
        let registry = Arc::clone(&registry);
        let fired = fired.clone();
        Box::pin(async move {
            let result = registry.execute(&command, input, None).await;
            fired.cancel();
            result
        })
    });
    let mut options = PipelineOptions::new();
    options.continue_on_failure = Some(true);
    let request = PipelineRequest::new(vec![
        PipelineStep::new("item-scan"),
        PipelineStep::new("item-scan"),
        PipelineStep::new("item-scan"),
    ])
    .with_options(options);
    let result = execute_pipeline_with_cancellation(&request, &executor, None, Some(signal)).await;
    assert!(result.steps[0].error.is_none());
    for step in &result.steps[1..] {
        assert_eq!(step.status, StepStatus::Skipped);
        assert_eq!(
            step.error.as_ref().unwrap().code,
            error_codes::COMMAND_CANCELLED
        );
    }
    assert_eq!(f.runs.load(Ordering::SeqCst), 1);
}

#[tokio::test(start_paused = true)]
async fn a_direct_client_zero_timeout_is_no_deadline_and_overrides_the_registry_default() {
    let f = fixture(100);
    f.registry.set_default_timeout_ms(Some(50));
    let client = DirectClient::new(Arc::clone(&f.registry));
    for timeout in [0, 500] {
        let mut context = CommandContext::new();
        context.timeout_ms = Some(timeout);
        let result = client.call("item-scan", json!({}), Some(context)).await;
        assert!(result.success, "timeout {timeout}: {result:?}");
    }
    let command = f.seen.lock().unwrap().clone();
    assert!(command.is_none_or(|signal| !signal.is_cancelled()));
}

#[cfg(feature = "approval")]
fn gated(hook: DirectApprovalHook) -> (DirectClient, Arc<AtomicUsize>) {
    let registry = Arc::new(CommandRegistry::new());
    let runs = Arc::new(AtomicUsize::new(0));
    let handler = Sleeper {
        runs: Arc::clone(&runs),
        seen: Arc::default(),
        sleep_ms: 0,
    };
    registry
        .register(
            CommandDefinition::new("item-delete", "Delete", vec![], handler)
                .with_approval(ApprovalPolicy::Required),
        )
        .unwrap();
    let options =
        ApprovalMiddlewareOptions::from_secret("test-private-approval-secret-0123456789abcdef");
    registry.add_middleware(create_approval_middleware(options).unwrap());
    (
        DirectClient::new(registry).with_on_approval_needed(hook),
        runs,
    )
}

#[cfg(feature = "approval")]
#[tokio::test(start_paused = true)]
async fn a_caller_cancel_ends_the_approval_wait() {
    // The person never answers; the caller gives up, and the call ends at once.
    let (client, runs) = gated(Arc::new(|_request| Box::pin(std::future::pending())));
    let caller = CancellationSignal::new();
    let cancel = caller.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(10)).await;
        cancel.cancel();
    });
    let context = CommandContext::new().with_cancellation(caller);
    let result = client.call("item-delete", json!({}), Some(context)).await;
    assert_eq!(result.error.unwrap().code, error_codes::COMMAND_CANCELLED);
    assert_eq!(runs.load(Ordering::SeqCst), 0);
}

#[cfg(feature = "approval")]
#[tokio::test(start_paused = true)]
async fn the_deadline_ends_the_approval_wait() {
    let (client, runs) = gated(Arc::new(|_request| Box::pin(std::future::pending())));
    let mut context = CommandContext::new();
    context.timeout_ms = Some(50);
    let begun = tokio::time::Instant::now();
    let result = client.call("item-delete", json!({}), Some(context)).await;
    assert_eq!(result.error.unwrap().code, error_codes::TIMEOUT);
    assert_eq!(begun.elapsed(), Duration::from_millis(50));
    assert_eq!(runs.load(Ordering::SeqCst), 0);
}

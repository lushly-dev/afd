//! The bound and the deadline of compiled-plugin calls (decision D204), around every handler a
//! compiled plugin registers: an SDK plugin's, a raw `PluginCommand::Handler` and a finished
//! `PluginCommand::Definition`.
//!
//! At most `limits.compiled_calls` such calls of one host run at once. A call that is not a task,
//! nor the host's own command line, has a deadline from its start: `limits.compiled_timeout_ms`,
//! or less when the caller's own `timeout_ms` would end first. A call cancelled while it waits for
//! a turn answers `COMMAND_CANCELLED`; one with no turn by the deadline, or whose turn came at or
//! after it, answers `HOST_UMBEL_PLUGIN_BUSY` and never ran. A call that started and has not
//! finished before the deadline answers `OUTCOME_UNKNOWN`, which is not retryable, since it may
//! have made part of its change; its cancellation signal fires, and its result is never journaled
//! as the call's. A result finished at or after the deadline is late even when the host sees it
//! before its timer.
//!
//! At the deadline, and when the caller's future is dropped (a cancel, AFD's own timer), the
//! call's task is aborted. An async handler (a raw `Handler` or a `Definition`) is cancelled
//! there, as AFD's timeout cancelled it before, and its turn is given back. An SDK handler runs
//! the plugin on a blocking thread, which cannot be stopped: it moves a clone of the call's turn
//! ([`current_turn`]) onto that thread, so the turn stays taken, and the bound counts the call,
//! until the plugin returns; the plugin gets no host service after the deadline, and its late
//! result is logged and dropped.

use std::future::Future;
use std::sync::Arc;
use std::sync::atomic::{AtomicU8, Ordering};
use std::time::Duration;

use afd::{CancellationSignal, CommandContext, CommandHandler, CommandResult};
use async_trait::async_trait;
use serde_json::Value;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tokio::time::Instant;

/// The call has a turn and has not begun.
const PENDING: u8 = 0;
/// The plugin's code has begun.
const STARTED: u8 = 1;
/// The deadline passed before it began: it never will.
const ABANDONED: u8 = 2;

tokio::task_local! {
    /// The turn of the gated call running on this task.
    static TURN: Arc<OwnedSemaphorePermit>;
}

/// The turn of the gated call running on this task, for a handler that hands its work to a
/// thread the host cannot stop: holding a clone keeps the turn taken until that work ends, after
/// the call's task is aborted.
pub(super) fn current_turn() -> Option<Arc<OwnedSemaphorePermit>> {
    TURN.try_with(Arc::clone).ok()
}

/// A task aborted when this is dropped: when the caller's future goes, the call goes with it.
struct AbortOnDrop<T>(tokio::task::JoinHandle<T>);

impl<T> Drop for AbortOnDrop<T> {
    fn drop(&mut self) {
        self.0.abort();
    }
}

/// How much sooner than a caller's own `timeout_ms` the host answers, at most half of it: the
/// time AFD's registry spends before the handler starts, so the host's answer comes first.
const REGISTRY_MARGIN_MS: u64 = 1_000;

/// The bound and the deadline, shared by every compiled instance over one workspace.
pub(crate) struct CompiledGate {
    turns: Arc<Semaphore>,
    calls: u64,
    timeout: Duration,
}

/// Why a call got no turn.
enum Refused {
    Busy,
    Cancelled,
}

impl CompiledGate {
    /// A gate of `calls` turns (at least one) and a deadline of `timeout_ms`.
    pub(crate) fn new(calls: u64, timeout_ms: u64) -> Self {
        let calls = calls.clamp(1, crate::workspace::MAX_COMPILED_CALLS);
        Self {
            turns: Arc::new(Semaphore::new(usize::try_from(calls).unwrap_or(1))),
            calls,
            timeout: Duration::from_millis(timeout_ms.max(1)),
        }
    }

    /// The gate `limits` set.
    pub(crate) fn of(limits: crate::workspace::CallLimits) -> Self {
        Self::new(limits.compiled_calls, limits.compiled_timeout_ms)
    }

    /// The deadline of a call in `context` that started at `start`: none for a task, which its
    /// time to live and its cancellation bound, nor for the host's own command line, whose person
    /// can stop it.
    fn deadline(&self, context: &CommandContext, start: Instant) -> Option<Instant> {
        if context.is_task() || crate::authority::is_cli(context) {
            return None;
        }
        let mut timeout = self.timeout;
        if let Some(ms) = context.timeout_ms.filter(|&ms| ms > 0) {
            let sooner = ms - REGISTRY_MARGIN_MS.min(ms / 2);
            timeout = timeout.min(Duration::from_millis(sooner.max(1)));
        }
        Some(start + timeout)
    }

    /// A turn by `deadline`, unless `caller` is cancelled first.
    async fn turn(
        &self,
        deadline: Option<Instant>,
        caller: Option<&CancellationSignal>,
    ) -> Result<OwnedSemaphorePermit, Refused> {
        let acquire = Arc::clone(&self.turns).acquire_owned();
        let cancelled = async {
            match caller {
                Some(signal) => signal.cancelled().await,
                None => std::future::pending().await,
            }
        };
        let expired = async {
            match deadline {
                Some(deadline) => tokio::time::sleep_until(deadline).await,
                None => std::future::pending().await,
            }
        };
        let turn = tokio::select! {
            biased;
            () = cancelled => return Err(Refused::Cancelled),
            turn = acquire => turn.map_err(|_| Refused::Busy)?,
            () = expired => return Err(Refused::Busy),
        };
        // A turn that came at the deadline came too late: the call does not start.
        if deadline.is_some_and(|deadline| Instant::now() >= deadline) {
            return Err(Refused::Busy);
        }
        Ok(turn)
    }

    /// Run `call` for `instance`'s `command` in `context` under the bound and the deadline. The
    /// call runs on a task of its own, which holds the turn until `call` ends, even after the
    /// caller has its answer.
    pub(crate) async fn run<Fut>(
        &self,
        instance: &str,
        command: &str,
        context: CommandContext,
        call: impl FnOnce(CommandContext) -> Fut,
    ) -> CommandResult<Value>
    where
        Fut: Future<Output = CommandResult<Value>> + Send + 'static,
    {
        let start = Instant::now();
        let deadline = self.deadline(&context, start);
        let caller = context.cancellation().cloned();
        let trace_id = context.trace_id.clone();
        let turn = match self.turn(deadline, caller.as_ref()).await {
            Ok(turn) => turn,
            Err(Refused::Busy) => return afd::failure(busy(instance, command, self.calls)),
            Err(Refused::Cancelled) => return afd::failure(cancelled_before_turn(command)),
        };
        // A call with a deadline gets a signal of its own, linked to the caller's: firing it at
        // the deadline refuses the plugin every later host service.
        let signal = deadline.map(|_| {
            caller
                .as_ref()
                .map_or_else(CancellationSignal::new, CancellationSignal::child)
        });
        let context = match &signal {
            Some(signal) => context.with_cancellation(signal.clone()),
            None => context,
        };
        let state = Arc::new(AtomicU8::new(PENDING));
        let begun = Arc::clone(&state);
        let future = call(context);
        let turn = Arc::new(turn);
        let mut running = AbortOnDrop(tokio::spawn(async move {
            if begun
                .compare_exchange(PENDING, STARTED, Ordering::SeqCst, Ordering::SeqCst)
                .is_err()
            {
                return None;
            }
            let result = TURN.scope(turn, future).await;
            Some((result, Instant::now()))
        }));
        let joined = match deadline {
            None => (&mut running.0).await,
            Some(deadline) => match tokio::time::timeout_at(deadline, &mut running.0).await {
                Ok(joined) => joined,
                Err(_) => {
                    let never_began = state
                        .compare_exchange(PENDING, ABANDONED, Ordering::SeqCst, Ordering::SeqCst)
                        .is_ok();
                    if never_began {
                        return afd::failure(busy(instance, command, self.calls));
                    }
                    if let Some(signal) = &signal {
                        signal.cancel();
                    }
                    // Dropping `running` aborts the call: an async handler stops here and gives
                    // its turn back; an SDK handler's thread keeps its clone of the turn.
                    drop(running);
                    tracing::warn!(
                        plugin = %instance,
                        command = %command,
                        trace_id = trace_id.as_deref().unwrap_or_default(),
                        "a compiled-plugin call passed its deadline and was aborted (the caller was answered OUTCOME_UNKNOWN)"
                    );
                    return afd::failure(outcome_unknown(instance, command, deadline - start));
                }
            },
        };
        match joined {
            Ok(Some((result, finished))) => match deadline {
                Some(deadline) if finished >= deadline => {
                    if let Some(signal) = &signal {
                        signal.cancel();
                    }
                    tracing::warn!(
                        plugin = %instance,
                        command = %command,
                        late_ms = u64::try_from((finished - deadline).as_millis()).unwrap_or(u64::MAX),
                        "a compiled-plugin call finished at or after its deadline; its result was dropped (the caller was answered OUTCOME_UNKNOWN)"
                    );
                    afd::failure(outcome_unknown(instance, command, deadline - start))
                }
                _ => result,
            },
            Ok(None) => afd::failure(busy(instance, command, self.calls)),
            // A panic is AFD's COMMAND_EXECUTION_ERROR, as for any handler: let the registry
            // catch it, and the next call works.
            Err(error) if error.is_panic() => std::panic::resume_unwind(error.into_panic()),
            Err(error) => afd::failure(
                afd::CommandError::new(
                    afd::error_codes::INTERNAL_ERROR,
                    format!("plugin command `{command}` was cancelled: {error}"),
                )
                .with_suggestion("Retry the command.")
                .with_retryable(true),
            ),
        }
    }
}

impl std::fmt::Debug for CompiledGate {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CompiledGate")
            .field("calls", &self.calls)
            .field("timeout", &self.timeout)
            .field("free", &self.turns.available_permits())
            .finish()
    }
}

/// A compiled plugin's handler under `gate`.
pub(super) struct Gated {
    pub(super) inner: Arc<dyn CommandHandler>,
    pub(super) instance: String,
    pub(super) command: String,
    pub(super) gate: Arc<CompiledGate>,
}

#[async_trait]
impl CommandHandler for Gated {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let inner = Arc::clone(&self.inner);
        self.gate
            .run(
                &self.instance,
                &self.command,
                context,
                move |context| async move { inner.execute(input, context).await },
            )
            .await
    }
}

/// `handler` under `gate`, or as it is when there is none (a plugin that is not compiled).
pub(super) fn gated(
    gate: Option<&Arc<CompiledGate>>,
    instance: &str,
    command: &str,
    handler: Arc<dyn CommandHandler>,
) -> Arc<dyn CommandHandler> {
    match gate {
        Some(gate) => Arc::new(Gated {
            inner: handler,
            instance: instance.to_owned(),
            command: command.to_owned(),
            gate: Arc::clone(gate),
        }),
        None => handler,
    }
}

/// `HOST_UMBEL_PLUGIN_BUSY`: no turn came in time; the call did not run. Retryable.
fn busy(instance: &str, command: &str, calls: u64) -> afd::CommandError {
    afd::CommandError::new(
        super::codes::HOST_UMBEL_PLUGIN_BUSY,
        format!(
            "plugins.{instance}: `{command}` did not run: the host's {calls} compiled-plugin calls (limits.compiled_calls) stayed busy until its deadline"
        ),
    )
    .with_suggestion(
        "Retry in a moment; the command did not run. If it persists, raise limits.compiled_calls.",
    )
    .with_retryable(true)
}

/// `COMMAND_CANCELLED`: the caller cancelled the call while it waited for a turn.
fn cancelled_before_turn(command: &str) -> afd::CommandError {
    afd::CommandError::new(
        afd::error_codes::COMMAND_CANCELLED,
        format!("`{command}` was cancelled while it waited for a turn; it did not run"),
    )
    .with_suggestion("Call the command again when it is wanted.")
    .with_retryable(false)
}

/// `OUTCOME_UNKNOWN` (`spec/error-codes.md`): the call started and passed its deadline, so it
/// may have made its change. Not retryable.
fn outcome_unknown(instance: &str, command: &str, after: Duration) -> afd::CommandError {
    afd::CommandError::new(
        super::codes::OUTCOME_UNKNOWN,
        format!(
            "plugins.{instance}: `{command}` ran past its deadline ({} ms, limits.compiled_timeout_ms); it may still finish, and may have made its change",
            after.as_millis()
        ),
    )
    .with_suggestion(
        "Check the command's effect (read what it changes) before calling it again; do not retry blindly.",
    )
    .with_retryable(false)
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use std::sync::atomic::AtomicBool;

    use super::*;

    const MS: Duration = Duration::from_millis(1);

    fn code(result: &CommandResult<Value>) -> &str {
        assert!(!result.success, "{result:?}");
        result.error.as_ref().unwrap().code.as_str()
    }

    /// Run a call that sleeps `sleep`, then answers success; and whether it began.
    async fn run(
        gate: &CompiledGate,
        context: CommandContext,
        sleep: Duration,
    ) -> (CommandResult<Value>, bool) {
        let ran = Arc::new(AtomicBool::new(false));
        let began = Arc::clone(&ran);
        let result = gate
            .run("p", "p-cmd", context, move |_| async move {
                began.store(true, Ordering::SeqCst);
                tokio::time::sleep(sleep).await;
                afd::success(serde_json::json!({ "done": true }))
            })
            .await;
        (result, ran.load(Ordering::SeqCst))
    }

    #[tokio::test(start_paused = true)]
    async fn a_call_that_ends_before_its_deadline_answers_its_result() {
        let gate = CompiledGate::new(1, 100);
        let (result, ran) = run(&gate, CommandContext::default(), 99 * MS).await;
        assert!(result.success, "{result:?}");
        assert!(ran);
    }

    #[tokio::test(start_paused = true)]
    async fn a_call_that_ends_at_its_deadline_is_late() {
        let gate = CompiledGate::new(1, 100);
        let (result, ran) = run(&gate, CommandContext::default(), 100 * MS).await;
        assert_eq!(code(&result), "OUTCOME_UNKNOWN");
        assert_eq!(result.error.as_ref().unwrap().retryable, Some(false));
        assert!(ran);
    }

    /// Let the runtime run the aborts and drops it has queued.
    async fn settle() {
        for _ in 0..8 {
            tokio::task::yield_now().await;
        }
    }

    /// Sets its flag when dropped: the future holding it was cancelled.
    struct Dropped(Arc<AtomicBool>);

    impl Drop for Dropped {
        fn drop(&mut self) {
            self.0.store(true, Ordering::SeqCst);
        }
    }

    #[tokio::test(start_paused = true)]
    async fn an_async_handler_that_never_returns_is_cancelled_at_the_deadline_and_frees_its_turn() {
        let gate = CompiledGate::new(1, 100);
        let dropped = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&dropped);
        let result = gate
            .run(
                "p",
                "p-cmd",
                CommandContext::default(),
                move |_| async move {
                    let _dropped = Dropped(flag);
                    std::future::pending::<CommandResult<Value>>().await
                },
            )
            .await;
        assert_eq!(code(&result), "OUTCOME_UNKNOWN");
        settle().await;
        assert!(dropped.load(Ordering::SeqCst), "the handler was cancelled");
        assert_eq!(gate.turns.available_permits(), 1, "its turn is free");
        let (next, ran) = run(&gate, CommandContext::default(), MS).await;
        assert!(next.success, "the next call is admitted: {next:?}");
        assert!(ran);
    }

    #[tokio::test(start_paused = true)]
    async fn a_dropped_caller_cancels_an_async_handler() {
        let gate = Arc::new(CompiledGate::new(1, 10_000));
        let dropped = Arc::new(AtomicBool::new(false));
        let (flag, entered) = (Arc::clone(&dropped), Arc::new(tokio::sync::Notify::new()));
        let started = Arc::clone(&entered);
        let calling = Arc::clone(&gate);
        let caller = tokio::spawn(async move {
            calling
                .run(
                    "p",
                    "p-cmd",
                    CommandContext::default(),
                    move |_| async move {
                        let _dropped = Dropped(flag);
                        started.notify_one();
                        std::future::pending::<CommandResult<Value>>().await
                    },
                )
                .await
        });
        entered.notified().await;
        assert_eq!(gate.turns.available_permits(), 0);
        caller.abort();
        settle().await;
        assert!(
            dropped.load(Ordering::SeqCst),
            "the handler was cancelled with its caller"
        );
        assert_eq!(gate.turns.available_permits(), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn a_thread_holding_the_calls_turn_keeps_it_after_the_deadline_until_it_ends() {
        let gate = CompiledGate::new(1, 100);
        let (release, released) = std::sync::mpsc::channel::<()>();
        let result = gate
            .run(
                "p",
                "p-cmd",
                CommandContext::default(),
                move |_| async move {
                    // As the SDK handler does: the blocking thread holds a clone of the turn.
                    let turn = current_turn().expect("a gated call has a turn");
                    std::thread::spawn(move || {
                        let _turn = turn;
                        let _ = released.recv();
                    });
                    std::future::pending::<CommandResult<Value>>().await
                },
            )
            .await;
        assert_eq!(code(&result), "OUTCOME_UNKNOWN");
        settle().await;
        assert_eq!(
            gate.turns.available_permits(),
            0,
            "the thread still holds the turn"
        );
        drop(release);
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while gate.turns.available_permits() == 0 {
            assert!(std::time::Instant::now() < deadline, "the turn came back");
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
    }

    #[tokio::test(start_paused = true)]
    async fn a_turn_that_comes_at_the_deadline_is_too_late_and_the_call_never_runs() {
        let gate = CompiledGate::new(1, 100);
        let held = Arc::clone(&gate.turns).acquire_owned().await.unwrap();
        tokio::spawn(async move {
            tokio::time::sleep(100 * MS).await;
            drop(held);
        });
        let (result, ran) = run(&gate, CommandContext::default(), MS).await;
        assert_eq!(code(&result), "HOST_UMBEL_PLUGIN_BUSY");
        assert_eq!(result.error.as_ref().unwrap().retryable, Some(true));
        assert!(!ran, "the call never started");
    }

    #[tokio::test(start_paused = true)]
    async fn a_call_cancelled_while_it_waits_answers_cancelled_and_never_runs() {
        let gate = CompiledGate::new(1, 10_000);
        let _held = Arc::clone(&gate.turns).acquire_owned().await.unwrap();
        let signal = CancellationSignal::new();
        let cancel = signal.clone();
        tokio::spawn(async move {
            tokio::time::sleep(50 * MS).await;
            cancel.cancel();
        });
        let started = Instant::now();
        let context = CommandContext::default().with_cancellation(signal);
        let (result, ran) = run(&gate, context, MS).await;
        assert_eq!(code(&result), "COMMAND_CANCELLED");
        assert_eq!(started.elapsed(), 50 * MS);
        assert!(!ran);
    }

    #[tokio::test(start_paused = true)]
    async fn a_callers_shorter_timeout_brings_the_deadline_forward() {
        let gate = CompiledGate::new(2, 25_000);
        let mut context = CommandContext::default();
        context.timeout_ms = Some(400);
        let started = Instant::now();
        let (result, _) = run(&gate, context, 10_000 * MS).await;
        assert_eq!(code(&result), "OUTCOME_UNKNOWN");
        assert_eq!(
            started.elapsed(),
            200 * MS,
            "half the caller's 400 ms, under the margin"
        );
        let mut context = CommandContext::default();
        context.timeout_ms = Some(5_000);
        let started = Instant::now();
        let (result, _) = run(&gate, context, 10_000 * MS).await;
        assert_eq!(code(&result), "OUTCOME_UNKNOWN");
        assert_eq!(
            started.elapsed(),
            4_000 * MS,
            "a second before the caller's deadline"
        );
    }
}

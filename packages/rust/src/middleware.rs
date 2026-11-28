//! Built-in command middleware, as TypeScript's `@lushly-dev/afd-server` and C++'s
//! `afd/middleware.hpp` ship it: a trace ID, logging and timing ([`default_middleware`]), retry,
//! rate limiting, telemetry and [`compose_middleware`].
//!
//! Each one is a [`CommandMiddleware`] for [`CommandRegistry::add_middleware`]. The first added
//! is the outermost, so add the trace-ID middleware first (as [`default_middleware`] orders it)
//! and a retrying middleware before the approval middleware.
//!
//! The trace ID, logging, timing and rate-limit middleware read their own clock and random
//! source ([`SYSTEM_CLOCK`] and [`SYSTEM_RANDOM`] unless the options name others), never the
//! context's. The telemetry middleware reads the context's clock, as TypeScript's does, except
//! while a journal records or replays the call, when it reads the journal's untaped clock. So a
//! journaled call's tape holds only what the command itself read, whichever of these is added.
//!
//! The logging and telemetry middleware see a command that panics: they log its `Error` line or
//! record an `UNHANDLED_ERROR` event, then let the panic continue to the registry, which answers
//! `COMMAND_EXECUTION_ERROR`.
//!
//! TypeScript's OpenTelemetry-shaped tracing middleware has no counterpart: a Rust host wraps
//! calls in spans with the `tracing` crate (or OpenTelemetry's own crates) in a middleware of its
//! own, so this crate does not pick a tracing dependency for it.
//!
//! [`CommandRegistry::add_middleware`]: crate::CommandRegistry::add_middleware
//! [`SYSTEM_CLOCK`]: crate::clock::SYSTEM_CLOCK
//! [`SYSTEM_RANDOM`]: crate::clock::SYSTEM_RANDOM

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex, PoisonError};

use futures_util::FutureExt;

use serde_json::Value;

use crate::clock::{Clock, RandomSource, SystemClock, SystemRandom};
use crate::commands::{BoxFuture, CallState, CommandContext, CommandMiddleware, MiddlewareNext};
use crate::errors::{error_codes, CommandError};
use crate::result::{failure, CommandResult};
use crate::telemetry::{TelemetryEvent, TelemetrySink};

pub(crate) mod process_state;

// ═══════════════════════════════════════════════════════════════════════════════
// TRACE ID
// ═══════════════════════════════════════════════════════════════════════════════

/// Makes a trace ID.
pub type TraceIdGenerator = Arc<dyn Fn() -> String + Send + Sync>;

/// Options for [`create_auto_trace_id_middleware`].
#[derive(Clone, Default)]
pub struct TraceIdOptions {
    /// Makes an ID. Defaults to a random UUID v4 drawn from `random`.
    pub generate: Option<TraceIdGenerator>,
    /// Randomness for the default generator. Defaults to [`SystemRandom`].
    pub random: Option<Arc<dyn RandomSource>>,
}

/// Sets `context.trace_id` when the call has none, so the layers after it and the handler see
/// one. A caller's own trace ID is kept.
///
/// The ID reaches the layers after it and the handler; the registry does not stamp it on the
/// result's metadata (TypeScript's and C++'s registries do; Rust's is a tracked gap). The
/// registry's journal records the context as it was before the middleware chain, so a journaled
/// call's `traceId` is the caller's, not one this middleware made.
pub fn create_auto_trace_id_middleware(options: TraceIdOptions) -> CommandMiddleware {
    let generate: TraceIdGenerator = match options.generate {
        Some(generate) => generate,
        None => {
            let random = options.random.unwrap_or_else(|| Arc::new(SystemRandom));
            Arc::new(move || random_uuid(random.as_ref()))
        }
    };
    Arc::new(move |_name, _input, mut context, next| {
        if context.trace_id.as_deref().is_none_or(str::is_empty) {
            context.trace_id = Some(generate());
        }
        next(context)
    })
}

/// A random UUID v4 (`xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`) drawn from `random`.
pub fn random_uuid(random: &dyn RandomSource) -> String {
    let mut bytes = [0u8; 16];
    for byte in &mut bytes {
        // `next` is in [0, 1), so this is 0..=255.
        *byte = (random.next() * 256.0) as u8;
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOGGING
// ═══════════════════════════════════════════════════════════════════════════════

/// Receives a log line and, when asked for, the input or the result.
pub type LogFn = Arc<dyn Fn(&str, Option<&Value>) + Send + Sync>;

/// Options for [`create_logging_middleware`].
#[derive(Clone, Default)]
pub struct LoggingOptions {
    /// Receives each line. Defaults to standard error.
    pub log: Option<LogFn>,
    /// Pass the validated input with the "Executing" line (may hold sensitive data).
    pub log_input: bool,
    /// Pass the result with the "Completed" line (may hold sensitive data).
    pub log_result: bool,
    /// Measures the duration. Defaults to [`SystemClock`].
    pub clock: Option<Arc<dyn Clock>>,
}

/// Logs `[<traceId>] Executing: <name>` before the call and
/// `[<traceId>] Completed: <name> (<ms>ms) - SUCCESS|FAILURE` after it, with `no-trace` when the
/// call has no trace ID.
pub fn create_logging_middleware(options: LoggingOptions) -> CommandMiddleware {
    let log: LogFn = options.log.unwrap_or_else(|| {
        Arc::new(|line: &str, data: Option<&Value>| match data {
            Some(data) => eprintln!("{line} {data}"),
            None => eprintln!("{line}"),
        })
    });
    let clock = options.clock.unwrap_or_else(|| Arc::new(SystemClock));
    let (log_input, log_result) = (options.log_input, options.log_result);
    Arc::new(move |name, input, context, next| {
        let (log, clock) = (Arc::clone(&log), Arc::clone(&clock));
        Box::pin(async move {
            let trace = context
                .trace_id
                .clone()
                .unwrap_or_else(|| "no-trace".into());
            let start = clock.now();
            let started = format!("[{trace}] Executing: {name}");
            if log_input {
                log(&started, Some(&serde_json::json!({ "input": &*input })));
            } else {
                log(&started, None);
            }
            let result = match std::panic::AssertUnwindSafe(async move { next(context).await })
                .catch_unwind()
                .await
            {
                Ok(result) => result,
                Err(panic) => {
                    let ms = clock.now().saturating_sub(start);
                    log(&format!("[{trace}] Error: {name} ({ms}ms)"), None);
                    std::panic::resume_unwind(panic);
                }
            };
            let outcome = if result.success { "SUCCESS" } else { "FAILURE" };
            let ms = clock.now().saturating_sub(start);
            let completed = format!("[{trace}] Completed: {name} ({ms}ms) - {outcome}");
            if log_result {
                let data = serde_json::to_value(&result).unwrap_or(Value::Null);
                log(&completed, Some(&serde_json::json!({ "result": data })));
            } else {
                log(&completed, None);
            }
            result
        })
    })
}

// ═══════════════════════════════════════════════════════════════════════════════
// TIMING
// ═══════════════════════════════════════════════════════════════════════════════

/// Receives a slow command's name and duration in milliseconds.
pub type SlowFn = Arc<dyn Fn(&str, i64) + Send + Sync>;

/// Options for [`create_timing_middleware`].
#[derive(Clone)]
pub struct TimingOptions {
    /// Commands slower than this many milliseconds are reported (default 1000).
    pub slow_threshold_ms: i64,
    /// Receives slow commands. Defaults to `Slow command: <name> took <ms>ms` on standard error.
    pub on_slow: Option<SlowFn>,
    /// Measures the duration. Defaults to [`SystemClock`].
    pub clock: Option<Arc<dyn Clock>>,
}

impl Default for TimingOptions {
    fn default() -> Self {
        Self {
            slow_threshold_ms: 1000,
            on_slow: None,
            clock: None,
        }
    }
}

/// Reports commands slower than `slow_threshold_ms`. It only reports: the registry's own
/// metadata is unchanged.
pub fn create_timing_middleware(options: TimingOptions) -> CommandMiddleware {
    let on_slow: SlowFn = options.on_slow.unwrap_or_else(|| {
        Arc::new(|name: &str, ms: i64| eprintln!("Slow command: {name} took {ms}ms"))
    });
    let clock = options.clock.unwrap_or_else(|| Arc::new(SystemClock));
    let threshold = options.slow_threshold_ms;
    Arc::new(move |name, _input, context, next| {
        let (on_slow, clock) = (Arc::clone(&on_slow), Arc::clone(&clock));
        Box::pin(async move {
            let start = clock.now();
            let result = next(context).await;
            let ms = clock.now().saturating_sub(start);
            if ms > threshold {
                on_slow(&name, ms);
            }
            result
        })
    })
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEFAULT BUNDLE
// ═══════════════════════════════════════════════════════════════════════════════

/// Options for [`default_middleware`]; `None` leaves that middleware out.
#[derive(Clone)]
pub struct DefaultMiddlewareOptions {
    /// The trace-ID middleware (on by default).
    pub trace_id: Option<TraceIdOptions>,
    /// The logging middleware (on by default).
    pub logging: Option<LoggingOptions>,
    /// The timing middleware (on by default).
    pub timing: Option<TimingOptions>,
}

impl Default for DefaultMiddlewareOptions {
    fn default() -> Self {
        Self {
            trace_id: Some(TraceIdOptions::default()),
            logging: Some(LoggingOptions::default()),
            timing: Some(TimingOptions::default()),
        }
    }
}

/// The trace-ID middleware (outermost, so the others see the ID), then logging, then timing.
/// Add each to the registry in order.
pub fn default_middleware(options: DefaultMiddlewareOptions) -> Vec<CommandMiddleware> {
    let mut stack = Vec::with_capacity(3);
    if let Some(trace_id) = options.trace_id {
        stack.push(create_auto_trace_id_middleware(trace_id));
    }
    if let Some(logging) = options.logging {
        stack.push(create_logging_middleware(logging));
    }
    if let Some(timing) = options.timing {
        stack.push(create_timing_middleware(timing));
    }
    stack
}

// ═══════════════════════════════════════════════════════════════════════════════
// RETRY
// ═══════════════════════════════════════════════════════════════════════════════

/// Decides from an error code whether to retry.
pub type ShouldRetryFn = Arc<dyn Fn(&str) -> bool + Send + Sync>;

/// Waits the given number of milliseconds.
pub type SleepFn = Arc<dyn Fn(u64) -> BoxFuture<'static, ()> + Send + Sync>;

/// Options for [`create_retry_middleware`].
#[derive(Clone)]
pub struct RetryOptions {
    /// Retries after the first attempt (default 3).
    pub max_retries: u32,
    /// Base backoff in milliseconds (default 100): retry `n` (from 1) waits
    /// `min(max_delay_ms, retry_delay_ms * 2^(n - 1))`.
    pub retry_delay_ms: u64,
    /// Upper bound on the backoff before jitter (default 5000).
    pub max_delay_ms: u64,
    /// Wait a uniformly random time in `[backoff / 2, backoff]` instead (default `true`).
    pub jitter: bool,
    /// Whether to retry a failure with this error code. Defaults to `TRANSIENT_ERROR` and
    /// `TIMEOUT`.
    pub should_retry: Option<ShouldRetryFn>,
    /// Randomness for the jitter. Defaults to [`SystemRandom`].
    pub random: Option<Arc<dyn RandomSource>>,
    /// Waits between attempts. Defaults to `tokio::time::sleep` (the `native` feature).
    pub sleep: Option<SleepFn>,
    /// Retry every command, whatever it declares (default `false`; `spec/idempotency.md`, R2).
    /// Without it, a command is retried only when it declares `idempotency` `natural`, declares
    /// `keyed` and the call carries an idempotency key, or does not declare
    /// [`mutation`](crate::CommandDefinition::as_mutation). A failed mutation, such as one whose
    /// handler returned `TIMEOUT` after a downstream write, may already have applied its change,
    /// so retrying it can apply it twice. Set this only when every mutation the middleware wraps
    /// is safe to repeat.
    pub retry_mutations: bool,
}

impl Default for RetryOptions {
    fn default() -> Self {
        Self {
            max_retries: 3,
            retry_delay_ms: 100,
            max_delay_ms: 5_000,
            jitter: true,
            should_retry: None,
            random: None,
            sleep: None,
            retry_mutations: false,
        }
    }
}

/// The wait before retry `retry` (from 1), before jitter.
fn backoff(retry: u32, base_ms: u64, max_ms: u64) -> u64 {
    let factor = 1u64
        .checked_shl(retry.saturating_sub(1))
        .unwrap_or(u64::MAX);
    base_ms.saturating_mul(factor).min(max_ms)
}

/// Retries a failure whose error code `should_retry` accepts, with capped exponential backoff
/// and optional jitter, at most `max_retries` times, and returns the last result. A call whose
/// cancellation signal fires stops waiting and returns the last failure. Each attempt runs the
/// rest of the chain with a copy of the context.
///
/// Which commands it repeats follows the command's declaration (`spec/idempotency.md`, R1): one
/// that declares [`Natural`](crate::IdempotencySupport::Natural) is repeated; one that declares
/// [`Keyed`](crate::IdempotencySupport::Keyed) only when the call carries an idempotency key and
/// is not a task run; any other unless it declares `mutation`. [`RetryOptions::retry_mutations`]
/// restores retrying every command (R2). The middleware reads the declaration from the command the registry runs for the call,
/// never from its name; a call whose declaration it cannot read (outside
/// [`CommandRegistry::execute`](crate::CommandRegistry::execute), or with a context kept past
/// the call that made it) counts as a mutation. Unlike TypeScript, Python and C++, it does not
/// check that `next` is the registry's own continuation.
///
/// Add it before the approval middleware. There, a retry of a gated command reaches the approval
/// step again, which holds it for a new approval (a token works once). After it, the registry
/// refuses the second dispatch (`APPROVAL_UNAVAILABLE`, `admission-mismatch`).
///
/// # Errors
/// Without the `native` feature, a missing `sleep` is refused, since nothing could wait.
pub fn create_retry_middleware(options: RetryOptions) -> Result<CommandMiddleware, String> {
    let sleep = match options.sleep {
        Some(sleep) => sleep,
        None => default_sleep()?,
    };
    let should_retry: ShouldRetryFn = options.should_retry.unwrap_or_else(|| {
        Arc::new(|code: &str| code == "TRANSIENT_ERROR" || code == error_codes::TIMEOUT)
    });
    let random = options.random.unwrap_or_else(|| Arc::new(SystemRandom));
    let (max_retries, base, max, jitter, retry_mutations) = (
        options.max_retries,
        options.retry_delay_ms,
        options.max_delay_ms,
        options.jitter,
        options.retry_mutations,
    );
    Ok(Arc::new(move |name, _input, context, next| {
        // The registry's record of the command this call runs, which only it sets, while that call
        // runs and when it names the command this middleware was given.
        let repeatable = retry_mutations
            || context
                .approval_admission
                .as_deref()
                .and_then(|admission| admission.live_declaration(&name))
                .is_some_and(repeatable);
        let (sleep, should_retry, random) = (
            Arc::clone(&sleep),
            Arc::clone(&should_retry),
            Arc::clone(&random),
        );
        Box::pin(async move {
            let mut result = next(context.clone()).await;
            if !repeatable {
                return result;
            }
            for retry in 1..=max_retries {
                let retryable = result
                    .error
                    .as_ref()
                    .is_some_and(|error| !result.success && should_retry(&error.code));
                if !retryable {
                    return result;
                }
                let wait = backoff(retry, base, max);
                let wait = if jitter {
                    // A source outside [0, 1) is clamped, as C++ does.
                    let unit = Some(random.next())
                        .filter(|unit| unit.is_finite())
                        .map_or(0.0, |unit| unit.clamp(0.0, 1.0));
                    wait / 2 + (unit * (wait - wait / 2) as f64) as u64
                } else {
                    wait
                };
                if !wait_unless_cancelled(&sleep, wait, &context).await {
                    return result;
                }
                result = next(context.clone()).await;
            }
            result
        })
    }))
}

/// Whether a call may be repeated, from its command's declaration (`spec/idempotency.md`, R1), in
/// order: a `natural` command is; a `keyed` one only when the call carries a key (and is not a
/// task run); any other unless it declares `mutation`.
fn repeatable(declaration: crate::approval::admission::RetryDeclaration) -> bool {
    match declaration.idempotency {
        Some(crate::IdempotencySupport::Natural) => true,
        Some(crate::IdempotencySupport::Keyed) => declaration.carries_key,
        None => !declaration.mutation,
    }
}

#[cfg(feature = "native")]
fn default_sleep() -> Result<SleepFn, String> {
    Ok(Arc::new(|ms| {
        Box::pin(tokio::time::sleep(std::time::Duration::from_millis(ms)))
    }))
}

#[cfg(not(feature = "native"))]
fn default_sleep() -> Result<SleepFn, String> {
    Err("Retry middleware needs the native feature or RetryOptions::sleep".to_string())
}

/// Waits `ms`, ending early when the call's cancellation signal fires: `false` when it did.
async fn wait_unless_cancelled(sleep: &SleepFn, ms: u64, context: &CommandContext) -> bool {
    let Some(signal) = context.cancellation() else {
        sleep(ms).await;
        return true;
    };
    if signal.is_cancelled() {
        return false;
    }
    let waited = sleep(ms);
    let cancelled = signal.cancelled();
    futures_util::pin_mut!(waited, cancelled);
    match futures_util::future::select(waited, cancelled).await {
        futures_util::future::Either::Left(_) => !signal.is_cancelled(),
        futures_util::future::Either::Right(_) => false,
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// RATE LIMIT
// ═══════════════════════════════════════════════════════════════════════════════

/// Names the budget a call counts against.
pub type KeyFn = Arc<dyn Fn(&CommandContext) -> String + Send + Sync>;

/// Options for [`create_rate_limit_middleware`].
#[derive(Clone)]
pub struct RateLimitOptions {
    /// Calls allowed per window and key (default 100).
    pub max_requests: u32,
    /// The window in milliseconds (default 60000). Must be positive.
    pub window_ms: i64,
    /// Keys kept at once (default 10000). A new key past it is refused until a window ends.
    /// Must be positive.
    pub max_keys: usize,
    /// The budget a call counts against. Defaults to one shared budget (`"global"`); never key
    /// on the trace ID, which is new for every call.
    pub key_fn: Option<KeyFn>,
    /// Drives the windows. Defaults to [`SystemClock`].
    pub clock: Option<Arc<dyn Clock>>,
}

impl Default for RateLimitOptions {
    fn default() -> Self {
        Self {
            max_requests: 100,
            window_ms: 60_000,
            max_keys: 10_000,
            key_fn: None,
            clock: None,
        }
    }
}

/// One key's fixed window.
struct Window {
    count: u32,
    reset_at: i64,
}

/// The windows by key, and the keys in the order their windows end (every window is the same
/// length, so that is the order they were opened).
#[derive(Default)]
struct Windows {
    by_key: HashMap<String, Window>,
    order: VecDeque<(String, i64)>,
}

/// Allows `max_requests` calls per key in each fixed window of `window_ms` and refuses the rest
/// with `RATE_LIMITED` (`retryable: true`) without running them. At most `max_keys` keys are kept;
/// a new key past that is refused until a window ends.
///
/// # Errors
/// `window_ms` or `max_keys` is not positive.
pub fn create_rate_limit_middleware(
    options: RateLimitOptions,
) -> Result<CommandMiddleware, String> {
    if options.window_ms <= 0 || options.max_keys == 0 {
        return Err("Rate limit max_keys and window_ms must be positive".to_string());
    }
    let key_fn: KeyFn = options
        .key_fn
        .unwrap_or_else(|| Arc::new(|_: &CommandContext| "global".to_string()));
    let clock = options.clock.unwrap_or_else(|| Arc::new(SystemClock));
    let windows = Arc::new(Mutex::new(Windows::default()));
    let (max_requests, window_ms, max_keys) =
        (options.max_requests, options.window_ms, options.max_keys);
    Ok(Arc::new(move |_name, _input, context, next| {
        let key = key_fn(&context);
        let refused = {
            let mut windows = windows.lock().unwrap_or_else(PoisonError::into_inner);
            // Read under the lock, so windows open in the order their deadlines fall.
            let now = clock.now();
            admit(&mut windows, key, now, max_requests, window_ms, max_keys)
        };
        match refused {
            Some(error) => Box::pin(std::future::ready(failure(error))),
            None => next(context),
        }
    }))
}

/// Counts a call for `key` at `now`, or the error that refuses it.
fn admit(
    windows: &mut Windows,
    key: String,
    now: i64,
    max_requests: u32,
    window_ms: i64,
    max_keys: usize,
) -> Option<CommandError> {
    // Windows end in the order they opened, so the ended ones are at the front.
    while let Some((_, reset_at)) = windows.order.front() {
        if *reset_at > now {
            break;
        }
        let (ended, reset_at) = windows.order.pop_front().expect("the front exists");
        if windows
            .by_key
            .get(&ended)
            .is_some_and(|window| window.reset_at == reset_at)
        {
            windows.by_key.remove(&ended);
        }
    }
    let open = windows
        .by_key
        .get(&key)
        .is_some_and(|window| now < window.reset_at);
    if !open {
        if !windows.by_key.contains_key(&key) && windows.by_key.len() >= max_keys {
            return Some(
                CommandError::new(
                    error_codes::RATE_LIMITED,
                    "Rate limit client capacity reached",
                )
                .with_suggestion("Retry after the current rate limit window expires")
                .with_retryable(true)
                .with_recovery(crate::errors::Recovery::engine_retry(None)),
            );
        }
        let reset_at = now.saturating_add(window_ms);
        windows
            .by_key
            .insert(key.clone(), Window { count: 0, reset_at });
        windows.order.push_back((key.clone(), reset_at));
    }
    let window = windows.by_key.get_mut(&key).expect("the window is open");
    if window.count >= max_requests {
        let seconds = window.reset_at.saturating_sub(now).saturating_add(999) / 1000;
        return Some(
            CommandError::new(error_codes::RATE_LIMITED, "Too many requests")
                .with_suggestion(format!("Try again in {seconds} seconds"))
                .with_retryable(true)
                .with_recovery(crate::errors::Recovery::engine_retry(
                    u64::try_from(seconds).ok(),
                )),
        );
    }
    window.count += 1;
    None
}

// ═══════════════════════════════════════════════════════════════════════════════
// TELEMETRY
// ═══════════════════════════════════════════════════════════════════════════════

/// Decides from a command's name whether to record it.
pub type CommandFilter = Arc<dyn Fn(&str) -> bool + Send + Sync>;

/// Options for [`create_telemetry_middleware`].
#[derive(Clone)]
pub struct TelemetryOptions {
    /// Where the events go.
    pub sink: Arc<dyn TelemetrySink>,
    /// Include the validated input (may hold sensitive data; default `false`).
    pub include_input: bool,
    /// Include the result's metadata (default `true`).
    pub include_metadata: bool,
    /// Which commands to record. Defaults to every command.
    pub filter: Option<CommandFilter>,
}

impl TelemetryOptions {
    /// Record every command to `sink`, without the input and with the metadata.
    pub fn new(sink: Arc<dyn TelemetrySink>) -> Self {
        Self {
            sink,
            include_input: false,
            include_metadata: true,
            filter: None,
        }
    }
}

/// Records a [`TelemetryEvent`] for each call `filter` accepts: start and end times from the
/// context's clock, success, the error of a failure, the trace ID, the actor kind, the
/// confidence, the command version and (as the options say) the input and the metadata. A sink
/// that panics never affects the call.
pub fn create_telemetry_middleware(options: TelemetryOptions) -> CommandMiddleware {
    let options = Arc::new(options);
    Arc::new(move |name, input, context, next| {
        let options = Arc::clone(&options);
        Box::pin(async move {
            if options.filter.as_ref().is_some_and(|filter| !filter(&name)) {
                return next(context).await;
            }
            // The journal's untaped clock while one records or replays the call, so these
            // readings never reach its tape.
            let clock = context
                .journal_state
                .untaped_clock
                .clone()
                .or_else(|| context.clock.clone());
            let now = || {
                clock
                    .as_deref()
                    .map_or_else(|| SystemClock.now(), Clock::now)
            };
            let trace_id = context.trace_id.clone().filter(|id| !id.is_empty());
            let actor_kind = context.actor.as_ref().map(|actor| actor.kind);
            let start = now();
            let outcome = std::panic::AssertUnwindSafe(async move { next(context).await })
                .catch_unwind()
                .await;
            let end = now();
            let unhandled = failure(CommandError::new("UNHANDLED_ERROR", "The command panicked"));
            let recorded = outcome.as_ref().unwrap_or(&unhandled);
            let event = telemetry_event(&options, &name, &input, recorded, start, end)
                .map(|event| match trace_id {
                    Some(trace_id) => event.with_trace_id(trace_id),
                    None => event,
                })
                .map(|event| match actor_kind {
                    Some(kind) => event.with_actor_kind(kind),
                    None => event,
                });
            if let Some(event) = event {
                let sink = Arc::clone(&options.sink);
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    sink.record(&event);
                }));
            }
            match outcome {
                Ok(result) => result,
                Err(panic) => std::panic::resume_unwind(panic),
            }
        })
    })
}

fn telemetry_event(
    options: &TelemetryOptions,
    name: &str,
    input: &Value,
    result: &CommandResult<Value>,
    start: i64,
    end: i64,
) -> Option<TelemetryEvent> {
    let started_at = crate::journal::iso_timestamp(start)?;
    let completed_at = crate::journal::iso_timestamp(end)?;
    let mut event = TelemetryEvent::new(name, started_at, completed_at, result.success)
        .with_duration_ms(u64::try_from(end.saturating_sub(start)).unwrap_or(0));
    if !result.success {
        if let Some(error) = &result.error {
            event = event.with_error(error.clone());
        }
    }
    if options.include_input {
        event = event.with_input(input.clone());
    }
    if let Some(confidence) = result.confidence {
        event = event.with_confidence(confidence);
    }
    if let Some(metadata) = &result.metadata {
        if let Some(version) = &metadata.command_version {
            event = event.with_command_version(version.clone());
        }
        if options.include_metadata {
            if let Ok(Value::Object(map)) = serde_json::to_value(metadata) {
                event = event.with_metadata(map.into_iter().collect());
            }
        }
    }
    Some(event)
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPOSITION
// ═══════════════════════════════════════════════════════════════════════════════

/// One middleware that runs `middlewares` in order, the first outermost, then the rest of the
/// registry's chain, as adding each in turn would: each inner layer gets the call's own state
/// back, as the registry's layers do, whatever context the one before it passes on.
pub fn compose_middleware(middlewares: Vec<CommandMiddleware>) -> CommandMiddleware {
    let middlewares: Arc<[CommandMiddleware]> = middlewares.into();
    let parts = Arc::clone(&middlewares);
    let composed: CommandMiddleware = Arc::new(move |name, input, context, next| {
        let state = Arc::new(CallState::of(&context));
        let chain = middlewares.iter().rev().fold(next, |next, layer| {
            let layer = Arc::clone(layer);
            let name = name.clone();
            let input = Arc::clone(&input);
            let state = Arc::clone(&state);
            let step: MiddlewareNext = Arc::new(move |mut context| {
                state.restore(&mut context);
                layer(name.clone(), Arc::clone(&input), context, Arc::clone(&next))
            });
            step
        });
        chain(context)
    });
    process_state::carry_approval_process_state(&composed, &parts);
    composed
}

#[cfg(test)]
mod tests;

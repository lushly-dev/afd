// Built-in command middleware: trace IDs, logging, timing, retry, rate limiting, telemetry and
// composition (packages/server/src/middleware.ts).
#pragma once

#include "afd/command.hpp"
#include "afd/expected.hpp"
#include "afd/runtime.hpp"
#include "afd/telemetry.hpp"

#include <cstddef>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace afd {

struct TraceIdOptions {
    /// Generates an ID. Defaults to a random UUID v4 from `random`.
    std::function<std::string()> generate;
    /// Randomness for the default generator. Defaults to a `SystemRandom`.
    std::shared_ptr<RandomSource> random;
};

struct LoggingOptions {
    /// Receives each log line. Defaults to standard error.
    std::function<void(std::string_view line)> log;
    std::shared_ptr<const Clock> clock;
};

struct TimingOptions {
    /// Commands slower than this many milliseconds are reported.
    double slow_threshold_ms = 1000;
    /// Receives slow commands. Defaults to "Slow command: <name> took <ms>ms" on standard error.
    std::function<void(std::string_view name, double duration_ms)> on_slow;
    std::shared_ptr<const Clock> clock;
};

/// Options for retry middleware.
struct RetryOptions {
    /// Maximum number of retries after the first attempt (default: 3). Must be nonnegative.
    int max_retries = 3;
    /// Base backoff in milliseconds (default: 100). Retry `n` (1-based) waits
    /// `min(max_delay_ms, retry_delay_ms * 2^(n - 1))`. Must be nonnegative and finite.
    double retry_delay_ms = 100;
    /// Upper bound on backoff before jitter in milliseconds (default: 5000). Must be nonnegative
    /// and finite.
    double max_delay_ms = 5000;
    /// Randomize each wait uniformly in `[backoff / 2, backoff]` (default: true).
    bool jitter = true;
    /// Whether to retry a failed command based on its error code. Defaults to
    /// `TRANSIENT_ERROR` and `TIMEOUT`.
    std::function<bool(std::string_view error_code)> should_retry;
    /// Randomness for jitter. Defaults to `SystemRandom`.
    std::shared_ptr<RandomSource> random;
    /// Waits `delay_ms` milliseconds, ending early when `cancellation` fires. Returns `true` if
    /// the wait completed and `false` if cancelled. Defaults to cooperative sleeping (when threads
    /// are enabled) or an immediate cancellation poll (when threads are disabled).
    std::function<bool(double delay_ms, const CancellationToken& cancellation)> sleep;
    /// Retry a command declaring `mutation` too (default: false). A failed mutation, such as one
    /// whose handler returned `TIMEOUT` after a downstream write, may already have applied its
    /// change, so retrying it can apply it twice. Set this only when every mutation the middleware
    /// wraps is safe to repeat.
    bool retry_mutations = false;
};

/// Options for in-memory rate-limiting middleware.
struct RateLimitOptions {
    /// Maximum requests allowed per window (default: 100).
    std::size_t max_requests = 100;
    /// Window size in milliseconds (default: 60000). Must be positive and finite.
    double window_ms = 60000;
    /// Maximum distinct active keys retained (default: 10000). New keys are rejected with
    /// `RATE_LIMITED` when at capacity. Must be positive.
    std::size_t max_keys = 10000;
    /// Identifies the caller budget for a call. Defaults to `"global"` (one shared budget).
    /// Do not key on `trace_id`, which is unique per call.
    std::function<std::string(const CommandContext& context)> key_fn;
    /// Steady clock driving window expiry. Defaults to `SystemClock`.
    std::shared_ptr<const Clock> clock;
};

/// Options for telemetry middleware.
struct TelemetryOptions {
    /// Telemetry sink to record events to. When null, events are skipped.
    std::shared_ptr<TelemetrySink> sink;
    /// Include validated command input in telemetry events (may contain sensitive data).
    /// Default: false.
    bool include_input = false;
    /// Include result metadata in telemetry events. Default: true.
    bool include_metadata = true;
    /// Predicate returning true for commands to record. Defaults to recording every command.
    std::function<bool(std::string_view command_name)> filter;
    /// Fallback clock when `context.clock` is null. Defaults to `SystemClock`.
    std::shared_ptr<const Clock> clock;
};

/// Sets `context.trace_id` when it is empty.
CommandMiddleware create_auto_trace_id_middleware(TraceIdOptions options = {});

/// Logs "[<traceId>] Executing: <name>" and "[<traceId>] Completed: <name> (<ms>ms) -
/// SUCCESS|FAILURE".
CommandMiddleware create_logging_middleware(LoggingOptions options = {});

/// Reports commands slower than `slow_threshold_ms`.
CommandMiddleware create_timing_middleware(TimingOptions options = {});

/// Retries transient failures with capped exponential backoff and optional jitter. Stops early
/// when `context.cancellation` is cancelled, returning the last failure. Fails (no exceptions)
/// when `max_retries < 0` or `retry_delay_ms`/`max_delay_ms` are negative or non-finite. A
/// command declaring `mutation` is never retried unless `retry_mutations` is set: the declaration
/// is read from the command the registry runs, never from its name, and a call whose declaration
/// cannot be read (outside the registry) counts as a mutation.
Expected<CommandMiddleware> create_retry_middleware(RetryOptions options = {});

/// Limits requests per key over fixed windows, thread-safely, with bounded key retention.
/// Fails (no exceptions) when `max_keys == 0` or `window_ms` is not positive and finite.
Expected<CommandMiddleware> create_rate_limit_middleware(RateLimitOptions options = {});

/// Records a `TelemetryEvent` for each executed command to `options.sink`. Sink failures are
/// ignored so they never affect command execution.
CommandMiddleware create_telemetry_middleware(TelemetryOptions options);

/// Composes multiple middleware functions into one; the first element is outermost. Empty
/// middleware entries are skipped.
CommandMiddleware compose_middleware(std::vector<CommandMiddleware> middlewares);

struct DefaultMiddlewareOptions {
    /// `std::nullopt` disables that middleware.
    std::optional<TraceIdOptions> trace_id = TraceIdOptions{};
    std::optional<LoggingOptions> logging = LoggingOptions{};
    std::optional<TimingOptions> timing = TimingOptions{};
};

/// Trace ID (outermost), then logging, then timing.
std::vector<CommandMiddleware> default_middleware(DefaultMiddlewareOptions options = {});

/// A random UUID v4 ("xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx") drawn from `random`.
std::string random_uuid(RandomSource& random);

} // namespace afd

// The default middleware: trace IDs, logging and slow-command timing
// (packages/server/src/middleware.ts).
#pragma once

#include "afd/command.hpp"
#include "afd/runtime.hpp"

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
    /// Randomness for the default generator. Defaults to a `SeededRandom` seeded from
    /// `std::random_device`.
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

/// Sets `context.trace_id` when it is empty.
Middleware create_auto_trace_id_middleware(TraceIdOptions options = {});

/// Logs "[<traceId>] Executing: <name>" and "[<traceId>] Completed: <name> (<ms>ms) -
/// SUCCESS|FAILURE".
Middleware create_logging_middleware(LoggingOptions options = {});

/// Reports commands slower than `slow_threshold_ms`.
Middleware create_timing_middleware(TimingOptions options = {});

struct DefaultMiddlewareOptions {
    /// `std::nullopt` disables that middleware.
    std::optional<TraceIdOptions> trace_id = TraceIdOptions{};
    std::optional<LoggingOptions> logging = LoggingOptions{};
    std::optional<TimingOptions> timing = TimingOptions{};
};

/// Trace ID (outermost), then logging, then timing.
std::vector<Middleware> default_middleware(DefaultMiddlewareOptions options = {});

/// A random UUID v4 ("xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx") drawn from `random`.
std::string random_uuid(RandomSource& random);

} // namespace afd

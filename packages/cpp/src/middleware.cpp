#include "afd/middleware.hpp"

#include "afd/errors.hpp"
#include "afd/result.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <list>
#include <mutex>
#include <unordered_map>
#include <utility>

#if AFD_ENABLE_THREADS
#include <chrono>
#include <thread>
#endif

#include "detail/exceptions.hpp"
#include "detail/json_io.hpp"
#include "detail/random_unit.hpp"

namespace afd {
namespace {

void write_stderr(std::string_view line) {
    std::fprintf(stderr, "%.*s\n", static_cast<int>(line.size()), line.data());
}

std::shared_ptr<const Clock> or_system_clock(std::shared_ptr<const Clock> clock) {
    return clock ? std::move(clock) : std::make_shared<SystemClock>();
}

bool default_sleep(double delay_ms, const CancellationToken& cancellation) {
    if (cancellation.is_cancelled()) {
        return false;
    }
    if (!std::isfinite(delay_ms) || delay_ms <= 0.0) {
        return true;
    }
#if AFD_ENABLE_THREADS
    using steady = std::chrono::steady_clock;
    const auto start = steady::now();
    for (;;) {
        if (cancellation.is_cancelled()) {
            return false;
        }
        const double elapsed_ms =
            std::chrono::duration<double, std::milli>(steady::now() - start).count();
        const double remaining_ms = delay_ms - elapsed_ms;
        if (remaining_ms <= 0.0) {
            return !cancellation.is_cancelled();
        }
        // Cap each sleep slice to 10ms so both cancellation stays responsive and converting
        // remaining_ms to integer microseconds can never overflow for any finite delay_ms.
        const double slice_ms = (std::min)(remaining_ms, 10.0);
        const auto slice_us =
            (std::max)(std::int64_t{1}, static_cast<std::int64_t>(std::ceil(slice_ms * 1000.0)));
        std::this_thread::sleep_for(std::chrono::microseconds(slice_us));
    }
#else
    return !cancellation.is_cancelled();
#endif
}

double retry_wait(int retry_index, double base_ms, double max_ms, bool jitter,
                  RandomSource& random) {
    if (base_ms == 0.0 || max_ms == 0.0) {
        return 0.0;
    }
    const double factor = std::pow(2.0, static_cast<double>(retry_index));
    const double raw = base_ms * factor;
    const double backoff = std::isfinite(raw) ? (std::min)(max_ms, raw) : max_ms;
    return jitter ? (backoff / 2.0) + detail::clamp_unit_random(random.next()) * (backoff / 2.0)
                  : backoff;
}

struct RateWindow {
    std::size_t count = 0;
    double reset_at_ms = 0;
};

struct RateLimitState {
    using Queue = std::list<std::pair<std::string, RateWindow>>;
    std::mutex mutex;
    // Insertion order follows expiry order because every window has the same duration.
    Queue windows;
    std::unordered_map<std::string, Queue::iterator> index;
};

} // namespace

std::string random_uuid(RandomSource& random) {
    constexpr char hex[] = "0123456789abcdef";
    unsigned char bytes[16];
    for (unsigned char& byte : bytes) {
        byte = static_cast<unsigned char>(detail::random_index(random.next(), 256));
    }
    bytes[6] = static_cast<unsigned char>((bytes[6] & 0x0Fu) | 0x40u); // version 4
    bytes[8] = static_cast<unsigned char>((bytes[8] & 0x3Fu) | 0x80u); // RFC 4122 variant
    std::string out;
    out.reserve(36);
    for (std::size_t i = 0; i < 16; ++i) {
        if (i == 4 || i == 6 || i == 8 || i == 10) {
            out.push_back('-');
        }
        out.push_back(hex[bytes[i] >> 4]);
        out.push_back(hex[bytes[i] & 0x0Fu]);
    }
    return out;
}

CommandMiddleware create_auto_trace_id_middleware(TraceIdOptions options) {
    auto generate = std::move(options.generate);
    if (!generate) {
        std::shared_ptr<RandomSource> random =
            options.random ? std::move(options.random) : std::make_shared<SystemRandom>();
        generate = [random] { return random_uuid(*random); };
    }
    return [generate](std::string_view, const Json&, CommandContext& context, const Next& next) {
        if (!context.trace_id || context.trace_id->empty()) {
            context.trace_id = generate();
        }
        return next();
    };
}

CommandMiddleware create_logging_middleware(LoggingOptions options) {
    auto log =
        options.log ? std::move(options.log) : std::function<void(std::string_view)>(write_stderr);
    auto clock = or_system_clock(std::move(options.clock));
    return [log, clock](std::string_view name, const Json&, CommandContext& context,
                        const Next& next) {
        const double start = clock->steady_ms();
        const std::string trace = "[" + context.trace_id.value_or("no-trace") + "] ";
        log(trace + "Executing: " + std::string(name));
        CommandResult result = next();
        const double duration = std::round(clock->steady_ms() - start);
        log(trace + "Completed: " + std::string(name) + " (" + detail::format_number(duration) +
            "ms) - " + (result.success ? "SUCCESS" : "FAILURE"));
        return result;
    };
}

CommandMiddleware create_timing_middleware(TimingOptions options) {
    auto on_slow =
        options.on_slow
            ? std::move(options.on_slow)
            : std::function<void(std::string_view, double)>([](std::string_view name, double ms) {
                  write_stderr("Slow command: " + std::string(name) + " took " +
                               detail::format_number(ms) + "ms");
              });
    auto clock = or_system_clock(std::move(options.clock));
    const double threshold = options.slow_threshold_ms;
    return [on_slow, clock, threshold](std::string_view name, const Json&, CommandContext&,
                                       const Next& next) {
        const double start = clock->steady_ms();
        CommandResult result = next();
        const double duration = std::round(clock->steady_ms() - start);
        if (duration > threshold) {
            on_slow(name, duration);
        }
        return result;
    };
}

Expected<CommandMiddleware> create_retry_middleware(RetryOptions options) {
    if (options.max_retries < 0) {
        return unexpected(std::string("Retry max_retries must be a nonnegative integer"));
    }
    if (!std::isfinite(options.retry_delay_ms) || options.retry_delay_ms < 0 ||
        !std::isfinite(options.max_delay_ms) || options.max_delay_ms < 0) {
        return unexpected(
            std::string("Retry retry_delay_ms and max_delay_ms must be nonnegative and finite"));
    }
    const int max_retries = options.max_retries;
    const double retry_delay_ms = options.retry_delay_ms;
    const double max_delay_ms = options.max_delay_ms;
    const bool jitter = options.jitter;
    auto should_retry = options.should_retry
                            ? std::move(options.should_retry)
                            : std::function<bool(std::string_view)>([](std::string_view code) {
                                  return code == "TRANSIENT_ERROR" || code == error_codes::TIMEOUT;
                              });
    std::shared_ptr<RandomSource> random =
        options.random ? std::move(options.random) : std::make_shared<SystemRandom>();
    auto sleeper = options.sleep
                       ? std::move(options.sleep)
                       : std::function<bool(double, const CancellationToken&)>(default_sleep);

    return CommandMiddleware([max_retries, retry_delay_ms, max_delay_ms, jitter,
                              should_retry = std::move(should_retry), random = std::move(random),
                              sleeper = std::move(sleeper)](std::string_view, const Json&,
                                                            CommandContext& context,
                                                            const Next& next) -> CommandResult {
        CommandResult result = next();
        for (int retry = 0; retry < max_retries; ++retry) {
            if (result.success || !result.error || !should_retry(result.error->code)) {
                return result;
            }
            const double wait_ms = retry_wait(retry, retry_delay_ms, max_delay_ms, jitter, *random);
            if (!sleeper(wait_ms, context.cancellation)) {
                return result;
            }
            result = next();
        }
        return result;
    });
}

Expected<CommandMiddleware> create_rate_limit_middleware(RateLimitOptions options) {
    if (options.max_keys == 0 || !std::isfinite(options.window_ms) || options.window_ms <= 0) {
        return unexpected(std::string("Rate limit max_keys and window_ms must be positive"));
    }
    const std::size_t max_requests = options.max_requests;
    const double window_ms = options.window_ms;
    const std::size_t max_keys = options.max_keys;
    auto key_fn = options.key_fn ? std::move(options.key_fn)
                                 : std::function<std::string(const CommandContext&)>(
                                       [](const CommandContext&) { return std::string("global"); });
    auto clock = or_system_clock(std::move(options.clock));
    auto state = std::make_shared<RateLimitState>();

    return CommandMiddleware([max_requests, window_ms, max_keys, key_fn = std::move(key_fn),
                              clock = std::move(clock), state = std::move(state)](
                                 std::string_view, const Json&, CommandContext& context,
                                 const Next& next) -> CommandResult {
        const std::string key = key_fn(context);
        {
            const std::lock_guard lock(state->mutex);
            const double now = clock->steady_ms();
            while (!state->windows.empty() && state->windows.front().second.reset_at_ms <= now) {
                state->index.erase(state->windows.front().first);
                state->windows.pop_front();
            }
            auto found = state->index.find(key);
            if (found == state->index.end() && state->windows.size() >= max_keys) {
                return failure(
                    create_error(error_codes::RATE_LIMITED, "Rate limit client capacity reached",
                                 {.suggestion = "Retry after the current rate limit window expires",
                                  .retryable = true,
                                  .recovery = Recovery{.kind = RecoveryKind::retry}}));
            }
            if (found == state->index.end() || now >= found->second->second.reset_at_ms) {
                if (found != state->index.end()) {
                    state->windows.erase(found->second);
                    state->index.erase(found);
                }
                state->windows.emplace_back(key,
                                            RateWindow{.count = 0, .reset_at_ms = now + window_ms});
                auto inserted = std::prev(state->windows.end());
                found = state->index.emplace(key, inserted).first;
            }
            RateWindow& window = found->second->second;
            if (window.count >= max_requests) {
                const double remaining_seconds =
                    (std::max)(1.0, std::ceil((window.reset_at_ms - now) / 1000.0));
                return failure(create_error(
                    error_codes::RATE_LIMITED, "Too many requests",
                    {.suggestion =
                         "Try again in " + detail::format_number(remaining_seconds) + " seconds",
                     .retryable = true,
                     // The same whole number of seconds the suggestion gives.
                     .recovery = Recovery{.kind = RecoveryKind::retry,
                                          .after_ms = static_cast<std::int64_t>(
                                              (std::min)(remaining_seconds * 1000.0,
                                                         detail::max_safe_integer_double))}}));
            }
            ++window.count;
        }
        return next();
    });
}

CommandMiddleware create_telemetry_middleware(TelemetryOptions options) {
    auto sink = std::move(options.sink);
    const bool include_input = options.include_input;
    const bool include_metadata = options.include_metadata;
    auto filter = std::move(options.filter);
    auto default_clock = or_system_clock(std::move(options.clock));

    return [sink = std::move(sink), include_input, include_metadata, filter = std::move(filter),
            default_clock = std::move(default_clock)](std::string_view name, const Json& input,
                                                      CommandContext& context,
                                                      const Next& next) -> CommandResult {
        if (filter && !filter(name)) {
            return next();
        }
        const std::shared_ptr<const Clock> active_clock =
            context.clock ? context.clock : default_clock;
        const std::int64_t start_wall = active_clock->wall_ms();
        const double start_steady = active_clock->steady_ms();
        const std::string started_at = wire::iso8601_utc(start_wall);

        const auto record_event = [&](const CommandResult* result,
                                      const std::optional<CommandError>& thrown_error) {
            if (!sink) {
                return;
            }
            const std::int64_t end_wall = active_clock->wall_ms();
            const double end_steady = active_clock->steady_ms();
            const std::string completed_at = wire::iso8601_utc(end_wall);
            const double duration_ms = end_steady - start_steady;

            TelemetryEventOptions event_options;
            event_options.duration_ms = duration_ms;
            if (thrown_error) {
                event_options.error = *thrown_error;
            } else if (result && !result->success && result->error) {
                event_options.error = *result->error;
            }
            if (context.trace_id && !context.trace_id->empty()) {
                event_options.trace_id = *context.trace_id;
            }
            if (context.actor) {
                event_options.actor_kind = context.actor->kind;
            }
            if (include_input) {
                event_options.input = input;
            }
            if (!thrown_error && result) {
                if (result->confidence) {
                    event_options.confidence = *result->confidence;
                }
                if (include_metadata && result->metadata) {
                    event_options.metadata = Json(*result->metadata);
                }
                if (result->metadata && result->metadata->command_version) {
                    event_options.command_version = *result->metadata->command_version;
                }
            }
            const TelemetryEvent event = create_telemetry_event(
                std::string(name), started_at, completed_at,
                !thrown_error && result != nullptr && result->success, std::move(event_options));
#if AFD_HAS_EXCEPTIONS
            try {
                sink->record(event);
            } catch (...) {
                // Silently ignore sink errors so they never affect command execution.
            }
#else
            sink->record(event);
#endif
        };

#if AFD_HAS_EXCEPTIONS
        try {
            CommandResult result = next();
            record_event(&result, std::nullopt);
            return result;
        } catch (const std::exception& err) {
            record_event(nullptr, CommandError{.code = "UNHANDLED_ERROR", .message = err.what()});
            throw;
        } catch (...) {
            record_event(nullptr,
                         CommandError{.code = "UNHANDLED_ERROR", .message = "Unknown error"});
            throw;
        }
#else
        CommandResult result = next();
        record_event(&result, std::nullopt);
        return result;
#endif
    };
}

CommandMiddleware compose_middleware(std::vector<CommandMiddleware> middlewares) {
    auto chain = std::make_shared<const std::vector<CommandMiddleware>>(std::move(middlewares));
    return [chain = std::move(chain)](std::string_view name, const Json& input,
                                      CommandContext& context, const Next& outer_next) {
        std::function<CommandResult(std::size_t)> dispatch;
        dispatch = [&](std::size_t index) -> CommandResult {
            if (index >= chain->size() || !(*chain)[index]) {
                return outer_next();
            }
            const Next next = [&, index] { return dispatch(index + 1); };
            return (*chain)[index](name, input, context, next);
        };
        return dispatch(0);
    };
}

std::vector<CommandMiddleware> default_middleware(DefaultMiddlewareOptions options) {
    std::vector<CommandMiddleware> stack;
    if (options.trace_id) {
        stack.push_back(create_auto_trace_id_middleware(std::move(*options.trace_id)));
    }
    if (options.logging) {
        stack.push_back(create_logging_middleware(std::move(*options.logging)));
    }
    if (options.timing) {
        stack.push_back(create_timing_middleware(std::move(*options.timing)));
    }
    return stack;
}

} // namespace afd

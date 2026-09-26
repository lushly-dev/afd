#include "afd/middleware.hpp"

#include <cmath>
#include <cstdio>

#include "detail/json_io.hpp"

namespace afd {
namespace {

void write_stderr(std::string_view line) {
    std::fprintf(stderr, "%.*s\n", static_cast<int>(line.size()), line.data());
}

std::shared_ptr<const Clock> or_system_clock(std::shared_ptr<const Clock> clock) {
    return clock ? std::move(clock) : std::make_shared<SystemClock>();
}

} // namespace

std::string random_uuid(RandomSource& random) {
    constexpr char hex[] = "0123456789abcdef";
    unsigned char bytes[16];
    for (unsigned char& byte : bytes) {
        byte = static_cast<unsigned char>(random.next() * 256.0);
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
            options.random ? std::move(options.random) : std::make_shared<SeededRandom>();
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

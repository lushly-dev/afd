#include "afd/afd.hpp"

#include <atomic>
#include <cmath>
#include <limits>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

#if AFD_ENABLE_THREADS
#include <chrono>
#include <thread>
#endif

#include "detail/exceptions.hpp"
#include <doctest.h>

namespace {

std::unique_ptr<afd::CommandRegistry> registry_with(std::vector<afd::CommandMiddleware> middleware,
                                                    std::shared_ptr<afd::ManualClock> clock,
                                                    double handler_ms = 0) {
    auto registry = std::make_unique<afd::CommandRegistry>(
        afd::CommandRegistryOptions{.middleware = std::move(middleware), .clock = clock});
    const auto error = registry->register_command(afd::CommandDefinition{
        .name = "todo-list",
        .description = "List todos",
        .handler =
            [clock, handler_ms](const afd::Json&, afd::CommandContext&) {
                clock->advance(handler_ms);
                return afd::success(afd::Json::array());
            },
    });
    REQUIRE_FALSE(error.has_value());
    return registry;
}

} // namespace

TEST_CASE("random_uuid is a version 4 UUID") {
    afd::SeededRandom random("42");
    const std::string uuid = afd::random_uuid(random);
    REQUIRE(uuid.size() == 36);
    CHECK(uuid[8] == '-');
    CHECK(uuid[13] == '-');
    CHECK(uuid[14] == '4');
    CHECK(std::string("89ab").find(uuid[19]) != std::string::npos);
    CHECK(afd::random_uuid(random) != uuid);
}

TEST_CASE("default middleware: trace ID, then logging, then timing") {
    auto clock = std::make_shared<afd::ManualClock>();
    std::vector<std::string> lines;
    std::vector<std::string> slow;
    auto middleware = afd::default_middleware(afd::DefaultMiddlewareOptions{
        .trace_id = afd::TraceIdOptions{.generate = [] { return std::string("trace-1"); }},
        .logging =
            afd::LoggingOptions{.log = [&](std::string_view line) { lines.emplace_back(line); },
                                .clock = clock},
        .timing = afd::TimingOptions{.slow_threshold_ms = 1000,
                                     .on_slow =
                                         [&](std::string_view name, double ms) {
                                             slow.push_back(std::string(name) + " " +
                                                            std::to_string(static_cast<int>(ms)));
                                         },
                                     .clock = clock},
    });
    REQUIRE(middleware.size() == 3);

    auto registry = registry_with(middleware, clock, 1500);
    const auto result = registry->execute("todo-list");
    CHECK(result.metadata->trace_id == "trace-1");
    CHECK(lines == std::vector<std::string>{"[trace-1] Executing: todo-list",
                                            "[trace-1] Completed: todo-list (1500ms) - SUCCESS"});
    CHECK(slow == std::vector<std::string>{"todo-list 1500"});
}

TEST_CASE("the trace ID middleware keeps an existing ID, and options can disable middleware") {
    auto clock = std::make_shared<afd::ManualClock>();
    auto registry = registry_with(afd::default_middleware(afd::DefaultMiddlewareOptions{
                                      .logging = std::nullopt, .timing = std::nullopt}),
                                  clock);
    afd::CommandContext context;
    context.trace_id = "caller-trace";
    CHECK(registry->execute("todo-list", afd::Json::object(), context).metadata->trace_id ==
          "caller-trace");
    const auto generated = registry->execute("todo-list").metadata->trace_id;
    REQUIRE(generated.has_value());
    CHECK(generated->size() == 36);
}

TEST_CASE("compose_middleware runs outer-to-inner, stops at empty entry, and supports retries") {
    std::vector<std::string> order;
    const auto tracer = [&](std::string label) -> afd::CommandMiddleware {
        return [&order, label](std::string_view, const afd::Json&, afd::CommandContext&,
                               const afd::Next& next) {
            order.push_back(label + ":before");
            auto result = next();
            order.push_back(label + ":after");
            return result;
        };
    };

    auto composed = afd::compose_middleware({tracer("first"), tracer("second")});
    auto clock = std::make_shared<afd::ManualClock>();
    auto registry = registry_with({composed}, clock);
    CHECK(registry->execute("todo-list").success);
    CHECK(order ==
          std::vector<std::string>{"first:before", "second:before", "second:after", "first:after"});

    // An empty entry invokes the outer next immediately, matching TypeScript composeMiddleware.
    order.clear();
    auto with_empty =
        afd::compose_middleware({tracer("first"), afd::CommandMiddleware{}, tracer("second")});
    auto empty_stop = registry_with({with_empty}, clock);
    CHECK(empty_stop->execute("todo-list").success);
    CHECK(order == std::vector<std::string>{"first:before", "first:after"});

    // Empty composition passes straight through.
    auto empty = afd::compose_middleware({});
    auto pass_through = registry_with({empty}, clock);
    CHECK(pass_through->execute("todo-list").success);

    // Retry middleware composed outside an inner layer re-invokes the inner layer on retry.
    int inner_calls = 0;
    int handler_calls = 0;
    auto retry_mw = afd::create_retry_middleware(afd::RetryOptions{
        .max_retries = 2,
        .retry_delay_ms = 0,
        .jitter = false,
        .sleep = [](double, const afd::CancellationToken&) { return true; },
    });
    REQUIRE(retry_mw.has_value());
    auto inner = [&](std::string_view, const afd::Json&, afd::CommandContext&,
                     const afd::Next& next) {
        ++inner_calls;
        return next();
    };
    afd::CommandRegistry retrying(
        {.middleware = {afd::compose_middleware({*retry_mw, inner})}, .clock = clock});
    REQUIRE_FALSE(retrying
                      .register_command(afd::CommandDefinition{
                          .name = "todo-flaky",
                          .description = "Flaky command",
                          .handler =
                              [&](const afd::Json&, afd::CommandContext&) {
                                  return ++handler_calls < 2
                                             ? afd::error("TRANSIENT_ERROR", "Try again")
                                             : afd::success(afd::Json{{"ok", true}});
                              },
                      })
                      .has_value());
    CHECK(retrying.execute("todo-flaky").success);
    CHECK(inner_calls == 2);
    CHECK(handler_calls == 2);
}

TEST_CASE(
    "create_retry_middleware validates options, backs off, jitters, and honors cancellation") {
    CHECK_FALSE(afd::create_retry_middleware({.max_retries = -1}).has_value());
    CHECK_FALSE(afd::create_retry_middleware({.retry_delay_ms = -1}).has_value());
    CHECK_FALSE(afd::create_retry_middleware({.max_delay_ms = -1}).has_value());
    CHECK_FALSE(
        afd::create_retry_middleware({.max_delay_ms = std::numeric_limits<double>::infinity()})
            .has_value());

    // Exponential backoff capped at max_delay_ms without jitter.
    std::vector<double> waits;
    auto retry = afd::create_retry_middleware(afd::RetryOptions{
        .max_retries = 3,
        .retry_delay_ms = 100,
        .max_delay_ms = 250,
        .jitter = false,
        .sleep =
            [&](double ms, const afd::CancellationToken&) {
                waits.push_back(ms);
                return true;
            },
    });
    REQUIRE(retry.has_value());
    int attempts = 0;
    afd::CommandRegistry registry({.middleware = {*retry}});
    REQUIRE_FALSE(registry
                      .register_command(afd::CommandDefinition{
                          .name = "todo-retry",
                          .description = "Always transient",
                          .handler =
                              [&](const afd::Json&, afd::CommandContext&) {
                                  ++attempts;
                                  return afd::error("TRANSIENT_ERROR", "Temporary failure");
                              },
                      })
                      .has_value());
    const auto exhausted = registry.execute("todo-retry");
    CHECK_FALSE(exhausted.success);
    CHECK(attempts == 4);
    CHECK(waits == std::vector<double>{100, 200, 250});

    // Non-matching error codes are not retried.
    waits.clear();
    int permanent_attempts = 0;
    REQUIRE_FALSE(registry
                      .register_command(afd::CommandDefinition{
                          .name = "todo-permanent",
                          .description = "Permanent error",
                          .handler =
                              [&](const afd::Json&, afd::CommandContext&) {
                                  ++permanent_attempts;
                                  return afd::error("NOT_FOUND", "Missing");
                              },
                      })
                      .has_value());
    CHECK(registry.execute("todo-permanent").error->code == "NOT_FOUND");
    CHECK(permanent_attempts == 1);
    CHECK(waits.empty());

    // Jitter stays within [backoff / 2, backoff].
    std::vector<double> jittered_waits;
    auto jittered = afd::create_retry_middleware(afd::RetryOptions{
        .max_retries = 2,
        .retry_delay_ms = 100,
        .max_delay_ms = 5000,
        .jitter = true,
        .random = std::make_shared<afd::SeededRandom>("retry-seed"),
        .sleep =
            [&](double ms, const afd::CancellationToken&) {
                jittered_waits.push_back(ms);
                return true;
            },
    });
    REQUIRE(jittered.has_value());
    afd::CommandRegistry jitter_reg({.middleware = {*jittered}});
    REQUIRE_FALSE(jitter_reg
                      .register_command(afd::CommandDefinition{
                          .name = "todo-timeout",
                          .description = "Timeout",
                          .handler =
                              [](const afd::Json&, afd::CommandContext&) {
                                  return afd::error(afd::error_codes::TIMEOUT, "Timed out");
                              },
                      })
                      .has_value());
    CHECK_FALSE(jitter_reg.execute("todo-timeout").success);
    REQUIRE(jittered_waits.size() == 2);
    CHECK(jittered_waits[0] >= 50.0);
    CHECK(jittered_waits[0] <= 100.0);
    CHECK(jittered_waits[1] >= 100.0);
    CHECK(jittered_waits[1] <= 200.0);

    // Cancellation stops retrying early and returns the last failure.
    afd::CancellationSource source;
    int cancel_attempts = 0;
    auto cancel_retry = afd::create_retry_middleware(afd::RetryOptions{
        .max_retries = 3,
        .retry_delay_ms = 100,
        .jitter = false,
        .sleep =
            [&](double, const afd::CancellationToken& token) {
                source.cancel();
                return !token.is_cancelled();
            },
    });
    REQUIRE(cancel_retry.has_value());
    afd::CommandRegistry cancel_reg({.middleware = {*cancel_retry}});
    REQUIRE_FALSE(cancel_reg
                      .register_command(afd::CommandDefinition{
                          .name = "todo-cancel",
                          .description = "Cancelled during retry",
                          .handler =
                              [&](const afd::Json&, afd::CommandContext&) {
                                  ++cancel_attempts;
                                  return afd::error("TRANSIENT_ERROR", "Try again");
                              },
                      })
                      .has_value());
    afd::CommandContext ctx;
    ctx.cancellation = source.token();
    const auto cancelled = cancel_reg.execute("todo-cancel", afd::Json::object(), ctx);
    CHECK_FALSE(cancelled.success);
    CHECK(cancelled.error->code == "TRANSIENT_ERROR");
    CHECK(cancel_attempts == 1);

    // Zero base delay stays 0 even past 2^1024 (no 0 * Inf -> NaN fallback to max_delay_ms).
    double max_zero_wait = -1.0;
    auto zero_delay = afd::create_retry_middleware(afd::RetryOptions{
        .max_retries = 1026,
        .retry_delay_ms = 0,
        .max_delay_ms = 5000,
        .jitter = false,
        .sleep =
            [&](double ms, const afd::CancellationToken&) {
                if (ms > max_zero_wait) {
                    max_zero_wait = ms;
                }
                return true;
            },
    });
    REQUIRE(zero_delay.has_value());
    afd::CommandRegistry zero_reg({.middleware = {*zero_delay}});
    REQUIRE_FALSE(zero_reg
                      .register_command(afd::CommandDefinition{
                          .name = "todo-zero",
                          .description = "Zero wait",
                          .handler =
                              [](const afd::Json&, afd::CommandContext&) {
                                  return afd::error("TRANSIENT_ERROR", "Try again");
                              },
                      })
                      .has_value());
    CHECK_FALSE(zero_reg.execute("todo-zero").success);
    CHECK(max_zero_wait == 0.0);

    // Hostile RandomSource values (NaN, negative, +Inf, >= 1) are clamped into [backoff/2,
    // backoff].
    struct HostileRandom final : public afd::RandomSource {
        std::vector<double> values = {std::numeric_limits<double>::quiet_NaN(), -5.0,
                                      std::numeric_limits<double>::infinity(), 2.0};
        std::size_t index = 0;
        double next() override { return values[index++ % values.size()]; }
    };
    std::vector<double> clamped_waits;
    auto hostile_retry = afd::create_retry_middleware(afd::RetryOptions{
        .max_retries = 4,
        .retry_delay_ms = 100,
        .max_delay_ms = 100,
        .jitter = true,
        .random = std::make_shared<HostileRandom>(),
        .sleep =
            [&](double ms, const afd::CancellationToken&) {
                clamped_waits.push_back(ms);
                return true;
            },
    });
    REQUIRE(hostile_retry.has_value());
    afd::CommandRegistry hostile_reg({.middleware = {*hostile_retry}});
    REQUIRE_FALSE(hostile_reg
                      .register_command(afd::CommandDefinition{
                          .name = "todo-hostile",
                          .description = "Hostile random",
                          .handler =
                              [](const afd::Json&, afd::CommandContext&) {
                                  return afd::error("TRANSIENT_ERROR", "Try again");
                              },
                      })
                      .has_value());
    CHECK_FALSE(hostile_reg.execute("todo-hostile").success);
    REQUIRE(clamped_waits.size() == 4);
    for (double wait : clamped_waits) {
        CHECK(std::isfinite(wait));
        CHECK(wait >= 50.0);
        CHECK(wait <= 100.0);
    }

#if AFD_ENABLE_THREADS
    // Default sleeper handles large finite delays cleanly without integer/time_point overflow and
    // exits promptly when cancelled.
    afd::CancellationSource huge_cancel;
    auto huge_retry = afd::create_retry_middleware(afd::RetryOptions{
        .max_retries = 1,
        .retry_delay_ms = 1e16,
        .max_delay_ms = 1e16,
        .jitter = false,
    });
    REQUIRE(huge_retry.has_value());
    afd::CommandRegistry huge_reg({.middleware = {*huge_retry}});
    REQUIRE_FALSE(huge_reg
                      .register_command(afd::CommandDefinition{
                          .name = "todo-huge",
                          .description = "Huge wait",
                          .handler =
                              [](const afd::Json&, afd::CommandContext&) {
                                  return afd::error("TRANSIENT_ERROR", "Try again");
                              },
                      })
                      .has_value());
    std::thread canceller([&] {
        std::this_thread::sleep_for(std::chrono::milliseconds(15));
        huge_cancel.cancel();
    });
    afd::CommandContext huge_ctx;
    huge_ctx.cancellation = huge_cancel.token();
    const auto huge_result = huge_reg.execute("todo-huge", afd::Json::object(), huge_ctx);
    canceller.join();
    CHECK_FALSE(huge_result.success);
    CHECK(huge_result.error->code == "TRANSIENT_ERROR");
#endif
}

TEST_CASE("create_rate_limit_middleware limits per key, resets on window, and bounds keys") {
    CHECK_FALSE(afd::create_rate_limit_middleware({.max_requests = 1, .window_ms = 0}).has_value());
    CHECK_FALSE(
        afd::create_rate_limit_middleware({.max_requests = 1, .window_ms = 1000, .max_keys = 0})
            .has_value());

    auto clock = std::make_shared<afd::ManualClock>();
    auto limiter = afd::create_rate_limit_middleware(afd::RateLimitOptions{
        .max_requests = 2,
        .window_ms = 5000,
        .max_keys = 2,
        .key_fn =
            [](const afd::CommandContext& ctx) {
                const auto it = ctx.extra.find("client");
                return it != ctx.extra.end() && it->is_string() ? it->get<std::string>()
                                                                : std::string("global");
            },
        .clock = clock,
    });
    REQUIRE(limiter.has_value());
    auto registry = registry_with({*limiter}, clock);

    afd::CommandContext alice;
    alice.extra["client"] = "alice";
    afd::CommandContext bob;
    bob.extra["client"] = "bob";
    afd::CommandContext charlie;
    charlie.extra["client"] = "charlie";

    CHECK(registry->execute("todo-list", afd::Json::object(), alice).success);
    CHECK(registry->execute("todo-list", afd::Json::object(), alice).success);
    const auto limited = registry->execute("todo-list", afd::Json::object(), alice);
    CHECK_FALSE(limited.success);
    CHECK(limited.error->code == afd::error_codes::RATE_LIMITED);
    CHECK(limited.error->message == "Too many requests");
    CHECK(limited.error->retryable == true);
    CHECK(limited.error->suggestion == "Try again in 5 seconds");
    // The same whole number of seconds as the suggestion (spec/recovery.md, "Engine errors").
    CHECK(limited.error->recovery ==
          afd::Recovery{.kind = afd::RecoveryKind::retry, .after_ms = 5000});
    clock->advance(1500);
    const auto later = registry->execute("todo-list", afd::Json::object(), alice);
    CHECK(later.error->suggestion == "Try again in 4 seconds");
    CHECK(later.error->recovery ==
          afd::Recovery{.kind = afd::RecoveryKind::retry, .after_ms = 4000});

    // Independent key still has quota; third distinct key hits max_keys.
    CHECK(registry->execute("todo-list", afd::Json::object(), bob).success);
    const auto full = registry->execute("todo-list", afd::Json::object(), charlie);
    CHECK_FALSE(full.success);
    CHECK(full.error->code == afd::error_codes::RATE_LIMITED);
    CHECK(full.error->message == "Rate limit client capacity reached");
    CHECK(full.error->retryable == true);
    // When the window ends is not known for a new client: retry with no minimum wait.
    CHECK(full.error->recovery == afd::Recovery{.kind = afd::RecoveryKind::retry});

    // Advancing past the window clears expired keys and resets quota.
    clock->advance(5000);
    CHECK(registry->execute("todo-list", afd::Json::object(), charlie).success);
    CHECK(registry->execute("todo-list", afd::Json::object(), alice).success);

#if AFD_ENABLE_THREADS
    // Concurrent rate-limit checks preserve FIFO expiry order and never exceed max_requests.
    struct SteppingClock final : public afd::Clock {
        mutable std::atomic<std::int64_t> ticks{0};
        std::int64_t wall_ms() const override { return ticks.load(); }
        double steady_ms() const override { return static_cast<double>(ticks.fetch_add(10)); }
    };
    auto stepping_clock = std::make_shared<SteppingClock>();
    auto concurrent_limiter = afd::create_rate_limit_middleware(afd::RateLimitOptions{
        .max_requests = 1,
        .window_ms = 50,
        .max_keys = 8,
        .key_fn =
            [](const afd::CommandContext& ctx) {
                const auto it = ctx.extra.find("client");
                return it != ctx.extra.end() && it->is_string() ? it->get<std::string>()
                                                                : std::string("global");
            },
        .clock = stepping_clock,
    });
    REQUIRE(concurrent_limiter.has_value());
    afd::CommandRegistry concurrent_reg({.middleware = {*concurrent_limiter}});
    REQUIRE_FALSE(concurrent_reg
                      .register_command(afd::CommandDefinition{
                          .name = "todo-concurrent",
                          .description = "Concurrent",
                          .handler =
                              [](const afd::Json&, afd::CommandContext&) {
                                  return afd::success(afd::Json{{"ok", true}});
                              },
                      })
                      .has_value());
    std::atomic<int> successes{0};
    std::vector<std::thread> workers;
    for (int t = 0; t < 4; ++t) {
        workers.emplace_back([&, t] {
            for (int i = 0; i < 6; ++i) {
                afd::CommandContext c;
                c.extra["client"] = "worker-" + std::to_string(t) + "-" + std::to_string(i);
                if (concurrent_reg.execute("todo-concurrent", afd::Json::object(), c).success) {
                    ++successes;
                }
            }
        });
    }
    for (auto& worker : workers) {
        worker.join();
    }
    // Every call advances the clock by 10ms with a 50ms window (at most 5 live windows < max_keys
    // 8), so every distinct key must succeed once expired entries are pruned in FIFO order.
    CHECK(successes.load() == 24);
#endif
}

TEST_CASE("telemetry types, console sink, and telemetry middleware") {
    const auto event = afd::create_telemetry_event(
        "todo-create", "2024-01-15T10:30:00.000Z", "2024-01-15T10:30:00.150Z", true,
        {.trace_id = "trace-1", .confidence = 0.9, .actor_kind = afd::ActorKind::agent});
    CHECK(event.duration_ms == 150.0);
    const afd::Json wire = event;
    CHECK(afd::is_telemetry_event(wire));
    CHECK_FALSE(afd::is_telemetry_event(afd::Json{{"commandName", "x"}}));
    CHECK(wire["commandName"] == "todo-create");
    CHECK(wire["durationMs"] == 150);
    CHECK(wire["actorKind"] == "agent");
    CHECK_FALSE(wire.contains("error"));
    const auto round_tripped = afd::TelemetryEvent::from_json(wire);
    REQUIRE(round_tripped.has_value());
    CHECK(round_tripped->command_name == "todo-create");
    CHECK(round_tripped->duration_ms == 150.0);
    CHECK(round_tripped->actor_kind == afd::ActorKind::agent);

    // Numeric UTC offsets (+00:00, -05:00) derive elapsed time identically to TypeScript.
    const auto offset_event = afd::create_telemetry_event(
        "todo-offset", "2024-01-15T10:30:00+00:00", "2024-01-15T05:30:01-05:00", true);
    CHECK(offset_event.duration_ms == 1000.0);

    // ConsoleTelemetrySink text and JSON formats (including omitting empty trace_id).
    std::vector<std::string> text_lines;
    afd::ConsoleTelemetrySink text_sink(
        {.log = [&](std::string_view line) { text_lines.emplace_back(line); }});
    text_sink.record(event);
    auto empty_trace_event = event;
    empty_trace_event.trace_id = "";
    text_sink.record(empty_trace_event);
    REQUIRE(text_lines.size() == 2);
    CHECK(text_lines[0] == "[Telemetry] [trace-1] todo-create SUCCESS in 150ms (confidence: 0.9)");
    CHECK(text_lines[1] == "[Telemetry] todo-create SUCCESS in 150ms (confidence: 0.9)");

    std::vector<std::string> json_lines;
    afd::ConsoleTelemetrySink json_sink(
        {.log = [&](std::string_view line) { json_lines.emplace_back(line); },
         .json = true,
         .prefix = "[CMD]"});
    json_sink.record(event);
    REQUIRE(json_lines.size() == 1);
    const auto parsed_line = afd::parse_bounded(json_lines[0]);
    REQUIRE(parsed_line.has_value());
    CHECK((*parsed_line)["_prefix"] == "[CMD]");
    CHECK((*parsed_line)["commandName"] == "todo-create");

    // Telemetry middleware captures timing, actor kind, trace id, metadata, input, and filter.
    struct MemorySink final : public afd::TelemetrySink {
        std::vector<afd::TelemetryEvent> events;
        void record(const afd::TelemetryEvent& e) override { events.push_back(e); }
    };
    auto sink = std::make_shared<MemorySink>();
    auto clock = afd::fixed_clock(1705314600000);
    auto telemetry = afd::create_telemetry_middleware(afd::TelemetryOptions{
        .sink = sink,
        .include_input = true,
        .include_metadata = true,
        .filter = [](std::string_view name) { return name != "internal-ping"; },
        .clock = clock,
    });
    afd::CommandRegistry registry({.middleware = {telemetry}, .clock = clock});
    REQUIRE_FALSE(registry
                      .register_command(afd::CommandDefinition{
                          .name = "todo-create",
                          .description = "Create",
                          .handler =
                              [clock](const afd::Json& input, afd::CommandContext&) {
                                  clock->advance(25);
                                  return afd::success(input, {.confidence = 0.85});
                              },
                          .version = "2.0.0",
                      })
                      .has_value());
    REQUIRE_FALSE(registry
                      .register_command(afd::CommandDefinition{
                          .name = "internal-ping",
                          .description = "Ping",
                          .handler =
                              [](const afd::Json&, afd::CommandContext&) {
                                  return afd::success(afd::Json{{"pong", true}});
                              },
                      })
                      .has_value());

    afd::CommandContext ctx;
    ctx.trace_id = "trace-42";
    ctx.actor = afd::Actor{.kind = afd::ActorKind::human, .id = "secret-user"};
    CHECK(registry.execute("todo-create", {{"title", "Milk"}}, ctx).success);
    CHECK(registry.execute("internal-ping", afd::Json::object(), ctx).success);

    REQUIRE(sink->events.size() == 1);
    const auto& recorded = sink->events[0];
    CHECK(recorded.command_name == "todo-create");
    CHECK(recorded.success);
    CHECK(recorded.duration_ms == 25.0);
    CHECK(recorded.trace_id == "trace-42");
    CHECK(recorded.actor_kind == afd::ActorKind::human);
    CHECK(recorded.confidence == 0.85);
    CHECK(recorded.input == afd::Json{{"title", "Milk"}});
    CHECK(recorded.started_at == "2024-01-15T10:30:00.000Z");
    CHECK(recorded.completed_at == "2024-01-15T10:30:00.025Z");
    CHECK(recorded.command_version == "2.0.0");
    REQUIRE(recorded.metadata.has_value());
    CHECK((*recorded.metadata)["commandVersion"] == "2.0.0");

    // Default include_input is false, null sink is a no-op, and replacing context.clock during
    // next() does not invalidate the clock held by telemetry middleware.
    auto swap_sink = std::make_shared<MemorySink>();
    afd::CommandMiddleware swap_clock = [](std::string_view, const afd::Json&,
                                           afd::CommandContext& c, const afd::Next& next) {
        c.clock = afd::fixed_clock(1705314699000);
        return next();
    };
    afd::CommandRegistry safe_reg(
        {.middleware = {afd::create_telemetry_middleware({.sink = swap_sink}),
                        afd::create_telemetry_middleware({.sink = nullptr}), swap_clock}});
    REQUIRE_FALSE(safe_reg
                      .register_command(afd::CommandDefinition{
                          .name = "todo-swap",
                          .description = "Swap clock",
                          .handler =
                              [](const afd::Json&, afd::CommandContext&) {
                                  return afd::success(afd::Json{{"ok", true}});
                              },
                      })
                      .has_value());
    afd::CommandContext swap_ctx;
    swap_ctx.clock = afd::fixed_clock(1705314600000);
    CHECK(safe_reg.execute("todo-swap", {{"secret", "omit"}}, swap_ctx).success);
    REQUIRE(swap_sink->events.size() == 1);
    CHECK_FALSE(swap_sink->events[0].input.has_value());
    CHECK(swap_sink->events[0].started_at == "2024-01-15T10:30:00.000Z");
    CHECK(swap_sink->events[0].completed_at == "2024-01-15T10:30:00.000Z");

#if AFD_HAS_EXCEPTIONS
    // Sink failures are ignored; handler exceptions record UNHANDLED_ERROR and propagate to
    // registry redaction.
    struct FailingSink final : public afd::TelemetrySink {
        std::vector<afd::TelemetryEvent> events;
        bool fail = true;
        void record(const afd::TelemetryEvent& e) override {
            events.push_back(e);
            if (fail) {
                throw std::runtime_error("sink down");
            }
        }
    };
    auto flaky_sink = std::make_shared<FailingSink>();
    afd::CommandRegistry crash_reg(
        {.middleware = {afd::create_telemetry_middleware({.sink = flaky_sink, .clock = clock})},
         .clock = clock});
    REQUIRE_FALSE(crash_reg
                      .register_command(afd::CommandDefinition{
                          .name = "todo-ok",
                          .description = "Ok",
                          .handler =
                              [](const afd::Json&, afd::CommandContext&) {
                                  return afd::success(afd::Json{{"ok", true}});
                              },
                      })
                      .has_value());
    REQUIRE_FALSE(
        crash_reg
            .register_command(afd::CommandDefinition{
                .name = "todo-boom",
                .description = "Boom",
                .handler = [](const afd::Json&, afd::CommandContext&) -> afd::CommandResult {
                    throw std::runtime_error("boom");
                },
            })
            .has_value());
    CHECK(crash_reg.execute("todo-ok").success);
    const auto boom = crash_reg.execute("todo-boom");
    CHECK_FALSE(boom.success);
    CHECK(boom.error->code == afd::error_codes::COMMAND_EXECUTION_ERROR);
    REQUIRE(flaky_sink->events.size() == 2);
    CHECK(flaky_sink->events[0].success);
    CHECK_FALSE(flaky_sink->events[1].success);
    REQUIRE(flaky_sink->events[1].error.has_value());
    CHECK(flaky_sink->events[1].error->code == "UNHANDLED_ERROR");
#endif
}

TEST_CASE("create_retry_middleware counts a call outside the registry as a mutation (#2673)") {
    for (const bool retry_mutations : {false, true}) {
        auto retry = afd::create_retry_middleware(afd::RetryOptions{
            .max_retries = 1,
            .retry_delay_ms = 0,
            .sleep = [](double, const afd::CancellationToken&) { return true; },
            .retry_mutations = retry_mutations,
        });
        REQUIRE(retry.has_value());
        int attempts = 0;
        afd::CommandContext context;
        const afd::Next next = [&] {
            ++attempts;
            return afd::error("TIMEOUT", "Timed out");
        };
        const afd::CommandResult result = (*retry)("todo-get", afd::Json::object(), context, next);
        CHECK(result.error->code == "TIMEOUT");
        CHECK(attempts == (retry_mutations ? 2 : 1));
    }
}

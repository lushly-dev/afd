#include "afd/afd.hpp"

#include <memory>
#include <string>
#include <vector>

#include <doctest.h>

namespace {

std::unique_ptr<afd::CommandRegistry> registry_with(std::vector<afd::Middleware> middleware,
                                                    std::shared_ptr<afd::ManualClock> clock,
                                                    double handler_ms = 0) {
    auto registry = std::make_unique<afd::CommandRegistry>(
        afd::RegistryOptions{.middleware = std::move(middleware), .clock = clock});
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
    afd::SeededRandom random(42);
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

// Batch semantics from packages/core/src/command-execution.ts, including the cases in
// packages/server/src/execution-controls.test.ts (#216/#217).
#include "afd/afd.hpp"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include <doctest.h>

namespace {

afd::BatchRequest batch_of(int count, afd::BatchOptions options = {}) {
    afd::BatchRequest request;
    for (int i = 0; i < count; ++i) {
        request.commands.push_back({std::nullopt, "work-run", afd::Json{{"index", i}}});
    }
    request.options = options;
    return request;
}

int index_of(const afd::Json& input) {
    return input.at("index").get<int>();
}

afd::CommandError expected_error() {
    return afd::create_error("EXPECTED", "stop");
}

} // namespace

TEST_CASE("results keep request order and IDs; IDs default to cmd-<index>") {
    afd::BatchRequest request = batch_of(3);
    request.commands[1].id = "second";
    const auto batch =
        afd::execute_batch(request, [](std::string_view, const afd::Json& input,
                                       afd::CommandContext&) { return afd::success(input); });
    REQUIRE(batch.results.size() == 3);
    CHECK(batch.results[0].id == "cmd-0");
    CHECK(batch.results[1].id == "second");
    CHECK(batch.results[2].id == "cmd-2");
    CHECK(batch.results[2].result.data == afd::Json{{"index", 2}});
    CHECK(batch.success);
    CHECK(batch.reasoning == "Executed 3 commands: all succeeded");
}

TEST_CASE("stopOnError stops scheduling and counts skipped commands separately") {
    std::vector<int> started;
    const auto batch = afd::execute_batch(
        batch_of(3, {.stop_on_error = true}),
        [&](std::string_view, const afd::Json& input, afd::CommandContext&) {
            started.push_back(index_of(input));
            return index_of(input) == 0 ? afd::failure(expected_error()) : afd::success(input);
        });
    CHECK(started == std::vector<int>{0});
    CHECK(batch.success);
    CHECK(batch.summary.total == 3);
    CHECK(batch.summary.success_count == 0);
    CHECK(batch.summary.failure_count == 1);
    CHECK(batch.summary.skipped_count == 2);
    CHECK(batch.results[1].result.error->code == "COMMAND_SKIPPED");
    CHECK(batch.results[1].result.error->message ==
          "Command skipped because batch execution stopped after a failure");
    CHECK(batch.results[1].duration_ms == 0);
    CHECK(batch.reasoning == "Executed 3 commands: 1 failed, 2 skipped");
}

TEST_CASE("without stopOnError every command runs") {
    const auto batch = afd::execute_batch(
        batch_of(3), [](std::string_view, const afd::Json& input, afd::CommandContext&) {
            return index_of(input) == 1 ? afd::failure(expected_error()) : afd::success(input);
        });
    CHECK(batch.summary.success_count == 2);
    CHECK(batch.summary.failure_count == 1);
    CHECK(batch.reasoning == "Executed 3 commands: 2 succeeded, 1 failed");
    CHECK(batch.confidence == doctest::Approx(2.0 / 3.0 * 0.5 + 1.0 * 0.5));
}

TEST_CASE("a command finishing after the deadline, and every later one, gets BATCH_TIMEOUT") {
    auto clock = std::make_shared<afd::ManualClock>();
    int runs = 0;
    const auto batch = afd::execute_batch(
        batch_of(3, {.timeout = 10}),
        [&](std::string_view, const afd::Json& input, afd::CommandContext& context) {
            ++runs;
            CHECK(context.cancellation.deadline_ms() == doctest::Approx(10.0));
            clock->advance(index_of(input) == 1 ? 50 : 1);
            return afd::success(input);
        },
        {}, {.clock = clock});
    CHECK(runs == 2);
    CHECK(batch.results[0].result.success);
    for (std::size_t i : {1u, 2u}) {
        CAPTURE(i);
        const auto& error = batch.results[i].result.error;
        REQUIRE(error.has_value());
        CHECK(error->code == "BATCH_TIMEOUT");
        CHECK(error->message == "Batch timeout exceeded (10ms)");
        CHECK(error->retryable == true);
    }
    // BATCH_TIMEOUT counts as a failure, not a skip.
    CHECK(batch.summary.failure_count == 2);
    CHECK(batch.summary.skipped_count == 0);
}

TEST_CASE("timeout 0 times out the first command without running it") {
    int runs = 0;
    const auto batch =
        afd::execute_batch(batch_of(2, {.timeout = 0}),
                           [&](std::string_view, const afd::Json& input, afd::CommandContext&) {
                               ++runs;
                               return afd::success(input);
                           },
                           {}, {.clock = std::make_shared<afd::ManualClock>()});
    CHECK(runs == 0);
    CHECK(batch.results[0].result.error->code == "BATCH_TIMEOUT");
    CHECK(batch.results[1].result.error->code == "BATCH_TIMEOUT");
}

TEST_CASE("a cooperative handler stops at the deadline (real clock)") {
    const auto start = std::chrono::steady_clock::now();
    const auto batch =
        afd::execute_batch(batch_of(1, {.timeout = 10}),
                           [](std::string_view, const afd::Json&, afd::CommandContext& context) {
                               while (!context.cancellation.is_cancelled()) {
                                   std::this_thread::sleep_for(std::chrono::milliseconds(1));
                               }
                               return afd::success({{"late", true}});
                           });
    const auto elapsed = std::chrono::steady_clock::now() - start;
    CHECK(batch.results[0].result.error->code == "BATCH_TIMEOUT");
    CHECK(batch.timing.total_ms < 100);
    CHECK(elapsed < std::chrono::milliseconds(1000));
}

#if AFD_ENABLE_THREADS
TEST_CASE("ThreadTaskRunner bounds overlap at parallelism and keeps order") {
    std::atomic<int> active{0};
    std::atomic<int> peak{0};
    afd::BatchRequest request = batch_of(4, {.parallelism = 2});
    for (int i = 0; i < 4; ++i) {
        request.commands[static_cast<std::size_t>(i)].id = "request-" + std::to_string(i);
    }
    const auto batch = afd::execute_batch(
        request,
        [&](std::string_view, const afd::Json& input, afd::CommandContext&) {
            const int now = ++active;
            int seen = peak.load();
            while (now > seen && !peak.compare_exchange_weak(seen, now)) {
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(index_of(input) == 0 ? 20 : 5));
            --active;
            return afd::success(input);
        },
        {}, {.runner = std::make_shared<afd::ThreadTaskRunner>()});
    CHECK(peak == 2);
    for (int i = 0; i < 4; ++i) {
        CHECK(batch.results[static_cast<std::size_t>(i)].id == "request-" + std::to_string(i));
        CHECK(batch.results[static_cast<std::size_t>(i)].result.data == afd::Json{{"index", i}});
    }
}
#endif

TEST_CASE("the inline runner treats parallelism as an upper bound") {
    int active = 0;
    int peak = 0;
    const auto batch =
        afd::execute_batch(batch_of(4, {.parallelism = 3}),
                           [&](std::string_view, const afd::Json& input, afd::CommandContext&) {
                               peak = (std::max)(peak, ++active);
                               --active;
                               return afd::success(input);
                           });
    CHECK(peak == 1);
    CHECK(batch.summary.success_count == 4);
}

TEST_CASE("each command gets <trace>-<index>, and the batch metadata carries the trace") {
    std::vector<std::string> traces;
    afd::CommandContext context;
    context.trace_id = "trace-9";
    const auto batch = afd::execute_batch(
        batch_of(2),
        [&](std::string_view, const afd::Json& input, afd::CommandContext& ctx) {
            traces.push_back(*ctx.trace_id);
            return afd::success(input);
        },
        context);
    CHECK(traces == std::vector<std::string>{"trace-9-0", "trace-9-1"});
    CHECK(batch.metadata->trace_id == "trace-9");

    auto clock = std::make_shared<afd::ManualClock>(1767225600000);
    const auto untraced =
        afd::execute_batch(batch_of(1),
                           [](std::string_view, const afd::Json& input, afd::CommandContext&) {
                               return afd::success(input);
                           },
                           {}, {.clock = clock});
    CHECK(untraced.metadata->trace_id == "batch-1767225600000");
    CHECK(untraced.timing.started_at == "2026-01-01T00:00:00.000Z");
}

TEST_CASE("invalid envelopes are rejected before anything runs") {
    int runs = 0;
    const afd::CommandExecutor execute = [&](std::string_view, const afd::Json& input,
                                             afd::CommandContext&) {
        ++runs;
        return afd::success(input);
    };
    for (const char* text :
         {R"({"commands":[]})", R"({"commands":[{"command":"  "}]})",
          R"({"commands":[{"command":"a-b","id":7}]})",
          R"({"commands":[{"command":"a-b"}],"options":{"parallelism":0}})",
          R"({"commands":[{"command":"a-b"}],"options":{"parallelism":1.5}})",
          R"({"commands":[{"command":"a-b"}],"options":{"timeout":-1}})",
          R"({"commands":[{"command":"a-b"}],"options":{"stopOnError":"yes"}})",
          R"({"commands":[{"command":"a-b","id":null}]})", R"([])", R"({"commands":{}})"}) {
        CAPTURE(text);
        const auto batch = afd::execute_batch(afd::Json::parse(text), execute);
        CHECK_FALSE(batch.success);
        REQUIRE(batch.error.has_value());
        CHECK(batch.error->code == "INVALID_BATCH_REQUEST");
        CHECK(batch.error->message == "Invalid batch request envelope");
        CHECK(batch.reasoning == "Batch execution failed: Invalid batch request envelope");
        CHECK(batch.results.empty());
        CHECK(batch.confidence == 0);
        CHECK_FALSE(batch.metadata.has_value());
    }
    CHECK(runs == 0);
    // parallelism 2.0 is an integer, as in JavaScript.
    CHECK(afd::execute_batch(
              afd::Json::parse(R"({"commands":[{"command":"a-b"}],"options":{"parallelism":2.0}})"),
              execute)
              .success);
}

TEST_CASE("aggregation: singular reasoning, warnings and confidence") {
    const auto one = afd::create_batch_result(
        {{"cmd-0", 0, "a-b",
          afd::success(afd::Json::object(),
                       {.confidence = 0.5,
                        .warnings = std::vector<afd::Warning>{{"W1", "careful", {}, {}}}}),
          0}},
        {});
    CHECK(one.reasoning == "Executed 1 command: all succeeded");
    CHECK(one.confidence == doctest::Approx(0.75));
    REQUIRE(one.warnings.has_value());
    CHECK(afd::Json(one.warnings->front()) ==
          afd::Json{{"commandId", "cmd-0"}, {"code", "W1"}, {"message", "careful"}});
    CHECK(afd::calculate_batch_confidence({}) == 1.0);
}

TEST_CASE("an executor exception becomes COMMAND_EXECUTION_ERROR for that command only") {
#if defined(__cpp_exceptions) || defined(_CPPUNWIND)
    const auto batch = afd::execute_batch(
        batch_of(2),
        [](std::string_view, const afd::Json& input, afd::CommandContext&) -> afd::CommandResult {
            if (index_of(input) == 0) {
                throw std::runtime_error("secret");
            }
            return afd::success(input);
        });
    CHECK(batch.results[0].result.error->code == "COMMAND_EXECUTION_ERROR");
    CHECK(batch.results[0].result.error->message == "An internal error occurred");
    CHECK(batch.results[1].result.success);
#endif
}

TEST_CASE("the registry runs batches through execute, with validation and middleware") {
    afd::CommandRegistry registry;
    REQUIRE_FALSE(
        registry
            .register_command(
                {.name = "todo-create",
                 .description = "Create",
                 .input_schema = afd::Json::parse(
                     R"({"type":"object","properties":{"title":{"type":"string"}},"required":["title"]})"),
                 .handler = [](const afd::Json& input,
                               afd::CommandContext&) { return afd::success(input); }})
            .has_value());
    const auto batch = registry.execute_batch(afd::Json::parse(R"({"commands":[
        {"command":"todo-create","input":{"title":"a"}},
        {"command":"todo-create"},
        {"command":"todo-crate","input":{}}]})"));
    CHECK(batch.results[0].result.success);
    CHECK(batch.results[1].result.error->code == "VALIDATION_ERROR"); // no input: null
    CHECK(batch.results[2].result.error->code == "COMMAND_NOT_FOUND");
    CHECK(batch.results[0].result.metadata->trace_id->rfind("batch-", 0) == 0);
}

#if AFD_ENABLE_THREADS
TEST_CASE("the registry serves a threaded batch (run under TSan in CI)") {
    std::atomic<int> handled{0};
    afd::CommandRegistry registry(afd::CommandRegistryOptions{
        .middleware = afd::default_middleware({.logging = std::nullopt}),
        .runner = std::make_shared<afd::ThreadTaskRunner>()});
    REQUIRE_FALSE(registry
                      .register_command(
                          {.name = "work-run",
                           .description = "Work",
                           .input_schema = afd::Json::parse(
                               R"({"type":"object","properties":{"index":{"type":"integer"}}})"),
                           .handler =
                               [&](const afd::Json& input, afd::CommandContext&) {
                                   ++handled;
                                   return afd::success(input);
                               }})
                      .has_value());
    const auto batch = registry.execute_batch(batch_of(16, {.parallelism = 4}));
    CHECK(handled == 16);
    CHECK(batch.summary.success_count == 16);
    for (int i = 0; i < 16; ++i) {
        CHECK(batch.results[static_cast<std::size_t>(i)].result.data == afd::Json{{"index", i}});
    }
}
#endif

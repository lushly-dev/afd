// Specification-authored execution-controls vectors (spec/vectors/execution-controls.json;
// spec/execution-controls.md, #1737, #2131, #1766).
//
// Runs every vector case (per-call deadline, server default deadline, pre-cancelled single
// command, pre-cancelled batch, batch size/parallelism limits, validation issue cap, and the retry
// middleware's mutation rule) and verifies that no C++ gaps remain in `gaps`.
#include "afd/afd.hpp"
#if defined(AFD_HAS_MCP_STDIO)
#include "afd/mcp_stdio.hpp"
#endif

#include <fstream>
#include <iterator>
#include <memory>
#include <string>
#include <string_view>

#include <doctest.h>

namespace execution_controls_vectors {
namespace {

afd::Json load(const char* name) {
    std::ifstream in(std::string(AFD_VECTORS_DIR) + "/" + name, std::ios::binary);
    const std::string text{std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
    auto parsed = afd::parse_bounded(text);
    REQUIRE_MESSAGE(parsed.has_value(), name);
    return *parsed;
}

const afd::Json& find_case(const afd::Json& vectors, std::string_view id) {
    for (const auto& entry : vectors.at("cases")) {
        if (entry.at("id").get<std::string>() == id) {
            return entry;
        }
    }
    FAIL("missing case in execution-controls.json: " << id);
    return vectors.at("cases").at(0);
}

} // namespace
} // namespace execution_controls_vectors

TEST_CASE("execution-controls vectors pin normative defaults and have no C++ gaps") {
    const afd::Json vectors = execution_controls_vectors::load("execution-controls.json");
    const afd::Json& defaults = vectors.at("defaults");
    CHECK(defaults.at("defaultTimeoutMs").get<int>() == 30000);
#if defined(AFD_HAS_MCP_STDIO)
    CHECK(defaults.at("defaultTimeoutMs").get<double>() == afd::mcp::default_command_timeout_ms);
#endif
    CHECK(defaults.at("maxBatchSize").get<std::size_t>() == afd::default_max_batch_size);
    CHECK(defaults.at("maxBatchParallelism").get<std::size_t>() ==
          afd::default_max_batch_parallelism);
    CHECK(defaults.at("maxValidationIssues").get<std::size_t>() ==
          afd::default_max_validation_issues);

    CHECK_FALSE(vectors.at("gaps").contains("cpp"));

    for (const auto& entry : vectors.at("cases")) {
        const std::string control = entry.at("control").get<std::string>();
        const bool executed = (control == "deadline" || control == "defaultDeadline" ||
                               control == "singleCancellation" || control == "batchCancellation" ||
                               control == "batchLimits" || control == "validationIssueCap" ||
                               control == "retryMutation");
        CHECK_MESSAGE(executed, "control '" << control << "' must be executed by C++ tests");
    }
}

TEST_CASE(
    "execution-controls per-call deadline times out a handler that never polls cancellation") {
    const afd::Json vectors = execution_controls_vectors::load("execution-controls.json");
    const afd::Json& entry =
        execution_controls_vectors::find_case(vectors, "per-call-deadline-timeout");
    const afd::Json& call = entry.at("call");
    const afd::Json& expected = entry.at("expect");

    auto clock = std::make_shared<afd::ManualClock>();
    afd::CommandRegistry registry({.clock = clock});
    const double delay_ms = call.at("handler").at("delayMs").get<double>();
    bool signal_aborted = false;
    REQUIRE_FALSE(
        registry
            .register_command({.name = call.at("command").get<std::string>(),
                               .description = "Slow command that never polls cancellation",
                               .handler =
                                   [clock, delay_ms, &signal_aborted](
                                       const afd::Json&, afd::CommandContext& context) {
                                       // Advance time past the deadline without checking
                                       // cancellation to stop work; only observe whether the token
                                       // is now aborted.
                                       clock->advance(delay_ms);
                                       signal_aborted = context.cancellation.is_cancelled();
                                       return afd::success(afd::Json{{"done", true}});
                                   }})
            .has_value());

    afd::CommandContext context;
    context.timeout_ms = call.at("timeoutMs").get<double>();
    const afd::CommandResult result =
        registry.execute(call.at("command").get<std::string>(), afd::Json::object(), context);

    CHECK(result.success == expected.at("success").get<bool>());
    REQUIRE(result.error.has_value());
    CHECK(result.error->code == expected.at("code").get<std::string>());
    CHECK(result.error->retryable.value_or(false) == expected.at("retryable").get<bool>());
    CHECK(signal_aborted == expected.at("signalAborted").get<bool>());
    REQUIRE(result.error->details.has_value());
    CHECK((*result.error->details)["command"] == call.at("command"));
    CHECK((*result.error->details)["timeoutMs"] == call.at("timeoutMs"));
}

#if defined(AFD_HAS_MCP_STDIO)
TEST_CASE("execution-controls server default deadline applies when call omits timeout") {
    const afd::Json vectors = execution_controls_vectors::load("execution-controls.json");
    const afd::Json& entry =
        execution_controls_vectors::find_case(vectors, "server-default-deadline");
    const afd::Json& call = entry.at("call");
    const afd::Json& expected = entry.at("expect");

    auto clock = std::make_shared<afd::ManualClock>();
    afd::CommandRegistry registry({.clock = clock});
    const double delay_ms = call.at("handler").at("delayMs").get<double>();
    bool signal_aborted = false;
    REQUIRE_FALSE(
        registry
            .register_command({.name = call.at("command").get<std::string>(),
                               .description = "Slow command that never polls cancellation",
                               .handler =
                                   [clock, delay_ms, &signal_aborted](
                                       const afd::Json&, afd::CommandContext& context) {
                                       clock->advance(delay_ms);
                                       signal_aborted = context.cancellation.is_cancelled();
                                       return afd::success(afd::Json{{"done", true}});
                                   },
                               .expose = {.mcp = true}})
            .has_value());

    auto server = afd::mcp::StdioServer::create(
        registry, {.clock = clock,
                   .default_timeout_ms = entry.at("server").at("defaultTimeoutMs").get<double>()});
    REQUIRE(server.has_value());

    const afd::Json request = {{"jsonrpc", "2.0"},
                               {"id", 1},
                               {"method", "tools/call"},
                               {"params", {{"name", call.at("command")}}}};
    const auto reply = (*server)->handle_message(afd::wire::serialize(request));
    REQUIRE(reply.has_value());
    const auto parsed = afd::parse_bounded(*reply);
    REQUIRE(parsed.has_value());
    const afd::Json& body = parsed->at("result").at("structuredContent");
    CHECK(body.at("success").get<bool>() == expected.at("success").get<bool>());
    CHECK(body.at("error").at("code").get<std::string>() == expected.at("code").get<std::string>());
    CHECK(body.at("error").at("retryable").get<bool>() == expected.at("retryable").get<bool>());
    CHECK(signal_aborted == expected.at("signalAborted").get<bool>());
    CHECK(body.at("error").at("details").at("command") == call.at("command"));
    CHECK(body.at("error").at("details").at("timeoutMs") ==
          entry.at("server").at("defaultTimeoutMs"));
    CHECK(body.at("error").at("suggestion").is_string());
    CHECK_FALSE(body.at("error").at("suggestion").get<std::string>().empty());
}

TEST_CASE("StdioServer default_timeout_ms preserves JournalContextDigest hashes (#1766)") {
    auto clock = std::make_shared<afd::ManualClock>(1700000000000);
    auto sink = std::make_shared<afd::MemoryJournalSink>();
    afd::CommandRegistry registry(
        {.middleware = {afd::create_journal_middleware(sink)}, .clock = clock});
    REQUIRE_FALSE(registry
                      .register_command({.name = "work-ping",
                                         .description = "Fast command",
                                         .handler =
                                             [](const afd::Json&, afd::CommandContext&) {
                                                 return afd::success(afd::Json{{"ok", true}});
                                             },
                                         .expose = {.mcp = true}})
                      .has_value());

    const std::string request =
        R"({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"work-ping"}})";
    const auto fix_trace = [](afd::CommandContext& ctx, const afd::mcp::RequestInfo&) {
        ctx.trace_id = "fixed-trace";
    };
    auto with_default =
        afd::mcp::StdioServer::create(registry, {.clock = clock, .context_hook = fix_trace});
    REQUIRE(with_default.has_value());
    REQUIRE((*with_default)->handle_message(request).has_value());

    auto without_default = afd::mcp::StdioServer::create(
        registry, {.clock = clock, .context_hook = fix_trace, .default_timeout_ms = 0.0});
    REQUIRE(without_default.has_value());
    REQUIRE((*without_default)->handle_message(request).has_value());

    auto with_explicit = afd::mcp::StdioServer::create(
        registry, {.clock = clock,
                   .context_hook = [](afd::CommandContext& ctx, const afd::mcp::RequestInfo&) {
                       ctx.trace_id = "fixed-trace";
                       ctx.timeout_ms = 5000.0;
                   }});
    REQUIRE(with_explicit.has_value());
    REQUIRE((*with_explicit)->handle_message(request).has_value());

    const auto read_result = sink->read();
    REQUIRE(read_result.has_value());
    const auto& recorded = *read_result;
    REQUIRE(recorded.size() == 3);
    // Default server deadline must not add `timeoutMs` to the journal context digest.
    CHECK(recorded[0].context_digest.hash == recorded[1].context_digest.hash);
    CHECK(recorded[0].context_digest.surface == recorded[1].context_digest.surface);
    // An explicit per-call `timeout_ms` still changes the digest.
    CHECK(recorded[2].context_digest.hash != recorded[0].context_digest.hash);
}
#endif

TEST_CASE("execution-controls pre-cancelled single command runs neither middleware nor handler") {
    const afd::Json vectors = execution_controls_vectors::load("execution-controls.json");
    const afd::Json& entry =
        execution_controls_vectors::find_case(vectors, "pre-cancelled-single-command");
    const afd::Json& call = entry.at("call");
    const afd::Json& expected = entry.at("expect");

    bool middleware_ran = false;
    bool handler_ran = false;
    afd::CommandRegistry registry(
        {.middleware = {[&middleware_ran](std::string_view, const afd::Json&, afd::CommandContext&,
                                          const afd::Next& next) {
             middleware_ran = true;
             return next();
         }}});
    REQUIRE_FALSE(
        registry
            .register_command({.name = call.at("command").get<std::string>(),
                               .description = "Command that must not run when cancelled",
                               .input_schema = {{"type", "object"},
                                                {"properties", {{"x", {{"type", "string"}}}}},
                                                {"required", {"x"}}},
                               .handler =
                                   [&handler_ran](const afd::Json&, afd::CommandContext&) {
                                       handler_ran = true;
                                       return afd::success(afd::Json{{"ran", true}});
                                   }})
            .has_value());

    afd::CancellationSource source;
    source.cancel();
    afd::CommandContext context;
    context.cancellation = source.token();

    // Validation runs before the pre-dispatch cancellation check (#1766).
    const afd::CommandResult invalid =
        registry.execute(call.at("command").get<std::string>(), afd::Json::object(), context);
    CHECK_FALSE(invalid.success);
    REQUIRE(invalid.error.has_value());
    CHECK(invalid.error->code == "VALIDATION_ERROR");
    CHECK_FALSE(middleware_ran);
    CHECK_FALSE(handler_ran);

    // Valid input with a cancelled token returns COMMAND_CANCELLED before middleware and handler.
    const afd::CommandResult result =
        registry.execute(call.at("command").get<std::string>(), afd::Json{{"x", "ok"}}, context);
    CHECK(result.success == expected.at("success").get<bool>());
    REQUIRE(result.error.has_value());
    CHECK(result.error->code == expected.at("code").get<std::string>());
    CHECK(result.error->retryable.value_or(true) == expected.at("retryable").get<bool>());
    CHECK_FALSE(middleware_ran);
    CHECK(handler_ran == expected.at("handlerRan").get<bool>());
}

TEST_CASE("CommandRegistry skips handler when middleware cancels the call before next()") {
    afd::CancellationSource source;
    bool handler_ran = false;
    afd::CommandRegistry registry(
        {.middleware = {[&source](std::string_view, const afd::Json&, afd::CommandContext&,
                                  const afd::Next& next) {
             source.cancel();
             return next();
         }}});
    REQUIRE_FALSE(
        registry
            .register_command({.name = "work-run",
                               .description = "Cancelled during middleware",
                               .handler =
                                   [&handler_ran](const afd::Json&, afd::CommandContext&) {
                                       handler_ran = true;
                                       return afd::success(afd::Json{{"ran", true}});
                                   }})
            .has_value());
    afd::CommandContext context;
    context.cancellation = source.token();
    const afd::CommandResult result = registry.execute("work-run", afd::Json::object(), context);
    CHECK_FALSE(result.success);
    REQUIRE(result.error.has_value());
    CHECK(result.error->code == "COMMAND_CANCELLED");
    CHECK_FALSE(handler_ran);
}

TEST_CASE("CommandRegistry snapshots timeout_ms and turns late exceptions into TIMEOUT (#1766)") {
    auto clock = std::make_shared<afd::ManualClock>();
    afd::CommandRegistry registry({.clock = clock});
    REQUIRE_FALSE(registry
                      .register_command({.name = "work-clear-timeout",
                                         .description = "Clears context.timeout_ms then times out",
                                         .handler =
                                             [clock](const afd::Json&, afd::CommandContext& ctx) {
                                                 ctx.timeout_ms.reset();
                                                 clock->advance(50);
                                                 return afd::success(afd::Json{{"ok", true}});
                                             }})
                      .has_value());
    afd::CommandContext context;
    context.timeout_ms = 20;
    const afd::CommandResult cleared =
        registry.execute("work-clear-timeout", afd::Json::object(), context);
    CHECK_FALSE(cleared.success);
    REQUIRE(cleared.error.has_value());
    CHECK(cleared.error->code == "TIMEOUT");
    REQUIRE(cleared.error->details.has_value());
    CHECK((*cleared.error->details)["timeoutMs"] == 20);

#if defined(__cpp_exceptions) || defined(_CPPUNWIND)
    REQUIRE_FALSE(
        registry
            .register_command(
                {.name = "work-late-throw",
                 .description = "Throws after deadline expires",
                 .handler = [clock](const afd::Json&, afd::CommandContext&) -> afd::CommandResult {
                     clock->advance(50);
                     throw std::runtime_error("late failure");
                 }})
            .has_value());
    const afd::CommandResult thrown =
        registry.execute("work-late-throw", afd::Json::object(), context);
    CHECK_FALSE(thrown.success);
    REQUIRE(thrown.error.has_value());
    CHECK(thrown.error->code == "TIMEOUT");
    CHECK(thrown.error->retryable == true);
    REQUIRE(thrown.error->details.has_value());
    CHECK((*thrown.error->details)["timeoutMs"] == 20);
#endif
}

TEST_CASE("execution-controls pre-cancelled batch starts no command") {
    const afd::Json vectors = execution_controls_vectors::load("execution-controls.json");
    const afd::Json& entry = execution_controls_vectors::find_case(vectors, "pre-cancelled-batch");
    const afd::Json& expected = entry.at("expect");

    auto clock = std::make_shared<afd::ManualClock>();
    afd::CancellationSource source;
    source.cancel();

    int calls = 0;
    afd::CommandContext context;
    context.trace_id = "batch";
    context.cancellation = source.token();

    const afd::Json result = afd::execute_batch(
        entry.at("request"),
        [&calls](std::string_view, const afd::Json& input, afd::CommandContext&) {
            ++calls;
            return afd::success(input);
        },
        context, {.clock = clock});

    CHECK(result.at("success").get<bool>() == expected.at("success").get<bool>());
    CHECK(calls == expected.at("calls").get<int>());
    const auto& items = result.at("results");
    REQUIRE(items.size() == entry.at("request").at("commands").size());
    for (const auto& item : items) {
        CHECK(item.at("result").at("success").get<bool>() == false);
        CHECK(item.at("result").at("error").at("code").get<std::string>() ==
              expected.at("itemCode").get<std::string>());
        CHECK(item.at("durationMs").get<double>() == expected.at("durationMs").get<double>());
    }
}

TEST_CASE("execution-controls batch size and parallelism limits") {
    const afd::Json vectors = execution_controls_vectors::load("execution-controls.json");
    for (const char* case_id :
         {"batch-at-max-size-allowed", "batch-over-max-size-refused",
          "batch-at-max-parallelism-allowed", "batch-over-max-parallelism-refused"}) {
        CAPTURE(case_id);
        const afd::Json& entry = execution_controls_vectors::find_case(vectors, case_id);
        const auto max_size = entry.at("limits").at("maxBatchSize").get<std::size_t>();
        const auto max_parallelism =
            entry.at("limits").at("maxBatchParallelism").get<std::size_t>();
        const auto command_count = entry.at("commandCount").get<std::size_t>();
        const auto parallelism = entry.at("parallelism").get<std::int64_t>();
        const afd::Json& expected = entry.at("expect");

        afd::BatchRequest request;
        request.commands.reserve(command_count);
        for (std::size_t i = 0; i < command_count; ++i) {
            request.commands.push_back({.command = "work-run", .input = afd::Json{{"index", i}}});
        }
        request.options = afd::BatchOptions{.parallelism = parallelism};

        int calls = 0;
        const afd::BatchResult result = afd::execute_batch(
            request,
            [&calls](std::string_view, const afd::Json& input, afd::CommandContext&) {
                ++calls;
                return afd::success(input);
            },
            {}, {.max_batch_size = max_size, .max_batch_parallelism = max_parallelism});

        CHECK(result.success == expected.at("success").get<bool>());
        if (result.success) {
            CHECK(result.summary.total == expected.at("total").get<std::int64_t>());
            CHECK(result.summary.success_count == expected.at("successCount").get<std::int64_t>());
        } else {
            CHECK(calls == expected.at("calls").get<int>());
            CHECK(result.results.size() == expected.at("resultsLength").get<std::size_t>());
            REQUIRE(result.error.has_value());
            CHECK(result.error->code == expected.at("code").get<std::string>());
            CHECK(result.error->retryable.value_or(true) == expected.at("retryable").get<bool>());
            REQUIRE(result.error->suggestion.has_value());
            CHECK(result.error->suggestion->find(std::to_string(max_size)) != std::string::npos);
            CHECK(result.error->suggestion->find(std::to_string(max_parallelism)) !=
                  std::string::npos);
        }
    }
}

TEST_CASE("execution-controls validation issue cap") {
    const afd::Json vectors = execution_controls_vectors::load("execution-controls.json");
    for (const char* case_id :
         {"validation-issues-at-cap-not-truncated", "validation-issues-over-cap-truncated"}) {
        CAPTURE(case_id);
        const afd::Json& entry = execution_controls_vectors::find_case(vectors, case_id);
        const auto limit = entry.at("limit").get<std::size_t>();
        const auto invalid_count = entry.at("invalidItemCount").get<std::size_t>();
        const afd::Json& expected = entry.at("expect");

        auto registry_result = afd::CommandRegistry::create({.max_validation_issues = limit});
        REQUIRE(registry_result.has_value());
        auto& registry = *registry_result;
        const auto reg_error = registry->register_command(
            {.name = "validate-many",
             .description = "Validation issue cap vector",
             .input_schema =
                 afd::Json{{"type", "object"},
                           {"properties",
                            {{"values", {{"type", "array"}, {"items", {{"type", "string"}}}}}}},
                           {"required", afd::Json::array({"values"})}},
             .handler = [](const afd::Json& input, afd::CommandContext&) {
                 return afd::success(input);
             }});
        REQUIRE_FALSE(reg_error.has_value());

        afd::Json items = afd::Json::array();
        for (std::size_t i = 0; i < invalid_count; ++i) {
            items.push_back(0);
        }
        const afd::CommandResult result =
            registry->execute("validate-many", afd::Json{{"values", std::move(items)}});
        CHECK(result.success == expected.at("success").get<bool>());
        REQUIRE(result.error.has_value());
        CHECK(result.error->code == expected.at("code").get<std::string>());
        CHECK(result.error->retryable.value_or(false) == expected.at("retryable").get<bool>());
        REQUIRE(result.error->details.has_value());
        const auto& details = *result.error->details;
        CHECK(details.at("errors").size() == expected.at("reportedErrors").get<std::size_t>());
        if (expected.at("truncated").get<bool>()) {
            CHECK(details.at("truncated").get<bool>() == true);
            CHECK(details.at("limit").get<std::size_t>() ==
                  expected.at("detailsLimit").get<std::size_t>());
            CHECK(details.at("totalErrors").get<std::size_t>() == invalid_count);
            REQUIRE(result.error->suggestion.has_value());
            CHECK(result.error->suggestion->find("Showing first " + std::to_string(limit) +
                                                 " validation issues") != std::string::npos);
        } else {
            CHECK_FALSE(details.contains("truncated"));
            CHECK_FALSE(details.contains("limit"));
            CHECK_FALSE(details.contains("totalErrors"));
        }
    }
}

TEST_CASE("CommandRegistry::create rejects zero execution-control limits") {
    CHECK_FALSE(afd::CommandRegistry::create({.max_batch_size = 0}).has_value());
    CHECK_FALSE(afd::CommandRegistry::create({.max_batch_parallelism = 0}).has_value());
    CHECK_FALSE(afd::CommandRegistry::create({.max_validation_issues = 0}).has_value());
}

TEST_CASE("execution-controls retry middleware repeats a mutation only with the option (#2673)") {
    const afd::Json vectors = execution_controls_vectors::load("execution-controls.json");
    std::vector<std::string> ids;
    for (const auto& entry : vectors.at("cases")) {
        if (entry.at("control").get<std::string>() != "retryMutation") {
            continue;
        }
        const std::string id = entry.at("id").get<std::string>();
        ids.push_back(id);
        CAPTURE(id);
        const afd::Json& retry = entry.at("retry");
        const afd::Json& expected = entry.at("expect");
        const std::string code = entry.at("handler").at("failFirst").at("code").get<std::string>();
        const std::string name = entry.at("command").at("name").get<std::string>();
        auto middleware = afd::create_retry_middleware(afd::RetryOptions{
            .max_retries = retry.at("maxRetries").get<int>(),
            .retry_delay_ms = retry.at("retryDelayMs").get<double>(),
            .jitter = retry.at("jitter").get<bool>(),
            .sleep = [](double, const afd::CancellationToken&) { return true; },
            .retry_mutations = retry.value("retryMutations", false),
        });
        REQUIRE(middleware.has_value());
        int runs = 0;
        afd::CommandRegistry registry({.middleware = {*middleware}});
        REQUIRE_FALSE(registry
                          .register_command(afd::CommandDefinition{
                              .name = name,
                              .description = "Fails once, then succeeds",
                              .handler =
                                  [&](const afd::Json&, afd::CommandContext&) {
                                      if (++runs == 1) {
                                          return afd::error(code, "Downstream timed out");
                                      }
                                      return afd::success(afd::Json{{"runs", runs}});
                                  },
                              .mutation = entry.at("command").at("mutation").get<bool>(),
                          })
                          .has_value());
        const afd::CommandResult result = registry.execute(name);
        CHECK(runs == expected.at("handlerRuns").get<int>());
        CHECK(result.success == expected.at("success").get<bool>());
        if (expected.contains("code")) {
            REQUIRE(result.error.has_value());
            CHECK(result.error->code == expected.at("code").get<std::string>());
        }
    }
    CHECK(ids == std::vector<std::string>{"retry-read-after-timeout", "retry-mutation-not-repeated",
                                          "retry-mutation-with-option"});
}

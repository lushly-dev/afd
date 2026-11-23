// Output budgets (spec/output-budgets.md, B1 to B8): every case of spec/vectors/output-budgets.json
// in process (registry, batches, pipelines, streams, DirectClient, journal and replay) and, with
// AFD_BUILD_MCP_STDIO, over afd::mcp::StdioServer in both MCP eras.
#include "afd/afd.hpp"

#include "detail/output_budget.hpp"

#ifdef AFD_HAS_MCP_STDIO
#include "afd/mcp_stdio.hpp"
#endif

#include <cstdint>
#include <fstream>
#include <iterator>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include <doctest.h>

// Named, not anonymous: unity builds share translation units across test files.
namespace output_budget_test {

using afd::Json;

void register_ok(afd::CommandRegistry& registry, afd::CommandDefinition def) {
    const auto error = registry.register_command(std::move(def));
    REQUIRE_MESSAGE(!error, error.value_or(""));
}

Json load_vectors(const char* name) {
    const std::string path = std::string(AFD_VECTORS_DIR) + "/" + name;
    std::ifstream in(path, std::ios::binary);
    REQUIRE_MESSAGE(in.good(), "could not open " << path);
    const std::string text{std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
    auto parsed = afd::parse_bounded(text);
    REQUIRE_MESSAGE(parsed.has_value(), parsed.error().message);
    return std::move(*parsed);
}

const Json& cases() {
    static const Json data = load_vectors("output-budgets.json");
    return data;
}

std::string description_of(const Json& item) {
    return item.contains("description") && item["description"].is_string()
               ? item["description"].get<std::string>()
               : std::string();
}

afd::CommandResult parse_result(const Json& value) {
    auto parsed = afd::CommandResult::from_json(value);
    REQUIRE_MESSAGE(parsed.has_value(), parsed.error());
    return std::move(*parsed);
}

afd::CommandDefinition make_definition(std::string name, const Json& declaration, bool mutation,
                                       afd::CommandHandler handler,
                                       Json input_schema = Json{{"type", "object"}}) {
    afd::CommandDefinition def;
    def.name = std::move(name);
    def.description = "A test command";
    def.input_schema = std::move(input_schema);
    def.handler = std::move(handler);
    def.mutation = mutation;
    def.expose.mcp = true;
    if (!declaration.is_null()) {
        auto parsed = afd::OutputBudget::from_json(declaration);
        REQUIRE_MESSAGE(parsed.has_value(), parsed.error());
        def.output_budget = *parsed;
    }
    return def;
}

/// The comparison spec/output-budgets.md defines for `checks`: JSON equality with `metadata`
/// compared only on `dev.afd/outputBudget`.
void assert_same_result(const Json& actual, const Json& expected, const std::string& label) {
    Json left = actual;
    Json right = expected;
    Json left_report = nullptr;
    Json right_report = nullptr;
    if (left.is_object() && left.contains("metadata")) {
        const Json& meta = left["metadata"];
        if (meta.is_object() && meta.contains(std::string(afd::output_budget_meta_key))) {
            left_report = meta[std::string(afd::output_budget_meta_key)];
        }
        left.erase("metadata");
    }
    if (right.is_object() && right.contains("metadata")) {
        const Json& meta = right["metadata"];
        if (meta.is_object() && meta.contains(std::string(afd::output_budget_meta_key))) {
            right_report = meta[std::string(afd::output_budget_meta_key)];
        }
        right.erase("metadata");
    }
    CHECK_MESSAGE(left == right, label << "\nactual:   " << afd::wire::serialize(actual)
                                       << "\nexpected: " << afd::wire::serialize(expected));
    CHECK_MESSAGE(left_report == right_report,
                  label << " (report)\nactual:   " << afd::wire::serialize(left_report)
                        << "\nexpected: " << afd::wire::serialize(right_report));
}

/// Builds an in-process context for a case's `ask` when it is absent, null, or `{maxBytes: u64}`.
std::optional<afd::CommandContext> in_process_ask_context(const Json& item) {
    if (!item.contains("ask") || item["ask"].is_null()) {
        return afd::CommandContext{};
    }
    const Json& ask = item["ask"];
    if (ask.is_object() && ask.size() == 1 && ask.contains("maxBytes") &&
        ask["maxBytes"].is_number_unsigned()) {
        afd::CommandContext context;
        context.output_budget_ask = ask["maxBytes"].get<std::uint64_t>();
        return context;
    }
    if (ask.is_object() && ask.size() == 1 && ask.contains("maxBytes") &&
        ask["maxBytes"].is_number_integer() && ask["maxBytes"].get<std::int64_t>() >= 0) {
        afd::CommandContext context;
        context.output_budget_ask = static_cast<std::uint64_t>(ask["maxBytes"].get<std::int64_t>());
        return context;
    }
    return std::nullopt;
}

/// Builds a context carrying any JSON `ask` through the raw `_meta` carrier.
afd::CommandContext raw_ask_context(const Json& item) {
    afd::CommandContext context;
    if (item.contains("ask") && !item["ask"].is_null()) {
        context.output_budget_meta_ask = std::make_shared<const afd::detail::RawOutputBudgetAsk>(
            afd::detail::RawOutputBudgetAsk{item["ask"]});
    }
    return context;
}

std::optional<std::uint64_t> expected_effective(const Json& item) {
    if (item.contains("effective") && item["effective"].is_number_unsigned()) {
        return item["effective"].get<std::uint64_t>();
    }
    if (item.contains("effective") && item["effective"].is_number_integer() &&
        item["effective"].get<std::int64_t>() >= 0) {
        return static_cast<std::uint64_t>(item["effective"].get<std::int64_t>());
    }
    return std::nullopt;
}

std::shared_ptr<afd::CommandRegistry> make_batch_registry(const Json& batch_case) {
    auto table = std::make_shared<std::map<std::string, afd::CommandResult>>();
    for (const Json& item : batch_case["items"]) {
        table->emplace(item["id"].get<std::string>(), parse_result(item["result"]));
    }
    auto registry = std::make_shared<afd::CommandRegistry>();
    const Json id_schema{{"type", "object"},
                         {"properties", {{"id", {{"type", "string"}}}}},
                         {"required", Json::array({"id"})}};
    for (auto it = batch_case["commands"].begin(); it != batch_case["commands"].end(); ++it) {
        const Json& spec = it.value();
        register_ok(*registry, make_definition(
                                   it.key(), spec["declaration"], spec["mutation"] == true,
                                   [table](const Json& input, afd::CommandContext&) {
                                       return table->at(input["id"].get<std::string>());
                                   },
                                   id_schema));
    }
    return registry;
}

} // namespace output_budget_test

// ═══════════════════════════════════════════════════════════════════════════════
// B1: DECLARATIONS
// ═══════════════════════════════════════════════════════════════════════════════

TEST_CASE("output budgets: declarations are checked when defined or registered") {
    using namespace output_budget_test;
    for (const Json& item : cases()["declarations"]) {
        const std::string label = description_of(item);
        const Json& value = item["value"];
        const bool valid = item["valid"] == true;
        const auto parsed = afd::OutputBudget::from_json(value);
        CHECK_MESSAGE(parsed.has_value() == valid,
                      label << ": " << (parsed ? "accepted" : parsed.error()));
        if (!parsed) {
            CHECK_MESSAGE(parsed.error().find("outputBudget") != std::string::npos,
                          label << ": " << parsed.error());
        }
        // Integer-pair declarations registered directly must reach the same verdict, naming
        // both the command and the field.
        if (value.is_object() && value.size() == 2 && value.contains("defaultBytes") &&
            value.contains("maxBytes") &&
            (value["defaultBytes"].is_number_unsigned() ||
             (value["defaultBytes"].is_number_integer() &&
              value["defaultBytes"].get<std::int64_t>() >= 0)) &&
            (value["maxBytes"].is_number_unsigned() ||
             (value["maxBytes"].is_number_integer() &&
              value["maxBytes"].get<std::int64_t>() >= 0))) {
            afd::CommandRegistry registry;
            afd::CommandDefinition def{
                .name = "doc-search",
                .description = "Search",
                .handler = [](const Json&, afd::CommandContext&) { return afd::success(nullptr); },
                .output_budget =
                    afd::OutputBudget{.default_bytes = value["defaultBytes"].get<std::uint64_t>(),
                                      .max_bytes = value["maxBytes"].get<std::uint64_t>()},
            };
            const auto registered = registry.register_command(std::move(def));
            CHECK_MESSAGE(!registered.has_value() == valid,
                          label << ": " << registered.value_or("accepted"));
            if (registered) {
                CHECK_MESSAGE(registered->find("doc-search") != std::string::npos, *registered);
                CHECK_MESSAGE(registered->find("outputBudget.") != std::string::npos, *registered);
            }
        }
    }

    // Integral floats count as integers; non-integers and out-of-range values do not.
    CHECK(afd::detail::parse_positive_safe_integer(Json(100.0)) == 100);
    CHECK_FALSE(afd::detail::parse_positive_safe_integer(Json(10.5)).has_value());
    CHECK_FALSE(afd::detail::parse_positive_safe_integer(Json(0)).has_value());
    CHECK_FALSE(afd::detail::parse_positive_safe_integer(Json(-5)).has_value());
    CHECK_FALSE(afd::detail::parse_positive_safe_integer(Json("100")).has_value());
    CHECK_FALSE(afd::detail::parse_positive_safe_integer(Json(true)).has_value());
    CHECK_FALSE(afd::detail::parse_positive_safe_integer(Json(9007199254740992ULL)).has_value());
    CHECK(afd::detail::parse_positive_safe_integer(Json(9007199254740991ULL)) ==
          afd::max_output_budget_bytes);

    // Effective clamping.
    const afd::OutputBudget budget{.default_bytes = 64, .max_bytes = 128};
    CHECK(budget.effective(std::nullopt) == 64);
    CHECK(budget.effective(10) == 10);
    CHECK(budget.effective(1000) == 128);
}

TEST_CASE("output budgets: outputBudget and output_budget are reserved context field names") {
    for (const char* name :
         {"outputBudget", "output_budget", "output_budget_ask", "output_budget_meta_ask"}) {
        auto created = afd::CommandRegistry::create(
            {.context_fields = {afd::ContextField{
                 .name = name, .meta = "dev.example/budget", .schema = {{"type", "number"}}}}});
        REQUIRE_FALSE(created.has_value());
        CHECK_MESSAGE(created.error().find(name) != std::string::npos, created.error());
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// B2 to B4: ASKS AND EFFECTIVE BUDGET
// ═══════════════════════════════════════════════════════════════════════════════

TEST_CASE("output budgets: asks produce the expected effective budget or VALIDATION_ERROR") {
    using namespace output_budget_test;
    const Json expected_invalid_details{{"field", "outputBudget"},
                                        {"meta", "dev.afd/outputBudget"}};
    std::size_t in_process_run = 0;
    for (const Json& item : cases()["asks"]) {
        const std::string label = description_of(item);
        const bool expect_invalid = item["effective"] == "VALIDATION_ERROR";

        // Run every case through the raw `_meta` carrier.
        {
            std::optional<std::optional<std::uint64_t>> seen;
            afd::CommandRegistry registry;
            register_ok(registry,
                        make_definition("doc-search", item["declaration"], false,
                                        [&seen](const Json&, afd::CommandContext& context) {
                                            seen = context.output_budget;
                                            return afd::success(nullptr);
                                        }));
            const afd::CommandResult result =
                registry.execute("doc-search", Json::object(), raw_ask_context(item));
            if (expect_invalid) {
                REQUIRE_FALSE(result.success);
                REQUIRE(result.error.has_value());
                CHECK_MESSAGE(result.error->code == "VALIDATION_ERROR", label);
                CHECK_MESSAGE(result.error->retryable == false, label);
                REQUIRE(result.error->details.has_value());
                CHECK_MESSAGE(*result.error->details == expected_invalid_details, label);
                REQUIRE(result.error->suggestion.has_value());
                CHECK_MESSAGE(result.error->suggestion->find(
                                  "{ \"maxBytes\": <positive integer> }") != std::string::npos,
                              label << ": " << *result.error->suggestion);
                CHECK_MESSAGE(!seen.has_value(), label << ": handler ran");
            } else {
                REQUIRE_MESSAGE(seen.has_value(), label << ": handler did not run");
                CHECK_MESSAGE(*seen == expected_effective(item), label);
            }
        }

        // Also run every case expressible in process via `CommandContext::output_budget_ask`.
        if (auto context = in_process_ask_context(item)) {
            ++in_process_run;
            std::optional<std::optional<std::uint64_t>> seen;
            afd::CommandRegistry registry;
            register_ok(registry, make_definition("doc-search", item["declaration"], false,
                                                  [&seen](const Json&, afd::CommandContext& ctx) {
                                                      seen = ctx.output_budget;
                                                      return afd::success(nullptr);
                                                  }));
            const afd::CommandResult result =
                registry.execute("doc-search", Json::object(), std::move(*context));
            if (expect_invalid) {
                REQUIRE_FALSE(result.success);
                REQUIRE(result.error.has_value());
                CHECK_MESSAGE(result.error->code == "VALIDATION_ERROR", label);
                CHECK_MESSAGE(!seen.has_value(), label);
            } else {
                REQUIRE_MESSAGE(seen.has_value(), label);
                CHECK_MESSAGE(*seen == expected_effective(item), label);
            }
        }
    }
    CHECK(in_process_run >= 12);
}

TEST_CASE("output budgets: invalid ask fails before middleware and handler") {
    using namespace output_budget_test;
    bool middleware_ran = false;
    bool handler_ran = false;
    afd::CommandRegistry registry({.middleware = {[&](std::string_view, const Json&,
                                                      afd::CommandContext&, const afd::Next& next) {
                                       middleware_ran = true;
                                       return next();
                                   }}});
    // Even without a declaration, an invalid ask fails validation before middleware (B2).
    register_ok(registry,
                make_definition("doc-open", nullptr, false, [&](const Json&, afd::CommandContext&) {
                    handler_ran = true;
                    return afd::success(nullptr);
                }));
    afd::CommandContext context;
    context.output_budget_ask = 0;
    const afd::CommandResult result = registry.execute("doc-open", Json::object(), context);
    REQUIRE_FALSE(result.success);
    REQUIRE(result.error.has_value());
    CHECK(result.error->code == "VALIDATION_ERROR");
    CHECK_FALSE(middleware_ran);
    CHECK_FALSE(handler_ran);
}

TEST_CASE("output budgets: trusted output_budget_ask wins over raw _meta ask and stale budget") {
    using namespace output_budget_test;
    std::optional<std::uint64_t> seen;
    afd::CommandRegistry registry;
    register_ok(registry,
                make_definition("doc-search", Json{{"defaultBytes", 64}, {"maxBytes", 128}}, false,
                                [&](const Json&, afd::CommandContext& context) {
                                    seen = context.output_budget;
                                    return afd::success(Json{{"ok", true}});
                                }));
    register_ok(registry, make_definition("doc-open", nullptr, false,
                                          [&](const Json&, afd::CommandContext& context) {
                                              seen = context.output_budget;
                                              return afd::success(Json{{"ok", true}});
                                          }));

    // Trusted ask wins over a `_meta` ask.
    afd::CommandContext trusted;
    trusted.output_budget_ask = 40;
    trusted.output_budget_meta_ask = std::make_shared<const afd::detail::RawOutputBudgetAsk>(
        afd::detail::RawOutputBudgetAsk{Json{{"maxBytes", 128}}});
    const afd::CommandResult r1 = registry.execute("doc-search", Json::object(), trusted);
    CHECK(r1.success);
    CHECK(seen == 40);

    // A stale `output_budget` on the context is cleared on an unbudgeted command.
    afd::CommandContext stale;
    stale.output_budget = 999;
    stale.output_budget_ask = 1;
    const afd::CommandResult r2 = registry.execute("doc-open", Json::object(), stale);
    CHECK(r2.success);
    CHECK_FALSE(seen.has_value());
    REQUIRE(r2.metadata.has_value());
    CHECK_FALSE(r2.metadata->extra.contains(std::string(afd::output_budget_meta_key)));
}

// ═══════════════════════════════════════════════════════════════════════════════
// B5 & B6: MEASURING, CHECKING AND REPORTING
// ═══════════════════════════════════════════════════════════════════════════════

TEST_CASE("output budgets: measured size is canonical JSON without metadata") {
    using namespace output_budget_test;
    std::size_t run = 0;
    for (const Json& item : cases()["measure"]) {
        const std::string label = description_of(item);
        const auto bytes = item["bytes"].get<std::uint64_t>();
        const std::string raw = item["json"].get<std::string>();
        auto parsed = afd::parse_bounded(raw);
        if (!parsed) {
            // nlohmann::json rejects unpaired UTF-16 surrogates, as serde_json does in Rust.
            CHECK_MESSAGE(label.find("lone surrogate") != std::string::npos,
                          label << ": unexpected parse failure: " << parsed.error().message);
            continue;
        }
        ++run;
        const afd::CommandResult fixed = parse_result(*parsed);

        // Exactly at budget passes with limitBytes == usedBytes == bytes.
        {
            afd::CommandRegistry registry;
            register_ok(
                registry,
                afd::CommandDefinition{
                    .name = "doc-search",
                    .description = "Search",
                    .handler = [fixed](const Json&, afd::CommandContext&) { return fixed; },
                    .output_budget = afd::OutputBudget{.default_bytes = bytes, .max_bytes = bytes},
                });
            const afd::CommandResult fits = registry.execute("doc-search");
            REQUIRE_MESSAGE(fits.success, label);
            REQUIRE(fits.metadata.has_value());
            const Json expected_report{{"limitBytes", bytes}, {"usedBytes", bytes}};
            CHECK_MESSAGE(fits.metadata->extra[std::string(afd::output_budget_meta_key)] ==
                              expected_report,
                          label);
        }

        // One byte below budget fails with OUTPUT_BUDGET_EXCEEDED and actualBytes == bytes.
        if (bytes > 1) {
            afd::CommandRegistry registry;
            register_ok(registry,
                        afd::CommandDefinition{
                            .name = "doc-search",
                            .description = "Search",
                            .handler = [fixed](const Json&, afd::CommandContext&) { return fixed; },
                            .output_budget = afd::OutputBudget{.default_bytes = bytes - 1,
                                                               .max_bytes = bytes - 1},
                        });
            const afd::CommandResult over = registry.execute("doc-search");
            REQUIRE_MESSAGE(!over.success, label << ": not replaced");
            REQUIRE(over.error.has_value());
            CHECK_MESSAGE(over.error->code == "OUTPUT_BUDGET_EXCEEDED", label);
            REQUIRE(over.error->details.has_value());
            CHECK_MESSAGE((*over.error->details)["actualBytes"] == bytes, label);
        }
    }
    CHECK(run >= 9);
}

TEST_CASE("output budgets: post-handler check matches every spec case") {
    using namespace output_budget_test;
    for (const Json& item : cases()["checks"]) {
        const std::string label = description_of(item);
        const afd::CommandResult fixed = parse_result(item["result"]);
        afd::CommandRegistry registry;
        register_ok(registry,
                    make_definition("doc-search", item["declaration"], item["mutation"] == true,
                                    [fixed](const Json&, afd::CommandContext&) { return fixed; }));
        auto context = in_process_ask_context(item);
        REQUIRE_MESSAGE(context.has_value(), label);
        const afd::CommandResult result =
            registry.execute("doc-search", Json::object(), std::move(*context));
        assert_same_result(Json(result), item["expected"], label);
        // Handler's extra metadata survives alongside the report.
        if (item["expected"].contains("metadata") &&
            item["expected"]["metadata"].contains("note")) {
            REQUIRE(result.metadata.has_value());
            CHECK(result.metadata->extra["note"] == item["expected"]["metadata"]["note"]);
        }
    }
}

TEST_CASE("output budgets: middleware, on_command, journal and stamping see checked result") {
    using namespace output_budget_test;
    std::vector<std::string> middleware_codes;
    std::vector<std::string> hook_codes;
    auto sink = std::make_shared<afd::MemoryJournalSink>();
    afd::CommandRegistry registry(
        {.middleware = {[&](std::string_view, const Json&, afd::CommandContext&,
                            const afd::Next& next) {
                            afd::CommandResult result = next();
                            if (result.error) {
                                middleware_codes.push_back(result.error->code);
                            }
                            return result;
                        },
                        afd::create_journal_middleware(sink, {.record_failures = true})},
         .on_command = [&](std::string_view, const Json&, const afd::CommandResult& result) {
             if (result.error) {
                 hook_codes.push_back(result.error->code);
             }
         }});
    register_ok(registry,
                afd::CommandDefinition{
                    .name = "doc-search",
                    .description = "Search",
                    .handler =
                        [](const Json&, afd::CommandContext& context) {
                            // Mutating context.output_budget inside the handler must
                            // not evade B5.
                            context.output_budget = 999999;
                            return afd::success(Json{{"text", std::string(200, 'x')}});
                        },
                    .version = "1.2.0",
                    .output_budget = afd::OutputBudget{.default_bytes = 64, .max_bytes = 128},
                });

    afd::CommandContext context;
    context.trace_id = "trace-budget-1";
    context.actor = afd::Actor{.kind = afd::ActorKind::agent};
    const afd::CommandResult result = registry.execute("doc-search", Json::object(), context);
    REQUIRE_FALSE(result.success);
    REQUIRE(result.error.has_value());
    CHECK(result.error->code == "OUTPUT_BUDGET_EXCEEDED");
    REQUIRE(result.metadata.has_value());
    CHECK(result.metadata->actor_kind == afd::ActorKind::agent);
    CHECK(result.metadata->trace_id == "trace-budget-1");
    CHECK(result.metadata->command_version == "1.2.0");
    CHECK_FALSE(result.metadata->extra.contains(std::string(afd::output_budget_meta_key)));

    CHECK(middleware_codes == std::vector<std::string>{"OUTPUT_BUDGET_EXCEEDED"});
    CHECK(hook_codes == std::vector<std::string>{"OUTPUT_BUDGET_EXCEEDED"});

    const auto entries = sink->read();
    REQUIRE(entries.has_value());
    REQUIRE(entries->size() == 1);
    REQUIRE((*entries)[0].result.error.has_value());
    CHECK((*entries)[0].result.error->code == "OUTPUT_BUDGET_EXCEEDED");
    CHECK((*entries)[0].output_budget == 64);
}

// ═══════════════════════════════════════════════════════════════════════════════
// B7: BATCHES, PIPELINES, DIRECT CLIENT AND STREAMS
// ═══════════════════════════════════════════════════════════════════════════════

TEST_CASE("output budgets: batch ask applies per item against each item's command") {
    using namespace output_budget_test;
    const Json& batch_case = cases()["batch"];
    const auto registry = make_batch_registry(batch_case);

    std::vector<afd::BatchCommand> commands;
    for (const Json& item : batch_case["items"]) {
        commands.push_back(afd::BatchCommand{
            .id = item["id"].get<std::string>(),
            .command = item["command"].get<std::string>(),
            .input = Json{{"id", item["id"]}},
        });
    }
    afd::CommandContext context;
    context.output_budget_ask = batch_case["ask"]["maxBytes"].get<std::uint64_t>();
    const afd::BatchResult result =
        registry->execute_batch(afd::BatchRequest{.commands = commands}, context);

    REQUIRE(result.results.size() == batch_case["items"].size());
    for (std::size_t i = 0; i < batch_case["items"].size(); ++i) {
        assert_same_result(Json(result.results[i].result), batch_case["items"][i]["expected"],
                           batch_case["items"][i]["id"].get<std::string>());
    }
    CHECK(result.summary.failure_count == 1);

    // With stopOnError, a replaced item stops the batch and skips remaining items.
    afd::BatchRequest stop_req{
        .commands =
            {
                {.id = "d", .command = "doc-open", .input = Json{{"id", "d"}}},
                {.id = "b", .command = "doc-open", .input = Json{{"id", "b"}}},
            },
        .options = afd::BatchOptions{.stop_on_error = true},
    };
    const afd::BatchResult stopped = registry->execute_batch(stop_req, context);
    REQUIRE(stopped.results.size() == 2);
    REQUIRE(stopped.results[0].result.error.has_value());
    CHECK(stopped.results[0].result.error->code == "OUTPUT_BUDGET_EXCEEDED");
    REQUIRE(stopped.results[1].result.error.has_value());
    CHECK(stopped.results[1].result.error->code == "COMMAND_SKIPPED");
}

TEST_CASE("output budgets: pipeline checks every step and stops on a replaced one") {
    using namespace output_budget_test;
    const Json& batch_case = cases()["batch"];
    const auto registry = make_batch_registry(batch_case);

    afd::PipelineRequest request;
    request.steps = {
        {.command = "doc-search", .input = Json{{"id", "a"}}},
        {.command = "doc-open", .input = Json{{"id", "d"}}},
        {.command = "doc-open", .input = Json{{"id", "b"}}},
    };
    afd::CommandContext context;
    context.output_budget_ask = batch_case["ask"]["maxBytes"].get<std::uint64_t>();
    const afd::PipelineResult result = registry->execute_pipeline(request, context);
    REQUIRE(result.steps.size() == 3);
    CHECK(result.steps[0].status == afd::StepStatus::success);
    CHECK(result.steps[1].status == afd::StepStatus::failure);
    REQUIRE(result.steps[1].error.has_value());
    CHECK(result.steps[1].error->code == "OUTPUT_BUDGET_EXCEEDED");
    CHECK(result.steps[2].status != afd::StepStatus::success);
}

TEST_CASE("output budgets: DirectClient forwards output_budget_ask for call and pipe") {
    using namespace output_budget_test;
    std::optional<std::uint64_t> seen;
    auto registry = std::make_shared<afd::CommandRegistry>();
    register_ok(*registry,
                afd::CommandDefinition{
                    .name = "doc-search",
                    .description = "Search",
                    .handler =
                        [&](const Json&, afd::CommandContext& context) {
                            seen = context.output_budget;
                            return afd::success(Json{{"ok", true}});
                        },
                    .expose = {.agent = true},
                    .output_budget = afd::OutputBudget{.default_bytes = 64, .max_bytes = 128},
                });

    afd::DirectClient client(registry);
    afd::CommandContext asked;
    asked.output_budget_ask = 100;
    const afd::CommandResult r1 = client.call("doc-search", Json::object(), asked);
    CHECK(r1.success);
    CHECK(seen == 100);

    const afd::CommandResult r2 = client.call("doc-search");
    CHECK(r2.success);
    CHECK(seen == 64);

    // DirectClient::pipe forwards output_budget_ask to every step.
    afd::PipelineRequest pipe_req;
    pipe_req.steps = {{.command = "doc-search", .input = Json::object()}};
    const afd::PipelineResult piped = client.pipe(pipe_req, asked);
    REQUIRE(piped.steps.size() == 1);
    CHECK(piped.steps[0].status == afd::StepStatus::success);
    CHECK(seen == 100);
}

TEST_CASE("output budgets: buffered execute_stream skips B5 check (spec B7)") {
    using namespace output_budget_test;
    std::optional<std::uint64_t> seen;
    afd::CommandRegistry registry;
    register_ok(registry,
                afd::CommandDefinition{
                    .name = "doc-stream",
                    .description = "Stream results",
                    .handler =
                        [&](const Json&, afd::CommandContext& context) {
                            seen = context.output_budget;
                            return afd::success(
                                Json::array({Json{{"text", std::string(100, 'a')}},
                                             Json{{"text", std::string(100, 'b')}}}));
                        },
                    .output_budget = afd::OutputBudget{.default_bytes = 64, .max_bytes = 128},
                });

    // Non-streaming execute enforces B5 and replaces the over-budget read.
    const afd::CommandResult direct = registry.execute("doc-stream");
    REQUIRE_FALSE(direct.success);
    REQUIRE(direct.error.has_value());
    CHECK(direct.error->code == "OUTPUT_BUDGET_EXCEEDED");

    // Buffered execute_stream skips B5: emits the data chunks and complete chunk with no report.
    const std::vector<afd::StreamChunk> chunks = registry.execute_stream("doc-stream");
    CHECK(seen == 64);
    const auto collected = afd::collect_stream_data(chunks);
    REQUIRE_MESSAGE(collected.has_value(), collected.error().message);
    CHECK(collected->size() == 2);
    REQUIRE_FALSE(chunks.empty());
    REQUIRE(afd::is_complete_chunk(chunks.back()));
    const auto& complete = std::get<afd::CompleteChunk>(chunks.back());
    if (complete.metadata) {
        CHECK_FALSE(complete.metadata->extra.contains(std::string(afd::output_budget_meta_key)));
    }

    // Invalid ask still fails validation before the handler runs.
    afd::CommandContext bad;
    bad.output_budget_ask = 0;
    const std::vector<afd::StreamChunk> invalid_chunks =
        registry.execute_stream("doc-stream", Json::object(), bad);
    REQUIRE(invalid_chunks.size() == 1);
    REQUIRE(afd::is_error_chunk(invalid_chunks[0]));
    CHECK(std::get<afd::ErrorChunk>(invalid_chunks[0]).error.code == "VALIDATION_ERROR");
}

// ═══════════════════════════════════════════════════════════════════════════════
// B8: JOURNAL AND REPLAY
// ═══════════════════════════════════════════════════════════════════════════════

TEST_CASE("output budgets: journal records effective budget and replay restores it as ask") {
    using namespace output_budget_test;
    for (const Json& item : cases()["journal"]) {
        const std::string label = description_of(item);
        auto sink = std::make_shared<afd::MemoryJournalSink>();
        afd::CommandRegistry registry({.middleware = {afd::create_journal_middleware(sink)}});
        register_ok(registry, make_definition("doc-search", item["declaration"], false,
                                              [](const Json&, afd::CommandContext&) {
                                                  return afd::success(nullptr);
                                              }));

        auto context = in_process_ask_context(item);
        REQUIRE_MESSAGE(context.has_value(), label);
        const afd::CommandResult result =
            registry.execute("doc-search", Json::object(), std::move(*context));
        REQUIRE_MESSAGE(result.success, label);

        const auto entries = sink->read();
        REQUIRE(entries.has_value());
        REQUIRE(entries->size() == 1);
        const std::optional<std::uint64_t> expected =
            item["expected"].is_null()
                ? std::nullopt
                : std::optional<std::uint64_t>(item["expected"].get<std::uint64_t>());
        CHECK_MESSAGE((*entries)[0].output_budget == expected, label);

        // JSONL wire order: outputBudget after contextOmitted/contextDigest and before result.
        const std::string serialized = afd::serialize_journal(*entries);
        const auto parsed_line = afd::parse_bounded(serialized);
        REQUIRE(parsed_line.has_value());
        if (expected) {
            CHECK_MESSAGE((*parsed_line)["outputBudget"] == *expected, label);
            const auto pos_budget = serialized.find("\"outputBudget\":");
            const auto pos_result = serialized.find("\"result\":");
            REQUIRE(pos_budget != std::string::npos);
            REQUIRE(pos_result != std::string::npos);
            CHECK_MESSAGE(pos_budget < pos_result, label);
        } else {
            CHECK_MESSAGE(!parsed_line->contains("outputBudget"), label);
        }

        const auto round_tripped = afd::parse_journal(serialized);
        REQUIRE_MESSAGE(round_tripped.has_value(), round_tripped.error());
        REQUIRE(round_tripped->size() == 1);
        CHECK_MESSAGE((*round_tripped)[0].output_budget == expected, label);

        // Replay restores the recorded effective budget as the ask.
        std::optional<std::optional<std::uint64_t>> seen;
        afd::CommandRegistry fresh;
        register_ok(fresh, make_definition("doc-search", item["declaration"], false,
                                           [&seen](const Json&, afd::CommandContext& ctx) {
                                               seen = ctx.output_budget;
                                               return afd::success(nullptr);
                                           }));
        const afd::ReplayReport report = afd::replay_journal(fresh, *entries);
        REQUIRE(report.entries.size() == 1);
        CHECK_MESSAGE(report.entries[0].status == afd::ReplayStatus::same, label);
        REQUIRE(seen.has_value());
        CHECK_MESSAGE(*seen == expected, label);
    }

    // Invalid outputBudget values in journal JSON are rejected.
    const Json valid_base{{"seq", 1},
                          {"timestamp", "2026-01-01T00:00:00.000Z"},
                          {"command", "doc-search"},
                          {"input", Json::object()},
                          {"contextDigest", {{"hash", "sha256:00"}}},
                          {"result", {{"success", true}}},
                          {"durationMs", 0}};
    for (const Json& bad : {Json(nullptr), Json(0), Json(-1), Json(1.5), Json("64"),
                            Json(9007199254740992ULL), Json(true)}) {
        Json candidate = valid_base;
        candidate["outputBudget"] = bad;
        CHECK_FALSE(afd::JournalEntry::from_json(candidate).has_value());
        CHECK_FALSE(afd::is_journal_entry(candidate));
    }
}

TEST_CASE("output budgets: lowered maxBytes changes replayed result and report shows why") {
    using namespace output_budget_test;
    const afd::CommandResult body = afd::success(Json{{"text", std::string(40, 'x')}});
    const auto make_registry = [&](std::uint64_t max_bytes,
                                   std::shared_ptr<afd::MemoryJournalSink> sink = nullptr) {
        afd::CommandRegistryOptions options;
        if (sink) {
            options.middleware.push_back(
                afd::create_journal_middleware(std::move(sink), {.record_failures = true}));
        }
        auto registry = std::make_unique<afd::CommandRegistry>(std::move(options));
        register_ok(
            *registry,
            afd::CommandDefinition{
                .name = "doc-search",
                .description = "Search",
                .handler = [body](const Json&, afd::CommandContext&) { return body; },
                .output_budget = afd::OutputBudget{.default_bytes = 32, .max_bytes = max_bytes},
            });
        return registry;
    };

    auto sink = std::make_shared<afd::MemoryJournalSink>();
    const auto recorded_reg = make_registry(128, sink);
    afd::CommandContext context;
    context.output_budget_ask = 128;
    const afd::CommandResult result = recorded_reg->execute("doc-search", Json::object(), context);
    REQUIRE(result.success);
    const auto entries = sink->read();
    REQUIRE(entries.has_value());
    REQUIRE(entries->size() == 1);
    CHECK((*entries)[0].output_budget == 128);

    // Now maxBytes has been lowered to 48; the body is over 48 bytes.
    const auto lowered_reg = make_registry(48);
    const afd::ReplayReport report = afd::replay_journal(*lowered_reg, *entries);
    REQUIRE(report.entries.size() == 1);
    CHECK(report.entries[0].status == afd::ReplayStatus::different);
    REQUIRE(report.entries[0].replayed.has_value());
    REQUIRE(report.entries[0].replayed->error.has_value());
    CHECK(report.entries[0].replayed->error->code == "OUTPUT_BUDGET_EXCEEDED");
    REQUIRE(report.entries[0].replayed->error->details.has_value());
    CHECK((*report.entries[0].replayed->error->details)["limitBytes"] == 48);
}

TEST_CASE("output budgets: context digest includes outputBudget only when present") {
    using namespace output_budget_test;
    auto sink = std::make_shared<afd::MemoryJournalSink>();
    afd::CommandRegistry registry({.middleware = {afd::create_journal_middleware(sink)}});
    register_ok(
        registry,
        afd::CommandDefinition{
            .name = "doc-search",
            .description = "Search",
            .handler = [](const Json&, afd::CommandContext&) { return afd::success(nullptr); },
            .output_budget = afd::OutputBudget{.default_bytes = 64, .max_bytes = 128},
        });
    register_ok(registry, afd::CommandDefinition{
                              .name = "doc-open",
                              .description = "Open",
                              .handler = [](const Json&,
                                            afd::CommandContext&) { return afd::success(nullptr); },
                          });

    afd::CommandContext base;
    base.trace_id = "t-1";
    CHECK(registry.execute("doc-search", Json::object(), base).success);
    CHECK(registry.execute("doc-open", Json::object(), base).success);
    afd::CommandContext asked = base;
    asked.output_budget_ask = 128;
    CHECK(registry.execute("doc-search", Json::object(), asked).success);

    const auto entries = sink->read();
    REQUIRE(entries.has_value());
    REQUIRE(entries->size() == 3);
    CHECK(entries->at(0).context_digest.hash != entries->at(1).context_digest.hash);
    CHECK(entries->at(0).context_digest.hash != entries->at(2).context_digest.hash);
    CHECK(entries->at(1).context_digest.hash != entries->at(2).context_digest.hash);
}

TEST_CASE("output budgets: middleware retry cannot bypass B5 after handler mutates context") {
    using namespace output_budget_test;
    // No journal middleware here (which would otherwise restore context.output_budget itself).
    int attempts = 0;
    std::vector<std::optional<std::uint64_t>> seen_budgets;
    afd::CommandRegistry registry({
        .middleware = {[](std::string_view, const Json&, afd::CommandContext&,
                          const afd::Next& next) {
            afd::CommandResult first = next();
            if (!first.success) {
                return next();
            }
            return first;
        }},
    });
    register_ok(registry,
                afd::CommandDefinition{
                    .name = "doc-retry",
                    .description = "Retry",
                    .handler =
                        [&](const Json&, afd::CommandContext& context) {
                            ++attempts;
                            seen_budgets.push_back(context.output_budget);
                            if (attempts == 1) {
                                context.output_budget.reset();
                                return afd::failure(afd::create_error("TRANSIENT", "try again"));
                            }
                            context.output_budget = 999999;
                            return afd::success(std::string(200, 'x'));
                        },
                    .output_budget = afd::OutputBudget{.default_bytes = 64, .max_bytes = 128},
                });

    const afd::CommandResult result = registry.execute("doc-retry");
    CHECK(attempts == 2);
    REQUIRE(seen_budgets.size() == 2);
    CHECK(seen_budgets[0] == 64);
    CHECK(seen_budgets[1] == 64);
    CHECK_FALSE(result.success);
    REQUIRE(result.error.has_value());
    CHECK(result.error->code == afd::error_codes::OUTPUT_BUDGET_EXCEEDED);
    REQUIRE(result.error->details.has_value());
    CHECK((*result.error->details)["limitBytes"] == 64);
}

TEST_CASE("output budgets: deeply nested canonical numbers and invalid UTF-8 measurement") {
    using namespace output_budget_test;
    // {"data":[[...257...1...257...]],"success":true} = 8 + 257 + 1 + 257 + 16 = 539 bytes.
    // Using floating-point 1.0 verifies canonical number spelling ("1", not "1.0") past depth 256.
    Json nested(1.0);
    for (int i = 0; i < 257; ++i) {
        Json wrapper = Json::array();
        wrapper.push_back(std::move(nested));
        nested = std::move(wrapper);
    }

    afd::CommandRegistry registry;
    register_ok(
        registry,
        afd::CommandDefinition{
            .name = "doc-deep",
            .description = "Deep",
            .handler = [nested](const Json&, afd::CommandContext&) { return afd::success(nested); },
            .output_budget = afd::OutputBudget{.default_bytes = 539, .max_bytes = 600},
        });

    const afd::CommandResult fits = registry.execute("doc-deep");
    CHECK(fits.success);
    REQUIRE(fits.metadata.has_value());
    CHECK(fits.metadata->extra[std::string(afd::output_budget_meta_key)] ==
          Json{{"limitBytes", 539}, {"usedBytes", 539}});

    afd::CommandContext tighter;
    tighter.output_budget_ask = 538;
    const afd::CommandResult over = registry.execute("doc-deep", Json::object(), tighter);
    CHECK_FALSE(over.success);
    REQUIRE(over.error.has_value());
    CHECK(over.error->code == afd::error_codes::OUTPUT_BUDGET_EXCEEDED);
    REQUIRE(over.error->details.has_value());
    CHECK((*over.error->details)["actualBytes"] == 539);
    CHECK((*over.error->details)["limitBytes"] == 538);

    // Invalid UTF-8 bytes in data fall back cleanly without crashing or aborting.
    register_ok(registry,
                afd::CommandDefinition{
                    .name = "doc-raw",
                    .description = "Raw bytes",
                    .handler =
                        [](const Json&, afd::CommandContext&) {
                            return afd::success(std::string("\xFF\xFE", 2));
                        },
                    .output_budget = afd::OutputBudget{.default_bytes = 64, .max_bytes = 128},
                });
    const afd::CommandResult raw = registry.execute("doc-raw");
    CHECK(raw.success);
    REQUIRE(raw.metadata.has_value());
    CHECK(raw.metadata->extra.contains(std::string(afd::output_budget_meta_key)));
}

TEST_CASE("output budgets: DirectClient validates ask and sets context before client middleware") {
    using namespace output_budget_test;
    auto registry = std::make_shared<afd::CommandRegistry>();
    register_ok(*registry,
                afd::CommandDefinition{
                    .name = "doc-search",
                    .description = "Search",
                    .handler = [](const Json&, afd::CommandContext&) { return afd::success("ok"); },
                    .output_budget = afd::OutputBudget{.default_bytes = 64, .max_bytes = 128},
                });

    // 1. Short-circuiting client middleware cannot hide an invalid ask.
    bool short_circuit_ran = false;
    const afd::DirectClient caching(
        registry, {.middleware = {[&short_circuit_ran](std::string_view, const Json&,
                                                       afd::CommandContext&, const afd::Next&) {
                       short_circuit_ran = true;
                       return afd::success("cached");
                   }}});
    afd::CommandContext invalid_ctx;
    invalid_ctx.output_budget_ask = 0;
    const afd::CommandResult bad = caching.call("doc-search", Json::object(), invalid_ctx);
    CHECK_FALSE(short_circuit_ran);
    CHECK_FALSE(bad.success);
    REQUIRE(bad.error.has_value());
    CHECK(bad.error->code == afd::error_codes::VALIDATION_ERROR);
    const Json expected_details{{"field", "outputBudget"},
                                {"meta", std::string(afd::output_budget_meta_key)}};
    CHECK(bad.error->details == expected_details);

    // 2. Forwarding client middleware observes the computed effective budget on entry.
    std::optional<std::uint64_t> observed_in_client_mw;
    const afd::DirectClient forwarding(
        registry, {.middleware = {[&observed_in_client_mw](std::string_view, const Json&,
                                                           afd::CommandContext& context,
                                                           const afd::Next& next) {
                       observed_in_client_mw = context.output_budget;
                       return next();
                   }}});
    afd::CommandContext asked;
    asked.output_budget_ask = 500;
    const afd::CommandResult ok = forwarding.call("doc-search", Json::object(), asked);
    CHECK(ok.success);
    CHECK(observed_in_client_mw == 128);
}

TEST_CASE("output budgets: journal replay preserves buffered stream mode across JSONL round-trip") {
    using namespace output_budget_test;
    auto sink = std::make_shared<afd::MemoryJournalSink>();
    afd::CommandRegistry registry(
        {.middleware = {afd::create_journal_middleware(sink, {.record_failures = true})}});
    register_ok(registry,
                afd::CommandDefinition{
                    .name = "doc-stream",
                    .description = "Stream",
                    .handler =
                        [](const Json& input, afd::CommandContext&) {
                            const bool big = input.value("big", false);
                            return afd::success(big ? Json::array({std::string(200, 's')})
                                                    : Json::array({"ok"}));
                        },
                    .output_budget = afd::OutputBudget{.default_bytes = 64, .max_bytes = 128},
                });

    const auto big_chunks = registry.execute_stream("doc-stream", Json{{"big", true}});
    REQUIRE(big_chunks.size() == 2);
    CHECK(afd::is_complete_chunk(big_chunks.back()));

    const auto small_chunks = registry.execute_stream("doc-stream", Json{{"big", false}});
    REQUIRE(small_chunks.size() == 2);
    CHECK(afd::is_complete_chunk(small_chunks.back()));

    const auto recorded = sink->read();
    REQUIRE(recorded.has_value());
    REQUIRE(recorded->size() == 2);

    std::vector<afd::JournalEntry> round_tripped;
    for (const afd::JournalEntry& entry : *recorded) {
        CHECK(entry.output_budget == 64);
        CHECK(entry.result.success);
        const std::string line = afd::serialize_journal_entry(entry);
        const auto parsed = afd::parse_journal(line);
        REQUIRE(parsed.has_value());
        REQUIRE(parsed->size() == 1);
        round_tripped.push_back(parsed->front());
    }

    const afd::ReplayReport report = afd::replay_journal(registry, round_tripped);
    CHECK_FALSE(report.diverged);
    CHECK(report.same == 2);
    CHECK(report.different == 0);
    CHECK(report.errors == 0);
}

TEST_CASE("output budgets: customized context tools never advertise dev.afd/outputBudget") {
    using namespace output_budget_test;
    std::vector<afd::CommandDefinition> commands = afd::context_commands({{.name = "docs"}});
    REQUIRE_FALSE(commands.empty());
    for (afd::CommandDefinition& cmd : commands) {
        cmd.output_budget = afd::OutputBudget{.default_bytes = 64, .max_bytes = 128};
        const auto meta = afd::command_tool_meta(cmd);
        if (meta) {
            CHECK_FALSE(meta->contains(std::string(afd::output_budget_meta_key)));
        }
        const Json tool = afd::command_to_mcp_tool(cmd);
        if (tool.contains("_meta")) {
            CHECK_FALSE(tool["_meta"].contains(std::string(afd::output_budget_meta_key)));
        }
        const Json detail = afd::to_json(cmd);
        CHECK_FALSE(detail.contains("outputBudget"));
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MCP OVER STDIO, BOTH ERAS
// ═══════════════════════════════════════════════════════════════════════════════

#ifdef AFD_HAS_MCP_STDIO
namespace output_budget_test {

using afd::mcp::StdioServer;
using afd::mcp::StdioServerOptions;
using afd::mcp::ToolStrategy;

struct McpClient {
    bool modern = true;
    std::unique_ptr<StdioServer> server;
    int next_id = 1;

    static McpClient connect(const afd::CommandRegistry& registry, bool modern,
                             StdioServerOptions options = {}) {
        auto created = StdioServer::create(registry, std::move(options));
        REQUIRE_MESSAGE(created.has_value(), created.error());
        McpClient client{.modern = modern, .server = std::move(*created)};
        if (!modern) {
            const Json init =
                client.raw_request("initialize",
                                   {{"protocolVersion", "2025-11-25"},
                                    {"capabilities", Json::object()},
                                    {"clientInfo", {{"name", "test"}, {"version", "1.0.0"}}}},
                                   Json::object());
            REQUIRE(init.contains("result"));
        }
        return client;
    }

    Json raw_request(std::string_view method, Json params, const Json& extra_meta) {
        Json meta = extra_meta.is_object() ? extra_meta : Json::object();
        if (modern) {
            meta["io.modelcontextprotocol/protocolVersion"] = "2026-07-28";
            meta["io.modelcontextprotocol/clientCapabilities"] = Json::object();
        }
        if (!meta.empty()) {
            params["_meta"] = std::move(meta);
        }
        const Json message{
            {"jsonrpc", "2.0"}, {"id", next_id++}, {"method", method}, {"params", params}};
        const auto reply = server->handle_message(afd::wire::serialize(message));
        REQUIRE(reply.has_value());
        const auto parsed = afd::parse_bounded(*reply);
        REQUIRE_MESSAGE(parsed.has_value(), parsed.error().message);
        return *parsed;
    }

    Json call_response(std::string_view tool, Json arguments, const Json& meta = Json::object()) {
        return raw_request("tools/call", {{"name", tool}, {"arguments", std::move(arguments)}},
                           meta);
    }

    Json call(std::string_view tool, Json arguments, const Json& meta = Json::object()) {
        const Json response = call_response(tool, std::move(arguments), meta);
        REQUIRE_MESSAGE(response.contains("result"), afd::wire::serialize(response));
        const Json& res = response["result"];
        REQUIRE(res.contains("content"));
        REQUIRE(res["content"].is_array());
        REQUIRE_FALSE(res["content"].empty());
        const auto text_parsed = afd::parse_bounded(res["content"][0]["text"].get<std::string>());
        REQUIRE_MESSAGE(text_parsed.has_value(), text_parsed.error().message);
        CHECK(res["structuredContent"] == *text_parsed);
        return *text_parsed;
    }

    Json tools(const Json& meta = Json::object()) {
        const Json response = raw_request("tools/list", Json::object(), meta);
        REQUIRE(response.contains("result"));
        return response["result"]["tools"];
    }
};

Json ask_meta(const Json& item) {
    if (item.contains("ask")) {
        return Json{{std::string(afd::output_budget_meta_key), item["ask"]}};
    }
    return Json::object();
}

const Json& find_tool(const Json& tools, std::string_view name) {
    for (const Json& tool : tools) {
        if (tool.contains("name") && tool["name"].is_string() &&
            tool["name"].get_ref<const std::string&>() == name) {
            return tool;
        }
    }
    FAIL("tool not found: " << name);
    return tools[0];
}

std::shared_ptr<afd::CommandRegistry> make_listing_registry(bool with_contexts = false) {
    auto registry = std::make_shared<afd::CommandRegistry>();
    register_ok(
        *registry,
        make_definition("doc-search", Json{{"defaultBytes", 64}, {"maxBytes", 128}}, false,
                        [](const Json&, afd::CommandContext&) { return afd::success(nullptr); }));
    register_ok(*registry,
                make_definition("doc-open", nullptr, false, [](const Json&, afd::CommandContext&) {
                    return afd::success(nullptr);
                }));
    if (with_contexts) {
        const auto ctx_err = afd::register_context_commands(
            *registry, std::vector<afd::ContextConfig>{{.name = "docs"}});
        REQUIRE_MESSAGE(!ctx_err, ctx_err.value_or(""));
    }
    const auto boot_err = afd::register_bootstrap_commands(*registry);
    REQUIRE_MESSAGE(!boot_err, boot_err.value_or(""));
    return registry;
}

} // namespace output_budget_test

TEST_CASE("output budgets (MCP stdio): every ask case in both eras") {
    using namespace output_budget_test;
    const Json expected_invalid_details{{"field", "outputBudget"},
                                        {"meta", "dev.afd/outputBudget"}};
    for (const bool modern : {true, false}) {
        for (const Json& item : cases()["asks"]) {
            const std::string label = (modern ? "modern: " : "legacy: ") + description_of(item);
            std::optional<std::optional<std::uint64_t>> seen;
            afd::CommandRegistry registry;
            register_ok(registry,
                        make_definition("doc-search", item["declaration"], false,
                                        [&seen](const Json&, afd::CommandContext& context) {
                                            seen = context.output_budget;
                                            return afd::success(nullptr);
                                        }));
            auto client =
                McpClient::connect(registry, modern, {.tool_strategy = ToolStrategy::individual});
            const Json result = client.call("doc-search", Json::object(), ask_meta(item));
            if (item["effective"] == "VALIDATION_ERROR") {
                CHECK_MESSAGE(result["success"] == false, label);
                CHECK_MESSAGE(result["error"]["code"] == "VALIDATION_ERROR", label);
                CHECK_MESSAGE(result["error"]["details"] == expected_invalid_details, label);
                REQUIRE_MESSAGE(result["error"]["suggestion"].is_string(), label);
                CHECK_MESSAGE(result["error"]["suggestion"].get<std::string>().find(
                                  "{ \"maxBytes\": <positive integer> }") != std::string::npos,
                              label);
                CHECK_MESSAGE(!seen.has_value(), label << ": handler ran");
            } else {
                REQUIRE_MESSAGE(seen.has_value(), label);
                CHECK_MESSAGE(*seen == expected_effective(item), label);
            }
        }
    }
}

TEST_CASE("output budgets (MCP stdio): every check case in both eras") {
    using namespace output_budget_test;
    for (const bool modern : {true, false}) {
        for (const Json& item : cases()["checks"]) {
            const std::string label = (modern ? "modern: " : "legacy: ") + description_of(item);
            const afd::CommandResult fixed = parse_result(item["result"]);
            afd::CommandRegistry registry;
            register_ok(
                registry,
                make_definition("doc-search", item["declaration"], item["mutation"] == true,
                                [fixed](const Json&, afd::CommandContext&) { return fixed; }));
            auto client =
                McpClient::connect(registry, modern, {.tool_strategy = ToolStrategy::individual});
            const Json response =
                client.call_response("doc-search", Json::object(), ask_meta(item));
            REQUIRE(response.contains("result"));
            const Json& res = response["result"];
            const Json result = res["structuredContent"];
            const auto text_parsed =
                afd::parse_bounded(res["content"][0]["text"].get<std::string>());
            REQUIRE(text_parsed.has_value());
            CHECK_MESSAGE(*text_parsed == result, label);
            CHECK_MESSAGE(res["isError"] == (result["success"] == false), label);
            assert_same_result(result, item["expected"], label);
        }
    }
}

TEST_CASE("output budgets (MCP stdio): afd-batch, afd-pipe, afd-call, grouped and meta conflicts") {
    using namespace output_budget_test;
    const Json& batch_case = cases()["batch"];
    const Json expected_conflict_details{{"meta", std::string(afd::output_budget_meta_key)}};
    Json batch_items = Json::array();
    for (const Json& item : batch_case["items"]) {
        batch_items.push_back(Json{
            {"id", item["id"]}, {"command", item["command"]}, {"input", {{"id", item["id"]}}}});
    }

    for (const bool modern : {true, false}) {
        const auto registry = make_batch_registry(batch_case);
        auto client = McpClient::connect(*registry, modern);

        // afd-batch via _meta and via arguments.meta.
        for (const bool by_argument : {false, true}) {
            Json args{{"commands", batch_items}};
            Json meta = Json::object();
            if (by_argument) {
                args["meta"] = Json{{std::string(afd::output_budget_meta_key), batch_case["ask"]}};
            } else {
                meta = Json{{std::string(afd::output_budget_meta_key), batch_case["ask"]}};
            }
            const Json result = client.call("afd-batch", args, meta);
            REQUIRE(result["results"].size() == batch_case["items"].size());
            for (std::size_t i = 0; i < batch_case["items"].size(); ++i) {
                assert_same_result(result["results"][i]["result"],
                                   batch_case["items"][i]["expected"],
                                   batch_case["items"][i]["id"].get<std::string>());
            }
        }

        // afd-pipe via _meta and via arguments.meta.
        for (const bool by_argument : {false, true}) {
            Json args{
                {"steps", Json::array({Json{{"command", "doc-search"}, {"input", {{"id", "a"}}}},
                                       Json{{"command", "doc-open"}, {"input", {{"id", "d"}}}},
                                       Json{{"command", "doc-open"}, {"input", {{"id", "b"}}}}})}};
            Json meta = Json::object();
            if (by_argument) {
                args["meta"] = Json{{std::string(afd::output_budget_meta_key), batch_case["ask"]}};
            } else {
                meta = Json{{std::string(afd::output_budget_meta_key), batch_case["ask"]}};
            }
            const Json piped = client.call("afd-pipe", args, meta);
            REQUIRE(piped["steps"].size() == 3);
            CHECK(piped["steps"][0]["status"] == "success");
            CHECK(piped["steps"][1]["status"] == "failure");
            CHECK(piped["steps"][1]["error"]["code"] == "OUTPUT_BUDGET_EXCEEDED");
            CHECK(piped["steps"][2]["status"] != "success");
        }

        // afd-call and grouped tool use the routed command's budget.
        const Json routed_meta{{std::string(afd::output_budget_meta_key), batch_case["ask"]}};
        for (const auto& [tool, args] : std::vector<std::pair<std::string, Json>>{
                 {"afd-call", Json{{"command", "doc-open"}, {"input", {{"id", "d"}}}}},
                 {"doc", Json{{"action", "open"}, {"params", {{"id", "d"}}}}},
             }) {
            const Json res = client.call(tool, args, routed_meta);
            CHECK(res["success"] == false);
            CHECK(res["error"]["code"] == "OUTPUT_BUDGET_EXCEEDED");
            CHECK(res["error"]["details"]["limitBytes"] == 96);
            CHECK(res["error"]["details"]["maxBytes"] == 200);
        }

        // Conflict between _meta and meta argument -> VALIDATION_ERROR with details.meta.
        for (const auto& [tool, args] : std::vector<std::pair<std::string, Json>>{
                 {"afd-call",
                  Json{
                      {"command", "doc-open"},
                      {"input", {{"id", "b"}}},
                      {"meta", {{std::string(afd::output_budget_meta_key), {{"maxBytes", 100}}}}}}},
                 {"afd-batch",
                  Json{
                      {"commands",
                       Json::array({Json{{"command", "doc-open"}, {"input", {{"id", "b"}}}}})},
                      {"meta", {{std::string(afd::output_budget_meta_key), {{"maxBytes", 100}}}}}}},
                 {"afd-pipe",
                  Json{
                      {"steps",
                       Json::array({Json{{"command", "doc-open"}, {"input", {{"id", "b"}}}}})},
                      {"meta", {{std::string(afd::output_budget_meta_key), {{"maxBytes", 100}}}}}}},
             }) {
            const Json conflict = client.call(
                tool, args, Json{{std::string(afd::output_budget_meta_key), {{"maxBytes", 90}}}});
            CHECK_MESSAGE(conflict["success"] == false, tool);
            CHECK_MESSAGE(conflict["error"]["code"] == "VALIDATION_ERROR", tool);
            CHECK_MESSAGE(conflict["error"]["details"] == expected_conflict_details, tool);
        }

        // Agreeing duplicate in _meta and meta argument is accepted.
        const Json agreed = client.call(
            "afd-call",
            Json{{"command", "doc-open"},
                 {"input", {{"id", "b"}}},
                 {"meta", {{std::string(afd::output_budget_meta_key), {{"maxBytes", 100}}}}}},
            Json{{std::string(afd::output_budget_meta_key), {{"maxBytes", 100}}}});
        CHECK(agreed["success"] == true);

        // Invalid ask delivered via arguments.meta fails with VALIDATION_ERROR on each meta-tool.
        const Json expected_invalid_details{{"field", "outputBudget"},
                                            {"meta", std::string(afd::output_budget_meta_key)}};
        const Json bad_meta{{std::string(afd::output_budget_meta_key), {{"maxBytes", 0}}}};
        const Json bad_call = client.call(
            "afd-call",
            Json{{"command", "doc-open"}, {"input", {{"id", "b"}}}, {"meta", bad_meta}});
        CHECK(bad_call["success"] == false);
        CHECK(bad_call["error"]["code"] == "VALIDATION_ERROR");
        CHECK(bad_call["error"]["details"] == expected_invalid_details);

        const Json bad_batch = client.call(
            "afd-batch",
            Json{{"commands",
                  Json::array({Json{{"command", "doc-open"}, {"input", {{"id", "b"}}}}})},
                 {"meta", bad_meta}});
        REQUIRE(bad_batch["results"].size() == 1);
        CHECK(bad_batch["results"][0]["result"]["success"] == false);
        CHECK(bad_batch["results"][0]["result"]["error"]["code"] == "VALIDATION_ERROR");
        CHECK(bad_batch["results"][0]["result"]["error"]["details"] == expected_invalid_details);

        const Json bad_pipe = client.call(
            "afd-pipe",
            Json{{"steps", Json::array({Json{{"command", "doc-open"}, {"input", {{"id", "b"}}}}})},
                 {"meta", bad_meta}});
        REQUIRE(bad_pipe["steps"].size() == 1);
        CHECK(bad_pipe["steps"][0]["status"] == "failure");
        CHECK(bad_pipe["steps"][0]["error"]["code"] == "VALIDATION_ERROR");
        CHECK(bad_pipe["steps"][0]["error"]["details"] == expected_invalid_details);

        // An ask sent to afd-discover or afd-detail has no effect (B2).
        const Json small_ask{{std::string(afd::output_budget_meta_key), {{"maxBytes", 1}}}};
        const Json discovered = client.call("afd-discover", Json::object(), small_ask);
        CHECK(discovered["success"] == true);
        if (discovered.contains("metadata")) {
            CHECK_FALSE(discovered["metadata"].contains(std::string(afd::output_budget_meta_key)));
        }
        const Json detailed = client.call("afd-detail", Json{{"command", "doc-open"}}, small_ask);
        CHECK(detailed["success"] == true);
        if (detailed.contains("metadata")) {
            CHECK_FALSE(detailed["metadata"].contains(std::string(afd::output_budget_meta_key)));
        }
    }
}

TEST_CASE("output budgets (MCP stdio): context_hook wins over _meta in both eras") {
    using namespace output_budget_test;
    for (const bool modern : {true, false}) {
        std::optional<std::uint64_t> seen;
        afd::CommandRegistry registry;
        register_ok(registry,
                    make_definition("doc-search", Json{{"defaultBytes", 64}, {"maxBytes", 128}},
                                    false, [&seen](const Json&, afd::CommandContext& context) {
                                        seen = context.output_budget;
                                        return afd::success(nullptr);
                                    }));
        StdioServerOptions options;
        options.tool_strategy = ToolStrategy::individual;
        options.context_hook = [](afd::CommandContext& context, const afd::mcp::RequestInfo&) {
            context.output_budget_ask = 40;
        };
        auto client = McpClient::connect(registry, modern, std::move(options));
        const Json result =
            client.call("doc-search", Json::object(),
                        Json{{std::string(afd::output_budget_meta_key), {{"maxBytes", 128}}}});
        CHECK(result["success"] == true);
        CHECK(seen == 40);
    }
}

TEST_CASE("output budgets (MCP stdio): declaration surfaces, invariance and journaling") {
    using namespace output_budget_test;
    const Json expected_decl{{"defaultBytes", 64}, {"maxBytes", 128}};
    const Json ask_override{{std::string(afd::output_budget_meta_key), {{"maxBytes", 10}}}};

    // Individual strategy + invariance of tools/list and server/discover in both eras.
    for (const bool modern : {true, false}) {
        const auto registry = make_listing_registry(true);
        StdioServerOptions options;
        options.tool_strategy = ToolStrategy::individual;
        options.contexts = {{.name = "docs"}};
        auto client = McpClient::connect(*registry, modern, std::move(options));

        const Json plain = client.tools();
        const Json& search = find_tool(plain, "doc-search");
        CHECK(search["_meta"][std::string(afd::output_budget_meta_key)] == expected_decl);

        const Json& open = find_tool(plain, "doc-open");
        CHECK_FALSE(open.contains("_meta"));

        for (const char* name : {"afd-discover", "afd-detail", "afd-call", "afd-batch", "afd-pipe",
                                 "afd-context-list", "afd-context-enter", "afd-context-exit"}) {
            const Json& t = find_tool(plain, name);
            if (t.contains("_meta")) {
                CHECK_FALSE(t["_meta"].contains(std::string(afd::output_budget_meta_key)));
            }
        }

        // tools/list never varies with an ask.
        CHECK(client.tools(ask_override) == plain);

        if (modern) {
            const Json d1 = client.raw_request("server/discover", Json::object(), Json::object());
            const Json d2 = client.raw_request("server/discover", Json::object(), ask_override);
            CHECK(d1["result"] == d2["result"]);
        }
    }

    // Grouped strategy: declaration in _meta.actions entry only, never on grouped tool itself.
    {
        const auto registry = make_listing_registry();
        auto client = McpClient::connect(*registry, true, {.tool_strategy = ToolStrategy::grouped});
        const Json tools = client.tools();
        const Json& doc = find_tool(tools, "doc");
        CHECK_FALSE(doc["_meta"].contains(std::string(afd::output_budget_meta_key)));
        bool saw_search = false;
        bool saw_open = false;
        for (const Json& action : doc["_meta"]["actions"]) {
            if (action["command"] == "doc-search") {
                saw_search = true;
                CHECK(action[std::string(afd::output_budget_meta_key)] == expected_decl);
            } else if (action["command"] == "doc-open") {
                saw_open = true;
                CHECK_FALSE(action.contains(std::string(afd::output_budget_meta_key)));
            }
        }
        CHECK(saw_search);
        CHECK(saw_open);
    }

    // Hybrid strategy: first-class tool equals individual tool (H3), including outputBudget.
    {
        const auto registry = make_listing_registry();
        auto hybrid =
            McpClient::connect(*registry, false,
                               {.tool_strategy = ToolStrategy::hybrid,
                                .first_class_tools = std::vector<std::string>{"doc-search"}});
        auto individual =
            McpClient::connect(*registry, false, {.tool_strategy = ToolStrategy::individual});
        const Json hybrid_tools = hybrid.tools();
        const Json indiv_tools = individual.tools();
        CHECK(find_tool(hybrid_tools, "doc-search") == find_tool(indiv_tools, "doc-search"));
        CHECK(find_tool(hybrid_tools,
                        "doc-search")["_meta"][std::string(afd::output_budget_meta_key)] ==
              expected_decl);
    }

    // afd-discover never emits outputBudget; afd-detail emits it on every strategy; afd-help emits
    // it on format: "full" and omits it on "brief".
    {
        const auto registry = make_listing_registry();
        for (const auto strategy : {ToolStrategy::individual, ToolStrategy::lazy}) {
            auto client = McpClient::connect(*registry, true, {.tool_strategy = strategy});
            const Json discovered = client.call("afd-discover", Json::object());
            for (const Json& summary : discovered["data"]["commands"]) {
                CHECK_FALSE(summary.contains("outputBudget"));
            }
            const Json detailed = client.call(
                "afd-detail", Json{{"command", Json::array({"doc-search", "doc-open"})}});
            REQUIRE(detailed["data"].size() == 2);
            CHECK(detailed["data"][0]["outputBudget"] == expected_decl);
            CHECK_FALSE(detailed["data"][1].contains("outputBudget"));
        }

        auto client =
            McpClient::connect(*registry, true, {.tool_strategy = ToolStrategy::individual});
        const Json brief = client.call("afd-help", Json{{"format", "brief"}});
        for (const Json& cmd : brief["data"]["commands"]) {
            CHECK_FALSE(cmd.contains("outputBudget"));
        }
        const Json full = client.call("afd-help", Json{{"format", "full"}});
        bool checked_search = false;
        bool checked_open = false;
        for (const Json& cmd : full["data"]["commands"]) {
            if (cmd["name"] == "doc-search") {
                checked_search = true;
                CHECK(cmd["outputBudget"] == expected_decl);
            } else if (cmd["name"] == "doc-open") {
                checked_open = true;
                CHECK_FALSE(cmd.contains("outputBudget"));
            }
        }
        CHECK(checked_search);
        CHECK(checked_open);
    }

    // Journaling over MCP stdio records the effective budget.
    {
        auto sink = std::make_shared<afd::MemoryJournalSink>();
        afd::CommandRegistry registry(
            {.middleware = {afd::create_journal_middleware(sink, {.record_failures = true})}});
        register_ok(registry,
                    make_definition(
                        "doc-search", Json{{"defaultBytes", 64}, {"maxBytes", 128}}, false,
                        [](const Json&, afd::CommandContext&) { return afd::success(nullptr); }));
        register_ok(registry, make_definition("doc-open", nullptr, false,
                                              [](const Json&, afd::CommandContext&) {
                                                  return afd::success(nullptr);
                                              }));
        auto client =
            McpClient::connect(registry, true, {.tool_strategy = ToolStrategy::individual});
        const Json big_ask{{std::string(afd::output_budget_meta_key), {{"maxBytes", 1000}}}};
        CHECK(client.call("doc-search", Json::object(), big_ask)["success"] == true);
        CHECK(client.call("doc-open", Json::object(), big_ask)["success"] == true);
        const auto entries = sink->read();
        REQUIRE(entries.has_value());
        REQUIRE(entries->size() == 2);
        CHECK((*entries)[0].output_budget == 128);
        CHECK_FALSE((*entries)[1].output_budget.has_value());
    }

    // A customized context command registered with an output budget never advertises it on
    // tools/list (B1).
    {
        afd::CommandRegistry registry;
        for (afd::CommandDefinition& cmd : afd::context_commands({{.name = "docs"}})) {
            cmd.output_budget = afd::OutputBudget{.default_bytes = 64, .max_bytes = 128};
            register_ok(registry, std::move(cmd));
        }
        auto client =
            McpClient::connect(registry, true, {.tool_strategy = ToolStrategy::individual});
        const Json tools = client.tools();
        for (const std::string_view name :
             {"afd-context-list", "afd-context-enter", "afd-context-exit"}) {
            const Json& tool = find_tool(tools, name);
            if (tool.contains("_meta")) {
                CHECK_FALSE(tool["_meta"].contains(std::string(afd::output_budget_meta_key)));
            }
        }
    }
}
#endif // AFD_HAS_MCP_STDIO

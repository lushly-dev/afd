// Specification-authored execution-controls vectors (spec/vectors/execution-controls.json;
// spec/execution-controls.md, #1737, #2131).
//
// Runs the pre-cancelled batch, batch size/parallelism limit, and validation issue cap vectors,
// and verifies that only the #1766 single-command deadline/cancellation gaps remain in gaps.cpp.
#include "afd/afd.hpp"

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

TEST_CASE("execution-controls vectors pin normative defaults and C++ gaps") {
    const afd::Json vectors = execution_controls_vectors::load("execution-controls.json");
    const afd::Json& defaults = vectors.at("defaults");
    CHECK(defaults.at("defaultTimeoutMs").get<int>() == 30000);
    CHECK(defaults.at("maxBatchSize").get<std::size_t>() == afd::default_max_batch_size);
    CHECK(defaults.at("maxBatchParallelism").get<std::size_t>() ==
          afd::default_max_batch_parallelism);
    CHECK(defaults.at("maxValidationIssues").get<std::size_t>() ==
          afd::default_max_validation_issues);

    const afd::Json& gaps = vectors.at("gaps").at("cpp");
    CHECK(gaps.size() == 3);
    CHECK(gaps.at("deadline").get<std::string>() ==
          "https://github.com/lushly-dev/afd/issues/1766");
    CHECK(gaps.at("defaultDeadline").get<std::string>() ==
          "https://github.com/lushly-dev/afd/issues/1766");
    CHECK(gaps.at("singleCancellation").get<std::string>() ==
          "https://github.com/lushly-dev/afd/issues/1766");

    for (const auto& entry : vectors.at("cases")) {
        const std::string control = entry.at("control").get<std::string>();
        const bool executed = (control == "batchCancellation" || control == "batchLimits" ||
                               control == "validationIssueCap");
        const bool gapped = gaps.contains(control);
        CHECK_MESSAGE(executed != gapped,
                      "control '" << control << "' must be either executed or listed in gaps.cpp");
    }
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

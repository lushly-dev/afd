// Specification-authored execution-controls vectors (spec/vectors/execution-controls.json;
// spec/execution-controls.md, #1737).
//
// Runs the pre-cancelled batch vector through afd::execute_batch with a cancelled
// CancellationToken, and verifies that remaining C++ gaps stay documented in gaps.cpp (#1766,
// #2131).
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
    CHECK(defaults.at("maxBatchSize").get<int>() == 500);
    CHECK(defaults.at("maxBatchParallelism").get<int>() == 16);
    CHECK(defaults.at("maxValidationIssues").get<int>() == 100);

    const afd::Json& gaps = vectors.at("gaps").at("cpp");
    CHECK(gaps.size() == 5);
    CHECK(gaps.at("deadline").get<std::string>() ==
          "https://github.com/lushly-dev/afd/issues/1766");
    CHECK(gaps.at("defaultDeadline").get<std::string>() ==
          "https://github.com/lushly-dev/afd/issues/1766");
    CHECK(gaps.at("singleCancellation").get<std::string>() ==
          "https://github.com/lushly-dev/afd/issues/1766");
    CHECK(gaps.at("batchLimits").get<std::string>() ==
          "https://github.com/lushly-dev/afd/issues/2131");
    CHECK(gaps.at("validationIssueCap").get<std::string>() ==
          "https://github.com/lushly-dev/afd/issues/2131");

    for (const auto& entry : vectors.at("cases")) {
        const std::string control = entry.at("control").get<std::string>();
        const bool executed = (control == "batchCancellation");
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

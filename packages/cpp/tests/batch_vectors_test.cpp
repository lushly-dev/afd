// The language-neutral vectors in spec/vectors/batch-controls.json, generated from the TypeScript
// executors (spec/vectors/generate-batch-controls.mjs). Each case runs on a ManualClock through
// execute_batch or execute_pipeline, and the result is projected to the fields the vectors pin, as
// packages/core/src/batch-controls-vectors.test.ts does. See spec/vectors/README.md.
#include "afd/afd.hpp"

#include <algorithm>
#include <cstdint>
#include <fstream>
#include <iterator>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include <doctest.h>

// Helpers live in a named namespace so a unity build cannot mix them up with another test file's.
namespace batch_vectors {
namespace {

// An untilCancelled handler advances the clock in steps of this many milliseconds, and gives up
// after this many steps so a missing deadline cannot hang the test.
constexpr double cancel_step_ms = 1;
constexpr int max_cancel_steps = 100000;

afd::Json load(const char* name) {
    std::ifstream in(std::string(AFD_VECTORS_DIR) + "/" + name, std::ios::binary);
    const std::string text{std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
    auto parsed = afd::parse_bounded(text);
    REQUIRE_MESSAGE(parsed.has_value(), name);
    return *parsed;
}

bool flag(const afd::Json& spec, const char* key) {
    const auto it = spec.find(key);
    return it != spec.end() && *it == true;
}

// What the handlers saw: every call in start order, the batch index each call ran for, and the
// most handlers running at once.
struct Recorder {
    afd::Json calls = afd::Json::array();
    std::vector<std::int64_t> ran;
    int active = 0;
    int peak = 0;
};

// The index in a batch trace ID, `batch-<index>`; -1 for any other trace ID.
std::int64_t index_from_trace(const std::optional<std::string>& trace_id) {
    constexpr std::string_view prefix = "batch-";
    if (!trace_id || trace_id->size() <= prefix.size() ||
        std::string_view(*trace_id).substr(0, prefix.size()) != prefix) {
        return -1;
    }
    std::int64_t index = 0;
    for (std::size_t i = prefix.size(); i < trace_id->size(); ++i) {
        const char c = (*trace_id)[i];
        if (c < '0' || c > '9') {
            return -1;
        }
        index = index * 10 + (c - '0');
    }
    return index;
}

// An executor that runs the case's declarative handlers (spec/vectors/README.md) on `clock`.
afd::CommandExecutor executor_for(const afd::Json& handlers, afd::ManualClock& clock,
                                  Recorder& record) {
    return [&handlers, &clock, &record](std::string_view name, const afd::Json& input,
                                        afd::CommandContext& context) -> afd::CommandResult {
        const auto spec = handlers.find(std::string(name));
        if (spec == handlers.end()) {
            return afd::failure(
                afd::create_error("NO_HANDLER", "No handler for " + std::string(name)));
        }
        record.calls.push_back({{"command", std::string(name)}, {"input", input}});
        record.ran.push_back(index_from_trace(context.trace_id));
        ++record.active;
        record.peak = (std::max)(record.peak, record.active);
        bool cancelled = true;
        if (flag(*spec, "untilCancelled")) {
            int steps = 0;
            while (!context.cancellation.is_cancelled()) {
                if (++steps > max_cancel_steps) {
                    cancelled = false;
                    break;
                }
                clock.advance(cancel_step_ms);
            }
        } else if (const auto delay = spec->find("delayMs"); delay != spec->end()) {
            clock.advance(delay->get<double>());
        }
        --record.active;
        if (!cancelled) {
            return afd::failure(afd::create_error(
                "NOT_CANCELLED", "The executor never cancelled an untilCancelled handler"));
        }
        if (const auto fail = spec->find("fail"); fail != spec->end()) {
            return afd::failure(afd::create_error(fail->at("code").get<std::string>(),
                                                  fail->at("message").get<std::string>()));
        }
        return afd::success(input);
    };
}

// The element `i` of the array at `key` in `expected`, or null.
const afd::Json* element_of(const afd::Json& expected, const char* key, std::size_t i) {
    const auto list = expected.find(key);
    if (list == expected.end() || !list->is_array() || i >= list->size()) {
        return nullptr;
    }
    return &(*list)[i];
}

// The `error` member of `expected`, or null.
const afd::Json* error_of(const afd::Json* expected) {
    if (expected == nullptr || !expected->is_object()) {
        return nullptr;
    }
    const auto error = expected->find("error");
    return error == expected->end() ? nullptr : &*error;
}

// `code` and `message`, and `retryable` only where the vector pins it.
afd::Json project_error(const afd::Json& error, const afd::Json* expected) {
    afd::Json out{{"code", error.at("code")}, {"message", error.at("message")}};
    const bool pinned =
        expected != nullptr && expected->is_object() && expected->contains("retryable");
    if (pinned && error.contains("retryable")) {
        out["retryable"] = error.at("retryable");
    }
    return out;
}

afd::Json project_batch(const afd::Json& result, const std::vector<std::int64_t>& ran,
                        const afd::Json& expected) {
    if (result.at("success") != true) {
        return {{"success", false},
                {"error", project_error(result.at("error"), error_of(&expected))},
                {"results", result.at("results")}};
    }
    afd::Json results = afd::Json::array();
    const afd::Json& entries = result.at("results");
    for (std::size_t i = 0; i < entries.size(); ++i) {
        const afd::Json& entry = entries[i];
        const afd::Json& command_result = entry.at("result");
        afd::Json projected{{"id", entry.at("id")},
                            {"index", entry.at("index")},
                            {"command", entry.at("command")},
                            {"success", command_result.at("success")}};
        if (command_result.at("success") == true) {
            if (command_result.contains("data")) {
                projected["data"] = command_result.at("data");
            }
        } else {
            projected["error"] = project_error(command_result.at("error"),
                                               error_of(element_of(expected, "results", i)));
        }
        const auto index = entry.at("index").get<std::int64_t>();
        if (std::find(ran.begin(), ran.end(), index) == ran.end()) {
            projected["durationMs"] = entry.at("durationMs");
        }
        results.push_back(std::move(projected));
    }
    return {{"success", true}, {"summary", result.at("summary")}, {"results", std::move(results)}};
}

afd::Json project_pipeline(const afd::Json& result, const afd::Json& expected) {
    afd::Json out = afd::Json::object();
    if (result.contains("data")) {
        out["data"] = result.at("data");
    }
    out["completedSteps"] = result.at("metadata").at("completedSteps");
    out["totalSteps"] = result.at("metadata").at("totalSteps");
    afd::Json steps = afd::Json::array();
    const afd::Json& entries = result.at("steps");
    for (std::size_t i = 0; i < entries.size(); ++i) {
        const afd::Json& step = entries[i];
        afd::Json projected{{"index", step.at("index")}, {"command", step.at("command")}};
        if (step.contains("alias")) {
            projected["alias"] = step.at("alias");
        }
        projected["status"] = step.at("status");
        if (step.contains("data")) {
            projected["data"] = step.at("data");
        }
        if (step.contains("error")) {
            projected["error"] =
                project_error(step.at("error"), error_of(element_of(expected, "steps", i)));
        }
        steps.push_back(std::move(projected));
    }
    out["steps"] = std::move(steps);
    return out;
}

// `expected` without the members that describe the handlers rather than the result.
afd::Json outcome_of(const afd::Json& expected) {
    afd::Json outcome = expected;
    outcome.erase("calls");
    outcome.erase("peakConcurrency");
    return outcome;
}

} // namespace
} // namespace batch_vectors

TEST_CASE("batch execution matches the TypeScript vectors") {
    const afd::Json vectors = batch_vectors::load("batch-controls.json");
    REQUIRE(vectors.at("batch").size() >= 20);
    for (const auto& vector : vectors.at("batch")) {
        const std::string name = vector.at("name").get<std::string>();
        CAPTURE(name);
        const afd::Json& expected = vector.at("expected");
        auto clock = std::make_shared<afd::ManualClock>();
        batch_vectors::Recorder record;
        afd::CommandContext context;
        // Each command's trace ID is batch-<index>, which tells a result whether its command ran.
        context.trace_id = "batch";
        const auto execute = batch_vectors::executor_for(vector.at("handlers"), *clock, record);
        const afd::Json result =
            afd::execute_batch(vector.at("request"), execute, context, {.clock = clock});

        CHECK(record.calls == expected.at("calls"));
        // InlineTaskRunner runs one command at a time, so it may report less overlap than
        // TypeScript.
        if (expected.contains("peakConcurrency")) {
            CHECK(record.peak <= expected.at("peakConcurrency").get<int>());
        }
        CHECK(batch_vectors::project_batch(result, record.ran, expected) ==
              batch_vectors::outcome_of(expected));
    }
}

TEST_CASE("pipeline execution matches the TypeScript vectors") {
    const afd::Json vectors = batch_vectors::load("batch-controls.json");
    REQUIRE(vectors.at("pipeline").size() >= 20);
    for (const auto& vector : vectors.at("pipeline")) {
        const std::string name = vector.at("name").get<std::string>();
        CAPTURE(name);
        const afd::Json& expected = vector.at("expected");
        auto clock = std::make_shared<afd::ManualClock>();
        batch_vectors::Recorder record;
        const auto execute = batch_vectors::executor_for(vector.at("handlers"), *clock, record);
        const afd::Json result =
            afd::execute_pipeline(vector.at("request"), execute, {}, {.clock = clock});

        CHECK(record.calls == expected.at("calls"));
        CHECK(batch_vectors::project_pipeline(result, expected) ==
              batch_vectors::outcome_of(expected));
    }
}

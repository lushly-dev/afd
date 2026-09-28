// Language-neutral behavior vectors in spec/vectors, generated from the TypeScript implementation.
// Any difference between C++ and TypeScript on these inputs fails here.
#include "afd/afd.hpp"

#include <fstream>
#include <iterator>
#include <string>
#include <vector>

#include <doctest.h>

namespace {

afd::Json load_vectors(const char* name) {
    std::ifstream in(std::string(AFD_VECTORS_DIR) + "/" + name, std::ios::binary);
    const std::string text{std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
    auto parsed = afd::parse_bounded(text);
    REQUIRE_MESSAGE(parsed.has_value(), name);
    return *parsed;
}

afd::PipelineContext context_from(const afd::Json& spec) {
    afd::PipelineContext context;
    context.pipeline_input = spec.at("input");
    for (const auto& entry : spec.at("steps")) {
        afd::StepResult step;
        step.index = entry.at("index").get<std::int64_t>();
        if (entry.contains("alias")) {
            step.alias = entry.at("alias").get<std::string>();
        }
        step.status =
            entry.at("status") == "success" ? afd::StepStatus::success : afd::StepStatus::failure;
        if (entry.contains("data")) {
            step.data = entry.at("data");
        }
        context.steps.push_back(std::move(step));
    }
    context.previous_success = spec.at("previous").get<std::size_t>();
    return context;
}

} // namespace

TEST_CASE("pipeline references and conditions match the TypeScript vectors") {
    const afd::Json vectors = load_vectors("pipeline-variables.json");
    const afd::PipelineContext context = context_from(vectors.at("context"));

    REQUIRE(vectors.at("references").size() >= 40);
    for (const auto& vector : vectors.at("references")) {
        const std::string reference = vector.at("reference").get<std::string>();
        CAPTURE(reference);
        const auto resolved = afd::resolve_variable(reference, context);
        CHECK(resolved.has_value() == vector.at("resolved").get<bool>());
        if (resolved && vector.at("resolved").get<bool>()) {
            CHECK(*resolved == vector.at("value"));
        }
    }

    REQUIRE(vectors.at("conditions").size() >= 20);
    for (const auto& vector : vectors.at("conditions")) {
        const std::string condition = vector.at("condition").dump();
        CAPTURE(condition);
        CHECK(afd::evaluate_condition(vector.at("condition"), context) ==
              vector.at("expected").get<bool>());
    }
}

TEST_CASE("error_codes is the shared catalog in spec/vectors/error-codes.json") {
    // C++ cannot enumerate a namespace, so the constants are listed here: a missing one fails to
    // compile, and a wrong value or order fails the comparison.
    const std::vector<std::string> catalog = {
        afd::error_codes::VALIDATION_ERROR,
        afd::error_codes::INVALID_INPUT,
        afd::error_codes::MISSING_REQUIRED_FIELD,
        afd::error_codes::INVALID_FORMAT,
        afd::error_codes::NOT_FOUND,
        afd::error_codes::ALREADY_EXISTS,
        afd::error_codes::CONFLICT,
        afd::error_codes::UNAUTHORIZED,
        afd::error_codes::FORBIDDEN,
        afd::error_codes::TOKEN_EXPIRED,
        afd::error_codes::RATE_LIMITED,
        afd::error_codes::QUOTA_EXCEEDED,
        afd::error_codes::SERVICE_UNAVAILABLE,
        afd::error_codes::TIMEOUT,
        afd::error_codes::CONNECTION_ERROR,
        afd::error_codes::INTERNAL_ERROR,
        afd::error_codes::NOT_IMPLEMENTED,
        afd::error_codes::UNKNOWN_ERROR,
        afd::error_codes::COMMAND_NOT_FOUND,
        afd::error_codes::INVALID_COMMAND_ARGS,
        afd::error_codes::COMMAND_CANCELLED,
        afd::error_codes::COMMAND_EXECUTION_ERROR,
        afd::error_codes::COMMAND_NOT_EXPOSED,
        afd::error_codes::COMMAND_NOT_IN_CONTEXT,
        afd::error_codes::COMMAND_NOT_ALLOWED,
        afd::error_codes::UNKNOWN_TOOL,
        afd::error_codes::AMBIGUOUS_ACTION,
        afd::error_codes::INVALID_GROUPED_CALL,
        afd::error_codes::SESSION_REQUIRED,
        afd::error_codes::CONTEXT_NOT_FOUND,
        afd::error_codes::CONTEXT_DEPTH_EXCEEDED,
        afd::error_codes::INVALID_BATCH_REQUEST,
        afd::error_codes::BATCH_TIMEOUT,
        afd::error_codes::COMMAND_SKIPPED,
        afd::error_codes::INVALID_PIPELINE_REQUEST,
        afd::error_codes::PIPELINE_TIMEOUT,
        afd::error_codes::UNSUPPORTED_OPTION,
        afd::error_codes::STREAM_ABORTED,
        afd::error_codes::STREAM_TIMEOUT,
        afd::error_codes::STREAM_ERROR,
        afd::error_codes::STREAM_ENDED_UNEXPECTEDLY,
        afd::error_codes::COMMAND_FAILED,
    };
    const afd::Json vectors = load_vectors("error-codes.json");
    CHECK(catalog == vectors.at("codes").get<std::vector<std::string>>());
}

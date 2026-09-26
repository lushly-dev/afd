// Language-neutral behavior vectors in spec/vectors, generated from the TypeScript implementation.
// Any difference between C++ and TypeScript on these inputs fails here.
#include "afd/afd.hpp"

#include <fstream>
#include <iterator>
#include <string>

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

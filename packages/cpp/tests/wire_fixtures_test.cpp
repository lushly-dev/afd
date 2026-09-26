// Round-trips every golden wire fixture in spec/wire (see spec/wire/README.md): parse it into
// the native types, serialize those back, and require the result to equal the file, key order
// aside. The same contract is enforced for TypeScript, Python and Rust.
#include "afd/afd.hpp"

#include <algorithm>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>

#include <doctest.h>

namespace {

namespace fs = std::filesystem;

fs::path wire_dir() {
    return fs::path(AFD_WIRE_DIR);
}

std::vector<std::string> fixture_names() {
    std::vector<std::string> names;
    std::error_code error;
    for (fs::directory_iterator it(wire_dir(), error), end; !error && it != end;
         it.increment(error)) {
        if (it->path().extension() == ".json") {
            names.push_back(it->path().filename().string());
        }
    }
    std::sort(names.begin(), names.end());
    return names;
}

afd::Json load(const std::string& name) {
    std::ifstream in(wire_dir() / name, std::ios::binary);
    const std::string text{std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
    auto parsed = afd::parse_bounded(text);
    REQUIRE_MESSAGE(parsed.has_value(), name << ": " << parsed.error().message);
    return *parsed;
}

template <class T>
T parse_as(const std::string& name, const afd::Json& original) {
    auto parsed = T::from_json(original);
    REQUIRE_MESSAGE(parsed.has_value(), name << ": " << parsed.error());
    return *parsed;
}

std::vector<afd::StreamChunk> parse_chunks(const std::string& name, const afd::Json& original) {
    REQUIRE(original.is_array());
    std::vector<afd::StreamChunk> chunks;
    for (const auto& item : original) {
        auto chunk = afd::stream_chunk_from_json(item);
        REQUIRE_MESSAGE(chunk.has_value(), name << ": " << chunk.error());
        chunks.push_back(*chunk);
    }
    return chunks;
}

// Parses `name` into its native type and serializes it back.
afd::Json round_trip(const std::string& name, const afd::Json& original) {
    if (name == "result-success-minimal.json" || name == "result-success-full.json" ||
        name == "result-failure.json") {
        return parse_as<afd::CommandResult>(name, original);
    }
    if (name == "batch-result.json") {
        return parse_as<afd::BatchResult>(name, original);
    }
    if (name == "pipeline-result.json") {
        return parse_as<afd::PipelineResult>(name, original);
    }
    if (name == "stream-chunks.json") {
        afd::Json out = afd::Json::array();
        for (const auto& chunk : parse_chunks(name, original)) {
            out.push_back(chunk);
        }
        return out;
    }
    FAIL("no C++ type mapping for spec/wire/" << name << "; every language must round-trip it");
    return {};
}

} // namespace

TEST_CASE("every wire fixture round-trips") {
    const auto names = fixture_names();
    REQUIRE_MESSAGE(names.size() >= 6,
                    "expected the spec/wire fixtures in " << wire_dir().string());
    for (const auto& name : names) {
        CAPTURE(name);
        const afd::Json original = load(name);
        const afd::Json reencoded = round_trip(name, original);
        CHECK_MESSAGE(reencoded == original, name << "\nexpected: " << original.dump(2)
                                                  << "\nactual:   " << reencoded.dump(2));
    }
}

TEST_CASE("result-success-minimal carries only server metadata") {
    const auto result =
        parse_as<afd::CommandResult>("minimal", load("result-success-minimal.json"));
    CHECK(result.success);
    REQUIRE(result.data.has_value());
    CHECK(result.data->at("id") == "todo-1");
    REQUIRE(result.metadata.has_value());
    CHECK(result.metadata->trace_id == "trace-fixture");
    CHECK(result.metadata->command_version == "1.0.0");
    CHECK(result.metadata->extra.empty());
    CHECK_FALSE(result.error.has_value());
}

TEST_CASE("result-success-full keeps every optional field and extra metadata") {
    const auto result = parse_as<afd::CommandResult>("full", load("result-success-full.json"));
    CHECK(result.confidence == doctest::Approx(0.92));
    REQUIRE(result.plan.has_value());
    REQUIRE(result.plan->size() == 2);
    CHECK(result.plan->at(0).status == afd::PlanStepStatus::complete);
    CHECK(result.plan->at(1).status == afd::PlanStepStatus::failed);
    REQUIRE(result.plan->at(1).depends_on.has_value());
    CHECK(result.plan->at(1).depends_on->at(0) == "validate");
    REQUIRE(result.warnings.has_value());
    CHECK(result.warnings->at(0).severity == afd::WarningSeverity::caution);
    REQUIRE(result.metadata.has_value());
    CHECK(result.metadata->extra == afd::Json{{"region", "test"}});
    CHECK(result.undo_command == "todo-delete");
    REQUIRE(result.undo_args.has_value());
    CHECK(result.undo_args->at("id") == "todo-2");
}

TEST_CASE("result-failure carries the error and stamped metadata") {
    const auto result = parse_as<afd::CommandResult>("failure", load("result-failure.json"));
    CHECK_FALSE(result.success);
    CHECK_FALSE(result.data.has_value());
    REQUIRE(result.error.has_value());
    CHECK(result.error->code == afd::error_codes::NOT_FOUND);
    CHECK(result.error->retryable == false);
    REQUIRE(result.error->details.has_value());
    CHECK(result.error->details->at("id") == "todo-42");
}

TEST_CASE("batch-result counts and confidence") {
    const auto batch = parse_as<afd::BatchResult>("batch", load("batch-result.json"));
    CHECK(batch.success);
    REQUIRE(batch.results.size() == 2);
    CHECK(batch.results[1].id == "second");
    CHECK(batch.results[1].index == 1);
    CHECK_FALSE(batch.results[1].result.success);
    CHECK(batch.summary.total == 2);
    CHECK(batch.summary.success_count == 1);
    CHECK(batch.summary.failure_count == 1);
    CHECK(batch.summary.skipped_count == 0);
    CHECK(batch.confidence == doctest::Approx(0.75));
    CHECK(batch.timing.started_at == "2026-01-01T00:00:00.000Z");
}

TEST_CASE("pipeline-result aliases and step indexes") {
    const auto pipeline = parse_as<afd::PipelineResult>("pipeline", load("pipeline-result.json"));
    REQUIRE(pipeline.steps.size() == 2);
    CHECK(pipeline.steps[0].alias == "first");
    CHECK_FALSE(pipeline.steps[1].alias.has_value());
    CHECK(pipeline.steps[1].status == afd::StepStatus::success);
    REQUIRE(pipeline.steps[1].metadata.has_value());
    CHECK(pipeline.steps[1].metadata->confidence == doctest::Approx(0.92));
    REQUIRE(pipeline.metadata.warnings.size() == 1);
    CHECK(pipeline.metadata.warnings[0].step_index == 1);
    CHECK(pipeline.metadata.warnings[0].code == "DUPLICATE_TITLE");
    CHECK(pipeline.metadata.sources.at(0).step_index == 1);
    CHECK(pipeline.metadata.completed_steps == 2);
}

TEST_CASE("stream-chunks has one of each chunk type") {
    const auto chunks = parse_chunks("stream", load("stream-chunks.json"));
    REQUIRE(chunks.size() == 4);
    REQUIRE(std::holds_alternative<afd::ProgressChunk>(chunks[0]));
    CHECK(std::get_if<afd::ProgressChunk>(&chunks[0])->progress == doctest::Approx(0.5));
    REQUIRE(std::holds_alternative<afd::DataChunk>(chunks[1]));
    CHECK(std::get_if<afd::DataChunk>(&chunks[1])->chunk_id == "chunk-0");
    REQUIRE(std::holds_alternative<afd::CompleteChunk>(chunks[2]));
    CHECK(std::get_if<afd::CompleteChunk>(&chunks[2])->total_chunks == 1);
    REQUIRE(std::holds_alternative<afd::ErrorChunk>(chunks[3]));
    CHECK(std::get_if<afd::ErrorChunk>(&chunks[3])->error.code == afd::error_codes::STREAM_ERROR);
}

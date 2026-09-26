// Pipeline result types (packages/core/src/pipeline.ts). Requests, variable resolution and
// execution come in Phase 3.
#pragma once

#include "afd/errors.hpp"
#include "afd/expected.hpp"
#include "afd/json.hpp"
#include "afd/metadata.hpp"
#include "afd/result.hpp"

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace afd {

/// One successful step's confidence.
struct StepConfidence {
    std::int64_t step = 0;
    std::optional<std::string> alias;
    std::string command;
    double confidence = 0;
    std::optional<std::string> reasoning;
};

/// One step's reasoning.
struct StepReasoning {
    std::int64_t step_index = 0;
    std::string command;
    std::string reasoning;
};

/// A step's warning, tagged with the step.
struct PipelineWarning : Warning {
    std::int64_t step_index = 0;
    std::optional<std::string> step_alias;
};

/// A step's source, tagged with the step.
struct PipelineSource : Source {
    std::int64_t step_index = 0;
};

/// A step's alternative, tagged with the step.
struct PipelineAlternative : Alternative {
    std::int64_t step_index = 0;
};

/// Aggregated pipeline metadata. Keys beyond the named ones are kept in `extra`.
struct PipelineMetadata {
    double confidence = 0;
    std::vector<StepConfidence> confidence_breakdown;
    std::vector<StepReasoning> reasoning;
    std::vector<PipelineWarning> warnings;
    std::vector<PipelineSource> sources;
    std::vector<PipelineAlternative> alternatives;
    double execution_time_ms = 0;
    std::int64_t completed_steps = 0;
    std::int64_t total_steps = 0;
    std::optional<std::string> command_version;
    std::optional<std::string> trace_id;
    std::optional<std::string> timestamp;
    /// Any other members, as a JSON object.
    Json extra = Json::object();
};

/// A step's status. Wire values are the enumerator names.
enum class StepStatus { success, failure, skipped };

/// The trust metadata a pipeline records for one step. Keys beyond the named ones are kept in
/// `extra`.
struct StepMetadata {
    std::optional<double> confidence;
    std::optional<std::string> reasoning;
    std::optional<std::vector<Warning>> warnings;
    std::optional<std::vector<Source>> sources;
    std::optional<std::vector<Alternative>> alternatives;
    /// Any other members, as a JSON object.
    Json extra = Json::object();
};

/// One step's outcome, at its original position in the request.
struct StepResult {
    std::int64_t index = 0;
    std::optional<std::string> alias;
    std::string command;
    StepStatus status = StepStatus::skipped;
    /// `null` is a value; absence is `std::nullopt`.
    std::optional<Json> data;
    std::optional<CommandError> error;
    double execution_time_ms = 0;
    std::optional<StepMetadata> metadata;
};

/// The result of a pipeline: the last successful step's data, aggregated metadata, and every
/// step in request order.
struct PipelineResult {
    /// `null` is a value; absence is `std::nullopt`.
    std::optional<Json> data;
    PipelineMetadata metadata;
    std::vector<StepResult> steps;

    static Expected<PipelineResult> from_json(const Json& value);
};

void to_json(Json& out, const StepConfidence& confidence);
void to_json(Json& out, const StepReasoning& reasoning);
void to_json(Json& out, const PipelineWarning& warning);
void to_json(Json& out, const PipelineSource& source);
void to_json(Json& out, const PipelineAlternative& alternative);
void to_json(Json& out, const PipelineMetadata& metadata);
void to_json(Json& out, StepStatus status);
void to_json(Json& out, const StepMetadata& metadata);
void to_json(Json& out, const StepResult& step);
void to_json(Json& out, const PipelineResult& result);

} // namespace afd

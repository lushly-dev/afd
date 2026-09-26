// Pipelines: requests, variable references (spec/pipeline-variables.md), conditions, execution
// and results (packages/core/src/pipeline.ts, pipeline-variables.ts, pipeline-executor.ts).
#pragma once

#include "afd/errors.hpp"
#include "afd/execution.hpp"
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

/// Nesting deeper than this, in the request input or a step input, is rejected before any step
/// runs. The outermost object or array is level 1.
inline constexpr std::size_t max_pipeline_nesting_depth = 64;

/// Strings longer than this (in UTF-16 code units) are literals, never references.
inline constexpr std::size_t max_reference_length = 1024;

/// One pipeline step.
struct PipelineStep {
    std::string command;
    /// A JSON object whose string values may be references (`$prev.id`, `$steps.user.name`, …).
    std::optional<Json> input;
    /// An alias for `$steps.<alias>`.
    std::optional<std::string> as;
    /// Runs the step only when this condition holds, for example `{"$exists": "$prev.id"}`.
    std::optional<Json> when;
    /// Rejected with UNSUPPORTED_OPTION when true: streaming steps are not supported.
    std::optional<bool> stream;
};

struct PipelineOptions {
    /// Keep going after a failed step. A timeout always stops the pipeline.
    std::optional<bool> continue_on_failure;
    /// One deadline for the whole pipeline, in milliseconds.
    std::optional<double> timeout_ms;
    /// Rejected with UNSUPPORTED_OPTION when true.
    std::optional<bool> parallel;
};

struct PipelineRequest {
    std::optional<std::string> id;
    std::vector<PipelineStep> steps;
    std::optional<PipelineOptions> options;
    /// What `$input` refers to. Never the host's context.
    std::optional<Json> input;
};

void to_json(Json& out, const PipelineStep& step);
void to_json(Json& out, const PipelineOptions& options);
void to_json(Json& out, const PipelineRequest& request);

/// Checks a pipeline envelope as TypeScript's `isPipelineRequest` does: non-blank step commands,
/// object inputs, string aliases, valid `when` conditions, correctly typed options. Rejects with
/// INVALID_PIPELINE_REQUEST.
Expected<PipelineRequest, CommandError> parse_pipeline_request(const Json& request);

/// What references resolve against while a pipeline runs.
struct PipelineContext {
    /// The request's `input`, if any.
    std::optional<Json> pipeline_input;
    /// Every step so far, at its original position.
    std::vector<StepResult> steps;
    /// The index in `steps` of the most recent successful step, if any.
    std::optional<std::size_t> previous_success;
};

/// Resolves every reference in `input` (spec/pipeline-variables.md). Unresolved references are
/// omitted from objects and become `null` in arrays; `$$` escapes a literal `$`. Fails for input
/// nested deeper than `max_pipeline_nesting_depth`. A bare unresolved reference resolves to null.
Expected<Json> resolve_variables(const Json& input, const PipelineContext& context);

/// Resolves one reference string; `std::nullopt` when it is a reference that does not resolve. A
/// string that is not a reference comes back unchanged.
std::optional<Json> resolve_variable(std::string_view reference, const PipelineContext& context);

/// Evaluates a `when` condition. Comparisons with an unresolved operand are false, `$exists` is
/// false for `null`, and `$eq`/`$ne` compare JSON structurally.
bool evaluate_condition(const Json& condition, const PipelineContext& context);

/// Executes a pipeline with TypeScript's semantics:
///
/// - The envelope, then nesting depth, then `parallel`/`stream` are checked before any step runs.
/// - Steps run in order. A false `when` skips the step. Inputs are resolved against earlier steps.
/// - A failure stops the pipeline unless `continueOnFailure`; a timeout always stops it.
/// - `timeoutMs` is one deadline for the pipeline. A step not started by then, or finishing
///   after it, gets PIPELINE_TIMEOUT. Steps see the deadline on `context.cancellation`.
/// - Each step gets the trace ID `context.trace_id`, or `<request id or
/// pipeline-<ms>-<random>>-step-<i>`.
/// - `data` is the last successful step's data; metadata aggregates every successful step.
PipelineResult execute_pipeline(const PipelineRequest& request, const CommandExecutor& execute,
                                const CommandContext& context = {},
                                const ExecutorOptions& options = {});

/// `execute_pipeline` on a raw JSON envelope, validated first with `parse_pipeline_request`.
PipelineResult execute_pipeline(const Json& request, const CommandExecutor& execute,
                                const CommandContext& context = {},
                                const ExecutorOptions& options = {});

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

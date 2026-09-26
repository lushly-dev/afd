#include "afd/pipeline.hpp"

#include "detail/json_io.hpp"

namespace afd {
namespace detail {

bool read_value(const Json& value, const std::string& path, StepConfidence& out,
                std::string& error) {
    ObjectReader reader(value, path, error);
    reader.required("step", out.step);
    reader.optional("alias", out.alias);
    reader.required("command", out.command);
    reader.required("confidence", out.confidence);
    reader.optional("reasoning", out.reasoning);
    return reader.ok();
}

bool read_value(const Json& value, const std::string& path, StepReasoning& out,
                std::string& error) {
    ObjectReader reader(value, path, error);
    reader.required("stepIndex", out.step_index);
    reader.required("command", out.command);
    reader.required("reasoning", out.reasoning);
    return reader.ok();
}

bool read_value(const Json& value, const std::string& path, PipelineWarning& out,
                std::string& error) {
    if (!read_value(value, path, static_cast<Warning&>(out), error)) {
        return false;
    }
    ObjectReader reader(value, path, error);
    reader.required("stepIndex", out.step_index);
    reader.optional("stepAlias", out.step_alias);
    return reader.ok();
}

bool read_value(const Json& value, const std::string& path, PipelineSource& out,
                std::string& error) {
    if (!read_value(value, path, static_cast<Source&>(out), error)) {
        return false;
    }
    ObjectReader reader(value, path, error);
    reader.required("stepIndex", out.step_index);
    return reader.ok();
}

bool read_value(const Json& value, const std::string& path, PipelineAlternative& out,
                std::string& error) {
    if (!read_value(value, path, static_cast<Alternative&>(out), error)) {
        return false;
    }
    ObjectReader reader(value, path, error);
    reader.required("stepIndex", out.step_index);
    return reader.ok();
}

bool read_value(const Json& value, const std::string& path, PipelineMetadata& out,
                std::string& error) {
    ObjectReader reader(value, path, error);
    reader.required("confidence", out.confidence);
    reader.required("confidenceBreakdown", out.confidence_breakdown);
    reader.required("reasoning", out.reasoning);
    reader.required("warnings", out.warnings);
    reader.required("sources", out.sources);
    reader.required("alternatives", out.alternatives);
    reader.required("executionTimeMs", out.execution_time_ms);
    reader.required("completedSteps", out.completed_steps);
    reader.required("totalSteps", out.total_steps);
    reader.optional("commandVersion", out.command_version);
    reader.optional("traceId", out.trace_id);
    reader.optional("timestamp", out.timestamp);
    out.extra =
        reader.unknown_members({"confidence", "confidenceBreakdown", "reasoning", "warnings",
                                "sources", "alternatives", "executionTimeMs", "completedSteps",
                                "totalSteps", "commandVersion", "traceId", "timestamp"});
    return reader.ok();
}

bool read_value(const Json& value, const std::string& path, StepStatus& out, std::string& error) {
    std::string text;
    if (!read_value(value, path, text, error)) {
        return false;
    }
    if (text == "success") {
        out = StepStatus::success;
    } else if (text == "failure") {
        out = StepStatus::failure;
    } else if (text == "skipped") {
        out = StepStatus::skipped;
    } else {
        record(error, path, "unknown value '" + text + "'");
        return false;
    }
    return true;
}

bool read_value(const Json& value, const std::string& path, StepMetadata& out, std::string& error) {
    ObjectReader reader(value, path, error);
    reader.optional("confidence", out.confidence);
    reader.optional("reasoning", out.reasoning);
    reader.optional("warnings", out.warnings);
    reader.optional("sources", out.sources);
    reader.optional("alternatives", out.alternatives);
    out.extra =
        reader.unknown_members({"confidence", "reasoning", "warnings", "sources", "alternatives"});
    return reader.ok();
}

bool read_value(const Json& value, const std::string& path, StepResult& out, std::string& error) {
    ObjectReader reader(value, path, error);
    reader.required("index", out.index);
    reader.optional("alias", out.alias);
    reader.required("command", out.command);
    reader.required("status", out.status);
    reader.read_present("data", out.data);
    reader.optional("error", out.error);
    reader.required("executionTimeMs", out.execution_time_ms);
    reader.optional("metadata", out.metadata);
    return reader.ok();
}

bool read_value(const Json& value, const std::string& path, PipelineResult& out,
                std::string& error) {
    ObjectReader reader(value, path, error);
    reader.read_present("data", out.data);
    reader.required("metadata", out.metadata);
    reader.required("steps", out.steps);
    return reader.ok();
}

} // namespace detail

Expected<PipelineResult> PipelineResult::from_json(const Json& value) {
    return detail::parse_document<PipelineResult>(value);
}

void to_json(Json& out, const StepConfidence& confidence) {
    out = Json::object();
    out["step"] = confidence.step;
    detail::put(out, "alias", confidence.alias);
    out["command"] = confidence.command;
    out["confidence"] = wire::number(confidence.confidence);
    detail::put(out, "reasoning", confidence.reasoning);
}

void to_json(Json& out, const StepReasoning& reasoning) {
    out = Json{{"stepIndex", reasoning.step_index},
               {"command", reasoning.command},
               {"reasoning", reasoning.reasoning}};
}

void to_json(Json& out, const PipelineWarning& warning) {
    to_json(out, static_cast<const Warning&>(warning));
    out["stepIndex"] = warning.step_index;
    detail::put(out, "stepAlias", warning.step_alias);
}

void to_json(Json& out, const PipelineSource& source) {
    to_json(out, static_cast<const Source&>(source));
    out["stepIndex"] = source.step_index;
}

void to_json(Json& out, const PipelineAlternative& alternative) {
    to_json(out, static_cast<const Alternative&>(alternative));
    out["stepIndex"] = alternative.step_index;
}

void to_json(Json& out, const PipelineMetadata& metadata) {
    out = Json::object();
    out["confidence"] = wire::number(metadata.confidence);
    out["confidenceBreakdown"] = metadata.confidence_breakdown;
    out["reasoning"] = metadata.reasoning;
    out["warnings"] = metadata.warnings;
    out["sources"] = metadata.sources;
    out["alternatives"] = metadata.alternatives;
    out["executionTimeMs"] = wire::number(metadata.execution_time_ms);
    out["completedSteps"] = metadata.completed_steps;
    out["totalSteps"] = metadata.total_steps;
    detail::put(out, "commandVersion", metadata.command_version);
    detail::put(out, "traceId", metadata.trace_id);
    detail::put(out, "timestamp", metadata.timestamp);
    detail::merge_extra(out, metadata.extra);
}

void to_json(Json& out, StepStatus status) {
    switch (status) {
    case StepStatus::success:
        out = "success";
        return;
    case StepStatus::failure:
        out = "failure";
        return;
    case StepStatus::skipped:
        out = "skipped";
        return;
    }
    out = "skipped";
}

void to_json(Json& out, const StepMetadata& metadata) {
    out = Json::object();
    detail::put(out, "confidence", metadata.confidence);
    detail::put(out, "reasoning", metadata.reasoning);
    detail::put(out, "warnings", metadata.warnings);
    detail::put(out, "sources", metadata.sources);
    detail::put(out, "alternatives", metadata.alternatives);
    detail::merge_extra(out, metadata.extra);
}

void to_json(Json& out, const StepResult& step) {
    out = Json::object();
    out["index"] = step.index;
    detail::put(out, "alias", step.alias);
    out["command"] = step.command;
    out["status"] = step.status;
    detail::put(out, "data", step.data);
    detail::put(out, "error", step.error);
    out["executionTimeMs"] = wire::number(step.execution_time_ms);
    detail::put(out, "metadata", step.metadata);
}

void to_json(Json& out, const PipelineResult& result) {
    out = Json::object();
    detail::put(out, "data", result.data);
    out["metadata"] = result.metadata;
    out["steps"] = result.steps;
}

} // namespace afd

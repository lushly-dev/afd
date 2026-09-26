// Trust metadata that results carry: sources, plan steps, alternatives and warnings
// (packages/core/src/metadata.ts).
#pragma once

#include "afd/expected.hpp"
#include "afd/json.hpp"

#include <optional>
#include <string>
#include <vector>

namespace afd {

/// Where information came from. `type` is free-form: document, url, file, database, api, …
struct Source {
    std::string type;
    std::optional<std::string> id;
    std::optional<std::string> title;
    std::optional<std::string> url;
    std::optional<std::string> location;
    std::optional<std::string> accessed_at;
    std::optional<double> relevance;

    static Expected<Source> from_json(const Json& value);
};

/// The status of one plan step. Wire values are the enumerator names.
enum class PlanStepStatus { pending, in_progress, complete, failed, skipped };

/// A plan step's error: code and message only.
struct PlanStepError {
    std::string code;
    std::string message;
};

/// One step of a multi-step operation.
struct PlanStep {
    std::string id;
    std::string action;
    PlanStepStatus status = PlanStepStatus::pending;
    std::optional<std::string> description;
    std::optional<std::vector<std::string>> depends_on;
    /// The step's result. `null` is a value; absence is `std::nullopt`.
    std::optional<Json> result;
    std::optional<PlanStepError> error;
    std::optional<double> progress;
    std::optional<double> estimated_time_remaining_ms;

    static Expected<PlanStep> from_json(const Json& value);
};

/// Another result the command considered.
struct Alternative {
    Json data;
    std::string reason;
    std::optional<double> confidence;
    std::optional<std::string> label;

    static Expected<Alternative> from_json(const Json& value);
};

/// Warning severity. Wire values are the enumerator names.
enum class WarningSeverity { info, warning, caution };

/// A non-fatal issue in an otherwise successful result.
struct Warning {
    std::string code;
    std::string message;
    std::optional<WarningSeverity> severity;
    /// A JSON object.
    std::optional<Json> details;

    static Expected<Warning> from_json(const Json& value);
};

void to_json(Json& out, const Source& source);
void to_json(Json& out, PlanStepStatus status);
void to_json(Json& out, const PlanStepError& error);
void to_json(Json& out, const PlanStep& step);
void to_json(Json& out, const Alternative& alternative);
void to_json(Json& out, WarningSeverity severity);
void to_json(Json& out, const Warning& warning);

} // namespace afd

#include "afd/metadata.hpp"

#include <array>
#include <string_view>
#include <utility>

#include "detail/json_io.hpp"

namespace afd {
namespace {

constexpr std::array<std::pair<PlanStepStatus, std::string_view>, 5> plan_step_statuses{{
    {PlanStepStatus::pending, "pending"},
    {PlanStepStatus::in_progress, "in_progress"},
    {PlanStepStatus::complete, "complete"},
    {PlanStepStatus::failed, "failed"},
    {PlanStepStatus::skipped, "skipped"},
}};

constexpr std::array<std::pair<WarningSeverity, std::string_view>, 3> warning_severities{{
    {WarningSeverity::info, "info"},
    {WarningSeverity::warning, "warning"},
    {WarningSeverity::caution, "caution"},
}};

template <class Enum, std::size_t N>
bool read_enum(const Json& value, const std::string& path,
               const std::array<std::pair<Enum, std::string_view>, N>& names, Enum& out,
               std::string& error) {
    std::string text;
    if (!detail::read_value(value, path, text, error)) {
        return false;
    }
    for (const auto& [enumerator, name] : names) {
        if (text == name) {
            out = enumerator;
            return true;
        }
    }
    detail::record(error, path, "unknown value '" + text + "'");
    return false;
}

template <class Enum, std::size_t N>
std::string_view enum_name(Enum value,
                           const std::array<std::pair<Enum, std::string_view>, N>& names) {
    for (const auto& [enumerator, name] : names) {
        if (enumerator == value) {
            return name;
        }
    }
    return names[0].second;
}

} // namespace

namespace detail {

bool read_value(const Json& value, const std::string& path, Source& out, std::string& error) {
    ObjectReader reader(value, path, error);
    reader.required("type", out.type);
    reader.optional("id", out.id);
    reader.optional("title", out.title);
    reader.optional("url", out.url);
    reader.optional("location", out.location);
    reader.optional("accessedAt", out.accessed_at);
    reader.optional("relevance", out.relevance);
    return reader.ok();
}

bool read_value(const Json& value, const std::string& path, PlanStepStatus& out,
                std::string& error) {
    return read_enum(value, path, plan_step_statuses, out, error);
}

bool read_value(const Json& value, const std::string& path, PlanStepError& out,
                std::string& error) {
    ObjectReader reader(value, path, error);
    reader.required("code", out.code);
    reader.required("message", out.message);
    return reader.ok();
}

bool read_value(const Json& value, const std::string& path, PlanStep& out, std::string& error) {
    ObjectReader reader(value, path, error);
    reader.required("id", out.id);
    reader.required("action", out.action);
    reader.required("status", out.status);
    reader.optional("description", out.description);
    reader.optional("dependsOn", out.depends_on);
    reader.read_present("result", out.result);
    reader.optional("error", out.error);
    reader.optional("progress", out.progress);
    reader.optional("estimatedTimeRemainingMs", out.estimated_time_remaining_ms);
    return reader.ok();
}

bool read_value(const Json& value, const std::string& path, Alternative& out, std::string& error) {
    ObjectReader reader(value, path, error);
    std::optional<Json> data;
    reader.read_present("data", data);
    if (reader.ok() && !data) {
        record(error, child_path(path, "data"), "is required");
    }
    out.data = data.value_or(Json());
    reader.required("reason", out.reason);
    reader.optional("confidence", out.confidence);
    reader.optional("label", out.label);
    return reader.ok();
}

bool read_value(const Json& value, const std::string& path, WarningSeverity& out,
                std::string& error) {
    return read_enum(value, path, warning_severities, out, error);
}

bool read_value(const Json& value, const std::string& path, Warning& out, std::string& error) {
    ObjectReader reader(value, path, error);
    reader.required("code", out.code);
    reader.required("message", out.message);
    reader.optional("severity", out.severity);
    reader.optional_object("details", out.details);
    return reader.ok();
}

} // namespace detail

Expected<Source> Source::from_json(const Json& value) {
    return detail::parse_document<Source>(value);
}
Expected<PlanStep> PlanStep::from_json(const Json& value) {
    return detail::parse_document<PlanStep>(value);
}
Expected<Alternative> Alternative::from_json(const Json& value) {
    return detail::parse_document<Alternative>(value);
}
Expected<Warning> Warning::from_json(const Json& value) {
    return detail::parse_document<Warning>(value);
}

void to_json(Json& out, const Source& source) {
    out = Json::object();
    out["type"] = source.type;
    detail::put(out, "id", source.id);
    detail::put(out, "title", source.title);
    detail::put(out, "url", source.url);
    detail::put(out, "location", source.location);
    detail::put(out, "accessedAt", source.accessed_at);
    detail::put(out, "relevance", source.relevance);
}

void to_json(Json& out, PlanStepStatus status) {
    out = enum_name(status, plan_step_statuses);
}

void to_json(Json& out, const PlanStepError& error) {
    out = Json{{"code", error.code}, {"message", error.message}};
}

void to_json(Json& out, const PlanStep& step) {
    out = Json::object();
    out["id"] = step.id;
    out["action"] = step.action;
    out["status"] = step.status;
    detail::put(out, "description", step.description);
    detail::put(out, "dependsOn", step.depends_on);
    detail::put(out, "result", step.result);
    detail::put(out, "error", step.error);
    detail::put(out, "progress", step.progress);
    detail::put(out, "estimatedTimeRemainingMs", step.estimated_time_remaining_ms);
}

void to_json(Json& out, const Alternative& alternative) {
    out = Json::object();
    out["data"] = alternative.data;
    out["reason"] = alternative.reason;
    detail::put(out, "confidence", alternative.confidence);
    detail::put(out, "label", alternative.label);
}

void to_json(Json& out, WarningSeverity severity) {
    out = enum_name(severity, warning_severities);
}

void to_json(Json& out, const Warning& warning) {
    out = Json::object();
    out["code"] = warning.code;
    out["message"] = warning.message;
    detail::put(out, "severity", warning.severity);
    detail::put(out, "details", warning.details);
}

} // namespace afd

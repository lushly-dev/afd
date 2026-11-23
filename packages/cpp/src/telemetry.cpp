#include "afd/telemetry.hpp"

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <utility>

#include "detail/iso8601.hpp"
#include "detail/json_io.hpp"

namespace afd {
namespace {

void write_telemetry_stderr(std::string_view line) {
    std::fprintf(stderr, "%.*s\n", static_cast<int>(line.size()), line.data());
}

} // namespace

void to_json(Json& out, const TelemetryEvent& event) {
    out = Json::object();
    out["commandName"] = event.command_name;
    out["startedAt"] = event.started_at;
    out["completedAt"] = event.completed_at;
    out["durationMs"] = wire::number(event.duration_ms);
    out["success"] = event.success;
    if (event.error) {
        out["error"] = *event.error;
    }
    if (event.trace_id) {
        out["traceId"] = *event.trace_id;
    }
    if (event.confidence) {
        out["confidence"] = wire::number(*event.confidence);
    }
    if (event.metadata) {
        out["metadata"] = *event.metadata;
    }
    if (event.input) {
        out["input"] = *event.input;
    }
    if (event.command_version) {
        out["commandVersion"] = *event.command_version;
    }
    if (event.actor_kind) {
        out["actorKind"] = *event.actor_kind;
    }
}

Expected<TelemetryEvent> TelemetryEvent::from_json(const Json& value) {
    std::string error;
    detail::ObjectReader reader(value, std::string(), error);
    TelemetryEvent out;
    reader.required("commandName", out.command_name);
    reader.required("startedAt", out.started_at);
    reader.required("completedAt", out.completed_at);
    reader.required("durationMs", out.duration_ms);
    reader.required("success", out.success);
    reader.optional("error", out.error);
    reader.optional("traceId", out.trace_id);
    reader.optional("confidence", out.confidence);
    reader.optional_object("metadata", out.metadata);
    reader.read_present("input", out.input);
    reader.optional("commandVersion", out.command_version);
    reader.optional("actorKind", out.actor_kind);
    if (!reader.ok()) {
        return unexpected(error.empty() ? std::string("(root): invalid value") : error);
    }
    return out;
}

TelemetryEvent create_telemetry_event(std::string command_name, std::string started_at,
                                      std::string completed_at, bool success,
                                      TelemetryEventOptions options) {
    double duration_ms = 0;
    if (options.duration_ms) {
        duration_ms = *options.duration_ms;
    } else {
        const auto start = detail::parse_iso8601_ms(started_at);
        const auto end = detail::parse_iso8601_ms(completed_at);
        if (start && end) {
            duration_ms = static_cast<double>(*end - *start);
        }
    }
    return TelemetryEvent{
        .command_name = std::move(command_name),
        .started_at = std::move(started_at),
        .completed_at = std::move(completed_at),
        .duration_ms = duration_ms,
        .success = success,
        .error = std::move(options.error),
        .trace_id = std::move(options.trace_id),
        .confidence = options.confidence,
        .metadata = std::move(options.metadata),
        .input = std::move(options.input),
        .command_version = std::move(options.command_version),
        .actor_kind = options.actor_kind,
    };
}

bool is_telemetry_event(const Json& value) noexcept {
    if (!value.is_object()) {
        return false;
    }
    const auto name = value.find("commandName");
    const auto started = value.find("startedAt");
    const auto completed = value.find("completedAt");
    const auto duration = value.find("durationMs");
    const auto ok = value.find("success");
    if (name == value.end() || started == value.end() || completed == value.end() ||
        duration == value.end() || ok == value.end()) {
        return false;
    }
    if (!name->is_string() || !started->is_string() || !completed->is_string() ||
        !duration->is_number() || !ok->is_boolean()) {
        return false;
    }
    return std::isfinite(duration->get<double>());
}

ConsoleTelemetrySink::ConsoleTelemetrySink(ConsoleTelemetrySinkOptions options)
    : log_(options.log ? std::move(options.log)
                       : std::function<void(std::string_view)>(write_telemetry_stderr)),
      json_(options.json), prefix_(std::move(options.prefix)) {}

void ConsoleTelemetrySink::record(const TelemetryEvent& event) {
    if (json_) {
        Json payload = event;
        payload["_prefix"] = prefix_;
        log_(wire::serialize(payload));
        return;
    }
    const std::string status = event.success ? "SUCCESS" : "FAILURE";
    const std::string trace_info =
        event.trace_id && !event.trace_id->empty() ? " [" + *event.trace_id + "]" : "";
    const std::string confidence_info =
        event.confidence ? " (confidence: " + detail::format_number(*event.confidence) + ")" : "";
    const std::string error_info =
        event.error ? " - " + event.error->code + ": " + event.error->message : "";
    log_(prefix_ + trace_info + " " + event.command_name + " " + status + " in " +
         detail::format_number(event.duration_ms) + "ms" + confidence_info + error_info);
}

} // namespace afd

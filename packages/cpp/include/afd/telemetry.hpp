// Telemetry event shapes and sinks for command execution tracking
// (packages/core/src/telemetry.ts, packages/server/src/middleware.ts).
#pragma once

#include "afd/actor.hpp"
#include "afd/errors.hpp"
#include "afd/expected.hpp"
#include "afd/json.hpp"

#include <functional>
#include <optional>
#include <string>
#include <string_view>

namespace afd {

/// A single command execution recorded by telemetry middleware. Wire keys are camelCase and unset
/// fields are omitted.
struct TelemetryEvent {
    /// Name of the command that was executed.
    std::string command_name;
    /// ISO 8601 UTC timestamp when command execution started.
    std::string started_at;
    /// ISO 8601 UTC timestamp when command execution completed.
    std::string completed_at;
    /// Duration of execution in milliseconds.
    double duration_ms = 0;
    /// Whether the command executed successfully.
    bool success = false;
    /// Error details if the command failed.
    std::optional<CommandError> error;
    /// Trace ID for correlating related events.
    std::optional<std::string> trace_id;
    /// Confidence score from the result (0-1), if provided.
    std::optional<double> confidence;
    /// Additional metadata from the command result (a JSON object).
    std::optional<Json> metadata;
    /// Input provided to the command (optional; may be omitted for privacy).
    std::optional<Json> input;
    /// Command version that was executed.
    std::optional<std::string> command_version;
    /// Kind of principal that called the command (`context.actor.kind`), never its id.
    std::optional<ActorKind> actor_kind;

    /// Reads a TelemetryEvent from JSON without throwing.
    static Expected<TelemetryEvent> from_json(const Json& value);
};

void to_json(Json& out, const TelemetryEvent& event);

/// Optional fields for `create_telemetry_event`.
struct TelemetryEventOptions {
    /// Explicit duration in milliseconds. When unset, derived from `completed_at - started_at` if
    /// both are ISO 8601 UTC timestamps, otherwise 0.
    std::optional<double> duration_ms;
    std::optional<CommandError> error;
    std::optional<std::string> trace_id;
    std::optional<double> confidence;
    std::optional<Json> metadata;
    std::optional<Json> input;
    std::optional<std::string> command_version;
    std::optional<ActorKind> actor_kind;
};

/// Creates a TelemetryEvent from command execution data (TypeScript `createTelemetryEvent`).
TelemetryEvent create_telemetry_event(std::string command_name, std::string started_at,
                                      std::string completed_at, bool success,
                                      TelemetryEventOptions options = {});

/// True when `value` has the required wire fields of a TelemetryEvent (`commandName`, `startedAt`,
/// `completedAt`, finite `durationMs`, and boolean `success`).
[[nodiscard]] bool is_telemetry_event(const Json& value) noexcept;

/// Pluggable sink for recorded telemetry events.
class TelemetrySink {
public:
    virtual ~TelemetrySink() = default;
    /// Records one event. Implementations should avoid throwing; telemetry middleware ignores sink
    /// failures so command execution is unaffected.
    virtual void record(const TelemetryEvent& event) = 0;
    /// Flushes any buffered events. Default is a no-op.
    virtual void flush() {}
};

/// Options for `ConsoleTelemetrySink`.
struct ConsoleTelemetrySinkOptions {
    /// Log function to receive formatted lines. Defaults to standard error.
    std::function<void(std::string_view line)> log;
    /// Format each event as JSON instead of human-readable text. Default: false.
    bool json = false;
    /// Prefix for log messages (or `_prefix` in JSON mode). Default: "[Telemetry]".
    std::string prefix = "[Telemetry]";
};

/// Telemetry sink that writes events to a log callback (standard error by default).
class ConsoleTelemetrySink final : public TelemetrySink {
public:
    explicit ConsoleTelemetrySink(ConsoleTelemetrySinkOptions options = {});

    void record(const TelemetryEvent& event) override;
    void flush() override {}

private:
    std::function<void(std::string_view line)> log_;
    bool json_ = false;
    std::string prefix_;
};

} // namespace afd

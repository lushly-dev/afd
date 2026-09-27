// CommandResult: the contract every AFD command returns (packages/core/src/result.ts).
#pragma once

#include "afd/errors.hpp"
#include "afd/expected.hpp"
#include "afd/json.hpp"
#include "afd/metadata.hpp"

#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace afd {

/// Execution metadata. Keys other than the named ones are kept in `extra` and round-trip.
struct ResultMetadata {
    std::optional<double> execution_time_ms;
    std::optional<std::string> command_version;
    std::optional<std::string> trace_id;
    std::optional<std::string> timestamp;
    /// Any other members, as a JSON object.
    Json extra = Json::object();

    static Expected<ResultMetadata> from_json(const Json& value);
};

/// The result of executing a command. Unset optional fields are omitted on the wire, never
/// written as `null`.
struct CommandResult {
    bool success = false;
    /// The payload. `null` is a value; absence is `std::nullopt`.
    std::optional<Json> data;
    std::optional<CommandError> error;
    /// 0 to 1.
    std::optional<double> confidence;
    std::optional<std::string> reasoning;
    std::optional<std::vector<Source>> sources;
    std::optional<std::vector<PlanStep>> plan;
    std::optional<std::vector<Alternative>> alternatives;
    std::optional<std::vector<Warning>> warnings;
    std::optional<std::vector<std::string>> suggestions;
    std::optional<ResultMetadata> metadata;
    std::optional<std::string> undo_command;
    /// A JSON object.
    std::optional<Json> undo_args;

    static Expected<CommandResult> from_json(const Json& value);
};

void to_json(Json& out, const ResultMetadata& metadata);
void to_json(Json& out, const CommandResult& result);

/// The optional fields `success` and `failure` accept: everything but success, data and error.
struct ResultOptions {
    std::optional<double> confidence;
    std::optional<std::string> reasoning;
    std::optional<std::vector<Source>> sources;
    std::optional<std::vector<PlanStep>> plan;
    std::optional<std::vector<Alternative>> alternatives;
    std::optional<std::vector<Warning>> warnings;
    std::optional<std::vector<std::string>> suggestions;
    std::optional<ResultMetadata> metadata;
    std::optional<std::string> undo_command;
    std::optional<Json> undo_args;
};

/// `{success: true, data, ...options}`.
CommandResult success(Json data, ResultOptions options = {});

/// `{success: false, error, ...options}`.
CommandResult failure(CommandError error, ResultOptions options = {});

/// A failure built from a code and message.
CommandResult error(std::string code, std::string message, ErrorOptions options = {});

/// Whether `result.success` is true.
bool is_success(const CommandResult& result) noexcept;

/// Whether `result.success` is false.
bool is_failure(const CommandResult& result) noexcept;

/// COMMAND_EXECUTION_ERROR for an exception escaping a handler. Outside `dev_mode` the result
/// carries no exception text or stack.
CommandResult execution_failure(std::string_view message, bool dev_mode = false,
                                std::optional<std::string> stack = std::nullopt);

} // namespace afd

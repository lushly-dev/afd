// CommandError, the standard error codes, and error constructors (packages/core/src/errors.ts).
#pragma once

#include "afd/expected.hpp"
#include "afd/json.hpp"

#include <array>
#include <exception>
#include <memory>
#include <optional>
#include <string>
#include <string_view>

namespace afd {

/// A command failure with recovery guidance for the caller. Wire keys are camelCase.
struct CommandError {
    /// Machine-readable code, usually one of `error_codes`.
    std::string code;
    /// Human-readable description of what went wrong.
    std::string message;
    /// What the caller can do about it. AFD errors should always include one.
    std::optional<std::string> suggestion;
    /// Whether retrying the same call may succeed.
    std::optional<bool> retryable;
    /// Structured context: a JSON object.
    std::optional<Json> details;
    /// The error that caused this one.
    std::shared_ptr<const CommandError> cause;

    /// Reads a CommandError from JSON without throwing.
    static Expected<CommandError> from_json(const Json& value);
};

void to_json(Json& out, const CommandError& error);

/// An error code: usually one of `error_codes`, or an application's own.
using ErrorCode = std::string;

/// Optional fields for `create_error` and `error`.
struct ErrorOptions {
    std::optional<std::string> suggestion;
    std::optional<bool> retryable;
    std::optional<Json> details;
};

/// The shared error-code catalog in spec/error-codes.md (TypeScript `ErrorCodes`).
namespace error_codes {
// Validation
inline constexpr char VALIDATION_ERROR[] = "VALIDATION_ERROR";
inline constexpr char INVALID_INPUT[] = "INVALID_INPUT";
inline constexpr char MISSING_REQUIRED_FIELD[] = "MISSING_REQUIRED_FIELD";
inline constexpr char INVALID_FORMAT[] = "INVALID_FORMAT";
// Resources
inline constexpr char NOT_FOUND[] = "NOT_FOUND";
inline constexpr char ALREADY_EXISTS[] = "ALREADY_EXISTS";
inline constexpr char CONFLICT[] = "CONFLICT";
// Authorization
inline constexpr char UNAUTHORIZED[] = "UNAUTHORIZED";
inline constexpr char FORBIDDEN[] = "FORBIDDEN";
inline constexpr char TOKEN_EXPIRED[] = "TOKEN_EXPIRED";
// Rate limiting
inline constexpr char RATE_LIMITED[] = "RATE_LIMITED";
inline constexpr char QUOTA_EXCEEDED[] = "QUOTA_EXCEEDED";
// Network and service
inline constexpr char SERVICE_UNAVAILABLE[] = "SERVICE_UNAVAILABLE";
inline constexpr char TIMEOUT[] = "TIMEOUT";
inline constexpr char CONNECTION_ERROR[] = "CONNECTION_ERROR";
// Internal
inline constexpr char INTERNAL_ERROR[] = "INTERNAL_ERROR";
inline constexpr char NOT_IMPLEMENTED[] = "NOT_IMPLEMENTED";
inline constexpr char UNKNOWN_ERROR[] = "UNKNOWN_ERROR";
// Commands
inline constexpr char COMMAND_NOT_FOUND[] = "COMMAND_NOT_FOUND";
inline constexpr char INVALID_COMMAND_ARGS[] = "INVALID_COMMAND_ARGS";
inline constexpr char COMMAND_CANCELLED[] = "COMMAND_CANCELLED";
inline constexpr char COMMAND_EXECUTION_ERROR[] = "COMMAND_EXECUTION_ERROR";
// Routing and access
inline constexpr char COMMAND_NOT_IN_CONTEXT[] = "COMMAND_NOT_IN_CONTEXT";
inline constexpr char COMMAND_NOT_EXPOSED[] = "COMMAND_NOT_EXPOSED";
inline constexpr char COMMAND_NOT_ALLOWED[] = "COMMAND_NOT_ALLOWED";
inline constexpr char UNKNOWN_TOOL[] = "UNKNOWN_TOOL";
inline constexpr char AMBIGUOUS_ACTION[] = "AMBIGUOUS_ACTION";
inline constexpr char INVALID_GROUPED_CALL[] = "INVALID_GROUPED_CALL";
// Contexts
inline constexpr char SESSION_REQUIRED[] = "SESSION_REQUIRED";
inline constexpr char CONTEXT_NOT_FOUND[] = "CONTEXT_NOT_FOUND";
inline constexpr char CONTEXT_DEPTH_EXCEEDED[] = "CONTEXT_DEPTH_EXCEEDED";
// Batch and pipeline
inline constexpr char INVALID_BATCH_REQUEST[] = "INVALID_BATCH_REQUEST";
inline constexpr char INVALID_PIPELINE_REQUEST[] = "INVALID_PIPELINE_REQUEST";
inline constexpr char BATCH_TIMEOUT[] = "BATCH_TIMEOUT";
inline constexpr char COMMAND_SKIPPED[] = "COMMAND_SKIPPED";
inline constexpr char PIPELINE_TIMEOUT[] = "PIPELINE_TIMEOUT";
inline constexpr char UNSUPPORTED_OPTION[] = "UNSUPPORTED_OPTION";
// Streaming
inline constexpr char STREAM_ABORTED[] = "STREAM_ABORTED";
inline constexpr char STREAM_TIMEOUT[] = "STREAM_TIMEOUT";
inline constexpr char STREAM_ERROR[] = "STREAM_ERROR";
inline constexpr char STREAM_ENDED_UNEXPECTEDLY[] = "STREAM_ENDED_UNEXPECTEDLY";
inline constexpr char COMMAND_FAILED[] = "COMMAND_FAILED";
// Confirmations
inline constexpr char CONFIRMATION_REQUIRED[] = "CONFIRMATION_REQUIRED";
inline constexpr char CONFIRMATION_DECLINED[] = "CONFIRMATION_DECLINED";
// Approvals
inline constexpr char APPROVAL_REQUIRED[] = "APPROVAL_REQUIRED";
inline constexpr char APPROVAL_UNAVAILABLE[] = "APPROVAL_UNAVAILABLE";
// Output budgets
inline constexpr char OUTPUT_BUDGET_EXCEEDED[] = "OUTPUT_BUDGET_EXCEEDED";
// Authorization
inline constexpr char INSUFFICIENT_SCOPE[] = "INSUFFICIENT_SCOPE";
// Tasks
inline constexpr char TASK_TOKEN_EXPIRED[] = "TASK_TOKEN_EXPIRED";
// App calls: not emitted by C++ yet (#1513); the shared catalog lists it
inline constexpr char CALL_NOT_GRANTED[] = "CALL_NOT_GRANTED";
} // namespace error_codes

/// Reserved prefix for host-defined error codes (`spec/error-codes.md`).
inline constexpr char host_error_code_prefix[] = "HOST_";

/// Metadata for one entry in the shared error-code catalog (`spec/vectors/error-codes.json`).
/// `retryable` is `true`, `false`, or `std::nullopt` when retryability varies by emitting site.
struct ErrorCodeInfo {
    std::string_view code;
    std::optional<bool> retryable;
    std::string_view profile;
};

/// The shared error-code catalog with retryability and contract profile, in catalog order.
inline constexpr std::array<ErrorCodeInfo, 50> error_code_catalog = {{
    {error_codes::VALIDATION_ERROR, false, "core"},
    {error_codes::INVALID_INPUT, false, "core"},
    {error_codes::MISSING_REQUIRED_FIELD, false, "core"},
    {error_codes::INVALID_FORMAT, false, "core"},
    {error_codes::NOT_FOUND, false, "core"},
    {error_codes::ALREADY_EXISTS, false, "core"},
    {error_codes::CONFLICT, false, "core"},
    {error_codes::UNAUTHORIZED, false, "core"},
    {error_codes::FORBIDDEN, false, "core"},
    {error_codes::TOKEN_EXPIRED, false, "core"},
    {error_codes::RATE_LIMITED, true, "core"},
    {error_codes::QUOTA_EXCEEDED, false, "core"},
    {error_codes::SERVICE_UNAVAILABLE, true, "core"},
    {error_codes::TIMEOUT, true, "core"},
    {error_codes::CONNECTION_ERROR, true, "core"},
    {error_codes::INTERNAL_ERROR, std::nullopt, "core"},
    {error_codes::NOT_IMPLEMENTED, false, "core"},
    {error_codes::UNKNOWN_ERROR, true, "core"},
    {error_codes::COMMAND_NOT_FOUND, false, "core"},
    {error_codes::INVALID_COMMAND_ARGS, false, "core"},
    {error_codes::COMMAND_CANCELLED, false, "core"},
    {error_codes::COMMAND_EXECUTION_ERROR, false, "core"},
    {error_codes::COMMAND_NOT_EXPOSED, false, "core"},
    {error_codes::COMMAND_NOT_IN_CONTEXT, false, "contexts"},
    {error_codes::COMMAND_NOT_ALLOWED, false, "core"},
    {error_codes::UNKNOWN_TOOL, false, "core"},
    {error_codes::AMBIGUOUS_ACTION, false, "core"},
    {error_codes::INVALID_GROUPED_CALL, false, "core"},
    {error_codes::SESSION_REQUIRED, false, "contexts"},
    {error_codes::CONTEXT_NOT_FOUND, false, "contexts"},
    {error_codes::CONTEXT_DEPTH_EXCEEDED, false, "contexts"},
    {error_codes::INVALID_BATCH_REQUEST, false, "core"},
    {error_codes::BATCH_TIMEOUT, true, "core"},
    {error_codes::COMMAND_SKIPPED, false, "core"},
    {error_codes::INVALID_PIPELINE_REQUEST, false, "core"},
    {error_codes::PIPELINE_TIMEOUT, true, "core"},
    {error_codes::UNSUPPORTED_OPTION, false, "core"},
    {error_codes::STREAM_ABORTED, true, "streaming"},
    {error_codes::STREAM_TIMEOUT, true, "streaming"},
    {error_codes::STREAM_ERROR, std::nullopt, "streaming"},
    {error_codes::STREAM_ENDED_UNEXPECTEDLY, true, "streaming"},
    {error_codes::COMMAND_FAILED, false, "streaming"},
    {error_codes::CONFIRMATION_REQUIRED, false, "confirmations"},
    {error_codes::CONFIRMATION_DECLINED, false, "confirmations"},
    {error_codes::APPROVAL_REQUIRED, false, "approvals"},
    {error_codes::APPROVAL_UNAVAILABLE, false, "approvals"},
    {error_codes::OUTPUT_BUDGET_EXCEEDED, false, "output-budgets"},
    {error_codes::INSUFFICIENT_SCOPE, false, "authorization"},
    {error_codes::TASK_TOKEN_EXPIRED, std::nullopt, "tasks"},
    {error_codes::CALL_NOT_GRANTED, false, "app-calls"},
}};

/// `{code, message}` plus any of `options`.
CommandError create_error(std::string code, std::string message, ErrorOptions options = {});

/// VALIDATION_ERROR with the suggestion "Check the input and try again".
CommandError validation_error(std::string message, std::optional<Json> details = std::nullopt);

/// NOT_FOUND: "<Type> with ID '<id>' not found".
CommandError not_found_error(std::string_view resource_type, std::string_view resource_id);

/// RATE_LIMITED, retryable, suggesting how long to wait when known.
CommandError rate_limit_error(std::optional<double> retry_after_seconds = std::nullopt);

/// TIMEOUT: "Operation '<name>' timed out after <ms>ms", retryable.
CommandError timeout_error(std::string_view operation_name, double timeout_ms);

/// INTERNAL_ERROR, retryable, with the default "try again" suggestion.
CommandError internal_error(std::string message);

/// Returns a CommandError unchanged.
CommandError wrap_error(const CommandError& error);
/// An exception as INTERNAL_ERROR with its `what()` message.
CommandError wrap_error(const std::exception& error);
/// Any other failure as UNKNOWN_ERROR with `message`.
CommandError wrap_error(std::string_view message);

/// Whether `value` has the shape of a CommandError: an object with string `code` and `message`.
bool is_command_error(const Json& value);

} // namespace afd

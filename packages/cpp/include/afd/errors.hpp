// CommandError, the standard error codes, and error constructors (packages/core/src/errors.ts).
#pragma once

#include "afd/expected.hpp"
#include "afd/json.hpp"

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
} // namespace error_codes

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

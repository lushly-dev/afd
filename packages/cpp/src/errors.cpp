#include "afd/errors.hpp"

#include <cmath>

#include "detail/json_io.hpp"

namespace afd {
namespace {

// The suggestion TypeScript's internalError and wrapError use.
constexpr char default_suggestion[] = "Please try again. If this persists, contact support.";

// A cause chain comes from untrusted input; bound the recursion that reads it.
constexpr int max_cause_depth = 32;

bool read_error(const Json& value, const std::string& path, CommandError& out, std::string& error,
                int depth) {
    detail::ObjectReader reader(value, path, error);
    reader.required("code", out.code);
    reader.required("message", out.message);
    reader.optional("suggestion", out.suggestion);
    reader.optional("retryable", out.retryable);
    reader.optional_object("details", out.details);
    out.cause.reset();
    if (const auto it = value.find("cause"); reader.ok() && it != value.end() && !it->is_null()) {
        const std::string cause_path = detail::child_path(path, "cause");
        if (depth >= max_cause_depth) {
            detail::record(error, cause_path, "cause chain is too deep");
            return false;
        }
        CommandError cause;
        if (!read_error(*it, cause_path, cause, error, depth + 1)) {
            return false;
        }
        out.cause = std::make_shared<const CommandError>(std::move(cause));
    }
    return reader.ok();
}

std::string ascii_lowercase(std::string_view text) {
    std::string lowered(text);
    for (char& c : lowered) {
        if (c >= 'A' && c <= 'Z') {
            c = static_cast<char>(c - 'A' + 'a');
        }
    }
    return lowered;
}

} // namespace

namespace detail {
bool read_value(const Json& value, const std::string& path, CommandError& out, std::string& error) {
    return read_error(value, path, out, error, 0);
}
} // namespace detail

Expected<CommandError> CommandError::from_json(const Json& value) {
    return detail::parse_document<CommandError>(value);
}

void to_json(Json& out, const CommandError& error) {
    out = Json::object();
    out["code"] = error.code;
    out["message"] = error.message;
    detail::put(out, "suggestion", error.suggestion);
    detail::put(out, "retryable", error.retryable);
    detail::put(out, "details", error.details);
    if (error.cause) {
        out["cause"] = *error.cause;
    }
}

CommandError create_error(std::string code, std::string message, ErrorOptions options) {
    CommandError error;
    error.code = std::move(code);
    error.message = std::move(message);
    error.suggestion = std::move(options.suggestion);
    error.retryable = options.retryable;
    error.details = std::move(options.details);
    return error;
}

CommandError validation_error(std::string message, std::optional<Json> details) {
    return create_error(error_codes::VALIDATION_ERROR, std::move(message),
                        {.suggestion = "Check the input and try again",
                         .retryable = false,
                         .details = std::move(details)});
}

CommandError not_found_error(std::string_view resource_type, std::string_view resource_id) {
    std::string message =
        std::string(resource_type) + " with ID '" + std::string(resource_id) + "' not found";
    std::string suggestion =
        "Verify the " + ascii_lowercase(resource_type) + " ID exists and try again";
    return create_error(
        error_codes::NOT_FOUND, std::move(message),
        {.suggestion = std::move(suggestion),
         .retryable = false,
         .details = Json{{"resourceType", resource_type}, {"resourceId", resource_id}}});
}

CommandError rate_limit_error(std::optional<double> retry_after_seconds) {
    // TypeScript tests truthiness: 0 and NaN count as "unknown".
    const bool known =
        retry_after_seconds && *retry_after_seconds != 0 && !std::isnan(*retry_after_seconds);
    ErrorOptions options;
    options.retryable = true;
    if (known) {
        options.suggestion =
            "Wait " + detail::format_number(*retry_after_seconds) + " seconds and try again";
        options.details = Json{{"retryAfterSeconds", wire::number(*retry_after_seconds)}};
    } else {
        options.suggestion = "Wait a moment and try again";
    }
    return create_error(error_codes::RATE_LIMITED, "Rate limit exceeded", std::move(options));
}

CommandError timeout_error(std::string_view operation_name, double timeout_ms) {
    std::string message = "Operation '" + std::string(operation_name) + "' timed out after " +
                          detail::format_number(timeout_ms) + "ms";
    return create_error(
        error_codes::TIMEOUT, std::move(message),
        {.suggestion = "Try again with a simpler request or contact support if this persists",
         .retryable = true,
         .details =
             Json{{"operationName", operation_name}, {"timeoutMs", wire::number(timeout_ms)}}});
}

CommandError internal_error(std::string message) {
    return create_error(error_codes::INTERNAL_ERROR, std::move(message),
                        {.suggestion = default_suggestion, .retryable = true});
}

CommandError wrap_error(const CommandError& error) {
    return error;
}

CommandError wrap_error(const std::exception& error) {
    return create_error(error_codes::INTERNAL_ERROR, error.what(),
                        {.suggestion = default_suggestion, .retryable = true});
}

CommandError wrap_error(std::string_view message) {
    return create_error(error_codes::UNKNOWN_ERROR, std::string(message),
                        {.suggestion = default_suggestion, .retryable = true});
}

bool is_command_error(const Json& value) {
    if (!value.is_object()) {
        return false;
    }
    const auto code = value.find("code");
    const auto message = value.find("message");
    return code != value.end() && code->is_string() && message != value.end() &&
           message->is_string();
}

} // namespace afd

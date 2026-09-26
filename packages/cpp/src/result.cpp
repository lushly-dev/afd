#include "afd/result.hpp"

#include "detail/json_io.hpp"

namespace afd {
namespace {

void apply(CommandResult& result, ResultOptions&& options) {
    result.confidence = options.confidence;
    result.reasoning = std::move(options.reasoning);
    result.sources = std::move(options.sources);
    result.plan = std::move(options.plan);
    result.alternatives = std::move(options.alternatives);
    result.warnings = std::move(options.warnings);
    result.suggestions = std::move(options.suggestions);
    result.metadata = std::move(options.metadata);
    result.undo_command = std::move(options.undo_command);
    result.undo_args = std::move(options.undo_args);
}

} // namespace

namespace detail {

bool read_value(const Json& value, const std::string& path, ResultMetadata& out,
                std::string& error) {
    ObjectReader reader(value, path, error);
    reader.optional("executionTimeMs", out.execution_time_ms);
    reader.optional("commandVersion", out.command_version);
    reader.optional("traceId", out.trace_id);
    reader.optional("timestamp", out.timestamp);
    out.extra =
        reader.unknown_members({"executionTimeMs", "commandVersion", "traceId", "timestamp"});
    return reader.ok();
}

bool read_value(const Json& value, const std::string& path, CommandResult& out,
                std::string& error) {
    ObjectReader reader(value, path, error);
    reader.required("success", out.success);
    reader.read_present("data", out.data);
    reader.optional("error", out.error);
    reader.optional("confidence", out.confidence);
    reader.optional("reasoning", out.reasoning);
    reader.optional("sources", out.sources);
    reader.optional("plan", out.plan);
    reader.optional("alternatives", out.alternatives);
    reader.optional("warnings", out.warnings);
    reader.optional("suggestions", out.suggestions);
    reader.optional("metadata", out.metadata);
    reader.optional("undoCommand", out.undo_command);
    reader.optional_object("undoArgs", out.undo_args);
    return reader.ok();
}

} // namespace detail

Expected<ResultMetadata> ResultMetadata::from_json(const Json& value) {
    return detail::parse_document<ResultMetadata>(value);
}

Expected<CommandResult> CommandResult::from_json(const Json& value) {
    return detail::parse_document<CommandResult>(value);
}

void to_json(Json& out, const ResultMetadata& metadata) {
    out = Json::object();
    detail::put(out, "executionTimeMs", metadata.execution_time_ms);
    detail::put(out, "commandVersion", metadata.command_version);
    detail::put(out, "traceId", metadata.trace_id);
    detail::put(out, "timestamp", metadata.timestamp);
    detail::merge_extra(out, metadata.extra);
}

void to_json(Json& out, const CommandResult& result) {
    out = Json::object();
    out["success"] = result.success;
    detail::put(out, "data", result.data);
    detail::put(out, "error", result.error);
    detail::put(out, "confidence", result.confidence);
    detail::put(out, "reasoning", result.reasoning);
    detail::put(out, "sources", result.sources);
    detail::put(out, "plan", result.plan);
    detail::put(out, "alternatives", result.alternatives);
    detail::put(out, "warnings", result.warnings);
    detail::put(out, "suggestions", result.suggestions);
    detail::put(out, "metadata", result.metadata);
    detail::put(out, "undoCommand", result.undo_command);
    detail::put(out, "undoArgs", result.undo_args);
}

CommandResult success(Json data, ResultOptions options) {
    CommandResult result;
    result.success = true;
    result.data = std::move(data);
    apply(result, std::move(options));
    return result;
}

CommandResult failure(CommandError error, ResultOptions options) {
    CommandResult result;
    result.success = false;
    result.error = std::move(error);
    apply(result, std::move(options));
    return result;
}

CommandResult error(std::string code, std::string message, ErrorOptions options) {
    return failure(create_error(std::move(code), std::move(message), std::move(options)));
}

bool is_success(const CommandResult& result) noexcept {
    return result.success;
}

bool is_failure(const CommandResult& result) noexcept {
    return !result.success;
}

CommandResult execution_failure(std::string_view message, bool dev_mode,
                                std::optional<std::string> stack) {
    if (!dev_mode) {
        return failure(create_error(error_codes::COMMAND_EXECUTION_ERROR,
                                    "An internal error occurred",
                                    {.suggestion = "Contact support if this persists"}));
    }
    ErrorOptions options{.suggestion = "Check the command implementation"};
    if (stack) {
        options.details = Json{{"stack", *stack}};
    }
    return failure(create_error(error_codes::COMMAND_EXECUTION_ERROR, std::string(message),
                                std::move(options)));
}

} // namespace afd

#include "afd/errors.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <set>

#include "detail/json_io.hpp"

namespace afd {
namespace {

// The suggestion TypeScript's internalError and wrapError use.
constexpr char default_suggestion[] = "Please try again. If this persists, contact support.";

// `rate_limit_error`'s `afterMs`: the wait in whole milliseconds, rounded up so the caller waits at
// least as long as the suggestion says. A wait that is negative, infinite or beyond 2^53 - 1 ms has
// no `afterMs` a recovery can carry, so the recovery is a plain retry.
std::optional<std::int64_t> rate_limit_after_ms(double seconds) {
    const double ms = std::ceil(seconds * 1000.0);
    if (!std::isfinite(ms) || ms < 0 || ms > detail::max_safe_integer_double) {
        return std::nullopt;
    }
    return static_cast<std::int64_t>(ms);
}

// A cause chain comes from untrusted input; bound the recursion that reads it.
constexpr int max_cause_depth = 32;

bool belongs_to_call(RecoveryKind kind) noexcept {
    return kind == RecoveryKind::call;
}

bool takes_input(RecoveryKind kind) noexcept {
    return kind == RecoveryKind::call || kind == RecoveryKind::fix_input;
}

// The members `$defs/recovery` defines. Any other member breaks its `additionalProperties: false`.
constexpr std::array<std::string_view, 6> recovery_members = {"kind",  "command",   "input",
                                                              "needs", "thenRetry", "afterMs"};

// An integer as JSON Schema reads one: an integer, or a number whose fraction part is zero
// (`30000.0`). Only values that fit an int64_t are read.
bool read_integer(const Json& value, std::int64_t& out) {
    if (const auto* integer = value.get_ptr<const Json::number_integer_t*>()) {
        out = *integer;
        return true;
    }
    if (const auto* natural = value.get_ptr<const Json::number_unsigned_t*>()) {
        if (*natural >
            static_cast<Json::number_unsigned_t>((std::numeric_limits<std::int64_t>::max)())) {
            return false;
        }
        out = static_cast<std::int64_t>(*natural);
        return true;
    }
    if (const auto* real = value.get_ptr<const Json::number_float_t*>()) {
        // -2^63 is exact as a double; 2^63 is the first double past int64_t's range.
        constexpr double lowest = -9223372036854775808.0;
        if (!std::isfinite(*real) || std::trunc(*real) != *real || *real < lowest ||
            *real >= -lowest) {
            return false;
        }
        out = static_cast<std::int64_t>(*real);
        return true;
    }
    return false;
}

// Reads one member of a recovery with the JSON type `$defs/recovery` gives it. Nothing is coerced:
// `"30000"` is not an integer and `"true"` is not a boolean.
bool read_recovery_member(const std::string& key, const Json& member, Recovery& out,
                          std::string& problem) {
    if (key == "kind") {
        const auto* name = member.get_ptr<const std::string*>();
        if (name == nullptr) {
            problem = "expected a string";
            return false;
        }
        const auto parsed = parse_recovery_kind(*name);
        if (!parsed) {
            problem = "unknown value '" + *name + "'";
            return false;
        }
        out.kind = *parsed;
        return true;
    }
    if (key == "command") {
        const auto* command = member.get_ptr<const std::string*>();
        if (command == nullptr) {
            problem = "expected a string";
            return false;
        }
        out.command = *command;
        return true;
    }
    if (key == "input") {
        if (!member.is_object()) {
            problem = "expected an object";
            return false;
        }
        out.input = member;
        return true;
    }
    if (key == "needs") {
        if (!member.is_array()) {
            problem = "expected an array";
            return false;
        }
        std::vector<std::string> needs;
        needs.reserve(member.size());
        for (const Json& item : member) {
            const auto* field = item.get_ptr<const std::string*>();
            if (field == nullptr) {
                problem = "expected an array of strings";
                return false;
            }
            needs.push_back(*field);
        }
        out.needs = std::move(needs);
        return true;
    }
    if (key == "thenRetry") {
        const auto* then_retry = member.get_ptr<const Json::boolean_t*>();
        if (then_retry == nullptr) {
            problem = "expected a boolean";
            return false;
        }
        out.then_retry = *then_retry;
        return true;
    }
    if (key == "afterMs") {
        std::int64_t after_ms = 0;
        if (!read_integer(member, after_ms)) {
            problem = "expected an integer";
            return false;
        }
        out.after_ms = after_ms;
        return true;
    }
    problem = "is not a recovery member";
    return false;
}

// Reads a recovery that matches `$defs/recovery` in spec/schema/error.json, and nothing else: an
// unknown member, a `null` member or a member of the wrong JSON type fails here, and
// `Recovery::validate` then applies the rules that span fields and values.
bool read_recovery(const Json& value, const std::string& path, Recovery& out, std::string& error) {
    if (!value.is_object()) {
        detail::record(error, path, "expected an object");
        return false;
    }
    if (!value.contains("kind")) {
        detail::record(error, detail::child_path(path, "kind"), "is required");
        return false;
    }
    out = Recovery{};
    for (auto it = value.begin(); it != value.end(); ++it) {
        const std::string& key = it.key();
        const std::string member_path = detail::child_path(path, key);
        if (std::find(recovery_members.begin(), recovery_members.end(), key) ==
            recovery_members.end()) {
            detail::record(error, member_path, "is not a recovery member");
            return false;
        }
        if (it->is_null()) {
            detail::record(error, member_path, "must not be null; omit an unset field");
            return false;
        }
        std::string problem;
        if (!read_recovery_member(key, *it, out, problem)) {
            detail::record(error, member_path, problem);
            return false;
        }
    }
    if (auto problem = out.validate()) {
        detail::record(error, path, *problem);
        return false;
    }
    return true;
}

bool read_error(const Json& value, const std::string& path, CommandError& out, std::string& error,
                int depth) {
    detail::ObjectReader reader(value, path, error);
    reader.required("code", out.code);
    reader.required("message", out.message);
    reader.optional("suggestion", out.suggestion);
    reader.optional("retryable", out.retryable);
    out.recovery.reset();
    if (const auto it = value.find("recovery");
        reader.ok() && it != value.end() && !it->is_null()) {
        // Read leniently (spec/recovery.md, rule 7): a recovery that does not match
        // `$defs/recovery` is no recovery, and the error keeps its suggestion and everything else.
        std::string recovery_error;
        Recovery recovery;
        if (read_recovery(*it, detail::child_path(path, "recovery"), recovery, recovery_error)) {
            out.recovery = std::move(recovery);
        }
    }
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

std::string_view recovery_kind_name(RecoveryKind kind) noexcept {
    switch (kind) {
    case RecoveryKind::call:
        return "call";
    case RecoveryKind::fix_input:
        return "fix-input";
    case RecoveryKind::retry:
        return "retry";
    case RecoveryKind::external:
        return "external";
    case RecoveryKind::stop:
        return "stop";
    }
    return "stop";
}

std::optional<RecoveryKind> parse_recovery_kind(std::string_view name) noexcept {
    for (const RecoveryKind kind : recovery_kinds) {
        if (recovery_kind_name(kind) == name) {
            return kind;
        }
    }
    return std::nullopt;
}

std::optional<std::string> Recovery::validate() const {
    const std::string kind_name(recovery_kind_name(kind));
    if (belongs_to_call(kind)) {
        if (!command) {
            return std::string("command: a call recovery names its command");
        }
    } else if (command || then_retry) {
        return std::string(command ? "command" : "thenRetry") +
               ": belongs to a call recovery, not " + kind_name;
    }
    if (command && command->empty()) {
        return std::string("command: must not be empty");
    }
    if (after_ms) {
        if (kind != RecoveryKind::retry) {
            return "afterMs: belongs to a retry recovery, not " + kind_name;
        }
        if (*after_ms < 0) {
            return std::string("afterMs: must be at least 0");
        }
        // 2^53 - 1, the schema's maximum: the largest whole number every language reads exactly.
        if (*after_ms > 9007199254740991) {
            return std::string("afterMs: must be at most 2^53 - 1");
        }
    }
    if (!takes_input(kind) && (input || needs)) {
        return std::string(input ? "input" : "needs") +
               ": belongs to a call or fix-input recovery, not " + kind_name;
    }
    if (input) {
        if (!input->is_object()) {
            return std::string("input: expected an object");
        }
        if (input->empty()) {
            return std::string("input: must have at least one member");
        }
        if (input->contains("confirm")) {
            return std::string(
                "input: must not carry confirm; a field the caller must decide goes in needs");
        }
    }
    if (needs) {
        if (needs->empty()) {
            return std::string("needs: must name at least one field");
        }
        std::set<std::string_view> seen;
        for (const std::string& field : *needs) {
            if (field.empty()) {
                return std::string("needs: a field name must not be empty");
            }
            if (!seen.insert(field).second) {
                return "needs: names '" + field + "' twice";
            }
        }
    }
    if (kind == RecoveryKind::fix_input && !input && !needs) {
        return std::string("input: a fix-input recovery sets input or needs");
    }
    return std::nullopt;
}

Expected<Recovery> Recovery::from_json(const Json& value) {
    std::string error;
    Recovery out;
    if (!read_recovery(value, std::string(), out, error)) {
        return unexpected(error.empty() ? std::string("(root): invalid value") : error);
    }
    return out;
}

bool is_command_recovery(const Json& value) {
    std::string error;
    Recovery recovery;
    return read_recovery(value, std::string(), recovery, error);
}

void to_json(Json& out, RecoveryKind kind) {
    out = std::string(recovery_kind_name(kind));
}

void to_json(Json& out, const Recovery& recovery) {
    out = Json::object();
    out["kind"] = recovery.kind;
    detail::put(out, "command", recovery.command);
    detail::put(out, "input", recovery.input);
    if (recovery.needs) {
        out["needs"] = *recovery.needs;
    }
    detail::put(out, "thenRetry", recovery.then_retry);
    detail::put(out, "afterMs", recovery.after_ms);
}

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
    // A recovery that breaks `$defs/recovery` is never written: every reader would drop it
    // (rule 7), and the error stays valid on the wire.
    if (error.recovery && !error.recovery->validate()) {
        out["recovery"] = *error.recovery;
    }
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
    // A recovery that breaks `$defs/recovery` is refused here, as every reader would drop it.
    if (options.recovery && !options.recovery->validate()) {
        error.recovery = std::move(options.recovery);
    }
    error.details = std::move(options.details);
    return error;
}

CommandError validation_error(std::string message, std::optional<Json> details) {
    return create_error(error_codes::VALIDATION_ERROR, std::move(message),
                        {.suggestion = "Check the input and try again",
                         .retryable = false,
                         .details = std::move(details)});
}

CommandError call_not_granted() {
    return create_error(error_codes::CALL_NOT_GRANTED, "This app may not call that command",
                        {.suggestion = "Ask the deployer for a calls grant that names the command; "
                                       "the command must also set expose.apps",
                         .retryable = false,
                         .recovery = Recovery{.kind = RecoveryKind::external}});
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
    // Retry the same call (spec/recovery.md, "Engine errors"), after the wait when it is known.
    options.recovery = Recovery{.kind = RecoveryKind::retry};
    if (known) {
        options.suggestion =
            "Wait " + detail::format_number(*retry_after_seconds) + " seconds and try again";
        options.details = Json{{"retryAfterSeconds", wire::number(*retry_after_seconds)}};
        options.recovery->after_ms = rate_limit_after_ms(*retry_after_seconds);
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

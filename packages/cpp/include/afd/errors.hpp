// CommandError, the standard error codes, and error constructors (packages/core/src/errors.ts).
#pragma once

#include "afd/expected.hpp"
#include "afd/json.hpp"

#include <array>
#include <cstdint>
#include <exception>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace afd {

/// What the caller does next after a failure (`spec/recovery.md`). Wire values are `call`,
/// `fix-input`, `retry`, `external` and `stop`.
enum class RecoveryKind {
    /// Call `Recovery::command`; with `then_retry`, repeat the failed call once it succeeds.
    call,
    /// Call the same command again with `Recovery::input`'s values, choosing the `needs` fields.
    fix_input,
    /// Call the same command again unchanged, after `Recovery::after_ms`. The error is retryable.
    retry,
    /// A step outside the command surface, described only in the suggestion.
    external,
    /// No step makes the call succeed; do something else. The error is not retryable.
    stop,
};

/// Every `RecoveryKind`, in `spec/recovery.md` order. TypeScript's `RECOVERY_KINDS`.
inline constexpr std::array<RecoveryKind, 5> recovery_kinds = {
    RecoveryKind::call, RecoveryKind::fix_input, RecoveryKind::retry, RecoveryKind::external,
    RecoveryKind::stop};

/// The step a failed command's `suggestion` describes, in a form a program can follow and a test
/// can check (`spec/recovery.md`; TypeScript's `Recovery`). It sits beside the prose
/// suggestion, never in its place. Wire keys are camelCase, and unset fields are omitted.
///
/// Each field belongs to its kinds (rule 4): `command` and `then_retry` to `call`, `after_ms` to
/// `retry`, and `input` and `needs` to `call` and `fix-input`. `input` has at least one member and
/// never `confirm` (rule 5), `needs` names at least one distinct, non-empty field, and a
/// `fix-input` recovery sets `input` or `needs`.
///
/// `Recovery` is an aggregate, built with designated initializers, so a value that breaks these
/// rules can be built; `validate()` names the rule it breaks. Such a recovery never reaches the
/// wire or a reader: `create_error` and `error` leave it off the error, `to_json` of a
/// `CommandError` omits it, and every reader drops it (rule 7).
///
/// ```cpp
/// error.recovery = afd::Recovery{.kind = afd::RecoveryKind::call, .command = "issue-check"};
/// ```
struct Recovery {
    RecoveryKind kind = RecoveryKind::stop;
    /// `call` only, and required there: the command to call next, by its registered name.
    std::optional<std::string> command;
    /// `call`: arguments for `command`. `fix-input`: replacement values for the failed call's
    /// input. A JSON object holding only values known to work.
    std::optional<Json> input;
    /// `call` and `fix-input`: distinct top-level input fields the caller must choose.
    std::optional<std::vector<std::string>> needs;
    /// `call` only: once `command` succeeds, repeat the failed call unchanged.
    std::optional<bool> then_retry;
    /// `retry` only: wait at least this many milliseconds (0 to 2^53 - 1) first.
    std::optional<std::int64_t> after_ms;

    bool operator==(const Recovery&) const = default;

    /// Reads a recovery, refusing exactly the values that break `spec/schema/error.json`'s
    /// `$defs/recovery`: a value that is not an object, an unknown kind or member, a `null`
    /// member, a member of the wrong JSON type (nothing is coerced) or on the wrong kind, and a
    /// value out of range. An integer written with a zero fraction (`30000.0`) is read as that
    /// integer. An `afterMs` above 2^53 - 1, the schema's maximum, is refused. Never
    /// throws.
    [[nodiscard]] static Expected<Recovery> from_json(const Json& value);

    /// The `$defs/recovery` rule this recovery breaks, naming the field, or `std::nullopt` when it
    /// follows them all. The error-level rules tying `retry` and `stop` to `retryable` are not
    /// checked here.
    [[nodiscard]] std::optional<std::string> validate() const;
};

/// The wire name of `kind`: `call`, `fix-input`, `retry`, `external` or `stop`.
std::string_view recovery_kind_name(RecoveryKind kind) noexcept;

/// The kind named `name`, or `std::nullopt` if it names none this version knows.
std::optional<RecoveryKind> parse_recovery_kind(std::string_view name) noexcept;

/// Whether `value` matches `$defs/recovery`, the same check as `Recovery::from_json` succeeding.
/// A reader treats an error whose recovery fails this as having none, and still reads its
/// `suggestion` (`spec/recovery.md`, rule 7).
bool is_command_recovery(const Json& value);

void to_json(Json& out, RecoveryKind kind);
void to_json(Json& out, const Recovery& recovery);

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
    /// The step `suggestion` describes, structured so a program can follow it and a test can
    /// check it (`spec/recovery.md`). Set `suggestion` too: agents read the prose. A `retry`
    /// recovery needs `retryable = true`, and a `stop` recovery must not set it. A recovery that
    /// fails `Recovery::validate()` is not written to the wire.
    std::optional<Recovery> recovery;
    /// Structured context: a JSON object.
    std::optional<Json> details;
    /// The error that caused this one.
    std::shared_ptr<const CommandError> cause;

    /// Reads a CommandError from JSON without throwing. A `recovery` that does not match
    /// `$defs/recovery` (see `Recovery::from_json`) is read as absent, here and on each `cause`,
    /// and the rest of the error is kept (`spec/recovery.md`, rule 7). The error-level rules
    /// tying `retry` and `stop` to `retryable` are not enforced.
    static Expected<CommandError> from_json(const Json& value);
};

void to_json(Json& out, const CommandError& error);

/// An error code: usually one of `error_codes`, or an application's own.
using ErrorCode = std::string;

/// Optional fields for `create_error` and `error`.
struct ErrorOptions {
    std::optional<std::string> suggestion;
    std::optional<bool> retryable;
    std::optional<Recovery> recovery;
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
// App calls (`spec/command-metadata.md`, "App-to-app calls")
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

/// `{code, message}` plus any of `options`. A `recovery` that fails `Recovery::validate()` is
/// left off the error rather than carried where every reader would drop it.
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

/// Fixed CALL_NOT_GRANTED refusal for app-to-app calls (`spec/command-metadata.md`,
/// "App-to-app calls"). Names neither the command nor the reason.
CommandError call_not_granted();

/// Whether `value` has the shape of a CommandError: an object with string `code` and `message`.
bool is_command_error(const Json& value);

} // namespace afd

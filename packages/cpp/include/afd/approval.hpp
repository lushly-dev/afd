// The pre-execution approval gate (packages/server/src/approval.ts; spec/command-metadata.md,
// "Approvals").
//
// `create_approval_middleware` holds a call whose command's `approval` policy requires a human's
// sign-off and returns `APPROVAL_REQUIRED` before the handler runs. The result carries an
// approval token; once a human approves, the surface retries the same call with that token in
// `CommandContext::approval`.
//
// Tokens are TypeScript's, byte for byte: `afdap1.<payload>.<mac>`, both parts unpadded
// base64url. The payload is the JSON `{"c","i","a","iat","exp","n"}`: the command name, keyed
// digests (HMAC-SHA256) of the canonical JSON of the validated input and of the actor's `kind`,
// `id` and `onBehalfOf`, issue and expiry times in epoch milliseconds, and a 128-bit random
// nonce. The MAC is HMAC-SHA256 over `afdap1.<payload>` with the application's secret, so a
// token issued by a server in any language verifies on another that shares the secret.
#pragma once

#include "afd/actor.hpp"
#include "afd/command.hpp"
#include "afd/expected.hpp"
#include "afd/json.hpp"
#include "afd/runtime.hpp"

#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace afd {

/// Why a supplied approval token was not accepted. Wire values are kebab-case
/// (`invalid-signature`, ...).
enum class ApprovalRejection {
    malformed,
    invalid_signature,
    expired,
    command_mismatch,
    input_mismatch,
    actor_mismatch,
    already_used
};

/// The wire name of `rejection`, e.g. `already-used`.
std::string_view approval_rejection_name(ApprovalRejection rejection) noexcept;

/// What the middleware reads from a command: its name, approval policy and confirmation prompt.
/// Converts from a `CommandDefinition`, so a list of definitions can be passed as it is.
struct ApprovalCommand {
    std::string name;
    std::optional<ApprovalPolicy> approval;
    std::optional<std::string> confirm_prompt;

    ApprovalCommand() = default;
    ApprovalCommand(std::string name, std::optional<ApprovalPolicy> approval,
                    std::optional<std::string> confirm_prompt = std::nullopt)
        : name(std::move(name)), approval(std::move(approval)),
          confirm_prompt(std::move(confirm_prompt)) {}
    /// Implicit, so `.commands = {todo_delete, todo_list}` takes definitions as they are.
    ApprovalCommand(const CommandDefinition& definition)
        : name(definition.name), approval(definition.approval),
          confirm_prompt(definition.confirm_prompt) {}
};

/// Records which single-use tokens have been spent. The default keeps them in memory, for one
/// middleware instance: give servers that run several instances a shared store.
class ApprovalNonceStore {
public:
    virtual ~ApprovalNonceStore() = default;
    /// Marks `nonce` as used until `expires_at_ms` (epoch milliseconds; it can be forgotten
    /// after). Returns false when it was already used. Must be atomic: of two concurrent calls
    /// with the same nonce, exactly one returns true.
    virtual bool consume(std::string_view nonce, std::int64_t expires_at_ms) = 0;
};

/// A call held for approval, as passed to `on_approval_required`.
struct ApprovalRequest {
    std::string command;
    /// The validated input the token is bound to.
    Json input;
    std::optional<Actor> actor;
    std::string approval_token;
    /// ISO 8601 expiry of `approval_token`.
    std::string expires_at;
    std::string summary;
    /// Set when the call carried a token that was rejected.
    std::optional<ApprovalRejection> rejected;
};

/// Whether one token can run its call more than once.
enum class ApprovalReplay {
    /// A token runs the command once; a second call with it is held again (`already-used`).
    single_use,
    /// A token runs the same command, input and actor as often as it is presented until it
    /// expires, so one approval also covers repeats (such as duplicate batch items).
    within_ttl
};

/// Options for `create_approval_middleware`.
struct ApprovalMiddlewareOptions {
    /// The HMAC keys, as bytes: the first signs, any of them verifies (for key rotation).
    /// Required, with no default; each must be at least 32 bytes. Keep them out of source.
    std::vector<std::string> secrets;
    /// The commands to gate: pass the same definitions given to the registry (a vector of them
    /// converts with `{definitions.begin(), definitions.end()}`). A command that is not in this
    /// list is never held, whatever its `approval` policy says.
    std::vector<ApprovalCommand> commands;
    /// How long a token stays valid, in milliseconds. Default 300000 (5 minutes); at most 24
    /// hours.
    std::int64_t ttl_ms = 5 * 60 * 1000;
    ApprovalReplay replay = ApprovalReplay::single_use;
    /// Where single-use nonces are recorded. Default: in memory, for this middleware only. Share
    /// one store between every instance that uses the same secret, or a token works once on
    /// each.
    std::shared_ptr<ApprovalNonceStore> nonce_store;
    /// The text shown to the human who approves. Default (also for an empty string or
    /// `std::nullopt`): the command's `confirm_prompt`, else `Run <command>`.
    std::function<std::optional<std::string>(std::string_view command, const Json& input,
                                             const CommandContext& context)>
        summarize;
    /// Whether the `APPROVAL_REQUIRED` result carries `details.approvalToken`. Default true,
    /// which is safe only while the gated caller cannot set `CommandContext::approval` itself
    /// (true of MCP tool calls, whose arguments never reach the context). Set false when the
    /// caller must not hold the token, and deliver it through `on_approval_required`.
    bool include_token = true;
    /// Called for every held call, before the result is returned (for example, to notify a
    /// human).
    std::function<void(const ApprovalRequest& request)> on_approval_required;
    /// Issues and expires tokens (`wall_ms`). Default: a `SystemClock`. `CommandContext::clock`
    /// is never used: the caller can set it, and this is security time.
    std::shared_ptr<const Clock> clock;
    /// Fills `size` bytes at `out` with cryptographically secure random bytes, for nonces.
    /// Default: `std::random_device`, which is the OS entropy source on glibc, libc++ (macOS),
    /// MSVC and Emscripten. MinGW's libstdc++ before GCC 9.2 makes it deterministic: supply a
    /// generator there. Never pass a `RandomSource`-based generator.
    std::function<void(std::uint8_t* out, std::size_t size)> random_bytes;
};

/// A middleware that runs a command whose `approval` policy requires approval only when
/// `context.approval` holds a valid token for this command, input and actor. Otherwise it
/// returns `APPROVAL_REQUIRED` with a fresh token, and the handler does not run. A policy
/// function that returns anything but `not_required` holds the call; one that throws (in builds
/// with exceptions) fails it. An input `canonical_json` cannot encode fails the call with
/// `COMMAND_EXECUTION_ERROR`.
///
/// Install it after any middleware that sets or refines `context.actor`, since tokens are bound
/// to the actor. A registry may run calls concurrently: `summarize`, `on_approval_required`,
/// `random_bytes` and a custom `nonce_store` must then be thread-safe. The built-in nonce store
/// is.
///
///     auto approval = afd::create_approval_middleware(
///         {.secrets = {secret_from_environment}, .commands = {todo_delete, todo_list}});
///     if (!approval) { /* approval.error() says why */ }
///     registry.use(*approval);
///
/// Fails (no exceptions) when no secret is given, a secret is shorter than 32 bytes, `ttl_ms`
/// is not in (0, 24 hours], or a command's policy is an empty function.
Expected<CommandMiddleware> create_approval_middleware(ApprovalMiddlewareOptions options);

/// The JSON a token binds an input to: object keys sorted at every depth by UTF-16 code units,
/// otherwise as JavaScript's `JSON.stringify` writes it, so it equals TypeScript's
/// `canonicalJson`. Fails rather than collide: on an integer beyond ±(2^53 − 1) not spelled as
/// JavaScript writes its double (JavaScript reads `2^53 + 1` as `2^53`), a non-finite number, a
/// string that is not valid UTF-8, binary or discarded values, and nesting deeper than 256 levels.
Expected<std::string> canonical_json(const Json& value);

} // namespace afd

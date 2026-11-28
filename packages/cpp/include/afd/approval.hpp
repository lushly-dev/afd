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
    credentials_mismatch,
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
    ApprovalCommand(std::string command_name, std::optional<ApprovalPolicy> policy,
                    std::optional<std::string> prompt = std::nullopt)
        : name(std::move(command_name)), approval(std::move(policy)),
          confirm_prompt(std::move(prompt)) {}
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
    /// The `approval_id` the summary of a call admitted on `approval_token` carries
    /// (spec/command-metadata.md, "The approval summary", rule 5): `approval_id` of the token's
    /// nonce. Not a credential.
    std::string approval_id;
};

/// How an approval step admitted a held call. Wire values are `token`, `elicitation` and
/// `direct`. (TypeScript's `relay`, a `HumanRelay`'s evidence, has no C++ counterpart.)
enum class ApprovalVia {
    /// An approval token in `CommandContext::approval`.
    token,
    /// An accepted answer over the MCP relay (`ApprovalRelay::mcp_elicitation`), including each
    /// gated step of an `afd-batch` or `afd-pipe` approved up front.
    elicitation,
    /// `DirectClient`'s private exchange (`DirectClientOptions::on_approval_needed`).
    direct
};

/// The wire name of `via`, e.g. `elicitation`.
std::string_view approval_via_name(ApprovalVia via) noexcept;

/// What an approval step tells `on_approval_accepted` when it admits a call a policy held
/// (spec/command-metadata.md, "The approval summary"). It holds no token, nonce, key or
/// credential, and grants nothing: no engine code reads it back.
struct ApprovalSummary {
    ApprovalVia via = ApprovalVia::token;
    /// The command's name.
    std::string command;
    /// The unpadded base64url SHA-256 of the canonical JSON of the validated input. Unkeyed, so
    /// guesses at a short input can be checked against it: a host that stores the summary leaves
    /// it out, or redacts it, wherever it would redact the input (a `secret` command).
    std::string input_digest;
    /// `approval_id` of the evidence's single-use key: the token's nonce for `token` and
    /// `direct`, the hold's nonce for `elicitation`. Under `ApprovalReplay::within_ttl`, every
    /// call one token admits carries the same id; their dispatch ids tell them apart.
    std::string approval_id;
    /// Epoch milliseconds: a token's `iat`. Unset for `elicitation`.
    std::optional<std::int64_t> issued_at;
    /// Epoch milliseconds: a token's `exp`, or the elicitation hold's expiry.
    std::optional<std::int64_t> expires_at;
};

/// `{via, command, inputDigest, approvalId, issuedAt?, expiresAt?}`, as TypeScript's
/// `ApprovalSummary`.
void to_json(Json& out, const ApprovalSummary& summary);

/// The approval id of a single-use key: the unpadded base64url SHA-256 of the UTF-8 bytes of
/// `approval`, a zero byte and `key` (spec/command-metadata.md, "The approval summary"). An
/// approver handed a token derives it from the payload's `n`.
std::string approval_id(std::string_view key);

/// Whether one token can run its call more than once.
enum class ApprovalReplay {
    /// A token runs the command once; a second call with it is held again (`already-used`).
    single_use,
    /// A token runs the same command, input and actor as often as it is presented until it
    /// expires, so one approval also covers repeats (such as duplicate batch items).
    within_ttl
};

/// How a held MCP call reaches the human (spec/command-metadata.md, "Asking the human over MCP").
enum class ApprovalRelay {
    /// No relay: a held call returns `APPROVAL_REQUIRED`.
    none,
    /// On an `afd::mcp_stdio` server, ask the human behind the MCP client with a form elicitation
    /// when the request can carry one, instead of returning the hold to the agent. Opt in only
    /// when the client application shows the question to a person: a server cannot tell a
    /// person's answer from client code that answers on its own.
    mcp_elicitation
};

/// Options for `create_approval_middleware`.
struct ApprovalMiddlewareOptions {
    /// The HMAC keys, as bytes: the first signs, any of them verifies (for key rotation).
    /// Required, with no default; each must be at least 32 bytes. Keep them out of source.
    std::vector<std::string> secrets;
    /// Optional. The middleware decides from the policy and `confirm_prompt` of the command the
    /// registry runs, so commands registered later are covered. A policy given here for a command
    /// also holds it: a call is held when either the command's own policy or this list's entry
    /// holds it, so a function policy given both ways may be called twice. A vector of
    /// definitions converts with `{definitions.begin(), definitions.end()}`.
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
    /// Whether the `APPROVAL_REQUIRED` result carries `details.approvalToken`. Default (unset):
    /// yes, except on calls whose `context.surface` is MCP, as in TypeScript, so an MCP agent
    /// never holds the token (spec/command-metadata.md, "Approvals", rule 6). Set false when the
    /// caller must not hold the token, and deliver it through `on_approval_required`.
    std::optional<bool> include_token;
    /// Called for every held call, before the result is returned (for example, to notify a
    /// human).
    std::function<void(const ApprovalRequest& request)> on_approval_required;
    /// Issues and expires tokens (`wall_ms`). Default: a `SystemClock`. `CommandContext::clock`
    /// is never used: the caller can set it, and this is security time.
    std::shared_ptr<const Clock> clock;
    /// Fills `size` bytes at `out` with cryptographically secure random bytes, for nonces.
    /// Default: `std::random_device`, which is the OS entropy source on glibc, libc++ (macOS),
    /// MSVC and Emscripten. MinGW's libstdc++ before GCC 9.2 makes it deterministic: supply a
    /// generator there. Never pass a `RandomSource`-based generator. It returns nothing, while
    /// `CommandRegistryOptions::random_bytes` returns whether it filled the bytes, so one
    /// generator serving both needs a small adapter for one of them.
    std::function<void(std::uint8_t* out, std::size_t size)> random_bytes;
    /// Whether to ask the human over MCP. Default: no relay. With `mcp_elicitation`, a call the
    /// `afd::mcp_stdio` server routes to one command is asked as a form elicitation; no token is
    /// issued and `on_approval_required` is not called for it. A declined form fails the call
    /// with `APPROVAL_REQUIRED`, `details.reason: "declined"`.
    ApprovalRelay relay = ApprovalRelay::none;
    /// Called each time this middleware admits a call a policy held, before the next link runs
    /// (spec/command-metadata.md, "The approval summary"): with the `ApprovalSummary` and the
    /// call's `CommandContext::dispatch_id` (empty only when the middleware runs outside
    /// `CommandRegistry::execute`). A host that keeps its own record of a call files the approval
    /// there under the dispatch id. Return `std::nullopt` to let the call run, or a message to
    /// refuse it.
    ///
    /// Each gated step of an `afd-batch` or `afd-pipe` approved up front gets its own call as the
    /// step is admitted, and a call no policy held, or whose evidence was rejected, gets none.
    /// Under `ApprovalReplay::within_ttl`, a retrying middleware placed before this one can have
    /// one call admitted twice: the hook is then called twice with the same approval id and
    /// dispatch id.
    ///
    /// It fails closed. A refusal is this middleware's error: in builds with exceptions it throws
    /// a `std::runtime_error` (`The on_approval_accepted hook refused the call: <message>`), which
    /// unwinds through the links outside this one as any middleware's exception does, and
    /// `CommandRegistry` reports it to `on_error`, answers `COMMAND_EXECUTION_ERROR` and skips
    /// `on_command`. Without exceptions the middleware returns `COMMAND_EXECUTION_ERROR` and the
    /// registry reports it the same way. The refusal of the last pass through this middleware
    /// stands whatever a link outside it returns: one that catches the exception, or the failure,
    /// cannot make the call a success. A retry that reaches this middleware again is decided
    /// afresh, so one the hook admits runs. The handler does not run, and the evidence is already
    /// spent: under `ApprovalReplay::single_use` a retry with the same token is `already-used`.
    /// So a host that must record an approval before the action can rely on the handler not
    /// running without it. An exception the hook throws is a middleware exception too. Must be
    /// thread-safe when calls run concurrently. Last, so positional initializers written before
    /// it existed still compile.
    std::function<std::optional<std::string>(const ApprovalSummary& summary,
                                             std::string_view dispatch_id)>
        on_approval_accepted;
};

/// A middleware that runs a command whose `approval` policy requires approval only when
/// `context.approval` holds a valid token for this command, input and actor. Otherwise it
/// returns `APPROVAL_REQUIRED` with a fresh token, and the handler does not run. A policy
/// function that returns anything but `not_required` holds the call; one that throws (in builds
/// with exceptions) fails it. An input `canonical_json` cannot encode fails the call with
/// `COMMAND_EXECUTION_ERROR`.
///
/// Every path that lets through a call one of its policies may gate (the command's own, or the
/// one `commands` lists for it) admits it, and the registry runs a command whose declared or
/// listed policy is not `not_required` only on every such admission: once, for that command and
/// that validated input (`APPROVAL_UNAVAILABLE` otherwise). A call no policy here gates is not
/// admitted. Install one approval middleware per registry: two that both gate a command's own
/// policy each ask for it. Install middleware that retries or changes the input before this one,
/// and this one after any middleware that sets or refines `context.actor`, since tokens are bound
/// to the actor. A registry may run calls concurrently: `summarize`,
/// `on_approval_required`, `random_bytes` and a custom `nonce_store` must then be thread-safe. The
/// built-in nonce store is.
///
///     auto approval = afd::create_approval_middleware(
///         {.secrets = {secret_from_environment}});
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

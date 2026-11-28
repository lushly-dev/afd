// Private: where a call's idempotency key came from, and the engine's idempotency step
// (spec/idempotency.md, K1 to K6 and S1 to S13). TypeScript's
// `@lushly-dev/afd-core/internal/idempotency` and `packages/server/src/idempotency-step.ts`.
// Not installed.
//
// A key reaches the registry on `context.idempotency_key`. The registry takes it:
// - as no key when it is absent, or when it equals the key the registry delivered to the handler
//   of the call this one is nested in (K6), marked on that handler's context;
// - as it is when the engine set it itself, a derived key (K4) or one restored from a journal,
//   which fail K2's form;
// - as a caller's key when it has K2's form, and otherwise refuses the call.
//
// The marks are not a boundary against code in the same process: a key marked as the engine's
// still scopes only its caller's own calls (K5).
#pragma once

#include "afd/command.hpp"
#include "afd/idempotency.hpp"
#include "afd/json.hpp"
#include "afd/registry.hpp"
#include "afd/result.hpp"
#include "afd/runtime.hpp"

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <string_view>

namespace afd::detail {

/// What the engine did with the key on a context: set it itself (`delivered == false`), or
/// delivered it to a handler (`delivered == true`).
struct IdempotencyKeyMark {
    std::string key;
    bool delivered = false;
};

/// The connection a stdio caller with no identity of its own is told apart by (S3): a random id,
/// one per `afd::mcp_stdio` server.
struct IdempotencyConnection {
    std::string id;
};

/// Set when the idempotency step reserved the key of the call that took this note (R3).
struct IdempotencyNote {
    std::atomic<bool> step_acted{false};
};

/// The key a call carries, as the engine decides it.
struct CallIdempotencyKey {
    enum class Kind { none, key, invalid } kind = Kind::none;
    std::string key;
    bool set_by_engine = false;
};

/// The key `context` carries, decided as the file comment says.
CallIdempotencyKey resolve_idempotency_key(const CommandContext& context);

/// Puts the call's key on `context` itself, the object its middleware and handler share (K3), and
/// marks it delivered, so a call the handler makes on this context starts without it (K6).
void deliver_idempotency_key(CommandContext& context, const CallIdempotencyKey& key);

/// Sets `key` on `context` as a key the engine chose (a derived or restored key), or clears the
/// key when `key` is unset.
void set_engine_idempotency_key(CommandContext& context, const std::optional<std::string>& key);

/// The key of the item or step at `index` of a batch or pipeline whose request ran on `request`,
/// put on `item` (a copy of `request`): the key derived from the request's (K4), none when the
/// request had none or inherited it (K6), and the request's own when it is invalid, so the item
/// fails K2 at its engine.
void derive_item_idempotency_key(const CommandContext& request, CommandContext& item,
                                 IdempotencyRequestKind kind, std::size_t index);

/// The call the step acts on, prepared before middleware runs (S4).
struct PreparedIdempotencyCall {
    std::string command;
    std::string key;
    /// The unpadded base64url SHA-256 of the canonical JSON of the declared context fields and
    /// the validated input.
    std::string digest;
    /// The call's own deadline in whole milliseconds, as the engine enforces it (rounded up and
    /// clamped to `max_timeout_ms`), if it has one.
    std::optional<double> timeout_ms;
};

/// The digest of a call (S4), or `std::nullopt` when it has no canonical form.
std::optional<std::string> idempotency_digest(const Json& fields, const Json& input);

/// `VALIDATION_ERROR` for an input with no canonical form, which a key cannot cover (S4).
CommandError input_not_canonical_error(std::string_view command);

/// M8's internal error, whose message names no one (S3).
CommandError internal_principal_error();

/// The step's options with their defaults applied.
struct IdempotencyStep {
    std::shared_ptr<IdempotencyStore> store;
    std::int64_t ttl_ms = default_idempotency_ttl_ms;
    std::int64_t lease_ms = default_idempotency_lease_ms;
};

/// What `run_idempotency_step` needs besides the call.
struct IdempotencyRun {
    const IdempotencyStep& step;
    /// The step's clock: the registry's, never the caller's (S8).
    const Clock& clock;
    CommandContext& context;
    /// When the call's chain, and its deadline, started on the step's clock (S7).
    std::int64_t started_at = 0;
    /// Runs the handler.
    std::function<CommandResult()> handler;
    /// Called once the key is reserved (R3).
    std::function<void()> on_reserved;
    /// Where a store's failure to settle goes; the handler's result still stands.
    std::function<void(std::string_view)> report_error;
};

/// The innermost link with the step (S1, S5, S6): for `call`, answer from the store, or reserve
/// its key, check cancellation again, run the handler and settle. The scope is bound here, to the
/// principal the context holds after middleware ran. Without `call` (the step does not act), run
/// the handler. Either way a handler's own `idempotentReplay` is removed (S9). In builds with
/// exceptions, a handler that throws marks the reservation as never settled and the exception
/// goes on.
CommandResult run_idempotency_step(const std::optional<PreparedIdempotencyCall>& call,
                                   const IdempotencyRun& run);

/// `result` without a handler-supplied `metadata.idempotentReplay`, which is the engine's (S9).
CommandResult without_replay_marker(CommandResult result);

/// The principal part of a call's scope (S3, K5), or `std::nullopt` when it cannot be bound.
std::optional<std::string> idempotency_principal(const CommandContext& context);

/// The scope of `principal`, `command` and `key` (K5).
std::optional<std::string> idempotency_scope(std::string_view principal, std::string_view command,
                                             std::string_view key);

// --- afd::mcp_stdio's part (kept here, out of the server's translation unit) ---------------

/// A connection id for one stdio server: 128 random bits, or, where the secure source fails, the
/// connection's own address, which no other live connection shares.
std::shared_ptr<const IdempotencyConnection> new_idempotency_connection();

/// Fills the idempotency members of a stdio call's `context` once `context_hook` ran: the key from
/// `meta` (`_meta["dev.afd/idempotencyKey"]`) unless the hook set one (K1; `null` is no key), the
/// connection when the hook left the caller no identity of its own (S3), and no internal marks.
void apply_stdio_idempotency(CommandContext& context, const Json& meta,
                             const std::shared_ptr<const IdempotencyConnection>& connection);

/// Whether a stdio call's key fails K2's form: the one `context` carries, or a value in `meta`
/// that is not a string.
bool stdio_idempotency_refused(const CommandContext& context, const Json& meta);

/// S8's check of `registry`'s idempotency step against a stdio server's default deadline.
std::optional<std::string> check_stdio_idempotency(const CommandRegistry& registry,
                                                   std::optional<double> default_timeout_ms);

/// The late-finish `TIMEOUT` of the call of `context`, whose deadline the caller owns: with R3's
/// recovery when the registry noted that the step reserved its key.
CommandResult timed_out(std::string_view name, double timeout_ms, const CommandContext& context);

} // namespace afd::detail

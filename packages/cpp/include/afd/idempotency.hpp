// Idempotency keys (spec/idempotency.md): what a command declares about repeats, the key a caller
// sends, its form (K2) and the keys a batch or pipeline derives from it (K4), and the engine's step
// (S1 to S13): its options, its store and the errors it answers with. `CommandRegistry::execute`
// validates and delivers the key on every call; the step acts only where the registry is given
// `CommandRegistryOptions::idempotency` (packages/server/src/idempotency-step.ts and
// idempotency-store.ts).
#pragma once

#include "afd/errors.hpp"
#include "afd/result.hpp"

#include <cstddef>
#include <cstdint>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>

namespace afd {

/// The `_meta` key a caller sends an idempotency key in (K1).
inline constexpr std::string_view afd_idempotency_key_meta_key = "dev.afd/idempotencyKey";

/// What a command declares about repeating a call (D1 to D5).
enum class IdempotencySupport {
    /// `natural`: a repeat leaves the same state as one call (a set, a delete by id).
    natural,
    /// `keyed`: a repeat that carries the same key and input is safe.
    keyed,
};

/// The wire spelling: `natural` or `keyed`.
inline constexpr std::string_view idempotency_support_name(IdempotencySupport support) noexcept {
    return support == IdempotencySupport::natural ? "natural" : "keyed";
}

/// Whether `value` is one of the declared values, `natural` or `keyed`.
inline constexpr bool is_idempotency_support(std::string_view value) noexcept {
    return value == "natural" || value == "keyed";
}

/// Whether `value` is a key a caller may send (K2): 1 to 200 characters, each one of
/// `A-Z a-z 0-9 . _ ~ -`. A derived key, which holds `:`, is not.
inline constexpr bool is_idempotency_key(std::string_view value) noexcept {
    if (value.empty() || value.size() > 200)
        return false;
    for (const char c : value) {
        const bool allowed = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
                             (c >= '0' && c <= '9') || c == '.' || c == '_' || c == '~' || c == '-';
        if (!allowed)
            return false;
    }
    return true;
}

/// A request whose items or steps run under derived keys (K4).
enum class IdempotencyRequestKind {
    /// An `afd-batch`: item `i` runs under `<key>:<i>`.
    batch,
    /// An `afd-pipe`: step `i` runs under `<key>:step:<i>`.
    pipeline,
};

/// The key the item or step at 0-based `index` of a batch or pipeline runs under, when the request
/// carried `base` (K4).
inline std::string derive_idempotency_key(std::string_view base, IdempotencyRequestKind kind,
                                          std::size_t index) {
    std::string key(base);
    key += kind == IdempotencyRequestKind::batch ? ":" : ":step:";
    key += std::to_string(index);
    return key;
}

/// The `VALIDATION_ERROR` for a key that is not of K2's form.
inline CommandError invalid_idempotency_key_error() {
    return create_error(
        error_codes::VALIDATION_ERROR, "The idempotency key is not valid",
        ErrorOptions{
            .suggestion = std::string("Send _meta[\"") + std::string(afd_idempotency_key_meta_key) +
                          "\"] as a string of 1 to 200 characters, each one of A-Z a-z 0-9 . _ ~ "
                          "-, or leave it out",
            .retryable = false,
            .recovery = std::nullopt,
            .details = Json{{"field", "idempotencyKey"},
                            {"meta", std::string(afd_idempotency_key_meta_key)}},
        });
}

/// The default time the store remembers a key: one day (S8).
inline constexpr std::int64_t default_idempotency_ttl_ms = 86'400'000;
/// The default time a reservation stays live past the call's deadline (S7).
inline constexpr std::int64_t default_idempotency_lease_ms = 60'000;

/// What the store holds for a scope (S5, S6).
enum class IdempotencyState {
    /// The handler is running, or nobody settled the reservation yet.
    reserved,
    /// The handler's result is kept.
    stored,
    /// Nobody can say whether the call was applied (`TIMEOUT`, a throw).
    unknown,
};

/// What the store holds for one scope (K5: the caller's principal binding, the command and the
/// key).
struct IdempotencyRecord {
    /// The identity of the reservation this record was made for (S5, S12).
    std::string reservation;
    /// The call's digest (S4).
    std::string digest;
    /// When the key was reserved, on the registry's clock (`Clock::wall_ms`).
    std::int64_t reserved_at = 0;
    /// When the record stops answering repeats: `reserved_at + ttl_ms` (S8). Inclusive.
    std::int64_t expires_at = 0;
    /// When a reservation still unsettled stops being live and is treated as never settled: the
    /// call's deadline plus `lease_ms`, or `reserved_at + lease_ms` for a call without one (S7).
    /// Inclusive.
    std::int64_t lease_ends_at = 0;
    IdempotencyState state = IdempotencyState::reserved;
    /// The handler's result, when `state` is `stored`.
    std::optional<CommandResult> result;
};

/// A reservation to make: the record's digest and times, without its identity or state.
struct IdempotencyReservationRequest {
    std::string digest;
    std::int64_t reserved_at = 0;
    std::int64_t expires_at = 0;
    std::int64_t lease_ends_at = 0;
};

/// What `IdempotencyStore::reserve` did: reserved the key (`reservation` is the new identity), or
/// found it held (`record` is what holds it).
struct IdempotencyReserveOutcome {
    bool reserved = false;
    std::string reservation;
    std::optional<IdempotencyRecord> record;
};

/// How a reservation is settled: with the result to keep, or, without one, as never settled (S6).
struct IdempotencySettlement {
    std::optional<CommandResult> result;
};

/// The store of the idempotency step (S12). Each method is atomic for its scope and safe to call
/// from several threads. A store several processes share gives the step's promise across them
/// (S13); the default does not. A store may throw in builds with exceptions: a throw from
/// `reserve` fails the call as a handler's does, and one from `complete` or `release` goes to
/// `CommandRegistryOptions::on_error` while the handler's result stands.
class IdempotencyStore {
public:
    virtual ~IdempotencyStore() = default;
    /// Reserves the key of `scope` for `request`, unless a record that has not expired at `now`
    /// holds it: then reports that record and changes nothing. Of two calls for one scope that
    /// find nothing, exactly one reserves. The new reservation's identity is unique to it.
    virtual IdempotencyReserveOutcome reserve(const std::string& scope,
                                              const IdempotencyReservationRequest& request,
                                              std::int64_t now) = 0;
    /// Settles `reservation` as `settlement` says. Does nothing when the scope no longer holds that
    /// reservation (it was released, or the key was reserved again).
    virtual void complete(const std::string& scope, const std::string& reservation,
                          const IdempotencySettlement& settlement) = 0;
    /// Removes `reservation`, so a repeat runs. Does nothing when the scope no longer holds it.
    virtual void release(const std::string& scope, const std::string& reservation) = 0;
    /// The record of `scope` that has not expired at `now`, if any.
    virtual std::optional<IdempotencyRecord> get(const std::string& scope, std::int64_t now) = 0;
};

/// Options of `InMemoryIdempotencyStore`.
struct InMemoryIdempotencyStoreOptions {
    /// Scopes held before expired records are swept on the next reservation (default 10,000;
    /// at least 1). A sweep removes only expired records, so the store can hold more live ones;
    /// the next sweep then waits until it holds twice as many as the last one left.
    std::size_t sweep_at = 10'000;
};

/// The default store: in memory, for this process only, behind one mutex. A restart forgets
/// every key, and a repeat that reaches another process finds nothing there (S13). A host that
/// needs the promise across restarts or processes supplies a store that gives it.
class InMemoryIdempotencyStore final : public IdempotencyStore {
public:
    explicit InMemoryIdempotencyStore(InMemoryIdempotencyStoreOptions options = {});
    IdempotencyReserveOutcome reserve(const std::string& scope,
                                      const IdempotencyReservationRequest& request,
                                      std::int64_t now) override;
    void complete(const std::string& scope, const std::string& reservation,
                  const IdempotencySettlement& settlement) override;
    void release(const std::string& scope, const std::string& reservation) override;
    std::optional<IdempotencyRecord> get(const std::string& scope, std::int64_t now) override;
    /// How many scopes the store holds, expired ones included until a sweep.
    [[nodiscard]] std::size_t size() const;

private:
    std::optional<IdempotencyRecord> live(const std::string& scope, std::int64_t now);
    mutable std::mutex mutex_;
    std::map<std::string, IdempotencyRecord, std::less<>> records_;
    std::size_t sweep_at_;
    std::size_t next_sweep_at_;
    std::uint64_t reservations_ = 0;
};

/// The engine's idempotency step (`CommandRegistryOptions::idempotency`, S1 to S13). It answers
/// a repeat of a call that carries a key, to a command declaring `IdempotencySupport::keyed`, from
/// `store`, between the approval admission check and the handler.
struct IdempotencyOptions {
    /// Where keys and results are kept (S12). Default: an `InMemoryIdempotencyStore`, for this
    /// process only. A host with several processes behind one address gives them one shared store
    /// or leaves the step off.
    std::shared_ptr<IdempotencyStore> store;
    /// How long a stored result, or a reservation never settled, answers repeats, from the time
    /// the key was reserved (S8). Must be greater than the server's default deadline plus
    /// `lease_ms`.
    std::int64_t ttl_ms = default_idempotency_ttl_ms;
    /// How long a reservation still unsettled stays live past the call's deadline, or past the
    /// reservation where the call has none (S7). A host whose handlers run longer than that
    /// without a deadline sets it to cover them.
    std::int64_t lease_ms = default_idempotency_lease_ms;
};

/// Why `options` cannot be used with a server whose default deadline is `default_timeout_ms`
/// (unset or non-positive for none), or `std::nullopt` when they can: `ttl_ms` and `lease_ms`
/// must be positive, and `ttl_ms` greater than the deadline plus `lease_ms` (S8), or a key could
/// become new while its first call still runs. `CommandRegistry::create` checks it with no
/// default deadline, and `afd::mcp_stdio`'s server with its `default_timeout_ms`.
[[nodiscard]] std::optional<std::string>
check_idempotency_options(const IdempotencyOptions& options,
                          std::optional<double> default_timeout_ms = std::nullopt);

/// `IDEMPOTENCY_KEY_REUSED` (S5): the key is held for a call with another input.
CommandError idempotency_key_reused_error();
/// `IDEMPOTENCY_IN_PROGRESS` (S5): an earlier call with this key and input is still running.
CommandError idempotency_in_progress_error();
/// `OUTCOME_UNKNOWN` from the step (S6, S7): nobody can say whether the earlier call was applied.
CommandError idempotency_outcome_unknown_error();

} // namespace afd

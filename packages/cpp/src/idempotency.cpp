// The idempotency step's store, options and errors, the engine's key resolution and the step
// itself (spec/idempotency.md). TypeScript's idempotency-store.ts, idempotency-step.ts and
// core's idempotency-keys.ts.
#include "afd/idempotency.hpp"

#include "afd/approval.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <string>
#include <utility>

#include "detail/approver_call.hpp"
#include "detail/dispatch_id.hpp"
#include "detail/exceptions.hpp"
#include "detail/hmac.hpp"
#include "detail/idempotency.hpp"
#include "detail/json_io.hpp"
#include "detail/sha256.hpp"

namespace afd {

// --- the store ----------------------------------------------------------------------------

InMemoryIdempotencyStore::InMemoryIdempotencyStore(InMemoryIdempotencyStoreOptions options)
    : sweep_at_((std::max)(options.sweep_at, std::size_t{1})), next_sweep_at_(sweep_at_) {}

std::optional<IdempotencyRecord> InMemoryIdempotencyStore::live(const std::string& scope,
                                                                std::int64_t now) {
    const auto found = records_.find(scope);
    if (found == records_.end()) {
        return std::nullopt;
    }
    if (now > found->second.expires_at) {
        records_.erase(found);
        return std::nullopt;
    }
    return found->second;
}

IdempotencyReserveOutcome
InMemoryIdempotencyStore::reserve(const std::string& scope,
                                  const IdempotencyReservationRequest& request, std::int64_t now) {
    const std::lock_guard lock(mutex_);
    if (auto held = live(scope, now)) {
        return {.reserved = false, .reservation = {}, .record = std::move(held)};
    }
    if (records_.size() >= next_sweep_at_) {
        for (auto it = records_.begin(); it != records_.end();) {
            it = now > it->second.expires_at ? records_.erase(it) : std::next(it);
        }
        // Amortized: a store full of live keys does not scan them on every reservation.
        next_sweep_at_ = (std::max)(sweep_at_, 2 * records_.size());
    }
    // Unique within this store, which is the only one its `complete` and `release` reach.
    const std::string reservation = std::to_string(++reservations_);
    records_[scope] = IdempotencyRecord{.reservation = reservation,
                                        .digest = request.digest,
                                        .reserved_at = request.reserved_at,
                                        .expires_at = request.expires_at,
                                        .lease_ends_at = request.lease_ends_at,
                                        .state = IdempotencyState::reserved,
                                        .result = std::nullopt};
    return {.reserved = true, .reservation = reservation, .record = std::nullopt};
}

void InMemoryIdempotencyStore::complete(const std::string& scope, const std::string& reservation,
                                        const IdempotencySettlement& settlement) {
    const std::lock_guard lock(mutex_);
    const auto found = records_.find(scope);
    if (found == records_.end() || found->second.reservation != reservation) {
        return;
    }
    if (settlement.result) {
        found->second.state = IdempotencyState::stored;
        found->second.result = settlement.result;
    } else {
        found->second.state = IdempotencyState::unknown;
    }
}

void InMemoryIdempotencyStore::release(const std::string& scope, const std::string& reservation) {
    const std::lock_guard lock(mutex_);
    const auto found = records_.find(scope);
    if (found != records_.end() && found->second.reservation == reservation) {
        records_.erase(found);
    }
}

std::optional<IdempotencyRecord> InMemoryIdempotencyStore::get(const std::string& scope,
                                                               std::int64_t now) {
    const std::lock_guard lock(mutex_);
    return live(scope, now);
}

std::size_t InMemoryIdempotencyStore::size() const {
    const std::lock_guard lock(mutex_);
    return records_.size();
}

// --- options and errors -------------------------------------------------------------------

std::optional<std::string> check_idempotency_options(const IdempotencyOptions& options,
                                                     std::optional<double> default_timeout_ms) {
    if (options.ttl_ms < 1) {
        return std::string("idempotency.ttl_ms must be a positive integer of milliseconds");
    }
    if (options.lease_ms < 1) {
        return std::string("idempotency.lease_ms must be a positive integer of milliseconds");
    }
    const double deadline =
        default_timeout_ms && std::isfinite(*default_timeout_ms) && *default_timeout_ms > 0
            ? *default_timeout_ms
            : 0.0;
    if (static_cast<double>(options.ttl_ms) <= deadline + static_cast<double>(options.lease_ms)) {
        return "idempotency.ttl_ms (" + std::to_string(options.ttl_ms) +
               ") must be greater than the default deadline (" + detail::format_number(deadline) +
               ") plus lease_ms (" + std::to_string(options.lease_ms) +
               "), or a key could become new while its first call still runs";
    }
    return std::nullopt;
}

namespace {

Json idempotency_meta_details() {
    return Json{{"meta", std::string(afd_idempotency_key_meta_key)}};
}

} // namespace

CommandError idempotency_key_reused_error() {
    return create_error(error_codes::IDEMPOTENCY_KEY_REUSED,
                        "This idempotency key is already held for a call with another input",
                        {.suggestion = "Use a new idempotency key for a different call. Reuse a "
                                       "key only to repeat the same call with the same input.",
                         .retryable = false,
                         .recovery = Recovery{.kind = RecoveryKind::stop},
                         .details = idempotency_meta_details()});
}

CommandError idempotency_in_progress_error() {
    return create_error(
        error_codes::IDEMPOTENCY_IN_PROGRESS,
        "An earlier call with this idempotency key and input is still running",
        {.suggestion = "Repeat the call shortly with the same idempotency key: it then gets the "
                       "earlier call’s result.",
         .retryable = true,
         .recovery = Recovery{.kind = RecoveryKind::retry, .after_ms = 1000},
         .details = idempotency_meta_details()});
}

CommandError idempotency_outcome_unknown_error() {
    return create_error(error_codes::OUTCOME_UNKNOWN,
                        "An earlier call with this idempotency key and input started, and nobody "
                        "can say whether it was applied",
                        {.suggestion = "Check whether the change was made. If the call is still "
                                       "wanted, send it with a new idempotency key.",
                         .retryable = false,
                         .recovery = Recovery{.kind = RecoveryKind::external},
                         .details = idempotency_meta_details()});
}

} // namespace afd

namespace afd::detail {

// --- the key ------------------------------------------------------------------------------

CallIdempotencyKey resolve_idempotency_key(const CommandContext& context) {
    if (!context.idempotency_key) {
        return {};
    }
    const std::string& raw = *context.idempotency_key;
    if (const auto& mark = context.idempotency_key_mark; mark && mark->key == raw) {
        if (mark->delivered) {
            return {};
        }
        return {.kind = CallIdempotencyKey::Kind::key, .key = raw, .set_by_engine = true};
    }
    if (is_idempotency_key(raw)) {
        return {.kind = CallIdempotencyKey::Kind::key, .key = raw, .set_by_engine = false};
    }
    return {.kind = CallIdempotencyKey::Kind::invalid, .key = {}, .set_by_engine = false};
}

void deliver_idempotency_key(CommandContext& context, const CallIdempotencyKey& key) {
    if (key.kind != CallIdempotencyKey::Kind::key) {
        context.idempotency_key.reset();
        context.idempotency_key_mark.reset();
        return;
    }
    context.idempotency_key = key.key;
    context.idempotency_key_mark =
        std::make_shared<const IdempotencyKeyMark>(IdempotencyKeyMark{key.key, true});
}

void set_engine_idempotency_key(CommandContext& context, const std::optional<std::string>& key) {
    if (!key) {
        context.idempotency_key.reset();
        context.idempotency_key_mark.reset();
        return;
    }
    context.idempotency_key = *key;
    context.idempotency_key_mark =
        std::make_shared<const IdempotencyKeyMark>(IdempotencyKeyMark{*key, false});
}

void derive_item_idempotency_key(const CommandContext& request, CommandContext& item,
                                 IdempotencyRequestKind kind, std::size_t index) {
    const CallIdempotencyKey key = resolve_idempotency_key(request);
    switch (key.kind) {
    case CallIdempotencyKey::Kind::invalid:
        // Unchanged, so the item fails K2 at its engine.
        return;
    case CallIdempotencyKey::Kind::none:
        if (item.idempotency_key || item.idempotency_key_mark) {
            set_engine_idempotency_key(item, std::nullopt);
        }
        return;
    case CallIdempotencyKey::Kind::key:
        set_engine_idempotency_key(item, derive_idempotency_key(key.key, kind, index));
        return;
    }
}

// --- the step -----------------------------------------------------------------------------

std::optional<std::string> idempotency_digest(const Json& fields, const Json& input) {
    const auto canonical = canonical_json(Json{{"context", fields}, {"input", input}});
    if (!canonical) {
        return std::nullopt;
    }
    return base64url_encode(sha256(*canonical));
}

CommandError input_not_canonical_error(std::string_view command) {
    return create_error(
        error_codes::VALIDATION_ERROR,
        "The input of '" + truncate_name(command) +
            "' has no canonical JSON form, so an idempotency key cannot cover it",
        {.suggestion = "Send plain JSON input (no bigint, Map, Set, class instance or non-finite "
                       "number), or call without an idempotency key.",
         .retryable = false,
         .details = Json{{"meta", std::string(afd_idempotency_key_meta_key)},
                         {"reason", "input-not-canonical"}}});
}

CommandError internal_principal_error() {
    return create_error(
        error_codes::INTERNAL_ERROR, "Internal error",
        {.suggestion = "Nothing ran. Tell the server’s operator; calling again will not help.",
         .retryable = false});
}

namespace {

// Whether the call names a principal of its own: verified credentials, or an actor other than
// the server's default (a bare agent, or none).
bool has_own_identity(const CommandContext& context) {
    return context.credentials.has_value() ||
           (context.actor && (context.actor->kind != ActorKind::agent || context.actor->id ||
                              context.actor->on_behalf_of));
}

} // namespace

std::optional<std::string> idempotency_principal(const CommandContext& context) {
    // A stdio caller with no identity of its own, as middleware left it: its keys are its
    // connection's alone (S3).
    if (context.idempotency_connection && !has_own_identity(context)) {
        auto bound = canonical_json(Json{{"connection", context.idempotency_connection->id}});
        return bound ? std::optional<std::string>(std::move(*bound)) : std::nullopt;
    }
    // M8's binding: the actor's kind, id and onBehalfOf (never its label), and the verified
    // credentials' issuer, subject and client id. Credentials M8 cannot bind fail the call (S3).
    auto bound = detail::principal_binding(context.actor, context.credentials);
    return bound ? std::optional<std::string>(std::move(*bound)) : std::nullopt;
}

std::optional<std::string> idempotency_scope(std::string_view principal, std::string_view command,
                                             std::string_view key) {
    auto scope = canonical_json(Json{{"command", std::string(command)},
                                     {"key", std::string(key)},
                                     {"principal", std::string(principal)}});
    return scope ? std::optional<std::string>(std::move(*scope)) : std::nullopt;
}

CommandResult without_replay_marker(CommandResult result) {
    if (result.metadata && result.metadata->extra.is_object()) {
        result.metadata->extra.erase("idempotentReplay");
    }
    return result;
}

namespace {

CommandResult step_cancelled_before_start(std::string_view name) {
    return failure(
        create_error(error_codes::COMMAND_CANCELLED,
                     "Command '" + truncate_name(name) + "' was cancelled before it started",
                     {.suggestion = "Retry with a fresh signal if the command is still needed.",
                      .retryable = false}));
}

/// The answer for a call whose scope `record` holds (S5).
CommandResult idempotency_answer_for(const IdempotencyRecord& record, const std::string& digest,
                                     std::int64_t now) {
    if (record.digest != digest) {
        return failure(idempotency_key_reused_error());
    }
    if (record.state == IdempotencyState::stored && record.result) {
        CommandResult replayed = *record.result;
        ResultMetadata metadata = replayed.metadata.value_or(ResultMetadata{});
        if (!metadata.extra.is_object()) {
            metadata.extra = Json::object();
        }
        metadata.extra["idempotentReplay"] = true;
        replayed.metadata = std::move(metadata);
        return replayed;
    }
    if (record.state == IdempotencyState::reserved && now <= record.lease_ends_at) {
        return failure(idempotency_in_progress_error());
    }
    return failure(idempotency_outcome_unknown_error());
}

/// Settles `reservation` from the handler's `result` (S6), or as never settled without one.
void idempotency_settle(IdempotencyStore& store, const std::string& scope,
                        const std::string& reservation,
                        const std::optional<CommandResult>& result) {
    if (!result) {
        store.complete(scope, reservation, IdempotencySettlement{});
        return;
    }
    const CommandError* error = !result->success && result->error ? &*result->error : nullptr;
    if (error && error->code == error_codes::TIMEOUT) {
        // "May still have run" (spec/error-codes.md): nobody can say.
        store.complete(scope, reservation, IdempotencySettlement{});
    } else if (error && error->retryable == true) {
        // A keyed command that returns a retryable failure promises nothing was applied.
        store.release(scope, reservation);
    } else {
        store.complete(scope, reservation, IdempotencySettlement{.result = *result});
    }
}

/// `settle`, with a store's failure reported instead of replacing the handler's result.
void idempotency_settle_reporting(const IdempotencyRun& run, const std::string& scope,
                                  const std::string& reservation,
                                  const std::optional<CommandResult>& result) {
#if AFD_HAS_EXCEPTIONS
    try {
        idempotency_settle(*run.step.store, scope, reservation, result);
    } catch (const std::exception& error) {
        // The handler's result stands: a store that failed to keep it leaves the reservation to
        // its lease (S7), after which a repeat is told the outcome is unknown.
        run.report_error(error.what());
    } catch (...) {
        run.report_error("unknown exception from the idempotency store");
    }
#else
    idempotency_settle(*run.step.store, scope, reservation, result);
#endif
}

} // namespace

CommandResult run_idempotency_step(const std::optional<PreparedIdempotencyCall>& call,
                                   const IdempotencyRun& run) {
    if (!call) {
        return without_replay_marker(run.handler());
    }
    // The scope of the principal as middleware left it (S3, K5): an auth middleware may have set
    // the actor.
    const auto principal = idempotency_principal(run.context);
    const auto scope =
        principal ? idempotency_scope(*principal, call->command, call->key) : std::nullopt;
    if (!scope) {
        return failure(internal_principal_error());
    }
    const std::int64_t now = run.clock.wall_ms();
    std::int64_t lease_from = now;
    if (call->timeout_ms) {
        lease_from = run.started_at + static_cast<std::int64_t>(std::ceil(*call->timeout_ms));
    }
    IdempotencyReserveOutcome outcome =
        run.step.store->reserve(*scope,
                                {.digest = call->digest,
                                 .reserved_at = now,
                                 .expires_at = now + run.step.ttl_ms,
                                 .lease_ends_at = lease_from + run.step.lease_ms},
                                now);
    if (!outcome.reserved) {
        if (!outcome.record) {
            // A store that reports neither: nobody can say what holds the key.
            return failure(idempotency_outcome_unknown_error());
        }
        return idempotency_answer_for(*outcome.record, call->digest, now);
    }
    const std::string reservation = std::move(outcome.reservation);
    if (run.on_reserved) {
        run.on_reserved();
    }
    // The cancellation check again, now the key is held (S5): nothing ran, so nothing is kept.
    if (run.context.cancellation.is_cancelled()) {
#if AFD_HAS_EXCEPTIONS
        try {
            run.step.store->release(*scope, reservation);
        } catch (const std::exception& error) {
            run.report_error(error.what());
        } catch (...) {
            run.report_error("unknown exception from the idempotency store");
        }
#else
        run.step.store->release(*scope, reservation);
#endif
        return step_cancelled_before_start(call->command);
    }
    CommandResult result;
#if AFD_HAS_EXCEPTIONS
    try {
        result = without_replay_marker(run.handler());
    } catch (...) {
        // A handler that throws: nobody can say whether it was applied (S6).
        idempotency_settle_reporting(run, *scope, reservation, std::nullopt);
        throw;
    }
#else
    result = without_replay_marker(run.handler());
#endif
    idempotency_settle_reporting(run, *scope, reservation, result);
    return result;
}

// --- afd::mcp_stdio's part ------------------------------------------------------------------

std::shared_ptr<const IdempotencyConnection> new_idempotency_connection() {
    auto connection = std::make_shared<IdempotencyConnection>();
    if (auto id = new_dispatch_id({})) {
        connection->id = std::move(*id);
    } else {
        connection->id =
            "local-" + std::to_string(reinterpret_cast<std::uintptr_t>(connection.get()));
    }
    return connection;
}

void apply_stdio_idempotency(CommandContext& context, const Json& meta,
                             const std::shared_ptr<const IdempotencyConnection>& connection) {
    // The connection tells apart a caller with no identity of its own (S3). Whether the call has
    // one is decided when the step runs, after middleware (an auth middleware may set the actor
    // or credentials), so the connection is always noted here.
    context.idempotency_connection = connection;
    context.idempotency_key_mark.reset();
    // Where the registry notes that the step reserved the key, for this call's TIMEOUT (R3).
    context.idempotency_note = std::make_shared<IdempotencyNote>();
    if (!context.idempotency_key && meta.is_object()) {
        const auto sent = meta.find(std::string(afd_idempotency_key_meta_key));
        if (sent != meta.end() && sent->is_string()) {
            context.idempotency_key = sent->get<std::string>();
        }
    }
}

bool stdio_idempotency_refused(const CommandContext& context, const Json& meta) {
    if (context.idempotency_key) {
        return resolve_idempotency_key(context).kind == CallIdempotencyKey::Kind::invalid;
    }
    if (!meta.is_object()) {
        return false;
    }
    const auto sent = meta.find(std::string(afd_idempotency_key_meta_key));
    return sent != meta.end() && !sent->is_null() && !sent->is_string();
}

std::optional<std::string> check_stdio_idempotency(const CommandRegistry& registry,
                                                   std::optional<double> default_timeout_ms) {
    const auto& options = registry.idempotency();
    return options ? check_idempotency_options(*options, default_timeout_ms) : std::nullopt;
}

CommandResult timed_out(std::string_view name, double timeout_ms, const CommandContext& context) {
    const bool keyed = context.idempotency_note && context.idempotency_note->step_acted.load();
    return command_timed_out(name, timeout_ms, keyed);
}

} // namespace afd::detail

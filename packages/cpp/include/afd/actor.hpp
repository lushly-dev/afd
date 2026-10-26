// The principal behind a command call (packages/core/src/actor.ts).
#pragma once

#include "afd/expected.hpp"
#include "afd/json.hpp"

#include <array>
#include <optional>
#include <string>
#include <string_view>

namespace afd {

/// What kind of principal is calling: a person, an AI agent, a service, a script or a test.
/// Wire values are the enumerator names.
enum class ActorKind { human, agent, service, script, test };

/// Every `ActorKind`, in wire order. TypeScript's `ACTOR_KINDS`.
inline constexpr std::array<ActorKind, 5> actor_kinds = {
    ActorKind::human, ActorKind::agent, ActorKind::service, ActorKind::script, ActorKind::test};

/// Who is calling a command.
///
/// Surfaces fill in `kind`: `DirectClient` defaults to `human`, and an MCP server should use
/// `agent`. Middleware and handlers read `context.actor` to key trust, approval, rate-limit or data
/// rules on it; afd itself only reports `kind` (as `metadata.actorKind`), never the id.
struct Actor {
    ActorKind kind = ActorKind::human;
    /// Stable identifier within the application, e.g. a user ID.
    std::optional<std::string> id;
    /// Display name, e.g. "Claude (advisor)".
    std::optional<std::string> label;
    /// The human an agent or service is acting for.
    std::optional<std::string> on_behalf_of;

    static Expected<Actor> from_json(const Json& value);
};

/// The wire name of `kind`: `human`, `agent`, `service`, `script` or `test`.
std::string_view actor_kind_name(ActorKind kind) noexcept;

/// The kind named `name`, or `std::nullopt` if it names none.
std::optional<ActorKind> parse_actor_kind(std::string_view name) noexcept;

/// Whether `value` is the wire name of an `ActorKind`.
bool is_actor_kind(const Json& value) noexcept;

/// Whether `value` is a well-formed actor: an object with a valid `kind` and string `id`, `label`
/// and `onBehalfOf` when present. Other members are allowed.
bool is_actor(const Json& value) noexcept;

void to_json(Json& out, ActorKind kind);
void to_json(Json& out, const Actor& actor);

} // namespace afd

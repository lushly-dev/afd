#include "afd/actor.hpp"

#include "detail/json_io.hpp"

namespace afd {
namespace {

bool is_optional_string(const Json& actor, const char* key) {
    const auto it = actor.find(key);
    return it == actor.end() || it->is_string();
}

} // namespace

std::string_view actor_kind_name(ActorKind kind) noexcept {
    switch (kind) {
    case ActorKind::human:
        return "human";
    case ActorKind::agent:
        return "agent";
    case ActorKind::service:
        return "service";
    case ActorKind::script:
        return "script";
    case ActorKind::test:
        return "test";
    }
    return "human";
}

std::optional<ActorKind> parse_actor_kind(std::string_view name) noexcept {
    for (const ActorKind kind : actor_kinds) {
        if (actor_kind_name(kind) == name) {
            return kind;
        }
    }
    return std::nullopt;
}

bool is_actor_kind(const Json& value) noexcept {
    return value.is_string() && parse_actor_kind(value.get_ref<const std::string&>()).has_value();
}

bool is_actor(const Json& value) noexcept {
    if (!value.is_object()) {
        return false;
    }
    const auto kind = value.find("kind");
    return kind != value.end() && is_actor_kind(*kind) && is_optional_string(value, "id") &&
           is_optional_string(value, "label") && is_optional_string(value, "onBehalfOf");
}

namespace detail {

bool read_value(const Json& value, const std::string& path, ActorKind& out, std::string& error) {
    std::string name;
    if (!read_value(value, path, name, error)) {
        return false;
    }
    if (const auto kind = parse_actor_kind(name)) {
        out = *kind;
        return true;
    }
    record(error, path, "unknown value '" + name + "'");
    return false;
}

bool read_value(const Json& value, const std::string& path, Actor& out, std::string& error) {
    ObjectReader reader(value, path, error);
    reader.required("kind", out.kind);
    reader.optional("id", out.id);
    reader.optional("label", out.label);
    reader.optional("onBehalfOf", out.on_behalf_of);
    return reader.ok();
}

} // namespace detail

Expected<Actor> Actor::from_json(const Json& value) {
    return detail::parse_document<Actor>(value);
}

void to_json(Json& out, ActorKind kind) {
    out = std::string(actor_kind_name(kind));
}

void to_json(Json& out, const Actor& actor) {
    out = Json::object();
    out["kind"] = actor.kind;
    detail::put(out, "id", actor.id);
    detail::put(out, "label", actor.label);
    detail::put(out, "onBehalfOf", actor.on_behalf_of);
}

} // namespace afd

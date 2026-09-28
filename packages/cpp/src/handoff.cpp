#include "afd/handoff.hpp"

#include <algorithm>

#include "detail/json_io.hpp"

namespace afd {
namespace {

bool optional_is(const Json& object, const char* key, bool (Json::*check)() const noexcept) {
    const auto it = object.find(key);
    return it == object.end() || ((*it).*check)();
}

bool read_policy(const Json& value, const std::string& path, ReconnectPolicy& out,
                 std::string& error) {
    detail::ObjectReader reader(value, path, error);
    reader.required("allowed", out.allowed);
    reader.optional("maxAttempts", out.max_attempts);
    reader.optional("backoffMs", out.backoff_ms);
    return reader.ok();
}

bool read_credentials(const Json& value, const std::string& path, HandoffCredentials& out,
                      std::string& error) {
    detail::ObjectReader reader(value, path, error);
    reader.optional("token", out.token);
    reader.optional("sessionId", out.session_id);
    std::optional<Json> headers;
    reader.optional_object("headers", headers);
    if (headers) {
        std::map<std::string, std::string> parsed;
        for (auto it = headers->begin(); it != headers->end(); ++it) {
            if (!it.value().is_string()) {
                detail::record(error,
                               detail::child_path(detail::child_path(path, "headers"), it.key()),
                               "expected a string");
                return false;
            }
            parsed[it.key()] = it.value().get<std::string>();
        }
        out.headers = std::move(parsed);
    }
    return reader.ok();
}

bool read_metadata(const Json& value, const std::string& path, HandoffMetadata& out,
                   std::string& error) {
    detail::ObjectReader reader(value, path, error);
    reader.optional("expectedLatency", out.expected_latency);
    reader.optional("capabilities", out.capabilities);
    reader.optional("expiresAt", out.expires_at);
    reader.optional("description", out.description);
    if (const auto it = value.find("reconnect");
        reader.ok() && it != value.end() && !it->is_null()) {
        ReconnectPolicy policy;
        if (!read_policy(*it, detail::child_path(path, "reconnect"), policy, error)) {
            return false;
        }
        out.reconnect = policy;
    }
    return reader.ok();
}

} // namespace

ReconnectPolicy default_reconnect_policy() {
    return {.allowed = true, .max_attempts = 3, .backoff_ms = 1000};
}

Expected<HandoffResult> HandoffResult::from_json(const Json& value) {
    std::string error;
    HandoffResult out;
    detail::ObjectReader reader(value, "", error);
    reader.required("protocol", out.protocol);
    reader.required("endpoint", out.endpoint);
    if (reader.ok()) {
        if (const auto it = value.find("credentials"); it != value.end() && !it->is_null()) {
            HandoffCredentials credentials;
            if (read_credentials(*it, "credentials", credentials, error)) {
                out.credentials = std::move(credentials);
            }
        }
    }
    if (error.empty()) {
        if (const auto it = value.find("metadata"); it != value.end() && !it->is_null()) {
            HandoffMetadata metadata;
            if (read_metadata(*it, "metadata", metadata, error)) {
                out.metadata = std::move(metadata);
            }
        }
    }
    if (!error.empty()) {
        return unexpected(error);
    }
    return out;
}

HandoffResult create_handoff(CreateHandoffOptions options) {
    HandoffResult handoff;
    handoff.protocol = std::move(options.protocol);
    handoff.endpoint = std::move(options.endpoint);
    handoff.credentials = std::move(options.credentials);
    HandoffMetadata metadata = options.metadata.value_or(HandoffMetadata{});
    if (!metadata.reconnect) {
        metadata.reconnect = default_reconnect_policy();
    }
    handoff.metadata = std::move(metadata);
    return handoff;
}

bool is_reconnect_policy(const Json& value) {
    if (!value.is_object()) {
        return false;
    }
    const auto allowed = value.find("allowed");
    return allowed != value.end() && allowed->is_boolean() &&
           optional_is(value, "maxAttempts", &Json::is_number) &&
           optional_is(value, "backoffMs", &Json::is_number);
}

bool is_handoff(const Json& value) {
    if (!value.is_object()) {
        return false;
    }
    const auto non_empty_string = [&](const char* key) {
        const auto it = value.find(key);
        return it != value.end() && it->is_string() && !it->get_ref<const std::string&>().empty();
    };
    if (!non_empty_string("protocol") || !non_empty_string("endpoint")) {
        return false;
    }
    if (const auto credentials = value.find("credentials"); credentials != value.end()) {
        if (!credentials->is_object() || !optional_is(*credentials, "token", &Json::is_string) ||
            !optional_is(*credentials, "sessionId", &Json::is_string) ||
            !optional_is(*credentials, "headers", &Json::is_object)) {
            return false;
        }
    }
    if (const auto metadata = value.find("metadata"); metadata != value.end()) {
        if (!metadata->is_object() ||
            !optional_is(*metadata, "expectedLatency", &Json::is_number) ||
            !optional_is(*metadata, "capabilities", &Json::is_array) ||
            !optional_is(*metadata, "expiresAt", &Json::is_string) ||
            !optional_is(*metadata, "description", &Json::is_string)) {
            return false;
        }
        if (const auto reconnect = metadata->find("reconnect");
            reconnect != metadata->end() && !is_reconnect_policy(*reconnect)) {
            return false;
        }
    }
    return true;
}

bool is_handoff_protocol(const HandoffResult& handoff, const HandoffProtocol& protocol) {
    return handoff.protocol == protocol;
}

bool is_handoff_command(const CommandDefinition& command) {
    return command.handoff ||
           std::find(command.tags.begin(), command.tags.end(), "handoff") != command.tags.end();
}

std::optional<HandoffProtocol> get_handoff_protocol(const CommandDefinition& command) {
    if (!is_handoff_command(command)) {
        return std::nullopt;
    }
    if (command.handoff_protocol && !command.handoff_protocol->empty()) {
        return command.handoff_protocol;
    }
    for (const auto& tag : command.tags) {
        if (tag.rfind("handoff:", 0) == 0) {
            return tag.substr(8);
        }
    }
    return std::nullopt;
}

void to_json(Json& out, const ReconnectPolicy& policy) {
    out = Json::object();
    out["allowed"] = policy.allowed;
    detail::put(out, "maxAttempts", policy.max_attempts);
    detail::put(out, "backoffMs", policy.backoff_ms);
}

void to_json(Json& out, const HandoffCredentials& credentials) {
    out = Json::object();
    detail::put(out, "token", credentials.token);
    if (credentials.headers) {
        out["headers"] = *credentials.headers;
    }
    detail::put(out, "sessionId", credentials.session_id);
}

void to_json(Json& out, const HandoffMetadata& metadata) {
    out = Json::object();
    detail::put(out, "expectedLatency", metadata.expected_latency);
    detail::put(out, "capabilities", metadata.capabilities);
    detail::put(out, "expiresAt", metadata.expires_at);
    detail::put(out, "reconnect", metadata.reconnect);
    detail::put(out, "description", metadata.description);
}

void to_json(Json& out, const HandoffResult& handoff) {
    out = Json::object();
    out["protocol"] = handoff.protocol;
    out["endpoint"] = handoff.endpoint;
    detail::put(out, "credentials", handoff.credentials);
    detail::put(out, "metadata", handoff.metadata);
}

} // namespace afd

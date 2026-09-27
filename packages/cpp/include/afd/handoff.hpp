// Handoff: a command that hands the caller a real-time channel (WebSocket, WebRTC, SSE, …)
// instead of a final result (packages/core/src/handoff.ts).
#pragma once

#include "afd/command.hpp"
#include "afd/expected.hpp"
#include "afd/json.hpp"

#include <cstdint>
#include <map>
#include <optional>
#include <string>
#include <vector>

namespace afd {

/// The channel's protocol: "websocket", "webrtc", "sse", "http-stream", or any other name.
using HandoffProtocol = std::string;

/// Whether and how the client may reconnect.
struct ReconnectPolicy {
    bool allowed = true;
    std::optional<double> max_attempts;
    std::optional<double> backoff_ms;
};

/// `{allowed: true, maxAttempts: 3, backoffMs: 1000}`.
ReconnectPolicy default_reconnect_policy();

/// How to authenticate on the channel.
struct HandoffCredentials {
    std::optional<std::string> token;
    std::optional<std::map<std::string, std::string>> headers;
    std::optional<std::string> session_id;
};

struct HandoffMetadata {
    std::optional<double> expected_latency;
    std::optional<std::vector<std::string>> capabilities;
    /// ISO 8601.
    std::optional<std::string> expires_at;
    std::optional<ReconnectPolicy> reconnect;
    std::optional<std::string> description;
};

/// The `data` of a handoff command's result.
struct HandoffResult {
    HandoffProtocol protocol;
    std::string endpoint;
    std::optional<HandoffCredentials> credentials;
    std::optional<HandoffMetadata> metadata;

    static Expected<HandoffResult> from_json(const Json& value);
};

struct CreateHandoffOptions {
    HandoffProtocol protocol;
    std::string endpoint;
    std::optional<HandoffCredentials> credentials;
    std::optional<HandoffMetadata> metadata;
};

/// A handoff result whose metadata always carries a reconnect policy (the default if unset).
HandoffResult create_handoff(CreateHandoffOptions options);

/// Whether `value` has the shape of a ReconnectPolicy.
bool is_reconnect_policy(const Json& value);

/// Whether `value` has the shape of a HandoffResult: non-empty `protocol` and `endpoint`, and
/// correctly typed optional credentials and metadata.
bool is_handoff(const Json& value);

bool is_handoff_protocol(const HandoffResult& handoff, const HandoffProtocol& protocol);

/// Whether a command is a handoff command: `handoff` is set, or its tags include "handoff".
bool is_handoff_command(const CommandDefinition& command);

/// The command's handoff protocol: `handoff_protocol`, else a `handoff:<protocol>` tag.
std::optional<HandoffProtocol> get_handoff_protocol(const CommandDefinition& command);

void to_json(Json& out, const ReconnectPolicy& policy);
void to_json(Json& out, const HandoffCredentials& credentials);
void to_json(Json& out, const HandoffMetadata& metadata);
void to_json(Json& out, const HandoffResult& handoff);

} // namespace afd

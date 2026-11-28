// Private: approval evidence from an approver client (spec/approvals.md, "Approval evidence from
// an approver client"; Loam phase 5, step 0c) and the principal binding (spec/authorization.md,
// M8). Shared between `afd::create_approval_middleware` and `afd::mcp::StdioServer`. Not installed.
#pragma once

#include "afd/actor.hpp"
#include "afd/approval.hpp"
#include "afd/command.hpp"
#include "afd/errors.hpp"
#include "afd/expected.hpp"
#include "afd/json.hpp"

#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "detail/exceptions.hpp"

namespace afd::detail {

inline constexpr std::string_view approver_meta_key = "dev.afd/approval";

/// An approver client's call state, attached to `CommandContext::approver_call` by the MCP server
/// only. Its carried evidence is taken once by the first approval middleware pass, so a command
/// invoked in process by the handler never sees it.
class ApproverCall {
public:
    explicit ApproverCall(std::optional<Json> evidence = std::nullopt)
        : evidence_(std::move(evidence)) {}

    /// Takes the carried evidence once.
    std::optional<Json> take_evidence() {
        const std::lock_guard lock(mutex_);
        auto out = std::move(evidence_);
        evidence_.reset();
        return out;
    }

private:
    std::mutex mutex_;
    std::optional<Json> evidence_;
};

/// Canonical JSON object for `actor`, or `null` when absent.
inline Json actor_binding_json(const std::optional<Actor>& actor) {
    if (!actor) {
        return nullptr;
    }
    Json actor_json = Json::object();
    actor_json["kind"] = std::string(actor_kind_name(actor->kind));
    if (actor->id) {
        actor_json["id"] = *actor->id;
    }
    if (actor->on_behalf_of) {
        actor_json["onBehalfOf"] = *actor->on_behalf_of;
    }
    return actor_json;
}

/// A call's principal binding (spec/authorization.md, M8): the canonical JSON of
/// `{"actor": ..., "credentials": ...}`. Fails when `credentials` is set but lacks a non-empty
/// `issuer`, `subject` or `client_id`. The error message names no one.
inline Expected<std::string>
principal_binding(const std::optional<Actor>& actor,
                  const std::optional<PrincipalCredentials>& credentials) {
    Json actor_json = actor_binding_json(actor);
    Json creds_json = nullptr;
    if (credentials) {
        if (credentials->issuer.empty() || credentials->subject.empty() ||
            credentials->client_id.empty()) {
            return unexpected(std::string("credentials lack an issuer, subject or client id"));
        }
        creds_json = Json{{"issuer", credentials->issuer},
                          {"subject", credentials->subject},
                          {"clientId", credentials->client_id}};
    }
    return canonical_json(
        Json{{"actor", std::move(actor_json)}, {"credentials", std::move(creds_json)}});
}

/// Rule 5: refuses tool arguments holding the key `dev.afd/approval` at any depth, from any
/// caller. Iterative so deeply nested inputs cannot overflow the call stack.
inline std::optional<CommandError> approval_key_in_input(const Json& input) {
    std::vector<const Json*> pending{&input};
    while (!pending.empty()) {
        const Json* node = pending.back();
        pending.pop_back();
        if (node->is_array()) {
            for (const auto& item : *node) {
                pending.push_back(&item);
            }
        } else if (node->is_object()) {
            if (node->contains(std::string(approver_meta_key))) {
                return CommandError{
                    .code = error_codes::VALIDATION_ERROR,
                    .message =
                        "Input may not hold the key \"" + std::string(approver_meta_key) + "\"",
                    .suggestion = "Remove \"" + std::string(approver_meta_key) +
                                  "\" from the input: approval evidence is never input. Only a "
                                  "client the server names an approver sends it, in _meta, on the "
                                  "retry a person approved.",
                    .retryable = false,
                    .recovery = std::nullopt,
                    .details = std::nullopt,
                    .cause = nullptr,
                };
            }
            for (auto it = node->begin(); it != node->end(); ++it) {
                pending.push_back(&it.value());
            }
        }
    }
    return std::nullopt;
}

/// Rule 5 check on `tools/call` params: returns `VALIDATION_ERROR` if `arguments` holds
/// `dev.afd/approval` at any depth.
inline std::optional<CommandError> approval_key_in_params(const Json& params) {
    if (!params.is_object()) {
        return std::nullopt;
    }
    const auto it = params.find("arguments");
    if (it == params.end() || it->is_null()) {
        return std::nullopt;
    }
    return approval_key_in_input(*it);
}

/// Outcome of evaluating `StdioServerOptions::approver` for one `tools/call`.
struct ApproverResolution {
    bool internal_error = false;
    std::optional<CommandError> refusal;
};

/// Rules 1 to 3 for `afd::mcp::StdioServer`: runs `approver(context)`, validates M8 principal
/// binding, refuses carried keys on 2025/`afd-batch`/`afd-pipe`, and attaches `approver_call`.
inline ApproverResolution
resolve_stdio_approver(const std::function<bool(const CommandContext&)>& approver,
                       CommandContext& context, const Json& raw_meta, std::string_view tool_name,
                       bool modern) {
    if (!approver) {
        return {};
    }
    bool is_approver = false;
#if AFD_HAS_EXCEPTIONS
    try {
        is_approver = approver(context);
    } catch (...) {
        return {.internal_error = true, .refusal = std::nullopt};
    }
#else
    is_approver = approver(context);
#endif
    if (!is_approver) {
        return {};
    }
    if (!principal_binding(context.actor, context.credentials)) {
        return {.internal_error = true, .refusal = std::nullopt};
    }
    const auto carried_it =
        raw_meta.is_object() ? raw_meta.find(std::string(approver_meta_key)) : raw_meta.end();
    const bool carried =
        raw_meta.is_object() && carried_it != raw_meta.end() && !carried_it->is_null();
    if (carried && (!modern || tool_name == "afd-batch" || tool_name == "afd-pipe")) {
        return {
            .internal_error = false,
            .refusal =
                CommandError{
                    .code = error_codes::APPROVAL_REQUIRED,
                    .message = "_meta[\"" + std::string(approver_meta_key) +
                               "\"] is accepted only on a call to one command from an MCP "
                               "2026-07-28 client",
                    .suggestion =
                        "Retry the approved command on its own (its tool or afd-call) from "
                        "an MCP 2026-07-28 client, with the same input and the token; "
                        "nothing ran.",
                    .retryable = false,
                    .recovery = std::nullopt,
                    .details = std::nullopt,
                    .cause = nullptr,
                },
        };
    }
    context.approver_call =
        std::make_shared<ApproverCall>(carried ? std::optional<Json>(*carried_it) : std::nullopt);
    return {};
}

/// Associated-data array for `requestState` binding (actor + optional credentials + call).
inline Json state_binding_array(std::string_view version, const CommandContext& context,
                                std::string_view command, const Json& input) {
    Json parts = Json::array({std::string(version), actor_binding_json(context.actor)});
    if (context.credentials) {
        parts.push_back(Json{{"issuer", context.credentials->issuer},
                             {"subject", context.credentials->subject},
                             {"clientId", context.credentials->client_id}});
    }
    parts.push_back(Json::array({std::string(command), input}));
    return parts;
}

} // namespace afd::detail

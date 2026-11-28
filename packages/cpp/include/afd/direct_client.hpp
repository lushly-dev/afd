// In-process execution for co-located agents: the DirectClient equivalent
// (packages/client/src/direct.ts over packages/server/src/direct-registry.ts).
#pragma once

#include "afd/command.hpp"
#include "afd/pipeline.hpp"
#include "afd/registry.hpp"
#include "afd/result.hpp"
#include "afd/runtime.hpp"

#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace afd {

/// Public decision metadata; credentials stay in the private per-call exchange.
struct DirectApprovalRequest {
    std::string command;
    Json input;
    std::string summary;
    std::string expires_at;
    std::optional<std::string> reason;
    CancellationToken cancellation;
    /// The `approval_id` the summary of this call carries once approved
    /// (spec/command-metadata.md, "The approval summary", rule 5; `afd::approval_id` of the held
    /// token's nonce). Not a credential.
    std::string approval_id;
};

struct DirectClientOptions {
    /// The surface calls come through. Only commands exposed to it are visible. Default: agent.
    /// `Interface::apps` is not served by `DirectClient` (its `allow`, `UNKNOWN_TOOL` and client
    /// middleware would answer before `call_grant`): call `CommandRegistry::execute` directly for
    /// app-to-app calls.
    Interface surface = Interface::agent;
    /// Further restricts which commands this client may call.
    std::function<bool(std::string_view name)> allow;
    /// Client-side middleware, run around the registry's own chain. Approval middleware belongs
    /// on the registry: here it admits nothing, and a gated call fails with `no-approval-step`.
    std::vector<CommandMiddleware> middleware;
    /// The actor for calls whose context has none. Each call gets its own copy.
    Actor actor{.kind = ActorKind::human};
    /// Copied into `context.extra["source"]` on every call when set.
    std::optional<std::string> source;
    /// For trace IDs and timeouts. Defaults to `SystemClock` and a `SystemRandom`. When set, they
    /// are also `context.clock` and `context.random` for calls whose context has none; otherwise
    /// the registry's apply.
    std::shared_ptr<const Clock> clock;
    std::shared_ptr<RandomSource> random;
    /// Trusted host hook. A true answer permits exactly one verified retry.
    std::function<bool(const DirectApprovalRequest&)> on_approval_needed;
};

/// Calls commands on a registry in process, as an agent would through MCP, with the same
/// exposure rules and structured errors.
class DirectClient {
public:
    explicit DirectClient(std::shared_ptr<const CommandRegistry> registry,
                          DirectClientOptions options = {});

    /// Calls a command:
    ///
    /// 1. `allow` rejects: COMMAND_NOT_ALLOWED.
    /// 2. Unknown to this client: UNKNOWN_TOOL, with `data` listing the available commands and
    ///    close matches.
    /// 3. The context gets a trace ID (`trace-<ms>-<random>`) and this client's actor if it has
    ///    none, and this client's surface.
    /// 4. With a positive `context.timeout_ms`, the cancellation token carries the deadline, and a
    ///    call that finishes past it returns TIMEOUT. A synchronous handler is not interrupted.
    /// 5. Client middleware, then `CommandRegistry::execute`.
    ///
    /// To send an idempotency key (spec/idempotency.md, K1), set `context.idempotency_key`: the
    /// registry checks its form and delivers it to the handler, and a registry with the
    /// idempotency step answers a repeat of a `keyed` call from its store. A late finish whose key
    /// the step reserved gets a `TIMEOUT` with a `retry` recovery (R3); repeat it with the same
    /// key.
    [[nodiscard]] CommandResult call(std::string_view name, const Json& args = Json::object(),
                                     CommandContext context = {}) const;

    /// Runs a pipeline whose steps go through `call`, so every step gets this client's
    /// allow-list, exposure and timeouts. Steps get the trace ID `<trace>-step-<k>`, where `k`
    /// counts the calls actually made.
    [[nodiscard]] PipelineResult pipe(const PipelineRequest& request,
                                      CommandContext context = {}) const;
    [[nodiscard]] PipelineResult pipe(const Json& request, CommandContext context = {}) const;

    /// Names this client may call, in registration order.
    [[nodiscard]] std::vector<std::string> list_command_names() const;
    [[nodiscard]] bool has_command(std::string_view name) const;

private:
    [[nodiscard]] bool is_allowed(std::string_view name) const;

    std::shared_ptr<const CommandRegistry> registry_;
    DirectClientOptions options_;
    bool configured_clock_ = false;
    bool configured_random_ = false;
};

} // namespace afd

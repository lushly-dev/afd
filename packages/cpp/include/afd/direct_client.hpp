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

struct DirectClientOptions {
    /// The surface calls come through. Only commands exposed to it are visible. Default: agent.
    Interface surface = Interface::agent;
    /// Further restricts which commands this client may call.
    std::function<bool(std::string_view name)> allow;
    /// Client-side middleware, run around the registry's own chain.
    std::vector<CommandMiddleware> middleware;
    /// Copied into `context.extra["source"]` on every call when set.
    std::optional<std::string> source;
    /// For trace IDs and timeouts. Defaults to `SystemClock` and a randomly seeded `SeededRandom`.
    std::shared_ptr<const Clock> clock;
    std::shared_ptr<RandomSource> random;
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
    /// 3. The context gets a trace ID (`trace-<ms>-<random>`) if it has none, and this client's
    ///    surface.
    /// 4. With a positive `context.timeout_ms`, the cancellation token carries the deadline, and a
    ///    call that finishes past it returns TIMEOUT. A synchronous handler is not interrupted.
    /// 5. Client middleware, then `CommandRegistry::execute`.
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
};

} // namespace afd

// The command registry and single-command execution. Mirrors the TypeScript server engine
// (packages/server/src/execution.ts), which is the behavioral reference (proposal, "What the same
// AFD means").
#pragma once

#include "afd/command.hpp"
#include "afd/json.hpp"
#include "afd/result.hpp"
#include "afd/runtime.hpp"
#include "afd/schema.hpp"

#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <shared_mutex>
#include <string>
#include <string_view>
#include <vector>

namespace afd {

/// Names the MCP tool router handles itself; a command with one of these names is unreachable, so
/// registration rejects it.
inline constexpr std::string_view reserved_command_names[] = {"afd-call", "afd-batch", "afd-pipe",
                                                              "afd-discover", "afd-detail"};

struct RegistryOptions {
    /// Run around every execution, first entry outermost.
    std::vector<Middleware> middleware;
    /// Include exception messages in COMMAND_EXECUTION_ERROR results.
    bool dev_mode = false;
    /// Called after every execution that reached the middleware chain, with the raw input. Not
    /// called for lookup, exposure, context or validation failures, or for exceptions.
    std::function<void(std::string_view name, const Json& input, const CommandResult& result)>
        on_command;
    /// Receives exceptions from handlers and hooks.
    std::function<void(std::string_view message)> on_error;
    /// Times handlers. Defaults to `SystemClock`.
    std::shared_ptr<const Clock> clock;
};

/// A registered command.
struct RegisteredCommand {
    CommandDefinition definition;
    CompiledSchema input_schema;
};

/// Holds commands and executes them. Registration takes an exclusive lock; executions share it,
/// so one registry can serve several threads.
class CommandRegistry {
public:
    explicit CommandRegistry(RegistryOptions options = {});

    /// Registers `command`. Returns an error message, or `std::nullopt` on success. Rejects
    /// invalid and reserved names, duplicates, a missing handler, an unsupported input schema,
    /// and examples that fail the schema.
    [[nodiscard]] std::optional<std::string> register_command(CommandDefinition command);

    /// Adds middleware inside any already added.
    void use(Middleware middleware);

    [[nodiscard]] std::shared_ptr<const RegisteredCommand> get(std::string_view name) const;
    [[nodiscard]] bool has(std::string_view name) const;
    /// All commands, in registration order.
    [[nodiscard]] std::vector<std::shared_ptr<const RegisteredCommand>> list() const;
    [[nodiscard]] std::vector<std::shared_ptr<const RegisteredCommand>>
    list_by_category(std::string_view category) const;
    [[nodiscard]] std::vector<std::shared_ptr<const RegisteredCommand>>
    list_by_exposure(Interface surface) const;
    [[nodiscard]] std::vector<std::shared_ptr<const RegisteredCommand>>
    list_handoff_commands() const;

    /// Executes one command, in the TypeScript engine's order:
    ///
    /// 1. Lookup. An unknown name gives COMMAND_NOT_FOUND with up to three "did you mean"
    ///    matches; the name is never echoed untruncated.
    /// 2. Exposure, when `context.surface` is set: COMMAND_NOT_EXPOSED.
    /// 3. Context, when `context.active_context` is set: COMMAND_NOT_IN_CONTEXT.
    /// 4. Validation against the input schema: VALIDATION_ERROR.
    /// 5. Middleware, then the handler with the validated input.
    /// 6. The handler's result gets `metadata.executionTimeMs`, `commandVersion` and, when the
    ///    context has one after middleware ran, `traceId`.
    /// 7. `on_command`.
    ///
    /// An exception escaping the chain becomes COMMAND_EXECUTION_ERROR (builds with exceptions).
    [[nodiscard]] CommandResult execute(std::string_view name, const Json& input = Json::object(),
                                        CommandContext context = {}) const;

private:
    [[nodiscard]] CommandResult run_chain(const RegisteredCommand& command, const Json& input,
                                          CommandContext& context) const;
    void report_error(std::string_view message) const;

    RegistryOptions options_;
    mutable std::shared_mutex mutex_;
    std::map<std::string, std::shared_ptr<const RegisteredCommand>, std::less<>> commands_;
    std::vector<std::shared_ptr<const RegisteredCommand>> order_;
};

} // namespace afd

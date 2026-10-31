// The command registry and single-command execution. Mirrors the TypeScript server engine
// (packages/server/src/execution.ts), which is the behavioral reference (proposal, "What the same
// AFD means").
#pragma once

#include "afd/batch.hpp"
#include "afd/builtin_names.hpp"
#include "afd/command.hpp"
#include "afd/context_fields.hpp"
#include "afd/execution.hpp"
#include "afd/expected.hpp"
#include "afd/json.hpp"
#include "afd/pipeline.hpp"
#include "afd/result.hpp"
#include "afd/runtime.hpp"
#include "afd/schema.hpp"
#include "afd/streaming.hpp"

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
inline constexpr const auto& reserved_command_names = afd_meta_tool_names;

struct CommandRegistryOptions {
    /// Run around every execution, first entry outermost.
    std::vector<CommandMiddleware> middleware;
    /// Include exception messages in COMMAND_EXECUTION_ERROR results.
    bool dev_mode = false;
    /// Called after every execution that reached the middleware chain, with the raw input. Not
    /// called for lookup, exposure, context or validation failures, or for exceptions.
    std::function<void(std::string_view name, const Json& input, const CommandResult& result)>
        on_command;
    /// Receives exceptions from handlers and hooks.
    std::function<void(std::string_view message)> on_error;
    /// Times handlers, and drives batch, pipeline and stream deadlines. Defaults to `SystemClock`.
    std::shared_ptr<const Clock> clock;
    /// Runs batch workers. Defaults to `InlineTaskRunner` (no overlap). With `ThreadTaskRunner`,
    /// handlers run concurrently and must be thread-safe.
    std::shared_ptr<TaskRunner> runner;
    /// For generated pipeline IDs, and `context.random` when the caller set none. Defaults to a
    /// `SystemRandom`.
    std::shared_ptr<RandomSource> random;
    /// `context.actor` when the caller set none, e.g. `{.kind = ActorKind::agent}` for an MCP
    /// host. Default: none.
    std::optional<Actor> actor;
    /// Request values the host declares (spec/context-fields.md). A call sets each in
    /// `context.extra[name]`; it is validated before middleware runs, and an invalid value or a
    /// missing required one fails the call with VALIDATION_ERROR. The journal keeps the values
    /// of fields declared `journal`. Checked when the registry is created: use
    /// `CommandRegistry::create` to get the error.
    std::vector<ContextField> context_fields;
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
    /// A registry with `options`. Prefer `create` when declaring context fields: a registry
    /// constructed with an invalid declaration fails every call with INTERNAL_ERROR.
    explicit CommandRegistry(CommandRegistryOptions options = {});

    /// A registry with `options`, or why they are invalid. The error names the context field
    /// with an empty, reserved or repeated name, a `meta` key without a reverse-DNS prefix, with
    /// a reserved prefix or repeated, or an unsupported schema.
    [[nodiscard]] static Expected<std::shared_ptr<CommandRegistry>>
    create(CommandRegistryOptions options = {});

    /// Registers `command`. Returns an error message, or `std::nullopt` on success. Rejects
    /// invalid and reserved names, duplicates, a missing handler, an unsupported input schema,
    /// and examples that fail the schema.
    [[nodiscard]] std::optional<std::string> register_command(CommandDefinition command);

    /// Adds middleware inside any already added.
    void use(CommandMiddleware middleware);

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

    /// The declared context fields, so `replay_journal` can tell which recorded values still
    /// apply.
    [[nodiscard]] const std::vector<ContextField>& context_fields() const noexcept {
        return options_.context_fields;
    }

    /// Executes one command, in the TypeScript engine's order:
    ///
    /// 1. Lookup. An unknown name gives COMMAND_NOT_FOUND with up to three "did you mean"
    ///    matches; the name is never echoed untruncated.
    /// 2. Exposure, when `context.surface` is set: COMMAND_NOT_EXPOSED.
    /// 3. Context, when `context.active_context` is set: COMMAND_NOT_IN_CONTEXT.
    /// 4. Validation against the input schema, then of the declared context fields in
    ///    `context.extra`: VALIDATION_ERROR.
    /// 5. Middleware, then the handler with the validated input.
    /// 6. The handler's result gets `metadata.executionTimeMs`, `commandVersion` and, when the
    ///    context has one after middleware ran, `traceId`.
    /// 7. `on_command`.
    ///
    /// An exception escaping the chain becomes COMMAND_EXECUTION_ERROR (builds with exceptions).
    [[nodiscard]] CommandResult execute(std::string_view name, const Json& input = Json::object(),
                                        CommandContext context = {}) const;

    /// Executes a batch; each command goes through `execute`. See `afd::execute_batch`.
    [[nodiscard]] BatchResult execute_batch(const Json& request,
                                            const CommandContext& context = {}) const;
    [[nodiscard]] BatchResult execute_batch(const BatchRequest& request,
                                            const CommandContext& context = {}) const;

    /// Executes a pipeline; each step goes through `execute`. See `afd::execute_pipeline`.
    [[nodiscard]] PipelineResult execute_pipeline(const Json& request,
                                                  const CommandContext& context = {}) const;
    [[nodiscard]] PipelineResult execute_pipeline(const PipelineRequest& request,
                                                  const CommandContext& context = {}) const;

    /// Executes one command as stream chunks. See `afd::execute_stream`.
    [[nodiscard]] std::vector<StreamChunk>
    execute_stream(std::string_view name, const Json& input = Json::object(),
                   const CommandContext& context = {},
                   std::optional<double> timeout_ms = std::nullopt) const;

private:
    [[nodiscard]] ExecutorOptions executor_options() const;
    [[nodiscard]] CommandExecutor executor() const;
    [[nodiscard]] CommandResult run_chain(const RegisteredCommand& command, const Json& input,
                                          CommandContext& context) const;
    void report_error(std::string_view message) const;

    CommandRegistryOptions options_;
    /// The compiled schema of each declared context field, in declaration order.
    std::vector<CompiledSchema> context_schemas_;
    /// The names of the fields declared `journal`, set on each call's context. Null when none.
    std::shared_ptr<const detail::JournaledContextFields> journaled_fields_;
    /// Why the context field declarations are invalid; every call then fails.
    std::optional<std::string> options_error_;
    mutable std::shared_mutex mutex_;
    std::map<std::string, std::shared_ptr<const RegisteredCommand>, std::less<>> commands_;
    std::vector<std::shared_ptr<const RegisteredCommand>> order_;
};

} // namespace afd

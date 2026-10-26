// Command definitions, exposure, and the context a handler receives
// (packages/core/src/commands.ts and packages/server/src/schema.ts).
#pragma once

#include "afd/actor.hpp"
#include "afd/json.hpp"
#include "afd/result.hpp"
#include "afd/runtime.hpp"

#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace afd {

/// A surface a command can be exposed to. TypeScript calls this the command's `interface`; C++
/// avoids that word because <windows.h> defines `interface` as a macro.
enum class Interface { palette, mcp, agent, cli };

/// Where a command may be called from. Defaults: palette and agent on, MCP and CLI opt-in.
struct ExposeOptions {
    bool palette = true;
    bool mcp = false;
    bool agent = true;
    bool cli = false;
};

/// The default exposure: `{palette: true, agent: true, mcp: false, cli: false}`.
ExposeOptions default_expose() noexcept;

/// Whether `expose` allows `surface`.
bool is_exposed_to(const ExposeOptions& expose, Interface surface) noexcept;

/// How long a command is expected to take.
enum class ExecutionTime { instant, fast, slow, long_running };

/// A concrete, valid input, for agents to learn from. Validated against the input schema when
/// the command is registered.
struct CommandExample {
    std::string title;
    Json input;
};

/// What a handler and its middleware know about the call. Middleware and the handler share one
/// mutable context, as in TypeScript.
struct CommandContext {
    std::optional<std::string> trace_id;
    /// A per-call timeout, in milliseconds (`DirectClient` enforces it).
    std::optional<double> timeout_ms;
    /// The surface the call came through. TypeScript's `context.interface`.
    std::optional<Interface> surface;
    /// The active command context (see `CommandDefinition::contexts`), if any.
    std::optional<std::string> active_context;
    /// Who is calling. `DirectClient` sets `human` unless told otherwise; an MCP host should set
    /// `agent`. The registry reports the kind as `metadata.actorKind`.
    std::optional<Actor> actor;
    /// The time source for handlers, instead of reading the system clock. The registry fills it
    /// from `CommandRegistryOptions::clock` when unset, and times the handler with it.
    std::shared_ptr<const Clock> clock;
    /// The randomness source for handlers. The registry fills it from
    /// `CommandRegistryOptions::random` when unset. Tests and replays pass a `SeededRandom`.
    std::shared_ptr<RandomSource> random;
    /// Cooperative cancellation. Handlers that run long should poll it.
    CancellationToken cancellation;
    /// Anything else the host passes along, as a JSON object. TypeScript's `[key: string]:
    /// unknown`, and the only extension point.
    Json extra = Json::object();
};

/// Defaults for `with_context_defaults`.
struct ContextDefaults {
    /// Clock when the context has none. Default: a `SystemClock`.
    std::shared_ptr<const Clock> clock;
    /// Random source when the context has none. Default: a `SystemRandom`.
    std::shared_ptr<RandomSource> random;
    /// Actor when the context has none. Default: none (the context keeps no actor).
    std::optional<Actor> actor;
};

/// `context` with `clock`, `random` and (when given) `actor` filled in where it has none. Values
/// already on the context always win.
CommandContext with_context_defaults(CommandContext context, const ContextDefaults& defaults = {});

/// A command handler. Receives the validated input (defaults applied, undeclared keys removed).
using CommandHandler = std::function<CommandResult(const Json& input, CommandContext& context)>;

/// Calls the rest of the middleware chain and then the handler.
using Next = std::function<CommandResult()>;

/// Middleware around every execution. Receives the validated input and the shared context. It
/// may short-circuit by returning without calling `next`, or call `next` more than once (retry).
using CommandMiddleware = std::function<CommandResult(std::string_view name, const Json& input,
                                                      CommandContext& context, const Next& next)>;

/// A command. Fields are in the order designated initializers must follow:
///
///     afd::CommandDefinition{
///         .name = "todo-create",
///         .description = "Create a todo",
///         .input_schema = {{"type", "object"}, ...},
///         .handler = [](const afd::Json& input, afd::CommandContext&) { ... },
///         .mutation = true,
///     };
struct CommandDefinition {
    /// `domain-action` kebab-case with at least two segments.
    std::string name;
    std::string description;
    std::optional<std::string> category;
    /// JSON Schema (draft-07 subset; see schema.hpp) for the input. The default accepts any object.
    Json input_schema = Json{{"type", "object"}};
    /// JSON Schema of `data` on success, for introspection only (never enforced).
    std::optional<Json> output_schema;
    CommandHandler handler;
    std::optional<std::string> version;
    std::vector<std::string> tags;
    /// Commands that should run first. Planning metadata only; never enforced. TypeScript's
    /// `requires`, which is a C++20 keyword.
    std::vector<std::string> prerequisites;
    /// Command contexts this command is available in. Empty means every context.
    std::vector<std::string> contexts;
    /// Error codes the command can return.
    std::vector<std::string> errors;
    bool mutation = false;
    bool destructive = false;
    std::optional<std::string> confirm_prompt;
    bool undoable = false;
    ExposeOptions expose;
    bool handoff = false;
    std::optional<std::string> handoff_protocol;
    std::vector<CommandExample> examples;
    std::optional<ExecutionTime> execution_time;
};

/// The result of `validate_command_name`.
struct CommandNameCheck {
    bool valid = false;
    std::optional<std::string> reason;
};

/// Checks `^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)+$`, with TypeScript's reasons.
CommandNameCheck validate_command_name(std::string_view name);

} // namespace afd

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
#include <type_traits>
#include <utility>
#include <vector>

namespace afd {

namespace detail {
struct JournalCallState;
struct DirectApprovalState;
struct JournaledContextFields;
} // namespace detail

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
    /// Approval evidence for a command whose approval policy requires it: the `approvalToken`
    /// from an `APPROVAL_REQUIRED` result (approval.hpp). Only trusted surface code sets it, once
    /// a human approved; never set it from tool arguments, since whoever holds a token can run
    /// the call. TypeScript's `context.approval`.
    std::optional<std::string> approval;
    /// The time source for handlers, instead of reading the system clock. The registry fills it
    /// from `CommandRegistryOptions::clock` when unset, and times the handler with it.
    std::shared_ptr<const Clock> clock;
    /// The randomness source for handlers. The registry fills it from
    /// `CommandRegistryOptions::random` when unset. Tests and replays pass a `SeededRandom`.
    std::shared_ptr<RandomSource> random;
    /// Cooperative cancellation. Handlers that run long should poll it.
    CancellationToken cancellation;
    /// Anything else the host passes along, as a JSON object. TypeScript's `[key: string]:
    /// unknown`, and the only extension point. A declared context field's value goes here under
    /// its name (`CommandRegistryOptions::context_fields`); the registry replaces it with the
    /// validated value before middleware runs.
    Json extra = Json::object();
    /// Set by the command journal (journal.hpp) while it records or replays the call; leave it
    /// unset. Nested calls that copy the context carry it on. Never recorded or hashed.
    std::shared_ptr<detail::JournalCallState> journal;
    /// Internal approval marker. DirectClient ignores caller-provided markers and evidence.
    std::shared_ptr<detail::DirectApprovalState> direct_approval;
    /// Set by the registry once the call's declared context fields validated: which of them the
    /// journal keeps. Leave it unset. Never recorded or hashed.
    std::shared_ptr<const detail::JournaledContextFields> journaled_fields;
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

/// Whether one call needs a human's approval before its handler runs. Wire values are
/// `not-required` and `required`.
enum class ApprovalDecision { not_required, required };

/// A policy that decides per call, from the validated input and the context (for example,
/// "agents need approval, humans do not"). An empty function holds every call.
using ApprovalPolicyFunction =
    std::function<ApprovalDecision(const Json& input, const CommandContext& context)>;

/// A command's approval policy: a fixed decision, or a function of the call. Unset means
/// `not_required`. Enforced only where `create_approval_middleware` (approval.hpp) runs.
/// Converts implicitly from either, so `.approval = afd::ApprovalDecision::required` and
/// `.approval = [](const afd::Json&, const afd::CommandContext&) { ... }` both work. (A class,
/// not a `std::variant`: GCC reports a false `-Wmaybe-uninitialized` when a definition holding
/// `std::optional<std::variant<..., std::function>>` is copied.)
class ApprovalPolicy {
public:
    ApprovalPolicy(ApprovalDecision decision) noexcept : decision_(decision) {}
    template <class Function>
        requires std::is_constructible_v<ApprovalPolicyFunction, Function> &&
                     (!std::is_same_v<std::remove_cvref_t<Function>, ApprovalPolicy>) &&
                     (!std::is_same_v<std::remove_cvref_t<Function>, ApprovalDecision>)
    ApprovalPolicy(Function&& function)
        : function_(std::forward<Function>(function)), is_function_(true) {}

    /// The function, for a policy that decides per call; `nullptr` for a fixed decision.
    [[nodiscard]] const ApprovalPolicyFunction* function() const noexcept {
        return is_function_ ? &function_ : nullptr;
    }
    /// The fixed decision. Meaningful only when `function()` is `nullptr`.
    [[nodiscard]] ApprovalDecision decision() const noexcept { return decision_; }

private:
    ApprovalDecision decision_ = ApprovalDecision::required;
    ApprovalPolicyFunction function_;
    bool is_function_ = false;
};

/// How a policy is reported (`_meta.approval`): a function cannot be serialized, so it is
/// `conditional`.
enum class ApprovalMode { not_required, required, conditional };

/// The reported mode of `policy`; `std::nullopt` when no policy is declared. TypeScript's
/// `approvalMode`.
std::optional<ApprovalMode> approval_mode(const std::optional<ApprovalPolicy>& policy) noexcept;

/// The wire name of `mode`: `not-required`, `required` or `conditional`.
std::string_view approval_mode_name(ApprovalMode mode) noexcept;

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
    /// Whether a call needs a human's approval before the handler runs. Unset means
    /// `not_required`. Enforced by `create_approval_middleware`; reported as `_meta.approval`.
    std::optional<ApprovalPolicy> approval;
};

/// The result of `validate_command_name`.
struct CommandNameCheck {
    bool valid = false;
    std::optional<std::string> reason;
};

/// Checks `^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)+$`, with TypeScript's reasons.
CommandNameCheck validate_command_name(std::string_view name);

} // namespace afd

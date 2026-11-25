// Command definitions, exposure, and the context a handler receives
// (packages/core/src/commands.ts and packages/server/src/schema.ts).
#pragma once

#include "afd/actor.hpp"
#include "afd/json.hpp"
#include "afd/output_budget.hpp"
#include "afd/result.hpp"
#include "afd/runtime.hpp"

#include <concepts>
#include <cstdint>
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
class McpApprovalRelay;
class UpFrontApproval;
struct JournaledContextFields;
struct ApprovalAdmission;
struct RawOutputBudgetAsk;
struct CallerAllow;
} // namespace detail

/// A surface a command can be exposed to. TypeScript calls this the command's `interface`; C++
/// avoids that word because <windows.h> defines `interface` as a macro.
enum class Interface { palette, mcp, agent, cli, apps };

/// Where a command may be called from. Defaults: palette and agent on, MCP, CLI and apps opt-in.
struct ExposeOptions {
    bool palette = true;
    bool mcp = false;
    bool agent = true;
    bool cli = false;
    bool apps = false;
};

/// The default exposure: `{palette: true, agent: true, mcp: false, cli: false, apps: false}`.
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
struct ContextScope; // contexts.hpp

struct CommandContext {
    std::optional<std::string> trace_id;
    /// A per-call timeout, in milliseconds (`CommandRegistry::execute` and `DirectClient` enforce
    /// it).
    std::optional<double> timeout_ms;
    /// The surface the call came through. TypeScript's `context.interface`.
    std::optional<Interface> surface;
    /// The active command context (see `CommandDefinition::contexts`), if any.
    std::optional<std::string> active_context;
    /// What `afd-context-enter` and `afd-context-exit` act on: a session's stack or one
    /// request's context (contexts.hpp). When set, the registry runs the call in its active
    /// context, whatever `active_context` says. Only the MCP server sets it; leave it unset.
    std::shared_ptr<const ContextScope> context_scope;
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
    /// Set by the MCP server (afd::mcp_stdio) on every call it routes: with `surface` set, a
    /// command not exposed to it is answered as an unknown one, identically (spec/error-codes.md,
    /// D4), and the unknown-command suggestion names afd-discover.
    bool remote = false;
    /// The MCP server's tool strategy (`individual`, `grouped`, `lazy` or `hybrid`), which
    /// `afd-help` reports as `toolStrategy`. Only the MCP server sets it.
    std::optional<std::string> tool_strategy;
    /// A hybrid MCP server's first-class tools, in list order, which `afd-help` reports as
    /// `firstClassTools` and marks `firstClass` on each. Only the MCP server sets it.
    std::optional<std::vector<std::string>> first_class_tools;
    /// Internal MCP approval relay (afd::mcp_stdio). Only the MCP server sets it.
    std::shared_ptr<detail::McpApprovalRelay> mcp_approval_relay;
    /// Internal up-front approval of an afd-batch or afd-pipe (afd::mcp_stdio). Only the MCP
    /// server sets it, and the approval middleware removes it before a step runs.
    std::shared_ptr<detail::UpFrontApproval> up_front_approval;
    /// Set by the registry once the call's declared context fields validated: which of them the
    /// journal keeps. Leave it unset. Never recorded or hashed.
    std::shared_ptr<const detail::JournaledContextFields> journaled_fields;
    /// Set by the registry for each call: the command it runs and whether an approval step
    /// admitted it. The registry replaces whatever the caller passes; leave it unset.
    std::shared_ptr<detail::ApprovalAdmission> approval_admission;
    /// Per-call output budget ask in bytes (spec/output-budgets.md, B2). Trusted host code (an
    /// in-process caller, `DirectClient`, or `StdioServerOptions::context_hook`) sets this; it
    /// always wins over a `_meta["dev.afd/outputBudget"]` ask. Validated before middleware and
    /// the handler run (`1 <= n <= 9007199254740991`), even for commands without a declaration.
    std::optional<std::uint64_t> output_budget_ask;
    /// Effective output budget for this call in bytes (spec/output-budgets.md, B3, B4), computed
    /// by the registry from the command's declaration and the ask before middleware and the
    /// handler run. Unset when the command declares no output budget.
    std::optional<std::uint64_t> output_budget;
    /// Internal raw `_meta["dev.afd/outputBudget"]` value set by `afd::mcp_stdio` when trusted
    /// code did not set `output_budget_ask`. Leave unset; validated in `CommandRegistry::execute`.
    std::shared_ptr<const detail::RawOutputBudgetAsk> output_budget_meta_ask;
    /// Internal server-level default timeout in milliseconds set by `afd::mcp_stdio`
    /// (`spec/execution-controls.md`, `defaultTimeoutMs`). Used by `CommandRegistry::execute`
    /// when `timeout_ms` is unset, and excluded from journal context digests so enabling the
    /// server default does not change hashes. Leave unset.
    std::optional<double> default_timeout_ms;
    /// Internal flag set by `DirectClient` or `afd::mcp_stdio` when it has already armed the
    /// call's deadline on `cancellation`, so `CommandRegistry::execute` does not stack a second
    /// deadline on top. Leave unset.
    bool deadline_armed = false;
    /// Internal: the allow list of the `DirectClient` the call came through, so the registry's
    /// suggestions and recoveries name only commands it admits (`spec/recovery.md`, rule 2).
    /// `DirectClient` replaces whatever the caller passes. Leave unset.
    std::shared_ptr<const detail::CallerAllow> caller_allow;
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
/// `not_required`. `create_approval_middleware` (approval.hpp) asks for the approval; without
/// it, the registry refuses a command whose policy is not `not_required` with
/// `APPROVAL_UNAVAILABLE`, and a policy function is not evaluated.
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

/// Host grant check for app-to-app calls (`spec/command-metadata.md`, "App-to-app calls"):
/// whether the caller in `context` holds a grant naming `command`. Runs synchronously before
/// lookup, context, input and declared context-field validation; any exception or false answer
/// refuses the call with `CALL_NOT_GRANTED`.
///
/// Rejects callables whose return type is not strictly `bool` (so truthy non-booleans cannot
/// satisfy a grant), and shares one predicate instance across copies so stateful grants are not
/// duplicated on each call and no user copy constructor runs under the registry lock.
class CallGrant {
public:
    CallGrant() noexcept = default;
    CallGrant(std::nullptr_t) noexcept {}

    template <typename Fn>
        requires(!std::same_as<std::remove_cvref_t<Fn>, CallGrant>) &&
                (!std::same_as<std::remove_cvref_t<Fn>, std::nullptr_t>) &&
                std::invocable<std::decay_t<Fn>&, std::string_view, const CommandContext&> &&
                std::same_as<std::invoke_result_t<std::decay_t<Fn>&, std::string_view,
                                                  const CommandContext&>,
                             bool>
    CallGrant(Fn&& fn) {
        using Decayed = std::decay_t<Fn>;
        if constexpr (requires(const Decayed& f) { static_cast<bool>(f == nullptr); }) {
            if (fn == nullptr) {
                return;
            }
        }
        target_ = std::make_shared<Model<Decayed>>(std::forward<Fn>(fn));
    }

    explicit operator bool() const noexcept { return target_ != nullptr; }

    bool operator()(std::string_view command, const CommandContext& context) const {
        return target_ ? target_->invoke(command, context) : false;
    }

private:
    struct Concept {
        virtual ~Concept() = default;
        virtual bool invoke(std::string_view command, const CommandContext& context) = 0;
    };

    template <typename Fn>
    struct Model final : Concept {
        Fn fn;
        template <typename U>
        explicit Model(U&& f) : fn(std::forward<U>(f)) {}
        bool invoke(std::string_view command, const CommandContext& context) override {
            return fn(command, context);
        }
    };

    std::shared_ptr<Concept> target_;
};

/// A command. Fields are in the order designated initializers must follow:
///
///     afd::CommandDefinition{
///         .name = "todo-create",
///         .description = "Create a todo",
///         .input_schema = {{"type", "object"}, ...},
///         .handler = [](const afd::Json& input, afd::CommandContext&) { ... },
///         .mutation = true,
///     };
/// A flag that takes only a `bool`: `0`, `1`, a pointer or a string is a compile error, in an
/// initializer and in an assignment, so a value that is not a boolean cannot read as one. Reads
/// as a `bool`.
class StrictBool {
public:
    constexpr StrictBool() noexcept = default;
    constexpr StrictBool(bool value) noexcept
        : value_(value) {} // NOLINT(google-explicit-constructor)
    template <class T>
        requires(!std::same_as<std::remove_cvref_t<T>, bool> &&
                 !std::same_as<std::remove_cvref_t<T>, StrictBool>)
    StrictBool(T&&) = delete;

    constexpr operator bool() const noexcept {
        return value_;
    } // NOLINT(google-explicit-constructor)

private:
    bool value_ = false;
};

struct CommandDefinition {
    /// `domain-action` kebab-case with at least two segments.
    std::string name;
    std::string description;
    /// A short human-readable label, such as "Create a todo": the MCP tool `title` of the
    /// command's own tool. Display text, never reported in `_meta`; when unset, nothing is
    /// derived from the name.
    std::optional<std::string> title;
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
    /// Whether the command takes or returns a secret (a password argument, an issued token). A
    /// journal never records a call to it unless the recorder was also given `redact`, which
    /// removes the secret; a `filter` alone never admits it (spec/journal.md). Never reported.
    /// Only a `bool` is accepted (`StrictBool`).
    StrictBool secret;
    std::vector<CommandExample> examples;
    std::optional<ExecutionTime> execution_time;
    /// Whether a call needs a human's approval before the handler runs. Unset means
    /// `not_required`. Asked for by `create_approval_middleware`; without it the registry refuses
    /// a call with `APPROVAL_UNAVAILABLE` unless the policy is `not_required`. Reported as
    /// `_meta.approval`.
    std::optional<ApprovalPolicy> approval;
    /// Optional declared output budget (`{ defaultBytes, maxBytes }`; spec/output-budgets.md, B1).
    /// Validated at registration; emitted in `_meta["dev.afd/outputBudget"]`, grouped actions,
    /// `afd-detail` and `afd-help` (full).
    std::optional<OutputBudget> output_budget;
    /// Optional extra MCP tool `_meta` entries (spec/mcp-resources.md, T1-T3). Validated at
    /// registration against the T2 key rule; emitted in `command_to_mcp_tool`, grouped
    /// `_meta.actions`, and `afd-detail` (`toolMeta`). Never emitted on meta-tools, context tools,
    /// or the grouped tool itself.
    std::optional<Json> tool_meta;
    /// Optional input schema advertised on MCP tools, grouped actions, `afd-detail`, `afd-schema`,
    /// and `afd-docs`, while the registry validates calls against `input_schema`
    /// (spec/mcp-resources.md, V1-V2). Must be a JSON object with `"type": "object"`.
    std::optional<Json> advertised_input_schema;
};

/// The result of `validate_command_name`.
struct CommandNameCheck {
    bool valid = false;
    std::optional<std::string> reason;
};

/// Checks `^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)+$`, with TypeScript's reasons.
CommandNameCheck validate_command_name(std::string_view name);

} // namespace afd

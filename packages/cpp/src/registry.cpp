#include "afd/registry.hpp"

#include "afd/contexts.hpp"
#include "afd/similarity.hpp"

#include <algorithm>
#include <cmath>
#include <functional>
#include <mutex>

#include "detail/approval_admission.hpp"
#include "detail/caller_allow.hpp"
#include "detail/context_fields.hpp"
#include "detail/dispatch_id.hpp"
#include "detail/exceptions.hpp"
#include "detail/idempotency.hpp"
#include "detail/json_io.hpp"
#include "detail/meta_keys.hpp"
#include "detail/output_budget.hpp"

namespace afd {
namespace {

constexpr std::size_t max_not_found_matches = 3;

CommandResult cancelled_before_start(std::string_view name) {
    return failure(
        create_error(error_codes::COMMAND_CANCELLED,
                     "Command '" + truncate_name(name) + "' was cancelled before it started",
                     {.suggestion = "Retry with a fresh signal if the command is still needed.",
                      .retryable = false}));
}

std::string interface_name(Interface surface) {
    switch (surface) {
    case Interface::palette:
        return "palette";
    case Interface::mcp:
        return "mcp";
    case Interface::agent:
        return "agent";
    case Interface::cli:
        return "cli";
    case Interface::apps:
        return "apps";
    }
    return "agent";
}

bool is_accessible_in_context(const CommandDefinition& command,
                              const std::optional<std::string>& active_context) {
    if (!active_context || active_context->empty() || command.contexts.empty()) {
        return true;
    }
    return std::find(command.contexts.begin(), command.contexts.end(), *active_context) !=
           command.contexts.end();
}

// The command an unknown-command error sends the caller to, decided once for the suggestion and
// the recovery (spec/recovery.md, "Engine errors"): afd-discover for a remote call, which the MCP
// server serves in every strategy, else afd-help when the caller can call it (`candidates` are the
// names it can call), else none.
std::optional<std::string_view> not_found_listing(const std::vector<std::string>& candidates,
                                                  bool remote) {
    if (remote) {
        return "afd-discover";
    }
    if (std::find(candidates.begin(), candidates.end(), "afd-help") != candidates.end()) {
        return "afd-help";
    }
    return std::nullopt;
}

// A `call` recovery to `command`, or none.
std::optional<Recovery> call_recovery(std::optional<std::string_view> command) {
    if (!command) {
        return std::nullopt;
    }
    return Recovery{.kind = RecoveryKind::call, .command = std::string(*command)};
}

// COMMAND_NOT_IN_CONTEXT's suggestion. It names afd-context-list when the caller can call it
// (contexts.hpp), and afd-context-enter beside it only when it can call that too; otherwise it
// names the contexts the command belongs to, as Rust does.
std::string contexts_suggestion(const CommandDefinition& command, bool context_list,
                                bool context_enter) {
    if (context_list) {
        return context_enter
                   ? "Use afd-context-list to see available contexts, or afd-context-enter to "
                     "switch."
                   : "Use afd-context-list to see available contexts.";
    }
    std::string contexts;
    for (const auto& context : command.contexts) {
        contexts += (contexts.empty() ? "'" : ", '") + context + "'";
    }
    return "Switch to a context this command belongs to (" + contexts +
           "), or call it with no active context.";
}

// A gated command no approval step admitted for this dispatch (spec/command-metadata.md,
// "Approvals"): no approval step ran (`missing`), or one ran but this dispatch is not the one it
// admitted (a retry placed after it, or the input changed after it).
CommandResult approval_unavailable(const std::string& name, detail::AdmissionCheck check) {
    std::string suggestion;
    std::string reason;
    switch (check) {
    case detail::AdmissionCheck::missing:
        reason = "no-approval-step";
        suggestion = "Tell the user that " + name +
                     " needs their approval and this server has no approval step; do not retry. "
                     "The operator adds the approval middleware (create_approval_middleware) or "
                     "removes the command's approval policy.";
        break;
    default:
        reason = "admission-mismatch";
        suggestion = "Do not retry: this call is not the one approved. The operator moves "
                     "middleware that retries or changes input before the approval middleware.";
        break;
    }
    return failure(
        create_error(error_codes::APPROVAL_UNAVAILABLE,
                     name + " needs a person's approval, and this server cannot ask for it",
                     {.suggestion = std::move(suggestion),
                      .retryable = false,
                      // Both reasons are the operator's to fix.
                      .recovery = Recovery{.kind = RecoveryKind::external},
                      .details = Json{{"reason", std::move(reason)}}}));
}

std::string issue_summary(const ValidationFailure& failure) {
    std::string out;
    for (const auto& issue : failure.errors) {
        out += (out.empty() ? "" : ", ") + issue.path + ": " + issue.message;
    }
    return out;
}

} // namespace

// TypeScript's notFoundSuggestion. The unknown name is untrusted and never echoed. It names a
// tool only where the host provides it (spec/error-codes.md, D4): afd-discover for a remote call
// (the MCP server serves it in every strategy), else afd-help when the caller can call one, as
// Rust does.
std::string not_found_suggestion(std::string_view name, const std::vector<std::string>& candidates,
                                 bool remote) {
    const auto listing = not_found_listing(candidates, remote);
    const std::string list = listing ? "Use " + std::string(*listing) + " to list all commands."
                                     : "Check the command name against the available commands.";
    const auto matches = find_similar_tools(name, candidates, max_not_found_matches);
    if (matches.empty()) {
        return list;
    }
    std::string also_close;
    if (matches.size() > 1) {
        also_close = " Other close matches: ";
        for (std::size_t i = 1; i < matches.size(); ++i) {
            also_close += (i > 1 ? ", '" : "'") + matches[i] + "'";
        }
        also_close += ".";
    }
    return "Did you mean '" + matches.front() + "'?" + also_close + " " + list;
}

CommandRegistry::CommandRegistry(CommandRegistryOptions options) : options_(std::move(options)) {
    if (!options_.clock) {
        options_.clock = std::make_shared<SystemClock>();
    }
    if (!options_.runner) {
        options_.runner = std::make_shared<InlineTaskRunner>();
    }
    if (!options_.random) {
        options_.random = std::make_shared<SystemRandom>();
    }
    if (options_.max_batch_size == 0) {
        options_error_ = "max_batch_size must be at least 1";
        return;
    }
    if (options_.max_batch_parallelism == 0) {
        options_error_ = "max_batch_parallelism must be at least 1";
        return;
    }
    if (options_.max_validation_issues == 0) {
        options_error_ = "max_validation_issues must be at least 1";
        return;
    }
    if (options_.idempotency) {
        if (auto problem = check_idempotency_options(*options_.idempotency)) {
            options_error_ = std::move(problem);
            return;
        }
        if (!options_.idempotency->store) {
            options_.idempotency->store = std::make_shared<InMemoryIdempotencyStore>();
        }
    }
    auto fields = detail::compile_context_fields(options_.context_fields);
    if (fields) {
        context_schemas_ = std::move(fields->schemas);
        journaled_fields_ = std::move(fields->journaled);
    } else {
        options_error_ = fields.error();
    }
}

Expected<std::shared_ptr<CommandRegistry>> CommandRegistry::create(CommandRegistryOptions options) {
    auto registry = std::make_shared<CommandRegistry>(std::move(options));
    if (registry->options_error_) {
        return unexpected(*registry->options_error_);
    }
    return registry;
}

ExecutorOptions CommandRegistry::executor_options() const {
    return {.dev_mode = options_.dev_mode,
            .clock = options_.clock,
            .random = options_.random,
            .runner = options_.runner,
            .max_batch_size = options_.max_batch_size,
            .max_batch_parallelism = options_.max_batch_parallelism};
}

CommandExecutor CommandRegistry::executor() const {
    return [this](std::string_view name, const Json& input, CommandContext& context) {
        return execute(name, input, context);
    };
}

CommandExecutor CommandRegistry::stream_executor() const {
    return [this](std::string_view name, const Json& input, CommandContext& context) {
        return execute_impl(name, input, context, false);
    };
}

BatchResult CommandRegistry::execute_batch(const Json& request,
                                           const CommandContext& context) const {
    return afd::execute_batch(request, executor(), context, executor_options());
}

BatchResult CommandRegistry::execute_batch(const BatchRequest& request,
                                           const CommandContext& context) const {
    return afd::execute_batch(request, executor(), context, executor_options());
}

PipelineResult CommandRegistry::execute_pipeline(const Json& request,
                                                 const CommandContext& context) const {
    return afd::execute_pipeline(request, executor(), context, executor_options());
}

PipelineResult CommandRegistry::execute_pipeline(const PipelineRequest& request,
                                                 const CommandContext& context) const {
    return afd::execute_pipeline(request, executor(), context, executor_options());
}

std::vector<StreamChunk> CommandRegistry::execute_stream(std::string_view name, const Json& input,
                                                         const CommandContext& context,
                                                         std::optional<double> timeout_ms) const {
    StreamOptions options;
    static_cast<ExecutorOptions&>(options) = executor_options();
    options.timeout = timeout_ms;
    // Buffered streaming skips the B5 output-budget check (spec/output-budgets.md, B7).
    return afd::execute_stream(name, input, stream_executor(), context, options);
}

std::optional<std::string> CommandRegistry::register_command(CommandDefinition command) {
    const CommandNameCheck check = validate_command_name(command.name);
    if (!check.valid) {
        return check.reason;
    }
    for (std::string_view reserved : reserved_command_names) {
        if (command.name == reserved) {
            return "Command name '" + command.name + "' is reserved: the tool router handles '" +
                   command.name +
                   "' itself, so the command would be unreachable. Rename the command.";
        }
    }
    if (!command.handler) {
        return "Command '" + command.name + "' has no handler";
    }
    // A boolean schema is allowed below the root, but a command's input is an object
    // (spec/validation.md).
    if (!command.input_schema.is_object()) {
        return "Command '" + command.name + "': an input schema must be a JSON Schema object";
    }
    if (command.output_budget) {
        if (auto problem = command.output_budget->validate()) {
            return "Command '" + command.name + "' has an invalid outputBudget: " + *problem;
        }
    }
    if (command.tool_meta) {
        if (auto problem = detail::validate_meta_object("Command '" + command.name + "'",
                                                        *command.tool_meta, true)) {
            return problem;
        }
    }
    if (command.advertised_input_schema) {
        if (auto problem = detail::validate_advertised_input_schema(
                command.name, *command.advertised_input_schema)) {
            return problem;
        }
    }
    auto schema = CompiledSchema::compile(command.input_schema);
    if (!schema) {
        return "Command '" + command.name + "' has an unsupported input schema: " + schema.error();
    }
    for (const auto& example : command.examples) {
        auto checked = schema->validate(example.input);
        if (!checked) {
            return "Example \"" + example.title + "\" for command \"" + command.name +
                   "\" fails schema validation: " + issue_summary(checked.error());
        }
    }
    if (command.handoff) {
        const auto add_tag = [&](std::string tag) {
            if (std::find(command.tags.begin(), command.tags.end(), tag) == command.tags.end()) {
                command.tags.push_back(std::move(tag));
            }
        };
        add_tag("handoff");
        if (command.handoff_protocol) {
            add_tag("handoff:" + *command.handoff_protocol);
        }
    }

    auto entry = std::make_shared<const RegisteredCommand>(
        RegisteredCommand{std::move(command), std::move(*schema)});
    const std::unique_lock lock(mutex_);
    if (commands_.find(entry->definition.name) != commands_.end()) {
        return "Duplicate command name '" + entry->definition.name +
               "': command names must be unique, otherwise one command shadows the other. Rename "
               "or remove one of them.";
    }
    commands_.emplace(entry->definition.name, entry);
    order_.push_back(std::move(entry));
    return std::nullopt;
}

void CommandRegistry::use(CommandMiddleware middleware) {
    const std::unique_lock lock(mutex_);
    options_.middleware.push_back(std::move(middleware));
}

void CommandRegistry::set_call_grant(CallGrant grant) {
    CallGrant previous;
    {
        const std::unique_lock lock(mutex_);
        previous = std::exchange(options_.call_grant, std::move(grant));
    }
}

std::shared_ptr<const RegisteredCommand> CommandRegistry::get(std::string_view name) const {
    const std::shared_lock lock(mutex_);
    const auto it = commands_.find(name);
    return it == commands_.end() ? nullptr : it->second;
}

bool CommandRegistry::has(std::string_view name) const {
    return get(name) != nullptr;
}

std::vector<std::shared_ptr<const RegisteredCommand>> CommandRegistry::list() const {
    const std::shared_lock lock(mutex_);
    return order_;
}

std::vector<std::shared_ptr<const RegisteredCommand>>
CommandRegistry::list_by_category(std::string_view category) const {
    std::vector<std::shared_ptr<const RegisteredCommand>> out;
    for (const auto& command : list()) {
        if (command->definition.category == category) {
            out.push_back(command);
        }
    }
    return out;
}

std::vector<std::shared_ptr<const RegisteredCommand>>
CommandRegistry::list_by_tags(const std::vector<std::string>& tags, TagMatchMode mode) const {
    std::vector<std::shared_ptr<const RegisteredCommand>> out;
    if (tags.empty()) {
        return out;
    }
    for (const auto& command : list()) {
        const auto& cmd_tags = command->definition.tags;
        if (cmd_tags.empty()) {
            continue;
        }
        const auto has_tag = [&](const std::string& tag) {
            return std::find(cmd_tags.begin(), cmd_tags.end(), tag) != cmd_tags.end();
        };
        const bool matched = mode == TagMatchMode::all
                                 ? std::all_of(tags.begin(), tags.end(), has_tag)
                                 : std::any_of(tags.begin(), tags.end(), has_tag);
        if (matched) {
            out.push_back(command);
        }
    }
    return out;
}

std::vector<std::shared_ptr<const RegisteredCommand>>
CommandRegistry::list_by_exposure(Interface surface) const {
    std::vector<std::shared_ptr<const RegisteredCommand>> out;
    for (const auto& command : list()) {
        if (is_exposed_to(command->definition.expose, surface)) {
            out.push_back(command);
        }
    }
    return out;
}

std::vector<std::shared_ptr<const RegisteredCommand>>
CommandRegistry::list_handoff_commands() const {
    std::vector<std::shared_ptr<const RegisteredCommand>> out;
    for (const auto& command : list()) {
        const auto& tags = command->definition.tags;
        if (command->definition.handoff || command->definition.handoff_protocol ||
            std::find(tags.begin(), tags.end(), "handoff") != tags.end()) {
            out.push_back(command);
        }
    }
    return out;
}

void CommandRegistry::report_error(std::string_view message) const {
    if (!options_.on_error) {
        return;
    }
#if AFD_HAS_EXCEPTIONS
    try {
        options_.on_error(message);
    } catch (...) { // an error reporter's own failure is swallowed, as in TypeScript
    }
#else
    options_.on_error(message);
#endif
}

CommandResult CommandRegistry::execute(std::string_view name, const Json& input,
                                       CommandContext context) const {
    return execute_impl(name, input, std::move(context), true);
}

CommandResult CommandRegistry::execute_impl(std::string_view name, const Json& input,
                                            CommandContext context,
                                            bool check_output_budget) const {
    context = with_context_defaults(
        std::move(context),
        {.clock = options_.clock, .random = options_.random, .actor = options_.actor});
    // This dispatch's own id, before any check (spec/dispatch.md, "The dispatch id"): never the
    // caller's, and never drawn from `context.random`, so a journal's tape is unchanged. A value a
    // caller put in `extra` under the reserved name is removed, so no reader takes it for the id.
    // A source that fails gives no id, so the call does not run (as in Rust).
    auto dispatch_id = detail::new_dispatch_id(options_.random_bytes);
    if (!dispatch_id) {
        return failure(create_error(
            error_codes::COMMAND_EXECUTION_ERROR,
            "Cannot draw a dispatch id: the secure random source failed",
            {.suggestion = "The system random source failed; try again later", .retryable = true}));
    }
    detail::DispatchIdAccess::set(context.dispatch_id, std::move(*dispatch_id));
    // The note this call's deadline owner reads for R3, taken off the context so a command the
    // handler runs on it never notes this call (spec/idempotency.md, R3).
    std::shared_ptr<detail::IdempotencyNote> note = std::move(context.idempotency_note);
    context.idempotency_note.reset();
    if (!note && options_.idempotency) {
        note = std::make_shared<detail::IdempotencyNote>();
    }
    // The key as the caller sent it, decided once (spec/idempotency.md, K1 to K6), and put on this
    // call's own context: a key it inherited from the handler that runs it is none.
    const detail::CallIdempotencyKey key = detail::resolve_idempotency_key(context);
    detail::deliver_idempotency_key(context, key);
    if (context.extra.is_object() && !context.extra.empty()) {
        context.extra.erase("dispatch_id");
        context.extra.erase("dispatchId");
    }
    // A call with a context scope (contexts.hpp) runs in the scope's active context, so the two
    // never disagree.
    if (context.context_scope) {
        context.active_context = context.context_scope->active();
    }
    // 0. App-to-app calls (`spec/app-calls.md`): check existence,
    // `expose.apps` and `call_grant` BEFORE configuration diagnostics, lookup suggestions, active
    // context, input/context-field validation, middleware and handler, so missing, unexposed and
    // ungranted calls answer alike.
    std::shared_ptr<const RegisteredCommand> command;
    if (context.surface == Interface::apps) {
        CallGrant grant;
        {
            const std::shared_lock lock(mutex_);
            if (const auto it = commands_.find(name); it != commands_.end()) {
                command = it->second;
            }
            grant = options_.call_grant;
        }
        bool granted = false;
        if (command && command->definition.expose.apps && grant) {
#if AFD_HAS_EXCEPTIONS
            try {
                granted = grant(name, context);
            } catch (...) {
                granted = false;
            }
#else
            granted = grant(name, context);
#endif
        }
        if (!granted) {
            return failure(call_not_granted());
        }
    }
    // A registry whose context field declarations are invalid cannot validate a call: it runs
    // none. `create` reports the problem before any call. Checked after an ungranted app refusal
    // so configuration diagnostics never reach an ungranted app.
    if (options_error_) {
        return failure(create_error(
            error_codes::INTERNAL_ERROR,
            "The command registry is misconfigured: " + *options_error_,
            {.suggestion = "Fix the invalid CommandRegistryOptions; CommandRegistry::create "
                           "reports this error when the registry is created",
             .retryable = false}));
    }

    std::vector<std::string> candidates;
    std::vector<std::string> exposed_names;
    if (!command) {
        const std::shared_lock lock(mutex_);
        if (const auto it = commands_.find(name); it != commands_.end()) {
            command = it->second;
        }
        bool hidden = command && context.surface &&
                      !is_exposed_to(command->definition.expose, *context.surface);
        // A remote caller cannot tell an unexposed command from a missing one (D4).
        if (hidden && context.remote) {
            command.reset();
            hidden = false;
        }
        if (!command || hidden) {
            for (const auto& entry : order_) {
                const auto& definition = entry->definition;
                const bool exposed =
                    !context.surface || is_exposed_to(definition.expose, *context.surface);
                if (hidden && exposed && detail::caller_allows(context, definition.name)) {
                    exposed_names.push_back(definition.name);
                }
                if (!command && exposed &&
                    is_accessible_in_context(definition, context.active_context) &&
                    detail::caller_allows(context, definition.name)) {
                    candidates.push_back(definition.name);
                }
            }
        }
    }

    // 1-2. Lookup and exposure. A command hidden from this surface is reported as not exposed,
    // and never offered as a suggestion.
    if (!command) {
        return failure(create_error(
            error_codes::COMMAND_NOT_FOUND, "Command '" + truncate_name(name) + "' not found",
            {.suggestion = not_found_suggestion(name, candidates, context.remote),
             .recovery = call_recovery(not_found_listing(candidates, context.remote))}));
    }
    const auto& definition = command->definition;
    if (context.surface && !is_exposed_to(definition.expose, *context.surface)) {
        const std::string surface = interface_name(*context.surface);
        std::string available;
        for (const auto& exposed : exposed_names) {
            available += (available.empty() ? "" : ", ") + exposed;
        }
        return failure(create_error(
            error_codes::COMMAND_NOT_EXPOSED,
            "Command '" + definition.name + "' is not exposed to " + surface,
            {.suggestion = exposed_names.empty()
                               ? "No commands are exposed to " + surface + "; set expose." +
                                     surface + " on the commands it should call"
                               : "Use one of the commands exposed to " + surface + ": " + available,
             .retryable = false,
             .recovery = Recovery{.kind = RecoveryKind::external}}));
    }

    // 3. Context.
    if (!is_accessible_in_context(definition, context.active_context)) {
        // Whether this caller can call an afd-context-* tool (the lock is released above):
        // registered, exposed to its surface, allowed in its context and by its client's allow
        // list. One answer for each names it in the suggestion and the recovery.
        const auto can_call = [&](std::string_view tool) {
            const auto found = get(tool);
            return found &&
                   (!context.surface ||
                    is_exposed_to(found->definition.expose, *context.surface)) &&
                   is_accessible_in_context(found->definition, context.active_context) &&
                   detail::caller_allows(context, found->definition.name);
        };
        const bool context_list = can_call("afd-context-list");
        const bool context_enter = context_list && can_call("afd-context-enter");
        return failure(create_error(
            error_codes::COMMAND_NOT_IN_CONTEXT,
            "Command '" + definition.name + "' is not available in context '" +
                *context.active_context + "'",
            {.suggestion = contexts_suggestion(definition, context_list, context_enter),
             .recovery =
                 call_recovery(context_list ? std::optional<std::string_view>("afd-context-list")
                                            : std::nullopt)}));
    }

    // The key, between the context check and validation (spec/dispatch.md, "The idempotency
    // step"): a malformed one fails the call before any middleware or handler (K2).
    if (key.kind == detail::CallIdempotencyKey::Kind::invalid) {
        return failure(invalid_idempotency_key_error());
    }

    // 4. Validation.
    auto validated = command->input_schema.validate(input, options_.max_validation_issues);
    if (!validated) {
        return failure(validation_failure_error(validated.error()));
    }
    // The declared context fields, validated in place, and the journaled ones marked for the
    // journal middleware.
    if (auto invalid = detail::apply_context_fields(options_.context_fields, context_schemas_,
                                                    definition.name, context)) {
        return std::move(*invalid);
    }
    // The output budget ask, validated even when the command declares no budget (B2-B4).
    if (auto invalid = detail::apply_output_budget(definition, context)) {
        return std::move(*invalid);
    }
    context.journaled_fields = journaled_fields_;
    // The call as the step compares it (S4): its declared context fields and validated input. The
    // step acts only on a call that carries a key to a `keyed` command (S2).
    std::optional<detail::PreparedIdempotencyCall> step_call;
    if (options_.idempotency && key.kind == detail::CallIdempotencyKey::Kind::key &&
        definition.idempotency == IdempotencySupport::keyed) {
        Json fields = Json::object();
        if (context.extra.is_object()) {
            for (const auto& field : options_.context_fields) {
                const auto value = context.extra.find(field.name);
                if (value != context.extra.end() && !value->is_null()) {
                    fields[field.name] = *value;
                }
            }
        }
        auto digest = detail::idempotency_digest(fields, *validated);
        if (!digest) {
            return failure(detail::input_not_canonical_error(definition.name));
        }
        // As the registry, DirectClient and afd::mcp_stdio arm the deadline: only a positive,
        // finite one counts, rounded up and clamped, so the lease never overflows (S7).
        const std::optional<double> effective =
            context.timeout_ms.has_value() ? context.timeout_ms : context.default_timeout_ms;
        step_call = detail::PreparedIdempotencyCall{
            .command = definition.name,
            .key = key.key,
            .digest = std::move(*digest),
            .timeout_ms = effective && std::isfinite(*effective) && *effective > 0
                              ? std::optional<double>(
                                    (std::min)(std::ceil(*effective), detail::max_timeout_ms))
                              : std::nullopt};
    }
    // This call's own admission record (approval_admission.hpp), replacing any the caller passed:
    // the command it runs, for the approval middleware to decide from, not yet admitted.
    auto admission = std::make_shared<detail::ApprovalAdmission>();
    admission->command = std::shared_ptr<const CommandDefinition>(command, &command->definition);
    // run_chain keeps it, so a dispatch takes only this record's admission.
    context.approval_admission = admission;
    // The retry middleware repeats a `keyed` command only when the call carries a key (R1).
    admission->carries_key = key.kind == detail::CallIdempotencyKey::Kind::key;
    // The record names a running call only until this call returns (the journal reads it).
    admission->running.store(true);
    struct EndAdmission {
        detail::ApprovalAdmission& record;
        ~EndAdmission() { record.running.store(false); }
    } const end_admission{*admission};

    // 4.5. Pre-dispatch cancellation check (after validation, before middleware; #1766).
    if (context.cancellation.is_cancelled()) {
        return cancelled_before_start(definition.name);
    }

    // Per-call deadline: attach a child cancellation token that keeps the caller's token as its
    // parent, and replace a late finish (including a late exception) with TIMEOUT
    // (spec/execution-controls.md, #1766). Snapshot the duration before dispatch so middleware or
    // handler mutations of `context.timeout_ms` cannot invalidate or skew the TIMEOUT result.
    // Skip arming a second deadline when `DirectClient` or `afd::mcp_stdio` already armed one.
    const std::optional<double> requested_timeout =
        context.deadline_armed
            ? std::nullopt
            : (context.timeout_ms.has_value() ? context.timeout_ms : context.default_timeout_ms);
    const std::optional<double> timeout =
        requested_timeout && std::isfinite(*requested_timeout) && *requested_timeout > 0
            ? std::optional<double>(
                  (std::min)(std::ceil(*requested_timeout), detail::max_timeout_ms))
            : std::nullopt;
    const double reported_timeout_ms = timeout ? *requested_timeout : 0.0;
    std::optional<CancellationSource> deadline;
    if (timeout) {
        const std::shared_ptr<const Clock> deadline_clock =
            context.clock ? context.clock : options_.clock;
        deadline.emplace(context.cancellation, deadline_clock->steady_ms() + *timeout,
                         deadline_clock);
        context.cancellation = deadline->token();
    }

    // 5-6. Middleware and handler.
    CommandResult result;
    bool threw = false;
#if AFD_HAS_EXCEPTIONS
    try {
        result = run_chain(*command, *validated, context, *admission, check_output_budget,
                           step_call ? &*step_call : nullptr, note.get());
    } catch (const std::exception& error) {
        threw = true;
        report_error(error.what());
        result = execution_failure(error.what(), options_.dev_mode);
    } catch (...) {
        threw = true;
        report_error("unknown exception");
        result = execution_failure("unknown exception", options_.dev_mode);
    }
#else
    result = run_chain(*command, *validated, context, *admission, check_output_budget,
                       step_call ? &*step_call : nullptr, note.get());
#endif
    // An approval hook's refusal on the last pass through the approval step (approval.cpp) fails
    // the call as a thrown middleware error does: to `on_error`, as COMMAND_EXECUTION_ERROR, and
    // not to `on_command`, whatever a middleware outside it made of the failure, since the handler
    // never ran on that pass. One that reached the catch above was reported there already.
    if (auto refusal = detail::take_hook_refusal(*admission); refusal && !threw) {
        threw = true;
        report_error(*refusal);
        result = execution_failure(*refusal, options_.dev_mode);
    }

    // Only this call's own deadline is a TIMEOUT; a cancelled caller keeps the handler's result.
    // The handler's own result is already settled in the step's store (S7, an engine that waits):
    // where the step reserved the key, the TIMEOUT says a repeat with it is safe (R3).
    if (deadline && deadline->token().deadline_passed()) {
        result = detail::command_timed_out(definition.name, reported_timeout_ms,
                                           note && note->step_acted.load());
    } else if (threw) {
        return result;
    }

    // 7. on_command, which never changes the result.
    if (options_.on_command) {
#if AFD_HAS_EXCEPTIONS
        try {
            options_.on_command(definition.name, input, result);
        } catch (const std::exception& error) {
            report_error(error.what());
        } catch (...) {
            report_error("unknown exception");
        }
#else
        options_.on_command(definition.name, input, result);
#endif
    }
    return result;
}

namespace detail {

bool is_registry_next(const CommandContext& context, const Next& next) {
    ApprovalAdmission* record = context.approval_admission.get();
    if (!record) {
        return false;
    }
    const Next* address = &next;
    const std::less<const Next*> before;
    const std::lock_guard lock(record->mutex);
    if (record->chain_begin != nullptr && !before(address, record->chain_begin) &&
        before(address, record->chain_end)) {
        return true;
    }
    return std::find(record->inherited.begin(), record->inherited.end(), address) !=
           record->inherited.end();
}

std::optional<RepeatDeclaration> live_repeat_declaration(const CommandContext& context,
                                                         std::string_view name, const Next& next) {
    const ApprovalAdmission* record = context.approval_admission.get();
    if (record == nullptr || !record->running.load() || !record->command ||
        record->command->name != name || !is_registry_next(context, next)) {
        return std::nullopt;
    }
    return RepeatDeclaration{.mutation = static_cast<bool>(record->command->mutation),
                             .idempotency = record->command->idempotency,
                             .carries_key = record->carries_key};
}

InheritRegistryNext::InheritRegistryNext(CommandContext& context, const Next& outer,
                                         const Next& inner)
    : inner_(&inner) {
    if (is_registry_next(context, outer)) {
        record_ = context.approval_admission;
        const std::lock_guard lock(record_->mutex);
        record_->inherited.push_back(inner_);
    }
}

InheritRegistryNext::~InheritRegistryNext() {
    if (!record_) {
        return;
    }
    const std::lock_guard lock(record_->mutex);
    auto& inherited = record_->inherited;
    if (const auto it = std::find(inherited.begin(), inherited.end(), inner_);
        it != inherited.end()) {
        inherited.erase(it);
    }
}

} // namespace detail

CommandResult CommandRegistry::run_chain(const RegisteredCommand& command, const Json& input,
                                         CommandContext& context,
                                         detail::ApprovalAdmission& admission,
                                         bool check_output_budget,
                                         const detail::PreparedIdempotencyCall* step_call,
                                         detail::IdempotencyNote* note) const {
    std::vector<CommandMiddleware> middleware;
    {
        const std::shared_lock lock(mutex_);
        middleware = options_.middleware;
    }
    const auto& definition = command.definition;
    // Capture the B3 effective budget once before entering the chain so neither middleware nor a
    // handler mutating `context.output_budget` can bypass B5 on retry or raise the limit.
    const std::optional<std::uint64_t> effective_budget = context.output_budget;
    // The step's options for this call, and when the chain, and the deadline the registry or the
    // surface armed before it, started on the step's clock: a reservation's lease counts from
    // that deadline (S7).
    std::optional<detail::IdempotencyStep> idempotency_step;
    std::int64_t chain_started_at = 0;
    if (options_.idempotency) {
        idempotency_step = detail::IdempotencyStep{.store = options_.idempotency->store,
                                                   .ttl_ms = options_.idempotency->ttl_ms,
                                                   .lease_ms = options_.idempotency->lease_ms};
        chain_started_at = options_.clock->wall_ms();
    }

    // The innermost step: run the handler, check its output budget (B5-B6) and stamp its result.
    const Next run_handler = [&]() -> CommandResult {
        // A declared approval policy holds without the approval middleware: a command whose
        // policy is neither unset nor not_required, or that an approval step marked as gated by
        // its `commands` list, runs only when every approval step that admitted this dispatch
        // admitted this command on this validated input. A policy function is not evaluated
        // here. The admissions are taken from the record `execute` made for this call, so a
        // second dispatch (a retry inside the chain) needs a second one, and a record a middleware
        // put on the context from another call is not honoured.
        if (detail::needs_admission(admission)) {
            const auto check = detail::take_admission(admission, context, definition.name, input);
            if (check != detail::AdmissionCheck::admitted) {
                return approval_unavailable(definition.name, check);
            }
        }
        // Check cancellation again immediately before the handler starts (e.g. after a middleware
        // or approval wait), so a cancelled or already-timed-out call never runs its handler.
        if (context.cancellation.is_cancelled()) {
            return cancelled_before_start(definition.name);
        }
        // Restore the B3 effective budget before each attempt and on exit so a handler cannot
        // poison retries or outer middleware.
        context.output_budget = effective_budget;
        struct RestoreOutputBudget {
            CommandContext& target;
            std::optional<std::uint64_t> budget;
            ~RestoreOutputBudget() { target.output_budget = budget; }
        } const restore_budget{context, effective_budget};
        // The context's clock (the registry's unless the caller set one), read again here
        // because middleware may replace it.
        const std::shared_ptr<const Clock> clock = context.clock ? context.clock : options_.clock;
        const double start = clock->steady_ms();
        // The idempotency step sits here, between the admission check and the handler (S1). It
        // settles the reservation from the handler's own result before this link returns, so a
        // call that then gets TIMEOUT has its result stored already (S7).
        CommandResult result =
            idempotency_step
                ? detail::run_idempotency_step(
                      step_call ? std::optional<detail::PreparedIdempotencyCall>(*step_call)
                                : std::nullopt,
                      detail::IdempotencyRun{
                          .step = *idempotency_step,
                          .clock = *options_.clock,
                          .context = context,
                          .started_at = chain_started_at,
                          .handler = [&]() { return definition.handler(input, context); },
                          .on_reserved =
                              [note]() {
                                  if (note != nullptr) {
                                      note->step_acted.store(true);
                                  }
                              },
                          .report_error =
                              [this](std::string_view message) { report_error(message); }})
                : definition.handler(input, context);
        const double elapsed = clock->steady_ms() - start;
        if (check_output_budget && effective_budget) {
            result =
                detail::enforce_output_budget(definition, *effective_budget, std::move(result));
        }
        ResultMetadata metadata = result.metadata.value_or(ResultMetadata{});
        metadata.execution_time_ms = std::round((std::max)(0.0, elapsed));
        metadata.command_version = definition.version;
        if (context.trace_id && !context.trace_id->empty()) {
            metadata.trace_id = context.trace_id;
        }
        // Read the actor after the handler: middleware (auth) may have refined it.
        if (context.actor) {
            metadata.actor_kind = context.actor->kind;
        }
        result.metadata = std::move(metadata);
        return result;
    };

    // Build the chain from the inside out, so middleware[0] is outermost.
    std::vector<Next> chain(middleware.size() + 1);
    chain[middleware.size()] = run_handler;
    for (std::size_t i = middleware.size(); i-- > 0;) {
        const Next& inner = chain[i + 1];
        const CommandMiddleware& step = middleware[i];
        chain[i] = [&step, &inner, &definition, &input, &context]() {
            return step(definition.name, input, context, inner);
        };
    }
    // The continuations this chain hands its middleware, by address, so the journal reads the
    // declaration only for a recorder the registry invoked (journal_replay.cpp, `live_secret`).
    // Cleared by a destructor as the chain ends, so it holds without exceptions too.
    struct ChainExtent {
        detail::ApprovalAdmission& record;
        ChainExtent(detail::ApprovalAdmission& admitted, const std::vector<Next>& built)
            : record(admitted) {
            const std::lock_guard lock(record.mutex);
            record.chain_begin = built.data();
            record.chain_end = built.data() + built.size();
        }
        ChainExtent(const ChainExtent&) = delete;
        ChainExtent& operator=(const ChainExtent&) = delete;
        ~ChainExtent() {
            const std::lock_guard lock(record.mutex);
            record.chain_begin = nullptr;
            record.chain_end = nullptr;
        }
    } const extent{admission, chain};
    return chain.front()();
}

} // namespace afd

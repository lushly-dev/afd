#include "afd/direct_client.hpp"

#include "afd/similarity.hpp"

#include <algorithm>
#include <cmath>

#include "detail/direct_approval.hpp"
#include "detail/exceptions.hpp"
#include "detail/json_io.hpp"
#include "detail/output_budget.hpp"
#include "detail/random_unit.hpp"

namespace afd {
namespace {

// "trace-<ms>-<7 base-36 characters>", as TypeScript's generateTraceId.
std::string generate_trace_id(const Clock& clock, RandomSource& random) {
    constexpr char digits[] = "0123456789abcdefghijklmnopqrstuvwxyz";
    std::string suffix;
    for (int i = 0; i < 7; ++i) {
        suffix.push_back(digits[detail::random_index(random.next(), 36)]);
    }
    return "trace-" + std::to_string(clock.wall_ms()) + "-" + suffix;
}

CommandResult unknown_tool_failure(std::string_view name,
                                   const std::vector<std::string>& available) {
    const auto suggestions = find_similar_tools(name, available);
    const std::optional<std::string> hint =
        suggestions.empty()
            ? std::nullopt
            : std::optional<std::string>("Did you mean '" + suggestions.front() + "'?");
    const std::string message = "Tool '" + truncate_name(name) + "' not found in registry";

    Json data = {{"error", "UNKNOWN_TOOL"},
                 {"message", message},
                 {"requested_tool", std::string(name)},
                 {"available_tools", available},
                 {"suggestions", suggestions},
                 {"hint", hint ? Json(*hint) : Json(nullptr)}};
    CommandResult result = failure(create_error(
        error_codes::UNKNOWN_TOOL, message,
        {.suggestion = hint.value_or("Call one of the commands returned by list_command_names()"),
         .retryable = false}));
    result.data = std::move(data);
    return result;
}

} // namespace

DirectClient::DirectClient(std::shared_ptr<const CommandRegistry> registry,
                           DirectClientOptions options)
    : registry_(std::move(registry)), options_(std::move(options)),
      configured_clock_(options_.clock != nullptr), configured_random_(options_.random != nullptr) {
    if (!options_.clock) {
        options_.clock = std::make_shared<SystemClock>();
    }
    if (!options_.random) {
        options_.random = std::make_shared<SystemRandom>();
    }
}

bool DirectClient::is_allowed(std::string_view name) const {
    return !options_.allow || options_.allow(name);
}

std::vector<std::string> DirectClient::list_command_names() const {
    if (options_.surface == Interface::apps) {
        return {};
    }
    std::vector<std::string> names;
    for (const auto& command : registry_->list_by_exposure(options_.surface)) {
        if (is_allowed(command->definition.name)) {
            names.push_back(command->definition.name);
        }
    }
    return names;
}

bool DirectClient::has_command(std::string_view name) const {
    if (options_.surface == Interface::apps) {
        return false;
    }
    const auto command = registry_->get(name);
    return command && is_exposed_to(command->definition.expose, options_.surface) &&
           is_allowed(name);
}

CommandResult DirectClient::call(std::string_view name, const Json& args,
                                 CommandContext context) const {
    // App-to-app calls (`spec/command-metadata.md`, "App-to-app calls") go directly through
    // CommandRegistry::execute, never DirectClient (whose allow, UNKNOWN_TOOL and client
    // middleware would answer before call_grant).
    if (options_.surface == Interface::apps || context.surface == Interface::apps) {
        return failure(call_not_granted());
    }
    // 1. The client's own allow-list.
    if (!is_allowed(name)) {
        return failure(
            create_error(error_codes::COMMAND_NOT_ALLOWED,
                         "Command '" + truncate_name(name) + "' is not allowed for this client",
                         {.suggestion = "Call one of the commands returned by list_command_names()",
                          .retryable = false}));
    }
    // 2. Unknown to this client (unregistered, or not exposed to its surface).
    const auto command = registry_->get(name);
    if (!command || !is_exposed_to(command->definition.expose, options_.surface)) {
        return unknown_tool_failure(name, list_command_names());
    }

    // Public callers cannot supply approval authority, including a copied private marker.
    context.approval.reset();
    context.mcp_approval_relay.reset();
    context.output_budget_meta_ask.reset();
    context.direct_approval = std::make_shared<detail::DirectApprovalState>();
    const detail::DisposeDirectApproval cleanup{context.direct_approval};

    // 3. Context.
    if (!context.trace_id || context.trace_id->empty()) {
        context.trace_id = generate_trace_id(*options_.clock, *options_.random);
    }
    if (!context.actor) {
        context.actor = options_.actor;
    }
    if (!context.clock && configured_clock_) {
        context.clock = options_.clock;
    }
    if (!context.random && configured_random_) {
        context.random = options_.random;
    }
    context.surface = options_.surface;
    if (options_.source) {
        context.extra["source"] = *options_.source;
    }
    // Validate the output-budget ask and populate context.output_budget before client middleware
    // can observe or short-circuit the call (spec/output-budgets.md, B2-B4), while keeping
    // COMMAND_NOT_IN_CONTEXT ahead of validation when the active context blocks the command.
    const auto& contexts = command->definition.contexts;
    const bool in_context =
        !context.active_context || context.active_context->empty() || contexts.empty() ||
        std::find(contexts.begin(), contexts.end(), *context.active_context) != contexts.end();
    if (in_context) {
        if (auto invalid = detail::apply_output_budget(command->definition, context)) {
            return std::move(*invalid);
        }
    }

    // 4. Timeout: a deadline on the cancellation token, and a TIMEOUT result for a late finish.
    // The deadline token keeps the caller's token as its parent, so cancelling the caller (or a
    // pipeline's deadline) still reaches the handler, as with TypeScript's `AbortSignal.any`.
    // Snapshot the requested duration before dispatch and mark `deadline_armed` so the registry
    // does not stack a second later deadline on top.
    const std::optional<double> requested_timeout = context.timeout_ms;
    const std::optional<double> timeout =
        requested_timeout && std::isfinite(*requested_timeout) && *requested_timeout > 0
            ? std::optional<double>(
                  (std::min)(std::ceil(*requested_timeout), detail::max_timeout_ms))
            : std::nullopt;
    const double reported_timeout_ms = timeout ? *requested_timeout : 0.0;
    std::optional<CancellationSource> deadline;
    if (timeout) {
        deadline.emplace(context.cancellation, options_.clock->steady_ms() + *timeout,
                         options_.clock);
        context.cancellation = deadline->token();
        context.deadline_armed = true;
    }

    // 5. Client middleware around the registry.
    const std::string command_name(name);
    std::vector<Next> chain(options_.middleware.size() + 1);
    chain.back() = [&]() { return registry_->execute(command_name, args, context); };
    for (std::size_t i = options_.middleware.size(); i-- > 0;) {
        const Next& inner = chain[i + 1];
        const CommandMiddleware& step = options_.middleware[i];
        chain[i] = [&step, &inner, &command_name, &args, &context]() {
            return step(command_name, args, context, inner);
        };
    }

    CommandResult result;
#if AFD_HAS_EXCEPTIONS
    try {
        result = chain.front()();
    } catch (const std::exception& error) {
        if (deadline && deadline->token().deadline_passed()) {
            return detail::command_timed_out(command_name, reported_timeout_ms);
        }
        return execution_failure(error.what());
    } catch (...) {
        if (deadline && deadline->token().deadline_passed()) {
            return detail::command_timed_out(command_name, reported_timeout_ms);
        }
        return execution_failure("unknown exception");
    }
#else
    result = chain.front()();
#endif

    result = detail::public_approval_result(std::move(result));
    std::optional<detail::DirectApprovalHold> pending;
    {
        std::lock_guard lock(context.direct_approval->mutex);
        pending = context.direct_approval->hold;
    }
    if (!result.success && result.error && result.error->code == "APPROVAL_REQUIRED" && pending &&
        options_.on_approval_needed && !context.cancellation.is_cancelled()) {
        bool approved = false;
#if AFD_HAS_EXCEPTIONS
        try {
#endif
            approved = options_.on_approval_needed(
                DirectApprovalRequest{.command = command_name,
                                      .input = args,
                                      .summary = pending->summary,
                                      .expires_at = pending->expires_at,
                                      .reason = pending->reason,
                                      .cancellation = context.cancellation});
#if AFD_HAS_EXCEPTIONS
        } catch (...) {
            approved = false;
        }
#endif
        if (approved && !context.cancellation.is_cancelled()) {
            {
                std::lock_guard lock(context.direct_approval->mutex);
                context.direct_approval->evidence = pending->token;
                context.direct_approval->hold.reset();
            }
#if AFD_HAS_EXCEPTIONS
            try {
                result = chain.front()();
            } catch (...) {
                result = execution_failure("approval retry failed");
            }
#else
            result = chain.front()();
#endif
            result = detail::public_approval_result(std::move(result));
        }
    }

    // Only this call's own deadline is a TIMEOUT; a cancelled caller gets the handler's result.
    if (deadline && deadline->token().deadline_passed()) {
        return detail::command_timed_out(command_name, reported_timeout_ms);
    }
    return result;
}

PipelineResult DirectClient::pipe(const PipelineRequest& request, CommandContext context) const {
    return pipe(Json(request), std::move(context));
}

PipelineResult DirectClient::pipe(const Json& request, CommandContext context) const {
    if (!context.trace_id || context.trace_id->empty()) {
        context.trace_id = generate_trace_id(*options_.clock, *options_.random);
    }
    const std::string trace = *context.trace_id;
    std::size_t step = 0;
    const CommandExecutor execute = [&](std::string_view name, const Json& input,
                                        CommandContext& step_context) {
        CommandContext call_context = step_context;
        call_context.trace_id = trace + "-step-" + std::to_string(step++);
        return call(name, input, call_context);
    };
    return execute_pipeline(request, execute, context,
                            {.clock = options_.clock, .random = options_.random});
}

} // namespace afd

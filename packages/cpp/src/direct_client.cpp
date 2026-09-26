#include "afd/direct_client.hpp"

#include "afd/similarity.hpp"

#include <algorithm>
#include <cmath>

#include "detail/exceptions.hpp"
#include "detail/json_io.hpp"

namespace afd {
namespace {

// Node timers fire at once for delays above 2^31 - 1 ms, so TypeScript caps timeouts there.
constexpr double max_timeout_ms = 2147483647.0;

// "trace-<ms>-<7 base-36 characters>", as TypeScript's generateTraceId.
std::string generate_trace_id(const Clock& clock, RandomSource& random) {
    constexpr char digits[] = "0123456789abcdefghijklmnopqrstuvwxyz";
    std::string suffix;
    for (int i = 0; i < 7; ++i) {
        suffix.push_back(digits[static_cast<std::size_t>(random.next() * 36.0)]);
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
    : registry_(std::move(registry)), options_(std::move(options)) {
    if (!options_.clock) {
        options_.clock = std::make_shared<SystemClock>();
    }
    if (!options_.random) {
        options_.random = std::make_shared<SeededRandom>();
    }
}

bool DirectClient::is_allowed(std::string_view name) const {
    return !options_.allow || options_.allow(name);
}

std::vector<std::string> DirectClient::list_command_names() const {
    std::vector<std::string> names;
    for (const auto& command : registry_->list_by_exposure(options_.surface)) {
        if (is_allowed(command->definition.name)) {
            names.push_back(command->definition.name);
        }
    }
    return names;
}

bool DirectClient::has_command(std::string_view name) const {
    const auto command = registry_->get(name);
    return command && is_exposed_to(command->definition.expose, options_.surface) &&
           is_allowed(name);
}

CommandResult DirectClient::call(std::string_view name, const Json& args,
                                 CommandContext context) const {
    // 1. The client's own allow-list.
    if (!is_allowed(name)) {
        return failure(
            create_error(error_codes::COMMAND_NOT_ALLOWED,
                         "Command '" + truncate_name(name) + "' is not allowed for this client",
                         {.suggestion = "Call one of the commands returned by list_command_names()",
                          .retryable = false}));
    }
    // 2. Unknown to this client (unregistered, or not exposed to its surface).
    if (!has_command(name)) {
        return unknown_tool_failure(name, list_command_names());
    }

    // 3. Context.
    if (!context.trace_id || context.trace_id->empty()) {
        context.trace_id = generate_trace_id(*options_.clock, *options_.random);
    }
    context.surface = options_.surface;
    if (options_.source) {
        context.extra["source"] = *options_.source;
    }

    // 4. Timeout: a deadline on the cancellation token, and a TIMEOUT result for a late finish.
    const std::optional<double> timeout =
        context.timeout_ms && std::isfinite(*context.timeout_ms) && *context.timeout_ms > 0
            ? std::optional<double>((std::min)(std::ceil(*context.timeout_ms), max_timeout_ms))
            : std::nullopt;
    std::optional<CancellationSource> deadline;
    if (timeout) {
        deadline.emplace(options_.clock->steady_ms() + *timeout, options_.clock);
        context.cancellation = deadline->token();
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
        return execution_failure(error.what());
    } catch (...) {
        return execution_failure("unknown exception");
    }
#else
    result = chain.front()();
#endif

    if (deadline && deadline->token().is_cancelled()) {
        return failure(create_error(
            error_codes::TIMEOUT,
            "Command '" + truncate_name(name) + "' timed out after " +
                detail::format_number(*context.timeout_ms) + "ms",
            {.suggestion =
                 "Retry with a larger timeout. The command was signalled to abort but may have "
                 "completed, so check its effect before retrying a mutation.",
             .retryable = true,
             .details = Json{{"command", command_name},
                             {"timeoutMs", wire::number(*context.timeout_ms)}}}));
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

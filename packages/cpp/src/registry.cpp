#include "afd/registry.hpp"

#include "afd/similarity.hpp"

#include <algorithm>
#include <cmath>
#include <mutex>

#include "detail/exceptions.hpp"

namespace afd {
namespace {

constexpr std::size_t max_not_found_matches = 3;

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

// TypeScript's notFoundSuggestion. The unknown name is untrusted and never echoed.
std::string not_found_suggestion(std::string_view name,
                                 const std::vector<std::string>& candidates) {
    const std::string discover = "Use afd-discover to list all commands.";
    const auto matches = find_similar_tools(name, candidates, max_not_found_matches);
    if (matches.empty()) {
        return discover;
    }
    std::string also_close;
    if (matches.size() > 1) {
        also_close = " Other close matches: ";
        for (std::size_t i = 1; i < matches.size(); ++i) {
            also_close += (i > 1 ? ", '" : "'") + matches[i] + "'";
        }
        also_close += ".";
    }
    return "Did you mean '" + matches.front() + "'?" + also_close + " " + discover;
}

std::string issue_summary(const ValidationFailure& failure) {
    std::string out;
    for (const auto& issue : failure.errors) {
        out += (out.empty() ? "" : ", ") + issue.path + ": " + issue.message;
    }
    return out;
}

} // namespace

CommandRegistry::CommandRegistry(RegistryOptions options) : options_(std::move(options)) {
    if (!options_.clock) {
        options_.clock = std::make_shared<SystemClock>();
    }
    if (!options_.runner) {
        options_.runner = std::make_shared<InlineTaskRunner>();
    }
    if (!options_.random) {
        options_.random = std::make_shared<SeededRandom>();
    }
}

ExecutorOptions CommandRegistry::executor_options() const {
    return {.dev_mode = options_.dev_mode,
            .clock = options_.clock,
            .random = options_.random,
            .runner = options_.runner};
}

CommandExecutor CommandRegistry::executor() const {
    return [this](std::string_view name, const Json& input, CommandContext& context) {
        return execute(name, input, context);
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
    return afd::execute_stream(name, input, executor(), context, options);
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

void CommandRegistry::use(Middleware middleware) {
    const std::unique_lock lock(mutex_);
    options_.middleware.push_back(std::move(middleware));
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
    std::shared_ptr<const RegisteredCommand> command;
    std::vector<std::string> candidates;
    std::vector<std::string> exposed_names;
    {
        const std::shared_lock lock(mutex_);
        if (const auto it = commands_.find(name); it != commands_.end()) {
            command = it->second;
        }
        for (const auto& entry : order_) {
            const auto& definition = entry->definition;
            const bool exposed =
                !context.surface || is_exposed_to(definition.expose, *context.surface);
            if (exposed) {
                exposed_names.push_back(definition.name);
            }
            if (exposed && is_accessible_in_context(definition, context.active_context)) {
                candidates.push_back(definition.name);
            }
        }
    }

    // 1-2. Lookup and exposure. A command hidden from this surface is reported as not exposed,
    // and never offered as a suggestion.
    if (!command) {
        return failure(create_error(error_codes::COMMAND_NOT_FOUND,
                                    "Command '" + truncate_name(name) + "' not found",
                                    {.suggestion = not_found_suggestion(name, candidates)}));
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
             .retryable = false}));
    }

    // 3. Context.
    if (!is_accessible_in_context(definition, context.active_context)) {
        return failure(create_error(error_codes::COMMAND_NOT_IN_CONTEXT,
                                    "Command '" + definition.name +
                                        "' is not available in context '" +
                                        *context.active_context + "'",
                                    {.suggestion = "Use afd-context-list to see available "
                                                   "contexts, or afd-context-enter to switch."}));
    }

    // 4. Validation.
    auto validated = command->input_schema.validate(input);
    if (!validated) {
        return failure(validation_failure_error(validated.error()));
    }

    // 5-6. Middleware and handler.
    CommandResult result;
#if AFD_HAS_EXCEPTIONS
    try {
        result = run_chain(*command, *validated, context);
    } catch (const std::exception& error) {
        report_error(error.what());
        return execution_failure(error.what(), options_.dev_mode);
    } catch (...) {
        report_error("unknown exception");
        return execution_failure("unknown exception", options_.dev_mode);
    }
#else
    result = run_chain(*command, *validated, context);
#endif

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

CommandResult CommandRegistry::run_chain(const RegisteredCommand& command, const Json& input,
                                         CommandContext& context) const {
    std::vector<Middleware> middleware;
    {
        const std::shared_lock lock(mutex_);
        middleware = options_.middleware;
    }
    const auto& definition = command.definition;
    const Clock& clock = *options_.clock;

    // The innermost step: run the handler and stamp its result (a copy; never in place).
    const Next run_handler = [&]() -> CommandResult {
        const double start = clock.steady_ms();
        CommandResult result = definition.handler(input, context);
        const double elapsed = clock.steady_ms() - start;
        ResultMetadata metadata = result.metadata.value_or(ResultMetadata{});
        metadata.execution_time_ms = std::round(elapsed);
        metadata.command_version = definition.version;
        if (context.trace_id && !context.trace_id->empty()) {
            metadata.trace_id = context.trace_id;
        }
        result.metadata = std::move(metadata);
        return result;
    };

    // Build the chain from the inside out, so middleware[0] is outermost.
    std::vector<Next> chain(middleware.size() + 1);
    chain[middleware.size()] = run_handler;
    for (std::size_t i = middleware.size(); i-- > 0;) {
        const Next& inner = chain[i + 1];
        const Middleware& step = middleware[i];
        chain[i] = [&step, &inner, &definition, &input, &context]() {
            return step(definition.name, input, context, inner);
        };
    }
    return chain.front()();
}

} // namespace afd

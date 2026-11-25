// Contexts and the context commands (contexts.hpp). Rust's src/contexts.rs, in the same words.
#include "afd/contexts.hpp"

#include "afd/errors.hpp"
#include "afd/registry.hpp"
#include "afd/result.hpp"

#include <algorithm>
#include <memory>
#include <set>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "detail/caller_allow.hpp"

namespace afd {

ContextStack::ContextStack(std::size_t max_depth) : max_depth_(max_depth < 1 ? 1 : max_depth) {}

std::optional<std::string> ContextStack::active() const {
    const std::lock_guard lock(mutex_);
    if (entries_.empty()) {
        return std::nullopt;
    }
    return entries_.back();
}

std::vector<std::string> ContextStack::entries() const {
    const std::lock_guard lock(mutex_);
    return entries_;
}

bool ContextStack::enter(std::string name) {
    const std::lock_guard lock(mutex_);
    if (!entries_.empty() && entries_.back() == name) {
        return true;
    }
    if (entries_.size() >= max_depth_) {
        return false;
    }
    entries_.push_back(std::move(name));
    return true;
}

std::optional<std::string> ContextStack::exit() {
    const std::lock_guard lock(mutex_);
    if (entries_.empty()) {
        return std::nullopt;
    }
    std::string exited = std::move(entries_.back());
    entries_.pop_back();
    return exited;
}

namespace {

std::string stateless_hint() {
    return "Context changes do not persist between stateless MCP requests. Send _meta[\"" +
           std::string(context_meta_key) +
           "\"] with the context name on each tools/list and tools/call request instead.";
}

CommandResult session_required() {
    return failure(create_error(
        error_codes::SESSION_REQUIRED,
        "Entering or exiting a context needs an MCP session, and this request has none",
        {.suggestion = "Send _meta[\"" + std::string(context_meta_key) +
                       "\"] with the context name on each tools/list and tools/call request, or "
                       "connect over stdio, which keeps one context stack per connection",
         .retryable = false}));
}

// Whether the caller of one context command can call another, decided once for its suggestion and
// recovery (spec/recovery.md, "Engine errors"). The three are registered, exposed and scoped as a
// unit, so a caller that reached one can call another unless its client's allow list refuses it.
bool can_call_context_command(const CommandContext& context, std::string_view name) {
    return detail::caller_allows(context, name);
}

CommandResult done(Json data, std::string reasoning) {
    return success(std::move(data), {.confidence = 1.0, .reasoning = std::move(reasoning)});
}

Json optional_name(const std::optional<std::string>& name) {
    return name ? Json(*name) : Json(nullptr);
}

CommandDefinition context_command(std::string name, std::string description, Json input_schema,
                                  bool mutation, CommandHandler handler) {
    CommandDefinition command;
    command.name = std::move(name);
    command.description = std::move(description);
    command.category = "bootstrap";
    command.input_schema = std::move(input_schema);
    command.handler = std::move(handler);
    command.version = "1.0.0";
    command.tags = mutation ? std::vector<std::string>{"bootstrap", "write", "context"}
                            : std::vector<std::string>{"bootstrap", "read", "safe", "context"};
    command.mutation = mutation;
    command.expose.mcp = true;
    return command;
}

} // namespace

std::vector<CommandDefinition> context_commands(std::vector<ContextConfig> configured) {
    auto contexts = std::make_shared<const std::vector<ContextConfig>>(std::move(configured));
    const Json no_input{{"type", "object"}, {"properties", Json::object()}};

    auto list = [contexts](const Json&, CommandContext& context) -> CommandResult {
        const std::optional<std::string> active =
            context.context_scope ? context.context_scope->active() : context.active_context;
        std::vector<const ContextConfig*> ordered;
        for (const auto& config : *contexts) {
            ordered.push_back(&config);
        }
        std::stable_sort(ordered.begin(), ordered.end(), [](const auto* a, const auto* b) {
            return a->priority.value_or(0) > b->priority.value_or(0);
        });
        Json listed = Json::array();
        for (const auto* config : ordered) {
            Json entry{{"name", config->name}};
            if (config->description && !config->description->empty()) {
                entry["description"] = *config->description;
            }
            if (!config->triggers.empty()) {
                entry["triggers"] = config->triggers;
            }
            if (config->priority) {
                entry["priority"] = *config->priority;
            }
            listed.push_back(std::move(entry));
        }
        std::string reasoning = "Found " + std::to_string(listed.size()) +
                                " configured contexts. Active: " + active.value_or("none");
        return done(Json{{"contexts", std::move(listed)}, {"activeContext", optional_name(active)}},
                    std::move(reasoning));
    };

    auto enter = [contexts](const Json& input, CommandContext& context) -> CommandResult {
        const auto scope = context.context_scope;
        if (!scope) {
            return session_required();
        }
        const std::string name = input.contains("context") && input["context"].is_string()
                                     ? input["context"].get<std::string>()
                                     : std::string();
        const bool known =
            std::any_of(contexts->begin(), contexts->end(),
                        [&](const ContextConfig& config) { return config.name == name; });
        if (!known) {
            std::string available;
            for (const auto& config : *contexts) {
                available += (available.empty() ? "" : ", ") + config.name;
            }
            const bool can_list = can_call_context_command(context, "afd-context-list");
            return failure(create_error(
                error_codes::CONTEXT_NOT_FOUND, "Context '" + name + "' is not configured",
                {.suggestion = "Available contexts: " + available +
                               (can_list ? ". Use afd-context-list to see all contexts." : "."),
                 .retryable = false,
                 .recovery = can_list
                                 ? std::optional<Recovery>(Recovery{.kind = RecoveryKind::call,
                                                                    .command = "afd-context-list"})
                                 : std::nullopt}));
        }
        const std::optional<std::string> previous = scope->active();
        if (!scope->session) {
            return done(Json{{"entered", name},
                             {"previous", optional_name(previous)},
                             {"persisted", false}},
                        stateless_hint());
        }
        if (previous == name) {
            return done(Json{{"entered", name}, {"previous", optional_name(previous)}},
                        "Already in context '" + name + "'; nothing changed");
        }
        if (!scope->session->enter(name)) {
            const bool can_exit = can_call_context_command(context, "afd-context-exit");
            return failure(create_error(
                error_codes::CONTEXT_DEPTH_EXCEEDED,
                "Context stack is limited to " + std::to_string(scope->session->max_depth()) +
                    " levels",
                {.suggestion =
                     can_exit ? "Call afd-context-exit to leave a context before entering another"
                              : "Leave a context before entering another",
                 .retryable = false,
                 .recovery = can_exit
                                 ? std::optional<Recovery>(Recovery{.kind = RecoveryKind::call,
                                                                    .command = "afd-context-exit",
                                                                    .then_retry = true})
                                 : std::nullopt}));
        }
        const std::string was = previous ? " (was '" + *previous + "')" : "";
        return done(Json{{"entered", name}, {"previous", optional_name(previous)}},
                    "Entered context '" + name + "'" + was);
    };

    auto exit = [](const Json&, CommandContext& context) -> CommandResult {
        const auto scope = context.context_scope;
        if (!scope) {
            return session_required();
        }
        if (!scope->session) {
            return done(Json{{"exited", nullptr},
                             {"current", optional_name(scope->request)},
                             {"persisted", false}},
                        stateless_hint());
        }
        const std::optional<std::string> exited = scope->session->exit();
        const std::optional<std::string> current = scope->session->active();
        std::string reasoning;
        if (!exited) {
            reasoning = "No active context to exit";
        } else if (current) {
            reasoning = "Exited context '" + *exited + "', now in '" + *current + "'";
        } else {
            reasoning = "Exited context '" + *exited + "', no active context";
        }
        return done(Json{{"exited", optional_name(exited)}, {"current", optional_name(current)}},
                    std::move(reasoning));
    };

    std::vector<CommandDefinition> commands;
    commands.push_back(
        context_command("afd-context-list",
                        "List all configured contexts with descriptions, priorities, and triggers",
                        no_input, false, std::move(list)));
    commands.push_back(context_command(
        "afd-context-enter", "Enter a context to scope available tools",
        Json{{"type", "object"},
             {"properties",
              {{"context",
                {{"type", "string"}, {"minLength", 1}, {"description", "Context name to enter"}}}}},
             {"required", Json::array({"context"})}},
        true, std::move(enter)));
    commands.push_back(context_command("afd-context-exit",
                                       "Exit the current context, popping back to the previous one",
                                       no_input, true, std::move(exit)));
    return commands;
}

std::optional<std::string> register_context_commands(CommandRegistry& registry,
                                                     std::vector<ContextConfig> contexts) {
    if (contexts.empty()) {
        return "Configure at least one context";
    }
    std::set<std::string> seen;
    for (const auto& config : contexts) {
        if (config.name.find_first_not_of(" \t\r\n") == std::string::npos) {
            return "Context names must not be blank";
        }
        if (!seen.insert(config.name).second) {
            return "Context '" + config.name + "' is configured twice";
        }
    }
    for (const auto name : afd_context_command_names) {
        if (registry.has(name)) {
            return "Reserved context command name: " + std::string(name);
        }
    }
    for (auto& command : context_commands(std::move(contexts))) {
        if (auto error = registry.register_command(std::move(command))) {
            return error;
        }
    }
    return std::nullopt;
}

} // namespace afd

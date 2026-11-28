#include "commands/shared.hpp"

#include <algorithm>
#include <cmath>
#include <utility>

#include <afd/actor.hpp>
#include <afd/json.hpp>
#include <afd/runtime.hpp>

namespace todo::detail {
namespace {

/// How to find a todo that is not live: the list, or the deleted list and todo-restore.
constexpr const char* not_found_suggestion =
    "Use todo-list to see available todos. If it was deleted, find it with todo-list { deleted: "
    "true } and bring it back with todo-restore.";

/// Adds a successful change to the history: who (the context's actor), when (the context's
/// clock), which todos, and the undo the result named.
void record(TodoStore& store, const Command& command, const CommandResult& result,
            const CommandContext& context) {
    if (!result.data || !command.changed) {
        return;
    }
    auto ids = command.changed(*result.data);
    if (ids.empty()) {
        return;
    }
    Change change;
    change.at = now_iso(context);
    if (context.actor) {
        change.actor_kind = std::string(afd::actor_kind_name(context.actor->kind));
        change.actor_id = context.actor->id;
    } else {
        change.actor_kind = "unknown";
    }
    change.command = command.name;
    change.ids = std::move(ids);
    change.undo_command = result.undo_command;
    change.undo_args = result.undo_args;
    store.record(std::move(change));
}

} // namespace

afd::CommandDefinition define(Command command, std::shared_ptr<TodoStore> store) {
    afd::CommandDefinition definition;
    definition.name = command.name;
    definition.title = command.title;
    definition.description = command.description;
    definition.category = "todo";
    definition.input_schema = command.input;
    definition.output_schema = command.output;
    definition.version = "1.0.0";
    definition.tags = command.tags;
    definition.prerequisites = command.requires_first;
    definition.contexts = command.mutation ? edit_contexts : read_contexts;
    definition.errors = command.errors;
    definition.mutation = command.mutation;
    definition.idempotency = command.idempotency;
    definition.destructive = command.destructive;
    definition.undoable = command.undoable;
    definition.confirm_prompt = command.confirm_prompt;
    definition.examples = command.examples;
    // The todo commands are meant for remote agents; the default keeps MCP closed.
    definition.expose = afd::ExposeOptions{.mcp = true};
    if (command.approval) {
        definition.approval = command.approval;
    } else if (command.mutation) {
        definition.approval = afd::ApprovalDecision::not_required;
    }
    auto shared = std::make_shared<const Command>(std::move(command));
    // Named apart from the parameter: GCC's -Wshadow flags an init-capture that reuses it.
    definition.handler = [shared, todos = std::move(store)](const Json& input,
                                                            CommandContext& context) {
        if (!shared->mutation) {
            return shared->run(input, context);
        }
        // The change and its history entry under one lock, so entries keep the changes' order.
        const auto changing = todos->changing();
        CommandResult result = shared->run(input, context);
        if (result.success) {
            record(*todos, *shared, result, context);
        }
        return result;
    };
    return definition;
}

std::string Stamp::new_id() const {
    constexpr char digits[] = "0123456789abcdefghijklmnopqrstuvwxyz";
    // Math.floor(random.next() * 36 ** 7).toString(36).padStart(7, '0').
    auto value = static_cast<std::uint64_t>(std::floor(random->next() * std::pow(36.0, 7)));
    std::string suffix;
    do {
        suffix.insert(suffix.begin(), digits[value % 36]);
        value /= 36;
    } while (value != 0);
    while (suffix.size() < 7) {
        suffix.insert(suffix.begin(), '0');
    }
    return "todo-" + std::to_string(at) + "-" + suffix;
}

std::string now_iso(const CommandContext& context) {
    static const afd::SystemClock system_clock;
    const afd::Clock& clock = context.clock ? *context.clock : system_clock;
    return afd::wire::iso8601_utc(clock.wall_ms());
}

Stamp stamp(const CommandContext& context) {
    static const afd::SystemClock system_clock;
    const afd::Clock& clock = context.clock ? *context.clock : system_clock;
    Stamp result;
    result.at = clock.wall_ms();
    result.now = afd::wire::iso8601_utc(result.at);
    result.random = context.random ? context.random : std::make_shared<afd::SystemRandom>();
    return result;
}

afd::CommandError not_found(const std::string& id) {
    return afd::create_error(afd::error_codes::NOT_FOUND,
                             "Todo with ID " + in_quotes(id) + " not found",
                             {.suggestion = not_found_suggestion});
}

afd::Warning warning(const char* code, std::string message, afd::WarningSeverity severity) {
    return afd::Warning{code, std::move(message), severity, std::nullopt};
}

const char* plural(std::int64_t count) {
    return count == 1 ? "" : "s";
}

std::string in_quotes(const std::string& text) {
    return "\"" + text + "\"";
}

double batch_confidence(std::int64_t succeeded, std::int64_t total) {
    return total > 0 ? static_cast<double>(succeeded) / static_cast<double>(total) : 0;
}

std::vector<std::string> ids_in(const Json& value) {
    std::vector<std::string> ids;
    if (value.is_array()) {
        for (const auto& id : value) {
            if (id.is_string()) {
                ids.push_back(id.get<std::string>());
            }
        }
    }
    return ids;
}

std::vector<std::string> todo_ids_in(const Json& value) {
    std::vector<std::string> ids;
    if (value.is_array()) {
        for (const auto& todo : value) {
            if (todo.is_object() && todo.contains("id") && todo["id"].is_string()) {
                ids.push_back(todo["id"].get<std::string>());
            }
        }
    }
    return ids;
}

std::vector<std::string> todo_id_in(const Json& data) {
    if (data.is_object() && data.contains("id") && data["id"].is_string()) {
        return {data["id"].get<std::string>()};
    }
    return {};
}

std::optional<std::string> string_field(const Json& input, const char* key) {
    const auto it = input.find(key);
    return it != input.end() && it->is_string() ? std::optional<std::string>(it->get<std::string>())
                                                : std::nullopt;
}

std::optional<bool> bool_field(const Json& input, const char* key) {
    const auto it = input.find(key);
    return it != input.end() && it->is_boolean() ? std::optional<bool>(it->get<bool>())
                                                 : std::nullopt;
}

std::int64_t integer_field(const Json& input, const char* key, std::int64_t fallback) {
    const auto it = input.find(key);
    if (it == input.end() || !it->is_number()) {
        return fallback;
    }
    // The schemas bound `limit` but not `offset`, and casting a double beyond int64 is
    // undefined: clamp to [0, 2^53 - 1], the largest integer TypeScript accepts.
    constexpr double max_safe_integer = 9007199254740991.0;
    const double value = it->get<double>();
    return value > 0 ? static_cast<std::int64_t>((std::min)(value, max_safe_integer)) : 0;
}

namespace schema {

Json title(const char* description) {
    return {{"type", "string"}, {"minLength", 1}, {"maxLength", 200}, {"description", description}};
}

Json description(const char* description) {
    return {{"type", "string"}, {"maxLength", 1000}, {"description", description}};
}

Json priority(const char* description) {
    return {{"type", "string"}, {"enum", {"low", "medium", "high"}}, {"description", description}};
}

Json priority_with_default() {
    return {{"type", "string"},
            {"enum", {"low", "medium", "high"}},
            {"default", "medium"},
            {"description", "Priority: low, medium or high"}};
}

Json id() {
    return {{"type", "string"}, {"minLength", 1}, {"description", "Todo ID"}};
}

Json ids() {
    return {{"type", "array"},
            {"items", {{"type", "string"}, {"minLength", 1}}},
            {"minItems", 1},
            {"maxItems", 100},
            {"description", "Todo IDs (1-100)"}};
}

Json id_input() {
    return {{"type", "object"}, {"properties", {{"id", id()}}}, {"required", Json::array({"id"})}};
}

Json ids_input() {
    return {
        {"type", "object"}, {"properties", {{"ids", ids()}}}, {"required", Json::array({"ids"})}};
}

Json todo() {
    const Json text{{"type", "string"}};
    return {{"type", "object"},
            {"description", "A todo"},
            {"properties",
             {{"id", text},
              {"title", text},
              {"description", text},
              {"priority", {{"type", "string"}, {"enum", {"low", "medium", "high"}}}},
              {"completed", {{"type", "boolean"}}},
              {"createdAt", text},
              {"updatedAt", text},
              {"completedAt", text},
              {"deletedAt",
               {{"type", "string"},
                {"description", "When it was deleted; set only on a deleted todo"}}}}},
            {"required", {"id", "title", "priority", "completed", "createdAt", "updatedAt"}}};
}

Json todos() {
    return {{"type", "array"}, {"items", todo()}};
}

Json strings() {
    return {{"type", "array"}, {"items", {{"type", "string"}}}};
}

Json failed() {
    const Json error{{"type", "object"},
                     {"description", "What failed and how to recover"},
                     {"properties",
                      {{"code", {{"type", "string"}}},
                       {"message", {{"type", "string"}}},
                       {"suggestion", {{"type", "string"}}}}},
                     {"required", {"code", "message"}}};
    return {{"type", "array"},
            {"items",
             {{"type", "object"},
              {"properties",
               {{"index", {{"type", "integer"}}},
                {"id", {{"type", "string"}}},
                {"input", {{"type", "object"}}},
                {"error", error}}},
              {"required", {"index", "error"}}}}};
}

Json summary() {
    return {{"type", "object"},
            {"properties",
             {{"total", {{"type", "integer"}}},
              {"successCount", {{"type", "integer"}}},
              {"failureCount", {{"type", "integer"}}}}},
            {"required", {"total", "successCount", "failureCount"}}};
}

} // namespace schema
} // namespace todo::detail

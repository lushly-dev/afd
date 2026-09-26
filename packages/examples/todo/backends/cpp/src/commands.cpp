#include "commands.hpp"

#include <cmath>
#include <string_view>
#include <utility>
#include <vector>

#include "spec.hpp"
#include <afd/result.hpp>

namespace todo {
namespace {

using afd::CommandContext;
using afd::CommandResult;
using afd::Json;

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
    return it != input.end() && it->is_number() ? static_cast<std::int64_t>(it->get<double>())
                                                : fallback;
}

std::string in_quotes(const std::string& text) {
    return "\"" + text + "\"";
}

afd::CommandError not_found(const std::string& id) {
    return afd::create_error(afd::error_codes::NOT_FOUND,
                             "Todo with ID " + in_quotes(id) + " not found",
                             {.suggestion = "Use todo-list to see available todos"});
}

// JavaScript's String.prototype.trim(): its whitespace and line terminators.
std::string js_trim(const std::string& text) {
    const auto is_space = [&](std::size_t at, std::size_t& length) {
        static const std::vector<std::string_view> spaces = {
            "\t",           "\n",           "\v",
            "\f",           "\r",           " ",
            "\xC2\xA0",     "\xE1\x9A\x80", "\xE2\x80\x80",
            "\xE2\x80\x81", "\xE2\x80\x82", "\xE2\x80\x83",
            "\xE2\x80\x84", "\xE2\x80\x85", "\xE2\x80\x86",
            "\xE2\x80\x87", "\xE2\x80\x88", "\xE2\x80\x89",
            "\xE2\x80\x8A", "\xE2\x80\xA8", "\xE2\x80\xA9",
            "\xE2\x80\xAF", "\xE2\x81\x9F", "\xE3\x80\x80",
            "\xEF\xBB\xBF"};
        const std::string_view rest = std::string_view(text).substr(at);
        for (const auto space : spaces) {
            if (rest.substr(0, space.size()) == space) {
                length = space.size();
                return true;
            }
        }
        return false;
    };
    std::size_t begin = 0;
    std::size_t length = 0;
    while (begin < text.size() && is_space(begin, length)) {
        begin += length;
    }
    std::size_t end = text.size();
    for (bool trimmed = true; trimmed && end > begin;) {
        trimmed = false;
        for (std::size_t width = 1; width <= 3 && width <= end - begin; ++width) {
            if (is_space(end - width, length) && length == width) {
                end -= width;
                trimmed = true;
                break;
            }
        }
    }
    return text.substr(begin, end - begin);
}

afd::Warning warning(const char* code, std::string message, afd::WarningSeverity severity) {
    return afd::Warning{code, std::move(message), severity, std::nullopt};
}

afd::CommandDefinition command(const char* name, const char* description,
                               std::vector<std::string> tags, bool mutation, afd::Handler handler) {
    afd::CommandDefinition definition;
    definition.name = name;
    definition.description = description;
    definition.category = "todo";
    definition.input_schema = input_schema(name);
    definition.handler = std::move(handler);
    definition.version = "1.0.0";
    definition.tags = std::move(tags);
    definition.mutation = mutation;
    definition.expose = afd::ExposeOptions{.mcp = true};
    return definition;
}

} // namespace

std::optional<std::string> register_todo_commands(afd::CommandRegistry& registry,
                                                  std::shared_ptr<TodoStore> store) {
    std::vector<afd::CommandDefinition> commands;

    auto create = command(
        "todo-create", "Create a new todo item", {"todo", "create", "write", "single"}, true,
        [store](const Json& input, CommandContext&) {
            const std::string priority = input.value("priority", std::string("medium"));
            const Todo todo = store->create(input["title"].get<std::string>(),
                                            string_field(input, "description"), priority);
            return afd::success(todo, {.confidence = 1.0,
                                       .reasoning = "Created todo " + in_quotes(todo.title) +
                                                    " with " + priority + " priority"});
        });
    create.errors = {"VALIDATION_ERROR"};
    create.contexts = {"todo-editing"};
    commands.push_back(std::move(create));

    auto get = command("todo-get", "Get a single todo by ID", {"todo", "get", "read", "single"},
                       false, [store](const Json& input, CommandContext&) {
                           const std::string id = input["id"].get<std::string>();
                           const auto todo = store->get(id);
                           if (!todo) {
                               return afd::failure(not_found(id));
                           }
                           return afd::success(
                               *todo, {.confidence = 1.0,
                                       .reasoning = "Retrieved todo " + in_quotes(todo->title)});
                       });
    get.errors = {"NOT_FOUND"};
    get.contexts = {"todo-editing", "todo-reading"};
    commands.push_back(std::move(get));

    auto list = command(
        "todo-list", "List todos with optional filtering and pagination", {"todo", "list", "read"},
        false, [store](const Json& input, CommandContext&) {
            TodoFilter filter;
            filter.completed = bool_field(input, "completed");
            filter.priority = string_field(input, "priority");
            filter.search = string_field(input, "search");
            filter.sort_by = input.value("sortBy", std::string("createdAt"));
            filter.sort_order = input.value("sortOrder", std::string("desc"));
            filter.limit = integer_field(input, "limit", 20);
            filter.offset = integer_field(input, "offset", 0);

            const auto todos = store->list(filter);
            TodoFilter matching;
            matching.completed = filter.completed;
            matching.priority = filter.priority;
            matching.search = filter.search;
            matching.limit = std::numeric_limits<std::int64_t>::max();
            const auto total = static_cast<std::int64_t>(store->list(matching).size());
            const bool has_more = filter.offset + static_cast<std::int64_t>(todos.size()) < total;

            std::vector<std::string> filters;
            if (filter.completed) {
                filters.push_back(*filter.completed ? "completed" : "pending");
            }
            if (filter.priority && !filter.priority->empty()) {
                filters.push_back(*filter.priority + " priority");
            }
            if (filter.search && !filter.search->empty()) {
                filters.push_back("matching " + in_quotes(*filter.search));
            }
            std::string filter_text;
            for (const auto& part : filters) {
                filter_text += (filter_text.empty() ? " (" : ", ") + part;
            }
            if (!filter_text.empty()) {
                filter_text += ")";
            }

            // The alternatives pattern: when filtering, offer the unfiltered and the opposite
            // views.
            std::vector<afd::Alternative> alternatives;
            if (filter.completed || filter.priority || filter.search) {
                TodoFilter all;
                all.sort_by = filter.sort_by;
                all.sort_order = filter.sort_order;
                all.limit = filter.limit;
                all.offset = filter.offset;
                const auto all_todos = store->list(all);
                const std::int64_t all_total = store->count();
                alternatives.push_back(
                    {Json{{"todos", all_todos},
                          {"total", all_total},
                          {"hasMore", filter.offset + static_cast<std::int64_t>(all_todos.size()) <
                                          all_total}},
                     "View all " + std::to_string(all_total) + " todos without filters", 1.0,
                     std::nullopt});
                if (filter.completed) {
                    TodoFilter opposite = filter;
                    opposite.completed = !*filter.completed;
                    const auto opposite_todos = store->list(opposite);
                    TodoFilter opposite_matching = matching;
                    opposite_matching.completed = !*filter.completed;
                    const auto opposite_total =
                        static_cast<std::int64_t>(store->list(opposite_matching).size());
                    if (opposite_total > 0) {
                        alternatives.push_back(
                            {Json{{"todos", opposite_todos},
                                  {"total", opposite_total},
                                  {"hasMore", filter.offset + static_cast<std::int64_t>(
                                                                  opposite_todos.size()) <
                                                  opposite_total}},
                             std::string("View ") + (*filter.completed ? "pending" : "completed") +
                                 " todos instead (" + std::to_string(opposite_total) + ")",
                             1.0, std::nullopt});
                    }
                }
            }

            afd::ResultOptions options{
                .confidence = 1.0,
                .reasoning = "Found " + std::to_string(total) + " todos" + filter_text +
                             ", returning " + std::to_string(todos.size()) +
                             " starting at offset " + std::to_string(filter.offset)};
            if (!alternatives.empty()) {
                options.alternatives = std::move(alternatives);
            }
            return afd::success(Json{{"todos", todos}, {"total", total}, {"hasMore", has_more}},
                                std::move(options));
        });
    list.contexts = {"todo-editing", "todo-reading"};
    commands.push_back(std::move(list));

    auto update = command(
        "todo-update", "Update a todo item", {"todo", "update", "write", "single"}, true,
        [store](const Json& input, CommandContext&) {
            const std::string id = input["id"].get<std::string>();
            TodoUpdate changes{string_field(input, "title"), string_field(input, "description"),
                               string_field(input, "priority"), bool_field(input, "completed")};
            if (!changes.title && !changes.description && !changes.priority && !changes.completed) {
                return afd::failure(afd::create_error(
                    "NO_CHANGES", "No fields to update",
                    {.suggestion =
                         "Provide at least one of: title, description, completed, priority"}));
            }
            if (!store->get(id)) {
                return afd::failure(not_found(id));
            }
            const auto updated = store->update(id, changes);
            if (!updated) {
                return afd::failure(not_found(id));
            }
            std::vector<std::string> summary;
            if (changes.title && !changes.title->empty()) {
                summary.push_back("title to " + in_quotes(*changes.title));
            }
            if (changes.description) {
                summary.push_back("description");
            }
            if (changes.priority && !changes.priority->empty()) {
                summary.push_back("priority to " + *changes.priority);
            }
            std::string joined;
            for (const auto& part : summary) {
                joined += (joined.empty() ? "" : ", ") + part;
            }
            return afd::success(*updated, {.confidence = 1.0,
                                           .reasoning = "Updated " + joined + " for todo " +
                                                        in_quotes(updated->title)});
        });
    update.errors = {"NOT_FOUND", "NO_CHANGES"};
    commands.push_back(std::move(update));

    auto toggle = command(
        "todo-toggle", "Toggle the completion status of a todo",
        {"todo", "toggle", "write", "single"}, true, [store](const Json& input, CommandContext&) {
            const std::string id = input["id"].get<std::string>();
            if (!store->get(id)) {
                return afd::failure(not_found(id));
            }
            const auto updated = store->toggle(id);
            if (!updated) {
                return afd::failure(not_found(id));
            }
            const std::string action =
                updated->completed ? "Marked as completed" : "Marked as pending";
            return afd::success(*updated, {.confidence = 1.0,
                                           .reasoning = action + ": " + in_quotes(updated->title)});
        });
    toggle.errors = {"NOT_FOUND"};
    commands.push_back(std::move(toggle));

    auto remove = command(
        "todo-delete", "Delete a todo item", {"todo", "delete", "write", "single", "destructive"},
        true, [store](const Json& input, CommandContext&) {
            const std::string id = input["id"].get<std::string>();
            const auto existing = store->get(id);
            if (!existing || !store->remove(id)) {
                return afd::failure(not_found(id));
            }
            return afd::success(
                Json{{"deleted", true}, {"id", id}},
                {.confidence = 1.0,
                 .reasoning = "Deleted todo " + in_quotes(existing->title),
                 .warnings = std::vector<afd::Warning>{warning(
                     "PERMANENT", "This action cannot be undone", afd::WarningSeverity::info)}});
        });
    remove.errors = {"NOT_FOUND"};
    remove.destructive = true;
    commands.push_back(std::move(remove));

    auto clear = command(
        "todo-clear", "Clear completed todos (or all if specified)",
        {"todo", "clear", "write", "batch", "destructive"}, true,
        [store](const Json& input, CommandContext&) {
            if (bool_field(input, "all").value_or(false)) {
                const std::int64_t count = store->count();
                store->clear();
                return afd::success(
                    Json{{"cleared", count}, {"remaining", 0}},
                    {.confidence = 1.0,
                     .reasoning = "Cleared all " + std::to_string(count) + " todos"});
            }
            const auto [cleared, remaining] = store->clear_completed();
            afd::ResultOptions options{
                .confidence = 1.0,
                .reasoning = cleared > 0 ? "Cleared " + std::to_string(cleared) +
                                               " completed todo" + (cleared == 1 ? "" : "s") +
                                               ", " + std::to_string(remaining) + " remaining"
                                         : "No completed todos to clear, " +
                                               std::to_string(remaining) + " remaining"};
            if (cleared > 0) {
                options.warnings = std::vector<afd::Warning>{warning(
                    "PERMANENT", "This action cannot be undone", afd::WarningSeverity::info)};
            }
            return afd::success(Json{{"cleared", cleared}, {"remaining", remaining}},
                                std::move(options));
        });
    clear.destructive = true;
    commands.push_back(std::move(clear));

    auto stats_command =
        command("todo-stats", "Get todo statistics", {"todo", "stats", "read", "safe"}, false,
                [store](const Json&, CommandContext&) {
                    const TodoStats stats = store->stats();
                    std::string reasoning;
                    if (stats.total == 0) {
                        reasoning = "No todos yet";
                    } else {
                        reasoning = std::to_string(stats.total) + " total todos, " +
                                    std::to_string(stats.completed) + " completed, " +
                                    std::to_string(stats.pending) + " pending, " +
                                    std::to_string(static_cast<long long>(
                                        std::round(stats.completion_rate * 100))) +
                                    "% completion rate";
                    }
                    return afd::success(
                        Json{{"total", stats.total},
                             {"completed", stats.completed},
                             {"pending", stats.pending},
                             {"byPriority",
                              {{"low", stats.low}, {"medium", stats.medium}, {"high", stats.high}}},
                             {"completionRate", afd::wire::number(stats.completion_rate)}},
                        {.confidence = 1.0, .reasoning = reasoning});
                });
    stats_command.prerequisites = {"todo-list"};
    commands.push_back(std::move(stats_command));

    auto create_batch = command(
        "todo-create-batch", "Create multiple todos at once with partial failure support",
        {"todo", "create", "write", "batch"}, true, [store](const Json& input, CommandContext&) {
            Json succeeded = Json::array();
            Json failed = Json::array();
            const auto& items = input["todos"];
            for (std::size_t i = 0; i < items.size(); ++i) {
                const Json& item = items[i];
                const std::string title = js_trim(item.value("title", std::string()));
                if (title.empty()) {
                    failed.push_back(
                        {{"index", i},
                         {"input", item},
                         {"error",
                          afd::create_error(
                              "VALIDATION_ERROR", "Title is required",
                              {.suggestion = "Provide a non-empty title for this todo"})}});
                    continue;
                }
                const auto description = string_field(item, "description");
                succeeded.push_back(store->create(
                    title,
                    description ? std::optional<std::string>(js_trim(*description)) : std::nullopt,
                    item.value("priority", std::string("medium"))));
            }
            const auto total = static_cast<std::int64_t>(items.size());
            const auto successes = static_cast<std::int64_t>(succeeded.size());
            const auto failures = static_cast<std::int64_t>(failed.size());
            std::string reasoning;
            if (failures == 0) {
                reasoning = "Successfully created all " + std::to_string(successes) + " todos";
            } else if (successes == 0) {
                reasoning = "Failed to create any todos. All " + std::to_string(failures) +
                            " items had errors.";
            } else {
                reasoning = "Created " + std::to_string(successes) + " of " +
                            std::to_string(total) + " todos. " + std::to_string(failures) +
                            " failed validation.";
            }
            afd::ResultOptions options{.confidence = total > 0 ? static_cast<double>(successes) /
                                                                     static_cast<double>(total)
                                                               : 0,
                                       .reasoning = reasoning};
            if (failures > 0 && successes > 0) {
                options.warnings = std::vector<afd::Warning>{warning(
                    "PARTIAL_SUCCESS",
                    std::to_string(failures) + " of " + std::to_string(total) + " items failed",
                    afd::WarningSeverity::warning)};
            }
            return afd::success(
                Json{{"succeeded", succeeded},
                     {"failed", failed},
                     {"summary",
                      {{"total", total}, {"successCount", successes}, {"failureCount", failures}}}},
                std::move(options));
        });
    create_batch.errors = {"VALIDATION_ERROR", "PARTIAL_FAILURE"};
    commands.push_back(std::move(create_batch));

    auto delete_batch = command(
        "todo-delete-batch", "Delete multiple todos at once",
        {"todo", "delete", "write", "batch", "destructive"}, true,
        [store](const Json& input, CommandContext&) {
            Json deleted_ids = Json::array();
            Json failed = Json::array();
            const auto& ids = input["ids"];
            for (std::size_t i = 0; i < ids.size(); ++i) {
                const std::string id = ids[i].get<std::string>();
                if (!store->get(id)) {
                    failed.push_back({{"index", i}, {"id", id}, {"error", not_found(id)}});
                    continue;
                }
                if (store->remove(id)) {
                    deleted_ids.push_back(id);
                } else {
                    failed.push_back(
                        {{"index", i},
                         {"id", id},
                         {"error",
                          afd::create_error(
                              "DELETE_FAILED", "Failed to delete todo " + in_quotes(id),
                              {.suggestion = "Try again or check if the todo still exists"})}});
                }
            }
            const auto total = static_cast<std::int64_t>(ids.size());
            const auto successes = static_cast<std::int64_t>(deleted_ids.size());
            const auto failures = static_cast<std::int64_t>(failed.size());
            std::string reasoning;
            if (failures == 0) {
                reasoning = "Successfully deleted all " + std::to_string(successes) + " todos";
            } else if (successes == 0) {
                reasoning = "Failed to delete any todos. All " + std::to_string(failures) +
                            " IDs were not found.";
            } else {
                reasoning = "Deleted " + std::to_string(successes) + " of " +
                            std::to_string(total) + " todos. " + std::to_string(failures) +
                            " were not found.";
            }
            std::vector<afd::Warning> warnings{warning("DESTRUCTIVE_BATCH",
                                                       "This operation permanently deleted " +
                                                           std::to_string(successes) + " todos",
                                                       afd::WarningSeverity::caution)};
            if (failures > 0 && successes > 0) {
                warnings.push_back(warning("PARTIAL_SUCCESS",
                                           std::to_string(failures) + " of " +
                                               std::to_string(total) +
                                               " items could not be deleted",
                                           afd::WarningSeverity::warning));
            }
            return afd::success(
                Json{{"deletedIds", deleted_ids},
                     {"failed", failed},
                     {"summary",
                      {{"total", total}, {"successCount", successes}, {"failureCount", failures}}}},
                {.confidence =
                     total > 0 ? static_cast<double>(successes) / static_cast<double>(total) : 0,
                 .reasoning = reasoning,
                 .warnings = std::move(warnings)});
        });
    delete_batch.errors = {"NOT_FOUND", "PARTIAL_FAILURE"};
    delete_batch.destructive = true;
    commands.push_back(std::move(delete_batch));

    auto toggle_batch = command(
        "todo-toggle-batch",
        "Toggle completion status of multiple todos, or set all to a specific state",
        {"todo", "toggle", "write", "batch"}, true, [store](const Json& input, CommandContext&) {
            Json succeeded = Json::array();
            Json failed = Json::array();
            std::int64_t marked_complete = 0;
            std::int64_t marked_incomplete = 0;
            const std::optional<bool> target = bool_field(input, "completed");
            const auto& ids = input["ids"];
            for (std::size_t i = 0; i < ids.size(); ++i) {
                const std::string id = ids[i].get<std::string>();
                const auto existing = store->get(id);
                if (!existing) {
                    failed.push_back({{"index", i}, {"id", id}, {"error", not_found(id)}});
                    continue;
                }
                std::optional<Todo> updated;
                if (target) {
                    updated = existing->completed != *target
                                  ? store->update(id, TodoUpdate{.completed = *target})
                                  : existing;
                } else {
                    updated = store->toggle(id);
                }
                if (!updated) {
                    failed.push_back(
                        {{"index", i},
                         {"id", id},
                         {"error",
                          afd::create_error(
                              "TOGGLE_FAILED", "Failed to toggle todo " + in_quotes(id),
                              {.suggestion = "Try again or check if the todo still exists"})}});
                    continue;
                }
                succeeded.push_back(*updated);
                (updated->completed ? marked_complete : marked_incomplete) += 1;
            }
            const auto total = static_cast<std::int64_t>(ids.size());
            const auto successes = static_cast<std::int64_t>(succeeded.size());
            const auto failures = static_cast<std::int64_t>(failed.size());
            const std::string mode =
                target ? std::string("set to ") + (*target ? "complete" : "incomplete")
                       : std::string("toggled");
            std::string reasoning;
            if (failures == 0) {
                reasoning = "Successfully " + mode + " all " + std::to_string(successes) + " todos";
                if (target) {
                    reasoning += " (" + std::to_string(marked_complete) + " complete, " +
                                 std::to_string(marked_incomplete) + " incomplete)";
                }
            } else if (successes == 0) {
                reasoning = "Failed to update any todos. All " + std::to_string(failures) +
                            " IDs were not found.";
            } else {
                std::string capitalized = mode;
                capitalized[0] = static_cast<char>(capitalized[0] - 'a' + 'A');
                reasoning = capitalized + " " + std::to_string(successes) + " of " +
                            std::to_string(total) + " todos. " + std::to_string(failures) +
                            " were not found.";
            }
            afd::ResultOptions options{.confidence = total > 0 ? static_cast<double>(successes) /
                                                                     static_cast<double>(total)
                                                               : 0,
                                       .reasoning = reasoning};
            if (failures > 0 && successes > 0) {
                options.warnings = std::vector<afd::Warning>{
                    warning("PARTIAL_SUCCESS",
                            std::to_string(failures) + " of " + std::to_string(total) +
                                " items could not be toggled",
                            afd::WarningSeverity::warning)};
            }
            return afd::success(Json{{"succeeded", succeeded},
                                     {"failed", failed},
                                     {"summary",
                                      {{"total", total},
                                       {"successCount", successes},
                                       {"failureCount", failures},
                                       {"markedComplete", marked_complete},
                                       {"markedIncomplete", marked_incomplete}}}},
                                std::move(options));
        });
    toggle_batch.errors = {"NOT_FOUND", "PARTIAL_FAILURE"};
    toggle_batch.prerequisites = {"todo-list"};
    commands.push_back(std::move(toggle_batch));

    for (auto& definition : commands) {
        if (auto error = registry.register_command(std::move(definition))) {
            return error;
        }
    }
    return std::nullopt;
}

} // namespace todo

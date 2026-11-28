// The commands on one todo, and the reads: todo-create, todo-list, todo-get, todo-update,
// todo-toggle, todo-delete and todo-stats.
#include <cmath>
#include <limits>
#include <string>
#include <utility>
#include <vector>

#include "commands/shared.hpp"
#include <afd/json.hpp>

namespace todo::detail {

afd::CommandDefinition todo_create(std::shared_ptr<TodoStore> store) {
    Command command;
    command.name = "todo-create";
    command.title = "Create a todo";
    command.description = "Create a new todo item";
    command.tags = {"todo", "create", "write", "single"};
    command.mutation = true;
    command.idempotency = afd::IdempotencySupport::keyed;
    command.undoable = true;
    command.errors = {"VALIDATION_ERROR"};
    command.input = {{"type", "object"},
                     {"properties",
                      {{"title", schema::title("Todo title (1-200 characters)")},
                       {"description", schema::description("Optional description")},
                       {"priority", schema::priority_with_default()}}},
                     {"required", Json::array({"title"})}};
    command.output = schema::todo();
    command.examples = {
        {"A todo with a priority", {{"title", "Order seed potatoes"}, {"priority", "high"}}}};
    command.changed = todo_id_in;
    command.run = [store](const Json& input, CommandContext& context) {
        const Stamp now = stamp(context);
        const Todo todo = store->create({.id = now.new_id(),
                                         .title = input["title"].get<std::string>(),
                                         .description = string_field(input, "description"),
                                         .priority = input.value("priority", std::string("medium")),
                                         .now = now.now});
        return afd::success(todo, {.confidence = 1.0,
                                   .reasoning = "Created todo " + in_quotes(todo.title) + " with " +
                                                todo.priority + " priority",
                                   .undo_command = "todo-delete",
                                   .undo_args = Json{{"id", todo.id}}});
    };
    return define(std::move(command), std::move(store));
}

namespace {

/// One page of `todo-list`, with the total before paging.
struct Page {
    std::vector<Todo> todos;
    std::int64_t total = 0;
    bool has_more = false;

    [[nodiscard]] Json json() const {
        return {{"todos", todos}, {"total", total}, {"hasMore", has_more}};
    }
};

struct ListQuery {
    std::string sort_by;
    std::string sort_order;
    std::int64_t limit = 20;
    std::int64_t offset = 0;
};

Page page(const TodoStore& store, const TodoFilter& filter, const ListQuery& query) {
    const auto matching = store.list(filter, query.sort_by, query.sort_order);
    Page result;
    result.total = static_cast<std::int64_t>(matching.size());
    const std::int64_t begin = (std::min)((std::max)(query.offset, std::int64_t{0}), result.total);
    const std::int64_t end = (std::min)(begin + query.limit, result.total);
    result.todos.assign(matching.begin() + begin, matching.begin() + end);
    result.has_more = query.offset + static_cast<std::int64_t>(result.todos.size()) < result.total;
    return result;
}

} // namespace

afd::CommandDefinition todo_list(std::shared_ptr<TodoStore> store) {
    Command command;
    command.name = "todo-list";
    command.title = "List todos";
    command.description = "List todos with optional filtering and pagination";
    command.tags = {"todo", "list", "read"};
    command.input = {
        {"type", "object"},
        {"properties",
         {{"deleted",
           {{"type", "boolean"},
            {"description", "If true, list the deleted todos, which todo-restore brings back, "
                            "instead of live ones"}}},
          {"completed", {{"type", "boolean"}, {"description", "Filter by completion status"}}},
          {"priority", schema::priority("Filter by priority")},
          {"search", {{"type", "string"}, {"description", "Search in title and description"}}},
          {"sortBy",
           {{"type", "string"},
            {"enum", {"createdAt", "updatedAt", "priority", "title", "deletedAt"}},
            {"default", "createdAt"},
            {"description", "Sort field"}}},
          {"sortOrder",
           {{"type", "string"},
            {"enum", {"asc", "desc"}},
            {"default", "desc"},
            {"description", "Sort direction"}}},
          {"limit",
           {{"type", "integer"},
            {"minimum", 1},
            {"maximum", 100},
            {"default", 20},
            {"description", "Maximum results (1-100)"}}},
          {"offset",
           {{"type", "integer"},
            {"minimum", 0},
            {"default", 0},
            {"description", "Offset for pagination"}}}}}};
    command.output = {{"type", "object"},
                      {"properties",
                       {{"todos", schema::todos()},
                        {"total", {{"type", "integer"}}},
                        {"hasMore", {{"type", "boolean"}}}}},
                      {"required", {"todos", "total", "hasMore"}}};
    command.examples = {
        {"Open high-priority todos", {{"completed", false}, {"priority", "high"}}},
        {"Deleted todos, most recent first", {{"deleted", true}, {"sortBy", "deletedAt"}}}};
    command.run = [store](const Json& input, CommandContext&) {
        const bool deleted = bool_field(input, "deleted").value_or(false);
        const TodoFilter filter{.deleted = deleted,
                                .completed = bool_field(input, "completed"),
                                .priority = string_field(input, "priority"),
                                .search = string_field(input, "search")};
        const ListQuery query{.sort_by = input.value("sortBy", std::string("createdAt")),
                              .sort_order = input.value("sortOrder", std::string("desc")),
                              .limit = integer_field(input, "limit", 20),
                              .offset = integer_field(input, "offset", 0)};
        const Page result = page(*store, filter, query);

        std::vector<std::string> filters;
        if (deleted) {
            filters.emplace_back("deleted");
        }
        if (filter.completed) {
            filters.emplace_back(*filter.completed ? "completed" : "pending");
        }
        if (filter.priority) {
            filters.push_back(*filter.priority + " priority");
        }
        // An empty search matches everything, and TypeScript leaves it out of the reasoning.
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

        afd::ResultOptions options{
            .confidence = 1.0,
            .reasoning = "Found " + std::to_string(result.total) + " todos" + filter_text +
                         ", returning " + std::to_string(result.todos.size()) +
                         " starting at offset " + std::to_string(query.offset)};

        // The alternatives pattern: when filtered, also offer the unfiltered view and, for a
        // completion filter, the opposite one.
        if (filter.completed || filter.priority || filter.search) {
            std::vector<afd::Alternative> alternatives;
            const Page everything = page(*store, TodoFilter{.deleted = deleted}, query);
            alternatives.push_back(
                {everything.json(),
                 "View all " + std::to_string(everything.total) + " todos without filters", 1.0,
                 std::nullopt});
            if (filter.completed) {
                TodoFilter flipped = filter;
                flipped.completed = !*filter.completed;
                const Page opposite = page(*store, flipped, query);
                if (opposite.total > 0) {
                    alternatives.push_back(
                        {opposite.json(),
                         std::string("View ") + (*filter.completed ? "pending" : "completed") +
                             " todos instead (" + std::to_string(opposite.total) + ")",
                         1.0, std::nullopt});
                }
            }
            options.alternatives = std::move(alternatives);
        }
        return afd::success(result.json(), std::move(options));
    };
    return define(std::move(command), std::move(store));
}

afd::CommandDefinition todo_get(std::shared_ptr<TodoStore> store) {
    Command command;
    command.name = "todo-get";
    command.title = "Get a todo";
    command.description = "Get a single todo by ID";
    command.tags = {"todo", "get", "read", "single"};
    command.errors = {"NOT_FOUND"};
    command.input = schema::id_input();
    command.output = schema::todo();
    command.examples = {{"One todo by id", {{"id", example_id}}}};
    command.run = [store](const Json& input, CommandContext&) {
        const std::string id = input["id"].get<std::string>();
        const auto todo = store->get(id);
        if (!todo) {
            return afd::failure(not_found(id));
        }
        return afd::success(
            *todo, {.confidence = 1.0, .reasoning = "Retrieved todo " + in_quotes(todo->title)});
    };
    return define(std::move(command), std::move(store));
}

afd::CommandDefinition todo_update(std::shared_ptr<TodoStore> store) {
    Command command;
    command.name = "todo-update";
    command.title = "Update a todo";
    command.description =
        "Update a todo's title, description, priority or completion; the result names the undo";
    command.tags = {"todo", "update", "write", "single"};
    command.mutation = true;
    command.idempotency = afd::IdempotencySupport::keyed;
    command.undoable = true;
    command.errors = {"NOT_FOUND", "NO_CHANGES"};
    command.input = {
        {"type", "object"},
        {"properties",
         {{"id", schema::id()},
          {"title", schema::title("New title")},
          {"description", schema::description("New description; an empty one removes it")},
          {"completed", {{"type", "boolean"}, {"description", "Mark completed or pending"}}},
          {"priority", schema::priority("New priority")}}},
        {"required", Json::array({"id"})}};
    command.output = schema::todo();
    command.examples = {
        {"Rename and reprioritise",
         {{"id", example_id}, {"title", "Order seed potatoes and onions"}, {"priority", "high"}}}};
    command.changed = todo_id_in;
    command.run = [store](const Json& input, CommandContext& context) {
        const std::string id = input["id"].get<std::string>();
        const TodoUpdate changes{string_field(input, "title"), string_field(input, "description"),
                                 string_field(input, "priority"), bool_field(input, "completed")};
        if (changes.empty()) {
            return afd::failure(afd::create_error(
                "NO_CHANGES", "No fields to update",
                {.suggestion =
                     "Provide at least one of: title, description, completed, priority"}));
        }
        const auto existing = store->get(id);
        if (!existing) {
            return afd::failure(not_found(id));
        }

        // The summary and the undo: the undo sets each changed field back, and a description
        // that was absent comes back as "", which the store treats as none.
        std::vector<std::string> summary;
        Json previous{{"id", id}};
        if (changes.title) {
            summary.push_back("title to " + in_quotes(*changes.title));
            previous["title"] = existing->title;
        }
        if (changes.description) {
            summary.emplace_back("description");
            previous["description"] = existing->description.value_or("");
        }
        if (changes.completed) {
            previous["completed"] = existing->completed;
        }
        if (changes.priority) {
            summary.push_back("priority to " + *changes.priority);
            previous["priority"] = existing->priority;
        }

        const auto updated = store->update(id, changes, now_iso(context));
        if (!updated) {
            return afd::failure(not_found(id));
        }
        std::string joined;
        for (const auto& part : summary) {
            joined += (joined.empty() ? "" : ", ") + part;
        }
        return afd::success(
            *updated, {.confidence = 1.0,
                       .reasoning = "Updated " + joined + " for todo " + in_quotes(updated->title),
                       .undo_command = "todo-update",
                       .undo_args = std::move(previous)});
    };
    return define(std::move(command), std::move(store));
}

afd::CommandDefinition todo_toggle(std::shared_ptr<TodoStore> store) {
    Command command;
    command.name = "todo-toggle";
    command.title = "Toggle a todo";
    command.description =
        "Set an open todo to done, or a done todo back to open; the result names the undo";
    command.tags = {"todo", "toggle", "write", "single"};
    command.mutation = true;
    command.idempotency = afd::IdempotencySupport::keyed;
    command.undoable = true;
    command.errors = {"NOT_FOUND"};
    command.input = schema::id_input();
    command.output = schema::todo();
    command.examples = {{"Mark a todo done, or open again", {{"id", example_id}}}};
    command.changed = todo_id_in;
    command.run = [store](const Json& input, CommandContext& context) {
        const std::string id = input["id"].get<std::string>();
        const auto existing = store->get(id);
        if (!existing) {
            return afd::failure(not_found(id));
        }
        const auto updated = store->toggle(id, now_iso(context));
        if (!updated) {
            return afd::failure(not_found(id));
        }
        const std::string action = updated->completed ? "Marked as completed" : "Marked as pending";
        // Setting the previous value back is safe to repeat; toggling again is not.
        return afd::success(*updated,
                            {.confidence = 1.0,
                             .reasoning = action + ": " + in_quotes(updated->title),
                             .undo_command = "todo-update",
                             .undo_args = Json{{"id", id}, {"completed", existing->completed}}});
    };
    return define(std::move(command), std::move(store));
}

afd::CommandDefinition todo_delete(std::shared_ptr<TodoStore> store) {
    Command command;
    command.name = "todo-delete";
    command.title = "Delete a todo";
    command.description = "Delete one todo by its id. It is kept with the deleted todos, and "
                          "todo-restore brings it back until todo-clear empties them";
    command.tags = {"todo", "delete", "write", "single", "destructive"};
    command.mutation = true;
    command.idempotency = afd::IdempotencySupport::natural;
    command.destructive = true;
    // It can be undone, so it is not held for approval.
    command.undoable = true;
    command.errors = {"NOT_FOUND"};
    command.input = schema::id_input();
    command.output = {
        {"type", "object"},
        {"properties", {{"deleted", {{"type", "boolean"}}}, {"id", {{"type", "string"}}}}},
        {"required", {"deleted", "id"}}};
    command.examples = {{"Delete one todo; todo-restore brings it back", {{"id", example_id}}}};
    command.changed = todo_id_in;
    command.run = [store](const Json& input, CommandContext& context) {
        const std::string id = input["id"].get<std::string>();
        const auto todo = store->remove(id, now_iso(context));
        if (!todo) {
            return afd::failure(not_found(id));
        }
        return afd::success(
            Json{{"deleted", true}, {"id", id}},
            {.confidence = 1.0,
             .reasoning =
                 "Deleted todo " + in_quotes(todo->title) + "; todo-restore brings it back",
             .warnings = std::vector<afd::Warning>{warning(
                 "RESTORABLE",
                 "Kept with the deleted todos: todo-restore brings it back until todo-clear "
                 "empties them",
                 afd::WarningSeverity::info)},
             .undo_command = "todo-restore",
             .undo_args = Json{{"ids", Json::array({id})}}});
    };
    return define(std::move(command), std::move(store));
}

afd::CommandDefinition todo_stats(std::shared_ptr<TodoStore> store) {
    Command command;
    command.name = "todo-stats";
    command.title = "Todo statistics";
    command.description =
        "Compute counts of the live todos by status and priority, and the completion rate";
    command.tags = {"todo", "stats", "read", "safe"};
    command.requires_first = {"todo-list"};
    command.input = {{"type", "object"}, {"properties", Json::object()}};
    const Json integer{{"type", "integer"}};
    command.output = {
        {"type", "object"},
        {"properties",
         {{"total", integer},
          {"completed", integer},
          {"pending", integer},
          {"byPriority",
           {{"type", "object"},
            {"properties", {{"low", integer}, {"medium", integer}, {"high", integer}}},
            {"required", {"low", "medium", "high"}}}},
          {"completionRate", {{"type", "number"}}}}},
        {"required", {"total", "completed", "pending", "byPriority", "completionRate"}}};
    command.examples = {{"Counts by status and priority", Json::object()}};
    command.run = [store](const Json&, CommandContext&) {
        const TodoStats stats = store->stats();
        std::string reasoning = "No todos yet";
        if (stats.total > 0) {
            // Rounded half up, as JavaScript's Math.round (the rate is never negative).
            const auto percent =
                static_cast<long long>(std::floor(stats.completion_rate * 100 + 0.5));
            reasoning = std::to_string(stats.total) + " total todos, " +
                        std::to_string(stats.completed) + " completed, " +
                        std::to_string(stats.pending) + " pending, " + std::to_string(percent) +
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
    };
    return define(std::move(command), std::move(store));
}

} // namespace todo::detail

// todo-restore, which brings deleted todos back, and todo-history, the recent changes newest
// first from the history `define` records. An entry offers its undo only while it is the latest
// change to each of its todos, so undoing an old entry never overwrites a later edit.
#include <algorithm>
#include <set>
#include <string>
#include <utility>
#include <vector>

#include "commands.hpp"
#include "commands/shared.hpp"

namespace todo {

std::vector<Change> with_current_undo(std::vector<Change> changes) {
    std::set<std::string> touched_later;
    std::vector<Change> entries;
    entries.reserve(changes.size());
    for (auto it = changes.rbegin(); it != changes.rend(); ++it) {
        Change change = std::move(*it);
        const bool superseded =
            std::any_of(change.ids.begin(), change.ids.end(),
                        [&](const auto& id) { return touched_later.contains(id); });
        touched_later.insert(change.ids.begin(), change.ids.end());
        if (superseded && change.undo_command) {
            change.undo_command.reset();
            change.undo_args.reset();
            change.superseded = true;
        }
        entries.push_back(std::move(change));
    }
    return entries;
}

namespace detail {

afd::CommandDefinition todo_restore(std::shared_ptr<TodoStore> store) {
    Command command;
    command.name = "todo-restore";
    command.title = "Restore deleted todos";
    command.description =
        "Bring deleted todos back exactly as they were. Find deleted todos with todo-list { "
        "deleted: true }; a delete result names this command and its ids as its undo";
    command.tags = {"todo", "restore", "write", "batch", "undo"};
    command.mutation = true;
    command.idempotency = afd::IdempotencySupport::natural;
    command.undoable = true;
    command.errors = {"NOT_FOUND"};
    command.input = schema::ids_input();
    command.output = {{"type", "object"},
                      {"properties",
                       {{"restoredIds", schema::strings()},
                        {"restored", schema::todos()},
                        {"failed", schema::failed()},
                        {"summary", schema::summary()}}},
                      {"required", {"restoredIds", "restored", "failed", "summary"}}};
    command.examples = {{"Undo a delete", {{"ids", Json::array({example_id})}}}};
    command.changed = [](const Json& data) { return ids_in(data.value("restoredIds", Json())); };
    command.run = [store](const Json& input, CommandContext&) {
        std::vector<Todo> restored;
        Json restored_ids = Json::array();
        Json failed = Json::array();
        const auto& ids = input["ids"];
        for (std::size_t i = 0; i < ids.size(); ++i) {
            const std::string id = ids[i].get<std::string>();
            if (auto todo = store->restore(id)) {
                restored_ids.push_back(id);
                restored.push_back(std::move(*todo));
                continue;
            }
            const auto error =
                store->get(id)
                    ? afd::create_error(
                          afd::error_codes::NOT_FOUND, "Todo " + in_quotes(id) + " is not deleted",
                          {.suggestion = "It is already a live todo: use todo-get to read it"})
                    : afd::create_error(afd::error_codes::NOT_FOUND,
                                        "No deleted todo has ID " + in_quotes(id),
                                        {.suggestion = "Use todo-list { deleted: true } to see the "
                                                       "deleted todos, and todo-list to see the "
                                                       "live ones"});
            failed.push_back({{"index", i}, {"id", id}, {"error", error}});
        }
        const auto total = static_cast<std::int64_t>(ids.size());
        const auto successes = static_cast<std::int64_t>(restored.size());
        const auto failures = static_cast<std::int64_t>(failed.size());
        std::string reasoning;
        if (failures == 0) {
            reasoning = "Restored " + std::to_string(successes) + " todo" + plural(successes);
        } else if (successes == 0) {
            reasoning = "Restored none of " + std::to_string(total) + ": no deleted todo has " +
                        (total == 1 ? "that ID" : "those IDs");
        } else {
            reasoning = "Restored " + std::to_string(successes) + " of " + std::to_string(total) +
                        " todos; " + std::to_string(failures) + " could not be restored";
        }
        afd::ResultOptions options{.confidence = batch_confidence(successes, total),
                                   .reasoning = reasoning};
        if (failures > 0 && successes > 0) {
            options.warnings = std::vector<afd::Warning>{warning("PARTIAL_SUCCESS",
                                                                 std::to_string(failures) + " of " +
                                                                     std::to_string(total) +
                                                                     " could not be restored",
                                                                 afd::WarningSeverity::warning)};
        }
        if (successes > 0) {
            options.undo_command = "todo-delete-batch";
            options.undo_args = Json{{"ids", restored_ids}};
        }
        return afd::success(
            Json{{"restoredIds", restored_ids},
                 {"restored", restored},
                 {"failed", failed},
                 {"summary",
                  {{"total", total}, {"successCount", successes}, {"failureCount", failures}}}},
            std::move(options));
    };
    return define(std::move(command), std::move(store));
}

afd::CommandDefinition todo_history(std::shared_ptr<TodoStore> store) {
    Command command;
    command.name = "todo-history";
    command.title = "Todo change history";
    // States history_limit, which the tests check.
    command.description =
        "List the recent changes to the todos, newest first: what changed, who changed it, "
        "when, and the undo command and arguments for each change that is still the latest to "
        "its todos. Keeps the latest 1000 changes";
    command.tags = {"todo", "history", "read", "undo"};
    command.input = {
        {"type", "object"},
        {"properties",
         {{"limit",
           {{"type", "integer"},
            {"minimum", 1},
            {"maximum", 100},
            {"default", 20},
            {"description", "Maximum entries (1-100)"}}},
          {"offset",
           {{"type", "integer"},
            {"minimum", 0},
            {"default", 0},
            {"description", "Offset for pagination"}}},
          {"actor",
           {{"type", "string"},
            {"minLength", 1},
            {"description",
             "Only changes by this kind of actor: human, agent, service, script or test"}}},
          {"todoId",
           {{"type", "string"},
            {"minLength", 1},
            {"description", "Only changes that touched this todo"}}}}}};
    const Json entry{
        {"type", "object"},
        {"properties",
         {{"seq", {{"type", "integer"}}},
          {"at", {{"type", "string"}}},
          {"actor",
           {{"type", "object"},
            {"properties", {{"kind", {{"type", "string"}}}, {"id", {{"type", "string"}}}}},
            {"required", Json::array({"kind"})}}},
          {"command", {{"type", "string"}}},
          {"ids", schema::strings()},
          {"undoCommand", {{"type", "string"}}},
          {"undoArgs", {{"type", "object"}}},
          {"superseded",
           {{"type", "boolean"},
            {"description", "Set when a later change touched the same todos, so its undo is not "
                            "offered"}}}}},
        {"required", {"seq", "at", "actor", "command", "ids"}}};
    command.output = {{"type", "object"},
                      {"properties",
                       {{"entries", {{"type", "array"}, {"items", entry}}},
                        {"total", {{"type", "integer"}}},
                        {"hasMore", {{"type", "boolean"}}}}},
                      {"required", {"entries", "total", "hasMore"}}};
    command.examples = {{"The last five changes", {{"limit", 5}}},
                        {"What agents changed", {{"actor", "agent"}}}};
    command.run = [store](const Json& input, CommandContext&) {
        const auto actor = string_field(input, "actor");
        const auto todo_id = string_field(input, "todoId");
        const std::int64_t limit = integer_field(input, "limit", 20);
        const std::int64_t offset = integer_field(input, "offset", 0);
        std::vector<Change> matching;
        for (auto& change : with_current_undo(store->history())) {
            const bool by_actor = !actor || change.actor_kind == *actor;
            const bool touched = !todo_id || std::find(change.ids.begin(), change.ids.end(),
                                                       *todo_id) != change.ids.end();
            if (by_actor && touched) {
                matching.push_back(std::move(change));
            }
        }
        const auto total = static_cast<std::int64_t>(matching.size());
        const std::int64_t begin = (std::min)((std::max)(offset, std::int64_t{0}), total);
        const std::int64_t end = (std::min)(begin + limit, total);
        const std::vector<Change> entries(matching.begin() + begin, matching.begin() + end);
        std::string reasoning = "No changes recorded that match";
        if (total > 0) {
            reasoning = std::to_string(total) + " change" + plural(total) + " recorded";
            if (!entries.empty()) {
                const Change& latest = entries.front();
                reasoning += "; the latest shown is " + latest.command + " by " +
                             latest.actor_kind + " at " + latest.at;
            }
        }
        const bool has_more = offset + static_cast<std::int64_t>(entries.size()) < total;
        return afd::success(Json{{"entries", entries}, {"total", total}, {"hasMore", has_more}},
                            {.confidence = 1.0, .reasoning = reasoning});
    };
    return define(std::move(command), std::move(store));
}

} // namespace detail
} // namespace todo

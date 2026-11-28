// The batch commands: todo-create-batch, todo-delete-batch and todo-toggle-batch. Each reports
// per-item failures in `data.failed` and fails as a whole only on invalid input.
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "commands/shared.hpp"

namespace todo::detail {
namespace {

// JavaScript's String.prototype.trim(): its whitespace and line terminators.
std::string js_trim(const std::string& text) {
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
    const auto space_at = [&](std::size_t at) -> std::size_t {
        const std::string_view rest = std::string_view(text).substr(at);
        for (const auto space : spaces) {
            if (rest.substr(0, space.size()) == space) {
                return space.size();
            }
        }
        return 0;
    };
    std::size_t begin = 0;
    while (begin < text.size()) {
        const std::size_t length = space_at(begin);
        if (length == 0) {
            break;
        }
        begin += length;
    }
    std::size_t end = text.size();
    for (bool trimmed = true; trimmed && end > begin;) {
        trimmed = false;
        for (std::size_t width = 1; width <= 3 && width <= end - begin; ++width) {
            if (space_at(end - width) == width) {
                end -= width;
                trimmed = true;
                break;
            }
        }
    }
    return text.substr(begin, end - begin);
}

Json failed_by_id(std::size_t index, const std::string& id, const afd::CommandError& error) {
    return {{"index", index}, {"id", id}, {"error", error}};
}

Json summary(std::int64_t total, std::int64_t succeeded, std::int64_t failed) {
    return {{"total", total}, {"successCount", succeeded}, {"failureCount", failed}};
}

} // namespace

afd::CommandDefinition todo_create_batch(std::shared_ptr<TodoStore> store) {
    Command command;
    command.name = "todo-create-batch";
    command.title = "Create several todos";
    command.description = "Create multiple todos at once with partial failure support";
    command.tags = {"todo", "create", "write", "batch"};
    command.mutation = true;
    command.idempotency = afd::IdempotencySupport::keyed;
    command.undoable = true;
    command.errors = {"VALIDATION_ERROR", "PARTIAL_FAILURE"};
    command.input = {{"type", "object"},
                     {"properties",
                      {{"todos",
                        {{"type", "array"},
                         {"minItems", 1},
                         {"maxItems", 100},
                         {"description", "Todos to create (1-100)"},
                         {"items",
                          {{"type", "object"},
                           {"properties",
                            {{"title", schema::title("Todo title (1-200 characters)")},
                             {"description", schema::description("Optional description")},
                             {"priority", schema::priority_with_default()}}},
                           {"required", Json::array({"title"})}}}}}}},
                     {"required", Json::array({"todos"})}};
    command.output = {{"type", "object"},
                      {"properties",
                       {{"succeeded", schema::todos()},
                        {"failed", schema::failed()},
                        {"summary", schema::summary()}}},
                      {"required", {"succeeded", "failed", "summary"}}};
    command.examples = {
        {"Two todos at once",
         {{"todos", Json::array({{{"title", "Net the brassicas"}},
                                 {{"title", "Sow the broad beans"}, {"priority", "low"}}})}}}};
    command.changed = [](const Json& data) { return todo_ids_in(data.value("succeeded", Json())); };
    command.run = [store](const Json& input, CommandContext& context) {
        const Stamp now = stamp(context);
        Json succeeded = Json::array();
        Json failed = Json::array();
        Json created_ids = Json::array();
        const auto& items = input["todos"];
        for (std::size_t i = 0; i < items.size(); ++i) {
            const Json& item = items[i];
            // The schema allows "   "; a title must still have visible text.
            const std::string title = js_trim(item.value("title", std::string()));
            if (title.empty()) {
                failed.push_back(
                    {{"index", i},
                     {"input", item},
                     {"error", afd::create_error(
                                   "VALIDATION_ERROR", "Title is required",
                                   {.suggestion = "Provide a non-empty title for this todo"})}});
                continue;
            }
            const auto description = string_field(item, "description");
            const Todo todo = store->create(
                {.id = now.new_id(),
                 .title = title,
                 .description = description ? std::optional(js_trim(*description)) : std::nullopt,
                 .priority = item.value("priority", std::string("medium")),
                 .now = now.now});
            created_ids.push_back(todo.id);
            succeeded.push_back(todo);
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
            reasoning = "Created " + std::to_string(successes) + " of " + std::to_string(total) +
                        " todos. " + std::to_string(failures) + " failed validation.";
        }
        afd::ResultOptions options{.confidence = batch_confidence(successes, total),
                                   .reasoning = reasoning};
        if (failures > 0 && successes > 0) {
            options.warnings = std::vector<afd::Warning>{
                warning("PARTIAL_SUCCESS",
                        std::to_string(failures) + " of " + std::to_string(total) + " items failed",
                        afd::WarningSeverity::warning)};
        }
        if (successes > 0) {
            options.undo_command = "todo-delete-batch";
            options.undo_args = Json{{"ids", std::move(created_ids)}};
        }
        return afd::success(Json{{"succeeded", succeeded},
                                 {"failed", failed},
                                 {"summary", summary(total, successes, failures)}},
                            std::move(options));
    };
    return define(std::move(command), std::move(store));
}

afd::CommandDefinition todo_delete_batch(std::shared_ptr<TodoStore> store) {
    Command command;
    command.name = "todo-delete-batch";
    command.title = "Delete several todos";
    command.description =
        "Remove up to 100 todos in one call, reporting each id that fails. They stay restorable "
        "with todo-restore until todo-clear empties the deleted todos";
    command.tags = {"todo", "delete", "write", "batch", "destructive"};
    command.mutation = true;
    command.idempotency = afd::IdempotencySupport::natural;
    command.destructive = true;
    // It can be undone, so it is not held for approval.
    command.undoable = true;
    command.errors = {"NOT_FOUND", "PARTIAL_FAILURE"};
    command.input = schema::ids_input();
    command.output = {{"type", "object"},
                      {"properties",
                       {{"deletedIds", schema::strings()},
                        {"failed", schema::failed()},
                        {"summary", schema::summary()}}},
                      {"required", {"deletedIds", "failed", "summary"}}};
    command.examples = {{"Delete two todos", {{"ids", {example_id, other_id}}}}};
    command.changed = [](const Json& data) { return ids_in(data.value("deletedIds", Json())); };
    command.run = [store](const Json& input, CommandContext& context) {
        const std::string now = now_iso(context);
        Json deleted_ids = Json::array();
        Json failed = Json::array();
        const auto& ids = input["ids"];
        for (std::size_t i = 0; i < ids.size(); ++i) {
            const std::string id = ids[i].get<std::string>();
            if (store->remove(id, now)) {
                deleted_ids.push_back(id);
            } else {
                failed.push_back(failed_by_id(i, id, not_found(id)));
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
            reasoning = "Deleted " + std::to_string(successes) + " of " + std::to_string(total) +
                        " todos. " + std::to_string(failures) + " were not found.";
        }
        afd::ResultOptions options{.confidence = batch_confidence(successes, total),
                                   .reasoning = reasoning};
        std::vector<afd::Warning> warnings;
        if (successes > 0) {
            warnings.push_back(warning("DESTRUCTIVE_BATCH",
                                       "Deleted " + std::to_string(successes) +
                                           " todos; todo-restore brings them back until "
                                           "todo-clear empties the deleted todos",
                                       afd::WarningSeverity::caution));
            options.undo_command = "todo-restore";
            options.undo_args = Json{{"ids", deleted_ids}};
        }
        if (failures > 0 && successes > 0) {
            warnings.push_back(warning("PARTIAL_SUCCESS",
                                       std::to_string(failures) + " of " + std::to_string(total) +
                                           " items could not be deleted",
                                       afd::WarningSeverity::warning));
        }
        if (!warnings.empty()) {
            options.warnings = std::move(warnings);
        }
        return afd::success(Json{{"deletedIds", deleted_ids},
                                 {"failed", failed},
                                 {"summary", summary(total, successes, failures)}},
                            std::move(options));
    };
    return define(std::move(command), std::move(store));
}

afd::CommandDefinition todo_toggle_batch(std::shared_ptr<TodoStore> store) {
    Command command;
    command.name = "todo-toggle-batch";
    command.title = "Toggle several todos";
    command.description = "Toggle the completion status of the listed todos, or set them all to "
                          "completed: true or false";
    command.tags = {"todo", "toggle", "write", "batch"};
    command.mutation = true;
    command.idempotency = afd::IdempotencySupport::keyed;
    command.undoable = true;
    command.requires_first = {"todo-list"};
    command.errors = {"NOT_FOUND", "PARTIAL_FAILURE"};
    command.input = {{"type", "object"},
                     {"properties",
                      {{"ids", schema::ids()},
                       {"completed",
                        {{"type", "boolean"},
                         {"description", "If set, mark every todo with this state instead of "
                                         "toggling each one"}}}}},
                     {"required", Json::array({"ids"})}};
    const Json integer{{"type", "integer"}};
    command.output = {
        {"type", "object"},
        {"properties",
         {{"succeeded", schema::todos()},
          {"failed", schema::failed()},
          {"summary",
           {{"type", "object"},
            {"properties",
             {{"total", integer},
              {"successCount", integer},
              {"failureCount", integer},
              {"markedComplete", integer},
              {"markedIncomplete", integer}}},
            {"required",
             {"total", "successCount", "failureCount", "markedComplete", "markedIncomplete"}}}}}},
        {"required", {"succeeded", "failed", "summary"}}};
    command.examples = {
        {"Mark two todos done", {{"ids", {example_id, other_id}}, {"completed", true}}}};
    command.changed = [](const Json& data) { return todo_ids_in(data.value("succeeded", Json())); };
    command.run = [store](const Json& input, CommandContext& context) {
        const std::string now = now_iso(context);
        const std::optional<bool> target = bool_field(input, "completed");
        std::vector<Todo> succeeded;
        Json failed = Json::array();
        // The todos this call changed, and the state each had before.
        std::vector<std::pair<std::string, bool>> changed;
        const auto& ids = input["ids"];
        for (std::size_t i = 0; i < ids.size(); ++i) {
            const std::string id = ids[i].get<std::string>();
            const auto existing = store->get(id);
            if (!existing) {
                failed.push_back(failed_by_id(i, id, not_found(id)));
                continue;
            }
            if (target && *target == existing->completed) {
                // Already in the requested state.
                succeeded.push_back(*existing);
                continue;
            }
            const auto updated =
                target ? store->update(id, {.completed = *target}, now) : store->toggle(id, now);
            if (!updated) {
                failed.push_back(failed_by_id(i, id, not_found(id)));
                continue;
            }
            changed.emplace_back(id, existing->completed);
            succeeded.push_back(*updated);
        }

        const auto total = static_cast<std::int64_t>(ids.size());
        const auto successes = static_cast<std::int64_t>(succeeded.size());
        const auto failures = static_cast<std::int64_t>(failed.size());
        std::int64_t marked_complete = 0;
        for (const Todo& todo : succeeded) {
            marked_complete += todo.completed ? 1 : 0;
        }
        const std::int64_t marked_incomplete = successes - marked_complete;
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

        afd::ResultOptions options{.confidence = batch_confidence(successes, total),
                                   .reasoning = reasoning};
        std::vector<afd::Warning> warnings;
        if (failures > 0 && successes > 0) {
            warnings.push_back(warning("PARTIAL_SUCCESS",
                                       std::to_string(failures) + " of " + std::to_string(total) +
                                           " items could not be toggled",
                                       afd::WarningSeverity::warning));
        }
        // One call undoes this only when every changed todo had the same state before.
        if (!changed.empty()) {
            const bool first = changed.front().second;
            bool same = true;
            Json changed_ids = Json::array();
            for (const auto& [id, before] : changed) {
                same = same && before == first;
                changed_ids.push_back(id);
            }
            if (same) {
                options.undo_command = "todo-toggle-batch";
                options.undo_args = Json{{"ids", std::move(changed_ids)}, {"completed", first}};
            } else {
                warnings.push_back(warning(
                    "NO_SINGLE_UNDO",
                    "These todos had different states before, so no single call undoes this. "
                    "Set each group back with todo-toggle-batch and completed, or each todo with "
                    "todo-update.",
                    afd::WarningSeverity::info));
            }
        }
        if (!warnings.empty()) {
            options.warnings = std::move(warnings);
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
    };
    return define(std::move(command), std::move(store));
}

} // namespace todo::detail

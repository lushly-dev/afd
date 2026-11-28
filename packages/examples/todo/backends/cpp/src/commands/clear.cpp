// todo-clear, the one todo change with no way back, so the one held for approval: any caller
// that is not a person waits until a person approves (the server's approval middleware,
// `APPROVALS`).
#include <string>
#include <utility>

#include "commands.hpp"
#include "commands/shared.hpp"

namespace todo {
namespace {

/// What a clear removes.
enum class Scope { completed, deleted, all };

Scope scope_of(const afd::Json& input) {
    const auto flag = [&](const char* name) {
        return detail::bool_field(input, name).value_or(false);
    };
    return flag("all") ? Scope::all : flag("deleted") ? Scope::deleted : Scope::completed;
}

} // namespace

std::string summarize_clear(const TodoStore& store, const afd::Json& input) {
    // The approval covers the call's input, not these todos, so the text says the count is as
    // of now.
    const auto now = [](std::int64_t count) {
        return " (" + std::to_string(count) + (count == 1 ? " todo" : " todos") + " now)";
    };
    const ClearCounts counts = store.counts();
    switch (scope_of(input)) {
    case Scope::all:
        return "Remove every todo for good, live and deleted" + now(counts.live + counts.deleted);
    case Scope::deleted:
        return "Empty the deleted todos for good" + now(counts.deleted);
    case Scope::completed:
        break;
    }
    return "Remove the completed todos for good" + now(counts.completed);
}

namespace detail {

afd::CommandDefinition todo_clear(std::shared_ptr<TodoStore> store) {
    Command command;
    command.name = "todo-clear";
    command.title = "Clear todos for good";
    command.description =
        "Remove todos for good: completed ones, or the deleted todos with deleted: true, or "
        "every todo with all: true. Nothing undoes it. Where the server holds clears for "
        "approval, a caller that is not a person waits for a person to approve; elsewhere it is "
        "gated only by its confirmation prompt, where the server enforces confirmations";
    command.tags = {"todo", "clear", "write", "batch", "destructive"};
    command.mutation = true;
    command.idempotency = afd::IdempotencySupport::natural;
    command.destructive = true;
    // Enforced when the server runs with CONFIRMATIONS=enforce (spec/confirmation-cases.json).
    command.confirm_prompt = "Delete these todos? This cannot be undone.";
    command.input = {
        {"type", "object"},
        {"properties",
         {{"all",
           {{"type", "boolean"},
            {"description", "If true, remove every todo, live and deleted, regardless of status"}}},
          {"deleted",
           {{"type", "boolean"},
            {"description",
             "If true, empty the deleted todos instead of removing completed ones"}}}}}};
    command.output = {{"type", "object"},
                      {"properties",
                       {{"cleared", {{"type", "integer"}}},
                        {"remaining", {{"type", "integer"}}},
                        {"clearedIds", schema::strings()}}},
                      {"required", {"cleared", "remaining", "clearedIds"}}};
    command.examples = {{"Remove the completed todos", Json::object()},
                        {"Empty the deleted todos", {{"deleted", true}}}};
    // Nothing undoes a clear, so only a person runs it without approval.
    command.approval = afd::ApprovalPolicy([](const Json&, const CommandContext& context) {
        return context.actor && context.actor->kind == afd::ActorKind::human
                   ? afd::ApprovalDecision::not_required
                   : afd::ApprovalDecision::required;
    });
    command.changed = [](const Json& data) { return ids_in(data.value("clearedIds", Json())); };
    command.run = [store](const Json& input, CommandContext&) {
        const Scope scope = scope_of(input);
        const ClearResult result = scope == Scope::all       ? store->clear_all()
                                   : scope == Scope::deleted ? store->clear_deleted()
                                                             : store->clear_completed();
        const auto cleared = static_cast<std::int64_t>(result.cleared_ids.size());
        const std::string count = std::to_string(cleared);
        const std::string remaining = std::to_string(result.remaining);
        std::string reasoning;
        if (scope == Scope::all) {
            reasoning = "Cleared all " + count + " todos";
        } else if (scope == Scope::deleted) {
            reasoning = "Emptied " + count + " deleted todo" + plural(cleared) + ", " + remaining +
                        " remaining";
        } else if (cleared > 0) {
            reasoning = "Cleared " + count + " completed todo" + plural(cleared) + ", " +
                        remaining + " remaining";
        } else {
            reasoning = "No completed todos to clear, " + remaining + " remaining";
        }
        afd::ResultOptions options{.confidence = 1.0, .reasoning = reasoning};
        if (cleared > 0) {
            options.warnings = std::vector<afd::Warning>{
                warning("PERMANENT", "This action cannot be undone", afd::WarningSeverity::info)};
        }
        return afd::success(Json{{"cleared", cleared},
                                 {"remaining", result.remaining},
                                 {"clearedIds", result.cleared_ids}},
                            std::move(options));
    };
    return define(std::move(command), std::move(store));
}

} // namespace detail
} // namespace todo

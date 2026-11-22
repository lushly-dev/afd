#include "commands.hpp"

#include "commands/shared.hpp"

namespace todo {

std::vector<afd::CommandDefinition> todo_commands(const std::shared_ptr<TodoStore>& store) {
    using namespace detail;
    std::vector<afd::CommandDefinition> commands;
    for (auto* make : {todo_create, todo_list, todo_get, todo_update, todo_toggle, todo_delete,
                       todo_clear, todo_stats, todo_create_batch, todo_delete_batch,
                       todo_toggle_batch, todo_restore, todo_history}) {
        commands.push_back(make(store));
    }
    return commands;
}

} // namespace todo

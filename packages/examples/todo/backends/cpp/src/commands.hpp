// The 11 todo commands (backends/typescript/src/commands), with the same messages, reasoning and
// warnings, validated against spec/commands.schema.json.
#pragma once

#include <memory>
#include <optional>
#include <string>

#include "store.hpp"
#include <afd/registry.hpp>

namespace todo {

/// Registers every todo command on `registry`, backed by `store`. Returns an error message if a
/// command could not be registered.
std::optional<std::string> register_todo_commands(afd::CommandRegistry& registry,
                                                  std::shared_ptr<TodoStore> store);

} // namespace todo

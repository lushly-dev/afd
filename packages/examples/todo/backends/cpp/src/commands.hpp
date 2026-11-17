// The 13 todo commands of spec/commands.schema.json, mirroring the TypeScript backend's
// src/commands: the same metadata, inputs, limits, error codes, suggestions, result shapes and
// undo. Each declares its whole input schema, which the registry validates and the MCP server
// advertises, so the advertised and enforced contracts cannot drift apart.
#pragma once

#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "store.hpp"
#include <afd/command.hpp>
#include <afd/registry.hpp>

namespace todo {

/// The todo commands over `store`, in the TypeScript backend's order. Every successful change is
/// recorded in the store's history.
std::vector<afd::CommandDefinition> todo_commands(const std::shared_ptr<TodoStore>& store);

/// Registers every todo command on `registry`, backed by `store`. Returns an error message if a
/// command could not be registered.
std::optional<std::string> register_todo_commands(afd::CommandRegistry& registry,
                                                  const std::shared_ptr<TodoStore>& store);

/// The text a person approves for a held `todo-clear`: what goes for good, and how many that is
/// now.
std::string summarize_clear(const TodoStore& store, const afd::Json& input);

/// `changes` newest first, each entry's undo kept only while no later change touched its todos.
std::vector<Change> with_current_undo(std::vector<Change> changes);

} // namespace todo

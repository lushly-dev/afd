// What the todo commands share: how a command is declared and recorded, the time and id source,
// the not-found error, and the JSON Schema pieces. The TypeScript backend's
// src/commands/shared.ts and src/history.ts.
#pragma once

#include <cstdint>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "store.hpp"
#include <afd/command.hpp>
#include <afd/result.hpp>

namespace todo::detail {

using afd::CommandContext;
using afd::CommandResult;
using afd::Json;

/// Commands that only read: visible in both contexts (src/contexts.ts).
inline const std::vector<std::string> read_contexts{"todo-reading", "todo-editing"};
/// Commands that change todos: hidden while reading.
inline const std::vector<std::string> edit_contexts{"todo-editing"};

/// The ids the examples use.
inline constexpr const char* example_id = "todo-1700000000000-abc1234";
inline constexpr const char* other_id = "todo-1700000000000-def5678";

/// One command: its metadata, schemas and handler. `define` turns it into a definition.
struct Command {
    std::string name;
    /// A short label, the MCP tool `title`.
    std::string title;
    std::string description;
    std::vector<std::string> tags;
    bool mutation = false;
    /// What a repeat is safe under (spec/idempotency.md): `natural` or `keyed`. Every change
    /// declares one, as commands.schema.json gives it.
    std::optional<afd::IdempotencySupport> idempotency;
    /// Whether the command deletes data, sent to MCP clients as `destructiveHint`.
    bool destructive = false;
    /// Whether its result names an undo.
    bool undoable = false;
    /// Commands to call first (metadata only).
    std::vector<std::string> requires_first;
    /// The confirmation question, enforced when the server runs with `CONFIRMATIONS`.
    std::optional<std::string> confirm_prompt;
    std::vector<std::string> errors;
    /// JSON Schema of the input object.
    Json input;
    /// JSON Schema of the result's `data`.
    Json output;
    std::vector<afd::CommandExample> examples;
    /// Every change declares one: `not_required` unless set.
    std::optional<afd::ApprovalPolicy> approval;
    /// The todos a successful change touched, read from its result's data. A change that
    /// touched none is not recorded.
    std::function<std::vector<std::string>(const Json& data)> changed;
    std::function<CommandResult(const Json& input, CommandContext& context)> run;
};

/// The definition of `command`: a change runs under `store.changing()` and, when it succeeds,
/// is recorded in the history with its actor, time, todos and undo. The registry's approval
/// middleware runs before the handler, so a held call is never recorded.
afd::CommandDefinition define(Command command, std::shared_ptr<TodoStore> store);

/// The time and id source for one change, from the context's clock and random (the system's
/// when the caller set neither), so tests and replays control both.
struct Stamp {
    std::int64_t at = 0;
    /// `at` as ISO 8601.
    std::string now;
    std::shared_ptr<afd::RandomSource> random;

    /// A new todo id, `todo-<ms>-<7 base-36 digits>`, as TypeScript makes them, so a seeded
    /// random gives the same ids in every language.
    [[nodiscard]] std::string new_id() const;
};

Stamp stamp(const CommandContext& context);

/// The context clock's time (the system's when the caller set none), as ISO 8601.
std::string now_iso(const CommandContext& context);

/// `NOT_FOUND` for an id with no live todo, with TypeScript's message and suggestion.
afd::CommandError not_found(const std::string& id);

afd::Warning warning(const char* code, std::string message, afd::WarningSeverity severity);

/// `"s"` unless `count` is one.
const char* plural(std::int64_t count);

/// `"text"`.
std::string in_quotes(const std::string& text);

/// Confidence of a batch: the share of items that succeeded.
double batch_confidence(std::int64_t succeeded, std::int64_t total);

/// The string ids in `value`, an array.
std::vector<std::string> ids_in(const Json& value);
/// The ids of the todos in `value`, an array of todos.
std::vector<std::string> todo_ids_in(const Json& value);
/// The id of the todo in `data`.
std::vector<std::string> todo_id_in(const Json& data);

std::optional<std::string> string_field(const Json& input, const char* key);
std::optional<bool> bool_field(const Json& input, const char* key);
/// An integer input, clamped to [0, 2^53 - 1]; `fallback` when absent.
std::int64_t integer_field(const Json& input, const char* key, std::int64_t fallback);

/// JSON Schema pieces shared by several commands.
namespace schema {
Json title(const char* description);
Json description(const char* description);
Json priority(const char* description);
Json priority_with_default();
Json id();
Json ids();
Json id_input();
Json ids_input();
Json todo();
Json todos();
Json strings();
Json failed();
Json summary();
} // namespace schema

// One function per command, in commands/*.cpp.
afd::CommandDefinition todo_create(std::shared_ptr<TodoStore> store);
afd::CommandDefinition todo_list(std::shared_ptr<TodoStore> store);
afd::CommandDefinition todo_get(std::shared_ptr<TodoStore> store);
afd::CommandDefinition todo_update(std::shared_ptr<TodoStore> store);
afd::CommandDefinition todo_toggle(std::shared_ptr<TodoStore> store);
afd::CommandDefinition todo_delete(std::shared_ptr<TodoStore> store);
afd::CommandDefinition todo_clear(std::shared_ptr<TodoStore> store);
afd::CommandDefinition todo_stats(std::shared_ptr<TodoStore> store);
afd::CommandDefinition todo_create_batch(std::shared_ptr<TodoStore> store);
afd::CommandDefinition todo_delete_batch(std::shared_ptr<TodoStore> store);
afd::CommandDefinition todo_toggle_batch(std::shared_ptr<TodoStore> store);
afd::CommandDefinition todo_restore(std::shared_ptr<TodoStore> store);
afd::CommandDefinition todo_history(std::shared_ptr<TodoStore> store);

} // namespace todo::detail

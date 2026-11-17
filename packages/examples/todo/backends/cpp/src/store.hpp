// In-memory todo storage: the live todos, the deleted ones (which todo-restore brings back) and
// the change history that todo-history reads, as the TypeScript backend's src/store/memory.ts
// keeps them.
//
// Times and ids come from the caller (the command context's clock and random), so the store
// reads no clock of its own. Every method is thread-safe; `changing()` additionally serializes a
// change with its history entry.
#pragma once

#include <cstddef>
#include <cstdint>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include <afd/json.hpp>

namespace todo {

/// How many changes the history keeps; older ones drop off.
inline constexpr std::size_t history_limit = 1000;

/// A todo. Unset optional fields are omitted on the wire.
struct Todo {
    std::string id;
    std::string title;
    std::optional<std::string> description;
    std::string priority = "medium";
    bool completed = false;
    std::string created_at;
    std::string updated_at;
    std::optional<std::string> completed_at;
    /// When it was deleted; set only on a deleted todo (`todo-list { deleted: true }`).
    std::optional<std::string> deleted_at;
};

void to_json(afd::Json& out, const Todo& todo);

struct NewTodo {
    std::string id;
    std::string title;
    std::optional<std::string> description;
    std::string priority = "medium";
    /// ISO 8601 time of creation.
    std::string now;
};

/// Filters of `todo-list`; an unset one matches everything.
struct TodoFilter {
    /// The deleted todos instead of the live ones.
    bool deleted = false;
    std::optional<bool> completed;
    std::optional<std::string> priority;
    std::optional<std::string> search;
};

/// Fields of `todo-update`; an unset one is left unchanged.
struct TodoUpdate {
    std::optional<std::string> title;
    /// An empty description removes it: the undo of an edit that added one sends "".
    std::optional<std::string> description;
    std::optional<std::string> priority;
    std::optional<bool> completed;

    [[nodiscard]] bool empty() const { return !title && !description && !priority && !completed; }
};

struct TodoStats {
    std::int64_t total = 0;
    std::int64_t completed = 0;
    std::int64_t pending = 0;
    std::int64_t low = 0;
    std::int64_t medium = 0;
    std::int64_t high = 0;
    double completion_rate = 0;
};

/// What a clear removed.
struct ClearResult {
    /// The todos removed for good, in the order they entered their list.
    std::vector<std::string> cleared_ids;
    /// Live todos left.
    std::int64_t remaining = 0;
};

/// How many todos a clear would remove now.
struct ClearCounts {
    std::int64_t completed = 0;
    std::int64_t live = 0;
    std::int64_t deleted = 0;
};

/// One recorded change, as `todo-history` returns it.
struct Change {
    std::int64_t seq = 0;
    std::string at;
    /// The actor's kind, or `unknown` when the surface set none.
    std::string actor_kind;
    std::optional<std::string> actor_id;
    std::string command;
    std::vector<std::string> ids;
    std::optional<std::string> undo_command;
    std::optional<afd::Json> undo_args;
    /// Set when a later change touched the same todos, so its undo is not offered.
    bool superseded = false;
};

void to_json(afd::Json& out, const Change& change);

class TodoStore {
public:
    TodoStore() = default;
    TodoStore(const TodoStore&) = delete;
    TodoStore& operator=(const TodoStore&) = delete;

    /// Hold while making a change and recording it, so a later history entry is always a later
    /// change. Reads do not take it.
    [[nodiscard]] std::unique_lock<std::mutex> changing();

    Todo create(NewTodo todo);
    /// A live todo; a deleted one is not returned.
    [[nodiscard]] std::optional<Todo> get(const std::string& id) const;
    /// Every todo matching `filter`, sorted by `sort_by` (`createdAt`, `updatedAt`, `priority`,
    /// `title` or `deletedAt`) in `sort_order` (`asc` or `desc`). Equal keys keep the order the
    /// todos entered their list in both directions, as JavaScript's stable sort with a negated
    /// comparison does; a restored todo counts as entering again. Paging is the caller's.
    [[nodiscard]] std::vector<Todo> list(const TodoFilter& filter, std::string_view sort_by,
                                         std::string_view sort_order) const;
    std::optional<Todo> update(const std::string& id, const TodoUpdate& update,
                               const std::string& now);
    std::optional<Todo> toggle(const std::string& id, const std::string& now);
    /// Moves a live todo to the deleted todos, from which `restore` brings it back until a clear
    /// empties them. Returns the deleted todo, or nothing when no live todo has this id.
    std::optional<Todo> remove(const std::string& id, const std::string& now);
    /// Brings a deleted todo back exactly as it was before the delete.
    std::optional<Todo> restore(const std::string& id);
    /// Removes the completed live todos for good.
    ClearResult clear_completed();
    /// Removes every deleted todo for good.
    ClearResult clear_deleted();
    /// Removes every todo, live and deleted, for good.
    ClearResult clear_all();
    /// Statistics over the live todos.
    [[nodiscard]] TodoStats stats() const;
    [[nodiscard]] ClearCounts counts() const;

    /// Adds a change to the history, numbering it, and keeps the latest `history_limit`.
    Change record(Change change);
    /// The recorded changes, oldest first.
    [[nodiscard]] std::vector<Change> history() const;

private:
    mutable std::mutex mutex_;
    std::mutex changing_;
    /// In the order they entered: a vector keeps ties in that order.
    std::vector<Todo> todos_;
    std::vector<Todo> deleted_;
    std::vector<Change> history_;
};

} // namespace todo

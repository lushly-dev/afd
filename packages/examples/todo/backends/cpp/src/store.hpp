// In-memory todo store (backends/typescript/src/store/memory.ts).
#pragma once

#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include <afd/json.hpp>
#include <afd/runtime.hpp>

namespace todo {

/// A todo. `description` and `completedAt` are omitted on the wire when unset.
struct Todo {
    std::string id;
    std::string title;
    std::optional<std::string> description;
    std::string priority = "medium";
    bool completed = false;
    std::string created_at;
    std::string updated_at;
    std::optional<std::string> completed_at;
};

void to_json(afd::Json& out, const Todo& todo);

struct TodoFilter {
    std::optional<bool> completed;
    std::optional<std::string> priority;
    std::optional<std::string> search;
    std::string sort_by = "createdAt";
    std::string sort_order = "desc";
    std::int64_t limit = 100;
    std::int64_t offset = 0;
};

struct TodoUpdate {
    std::optional<std::string> title;
    std::optional<std::string> description;
    std::optional<std::string> priority;
    std::optional<bool> completed;
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

/// Todos in insertion order. Not thread-safe: the stdio server handles one request at a time.
class TodoStore {
public:
    TodoStore(std::shared_ptr<const afd::Clock> clock, std::shared_ptr<afd::RandomSource> random);

    Todo create(std::string title, std::optional<std::string> description, std::string priority);
    [[nodiscard]] std::optional<Todo> get(const std::string& id) const;
    /// Filters, sorts (stably, so ties keep insertion order), then paginates.
    [[nodiscard]] std::vector<Todo> list(const TodoFilter& filter) const;
    std::optional<Todo> update(const std::string& id, const TodoUpdate& update);
    std::optional<Todo> toggle(const std::string& id);
    bool remove(const std::string& id);
    /// Returns {cleared, remaining}.
    std::pair<std::int64_t, std::int64_t> clear_completed();
    void clear();
    [[nodiscard]] std::int64_t count() const;
    [[nodiscard]] TodoStats stats() const;

private:
    [[nodiscard]] std::string now() const;
    Todo* find(const std::string& id);

    std::shared_ptr<const afd::Clock> clock_;
    std::shared_ptr<afd::RandomSource> random_;
    std::vector<Todo> todos_;
};

} // namespace todo

#include "store.hpp"

#include <algorithm>
#include <iterator>
#include <utility>

namespace todo {
namespace {

std::string ascii_lower(std::string text) {
    for (char& c : text) {
        if (c >= 'A' && c <= 'Z') {
            c = static_cast<char>(c - 'A' + 'a');
        }
    }
    return text;
}

int priority_rank(const std::string& priority) {
    return priority == "high" ? 3 : priority == "medium" ? 2 : 1;
}

// An approximation of JavaScript's localeCompare for titles: case-insensitive first, then by code
// unit. Exact for ASCII titles that differ in more than case.
int compare_titles(const std::string& a, const std::string& b) {
    const int folded = ascii_lower(a).compare(ascii_lower(b));
    return folded != 0 ? folded : a.compare(b);
}

int compare_optional(const std::optional<std::string>& a, const std::optional<std::string>& b) {
    if (a && b) {
        return a->compare(*b);
    }
    return a ? 1 : b ? -1 : 0;
}

int compare(const Todo& a, const Todo& b, std::string_view sort_by) {
    if (sort_by == "priority") {
        return priority_rank(a.priority) - priority_rank(b.priority);
    }
    if (sort_by == "title") {
        return compare_titles(a.title, b.title);
    }
    if (sort_by == "updatedAt") {
        return a.updated_at.compare(b.updated_at);
    }
    if (sort_by == "deletedAt") {
        return compare_optional(a.deleted_at, b.deleted_at);
    }
    return a.created_at.compare(b.created_at);
}

std::vector<Todo>::iterator find(std::vector<Todo>& todos, const std::string& id) {
    return std::find_if(todos.begin(), todos.end(),
                        [&](const Todo& todo) { return todo.id == id; });
}

std::vector<std::string> ids_of(const std::vector<Todo>& todos) {
    std::vector<std::string> ids;
    ids.reserve(todos.size());
    for (const Todo& todo : todos) {
        ids.push_back(todo.id);
    }
    return ids;
}

} // namespace

void to_json(afd::Json& out, const Todo& todo) {
    out = afd::Json::object();
    out["id"] = todo.id;
    out["title"] = todo.title;
    if (todo.description) {
        out["description"] = *todo.description;
    }
    out["priority"] = todo.priority;
    out["completed"] = todo.completed;
    out["createdAt"] = todo.created_at;
    out["updatedAt"] = todo.updated_at;
    if (todo.completed_at) {
        out["completedAt"] = *todo.completed_at;
    }
    if (todo.deleted_at) {
        out["deletedAt"] = *todo.deleted_at;
    }
}

void to_json(afd::Json& out, const Change& change) {
    afd::Json actor{{"kind", change.actor_kind}};
    if (change.actor_id) {
        actor["id"] = *change.actor_id;
    }
    out = afd::Json{{"seq", change.seq},
                    {"at", change.at},
                    {"actor", std::move(actor)},
                    {"command", change.command},
                    {"ids", change.ids}};
    if (change.undo_command) {
        out["undoCommand"] = *change.undo_command;
    }
    if (change.undo_args) {
        out["undoArgs"] = *change.undo_args;
    }
    if (change.superseded) {
        out["superseded"] = true;
    }
}

std::unique_lock<std::mutex> TodoStore::changing() {
    return std::unique_lock<std::mutex>(changing_);
}

Todo TodoStore::create(NewTodo todo) {
    Todo created;
    created.id = std::move(todo.id);
    created.title = std::move(todo.title);
    created.description = std::move(todo.description);
    created.priority = std::move(todo.priority);
    created.created_at = todo.now;
    created.updated_at = std::move(todo.now);
    const std::lock_guard lock(mutex_);
    todos_.push_back(created);
    return created;
}

std::optional<Todo> TodoStore::get(const std::string& id) const {
    const std::lock_guard lock(mutex_);
    const auto it =
        std::find_if(todos_.begin(), todos_.end(), [&](const Todo& todo) { return todo.id == id; });
    return it == todos_.end() ? std::nullopt : std::optional<Todo>(*it);
}

std::vector<Todo> TodoStore::list(const TodoFilter& filter, std::string_view sort_by,
                                  std::string_view sort_order) const {
    const std::string search = filter.search ? ascii_lower(*filter.search) : std::string();
    std::vector<Todo> results;
    {
        const std::lock_guard lock(mutex_);
        for (const Todo& todo : filter.deleted ? deleted_ : todos_) {
            if (filter.completed && todo.completed != *filter.completed) {
                continue;
            }
            if (filter.priority && todo.priority != *filter.priority) {
                continue;
            }
            if (!search.empty()) {
                const bool in_title = ascii_lower(todo.title).find(search) != std::string::npos;
                const bool in_description =
                    todo.description &&
                    ascii_lower(*todo.description).find(search) != std::string::npos;
                if (!in_title && !in_description) {
                    continue;
                }
            }
            results.push_back(todo);
        }
    }
    const bool ascending = sort_order == "asc";
    std::stable_sort(results.begin(), results.end(), [&](const Todo& a, const Todo& b) {
        const int comparison = compare(a, b, sort_by);
        return ascending ? comparison < 0 : comparison > 0;
    });
    return results;
}

std::optional<Todo> TodoStore::update(const std::string& id, const TodoUpdate& update,
                                      const std::string& now) {
    const std::lock_guard lock(mutex_);
    const auto it = find(todos_, id);
    if (it == todos_.end()) {
        return std::nullopt;
    }
    Todo& todo = *it;
    if (update.title) {
        todo.title = *update.title;
    }
    if (update.description) {
        todo.description =
            update.description->empty() ? std::nullopt : std::optional(*update.description);
    }
    if (update.priority) {
        todo.priority = *update.priority;
    }
    if (update.completed) {
        if (*update.completed && !todo.completed) {
            todo.completed_at = now;
        } else if (!*update.completed) {
            todo.completed_at.reset();
        }
        todo.completed = *update.completed;
    }
    todo.updated_at = now;
    return todo;
}

std::optional<Todo> TodoStore::toggle(const std::string& id, const std::string& now) {
    const std::lock_guard lock(mutex_);
    const auto it = find(todos_, id);
    if (it == todos_.end()) {
        return std::nullopt;
    }
    it->completed = !it->completed;
    it->completed_at = it->completed ? std::optional(now) : std::nullopt;
    it->updated_at = now;
    return *it;
}

std::optional<Todo> TodoStore::remove(const std::string& id, const std::string& now) {
    const std::lock_guard lock(mutex_);
    const auto it = find(todos_, id);
    if (it == todos_.end()) {
        return std::nullopt;
    }
    Todo todo = std::move(*it);
    todos_.erase(it);
    todo.deleted_at = now;
    deleted_.push_back(todo);
    return todo;
}

std::optional<Todo> TodoStore::restore(const std::string& id) {
    const std::lock_guard lock(mutex_);
    const auto it = find(deleted_, id);
    if (it == deleted_.end()) {
        return std::nullopt;
    }
    Todo todo = std::move(*it);
    deleted_.erase(it);
    todo.deleted_at.reset();
    todos_.push_back(todo);
    return todo;
}

ClearResult TodoStore::clear_completed() {
    const std::lock_guard lock(mutex_);
    ClearResult result;
    const auto kept = std::stable_partition(todos_.begin(), todos_.end(),
                                            [](const Todo& todo) { return !todo.completed; });
    for (auto it = kept; it != todos_.end(); ++it) {
        result.cleared_ids.push_back(it->id);
    }
    todos_.erase(kept, todos_.end());
    result.remaining = static_cast<std::int64_t>(todos_.size());
    return result;
}

ClearResult TodoStore::clear_deleted() {
    const std::lock_guard lock(mutex_);
    ClearResult result{ids_of(deleted_), static_cast<std::int64_t>(todos_.size())};
    deleted_.clear();
    return result;
}

ClearResult TodoStore::clear_all() {
    const std::lock_guard lock(mutex_);
    ClearResult result{ids_of(todos_), 0};
    const auto deleted = ids_of(deleted_);
    result.cleared_ids.insert(result.cleared_ids.end(), deleted.begin(), deleted.end());
    todos_.clear();
    deleted_.clear();
    return result;
}

TodoStats TodoStore::stats() const {
    const std::lock_guard lock(mutex_);
    TodoStats stats;
    stats.total = static_cast<std::int64_t>(todos_.size());
    for (const Todo& todo : todos_) {
        stats.completed += todo.completed ? 1 : 0;
        stats.low += todo.priority == "low" ? 1 : 0;
        stats.medium += todo.priority == "medium" ? 1 : 0;
        stats.high += todo.priority == "high" ? 1 : 0;
    }
    stats.pending = stats.total - stats.completed;
    stats.completion_rate =
        stats.total > 0 ? static_cast<double>(stats.completed) / static_cast<double>(stats.total)
                        : 0;
    return stats;
}

ClearCounts TodoStore::counts() const {
    const std::lock_guard lock(mutex_);
    const auto completed = std::count_if(todos_.begin(), todos_.end(),
                                         [](const Todo& todo) { return todo.completed; });
    return {static_cast<std::int64_t>(completed), static_cast<std::int64_t>(todos_.size()),
            static_cast<std::int64_t>(deleted_.size())};
}

Change TodoStore::record(Change change) {
    const std::lock_guard lock(mutex_);
    change.seq = history_.empty() ? 1 : history_.back().seq + 1;
    history_.push_back(change);
    if (history_.size() > history_limit) {
        history_.erase(history_.begin(), history_.begin() + static_cast<std::ptrdiff_t>(
                                                                history_.size() - history_limit));
    }
    return change;
}

std::vector<Change> TodoStore::history() const {
    const std::lock_guard lock(mutex_);
    return history_;
}

} // namespace todo

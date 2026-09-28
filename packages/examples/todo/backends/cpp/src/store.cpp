#include "store.hpp"

#include <algorithm>
#include <cctype>

namespace todo {
namespace {

std::string ascii_lower(std::string text) {
    for (char& c : text) {
        c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
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
}

TodoStore::TodoStore(std::shared_ptr<const afd::Clock> clock,
                     std::shared_ptr<afd::RandomSource> random)
    : clock_(std::move(clock)), random_(std::move(random)) {}

std::string TodoStore::now() const {
    return afd::wire::iso8601_utc(clock_->wall_ms());
}

Todo* TodoStore::find(const std::string& id) {
    const auto it =
        std::find_if(todos_.begin(), todos_.end(), [&](const Todo& todo) { return todo.id == id; });
    return it == todos_.end() ? nullptr : &*it;
}

Todo TodoStore::create(std::string title, std::optional<std::string> description,
                       std::string priority) {
    // "todo-<ms>-<7 base-36 characters>", as the TypeScript store generates.
    constexpr char digits[] = "0123456789abcdefghijklmnopqrstuvwxyz";
    std::string suffix;
    for (int i = 0; i < 7; ++i) {
        suffix.push_back(digits[static_cast<std::size_t>(random_->next() * 36.0)]);
    }
    Todo todo;
    todo.id = "todo-" + std::to_string(clock_->wall_ms()) + "-" + suffix;
    todo.title = std::move(title);
    todo.description = std::move(description);
    todo.priority = std::move(priority);
    todo.created_at = now();
    todo.updated_at = todo.created_at;
    todos_.push_back(todo);
    return todo;
}

std::optional<Todo> TodoStore::get(const std::string& id) const {
    const auto it =
        std::find_if(todos_.begin(), todos_.end(), [&](const Todo& todo) { return todo.id == id; });
    return it == todos_.end() ? std::nullopt : std::optional<Todo>(*it);
}

std::vector<Todo> TodoStore::list(const TodoFilter& filter) const {
    std::vector<Todo> results;
    const std::string search = filter.search ? ascii_lower(*filter.search) : std::string();
    for (const Todo& todo : todos_) {
        if (filter.completed && todo.completed != *filter.completed) {
            continue;
        }
        if (filter.priority && !filter.priority->empty() && todo.priority != *filter.priority) {
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

    const bool ascending = filter.sort_order == "asc";
    std::stable_sort(results.begin(), results.end(), [&](const Todo& a, const Todo& b) {
        int comparison = 0;
        if (filter.sort_by == "priority") {
            comparison = priority_rank(a.priority) - priority_rank(b.priority);
        } else if (filter.sort_by == "title") {
            comparison = compare_titles(a.title, b.title);
        } else if (filter.sort_by == "updatedAt") {
            comparison = a.updated_at.compare(b.updated_at);
        } else {
            comparison = a.created_at.compare(b.created_at);
        }
        return ascending ? comparison < 0 : comparison > 0;
    });

    const auto size = static_cast<std::int64_t>(results.size());
    const std::int64_t begin = (std::min)((std::max)(filter.offset, std::int64_t{0}), size);
    const std::int64_t end = (std::min)(begin + (std::max)(filter.limit, std::int64_t{0}), size);
    return {results.begin() + begin, results.begin() + end};
}

std::optional<Todo> TodoStore::update(const std::string& id, const TodoUpdate& update) {
    Todo* todo = find(id);
    if (todo == nullptr) {
        return std::nullopt;
    }
    const bool was_completed = todo->completed;
    if (update.title) {
        todo->title = *update.title;
    }
    if (update.description) {
        todo->description = *update.description;
    }
    if (update.priority) {
        todo->priority = *update.priority;
    }
    if (update.completed) {
        todo->completed = *update.completed;
        if (*update.completed && !was_completed) {
            todo->completed_at = now();
        } else if (!*update.completed && was_completed) {
            todo->completed_at.reset();
        }
    }
    todo->updated_at = now();
    return *todo;
}

std::optional<Todo> TodoStore::toggle(const std::string& id) {
    Todo* todo = find(id);
    if (todo == nullptr) {
        return std::nullopt;
    }
    todo->completed = !todo->completed;
    if (todo->completed) {
        todo->completed_at = now();
    } else {
        todo->completed_at.reset();
    }
    todo->updated_at = now();
    return *todo;
}

bool TodoStore::remove(const std::string& id) {
    const auto it =
        std::find_if(todos_.begin(), todos_.end(), [&](const Todo& todo) { return todo.id == id; });
    if (it == todos_.end()) {
        return false;
    }
    todos_.erase(it);
    return true;
}

std::pair<std::int64_t, std::int64_t> TodoStore::clear_completed() {
    const auto before = static_cast<std::int64_t>(todos_.size());
    todos_.erase(std::remove_if(todos_.begin(), todos_.end(),
                                [](const Todo& todo) { return todo.completed; }),
                 todos_.end());
    const auto remaining = static_cast<std::int64_t>(todos_.size());
    return {before - remaining, remaining};
}

void TodoStore::clear() {
    todos_.clear();
}

std::int64_t TodoStore::count() const {
    return static_cast<std::int64_t>(todos_.size());
}

TodoStats TodoStore::stats() const {
    TodoStats stats;
    stats.total = count();
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

} // namespace todo

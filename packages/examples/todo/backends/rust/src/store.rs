//! In-memory todo storage.
//!
//! Each command handler holds an `Arc<TodoStore>`, so tests get isolated stores.
//! A poisoned lock (a panic while holding it) is recovered rather than
//! propagated: every operation leaves the map consistent.

use crate::types::{Priority, PriorityStats, SortBy, SortOrder, Todo, TodoStats};
use chrono::Utc;
use std::cmp::Ordering;
use std::collections::HashMap;
use std::sync::{PoisonError, RwLock, RwLockReadGuard, RwLockWriteGuard};
use uuid::Uuid;

struct Entry {
    /// Insertion order, the tie-breaker for equal sort keys.
    seq: u64,
    todo: Todo,
}

#[derive(Default)]
struct Inner {
    next_seq: u64,
    todos: HashMap<String, Entry>,
}

#[derive(Default)]
pub struct TodoStore {
    inner: RwLock<Inner>,
}

pub struct NewTodo {
    pub title: String,
    pub description: Option<String>,
    pub priority: Priority,
}

/// Filters of `todo-list`; `None` matches everything.
#[derive(Default)]
pub struct Filter {
    pub completed: Option<bool>,
    pub priority: Option<Priority>,
    pub search: Option<String>,
}

/// Fields of `todo-update`; `None` leaves the field unchanged.
#[derive(Default)]
pub struct Changes {
    pub title: Option<String>,
    pub description: Option<String>,
    pub priority: Option<Priority>,
    pub completed: Option<bool>,
}

impl Changes {
    pub fn is_empty(&self) -> bool {
        self.title.is_none()
            && self.description.is_none()
            && self.priority.is_none()
            && self.completed.is_none()
    }
}

impl TodoStore {
    fn read(&self) -> RwLockReadGuard<'_, Inner> {
        self.inner.read().unwrap_or_else(PoisonError::into_inner)
    }

    fn write(&self) -> RwLockWriteGuard<'_, Inner> {
        self.inner.write().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn create(&self, new: NewTodo) -> Todo {
        let now = Utc::now();
        let todo = Todo {
            id: format!("todo-{}", Uuid::new_v4()),
            title: new.title,
            description: new.description,
            priority: new.priority,
            completed: false,
            created_at: now,
            updated_at: now,
            completed_at: None,
        };
        let mut inner = self.write();
        let seq = inner.next_seq;
        inner.next_seq += 1;
        inner.todos.insert(
            todo.id.clone(),
            Entry {
                seq,
                todo: todo.clone(),
            },
        );
        todo
    }

    pub fn get(&self, id: &str) -> Option<Todo> {
        self.read().todos.get(id).map(|entry| entry.todo.clone())
    }

    /// Every todo matching `filter`, sorted. Pagination is the caller's job, so
    /// it can report the total before paginating.
    pub fn list(&self, filter: &Filter, sort_by: SortBy, order: SortOrder) -> Vec<Todo> {
        let search = filter.search.as_deref().map(str::to_lowercase);
        let inner = self.read();
        let mut matches: Vec<&Entry> = inner
            .todos
            .values()
            .filter(|entry| {
                let todo = &entry.todo;
                filter.completed.is_none_or(|c| todo.completed == c)
                    && filter.priority.is_none_or(|p| todo.priority == p)
                    && search.as_deref().is_none_or(|needle| {
                        todo.title.to_lowercase().contains(needle)
                            || todo
                                .description
                                .as_deref()
                                .is_some_and(|d| d.to_lowercase().contains(needle))
                    })
            })
            .collect();

        matches.sort_by(|a, b| {
            // Insertion order breaks ties, in the requested direction too.
            let key = compare(&a.todo, &b.todo, sort_by).then(a.seq.cmp(&b.seq));
            if order == SortOrder::Desc {
                key.reverse()
            } else {
                key
            }
        });
        matches
            .into_iter()
            .map(|entry| entry.todo.clone())
            .collect()
    }

    pub fn update(&self, id: &str, changes: Changes) -> Option<Todo> {
        let mut inner = self.write();
        let todo = &mut inner.todos.get_mut(id)?.todo;
        let now = Utc::now();
        if let Some(title) = changes.title {
            todo.title = title;
        }
        if let Some(description) = changes.description {
            todo.description = Some(description);
        }
        if let Some(priority) = changes.priority {
            todo.priority = priority;
        }
        if let Some(completed) = changes.completed {
            if completed && !todo.completed {
                todo.completed_at = Some(now);
            } else if !completed {
                todo.completed_at = None;
            }
            todo.completed = completed;
        }
        todo.updated_at = now;
        Some(todo.clone())
    }

    pub fn toggle(&self, id: &str) -> Option<Todo> {
        let mut inner = self.write();
        let todo = &mut inner.todos.get_mut(id)?.todo;
        let now = Utc::now();
        todo.completed = !todo.completed;
        todo.completed_at = todo.completed.then_some(now);
        todo.updated_at = now;
        Some(todo.clone())
    }

    /// Remove a todo, returning it.
    pub fn delete(&self, id: &str) -> Option<Todo> {
        self.write().todos.remove(id).map(|entry| entry.todo)
    }

    /// Remove completed todos. Returns `(cleared, remaining)`.
    pub fn clear_completed(&self) -> (usize, usize) {
        let mut inner = self.write();
        let before = inner.todos.len();
        inner.todos.retain(|_, entry| !entry.todo.completed);
        (before - inner.todos.len(), inner.todos.len())
    }

    /// Remove every todo. Returns how many were removed.
    pub fn clear_all(&self) -> usize {
        let mut inner = self.write();
        let cleared = inner.todos.len();
        inner.todos.clear();
        cleared
    }

    pub fn stats(&self) -> TodoStats {
        let inner = self.read();
        let total = inner.todos.len();
        let mut completed = 0;
        let mut by_priority = PriorityStats::default();
        for entry in inner.todos.values() {
            if entry.todo.completed {
                completed += 1;
            }
            match entry.todo.priority {
                Priority::Low => by_priority.low += 1,
                Priority::Medium => by_priority.medium += 1,
                Priority::High => by_priority.high += 1,
            }
        }
        TodoStats {
            total,
            completed,
            pending: total - completed,
            by_priority,
            completion_rate: if total > 0 {
                completed as f64 / total as f64
            } else {
                0.0
            },
        }
    }
}

fn compare(a: &Todo, b: &Todo, sort_by: SortBy) -> Ordering {
    match sort_by {
        SortBy::CreatedAt => a.created_at.cmp(&b.created_at),
        SortBy::UpdatedAt => a.updated_at.cmp(&b.updated_at),
        SortBy::Priority => a.priority.rank().cmp(&b.priority.rank()),
        SortBy::Title => a
            .title
            .to_lowercase()
            .cmp(&b.title.to_lowercase())
            .then_with(|| a.title.cmp(&b.title)),
    }
}

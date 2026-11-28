//! In-memory todo storage: the live todos, the deleted ones (which `todo-restore` brings back)
//! and the change history that `todo-history` reads, as the TypeScript backend's
//! `src/store/memory.ts` keeps them.
//!
//! Each command handler holds an `Arc<TodoStore>`, so tests get isolated stores. A poisoned lock
//! (a panic while holding it) is recovered rather than propagated: every operation leaves the
//! store consistent.

use crate::types::{Priority, PriorityStats, SortBy, SortOrder, Todo, TodoStats};
use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::{Map, Value};
use std::cmp::Ordering;
use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard, PoisonError, RwLock, RwLockReadGuard, RwLockWriteGuard};

/// How many changes the history keeps; older ones drop off.
pub const HISTORY_LIMIT: usize = 1000;

struct Entry {
    /// When the todo entered its list: the tie-breaker for equal sort keys, so ties keep the
    /// order todos were added (a restored todo counts as added again, as in TypeScript).
    seq: u64,
    todo: Todo,
}

#[derive(Default)]
struct Inner {
    next_seq: u64,
    todos: HashMap<String, Entry>,
    deleted: HashMap<String, Entry>,
    history: Vec<Change>,
}

impl Inner {
    fn next_seq(&mut self) -> u64 {
        let seq = self.next_seq;
        self.next_seq += 1;
        seq
    }
}

#[derive(Default)]
pub struct TodoStore {
    inner: RwLock<Inner>,
    /// Held across a change and its history entry ([`TodoStore::changing`]), so concurrent
    /// changes are recorded in the order they happened.
    changing: Mutex<()>,
    /// The answers of calls a command keys in its handler, by scope (`spec/idempotency.md`, "Two
    /// tiers"). For this process only: a store that persisted todos would commit the key with the
    /// todos in one transaction instead, which is what lets a handler promise a change is made
    /// once; this example's promise ends with the process, as the default idempotency store's
    /// does (S13).
    keyed: Mutex<HashMap<String, KeyedAnswer>>,
}

/// How long a keyed answer is kept: a day, as the registry's idempotency step keeps one.
const KEYED_ANSWER_TTL_MS: i64 = 86_400_000;

/// The answer of a keyed call: its input as sent and its result, until `expires_at`.
#[derive(Clone)]
pub struct KeyedAnswer {
    pub digest: String,
    pub result: afd::CommandResult<serde_json::Value>,
    expires_at: i64,
}

pub struct NewTodo {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub priority: Priority,
    pub now: DateTime<Utc>,
}

/// Filters of `todo-list`; `None` matches everything.
#[derive(Default, Clone)]
pub struct Filter {
    /// The deleted todos instead of the live ones.
    pub deleted: bool,
    pub completed: Option<bool>,
    pub priority: Option<Priority>,
    pub search: Option<String>,
}

/// Fields of `todo-update`; `None` leaves the field unchanged.
#[derive(Default)]
pub struct Changes {
    pub title: Option<String>,
    /// An empty description is none: an undo of an edit that added one sends `""`.
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

/// What a clear removed.
pub struct ClearResult {
    /// The todos removed for good.
    pub cleared_ids: Vec<String>,
    /// Live todos left.
    pub remaining: usize,
}

/// Who made a change: the context's actor kind and id, or `unknown` when the surface set none.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ChangeActor {
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
}

/// One recorded change, in the wire's camelCase (`todo-history`'s entries).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub seq: u64,
    pub at: String,
    pub actor: ChangeActor,
    pub command: String,
    pub ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub undo_command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub undo_args: Option<Map<String, Value>>,
    /// Set when a later change touched the same todos, so its undo is not offered.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub superseded: Option<bool>,
}

impl TodoStore {
    /// An empty store.
    pub fn new() -> Self {
        Self::default()
    }

    /// Hold while making a change and recording it: one change and its history entry at a time,
    /// so a later entry is always a later change and `todo-history` marks the right ones
    /// superseded. Reads do not take it.
    pub fn changing(&self) -> MutexGuard<'_, ()> {
        self.changing.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The answer kept for `scope` that has not expired at `now`, dropping expired ones.
    pub fn keyed_answer(&self, scope: &str, now: i64) -> Option<KeyedAnswer> {
        let mut keyed = self.keyed.lock().unwrap_or_else(PoisonError::into_inner);
        keyed.retain(|_, answer| now <= answer.expires_at);
        keyed.get(scope).cloned()
    }

    /// Keep `result` as the answer of `scope` for a day from `now`.
    pub fn keep_keyed_answer(
        &self,
        scope: String,
        digest: String,
        result: afd::CommandResult<serde_json::Value>,
        now: i64,
    ) {
        let answer = KeyedAnswer {
            digest,
            result,
            expires_at: now.saturating_add(KEYED_ANSWER_TTL_MS),
        };
        self.keyed
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(scope, answer);
    }

    fn read(&self) -> RwLockReadGuard<'_, Inner> {
        self.inner.read().unwrap_or_else(PoisonError::into_inner)
    }

    fn write(&self) -> RwLockWriteGuard<'_, Inner> {
        self.inner.write().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn create(&self, new: NewTodo) -> Todo {
        let todo = Todo {
            id: new.id,
            title: new.title,
            description: new.description,
            priority: new.priority,
            completed: false,
            created_at: new.now,
            updated_at: new.now,
            completed_at: None,
            deleted_at: None,
        };
        let mut inner = self.write();
        let seq = inner.next_seq();
        inner.todos.insert(
            todo.id.clone(),
            Entry {
                seq,
                todo: todo.clone(),
            },
        );
        todo
    }

    /// A live todo. A deleted one is not returned.
    pub fn get(&self, id: &str) -> Option<Todo> {
        self.read().todos.get(id).map(|entry| entry.todo.clone())
    }

    /// Every todo matching `filter`, sorted. Pagination is the caller's job, so it can report
    /// the total before paginating.
    ///
    /// Equal sort keys keep the order the todos entered their list in both directions, as
    /// JavaScript's stable `Array.prototype.sort` with a negated comparison does.
    pub fn list(&self, filter: &Filter, sort_by: SortBy, order: SortOrder) -> Vec<Todo> {
        let search = filter.search.as_deref().map(str::to_lowercase);
        let inner = self.read();
        let source = if filter.deleted {
            &inner.deleted
        } else {
            &inner.todos
        };
        let mut matches: Vec<&Entry> = source
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
            let key = compare(&a.todo, &b.todo, sort_by);
            let key = if order == SortOrder::Desc {
                key.reverse()
            } else {
                key
            };
            key.then(a.seq.cmp(&b.seq))
        });
        matches
            .into_iter()
            .map(|entry| entry.todo.clone())
            .collect()
    }

    pub fn update(&self, id: &str, changes: Changes, now: DateTime<Utc>) -> Option<Todo> {
        let mut inner = self.write();
        let todo = &mut inner.todos.get_mut(id)?.todo;
        if let Some(title) = changes.title {
            todo.title = title;
        }
        if let Some(description) = changes.description {
            todo.description = (!description.is_empty()).then_some(description);
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

    pub fn toggle(&self, id: &str, now: DateTime<Utc>) -> Option<Todo> {
        let mut inner = self.write();
        let todo = &mut inner.todos.get_mut(id)?.todo;
        todo.completed = !todo.completed;
        todo.completed_at = todo.completed.then_some(now);
        todo.updated_at = now;
        Some(todo.clone())
    }

    /// Move a live todo to the deleted todos, from which [`TodoStore::restore`] brings it back,
    /// until a clear empties them. Returns the deleted todo, or `None` when no live todo has
    /// this id.
    pub fn delete(&self, id: &str, now: DateTime<Utc>) -> Option<Todo> {
        let mut inner = self.write();
        let mut todo = inner.todos.remove(id)?.todo;
        todo.deleted_at = Some(now);
        let seq = inner.next_seq();
        inner.deleted.insert(
            id.to_string(),
            Entry {
                seq,
                todo: todo.clone(),
            },
        );
        Some(todo)
    }

    /// Bring a deleted todo back exactly as it was before the delete. Returns it, or `None` when
    /// no deleted todo has this id.
    pub fn restore(&self, id: &str) -> Option<Todo> {
        let mut inner = self.write();
        let mut todo = inner.deleted.remove(id)?.todo;
        todo.deleted_at = None;
        let seq = inner.next_seq();
        inner.todos.insert(
            id.to_string(),
            Entry {
                seq,
                todo: todo.clone(),
            },
        );
        Some(todo)
    }

    /// Remove the completed live todos for good.
    pub fn clear_completed(&self) -> ClearResult {
        let mut inner = self.write();
        let cleared_ids = ids_in_order(&inner.todos, |todo| todo.completed);
        for id in &cleared_ids {
            inner.todos.remove(id);
        }
        ClearResult {
            cleared_ids,
            remaining: inner.todos.len(),
        }
    }

    /// Remove every deleted todo for good.
    pub fn clear_deleted(&self) -> ClearResult {
        let mut inner = self.write();
        let cleared_ids = ids_in_order(&inner.deleted, |_| true);
        inner.deleted.clear();
        ClearResult {
            cleared_ids,
            remaining: inner.todos.len(),
        }
    }

    /// Remove every todo, live and deleted, for good.
    pub fn clear_all(&self) -> ClearResult {
        let mut inner = self.write();
        let mut cleared_ids = ids_in_order(&inner.todos, |_| true);
        cleared_ids.extend(ids_in_order(&inner.deleted, |_| true));
        inner.todos.clear();
        inner.deleted.clear();
        ClearResult {
            cleared_ids,
            remaining: 0,
        }
    }

    /// Statistics over the live todos.
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

    /// How many todos a clear would remove now: `(completed live, live, deleted)`.
    pub fn counts(&self) -> (usize, usize, usize) {
        let inner = self.read();
        let completed = inner
            .todos
            .values()
            .filter(|entry| entry.todo.completed)
            .count();
        (completed, inner.todos.len(), inner.deleted.len())
    }

    /// Add a change to the history, numbering it, and keep the latest [`HISTORY_LIMIT`].
    pub fn record(&self, mut change: Change) -> Change {
        let mut inner = self.write();
        change.seq = inner.history.last().map_or(0, |last| last.seq) + 1;
        inner.history.push(change.clone());
        let excess = inner.history.len().saturating_sub(HISTORY_LIMIT);
        inner.history.drain(..excess);
        change
    }

    /// The recorded changes, oldest first.
    pub fn history(&self) -> Vec<Change> {
        self.read().history.clone()
    }
}

/// The ids in `todos` that match `keep`, in the order they entered.
fn ids_in_order(todos: &HashMap<String, Entry>, keep: impl Fn(&Todo) -> bool) -> Vec<String> {
    let mut entries: Vec<&Entry> = todos.values().filter(|entry| keep(&entry.todo)).collect();
    entries.sort_by_key(|entry| entry.seq);
    entries
        .into_iter()
        .map(|entry| entry.todo.id.clone())
        .collect()
}

fn compare(a: &Todo, b: &Todo, sort_by: SortBy) -> Ordering {
    match sort_by {
        SortBy::CreatedAt => a.created_at.cmp(&b.created_at),
        SortBy::UpdatedAt => a.updated_at.cmp(&b.updated_at),
        SortBy::Priority => a.priority.rank().cmp(&b.priority.rank()),
        // Not JavaScript's `localeCompare`: case folded, then exact (see the README).
        SortBy::Title => a
            .title
            .to_lowercase()
            .cmp(&b.title.to_lowercase())
            .then_with(|| a.title.cmp(&b.title)),
        SortBy::DeletedAt => a.deleted_at.cmp(&b.deleted_at),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(ms: i64) -> DateTime<Utc> {
        DateTime::from_timestamp_millis(ms).expect("a valid time")
    }

    fn add(store: &TodoStore, id: &str, ms: i64) {
        store.create(NewTodo {
            id: id.to_string(),
            title: "Same".to_string(),
            description: None,
            priority: Priority::Medium,
            now: at(ms),
        });
    }

    fn ids(todos: Vec<Todo>) -> Vec<String> {
        todos.into_iter().map(|todo| todo.id).collect()
    }

    #[test]
    fn ties_keep_insertion_order_in_both_directions() {
        let store = TodoStore::new();
        for id in ["a", "b", "c"] {
            add(&store, id, 1_000);
        }
        add(&store, "d", 2_000);
        let filter = Filter::default();
        assert_eq!(
            ids(store.list(&filter, SortBy::CreatedAt, SortOrder::Desc)),
            ["d", "a", "b", "c"]
        );
        assert_eq!(
            ids(store.list(&filter, SortBy::CreatedAt, SortOrder::Asc)),
            ["a", "b", "c", "d"]
        );
    }

    #[test]
    fn a_deleted_todo_leaves_the_live_list_and_comes_back_as_it_was() {
        let store = TodoStore::new();
        add(&store, "a", 1_000);
        let deleted = store.delete("a", at(5_000)).expect("deleted");
        assert_eq!(deleted.deleted_at, Some(at(5_000)));
        assert!(store.get("a").is_none());
        let filter = Filter {
            deleted: true,
            ..Filter::default()
        };
        assert_eq!(
            ids(store.list(&filter, SortBy::DeletedAt, SortOrder::Desc)),
            ["a"]
        );
        let restored = store.restore("a").expect("restored");
        assert_eq!(restored.deleted_at, None);
        assert_eq!(restored.created_at, at(1_000));
        assert!(store.restore("a").is_none());
    }

    #[test]
    fn the_history_keeps_the_latest_changes() {
        let store = TodoStore::new();
        for _ in 0..HISTORY_LIMIT + 5 {
            store.record(Change {
                seq: 0,
                at: String::new(),
                actor: ChangeActor {
                    kind: "test".to_string(),
                    id: None,
                },
                command: "todo-create".to_string(),
                ids: vec![],
                undo_command: None,
                undo_args: None,
                superseded: None,
            });
        }
        let history = store.history();
        assert_eq!(history.len(), HISTORY_LIMIT);
        assert_eq!(history[0].seq, 6);
        assert_eq!(history[HISTORY_LIMIT - 1].seq, (HISTORY_LIMIT + 5) as u64);
    }
}

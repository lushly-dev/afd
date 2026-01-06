use crate::types::{Todo, TodoFilter, Priority};
use dashmap::DashMap;
use lazy_static::lazy_static;
use chrono::Utc;
use uuid::Uuid;

lazy_static! {
    pub static ref STORE: DashMap<String, Todo> = DashMap::new();
}

pub fn clear() {
    STORE.clear();
}

pub fn create(title: String, description: Option<String>, priority: Option<Priority>) -> Todo {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now();
    let todo = Todo {
        id: id.clone(),
        title,
        description,
        priority: priority.unwrap_or_default(),
        completed: false,
        created_at: now,
        updated_at: now,
        completed_at: None,
    };
    STORE.insert(id, todo.clone());
    todo
}

pub fn get(id: &str) -> Option<Todo> {
    STORE.get(id).map(|r| r.value().clone())
}

pub fn list(filter: TodoFilter) -> Vec<Todo> {
    let mut todos: Vec<Todo> = STORE.iter().map(|r| r.value().clone()).collect();

    // Apply filters
    if let Some(completed) = filter.completed {
        todos.retain(|t| t.completed == completed);
    }
    if let Some(priority) = filter.priority {
        todos.retain(|t| t.priority == priority);
    }
    if let Some(search) = filter.search {
        let search = search.to_lowercase();
        todos.retain(|t| {
            t.title.to_lowercase().contains(&search) || 
            t.description.as_ref().map(|d| d.to_lowercase().contains(&search)).unwrap_or(false)
        });
    }

    // Sort
    let sort_by = filter.sort_by.unwrap_or_else(|| "createdAt".to_string());
    let sort_order = filter.sort_order.unwrap_or_else(|| "desc".to_string());

    todos.sort_by(|a, b| {
        let cmp = match sort_by.as_str() {
            "title" => a.title.cmp(&b.title),
            "priority" => {
                let p_val = |p: &Priority| match p {
                    Priority::Low => 0,
                    Priority::Medium => 1,
                    Priority::High => 2,
                };
                p_val(&a.priority).cmp(&p_val(&b.priority))
            },
            "updatedAt" => a.updated_at.cmp(&b.updated_at),
            _ => a.created_at.cmp(&b.created_at),
        };

        if sort_order == "desc" {
            cmp.reverse()
        } else {
            cmp
        }
    });

    // Pagination
    let offset = filter.offset.unwrap_or(0);
    let limit = filter.limit.unwrap_or(todos.len());

    todos.into_iter().skip(offset).take(limit).collect()
}

pub fn update(id: &str, title: Option<String>, description: Option<String>, priority: Option<Priority>, completed: Option<bool>) -> Option<Todo> {
    if let Some(mut todo) = STORE.get_mut(id) {
        if let Some(title) = title {
            todo.title = title;
        }
        if let Some(description) = description {
            todo.description = Some(description);
        }
        if let Some(priority) = priority {
            todo.priority = priority;
        }
        if let Some(completed) = completed {
            if completed && !todo.completed {
                todo.completed_at = Some(Utc::now());
            } else if !completed {
                todo.completed_at = None;
            }
            todo.completed = completed;
        }
        todo.updated_at = Utc::now();
        Some(todo.value().clone())
    } else {
        None
    }
}

pub fn delete(id: &str) -> bool {
    STORE.remove(id).is_some()
}

pub fn toggle(id: &str) -> Option<Todo> {
    if let Some(mut todo) = STORE.get_mut(id) {
        let new_status = !todo.completed;
        todo.completed = new_status;
        if new_status {
            todo.completed_at = Some(Utc::now());
        } else {
            todo.completed_at = None;
        }
        todo.updated_at = Utc::now();
        Some(todo.value().clone())
    } else {
        None
    }
}

use super::{ok, Command};
use crate::store::{Filter, TodoStore};
use crate::types::{Priority, SortBy, SortOrder, Todo};
use afd::CommandResult;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;

pub struct List(pub Arc<TodoStore>);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Input {
    completed: Option<bool>,
    priority: Option<Priority>,
    search: Option<String>,
    sort_by: SortBy,
    sort_order: SortOrder,
    limit: usize,
    offset: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Output {
    todos: Vec<Todo>,
    /// Todos matching the filters, before pagination.
    total: usize,
    /// Whether more matching todos follow this page.
    has_more: bool,
}

impl Command for List {
    type Input = Input;
    const NAME: &'static str = "todo-list";
    const DESCRIPTION: &'static str = "List todos with optional filtering and pagination";
    const MUTATION: bool = false;

    fn schema() -> Value {
        json!({
            "type": "object",
            "properties": {
                "completed": { "type": "boolean", "description": "Filter by completion status" },
                "priority": super::schema::priority("Filter by priority"),
                "search": { "type": "string", "description": "Search in title and description" },
                "sortBy": {
                    "type": "string",
                    "enum": ["createdAt", "updatedAt", "priority", "title"],
                    "default": "createdAt",
                    "description": "Sort field"
                },
                "sortOrder": {
                    "type": "string",
                    "enum": ["asc", "desc"],
                    "default": "desc",
                    "description": "Sort direction"
                },
                "limit": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 100,
                    "default": 20,
                    "description": "Page size (1 to 100)"
                },
                "offset": {
                    "type": "integer",
                    "minimum": 0,
                    "default": 0,
                    "description": "Todos to skip"
                }
            }
        })
    }

    fn run(&self, input: Input) -> CommandResult<Value> {
        let filter = Filter {
            completed: input.completed,
            priority: input.priority,
            search: input.search,
        };
        let matching = self.0.list(&filter, input.sort_by, input.sort_order);
        let total = matching.len();
        let todos: Vec<Todo> = matching
            .into_iter()
            .skip(input.offset)
            .take(input.limit)
            .collect();
        let has_more = input.offset + todos.len() < total;

        let reasoning = format!(
            "Found {total} todos, returning {} starting at offset {}",
            todos.len(),
            input.offset
        );
        ok(
            &Output {
                todos,
                total,
                has_more,
            },
            reasoning,
            1.0,
            Vec::new(),
        )
    }
}

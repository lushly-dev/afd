use super::{ok, schema, Command, Reply};
use crate::store::{Filter, TodoStore};
use crate::types::{Priority, SortBy, SortOrder, Todo};
use afd::{Alternative, CommandContext, CommandExample, CommandResult};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;

pub struct List(pub Arc<TodoStore>);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Input {
    deleted: Option<bool>,
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

impl List {
    /// One page of the todos matching `filter`, with the total before paging.
    fn page(&self, filter: &Filter, input: &Input) -> Output {
        let matching = self.0.list(filter, input.sort_by, input.sort_order);
        let total = matching.len();
        let todos: Vec<Todo> = matching
            .into_iter()
            .skip(input.offset)
            .take(input.limit)
            .collect();
        let has_more = input.offset + todos.len() < total;
        Output {
            todos,
            total,
            has_more,
        }
    }
}

impl Command for List {
    type Input = Input;
    const NAME: &'static str = "todo-list";
    const TITLE: &'static str = "List todos";
    const DESCRIPTION: &'static str = "List todos with optional filtering and pagination";
    const TAGS: &'static [&'static str] = &["todo", "list", "read"];
    const MUTATION: bool = false;

    fn schema() -> Value {
        json!({
            "type": "object",
            "properties": {
                "deleted": {
                    "type": "boolean",
                    "description": "If true, list the deleted todos, which todo-restore brings back, instead of live ones"
                },
                "completed": { "type": "boolean", "description": "Filter by completion status" },
                "priority": schema::priority("Filter by priority"),
                "search": { "type": "string", "description": "Search in title and description" },
                "sortBy": {
                    "type": "string",
                    "enum": ["createdAt", "updatedAt", "priority", "title", "deletedAt"],
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
                    "description": "Maximum results (1-100)"
                },
                "offset": {
                    "type": "integer",
                    "minimum": 0,
                    "default": 0,
                    "description": "Offset for pagination"
                }
            }
        })
    }

    fn output() -> Value {
        json!({
            "type": "object",
            "properties": {
                "todos": schema::todos(),
                "total": { "type": "integer" },
                "hasMore": { "type": "boolean" }
            },
            "required": ["todos", "total", "hasMore"]
        })
    }

    fn examples() -> Vec<CommandExample> {
        vec![
            CommandExample::new(
                "Open high-priority todos",
                json!({ "completed": false, "priority": "high" }),
            ),
            CommandExample::new(
                "Deleted todos, most recent first",
                json!({ "deleted": true, "sortBy": "deletedAt" }),
            ),
        ]
    }

    fn run(&self, input: Input, _context: &CommandContext) -> CommandResult<Value> {
        let deleted = input.deleted == Some(true);
        let filter = Filter {
            deleted,
            completed: input.completed,
            priority: input.priority,
            search: input.search.clone(),
        };
        let result = self.page(&filter, &input);

        let mut filters: Vec<String> = Vec::new();
        if deleted {
            filters.push("deleted".to_string());
        }
        if let Some(completed) = input.completed {
            filters.push(if completed { "completed" } else { "pending" }.to_string());
        }
        if let Some(priority) = input.priority {
            filters.push(format!("{} priority", priority.as_str()));
        }
        // An empty search matches everything, and TypeScript leaves it out of the reasoning.
        if let Some(search) = input.search.as_deref().filter(|search| !search.is_empty()) {
            filters.push(format!("matching \"{search}\""));
        }
        let filter_text = if filters.is_empty() {
            String::new()
        } else {
            format!(" ({})", filters.join(", "))
        };
        let mut reply = Reply::new(
            format!(
                "Found {} todos{}, returning {} starting at offset {}",
                result.total,
                filter_text,
                result.todos.len(),
                input.offset
            ),
            1.0,
        );

        // The AFD alternatives pattern: when filtered, also offer the unfiltered view and, for a
        // completion filter, the opposite one.
        if input.completed.is_some() || input.priority.is_some() || input.search.is_some() {
            let everything = self.page(
                &Filter {
                    deleted,
                    ..Filter::default()
                },
                &input,
            );
            let reason = format!("View all {} todos without filters", everything.total);
            if let Ok(data) = serde_json::to_value(&everything) {
                reply
                    .alternatives
                    .push(Alternative::new(data, reason).with_confidence(1.0));
            }
            if let Some(completed) = input.completed {
                let opposite = self.page(
                    &Filter {
                        completed: Some(!completed),
                        ..filter.clone()
                    },
                    &input,
                );
                if opposite.total > 0 {
                    let label = if completed { "pending" } else { "completed" };
                    let reason = format!("View {label} todos instead ({})", opposite.total);
                    if let Ok(data) = serde_json::to_value(&opposite) {
                        reply
                            .alternatives
                            .push(Alternative::new(data, reason).with_confidence(1.0));
                    }
                }
            }
        }
        ok(&result, reply)
    }
}

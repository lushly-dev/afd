use super::{not_found, ok, schema, stamp, todo_id_in, Command, Reply, EXAMPLE_ID};
use crate::store::{Changes, TodoStore};
use crate::types::Priority;
use afd::{
    failure, CommandContext, CommandError, CommandExample, CommandResult, IdempotencySupport,
};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::sync::Arc;

pub struct Update(pub Arc<TodoStore>);

#[derive(Deserialize)]
pub struct Input {
    id: String,
    title: Option<String>,
    description: Option<String>,
    priority: Option<Priority>,
    completed: Option<bool>,
}

impl Command for Update {
    type Input = Input;
    const NAME: &'static str = "todo-update";
    const TITLE: &'static str = "Update a todo";
    const DESCRIPTION: &'static str =
        "Update a todo's title, description, priority or completion; the result names the undo";
    const TAGS: &'static [&'static str] = &["todo", "update", "write", "single"];
    const MUTATION: bool = true;
    const IDEMPOTENCY: Option<IdempotencySupport> = Some(IdempotencySupport::Keyed);
    const UNDOABLE: bool = true;

    fn schema() -> Value {
        json!({
            "type": "object",
            "properties": {
                "id": schema::id(),
                "title": schema::title("New title"),
                "description": schema::description("New description; an empty one removes it"),
                "completed": { "type": "boolean", "description": "Mark completed or pending" },
                "priority": schema::priority("New priority")
            },
            "required": ["id"]
        })
    }

    fn output() -> Value {
        schema::todo()
    }

    fn examples() -> Vec<CommandExample> {
        vec![CommandExample::new(
            "Rename and reprioritise",
            json!({
                "id": EXAMPLE_ID,
                "title": "Order seed potatoes and onions",
                "priority": "high"
            }),
        )]
    }

    fn changed(data: &Value) -> Vec<String> {
        todo_id_in(data)
    }

    fn run(&self, input: Input, context: &CommandContext) -> CommandResult<Value> {
        let changes = Changes {
            title: input.title,
            description: input.description,
            priority: input.priority,
            completed: input.completed,
        };
        if changes.is_empty() {
            return failure(
                CommandError::new("NO_CHANGES", "No fields to update")
                    .with_suggestion(
                        "Provide at least one of: title, description, completed, priority",
                    )
                    .with_retryable(false),
            );
        }
        let Some(existing) = self.0.get(&input.id) else {
            return failure(not_found(&input.id));
        };

        // The summary and the undo, before the changes move into the store. The undo sets each
        // changed field back; a description that was absent comes back as "", which the store
        // treats as none.
        let mut summary: Vec<String> = Vec::new();
        let mut previous = Map::new();
        previous.insert("id".into(), json!(input.id));
        if let Some(title) = &changes.title {
            summary.push(format!("title to \"{title}\""));
            previous.insert("title".into(), json!(existing.title));
        }
        if changes.description.is_some() {
            summary.push("description".to_string());
            previous.insert(
                "description".into(),
                json!(existing.description.clone().unwrap_or_default()),
            );
        }
        if changes.completed.is_some() {
            previous.insert("completed".into(), json!(existing.completed));
        }
        if let Some(priority) = changes.priority {
            summary.push(format!("priority to {}", priority.as_str()));
            previous.insert("priority".into(), json!(existing.priority));
        }

        match self.0.update(&input.id, changes, stamp(context).now) {
            Some(todo) => {
                let reasoning =
                    format!("Updated {} for todo \"{}\"", summary.join(", "), todo.title);
                let reply = Reply::new(reasoning, 1.0).undo("todo-update", Value::Object(previous));
                ok(&todo, reply)
            }
            None => failure(not_found(&input.id)),
        }
    }
}

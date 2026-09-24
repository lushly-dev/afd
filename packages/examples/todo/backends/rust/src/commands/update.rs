use super::{not_found, ok, schema, Command};
use crate::store::{Changes, TodoStore};
use crate::types::Priority;
use afd::{failure, CommandError, CommandResult};
use serde::Deserialize;
use serde_json::{json, Value};
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
    const DESCRIPTION: &'static str = "Update a todo's title, description, priority or status";
    const MUTATION: bool = true;

    fn schema() -> Value {
        json!({
            "type": "object",
            "properties": {
                "id": schema::id(),
                "title": schema::title(),
                "description": schema::description(),
                "priority": schema::priority("New priority"),
                "completed": { "type": "boolean", "description": "New completion status" }
            },
            "required": ["id"]
        })
    }

    fn run(&self, input: Input) -> CommandResult<Value> {
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

        match self.0.update(&input.id, changes) {
            Some(todo) => {
                let reasoning = format!("Updated todo \"{}\"", todo.title);
                ok(&todo, reasoning, 1.0, Vec::new())
            }
            None => failure(not_found(&input.id)),
        }
    }
}

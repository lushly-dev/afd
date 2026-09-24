use super::{ok, schema, Command};
use crate::store::{NewTodo, TodoStore};
use crate::types::Priority;
use afd::CommandResult;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;

pub struct Create(pub Arc<TodoStore>);

#[derive(Deserialize)]
pub struct Input {
    title: String,
    description: Option<String>,
    priority: Priority,
}

impl Command for Create {
    type Input = Input;
    const NAME: &'static str = "todo-create";
    const DESCRIPTION: &'static str = "Create a new todo item";
    const MUTATION: bool = true;

    fn schema() -> Value {
        json!({
            "type": "object",
            "properties": {
                "title": schema::title(),
                "description": schema::description(),
                "priority": schema::priority_with_default("Priority (default: medium)")
            },
            "required": ["title"]
        })
    }

    fn run(&self, input: Input) -> CommandResult<Value> {
        let todo = self.0.create(NewTodo {
            title: input.title,
            description: input.description,
            priority: input.priority,
        });
        let reasoning = format!(
            "Created todo \"{}\" with {} priority",
            todo.title,
            todo.priority.as_str()
        );
        ok(&todo, reasoning, 1.0, Vec::new())
    }
}

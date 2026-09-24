use super::{not_found, ok, schema, Command};
use crate::store::TodoStore;
use afd::{failure, CommandResult};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;

pub struct Toggle(pub Arc<TodoStore>);

#[derive(Deserialize)]
pub struct Input {
    id: String,
}

impl Command for Toggle {
    type Input = Input;
    const NAME: &'static str = "todo-toggle";
    const DESCRIPTION: &'static str = "Toggle a todo's completion status";
    const MUTATION: bool = true;

    fn schema() -> Value {
        json!({
            "type": "object",
            "properties": { "id": schema::id() },
            "required": ["id"]
        })
    }

    fn run(&self, input: Input) -> CommandResult<Value> {
        match self.0.toggle(&input.id) {
            Some(todo) => {
                let action = if todo.completed {
                    "Marked as complete"
                } else {
                    "Marked as incomplete"
                };
                let reasoning = format!("{action}: \"{}\"", todo.title);
                ok(&todo, reasoning, 1.0, Vec::new())
            }
            None => failure(not_found(&input.id)),
        }
    }
}

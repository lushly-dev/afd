use super::{not_found, ok, schema, Command};
use crate::store::TodoStore;
use afd::{failure, CommandResult};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;

pub struct Get(pub Arc<TodoStore>);

#[derive(Deserialize)]
pub struct Input {
    id: String,
}

impl Command for Get {
    type Input = Input;
    const NAME: &'static str = "todo-get";
    const DESCRIPTION: &'static str = "Get a single todo by ID";
    const MUTATION: bool = false;

    fn schema() -> Value {
        json!({
            "type": "object",
            "properties": { "id": schema::id() },
            "required": ["id"]
        })
    }

    fn run(&self, input: Input) -> CommandResult<Value> {
        match self.0.get(&input.id) {
            Some(todo) => {
                let reasoning = format!("Retrieved todo \"{}\"", todo.title);
                ok(&todo, reasoning, 1.0, Vec::new())
            }
            None => failure(not_found(&input.id)),
        }
    }
}

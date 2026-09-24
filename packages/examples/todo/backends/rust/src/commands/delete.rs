use super::{not_found, ok, schema, Command};
use crate::store::TodoStore;
use afd::{failure, CommandResult};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;

pub struct Delete(pub Arc<TodoStore>);

#[derive(Deserialize)]
pub struct Input {
    id: String,
}

#[derive(Serialize)]
struct Output {
    deleted: bool,
    id: String,
}

impl Command for Delete {
    type Input = Input;
    const NAME: &'static str = "todo-delete";
    const DESCRIPTION: &'static str = "Delete a todo";
    const MUTATION: bool = true;

    fn schema() -> Value {
        json!({
            "type": "object",
            "properties": { "id": schema::id() },
            "required": ["id"]
        })
    }

    fn run(&self, input: Input) -> CommandResult<Value> {
        match self.0.delete(&input.id) {
            Some(todo) => {
                let reasoning = format!("Deleted todo \"{}\"", todo.title);
                let output = Output {
                    deleted: true,
                    id: input.id,
                };
                ok(&output, reasoning, 1.0, Vec::new())
            }
            None => failure(not_found(&input.id)),
        }
    }
}

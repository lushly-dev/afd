use super::{not_found, ok, schema, Command, Reply, EXAMPLE_ID};
use crate::store::TodoStore;
use afd::{failure, CommandContext, CommandExample, CommandResult};
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
    const TITLE: &'static str = "Get a todo";
    const DESCRIPTION: &'static str = "Get a single todo by ID";
    const TAGS: &'static [&'static str] = &["todo", "get", "read", "single"];
    const MUTATION: bool = false;

    fn schema() -> Value {
        schema::id_input()
    }

    fn output() -> Value {
        schema::todo()
    }

    fn examples() -> Vec<CommandExample> {
        vec![CommandExample::new(
            "One todo by id",
            json!({ "id": EXAMPLE_ID }),
        )]
    }

    fn run(&self, input: Input, _context: &CommandContext) -> CommandResult<Value> {
        match self.0.get(&input.id) {
            Some(todo) => {
                let reasoning = format!("Retrieved todo \"{}\"", todo.title);
                ok(&todo, Reply::new(reasoning, 1.0))
            }
            None => failure(not_found(&input.id)),
        }
    }
}

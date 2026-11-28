use super::{not_found, ok, schema, stamp, todo_id_in, Command, Reply, EXAMPLE_ID};
use crate::store::TodoStore;
use afd::{failure, CommandContext, CommandExample, CommandResult, IdempotencySupport};
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
    const TITLE: &'static str = "Toggle a todo";
    const DESCRIPTION: &'static str =
        "Set an open todo to done, or a done todo back to open; the result names the undo";
    const TAGS: &'static [&'static str] = &["todo", "toggle", "write", "single"];
    const MUTATION: bool = true;
    const IDEMPOTENCY: Option<IdempotencySupport> = Some(IdempotencySupport::Keyed);
    const UNDOABLE: bool = true;

    fn schema() -> Value {
        schema::id_input()
    }

    fn output() -> Value {
        schema::todo()
    }

    fn examples() -> Vec<CommandExample> {
        vec![CommandExample::new(
            "Mark a todo done, or open again",
            json!({ "id": EXAMPLE_ID }),
        )]
    }

    fn changed(data: &Value) -> Vec<String> {
        todo_id_in(data)
    }

    fn run(&self, input: Input, context: &CommandContext) -> CommandResult<Value> {
        let Some(existing) = self.0.get(&input.id) else {
            return failure(not_found(&input.id));
        };
        match self.0.toggle(&input.id, stamp(context).now) {
            Some(todo) => {
                let action = if todo.completed {
                    "Marked as completed"
                } else {
                    "Marked as pending"
                };
                let reasoning = format!("{action}: \"{}\"", todo.title);
                // Setting the previous value back is safe to repeat; toggling again is not.
                let undo = json!({ "id": todo.id, "completed": existing.completed });
                ok(&todo, Reply::new(reasoning, 1.0).undo("todo-update", undo))
            }
            None => failure(not_found(&input.id)),
        }
    }
}

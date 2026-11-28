use super::{not_found, ok, schema, stamp, todo_id_in, warning, Command, Reply, EXAMPLE_ID};
use crate::store::TodoStore;
use afd::{
    failure, CommandContext, CommandExample, CommandResult, IdempotencySupport, WarningSeverity,
};
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
    const TITLE: &'static str = "Delete a todo";
    const DESCRIPTION: &'static str = "Delete one todo by its id. It is kept with the deleted \
         todos, and todo-restore brings it back until todo-clear empties them";
    const TAGS: &'static [&'static str] = &["todo", "delete", "write", "single", "destructive"];
    const MUTATION: bool = true;
    const IDEMPOTENCY: Option<IdempotencySupport> = Some(IdempotencySupport::Natural);
    const DESTRUCTIVE: bool = true;
    // It can be undone, so it is not held for approval.
    const UNDOABLE: bool = true;

    fn schema() -> Value {
        schema::id_input()
    }

    fn output() -> Value {
        json!({
            "type": "object",
            "properties": {
                "deleted": { "type": "boolean" },
                "id": { "type": "string" }
            },
            "required": ["deleted", "id"]
        })
    }

    fn examples() -> Vec<CommandExample> {
        vec![CommandExample::new(
            "Delete one todo; todo-restore brings it back",
            json!({ "id": EXAMPLE_ID }),
        )]
    }

    fn changed(data: &Value) -> Vec<String> {
        todo_id_in(data)
    }

    fn run(&self, input: Input, context: &CommandContext) -> CommandResult<Value> {
        let Some(todo) = self.0.delete(&input.id, stamp(context).now) else {
            return failure(not_found(&input.id));
        };
        let reasoning = format!(
            "Deleted todo \"{}\"; todo-restore brings it back",
            todo.title
        );
        let reply = Reply::new(reasoning, 1.0)
            .warn(warning(
                "RESTORABLE",
                "Kept with the deleted todos: todo-restore brings it back until todo-clear \
                 empties them",
                WarningSeverity::Info,
            ))
            .undo("todo-restore", json!({ "ids": [input.id] }));
        let output = Output {
            deleted: true,
            id: input.id,
        };
        ok(&output, reply)
    }
}

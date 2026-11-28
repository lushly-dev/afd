use super::{ok, schema, stamp, todo_id_in, Command, Reply};
use crate::store::{NewTodo, TodoStore};
use crate::types::Priority;
use afd::{CommandContext, CommandExample, CommandResult, IdempotencySupport};
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
    const TITLE: &'static str = "Create a todo";
    const DESCRIPTION: &'static str = "Create a new todo item";
    const TAGS: &'static [&'static str] = &["todo", "create", "write", "single"];
    const MUTATION: bool = true;
    const IDEMPOTENCY: Option<IdempotencySupport> = Some(IdempotencySupport::Keyed);
    const UNDOABLE: bool = true;

    fn schema() -> Value {
        json!({
            "type": "object",
            "properties": {
                "title": schema::title("Todo title (1-200 characters)"),
                "description": schema::description("Optional description"),
                "priority": schema::priority_with_default()
            },
            "required": ["title"]
        })
    }

    fn output() -> Value {
        schema::todo()
    }

    fn examples() -> Vec<CommandExample> {
        vec![CommandExample::new(
            "A todo with a priority",
            json!({ "title": "Order seed potatoes", "priority": "high" }),
        )]
    }

    fn changed(data: &Value) -> Vec<String> {
        todo_id_in(data)
    }

    fn run(&self, input: Input, context: &CommandContext) -> CommandResult<Value> {
        let stamp = stamp(context);
        let todo = self.0.create(NewTodo {
            id: stamp.new_id(),
            title: input.title,
            description: input.description,
            priority: input.priority,
            now: stamp.now,
        });
        let reasoning = format!(
            "Created todo \"{}\" with {} priority",
            todo.title,
            todo.priority.as_str()
        );
        let undo = json!({ "id": todo.id });
        ok(&todo, Reply::new(reasoning, 1.0).undo("todo-delete", undo))
    }
}

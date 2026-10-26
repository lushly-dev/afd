//! MCP annotations on `CommandRegistry::get_tool` (`spec/command-metadata.md`).

use afd::{
    success, CommandContext, CommandDefinition, CommandHandler, CommandRegistry, CommandResult,
};
use async_trait::async_trait;
use serde_json::{json, Value};

struct Noop;

#[async_trait]
impl CommandHandler for Noop {
    async fn execute(&self, _input: Value, _context: CommandContext) -> CommandResult<Value> {
        success(json!({}))
    }
}

#[test]
fn only_mutations_carry_annotations() {
    let registry = CommandRegistry::new();
    let mut purge = CommandDefinition::new("todo-purge", "Delete all", vec![], Noop);
    purge.mutation = true;
    registry.register(purge).unwrap();
    registry
        .register(CommandDefinition::new("todo-list", "List", vec![], Noop))
        .unwrap();

    assert_eq!(
        registry.get_tool("todo-purge").unwrap()["annotations"],
        json!({ "readOnlyHint": false, "destructiveHint": false })
    );
    // `mutation` defaults to false and has no unset state, so nothing is claimed.
    assert!(registry
        .get_tool("todo-list")
        .unwrap()
        .get("annotations")
        .is_none());
}

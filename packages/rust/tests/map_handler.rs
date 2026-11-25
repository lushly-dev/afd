//! `CommandDefinition::map_handler`: the wrapper runs around the original handler, and every
//! other field of the definition is kept.
#![cfg(feature = "native")]

use std::sync::Arc;

use afd::{
    success, CommandContext, CommandDefinition, CommandHandler, CommandRegistry, CommandResult,
};
use async_trait::async_trait;
use serde_json::{json, Value};

struct Inner;

#[async_trait]
impl CommandHandler for Inner {
    async fn execute(&self, input: Value, _context: CommandContext) -> CommandResult<Value> {
        success(json!({ "inner": input }))
    }
}

struct Around(Arc<dyn CommandHandler>);

#[async_trait]
impl CommandHandler for Around {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let inner = self.0.execute(input, context).await;
        success(json!({ "around": inner.data }))
    }
}

#[tokio::test]
async fn the_wrapper_runs_around_the_handler_and_the_rest_is_kept() {
    let definition = CommandDefinition::new("item-get", "Get an item.", vec![], Inner)
        .with_category("items")
        .with_tags(vec!["a".to_owned()])
        .as_mutation()
        .map_handler(|handler| Arc::new(Around(handler)));
    assert_eq!(definition.name, "item-get");
    assert_eq!(definition.description, "Get an item.");
    assert_eq!(definition.category.as_deref(), Some("items"));
    assert_eq!(definition.tags, Some(vec!["a".to_owned()]));
    assert!(definition.mutation);
    let registry = CommandRegistry::new();
    registry.register(definition).unwrap();
    let result = registry.execute("item-get", json!({}), None).await;
    assert_eq!(result.data, Some(json!({ "around": { "inner": {} } })));
}

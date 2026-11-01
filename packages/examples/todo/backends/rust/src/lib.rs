//! The Rust todo backend as a library: the eleven todo commands over an in-memory
//! [`TodoStore`], with no server attached.
//!
//! [`commands`] returns each command's definition with the JSON Schema of its input, for a host
//! that registers them itself (Umbel's todo plugin does). The `todo-backend-rust` binary, the CLI,
//! the shell and the MCP-over-HTTP server of the [`server`] module, needs the `server` feature
//! (on by default); without it the crate depends on `afd` without its `server` feature and on
//! neither `axum` nor `tower-http`.

mod commands;
#[cfg(feature = "server")]
pub mod server;
mod store;
mod types;
mod validation;

use std::sync::Arc;

use afd::CommandDefinition;
use serde_json::Value;

pub use commands::{register_commands, Tool};
pub use store::TodoStore;

/// The eleven todo commands over `store`, each with the JSON Schema of its input, in
/// registration order. Nothing is registered: the caller chooses the registry (and, for a
/// server, advertises the schemas).
pub fn commands(store: Arc<TodoStore>) -> Vec<(CommandDefinition, Value)> {
    commands::definitions(&store)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commands_are_the_eleven_with_their_schemas_and_register_anywhere() {
        let defined = commands(Arc::new(TodoStore::new()));
        let names: Vec<&str> = defined
            .iter()
            .map(|(definition, _)| definition.name.as_str())
            .collect();
        assert_eq!(
            names,
            [
                "todo-create",
                "todo-list",
                "todo-get",
                "todo-update",
                "todo-toggle",
                "todo-delete",
                "todo-clear",
                "todo-stats",
                "todo-create-batch",
                "todo-delete-batch",
                "todo-toggle-batch",
            ]
        );
        let registry = afd::CommandRegistry::new();
        for (definition, schema) in defined {
            assert_eq!(schema["type"], "object", "{}", definition.name);
            registry.register(definition).unwrap();
        }
        assert_eq!(registry.list().len(), 11);
    }
}

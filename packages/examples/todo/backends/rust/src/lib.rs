//! The Rust todo backend as a library: the thirteen todo commands over an in-memory
//! [`TodoStore`], and the registry the binary serves them from.
//!
//! [`commands`] returns each command's definition with the JSON Schema of its input, for a host
//! that registers them itself (Umbel's todo plugin does). [`app::registry`] registers them in a
//! registry of the backend's own with the bootstrap commands and the approval hold on
//! `todo-clear`. The `todo-backend-rust` binary, the CLI, the shell and the MCP server of the
//! [`server`] module (stdio and HTTP), needs the `server` feature (on by default); without it the
//! crate depends on `afd` without its `server` feature and on neither `axum` nor `tower-http`.

pub mod app;
mod commands;
#[cfg(feature = "server")]
pub mod server;
mod store;
mod types;

use std::sync::Arc;

use afd::CommandDefinition;
use serde_json::Value;

pub use commands::{register_commands, summarize_clear, EDIT_CONTEXTS, READ_CONTEXTS};
pub use store::{TodoStore, HISTORY_LIMIT};

/// The thirteen todo commands over `store`, each with the JSON Schema of its input, in
/// registration order. Nothing is registered: the caller chooses the registry, registers each
/// with `CommandRegistry::register_with_schema`, and adds any middleware (the approval hold) of
/// its own. Each change is recorded in `store`'s history by the command itself.
pub fn commands(store: Arc<TodoStore>) -> Vec<(CommandDefinition, Value)> {
    commands::definitions(&store)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commands_are_the_thirteen_with_their_schemas_and_register_anywhere() {
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
                "todo-restore",
                "todo-history",
            ]
        );
        let registry = afd::CommandRegistry::new();
        for (definition, schema) in defined {
            assert_eq!(schema["type"], "object", "{}", definition.name);
            registry.register_with_schema(definition, schema).unwrap();
        }
        assert_eq!(registry.list().len(), 13);
    }
}

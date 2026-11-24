//! The todo plugin: the todo example's thirteen commands as a compiled plugin.
//!
//! [`plugin`] links into a host as `compiled:todo` (`HostBuilder::with_compiled`); the
//! `umbel-todo` binary is the `umbel` command line with it compiled in, which the todo example's
//! conformance suite runs against. The commands, their schemas, the in-memory store and its
//! change history are the example's own library (`todo-backend-rust`); the manifest declares
//! each command with the backend's schema and contexts, and the host refuses a plugin whose
//! definitions disagree with it.
//!
//! `todo-clear` declares `approval = "non-human"` (D202), matching the backend's per-caller
//! approval policy: any caller that is not a person (`ActorKind::Human`) waits for approval, so an
//! MCP agent cannot clear todos with `confirm: true` alone.
#![forbid(unsafe_code)]

use std::sync::Arc;

use afd::CommandDefinition;
use serde_json::Value;
use todo_backend_rust::TodoStore;
use umbel_sdk::Asset;

/// The plugin's manifest.
pub const MANIFEST: &str = include_str!("../umbel-plugin.toml");

/// The plugin's embedded schema assets.
pub fn assets() -> &'static [Asset] {
    umbel_sdk::embedded_assets!()
}

/// The todo plugin: one in-memory store for the host process, shared by every instance and every
/// seal of it. Several host processes on one workspace each have their own todos, which is why
/// the manifest declares `plugin-state` on the commands that change the store.
#[derive(Clone)]
pub struct Todo {
    store: Arc<TodoStore>,
}

/// A todo plugin with an empty store.
pub fn plugin() -> Todo {
    Todo {
        store: Arc::new(TodoStore::new()),
    }
}

impl Todo {
    /// The thirteen backend command definitions and their input schemas, bound to this store.
    pub fn commands(&self) -> Vec<(CommandDefinition, Value)> {
        todo_backend_rust::commands(Arc::clone(&self.store))
    }
}

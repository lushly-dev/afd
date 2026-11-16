//! The todo plugin: the todo example's thirteen commands as a compiled plugin.
//!
//! [`plugin`] links into a host as `compiled:todo` (`HostBuilder::with_compiled`); the
//! `umbel-todo` binary is the `umbel` command line with it compiled in, which the todo example's
//! conformance suite runs against. The commands, their schemas, the in-memory store and its
//! change history are the example's own library (`todo-backend-rust`); the manifest declares
//! each command with the backend's schema and contexts, and the host refuses a plugin whose
//! definitions disagree with it.
//!
//! One difference: the backend holds `todo-clear` for any caller that is not a person, a policy
//! decided per call, and a manifest declares only a fixed approval (`approval = "required"`). The
//! plugin drops that policy, so under Umbel a clear is gated by its confirmation prompt alone.
#![forbid(unsafe_code)]

use std::sync::Arc;

use afd::ApprovalPolicy;
use todo_backend_rust::TodoStore;
use umbel::plugins::{Asset, CompiledPlugin, PluginCommand, PluginError, Services};

/// The plugin's manifest.
pub const MANIFEST: &str = include_str!("../umbel-plugin.toml");

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

impl CompiledPlugin for Todo {
    fn manifest(&self) -> &str {
        MANIFEST
    }

    fn assets(&self) -> &'static [Asset] {
        umbel_sdk::embedded_assets!()
    }

    fn commands(&self, _services: Services) -> Result<Vec<PluginCommand>, PluginError> {
        Ok(todo_backend_rust::commands(Arc::clone(&self.store))
            .into_iter()
            .map(|(mut definition, schema)| {
                // A per-call policy has no manifest form (see the module documentation).
                if matches!(definition.approval, Some(ApprovalPolicy::Conditional(_))) {
                    definition.approval = None;
                }
                PluginCommand::definition(definition, schema)
            })
            .collect())
    }
}

//! `workspace-show`: what this deployment is.

use super::plugin_list::summary;
use super::{Builtin, empty_input, expose_everywhere_but_the_palette, returns_object};
use crate::plugins::{
    LoadedPlugins, MANIFEST_VERSIONS, PACK_VERSION, PLUGIN_PROTOCOL_VERSION, WIT_WORLD,
};
use crate::versions::{
    BUNDLE_VERSION, CAPTURE_VERSION, CURATOR_VERSION, CURSOR_VERSIONS, DOCUMENT_VERSION,
    ENVELOPE_VERSIONS, EVENT_VERSIONS, LOCATOR_VERSIONS, MEMORY_KEYS_VERSION, MEMORY_VERSIONS,
    PERSON_VERSION, PRINCIPAL_VERSIONS, PROPOSAL_VERSIONS, PROVENANCE_VERSION, STORE_VERSION,
    TASK_VERSION, USAGE_VERSION,
};
use crate::workspace::{CONFIG_VERSIONS, Workspace};
use afd::{CommandContext, CommandDefinition, CommandHandler, CommandResult, success};
use async_trait::async_trait;
use serde_json::{Value, json};
use std::sync::{Arc, OnceLock};

struct Handler {
    workspace: Arc<Workspace>,
    first_class: Arc<OnceLock<Vec<String>>>,
    loaded: Arc<OnceLock<Arc<LoadedPlugins>>>,
}

#[async_trait]
impl CommandHandler for Handler {
    async fn execute(&self, _input: Value, _context: CommandContext) -> CommandResult<Value> {
        let config = self.workspace.config();
        let spaces: Vec<Value> = self
            .workspace
            .spaces()
            .iter()
            .map(|space| json!({ "id": space.id.as_str(), "title": space.title }))
            .collect();
        let plugins: Vec<Value> = self
            .loaded
            .get()
            .map(|loaded| {
                loaded
                    .instances
                    .iter()
                    .map(|instance| {
                        let mut entry = summary(instance);
                        entry.remove("error");
                        Value::Object(entry)
                    })
                    .collect()
            })
            .unwrap_or_default();
        success(json!({
            "name": config.name,
            "workspace": self.workspace.root().display().to_string(),
            "defaultSpace": config.default_space.as_str(),
            "profile": config.profile,
            "spaces": spaces,
            "host": {
                "name": "umbel",
                "version": env!("CARGO_PKG_VERSION"),
                "afdContract": afd::CONTRACT_VERSION,
            },
            // Phase 5 section 2: a list names every version of a shape read side by side;
            // `provenance` stays the envelope version this host writes.
            "versions": {
                "config": CONFIG_VERSIONS,
                "manifest": MANIFEST_VERSIONS,
                "protocol": PLUGIN_PROTOCOL_VERSION,
                "wit": WIT_WORLD,
                "pack": PACK_VERSION,
                "principal": PRINCIPAL_VERSIONS,
                "provenance": PROVENANCE_VERSION,
                "envelope": ENVELOPE_VERSIONS,
                "event": EVENT_VERSIONS,
                "cursor": CURSOR_VERSIONS,
                "store": STORE_VERSION,
                "document": DOCUMENT_VERSION,
                "locator": LOCATOR_VERSIONS,
                "proposal": PROPOSAL_VERSIONS,
                "memory": MEMORY_VERSIONS,
                "memoryKeys": MEMORY_KEYS_VERSION,
                "capture": CAPTURE_VERSION,
                "bundle": BUNDLE_VERSION,
                "curator": CURATOR_VERSION,
                "task": TASK_VERSION,
                "usage": USAGE_VERSION,
                "person": PERSON_VERSION,
            },
            // How far access filtering holds (phase 2 specification, section 6, owner decision 1
            // of 2026-11-01): nothing verifies who a stdio or loopback HTTP caller is until
            // phase 5, so the reader filters are exact only for embedders and tests.
            "access": {
                "principals": "unverified",
                "exact": ["library"],
            },
            "surfaces": {
                "toolStrategy": "hybrid",
                "firstClassTools": self.first_class.get().cloned().unwrap_or_default(),
            },
            "plugins": plugins,
        }))
    }
}

/// `workspace-show`. `first_class` is filled by `seal` once the registry is complete.
pub(crate) fn workspace_show(
    workspace: Arc<Workspace>,
    first_class: Arc<OnceLock<Vec<String>>>,
    loaded: Arc<OnceLock<Arc<LoadedPlugins>>>,
) -> Builtin {
    let definition = CommandDefinition::new(
        "workspace-show",
        "What this deployment is: its name, spaces, default space and versions",
        vec![],
        Handler {
            workspace,
            first_class,
            loaded,
        },
    )
    .with_category("workspace")
    .with_returns(returns_object(
        "name, workspace, defaultSpace, profile, spaces, host, versions, access, surfaces and plugins",
    ))
    .with_expose(expose_everywhere_but_the_palette());
    Builtin {
        definition,
        schema: empty_input(),
    }
}

//! `workspace-show`: what this deployment is.

use super::plugin_list::summary;
use super::{Builtin, empty_input, expose_everywhere_but_the_palette, returns_object};
use crate::plugins::{
    LoadedPlugins, MANIFEST_VERSIONS, PACK_VERSION, PLUGIN_PROTOCOL_VERSION, WIT_WORLD,
};
use crate::versions::{
    CURSOR_VERSION, DOCUMENT_VERSION, EVENT_VERSION, LOCATOR_VERSION, PRINCIPAL_VERSION,
    PROPOSAL_VERSION, PROVENANCE_VERSION, STORE_VERSION,
};
use crate::workspace::{CONFIG_VERSION, Workspace};
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
            "versions": {
                "config": CONFIG_VERSION,
                "manifest": MANIFEST_VERSIONS,
                "protocol": PLUGIN_PROTOCOL_VERSION,
                "wit": WIT_WORLD,
                "pack": PACK_VERSION,
                "principal": PRINCIPAL_VERSION,
                "provenance": PROVENANCE_VERSION,
                "event": EVENT_VERSION,
                "cursor": CURSOR_VERSION,
                "store": STORE_VERSION,
                "document": DOCUMENT_VERSION,
                "locator": LOCATOR_VERSION,
                "proposal": PROPOSAL_VERSION,
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
        "name, workspace, defaultSpace, profile, spaces, host, versions, surfaces and plugins",
    ))
    .with_expose(expose_everywhere_but_the_palette());
    Builtin {
        definition,
        schema: empty_input(),
    }
}

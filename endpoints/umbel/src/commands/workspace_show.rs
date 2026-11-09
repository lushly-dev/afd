//! `workspace-show`: what this deployment is.
//!
//! **In a hosted mode a caller other than the operator gets the hosted answer** (phase 5 sections
//! 6.1, 9.4 and 4.7; amendment from step 2c). It names no more than the caller could learn by
//! reading: no workspace `name` and no `workspace` path (both `null`), only the spaces the caller
//! reads (and its token grants a verb in), the default space only when it is one of them, and only
//! the plugin instances that serve one of them; and `access` says the principals are verified.
//! The operator, at the CLI, gets the whole answer, as every caller does in mode `none`.

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
    async fn execute(&self, _input: Value, context: CommandContext) -> CommandResult<Value> {
        let config = self.workspace.config();
        // `None`: every space (mode `none`, or the operator); else the spaces the caller reads.
        let listed = crate::access::listed_spaces(config, &context);
        let shown = |space: &str| {
            listed
                .as_ref()
                .is_none_or(|listed| listed.iter().any(|s| s == space))
        };
        let spaces: Vec<Value> = self
            .workspace
            .spaces()
            .iter()
            .filter(|space| shown(space.id.as_str()))
            .map(|space| json!({ "id": space.id.as_str(), "title": space.title }))
            .collect();
        let plugins: Vec<Value> = self
            .loaded
            .get()
            .map(|loaded| {
                loaded
                    .instances
                    .iter()
                    .filter(|instance| {
                        listed.is_none() || instance.spaces.iter().any(|space| shown(space))
                    })
                    .map(|instance| {
                        let mut entry = summary(instance);
                        entry.remove("error");
                        Value::Object(entry)
                    })
                    .collect()
            })
            .unwrap_or_default();
        let hosted = listed.is_some();
        // A first-class tool of a plugin that serves no space the caller reads would name it.
        let first_class: Vec<String> = self
            .first_class
            .get()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter(|tool| {
                listed.is_none()
                    || self
                        .loaded
                        .get()
                        .and_then(|loaded| loaded.gate.get(tool))
                        .is_none_or(|entry| entry.spaces.iter().any(|space| shown(space)))
            })
            .collect();
        let access = if config.auth.mode.is_hosted() {
            // Search statistics and positions are the reader's (phase 5 section 9, D125): BM25
            // over what the caller may read, and sealed positions for every hosted caller but
            // the operator and stdio, which the `exact` list names by transport.
            json!({
                "principals": "verified",
                "exact": ["library", "http"],
                "statistics": "per-filter",
            })
        } else {
            // How far access filtering holds (phase 2 specification, section 6, owner decision 1
            // of 2026-11-01): nothing verifies who a stdio or loopback HTTP caller is in mode
            // `none`, so the reader filters are exact only for embedders and tests.
            json!({
                "principals": "unverified",
                "exact": ["library"],
            })
        };
        success(json!({
            "name": if hosted { Value::Null } else { json!(config.name) },
            "workspace": if hosted {
                Value::Null
            } else {
                json!(self.workspace.root().display().to_string())
            },
            "defaultSpace": if shown(config.default_space.as_str()) {
                json!(config.default_space.as_str())
            } else {
                Value::Null
            },
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
            "access": access,
            "surfaces": {
                "toolStrategy": "hybrid",
                "firstClassTools": first_class,
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
        "What this deployment is: its name, spaces, default space and versions; in a hosted mode, to anyone but the operator, only the spaces you read",
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

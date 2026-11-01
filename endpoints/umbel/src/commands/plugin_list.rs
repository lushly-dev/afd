//! `plugin-list`: every plugin instance and how it loaded.

use super::{Builtin, empty_input, expose_everywhere_but_the_palette, returns_object};
use crate::plugins::{InstanceReport, LoadedPlugins, Status, TRUST_NOTE};
use afd::{CommandContext, CommandDefinition, CommandHandler, CommandResult, success};
use async_trait::async_trait;
use serde_json::{Map, Value, json};
use std::sync::{Arc, OnceLock};

struct Handler {
    loaded: Arc<OnceLock<Arc<LoadedPlugins>>>,
}

/// The summary of an instance that `plugin-list` and `workspace-show` share: its id, kind,
/// version and status, and the failure when it has one.
pub(super) fn summary(instance: &InstanceReport) -> Map<String, Value> {
    let mut entry = Map::new();
    entry.insert("id".into(), json!(instance.id));
    if let Some(manifest) = &instance.manifest {
        entry.insert("kind".into(), json!(manifest.plugin.kind.as_str()));
        entry.insert("version".into(), json!(manifest.plugin.version));
    }
    match &instance.status {
        Status::Loaded => {
            entry.insert("status".into(), json!("loaded"));
        }
        Status::Failed(error) => {
            entry.insert("status".into(), json!("failed"));
            entry.insert(
                "error".into(),
                json!({ "code": error.code(), "message": error.message(), "suggestion": error.suggestion() }),
            );
        }
    }
    entry
}

#[async_trait]
impl CommandHandler for Handler {
    async fn execute(&self, _input: Value, _context: CommandContext) -> CommandResult<Value> {
        let loaded = self.loaded.get().cloned().unwrap_or_default();
        let plugins: Vec<Value> = loaded
            .instances
            .iter()
            .map(|instance| {
                let mut entry = summary(instance);
                entry.insert("required".into(), json!(instance.required));
                entry.insert("source".into(), json!(instance.source));
                if let Some(manifest) = &instance.manifest {
                    entry.insert("title".into(), json!(manifest.plugin.title));
                    entry.insert("commands".into(), json!(instance.commands.len()));
                    entry.insert("packs".into(), json!(manifest.packs.len()));
                    entry.insert("skills".into(), json!(manifest.skills.len()));
                    if manifest.plugin.kind == crate::plugins::PluginKind::Compiled {
                        entry.insert("trust".into(), json!(TRUST_NOTE));
                    }
                }
                Value::Object(entry)
            })
            .collect();
        success(json!({ "plugins": plugins, "diagnostics": [] }))
    }
}

/// `plugin-list`.
pub(crate) fn plugin_list(loaded: Arc<OnceLock<Arc<LoadedPlugins>>>) -> Builtin {
    let definition = CommandDefinition::new(
        "plugin-list",
        "Every plugin instance: id, kind, version, status, the failure code and counts of commands, packs and skills",
        vec![],
        Handler { loaded },
    )
    .with_category("plugins")
    .with_returns(returns_object(
        "plugins (id, kind, version, status, error, required, source, commands, packs, skills) and diagnostics",
    ))
    .with_expose(expose_everywhere_but_the_palette());
    Builtin {
        definition,
        schema: empty_input(),
    }
}

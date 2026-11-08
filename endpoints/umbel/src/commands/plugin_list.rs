//! `plugin-list`: every plugin instance and how it loaded.
//!
//! In a hosted mode a caller other than the operator is listed only the instances that serve a
//! space it reads (phase 5 section 9.4, as `workspace-show` lists them), without a failed
//! instance's `error`, whose message may name a space or a path; see [`visible_instance`].

use super::{Builtin, empty_input, expose_everywhere_but_the_palette, returns_object};
use crate::plugins::{InstanceReport, LoadedPlugins, Status, TRUST_NOTE};
use crate::workspace::Workspace;
use afd::{CommandContext, CommandDefinition, CommandHandler, CommandResult, success};
use async_trait::async_trait;
use serde_json::{Map, Value, json};
use std::sync::{Arc, OnceLock};

struct Handler {
    workspace: Arc<Workspace>,
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

/// Whether `instance` may be named to a caller listed `listed` (`None`: every space, for the
/// operator and in mode `none`; else the spaces it reads): it serves one of them.
pub(super) fn visible_instance(instance: &InstanceReport, listed: Option<&[String]>) -> bool {
    listed.is_none_or(|listed| instance.spaces.iter().any(|space| listed.contains(space)))
}

#[async_trait]
impl CommandHandler for Handler {
    async fn execute(&self, _input: Value, context: CommandContext) -> CommandResult<Value> {
        let loaded = self.loaded.get().cloned().unwrap_or_default();
        let listed = crate::access::listed_spaces(self.workspace.config(), &context);
        let plugins: Vec<Value> = loaded
            .instances
            .iter()
            .filter(|instance| visible_instance(instance, listed.as_deref()))
            .map(|instance| {
                let mut entry = summary(instance);
                if listed.is_some() {
                    entry.remove("error");
                }
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
pub(crate) fn plugin_list(
    workspace: Arc<Workspace>,
    loaded: Arc<OnceLock<Arc<LoadedPlugins>>>,
) -> Builtin {
    let definition = CommandDefinition::new(
        "plugin-list",
        "Every plugin instance: id, kind, version, status, the failure code and counts of commands, packs and skills",
        vec![],
        Handler { workspace, loaded },
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

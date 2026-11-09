//! `skill-list`: every skill the loaded plugins ship.
//!
//! In a hosted mode a caller other than the operator is listed only the skills of instances that
//! serve a space it reads (phase 5 section 9.4), as `plugin-list` lists the instances.

use super::{Builtin, empty_input, expose_everywhere_but_the_palette, returns_object};
use crate::plugins::LoadedPlugins;
use crate::workspace::Workspace;
use afd::{CommandContext, CommandDefinition, CommandHandler, CommandResult, success};
use async_trait::async_trait;
use serde_json::{Value, json};
use std::sync::{Arc, OnceLock};

struct Handler {
    workspace: Arc<Workspace>,
    loaded: Arc<OnceLock<Arc<LoadedPlugins>>>,
}

#[async_trait]
impl CommandHandler for Handler {
    async fn execute(&self, _input: Value, context: CommandContext) -> CommandResult<Value> {
        let loaded = self.loaded.get().cloned().unwrap_or_default();
        let listed = crate::access::listed_spaces(self.workspace.config(), &context);
        let skills: Vec<Value> = loaded
            .skills
            .iter()
            .filter(|skill| {
                loaded.instance(&skill.instance).is_some_and(|instance| {
                    super::plugin_list::visible_instance(instance, listed.as_deref())
                })
            })
            .map(|skill| {
                json!({
                    "name": skill.name,
                    "description": skill.description(),
                    "instance": skill.instance,
                    "plugin": skill.plugin,
                    "version": skill.version,
                    "uri": skill.uri(),
                    "digest": skill.digest(),
                    "files": skill.files.len(),
                })
            })
            .collect();
        success(json!({ "skills": skills }))
    }
}

/// `skill-list`.
pub(crate) fn skill_list(
    workspace: Arc<Workspace>,
    loaded: Arc<OnceLock<Arc<LoadedPlugins>>>,
) -> Builtin {
    let definition = CommandDefinition::new(
        "skill-list",
        "Every skill the loaded plugins ship: name, description, instance, URI, the digest of SKILL.md and the file count",
        vec![],
        Handler { workspace, loaded },
    )
    .with_category("plugins")
    .with_returns(returns_object(
        "skills (name, description, instance, plugin, version, uri, digest, files)",
    ))
    .with_expose(expose_everywhere_but_the_palette());
    Builtin {
        definition,
        schema: empty_input(),
    }
}

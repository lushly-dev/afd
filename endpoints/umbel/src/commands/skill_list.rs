//! `skill-list`: every skill the loaded plugins ship.

use super::{Builtin, empty_input, expose_everywhere_but_the_palette, returns_object};
use crate::plugins::LoadedPlugins;
use afd::{CommandContext, CommandDefinition, CommandHandler, CommandResult, success};
use async_trait::async_trait;
use serde_json::{Value, json};
use std::sync::{Arc, OnceLock};

struct Handler {
    loaded: Arc<OnceLock<Arc<LoadedPlugins>>>,
}

#[async_trait]
impl CommandHandler for Handler {
    async fn execute(&self, _input: Value, _context: CommandContext) -> CommandResult<Value> {
        let loaded = self.loaded.get().cloned().unwrap_or_default();
        let skills: Vec<Value> = loaded
            .skills
            .iter()
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
pub(crate) fn skill_list(loaded: Arc<OnceLock<Arc<LoadedPlugins>>>) -> Builtin {
    let definition = CommandDefinition::new(
        "skill-list",
        "Every skill the loaded plugins ship: name, description, instance, URI, the digest of SKILL.md and the file count",
        vec![],
        Handler { loaded },
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

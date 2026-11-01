//! `plugin-show`: one plugin instance in full.

use super::plugin_list::summary;
use super::{Builtin, expose_everywhere_but_the_palette, returns_object, validation_error};
use crate::plugins::{
    GrantReport, InstanceReport, LoadedPlugins, Manifest, PluginKind, TRUST_NOTE,
};
use afd::{CommandContext, CommandDefinition, CommandHandler, CommandResult, failure, success};
use async_trait::async_trait;
use serde_json::{Map, Value, json};
use std::sync::{Arc, OnceLock};

struct Handler {
    loaded: Arc<OnceLock<Arc<LoadedPlugins>>>,
}

fn grants(instance: &InstanceReport, manifest: &Manifest) -> Value {
    let items: Vec<Value> = if instance.grants.is_empty() {
        // A failed instance never decided its grants: show what the manifest declares.
        manifest
            .grants
            .iter()
            .map(|grant| {
                json!({
                    "name": grant.name,
                    "required": grant.required,
                    "reason": grant.reason,
                    "status": "declared",
                })
            })
            .collect()
    } else {
        instance.grants.iter().map(grant_item).collect()
    };
    let mut object = Map::new();
    if manifest.plugin.kind == PluginKind::Compiled {
        object.insert("trust".into(), json!(TRUST_NOTE));
    }
    object.insert("items".into(), Value::Array(items));
    Value::Object(object)
}

fn grant_item(grant: &GrantReport) -> Value {
    let mut item = Map::new();
    item.insert("name".into(), json!(grant.name));
    item.insert("required".into(), json!(grant.required));
    item.insert("reason".into(), json!(grant.reason));
    item.insert(
        "status".into(),
        json!(if grant.granted { "granted" } else { "withheld" }),
    );
    if let Some(note) = &grant.withheld {
        item.insert("note".into(), json!(note));
    }
    Value::Object(item)
}

fn show(instance: &InstanceReport) -> Value {
    let mut data = Map::new();
    let mut about = summary(instance);
    about.insert("required".into(), json!(instance.required));
    about.insert("source".into(), json!(instance.source));
    about.insert("spaces".into(), json!(instance.spaces));
    data.insert("instance".into(), Value::Object(about));
    let Some(manifest) = &instance.manifest else {
        return Value::Object(data);
    };
    let info = &manifest.plugin;
    let mut plugin = Map::new();
    plugin.insert("id".into(), json!(info.id));
    plugin.insert("title".into(), json!(info.title));
    plugin.insert("version".into(), json!(info.version));
    plugin.insert("description".into(), json!(info.description));
    plugin.insert("kind".into(), json!(info.kind.as_str()));
    plugin.insert("domains".into(), json!(info.domains));
    if let Some(homepage) = &info.homepage {
        plugin.insert("homepage".into(), json!(homepage));
    }
    if let Some(license) = &info.license {
        plugin.insert("license".into(), json!(license));
    }
    data.insert("plugin".into(), Value::Object(plugin));
    data.insert("grants".into(), grants(instance, manifest));
    let commands: Vec<Value> = manifest
        .commands
        .iter()
        .map(|command| {
            let effects: Vec<&str> = command.effects.iter().map(|e| e.as_str()).collect();
            json!({
                "name": command.name,
                "description": command.description,
                "effects": effects,
                "mutation": command.mutation(),
                "firstClass": command.first_class,
                "expose": {
                    "mcp": command.expose.mcp,
                    "agent": command.expose.agent,
                    "cli": command.expose.cli,
                    "palette": command.expose.palette,
                },
                "origin": {
                    "plugin": instance.id,
                    "kind": info.kind.as_str(),
                    "version": info.version,
                    "effects": effects,
                },
            })
        })
        .collect();
    data.insert("commands".into(), Value::Array(commands));
    data.insert(
        "packs".into(),
        json!(
            manifest
                .packs
                .iter()
                .map(|pack| json!({ "id": pack.id, "path": pack.path }))
                .collect::<Vec<_>>()
        ),
    );
    data.insert(
        "skills".into(),
        json!(
            manifest
                .skills
                .iter()
                .map(|skill| json!({ "name": skill.name, "path": skill.path }))
                .collect::<Vec<_>>()
        ),
    );
    Value::Object(data)
}

#[async_trait]
impl CommandHandler for Handler {
    async fn execute(&self, input: Value, _context: CommandContext) -> CommandResult<Value> {
        let Some(id) = input.get("plugin").and_then(Value::as_str) else {
            return failure(validation_error(
                "plugin must be the id of a plugin instance".to_owned(),
                "Pass plugin=<instance id>; plugin-list names the instances.",
            ));
        };
        let loaded = self.loaded.get().cloned().unwrap_or_default();
        match loaded.instance(id) {
            Some(instance) => success(show(instance)),
            None => failure(
                afd::CommandError::new(
                    crate::plugins::codes::PLUGIN_NOT_FOUND,
                    format!("No plugin instance `{id}` is enabled in this workspace"),
                )
                .with_suggestion("Call plugin-list for the enabled instances.")
                .with_retryable(false),
            ),
        }
    }
}

/// `plugin-show`.
pub(crate) fn plugin_show(loaded: Arc<OnceLock<Arc<LoadedPlugins>>>) -> Builtin {
    let definition = CommandDefinition::new(
        "plugin-show",
        "One plugin instance in full: its manifest summary, grants and reasons, commands with effects, packs and skills",
        vec![],
        Handler { loaded },
    )
    .with_category("plugins")
    .with_returns(returns_object(
        "instance, plugin, grants (trust, items), commands, packs and skills",
    ))
    .with_expose(expose_everywhere_but_the_palette());
    Builtin {
        definition,
        schema: json!({
            "type": "object",
            "properties": {
                "plugin": {
                    "type": "string",
                    "description": "The plugin instance id, as plugin-list reports it"
                }
            },
            "required": ["plugin"],
            "additionalProperties": false,
        }),
    }
}

//! `plugin-show`: one plugin instance in full.
//!
//! In a hosted mode a caller other than the operator is shown only an instance that serves a
//! space it reads (phase 5 section 9.4); any other answers `PLUGIN_NOT_FOUND`, exactly as an
//! instance that does not exist. The instance's `spaces` and its packs' per-space states then
//! name only the spaces the caller reads, and a failed instance's `error` is left out.

use super::plugin_list::summary;
use super::{Builtin, expose_everywhere_but_the_palette, returns_object, validation_error};
use crate::plugins::{
    GrantReport, InstanceReport, LoadedPlugins, Manifest, MountReport, PipelineState, PluginKind,
    TRUST_NOTE, Transport,
};
use crate::workspace::Workspace;
use afd::{CommandContext, CommandDefinition, CommandHandler, CommandResult, failure, success};
use async_trait::async_trait;
use serde_json::{Map, Value, json};
use std::sync::{Arc, OnceLock};

struct Handler {
    workspace: Arc<Workspace>,
    loaded: Arc<OnceLock<Arc<LoadedPlugins>>>,
}

/// The grants of `instance`. To a caller listed only some spaces (`hosted`), a withheld grant's
/// `note` is left out: the loader's notes can name a space of the workspace, readable or not.
fn grants(instance: &InstanceReport, manifest: &Manifest, hosted: bool) -> Value {
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
        instance
            .grants
            .iter()
            .map(|grant| grant_item(grant, hosted))
            .collect()
    };
    let mut object = Map::new();
    if manifest.plugin.kind == PluginKind::Compiled {
        object.insert("trust".into(), json!(TRUST_NOTE));
    }
    object.insert("items".into(), Value::Array(items));
    Value::Object(object)
}

fn grant_item(grant: &GrantReport, hosted: bool) -> Value {
    let mut item = Map::new();
    item.insert("name".into(), json!(grant.name));
    item.insert("required".into(), json!(grant.required));
    item.insert("reason".into(), json!(grant.reason));
    item.insert(
        "status".into(),
        json!(if grant.granted { "granted" } else { "withheld" }),
    );
    if let Some(note) = grant.withheld.as_ref().filter(|_| !hosted) {
        item.insert("note".into(), json!(note));
    }
    Value::Object(item)
}

/// Each pack with, per space of the instance (`shown`), whether the plugin's default or the
/// space's override serves it (D46).
fn packs(instance: &InstanceReport, manifest: &Manifest, shown: &dyn Fn(&str) -> bool) -> Value {
    Value::Array(
        manifest
            .packs
            .iter()
            .map(|pack| {
                let spaces: Vec<Value> = instance
                    .packs
                    .iter()
                    .find(|(id, _)| *id == pack.id)
                    .map(|(_, states)| {
                        states
                            .iter()
                            .filter(|state| shown(&state.space))
                            .map(|state| {
                                json!({
                                    "space": state.space,
                                    "source": state.origin.as_str(),
                                    "version": state.version,
                                    "files": state.files,
                                })
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                json!({ "id": pack.id, "path": pack.path, "spaces": spaces })
            })
            .collect(),
    )
}

/// Each pipeline and whether it was registered; a pipeline that was not names the reason.
fn pipelines(instance: &InstanceReport, manifest: &Manifest) -> Value {
    Value::Array(
        manifest
            .pipelines
            .iter()
            .map(|pipeline| {
                let effects: Vec<&str> = pipeline.effects.iter().map(|e| e.as_str()).collect();
                let mut item = json!({
                    "name": pipeline.name,
                    "description": pipeline.description,
                    "effects": effects,
                    "steps": pipeline.steps.iter().map(|step| step.command.clone()).collect::<Vec<_>>(),
                });
                match instance
                    .pipelines
                    .iter()
                    .find(|plan| plan.name == pipeline.name)
                    .map(|plan| &plan.state)
                {
                    Some(PipelineState::Registered) => item["state"] = json!("registered"),
                    Some(PipelineState::Skipped(reason)) => {
                        item["state"] = json!("not-registered");
                        item["reason"] = json!(reason);
                    }
                    None => item["state"] = json!("not-loaded"),
                }
                item
            })
            .collect(),
    )
}

/// A mounted instance's commands: one per tool, with the server's original name beside the
/// command's.
fn mount_commands(
    instance: &InstanceReport,
    manifest: &Manifest,
    mount: &MountReport,
) -> Vec<Value> {
    mount
        .tools
        .iter()
        .map(|tool| {
            let effects: Vec<&str> = tool.effects.iter().map(|e| e.as_str()).collect();
            json!({
                "name": tool.command,
                "description": tool.description,
                "effects": effects,
                "mutation": tool.mutation,
                "firstClass": tool.first_class,
                "bindSpace": tool.bind_space,
                "expose": { "mcp": true, "agent": true, "cli": true, "palette": false },
                "origin": {
                    "plugin": instance.id,
                    "kind": manifest.plugin.kind.as_str(),
                    "version": manifest.plugin.version,
                    "effects": effects,
                    "tool": tool.tool,
                },
            })
        })
        .collect()
}

/// Where the tools came from, what was left out and what the description scan found. The bearer
/// token is never shown, only whether one is configured.
fn mount_summary(mount: &MountReport) -> Value {
    json!({
        "prefix": mount.prefix,
        "transport": match mount.transport {
            Transport::Stdio => "stdio",
            Transport::Http => "http",
        },
        "bearer": if mount.bearer_configured { "configured" } else { "none" },
        "tools": mount
            .tools
            .iter()
            .map(|tool| json!({ "tool": tool.tool, "command": tool.command }))
            .collect::<Vec<_>>(),
        "skipped": mount
            .skipped
            .iter()
            .map(|tool| json!({ "tool": tool.tool, "code": tool.code, "message": tool.message }))
            .collect::<Vec<_>>(),
        "warnings": mount
            .warnings
            .iter()
            .map(|warning| json!({
                "tool": warning.tool,
                "rule": "description-injection",
                "pattern": warning.pattern,
                "location": warning.location,
            }))
            .collect::<Vec<_>>(),
    })
}

/// `instance` in full, to a caller listed `listed` (`None`: every space).
fn show(instance: &InstanceReport, listed: Option<&[String]>) -> Value {
    let shown = |space: &str| listed.is_none_or(|listed| listed.iter().any(|s| s == space));
    let mut data = Map::new();
    let mut about = summary(instance);
    if listed.is_some() {
        about.remove("error");
    }
    about.insert("required".into(), json!(instance.required));
    about.insert("source".into(), json!(instance.source));
    let spaces: Vec<&String> = instance
        .spaces
        .iter()
        .filter(|space| shown(space))
        .collect();
    about.insert("spaces".into(), json!(spaces));
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
    data.insert(
        "grants".into(),
        grants(instance, manifest, listed.is_some()),
    );
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
                    "mcp": command.mcp_exposed(),
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
    let commands = match &instance.mount {
        Some(mount) => mount_commands(instance, manifest, mount),
        None => commands,
    };
    data.insert("commands".into(), Value::Array(commands));
    data.insert("packs".into(), packs(instance, manifest, &shown));
    if let Some(mount) = &instance.mount {
        data.insert("mount".into(), mount_summary(mount));
    }
    data.insert(
        "contexts".into(),
        json!(
            manifest
                .contexts
                .iter()
                .map(|context| json!({
                    "name": context.name,
                    "description": context.description,
                    "triggers": context.triggers,
                    "priority": context.priority,
                }))
                .collect::<Vec<_>>()
        ),
    );
    data.insert("pipelines".into(), pipelines(instance, manifest));
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
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let Some(id) = input.get("plugin").and_then(Value::as_str) else {
            return failure(validation_error(
                "plugin must be the id of a plugin instance".to_owned(),
                "Pass plugin=<instance id>; plugin-list names the instances.",
            ));
        };
        let loaded = self.loaded.get().cloned().unwrap_or_default();
        let listed = crate::access::listed_spaces(self.workspace.config(), &context);
        match loaded
            .instance(id)
            .filter(|instance| super::plugin_list::visible_instance(instance, listed.as_deref()))
        {
            Some(instance) => success(show(instance, listed.as_deref())),
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
pub(crate) fn plugin_show(
    workspace: Arc<Workspace>,
    loaded: Arc<OnceLock<Arc<LoadedPlugins>>>,
) -> Builtin {
    let definition = CommandDefinition::new(
        "plugin-show",
        "One plugin instance in full: its manifest summary, grants and reasons, commands with effects, packs per space, contexts, pipelines and skills",
        vec![],
        Handler { workspace, loaded },
    )
    .with_category("plugins")
    .with_returns(returns_object(
        "instance, plugin, grants (trust, items), commands, packs (per space), contexts, pipelines and skills",
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_withheld_grants_note_is_shown_only_to_a_caller_who_sees_every_space() {
        let grant = GrantReport {
            name: "store_write".into(),
            required: false,
            reason: "r".into(),
            granted: false,
            withheld: Some(
                "its allow entry `private/c` names a space the instance is not enabled for".into(),
            ),
        };
        assert!(grant_item(&grant, false)["note"].is_string());
        let hosted = grant_item(&grant, true);
        assert!(hosted.get("note").is_none(), "{hosted}");
        assert_eq!(hosted["status"], json!("withheld"));
    }
}

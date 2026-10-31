//! Tool strategies: how `tools/list` presents the MCP-exposed commands.
//!
//! As in TypeScript (`toolStrategy`):
//!
//! - [`ToolStrategy::Grouped`] (the default): one tool per group (the command's `category`, or
//!   the first segment of its name) taking `{ action, params }`, plus `afd-batch`, `afd-pipe`,
//!   `afd-call` and `afd-detail`. Each grouped tool's `_meta.actions` lists every action's
//!   command name, input schema and metadata; small groups also inline the schemas as `anyOf`
//!   branches of `params`.
//! - [`ToolStrategy::Individual`]: one tool per command, plus `afd-batch`, `afd-pipe` and
//!   `afd-call`.
//! - [`ToolStrategy::Lazy`]: only the meta-tools (`afd-discover`, `afd-detail`, `afd-batch`,
//!   `afd-pipe`, `afd-call`); agents discover commands and run them through `afd-call`.
//!
//! Every strategy routes every meta-tool and every command by its own name, so a call never
//! depends on which tools were listed.

use std::sync::Arc;

use serde_json::{json, Map, Value};

use crate::approval::approval_mode;
use crate::CommandDefinition;

use super::confirmations;
use super::meta_tools;

/// Largest serialized size (in UTF-16 code units, as TypeScript measures it) of a grouped tool's
/// per-action parameter schemas that is inlined into `inputSchema.properties.params.anyOf`.
/// Larger groups advertise only the generic `params` object; their schemas stay in
/// `_meta.actions` and `afd-detail`.
pub const GROUPED_PARAMS_SCHEMA_BUDGET: usize = 8_192;

/// How `tools/list` presents commands (see the [module documentation](self)).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[non_exhaustive]
pub enum ToolStrategy {
    /// One tool per command.
    Individual,
    /// One tool per group of commands, taking `{ action, params }` (the default, as in
    /// TypeScript).
    #[default]
    Grouped,
    /// Only the meta-tools.
    Lazy,
}

/// Derives a grouped tool's name from a command; `None` or an empty name is `general`.
pub type GroupBy = Arc<dyn Fn(&CommandDefinition) -> Option<String> + Send + Sync>;

/// Default group (and discovery category) of a command: its `category`, else the first
/// kebab-case segment of its name, else `general`.
pub fn default_command_group(command: &CommandDefinition) -> String {
    command
        .category
        .clone()
        .filter(|category| !category.is_empty())
        .or_else(|| {
            command
                .name
                .split('-')
                .next()
                .filter(|segment| !segment.is_empty())
                .map(str::to_owned)
        })
        .unwrap_or_else(|| "general".to_owned())
}

/// Grouped tool name of a command: `group_by`'s, else [`default_command_group`].
pub fn command_group(command: &CommandDefinition, group_by: Option<&GroupBy>) -> String {
    match group_by {
        Some(group_by) => group_by(command)
            .filter(|group| !group.is_empty())
            .unwrap_or_else(|| "general".to_owned()),
        None => default_command_group(command),
    }
}

/// Grouped action of a command: the name without its first segment (`todo-create-batch` →
/// `create-batch`), or the whole name if it has one segment.
pub fn command_action(command: &CommandDefinition) -> String {
    match command.name.split_once('-') {
        Some((_, action)) => action.to_owned(),
        None => command.name.clone(),
    }
}

/// The per-command `_meta` of a tool (`spec/command-metadata.md`, "Surfaces"): `category`,
/// `requires`, `mutation` (when true: Rust has no unset state), `destructive`, `undoable`,
/// `approval`, `examples`, `outputSchema` and `contexts`, each only when set.
pub(crate) fn command_tool_meta(command: &CommandDefinition) -> Map<String, Value> {
    let mut meta = Map::new();
    if let Some(category) = &command.category {
        meta.insert("category".into(), json!(category));
    }
    if let Some(requires) = command.requires.as_ref().filter(|list| !list.is_empty()) {
        meta.insert("requires".into(), json!(requires));
    }
    if command.mutation {
        meta.insert("mutation".into(), json!(true));
    }
    if let Some(destructive) = command.destructive {
        meta.insert("destructive".into(), json!(destructive));
    }
    if let Some(undoable) = command.undoable {
        meta.insert("undoable".into(), json!(undoable));
    }
    if let Some(approval) = approval_mode(command.approval.as_ref()) {
        meta.insert("approval".into(), json!(approval));
    }
    if let Some(examples) = command.examples.as_ref().filter(|list| !list.is_empty()) {
        meta.insert("examples".into(), json!(examples));
    }
    if let Some(returns) = &command.returns {
        meta.insert("outputSchema".into(), json!(returns));
    }
    if let Some(contexts) = command.contexts.as_ref().filter(|list| !list.is_empty()) {
        meta.insert("contexts".into(), json!(contexts));
    }
    meta
}

/// A tool's `inputSchema` as an object schema (`{ type: "object", ... }`).
pub(crate) fn object_schema(tool: Option<&Value>) -> Value {
    let mut schema = tool
        .and_then(|tool| tool["inputSchema"].as_object())
        .cloned()
        .unwrap_or_default();
    schema.insert("type".into(), json!("object"));
    Value::Object(schema)
}

/// One command a strategy lists: its definition and its tool (with the full input schema).
pub(crate) struct Listed {
    pub(crate) command: Arc<CommandDefinition>,
    pub(crate) tool: Option<Value>,
    /// Under `Enforce`, whether its tool advertises the `confirm` acknowledgement.
    pub(crate) accepts_confirm: bool,
}

fn grouped_tool(group: &str, members: &[&Listed]) -> Value {
    let mut actions: Vec<String> = Vec::new();
    for member in members {
        let action = command_action(&member.command);
        if !actions.contains(&action) {
            actions.push(action);
        }
    }
    let entries: Vec<Value> = members
        .iter()
        .map(|member| {
            let mut entry = Map::new();
            entry.insert("action".into(), json!(command_action(&member.command)));
            entry.insert("command".into(), json!(member.command.name));
            entry.insert("description".into(), json!(member.command.description));
            entry.insert("inputSchema".into(), object_schema(member.tool.as_ref()));
            entry.extend(command_tool_meta(&member.command));
            Value::Object(entry)
        })
        .collect();
    let branches: Vec<Value> = members
        .iter()
        .map(|member| {
            let action = command_action(&member.command);
            let mut branch = object_schema(member.tool.as_ref());
            branch["title"] = json!(action);
            branch["description"] = json!(format!(
                "Parameters for action '{action}' ({})",
                member.command.name
            ));
            branch
        })
        .collect();
    let serialized = serde_json::to_string(&branches).unwrap_or_default();
    let inline = serialized.encode_utf16().count() <= GROUPED_PARAMS_SCHEMA_BUDGET
        && !serialized.contains("\"$ref\"");

    let mut params = json!({
        "type": "object",
        "description": if inline {
            "Parameters for the action: the anyOf branch titled with the action"
        } else {
            "Parameters for the action: see _meta.actions[].inputSchema, or call afd-detail with the action's command name"
        },
    });
    if inline {
        params["anyOf"] = Value::Array(branches);
    }
    let mut properties = json!({
        "action": {
            "type": "string",
            "enum": actions,
            "description": format!("Action to perform: {}", actions.join(" | ")),
        },
        "params": params,
    });
    if members.iter().any(|member| member.accepts_confirm) {
        properties["confirm"] = confirmations::confirm_property();
    }
    json!({
        "name": group,
        "description": format!("{group} operations: {}", actions.join(", ")),
        "inputSchema": {
            "type": "object",
            "properties": properties,
            "required": ["action"],
        },
        "_meta": { "actions": entries },
    })
}

/// The grouped tools of `listed`, in order of each group's first command.
pub(crate) fn grouped_tools(listed: &[Listed], group_by: Option<&GroupBy>) -> Vec<Value> {
    let mut groups: Vec<(String, Vec<&Listed>)> = Vec::new();
    for member in listed {
        let group = command_group(&member.command, group_by);
        match groups.iter_mut().find(|(name, _)| *name == group) {
            Some((_, members)) => members.push(member),
            None => groups.push((group, vec![member])),
        }
    }
    groups
        .iter()
        .map(|(group, members)| grouped_tool(group, members))
        .collect()
}

/// `afd-batch`, `afd-pipe` and `afd-call`: listed by every strategy.
pub(crate) fn built_in_tools() -> Vec<Value> {
    vec![
        meta_tools::batch_tool(),
        meta_tools::pipe_tool(),
        meta_tools::call_tool(),
    ]
}

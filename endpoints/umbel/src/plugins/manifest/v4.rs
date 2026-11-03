//! What manifest version 4 adds (phase 4 specification, section 2.2; D97, D105): the command key
//! `confirm_preview`, and the pipeline keys `expose` and `result`.
//!
//! Step 1 of the phase 4 plan parses, validates and stores them; nothing acts on them yet. The
//! CLI's preview flow and a pipeline's exposure at seal and its `result` arrive with step 2.

use std::collections::BTreeSet;

use serde_json::Value;

use super::{Effect, Expose, Manifest, PluginKind, SchemaRef, Tbl};
use crate::plugins::error::PluginError;
use crate::plugins::files::PluginFiles;

/// The command key manifest version 4 adds; versions 1 to 3 name and refuse it.
pub(super) const COMMAND_KEYS_V4: &[(&str, &str)] = &[(
    "confirm_preview",
    "a confirmation preview needs manifest_version = 4",
)];
/// The pipeline keys manifest version 4 adds.
pub(super) const PIPELINE_KEYS_V4: &[(&str, &str)] = &[
    (
        "expose",
        "a pipeline's own exposure needs manifest_version = 4",
    ),
    (
        "result",
        "a pipeline's result = \"steps\" | \"last\" needs manifest_version = 4",
    ),
];
/// A pipeline's `expose` keys: a command's, without the palette, where no pipeline is offered.
const PIPELINE_EXPOSE_KEYS: &[&str] = &["mcp", "agent", "cli"];
const PIPELINE_EXPOSE_RESERVED: &[(&str, &str)] = &[(
    "palette",
    "a pipeline is never offered in the command palette",
)];

/// What a pipeline returns (`result`, manifest version 4).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum PipelineResult {
    /// Every step's index, command, alias, status and data, as since phase 1.
    #[default]
    Steps,
    /// Only the last step's data, which alone enters the journal entry.
    Last,
}

impl PipelineResult {
    /// The manifest spelling.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Steps => "steps",
            Self::Last => "last",
        }
    }
}

/// `confirm_preview` of a command: the name of a command of the same plugin, with the command's
/// own `confirm_prompt`. Refused on a component command, since a preview declares a journal and a
/// component command cannot. The named command is checked by [`Manifest::check_previews`].
pub(super) fn confirm_preview(
    table: &Tbl<'_>,
    kind: PluginKind,
    confirm_prompt: Option<&str>,
) -> Result<Option<String>, PluginError> {
    let Some(name) = table.string("confirm_preview")? else {
        return Ok(None);
    };
    if kind == PluginKind::Component {
        return Err(table.bad(
            "confirm_preview",
            "is not available to a component plugin: a preview command declares a journal, which a component command cannot until WIT world umbel:plugin/plugin@1.1.0",
        ));
    }
    afd::validate_command_name(&name).map_err(|problem| table.bad("confirm_preview", problem))?;
    if confirm_prompt.is_none() {
        return Err(table.bad(
            "confirm_preview",
            "needs confirm_prompt: the preview is shown before that prompt",
        ));
    }
    Ok(Some(name))
}

/// A pipeline's `expose` (manifest version 4): `mcp`, `agent` and `cli`, each defaulting to true
/// as a command's does. Without the key a pipeline is exposed to every surface, as in versions 1
/// to 3. Whether it is wider than a step's is checked at seal (step 2).
pub(super) fn pipeline_expose(table: &Tbl<'_>) -> Result<Expose, PluginError> {
    let mut expose = Expose::default();
    if let Some(flags) = table.table("expose")? {
        flags.check_keys(PIPELINE_EXPOSE_KEYS, PIPELINE_EXPOSE_RESERVED)?;
        expose.mcp = flags.boolean("mcp")?.unwrap_or(expose.mcp);
        expose.agent = flags.boolean("agent")?.unwrap_or(expose.agent);
        expose.cli = flags.boolean("cli")?.unwrap_or(expose.cli);
    }
    Ok(expose)
}

/// A pipeline's `result` (manifest version 4): `steps`, the default, or `last`.
pub(super) fn pipeline_result(table: &Tbl<'_>) -> Result<PipelineResult, PluginError> {
    match table.string("result")?.as_deref() {
        None | Some("steps") => Ok(PipelineResult::Steps),
        Some("last") => Ok(PipelineResult::Last),
        Some(_) => Err(table.bad("result", "must be \"steps\" or \"last\"")),
    }
}

/// `confirm_preview` on a mounted tool or a pipeline: refused, with why.
pub(super) fn refuse_preview(table: &Tbl<'_>, why: &str) -> Result<(), PluginError> {
    if table.value("confirm_preview").is_some() {
        return Err(table.bad("confirm_preview", why));
    }
    Ok(())
}

impl Manifest {
    /// Section 2.2's rules for each `confirm_preview`. The named command is a `[[commands]]`
    /// entry of this plugin with the effect `inspect`, CLI exposure and a `journal`, asking for no
    /// confirmation or approval of its own; it declares `returns` as `{ "preview": <string> }`,
    /// closed; and each property of its input schema is one of the gated command's. A schema
    /// given as a file is checked only when `files` is given, as [`Manifest::validate_files`]
    /// does.
    pub(super) fn check_previews(
        &self,
        files: Option<&dyn PluginFiles>,
    ) -> Result<(), PluginError> {
        for (index, gated) in self.commands.iter().enumerate() {
            let Some(name) = &gated.confirm_preview else {
                continue;
            };
            let bad = |problem: String| {
                PluginError::manifest_invalid(
                    &self.file,
                    &format!("commands[{index}].confirm_preview"),
                    problem,
                )
            };
            if self.pipelines.iter().any(|pipeline| &pipeline.name == name) {
                return Err(bad(format!(
                    "names the pipeline `{name}`: a preview is a [[commands]] entry of this plugin"
                )));
            }
            let Some(preview) = self.commands.iter().find(|command| &command.name == name) else {
                return Err(bad(format!(
                    "names `{name}`, which is not a command of this plugin"
                )));
            };
            let problem = if preview.effects != [Effect::Inspect] {
                Some("must have effects = [\"inspect\"]: a preview changes nothing")
            } else if !preview.expose.cli {
                Some("needs CLI exposure: the CLI calls it before the prompt")
            } else if preview.journal.is_none() {
                Some("must declare a journal: it reads what the gated command decides on")
            } else if preview.confirm_prompt.is_some() || preview.approval_required {
                Some(
                    "must ask for no confirmation or approval of its own: the CLI calls it before the gated command's prompt, without the marks",
                )
            } else if preview.returns.is_none() {
                Some(RETURNS_RULE)
            } else {
                None
            };
            if let Some(problem) = problem {
                return Err(bad(format!("names `{name}`, which {problem}")));
            }
            let load = |schema: &SchemaRef| -> Result<Option<Value>, PluginError> {
                match (schema, files) {
                    (SchemaRef::Inline(value), _) => Ok(Some(value.clone())),
                    (SchemaRef::File(_), Some(files)) => schema
                        .load(files)
                        .map(Some)
                        .map_err(|problem| bad(format!("names `{name}`, whose schema {problem}"))),
                    (SchemaRef::File(_), None) => Ok(None),
                }
            };
            if let Some(returns) = preview.returns.as_ref().map(load).transpose()?.flatten()
                && !is_preview_returns(&returns)
            {
                return Err(bad(format!("names `{name}`, which {RETURNS_RULE}")));
            }
            if let (Some(own), Some(theirs)) =
                (load(&gated.input_schema)?, load(&preview.input_schema)?)
            {
                let own = properties(&own);
                if let Some(missing) = properties(&theirs).difference(&own).next() {
                    return Err(bad(format!(
                        "names `{name}`, whose input property `{missing}` is not in this command's input schema: the CLI passes the preview only the gated call's properties it declares"
                    )));
                }
            }
        }
        Ok(())
    }
}

const RETURNS_RULE: &str = "must declare returns = { type = \"object\", properties = { preview = { type = \"string\" } }, required = [\"preview\"], additionalProperties = false }: the CLI prints the preview string";

/// `{ "preview": <string> }`, closed, with `preview` required and nothing else declared.
fn is_preview_returns(schema: &Value) -> bool {
    let only_preview = schema
        .get("properties")
        .and_then(Value::as_object)
        .is_some_and(|properties| {
            properties.len() == 1
                && properties
                    .get("preview")
                    .and_then(|preview| preview.get("type"))
                    .and_then(Value::as_str)
                    == Some("string")
        });
    schema.get("type").and_then(Value::as_str) == Some("object")
        && schema.get("additionalProperties") == Some(&Value::Bool(false))
        && schema.get("required") == Some(&Value::Array(vec![Value::from("preview")]))
        && only_preview
}

/// The property names a schema declares at its root.
fn properties(schema: &Value) -> BTreeSet<String> {
    schema
        .get("properties")
        .and_then(Value::as_object)
        .map(|properties| properties.keys().cloned().collect())
        .unwrap_or_default()
}

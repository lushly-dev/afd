//! What manifest version 5 adds (phase 5 specification, section 2.3; D115, D127): `task` and
//! `person` on a command, each also admitted on a pipeline when every step admits its value.
//!
//! This module parses, validates and stores them. Whether a pipeline's steps admit its values is
//! decided at seal (`pipelines::plan`), where the steps are known. What acts on the keys is
//! later steps': the person page and the MCP exposure of a `require-human` command (step 5),
//! and tasks (step 8). A `require-human` command with `person.mcp` is registered for MCP only in a
//! hosted mode, host-verified (the loader's `mcp_registered`), so mode `none` behaves as phases 2
//! to 4.

use std::collections::BTreeSet;

use serde_json::Value;

use super::{Effect, Expose, JournalDecl, JournalMode, Manifest, PluginKind, SchemaRef, Tbl};
use crate::plugins::error::PluginError;
use crate::plugins::files::PluginFiles;

/// The command keys manifest version 5 adds; versions 1 to 4 name and refuse them.
pub(super) const COMMAND_KEYS_V5: &[(&str, &str)] = &[
    (
        "task",
        "running a command as an MCP task needs manifest_version = 5",
    ),
    (
        "person",
        "a person assurance per surface needs manifest_version = 5",
    ),
];
/// The pipeline keys manifest version 5 adds.
pub(super) const PIPELINE_KEYS_V5: &[(&str, &str)] = COMMAND_KEYS_V5;
const PERSON_KEYS: &[&str] = &["cli", "mcp"];

/// Whether a command may run as an MCP task (`task`, manifest version 5, section 12.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TaskMode {
    /// Never a task (the default).
    #[default]
    Never,
    /// A task when the request declares the tasks extension, inline otherwise.
    Optional,
    /// Only as a task; without the extension the call is `-32021`.
    Required,
}

impl TaskMode {
    /// AFD's task support of the mode, which the host registers the command with (section 12.2):
    /// AFD then runs it as a task when the request declares the extension and the server can
    /// tell its caller apart.
    pub fn support(self) -> afd::TaskSupport {
        match self {
            Self::Never => afd::TaskSupport::Never,
            Self::Optional => afd::TaskSupport::Optional,
            Self::Required => afd::TaskSupport::Required,
        }
    }

    /// The manifest spelling.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Never => "never",
            Self::Optional => "optional",
            Self::Required => "required",
        }
    }
}

/// How a person is proven (section 7.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Assurance {
    /// The CLI's terminal check (D71, D86); not an attestation.
    Terminal,
    /// A fresh login with user verification on the person page.
    Verified,
}

impl Assurance {
    /// The manifest spelling.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Terminal => "terminal",
            Self::Verified => "verified",
        }
    }
}

/// `person = { cli, mcp }` (manifest version 5): the least person assurance per surface of a
/// `require-human` command. Every `require-human` command has one; `{ cli = "terminal" }` is the
/// default, the behaviour of phases 2 to 4.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub struct PersonDecl {
    /// At the CLI: `terminal` (the default) or `verified`.
    pub cli: Assurance,
    /// Over MCP: only `verified`; `None` keeps the command off MCP.
    pub mcp: Option<Assurance>,
}

impl Default for PersonDecl {
    fn default() -> Self {
        Self {
            cli: Assurance::Terminal,
            mcp: None,
        }
    }
}

impl PersonDecl {
    /// Whether a command or pipeline holding this assurance needs a `confirm_preview`: one
    /// decided on the person page (section 2.3).
    pub fn needs_preview(&self) -> bool {
        self.mcp.is_some() || self.cli == Assurance::Verified
    }

    /// Whether this assurance, a pipeline's, admits a step whose own assurance is `step`: it is
    /// at least as strong on every surface the step names, and names MCP only when the step does.
    pub fn admits(&self, step: &Self) -> bool {
        self.cli >= step.cli && (self.mcp.is_none() || step.mcp.is_some())
    }
}

/// `person` as written on a command or pipeline, or `None`.
pub(super) fn person(table: &Tbl<'_>) -> Result<Option<PersonDecl>, PluginError> {
    let Some(person) = table.table("person")? else {
        return Ok(None);
    };
    person.check_keys(PERSON_KEYS, &[])?;
    let cli = match person.string("cli")?.as_deref() {
        None | Some("terminal") => Assurance::Terminal,
        Some("verified") => Assurance::Verified,
        Some(_) => return Err(person.bad("cli", "must be \"terminal\" or \"verified\"")),
    };
    let mcp = match person.string("mcp")?.as_deref() {
        None => None,
        Some("verified") => Some(Assurance::Verified),
        Some(_) => {
            return Err(person.bad(
                "mcp",
                "may only be \"verified\": over MCP only the person page proves a person",
            ));
        }
    };
    Ok(Some(PersonDecl { cli, mcp }))
}

/// A pipeline's `person`: only `{ cli = "terminal" }`. A decision on the person page needs a
/// preview, which a pipeline cannot declare, and the MCP relay confirms no pipeline step (step
/// 0a's amendment), so `cli = "verified"` and `mcp` are refused on a pipeline. Whether its steps
/// admit it is decided at seal.
pub(super) fn pipeline_person(table: &Tbl<'_>) -> Result<Option<PersonDecl>, PluginError> {
    let person = person(table)?;
    if person.is_some_and(|person| person.needs_preview()) {
        return Err(table.bad(
            "person",
            "may only be { cli = \"terminal\" } on a pipeline: a person-page decision needs a preview, which a pipeline cannot declare, and over MCP no pipeline step can be confirmed",
        ));
    }
    Ok(person)
}

/// A command's `person`, settled against `confirm`: refused without `confirm = "require-human"`,
/// and the default for a `require-human` command that gives none. With `mcp`, the command's
/// `expose.mcp` must be true.
pub(super) fn command_person(
    table: &Tbl<'_>,
    declared: Option<PersonDecl>,
    require_human: bool,
    expose: &Expose,
) -> Result<Option<PersonDecl>, PluginError> {
    if !require_human {
        return match declared {
            Some(_) => Err(table.bad(
                "person",
                "goes with confirm = \"require-human\" only: it names how the person who confirms is proven",
            )),
            None => Ok(None),
        };
    }
    let person = declared.unwrap_or_default();
    if person.mcp.is_some() && !expose.mcp {
        return Err(table.bad(
            "person",
            "names mcp = \"verified\" for a command with expose.mcp = false; expose it to MCP or leave mcp out",
        ));
    }
    Ok(Some(person))
}

/// What a command's `task` is checked against (section 2.3).
pub(super) struct TaskRules<'a> {
    pub kind: PluginKind,
    pub effects: &'a [Effect],
    pub expose: &'a Expose,
    pub journal: Option<&'a JournalDecl>,
    pub confirm_prompt: bool,
    pub approval: bool,
    pub authority_prompt: bool,
}

/// `task = "never" | "optional" | "required"` of a command (section 2.3), refused on digest
/// journaling, a confirmation (`confirm_prompt`, so `confirm` and `confirm_preview` too), an
/// approval or an `authority_prompt`; without MCP exposure; on a component command; and on a
/// command whose effects are `inspect` alone, since read results carry content.
pub(super) fn command_task(
    table: &Tbl<'_>,
    rules: &TaskRules<'_>,
) -> Result<TaskMode, PluginError> {
    let task = task_value(table)?;
    if task == TaskMode::Never {
        return Ok(task);
    }
    let refused = if rules.kind == PluginKind::Component {
        Some(
            "is not available to a component command: a task runs in the host's task runner, which a component call cannot report to",
        )
    } else if rules.confirm_prompt {
        Some("is refused beside confirm_prompt: a task never waits for a confirmation")
    } else if rules.approval {
        Some("is refused beside approval = \"required\": a task never waits for an approval")
    } else if rules.authority_prompt {
        Some("is refused beside authority_prompt: a task never waits for a person at a terminal")
    } else {
        task_refusal(rules.effects, rules.expose.mcp, rules.journal)
    };
    match refused {
        Some(why) => Err(table.bad("task", why)),
        None => Ok(task),
    }
}

/// A pipeline's `task` (section 2.3): its own refusals, beside `person`; whether its steps admit
/// it is decided at seal.
pub(super) fn pipeline_task(
    table: &Tbl<'_>,
    effects: &[Effect],
    expose: &Expose,
    journal: Option<&JournalDecl>,
    person: Option<&PersonDecl>,
) -> Result<TaskMode, PluginError> {
    let task = task_value(table)?;
    if task == TaskMode::Never {
        return Ok(task);
    }
    let refused = if person.is_some() {
        Some("is refused beside person: a task never waits for a person")
    } else {
        task_refusal(effects, expose.mcp, journal)
    };
    match refused {
        Some(why) => Err(table.bad("task", why)),
        None => Ok(task),
    }
}

fn task_value(table: &Tbl<'_>) -> Result<TaskMode, PluginError> {
    match table.string("task")?.as_deref() {
        None | Some("never") => Ok(TaskMode::Never),
        Some("optional") => Ok(TaskMode::Optional),
        Some("required") => Ok(TaskMode::Required),
        Some(_) => Err(table.bad("task", "must be \"never\", \"optional\" or \"required\"")),
    }
}

/// The refusals a command and a pipeline share.
fn task_refusal(
    effects: &[Effect],
    mcp: bool,
    journal: Option<&JournalDecl>,
) -> Option<&'static str> {
    if journal.is_some_and(|journal| journal.mode == JournalMode::Digest) {
        Some(
            "is refused with journal mode digest: a task's record would keep what the journal does not",
        )
    } else if !mcp {
        Some("needs expose.mcp = true: only an MCP tools/call becomes a task")
    } else if effects == [Effect::Inspect] {
        Some(
            "is refused when effects are inspect alone: read results carry content, which a task record must not keep",
        )
    } else {
        None
    }
}

/// `task` or `person` on a mounted tool: refused, with why.
pub(super) fn refuse_on_mounted_tool(table: &Tbl<'_>) -> Result<(), PluginError> {
    for key in ["task", "person"] {
        if table.value(key).is_some() {
            return Err(table.bad(
                key,
                "is not available to a mounted tool: the mounted server runs it, outside the host's task runner and person gate",
            ));
        }
    }
    Ok(())
}

impl Manifest {
    /// Section 2.3's preview rule: a command whose `person` names `mcp`, or `cli = "verified"`,
    /// declares `confirm_preview`, journals as `digest`, and names every input property its
    /// preview declares in `journal.keep` (an id), or in `journal.show` (text the person reads
    /// as written, held in the decision for its life and never journaled; step 6). `show` goes
    /// only on such a command, and each entry is a property its preview declares. A schema given
    /// as a file is checked only when `files` is given, as [`Manifest::validate_files`] does.
    pub(super) fn check_person_previews(
        &self,
        files: Option<&dyn PluginFiles>,
    ) -> Result<(), PluginError> {
        for (index, gated) in self.commands.iter().enumerate() {
            let shows = gated
                .journal
                .as_ref()
                .is_some_and(|journal| !journal.show.is_empty());
            if !gated.person.is_some_and(|person| person.needs_preview()) {
                if shows {
                    return Err(PluginError::manifest_invalid(
                        &self.file,
                        &format!("commands[{index}].journal.show"),
                        "goes only on a command decided on the person page (person names mcp or cli = \"verified\"): it names what that page shows".to_owned(),
                    ));
                }
                continue;
            }
            let bad = |key: &str, problem: String| {
                PluginError::manifest_invalid(
                    &self.file,
                    &format!("commands[{index}].{key}"),
                    problem,
                )
            };
            let Some(name) = &gated.confirm_preview else {
                return Err(bad(
                    "person",
                    "names mcp or cli = \"verified\", which needs confirm_preview: the person page shows it before the decision".to_owned(),
                ));
            };
            let keep: Option<BTreeSet<&str>> = gated
                .journal
                .as_ref()
                .filter(|journal| journal.mode == JournalMode::Digest)
                .map(|journal| {
                    journal
                        .keep
                        .iter()
                        .chain(&journal.show)
                        .map(String::as_str)
                        .collect()
                });
            let show: BTreeSet<&str> = gated
                .journal
                .iter()
                .flat_map(|journal| journal.show.iter().map(String::as_str))
                .collect();
            let Some(keep) = keep else {
                return Err(bad(
                    "journal",
                    "must be { mode = \"digest\", keep = [...] } for a command decided on the person page: keep lists the ids its preview reads, the only input a person decision stores".to_owned(),
                ));
            };
            // The preview's existence and kind are check_previews' to report; it runs first.
            let Some(preview) = self.commands.iter().find(|command| &command.name == name) else {
                continue;
            };
            // The page renders the preview through the registry, which journals it: only a digest
            // journal keeps none of its text, as "nothing of the preview is stored but its
            // SHA-256" requires (7.2, step 4; step 5's review).
            if !preview
                .journal
                .as_ref()
                .is_some_and(|journal| journal.mode == JournalMode::Digest)
            {
                return Err(bad(
                    "confirm_preview",
                    format!(
                        "names `{name}`, which must be journaled with mode = \"digest\": the person page renders it, and nothing of a preview is stored but its hash"
                    ),
                ));
            }
            let schema = match (&preview.input_schema, files) {
                (SchemaRef::Inline(value), _) => value.clone(),
                (schema @ SchemaRef::File(_), Some(files)) => {
                    schema.load(files).map_err(|problem| {
                        bad(
                            "confirm_preview",
                            format!("names `{name}`, whose schema {problem}"),
                        )
                    })?
                }
                (SchemaRef::File(_), None) => continue,
            };
            let declared = schema.get("properties").and_then(Value::as_object);
            if let Some(missing) = declared
                .and_then(|properties| properties.keys().find(|key| !keep.contains(key.as_str())))
            {
                return Err(bad(
                    "journal",
                    format!(
                        "keeps no `{missing}`, which its preview `{name}` declares: every property the preview reads must be in journal.keep (an id) or journal.show (text the person reads), so a person decision stores nothing else"
                    ),
                ));
            }
            if let Some(stray) = show
                .iter()
                .find(|key| !declared.is_some_and(|properties| properties.contains_key(**key)))
            {
                return Err(bad(
                    "journal.show",
                    format!(
                        "names `{stray}`, which its preview `{name}` does not declare: the page shows only what the preview reads"
                    ),
                ));
            }
        }
        Ok(())
    }
}

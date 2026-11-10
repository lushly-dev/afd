//! Pipelines as data (specification section 8.5, D3).
//!
//! A `[[pipelines]]` entry is registered as a command of its plugin. Its handler runs the `afd`
//! crate's `execute_pipeline` over the host registry with the caller's context and the entry's
//! steps, `$input` bound to the command's input.
//!
//! What `seal` decides, after every instance is prepared and before anything is registered:
//!
//! - **Existence.** A step must name a command that is registered (a built-in, or any prepared
//!   instance's command). A pipeline with a missing step is *not* registered; its instance still
//!   loads, and `plugin-show` and the doctor name the missing command. A step may not name a
//!   pipeline either: pipelines do not nest, so one can never call itself.
//! - **Effects.** The pipeline's `effects` must cover its steps'. A step that is a host mutation
//!   no plugin effect can cover is not allowed. A pipeline that declares too little fails its
//!   instance with `PLUGIN_MANIFEST_INVALID`.
//! - **Confirmations** (M2 of the 2026-11-01 review). The Rust server checks `confirm_prompt` at
//!   the router, but a pipeline is one command whose handler calls the registry directly, so its
//!   steps' prompts would never be asked. A pipeline with a confirm-gated step therefore gets a
//!   `confirm_prompt` of its own: its steps' prompts in step order, each prefixed with the
//!   step's command name, and `destructive` when any step is. One confirmation of the pipeline
//!   covers its steps, as one confirmation of `afd-pipe` does. A step with `approval =
//!   "required"` is still checked inside, because the approval middleware runs at the registry.
//! - **Journal and authority** (phase 3 section 2.3). A pipeline with a digest step is journaled
//!   as digest with no kept key, whatever it declares, because its journaled result holds its
//!   steps' data; one that passes a digest step's output to a step that is not digest is
//!   `PLUGIN_MANIFEST_INVALID`, because that step's resolved input would enter the journal. A
//!   pipeline inherits its steps' `authority_prompt`s in step order, as it inherits their
//!   `confirm_prompt`s.
//! - **Exposure** (manifest version 4, phase 4 section 2.2, D105). A version 4 pipeline is
//!   registered with its own `expose`, and one exposed to an interface (`mcp`, `agent`, `cli`)
//!   that any of its steps is not exposed to is `PLUGIN_MANIFEST_INVALID`, naming the step. A
//!   pipeline of manifest versions 1 to 3 keeps phase 1's exposure to every surface, unchecked.
//! - **Task and person** (manifest version 5, phase 5 section 2.3). A pipeline's `task` is admitted
//!   only when every step's own `task` is not `never`; its `person` only when every step is a
//!   `require-human` command whose assurance it admits (as strong on each surface, and naming MCP
//!   only when the step does). Otherwise `PLUGIN_MANIFEST_INVALID`, naming the step.
//!
//! What the handler does (phase 4 section 10.1, D91):
//!
//! - **Attestation.** Each step runs under a fresh random trace id, replacing AFD's predictable
//!   `<pipeline id>-step-<i>`, recorded in the host's [`PipelineAttestations`] table for as long
//!   as the step runs: the plugin and instance that ship the pipeline, the pipeline, the run (the
//!   pipeline call's trace id) and the step's command.
//! - **Result.** `result = "steps"` (the default) returns every step's index, command, alias,
//!   status and data; `result = "last"` returns only the last step's data, so only that data is
//!   printed and enters the pipeline's journal entry. Each step is still journaled under its own
//!   name in its own journal mode, as every call is.

use std::collections::BTreeMap;
use std::sync::{Arc, Weak};

use afd::{
    CommandContext, CommandDefinition, CommandError, CommandExecutor, CommandHandler,
    CommandInterface, CommandRegistry, CommandResult, ExposeOptions, PipelineRequest, StepStatus,
    execute_pipeline, failure, success,
};
use async_trait::async_trait;
use serde_json::{Map, Value, json};

use super::attestation::PipelineAttestations;
use super::error::PluginError;
use super::manifest::{Effect, Manifest, PersonDecl, PipelineDecl, PipelineResult, TaskMode};
use umbel_sdk::PipelineAttestation;

/// The interfaces a pipeline may be exposed to; no pipeline is offered in the palette.
const INTERFACES: [CommandInterface; 3] = [
    CommandInterface::Mcp,
    CommandInterface::Agent,
    CommandInterface::Cli,
];

/// What the pipeline resolver knows about one command a step may name.
#[derive(Debug, Clone)]
pub(crate) struct Known {
    /// The command's effects; `None` for a host mutation, which no plugin effect covers.
    pub effects: Option<Vec<Effect>>,
    pub confirm_prompt: Option<String>,
    pub destructive: bool,
    /// Whether the command is a plugin pipeline.
    pub pipeline: bool,
    /// Whether the command is journaled as digest (phase 3 section 7.1).
    pub digest: bool,
    /// The command's `authority_prompt` (phase 3 section 3.3).
    pub authority_prompt: Option<String>,
    /// The interfaces the command is exposed to (phase 4 section 2.2).
    pub expose: ExposeOptions,
    /// The command's `task` (manifest version 5); `never` for the host's commands.
    pub task: TaskMode,
    /// The command's `person`, set for a `require-human` command (manifest version 5).
    pub person: Option<PersonDecl>,
}

/// Whether a pipeline was registered.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum PipelineState {
    Registered,
    /// Not registered, and why (a missing step, a step that is a pipeline or a host mutation).
    Skipped(String),
}

/// The decision about one `[[pipelines]]` entry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PipelinePlan {
    pub name: String,
    pub state: PipelineState,
    /// The union of the steps' prompts, when any step is confirm-gated.
    pub confirm_prompt: Option<String>,
    /// Whether any step is destructive.
    pub destructive: bool,
    /// Whether a step is digest, so the pipeline is journaled as digest with no kept key.
    pub digest: bool,
    /// The union of the steps' authority prompts, in step order.
    pub authority_prompt: Option<String>,
}

/// Decide every pipeline of `manifest` against the commands that exist.
///
/// # Errors
/// `PLUGIN_MANIFEST_INVALID` naming `pipelines[i].effects` for a pipeline whose effects do not
/// cover those of a step it can run.
pub(crate) fn plan(
    manifest: &Manifest,
    known: &BTreeMap<String, Known>,
) -> Result<Vec<PipelinePlan>, PluginError> {
    manifest
        .pipelines
        .iter()
        .enumerate()
        .map(|(index, pipeline)| plan_one(manifest, index, pipeline, known))
        .collect()
}

fn plan_one(
    manifest: &Manifest,
    index: usize,
    pipeline: &PipelineDecl,
    known: &BTreeMap<String, Known>,
) -> Result<PipelinePlan, PluginError> {
    let skipped = |reason: String| PipelinePlan {
        name: pipeline.name.clone(),
        state: PipelineState::Skipped(reason),
        confirm_prompt: None,
        destructive: false,
        digest: false,
        authority_prompt: None,
    };
    let mut steps = Vec::new();
    for step in &pipeline.steps {
        let Some(command) = known.get(&step.command) else {
            return Ok(skipped(format!(
                "the step `{}` names a command that is not registered",
                step.command
            )));
        };
        if command.pipeline {
            return Ok(skipped(format!(
                "the step `{}` is a pipeline; pipelines do not nest",
                step.command
            )));
        }
        let Some(effects) = &command.effects else {
            return Ok(skipped(format!(
                "the step `{}` is a host mutation that no plugin effect covers",
                step.command
            )));
        };
        steps.push((step.command.as_str(), command, effects));
    }
    for (name, _, effects) in &steps {
        if let Some(uncovered) = effects
            .iter()
            .find(|effect| **effect != Effect::Inspect && !pipeline.effects.contains(effect))
        {
            return Err(PluginError::manifest_invalid(
                &manifest.file,
                &format!("pipelines[{index}].effects"),
                format!(
                    "`{}` does not cover the effect `{}` of its step `{name}`",
                    pipeline.name,
                    uncovered.as_str()
                ),
            ));
        }
    }
    check_digest_flow(manifest, index, pipeline, &steps)?;
    if manifest.manifest_version >= 4 {
        check_exposure(manifest, index, pipeline, &steps)?;
    }
    check_task_and_person(manifest, index, pipeline, &steps)?;
    let union = |prompt: fn(&Known) -> Option<&String>| {
        let mut prompts: Vec<String> = Vec::new();
        let mut seen: Vec<&str> = Vec::new();
        for (name, command, _) in &steps {
            if let Some(prompt) = prompt(command)
                && !seen.contains(name)
            {
                seen.push(name);
                prompts.push(format!("{name}: {prompt}"));
            }
        }
        (!prompts.is_empty()).then(|| prompts.join(" "))
    };
    Ok(PipelinePlan {
        name: pipeline.name.clone(),
        state: PipelineState::Registered,
        confirm_prompt: union(|known| known.confirm_prompt.as_ref()),
        destructive: steps.iter().any(|(_, command, _)| command.destructive),
        digest: steps.iter().any(|(_, command, _)| command.digest),
        authority_prompt: union(|known| known.authority_prompt.as_ref()),
    })
}

/// The step a pipeline variable names, for step `at` of `pipeline`: `$prev` the step before,
/// `$first` the first, `$steps[N]` and `$steps.<alias>` the one named. `None` for `$input`, a
/// literal (`$$...`) and anything else.
fn referenced_step(pipeline: &PipelineDecl, at: usize, text: &str) -> Option<usize> {
    let rest = text
        .strip_prefix('$')
        .filter(|rest| !rest.starts_with('$'))?;
    let head = |word: &str| {
        rest.strip_prefix(word)
            .filter(|tail| tail.is_empty() || tail.starts_with(['.', '[']))
    };
    if head("prev").is_some() {
        return at.checked_sub(1);
    }
    if head("first").is_some() {
        return Some(0);
    }
    let tail = rest.strip_prefix("steps")?;
    if let Some(index) = tail.strip_prefix('[') {
        let digits: String = index.chars().take_while(char::is_ascii_digit).collect();
        return digits.parse().ok();
    }
    let alias = tail.strip_prefix('.')?;
    let alias = alias.split(['.', '[']).next().unwrap_or(alias);
    pipeline
        .steps
        .iter()
        .position(|step| step.alias.as_deref() == Some(alias))
}

fn strings<'a>(value: &'a Value, out: &mut Vec<&'a str>) {
    match value {
        Value::String(text) => out.push(text),
        Value::Array(items) => items.iter().for_each(|item| strings(item, out)),
        Value::Object(map) => map.values().for_each(|item| strings(item, out)),
        _ => {}
    }
}

/// Phase 3 section 2.3: a step that is not digest may not take a digest step's output, since its
/// resolved input would be journaled as it is.
fn check_digest_flow(
    manifest: &Manifest,
    index: usize,
    pipeline: &PipelineDecl,
    steps: &[(&str, &Known, &Vec<Effect>)],
) -> Result<(), PluginError> {
    for (at, (step, (name, command, _))) in pipeline.steps.iter().zip(steps).enumerate() {
        if command.digest {
            continue;
        }
        let mut found = Vec::new();
        if let Some(input) = &step.input {
            strings(input, &mut found);
        }
        for text in found {
            let Some(source) = referenced_step(pipeline, at, text) else {
                continue;
            };
            if steps.get(source).is_some_and(|(_, known, _)| known.digest) {
                return Err(PluginError::manifest_invalid(
                    &manifest.file,
                    &format!("pipelines[{index}].steps[{at}].input"),
                    format!(
                        "passes `{text}`, the output of the digest step `{}`, to `{name}`, which is not digest: its input would be journaled with that text",
                        steps[source].0
                    ),
                ));
            }
        }
    }
    Ok(())
}

/// Phase 4 section 2.2 (D105): a version 4 pipeline is exposed no wider than its narrowest step.
fn check_exposure(
    manifest: &Manifest,
    index: usize,
    pipeline: &PipelineDecl,
    steps: &[(&str, &Known, &Vec<Effect>)],
) -> Result<(), PluginError> {
    let exposed = |interface: CommandInterface| match interface {
        CommandInterface::Mcp => pipeline.expose.mcp,
        CommandInterface::Agent => pipeline.expose.agent,
        CommandInterface::Cli => pipeline.expose.cli,
        CommandInterface::Palette => false,
    };
    for interface in INTERFACES
        .into_iter()
        .filter(|interface| exposed(*interface))
    {
        if let Some((name, _, _)) = steps
            .iter()
            .find(|(_, known, _)| !known.expose.is_exposed_to(interface))
        {
            return Err(PluginError::manifest_invalid(
                &manifest.file,
                &format!("pipelines[{index}].expose"),
                format!(
                    "exposes `{}` to {interface}, but its step `{name}` is not exposed to {interface}: a pipeline may be exposed no wider than its narrowest step; set expose.{interface} = false",
                    pipeline.name
                ),
            ));
        }
    }
    Ok(())
}

/// Phase 5 section 2.3: a pipeline's `task` and `person` are admitted only when every step admits
/// them.
fn check_task_and_person(
    manifest: &Manifest,
    index: usize,
    pipeline: &PipelineDecl,
    steps: &[(&str, &Known, &Vec<Effect>)],
) -> Result<(), PluginError> {
    let refuse = |key: &str, problem: String| {
        Err(PluginError::manifest_invalid(
            &manifest.file,
            &format!("pipelines[{index}].{key}"),
            problem,
        ))
    };
    if pipeline.task != TaskMode::Never
        && let Some((name, _, _)) = steps
            .iter()
            .find(|(_, known, _)| known.task == TaskMode::Never)
    {
        return refuse(
            "task",
            format!(
                "is \"{}\", but its step `{name}` is never a task: a pipeline runs as a task only when every step may",
                pipeline.task.as_str()
            ),
        );
    }
    if let Some(person) = &pipeline.person
        && let Some((name, _, _)) = steps
            .iter()
            .find(|(_, known, _)| !known.person.is_some_and(|step| person.admits(&step)))
    {
        return refuse(
            "person",
            format!(
                "is not admitted by its step `{name}`: every step must be a require-human command whose person this pipeline's matches or exceeds on each surface"
            ),
        );
    }
    Ok(())
}

/// The plugin instance that ships a pipeline, and the host's table its steps are recorded in.
#[derive(Clone)]
pub(crate) struct Owner {
    /// The `plugin.id` of the plugin that ships the pipeline.
    pub plugin: String,
    /// The instance whose pipeline it is.
    pub instance: String,
    pub attestations: Arc<PipelineAttestations>,
}

/// The command definition of a registered pipeline. The registry is held weakly: it holds this
/// handler.
pub(crate) fn definition(
    decl: &PipelineDecl,
    plan: &PipelinePlan,
    registry: Weak<CommandRegistry>,
    owner: Owner,
) -> CommandDefinition {
    let steps = decl
        .steps
        .iter()
        .map(|step| {
            let mut built = afd::PipelineStep::new(&step.command);
            if let Some(input) = &step.input {
                built = built.with_input(input.clone());
            }
            if let Some(alias) = &step.alias {
                built = built.with_alias(alias);
            }
            built
        })
        .collect();
    let mut definition = CommandDefinition::new(
        &decl.name,
        &decl.description,
        vec![],
        PipelineHandler {
            name: decl.name.clone(),
            registry,
            steps,
            result: decl.result,
            owner,
        },
    )
    .with_returns(returns(decl.result))
    .with_expose(
        ExposeOptions::new()
            .with_palette(false)
            .with_mcp(decl.expose.mcp)
            .with_agent(decl.expose.agent)
            .with_cli(decl.expose.cli),
    );
    if let Some(prompt) = &plan.confirm_prompt {
        definition = definition.with_confirm_prompt(prompt);
    }
    if plan.destructive {
        definition = definition.with_destructive(true);
    }
    if decl.effects.iter().any(|effect| effect.mutation()) {
        definition = definition.as_mutation();
    }
    // Admitted at seal only when every step may be a task (section 2.3).
    definition.with_task(decl.task.support())
}

fn returns(result: PipelineResult) -> afd::JsonSchema {
    let description = match result {
        PipelineResult::Steps => {
            "steps: one entry per step, in order, with index, command, as, status and data"
        }
        PipelineResult::Last => "the last step's data, and nothing of the steps before it",
    };
    serde_json::from_value(json!({ "type": "object", "description": description }))
        .unwrap_or_default()
}

struct PipelineHandler {
    name: String,
    registry: Weak<CommandRegistry>,
    steps: Vec<afd::PipelineStep>,
    result: PipelineResult,
    owner: Owner,
}

/// `INTERNAL_ERROR` for a step that cannot get a trace id from the random source: it never runs
/// under a trace id that could be guessed.
fn no_random_source() -> CommandResult<Value> {
    failure(
        CommandError::new(
            afd::error_codes::INTERNAL_ERROR,
            "The operating system's random source failed, so the step was given no trace id",
        )
        .with_suggestion("Retry the command; if it keeps failing, check the host's random source.")
        .with_retryable(true),
    )
}

#[async_trait]
impl CommandHandler for PipelineHandler {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let Some(registry) = self.registry.upgrade() else {
            return failure(
                CommandError::new(
                    afd::error_codes::COMMAND_EXECUTION_ERROR,
                    format!("The host that owns the pipeline `{}` is gone", self.name),
                )
                .with_suggestion("Open the workspace again.")
                .with_retryable(false),
            );
        };
        let request = PipelineRequest::new(self.steps.clone()).with_input(input);
        let attestation = PipelineAttestation {
            plugin: self.owner.plugin.clone(),
            instance: self.owner.instance.clone(),
            pipeline: self.name.clone(),
            run: context
                .trace_id
                .clone()
                .unwrap_or_else(crate::host::new_trace_id),
        };
        let attestations = Arc::clone(&self.owner.attestations);
        // AFD's step context (its `traceId`, `<pipeline id>-step-<i>`) is ignored: each step gets
        // a fresh random trace id, recorded until the step returns (section 10.1).
        let executor: CommandExecutor = Arc::new(move |command, input, _step| {
            let registry = Arc::clone(&registry);
            let attestations = Arc::clone(&attestations);
            let attestation = attestation.clone();
            let mut context = context.clone();
            Box::pin(async move {
                let Some(step) = attestations.begin(attestation, &command) else {
                    return no_random_source();
                };
                context.trace_id = Some(step.trace().to_owned());
                let result = registry.execute(&command, input, Some(context)).await;
                drop(step);
                result
            })
        });
        let result = execute_pipeline(&request, &executor, None).await;
        if let Some(step) = result
            .steps
            .iter()
            .find(|step| step.status == StepStatus::Failure)
        {
            let mut error = step.error.clone().unwrap_or_else(|| {
                CommandError::new(
                    afd::error_codes::COMMAND_EXECUTION_ERROR,
                    format!("The step `{}` failed", step.command),
                )
                .with_suggestion("Run the step's command on its own to see why.")
            });
            let mut details = error.details.take().unwrap_or_default();
            details.insert("pipeline".into(), json!(self.name));
            details.insert("step".into(), json!(step.index));
            details.insert("command".into(), json!(step.command));
            return failure(error.with_details(details));
        }
        if self.result == PipelineResult::Last {
            let last = result
                .steps
                .last()
                .filter(|step| step.status == StepStatus::Success)
                .and_then(|step| step.data.clone())
                .unwrap_or(Value::Null);
            return success(last);
        }
        let steps: Vec<Value> = result
            .steps
            .iter()
            .map(|step| {
                let mut item = Map::new();
                item.insert("index".into(), json!(step.index));
                item.insert("command".into(), json!(step.command));
                if let Some(alias) = &step.alias {
                    item.insert("as".into(), json!(alias));
                }
                item.insert(
                    "status".into(),
                    json!(match step.status {
                        StepStatus::Success => "success",
                        StepStatus::Failure => "failure",
                        _ => "skipped",
                    }),
                );
                if let Some(data) = &step.data {
                    item.insert("data".into(), data.clone());
                }
                Value::Object(item)
            })
            .collect();
        success(json!({ "steps": steps }))
    }
}

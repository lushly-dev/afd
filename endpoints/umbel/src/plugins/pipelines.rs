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

use std::collections::BTreeMap;
use std::sync::{Arc, Weak};

use afd::{
    CommandContext, CommandDefinition, CommandError, CommandExecutor, CommandHandler,
    CommandRegistry, CommandResult, ExposeOptions, PipelineRequest, StepStatus, execute_pipeline,
    failure, success,
};
use async_trait::async_trait;
use serde_json::{Map, Value, json};

use super::error::PluginError;
use super::manifest::{Effect, Manifest, PipelineDecl};

/// What the pipeline resolver knows about one command a step may name.
#[derive(Debug, Clone)]
pub(crate) struct Known {
    /// The command's effects; `None` for a host mutation, which no plugin effect covers.
    pub effects: Option<Vec<Effect>>,
    pub confirm_prompt: Option<String>,
    pub destructive: bool,
    /// Whether the command is a plugin pipeline.
    pub pipeline: bool,
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
    let mut prompts: Vec<String> = Vec::new();
    let mut seen: Vec<&str> = Vec::new();
    let mut destructive = false;
    for (name, command, _) in &steps {
        destructive |= command.destructive;
        if let Some(prompt) = &command.confirm_prompt
            && !seen.contains(name)
        {
            seen.push(name);
            prompts.push(format!("{name}: {prompt}"));
        }
    }
    Ok(PipelinePlan {
        name: pipeline.name.clone(),
        state: PipelineState::Registered,
        confirm_prompt: (!prompts.is_empty()).then(|| prompts.join(" ")),
        destructive,
    })
}

/// The command definition of a registered pipeline. The registry is held weakly: it holds this
/// handler.
pub(crate) fn definition(
    decl: &PipelineDecl,
    plan: &PipelinePlan,
    registry: Weak<CommandRegistry>,
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
        },
    )
    .with_returns(returns())
    .with_expose(
        ExposeOptions::new()
            .with_palette(false)
            .with_mcp(true)
            .with_agent(true)
            .with_cli(true),
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
    definition
}

fn returns() -> afd::JsonSchema {
    serde_json::from_value(json!({
        "type": "object",
        "description": "steps: one entry per step, in order, with index, command, as, status and data"
    }))
    .unwrap_or_default()
}

struct PipelineHandler {
    name: String,
    registry: Weak<CommandRegistry>,
    steps: Vec<afd::PipelineStep>,
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
        let executor: CommandExecutor = Arc::new(move |command, input, step| {
            let registry = Arc::clone(&registry);
            let mut context = context.clone();
            if let Some(trace) = step.get("traceId").and_then(Value::as_str) {
                context.trace_id = Some(trace.to_owned());
            }
            Box::pin(async move { registry.execute(&command, input, Some(context)).await })
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

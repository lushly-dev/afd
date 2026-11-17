//! One up-front approval for an `afd-batch` or `afd-pipe` (#459, option A;
//! `spec/command-metadata.md`, "Asking the human over MCP").
//!
//! Asking mid-run would run the earlier steps again on the retry, so the approval middleware
//! decides the whole call before any step's handler runs, the first time a step reaches it:
//!
//! - a gated pipeline step whose input comes from an earlier step (`$prev`, `$first`, `$steps`)
//!   cannot be shown to the human up front, so nothing runs and the agent is told to split the
//!   pipeline there;
//! - otherwise, when the request carries the human's acceptance of every gated step (each bound to
//!   its command, canonical validated input and actor, with a MAC, an expiry and a nonce), every
//!   nonce is spent and the call runs: each gated step then takes one approval of its own binding,
//!   once;
//! - a decline refuses the call; anything else asks once, listing every gated step.
//!
//! While the plan is not to run, every step answers without calling `next`, and the server answers
//! the call with the refusal (or the elicitation), so no handler runs.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};

use serde_json::{json, Value};

use super::{shown_input, Accepted, Gate};
use crate::approval::relay::{
    AcceptedApproval, ApprovalHold, Approved, UpFrontApproval, UpFrontPlan,
};
use crate::approval::token::{actor_json, canonical_json};
use crate::commands::{CommandContext, MiddlewareNext};
use crate::errors::{error_codes, CommandError};
use crate::result::{failure, CommandResult};

/// One gated step as the plan sees it.
struct Gated {
    index: usize,
    command: String,
    /// The canonical JSON of its validated input.
    input: String,
    summary: String,
    bindings: Vec<String>,
}

impl Gate {
    /// Run one step of an up-front call: nothing runs until the plan is to run, and then a gated
    /// step runs only on an unused approval of its own binding.
    pub(super) async fn run_up_front(
        &self,
        up_front: &UpFrontApproval,
        name: String,
        input: Value,
        context: CommandContext,
        next: MiddlewareNext,
    ) -> CommandResult<Value> {
        let plan = {
            // Concurrent steps wait here for the first one's decision.
            let mut slot = up_front.plan.lock().await;
            match slot.as_ref() {
                Some(plan) => Arc::clone(plan),
                None => {
                    let plan = Arc::new(self.decide(up_front, &context).await);
                    *slot = Some(Arc::clone(&plan));
                    plan
                }
            }
        };
        let approved = match plan.as_ref() {
            UpFrontPlan::Refuse(error) => {
                up_front.refuse(error);
                return failure(error.clone());
            }
            UpFrontPlan::Run(approved) => approved,
        };
        if !self.requires_approval(&name, &input, &context).await {
            return next().await;
        }
        let taken = canonical_json(&input).is_ok_and(|input| {
            let bindings = self.relay_bindings(&name, &input, &actor_json(context.actor.as_ref()));
            let mut approved = approved.lock().unwrap_or_else(PoisonError::into_inner);
            approved
                .iter_mut()
                .find(|item| !item.used && bindings.contains(&item.binding))
                .map(|item| item.used = true)
                .is_some()
        });
        if taken {
            return next().await;
        }
        failure(unplanned_error(up_front.tool, &name))
    }

    async fn decide(&self, up_front: &UpFrontApproval, context: &CommandContext) -> UpFrontPlan {
        let late = up_front.steps.iter().find(|step| {
            step.dynamic
                && self
                    .options
                    .commands
                    .get(&step.command)
                    .is_some_and(|command| {
                        !matches!(
                            command.approval,
                            None | Some(crate::approval::ApprovalPolicy::NotRequired)
                        )
                    })
        });
        if let Some(step) = late {
            return UpFrontPlan::Refuse(split_error(up_front.tool, step.index, &step.command));
        }

        let now = self.clock().now();
        let actor = actor_json(context.actor.as_ref());
        let mut gated = Vec::new();
        for step in &up_front.steps {
            let Some(input) = step.input.as_ref().filter(|_| !step.dynamic) else {
                continue;
            };
            if !self.requires_approval(&step.command, input, context).await {
                continue;
            }
            let Ok(canonical) = canonical_json(input) else {
                return UpFrontPlan::Refuse(not_plain_json(&step.command));
            };
            gated.push(Gated {
                index: step.index,
                command: step.command.clone(),
                summary: self.summary(&step.command, input, context),
                bindings: self.relay_bindings(&step.command, &canonical, &actor),
                input: canonical,
            });
        }
        if gated.is_empty() {
            return UpFrontPlan::Run(Mutex::new(Vec::new()));
        }

        let Some((accepted, declined)) = up_front.channel.all_answers() else {
            // The server answers with an internal error: the principal cannot be bound.
            return UpFrontPlan::Refuse(pending_error(up_front.tool, &gated));
        };
        if gated.iter().any(|step| {
            step.bindings
                .iter()
                .any(|binding| declined.contains(binding))
        }) {
            return UpFrontPlan::Refuse(declined_error(up_front.tool, &gated));
        }

        // Each gated step takes a distinct genuine acceptance of its own binding, so two identical
        // steps need two. The latest answer wins: later answers are read last.
        let mut pool: Vec<AcceptedApproval> = accepted.clone();
        let mut matched: Vec<AcceptedApproval> = Vec::new();
        for step in &gated {
            let found = pool.iter().rposition(|answer| {
                self.genuine(
                    &step.bindings,
                    &answer.binding,
                    &answer.nonce,
                    answer.expires_at,
                    &answer.mac,
                    now,
                )
            });
            match found {
                Some(at) => matched.push(pool.remove(at)),
                None => break,
            }
        }
        if matched.len() == gated.len() {
            // Spend every nonce before anything runs: a replay of this request runs nothing.
            let mut fresh = true;
            for answer in &matched {
                let spent = Accepted {
                    nonce: answer.nonce.clone(),
                    expires_at: answer.expires_at,
                };
                if !self.consume(&spent, now).await {
                    fresh = false;
                }
            }
            if fresh {
                return UpFrontPlan::Run(Mutex::new(
                    matched
                        .into_iter()
                        .map(|answer| Approved {
                            binding: answer.binding,
                            used: false,
                        })
                        .collect(),
                ));
            }
        }

        // Ask once for every gated step, saying why when earlier approvals did not hold.
        let mut questions = Vec::with_capacity(gated.len());
        for step in &gated {
            match self.question(step.bindings.clone(), now) {
                Ok(question) => questions.push(question),
                Err(message) => {
                    return UpFrontPlan::Refuse(
                        CommandError::new(error_codes::COMMAND_EXECUTION_ERROR, message)
                            .with_suggestion("The system random source failed; try again later"),
                    )
                }
            }
        }
        up_front.channel.hold(ApprovalHold {
            questions,
            message: steps_message(
                up_front.tool,
                &gated,
                (!accepted.is_empty()).then_some(
                    "The earlier approval expired, was already used or no longer matches; approve again to run it.",
                ),
            ),
        });
        UpFrontPlan::Refuse(pending_error(up_front.tool, &gated))
    }
}

fn noun(tool: &str) -> &'static str {
    if tool == "afd-batch" {
        "batch"
    } else {
        "pipeline"
    }
}

/// The question of an up-front approval: what the call is, then each gated step's summary,
/// command and canonical input, so the human sees exactly what would run.
fn steps_message(tool: &str, gated: &[Gated], note: Option<&str>) -> String {
    let what = if tool == "afd-batch" {
        "This batch"
    } else {
        "This pipeline"
    };
    let count = if gated.len() == 1 {
        "a step that needs".to_owned()
    } else {
        format!("{} steps that need", gated.len())
    };
    let mut lines: Vec<String> = note.into_iter().map(str::to_owned).collect();
    lines.push(format!(
        "{what} runs {count} your approval. Nothing runs unless you approve all of them."
    ));
    for step in gated {
        lines.push(String::new());
        lines.push(format!("Step {}: {}", step.index + 1, step.summary));
        lines.push(format!("Command: {}", step.command));
        lines.push(format!("Input: {}", shown_input(&step.input)));
    }
    lines.join("\n")
}

/// A gated step whose input is not known until the pipeline runs: nothing ran.
fn split_error(tool: &str, index: usize, command: &str) -> CommandError {
    let noun = noun(tool);
    CommandError::new(
        error_codes::APPROVAL_REQUIRED,
        format!("{command} (step {index}) needs approval, and its input comes from an earlier step, so the user cannot approve it before the {noun} runs. Nothing ran."),
    )
    .with_suggestion(format!(
        "Split the {noun} at step {index}: run the steps before it with {tool}, then call {command} on its own with the input they returned, so the client can ask the user."
    ))
    .with_retryable(false)
    .with_details(HashMap::from([
        ("reason".to_owned(), json!("input-not-known")),
        ("step".to_owned(), json!(index)),
        ("command".to_owned(), json!(command)),
    ]))
}

fn summaries(gated: &[Gated]) -> String {
    gated
        .iter()
        .map(|step| step.summary.as_str())
        .collect::<Vec<_>>()
        .join("; ")
}

fn declined_error(tool: &str, gated: &[Gated]) -> CommandError {
    let mut names: Vec<&str> = Vec::new();
    for step in gated {
        if !names.contains(&step.command.as_str()) {
            names.push(&step.command);
        }
    }
    CommandError::new(
        error_codes::APPROVAL_REQUIRED,
        format!(
            "The user did not approve {}; nothing in the {} ran",
            names.join(", "),
            noun(tool)
        ),
    )
    .with_suggestion(
        "Do not run this again without asking the user first; the user chose not to approve it.",
    )
    .with_retryable(false)
    .with_details(HashMap::from([
        ("reason".to_owned(), json!("declined")),
        ("summary".to_owned(), json!(summaries(gated))),
    ]))
}

/// The result while the human is asked; the server answers with the elicitation instead.
fn pending_error(tool: &str, gated: &[Gated]) -> CommandError {
    let summary = summaries(gated);
    CommandError::new(
        error_codes::APPROVAL_REQUIRED,
        format!("The {} needs approval before it runs", noun(tool)),
    )
    .with_suggestion(format!(
        "Wait for the user to approve \"{summary}\" in the client."
    ))
    .with_retryable(false)
    .with_details(HashMap::from([("summary".to_owned(), json!(summary))]))
}

/// A gated step the human was not asked about up front (its policy changed its mind).
fn unplanned_error(tool: &str, command: &str) -> CommandError {
    CommandError::new(
        error_codes::APPROVAL_REQUIRED,
        format!("{command} needs approval before it runs"),
    )
    .with_suggestion(format!(
        "Ask the user to approve it; the client could not be asked for this step of the {}. Call {command} on its own so the client can ask the user.",
        noun(tool)
    ))
    .with_retryable(false)
    .with_details(HashMap::from([(
        "summary".to_owned(),
        json!(format!("Run {command}")),
    )]))
}

fn not_plain_json(command: &str) -> CommandError {
    CommandError::new(
        error_codes::COMMAND_EXECUTION_ERROR,
        format!("The input of {command} cannot be bound to an approval"),
    )
    .with_suggestion("Pass plain JSON input: integers within ±2^53")
    .with_retryable(false)
}

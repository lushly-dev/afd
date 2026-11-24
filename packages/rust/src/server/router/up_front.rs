//! The up-front approval of an `afd-batch` or `afd-pipe` (#459; `spec/command-metadata.md`,
//! "Asking the human over MCP"): the steps the approval middleware decides on, and the round
//! that asks the human once for every gated step, on MCP 2026-07-28 or in band on a 2025
//! connection with a back channel.

use std::future::Future;
use std::sync::Arc;

use rmcp::model::CallToolResponse;
use serde_json::{json, Value};

use super::{Call, LEGACY_APPROVAL_ROUNDS};
use crate::approval::relay::{ApprovalRelayChannel, RoundAnswers, UpFrontApproval, UpFrontStep};
use crate::pipeline::{reads_step_data, try_resolve_variables, PipelineContext};
use crate::server::confirmations::{self, Round};
use crate::{BatchRequest, CommandContext, CommandError, PipelineRequest};

/// The request an up-front approval is bound to.
pub(super) struct UpFrontCall {
    pub(super) tool: &'static str,
    /// The request as sent, as canonical JSON.
    pub(super) call: String,
    /// Whether a step runs only under a condition.
    pub(super) conditional: bool,
}

impl UpFrontCall {
    /// `request` of `tool`, with object keys sorted.
    pub(super) fn new(
        tool: &'static str,
        request: &impl serde::Serialize,
        conditional: bool,
    ) -> Self {
        let value = serde_json::to_value(request).unwrap_or(Value::Null);
        let call = confirmations::canonical(&json!([tool, value]));
        Self {
            tool,
            call,
            conditional,
        }
    }

    fn approval(
        &self,
        steps: Vec<UpFrontStep>,
        channel: Arc<ApprovalRelayChannel>,
    ) -> UpFrontApproval {
        UpFrontApproval::new(
            self.tool,
            self.call.clone(),
            self.conditional,
            steps,
            channel,
        )
    }
}

/// What an up-front call came to.
pub(super) enum UpFrontOutcome<R> {
    /// The steps ran (or the plan was decided without a question): the run's result.
    Ran(R),
    /// Nothing ran: answer with this error.
    Refused(CommandError),
    /// Nothing ran: ask the human.
    Ask(CallToolResponse),
    /// The call's principal cannot be bound: an internal error.
    Internal,
}

impl Call<'_> {
    /// The step of a batch or pipeline as the approval middleware sees it: its validated input,
    /// or none when it names no command the caller can run or does not validate.
    /// A step with no input to approve up front: one that reads an earlier step's data
    /// (`dynamic`), or one whose input is over the resolution limits and fails when it runs.
    fn unresolved_step(&self, index: usize, command: &str, dynamic: bool) -> UpFrontStep {
        let definition = self.exposed(command);
        UpFrontStep {
            index,
            command: command.to_owned(),
            dynamic,
            input: None,
            sent: None,
            approval: definition
                .as_ref()
                .and_then(|definition| definition.approval.clone()),
            confirm_prompt: definition.and_then(|definition| definition.confirm_prompt.clone()),
        }
    }

    fn up_front_step(&self, index: usize, command: &str, input: Value) -> UpFrontStep {
        let definition = self.exposed(command);
        let validated = definition.as_ref().and_then(|definition| {
            self.server
                .inner
                .registry
                .validate(definition, input.clone())
                .ok()
        });
        UpFrontStep {
            index,
            command: command.to_owned(),
            dynamic: false,
            sent: validated.is_some().then_some(input),
            input: validated,
            approval: definition
                .as_ref()
                .and_then(|definition| definition.approval.clone()),
            confirm_prompt: definition.and_then(|definition| definition.confirm_prompt.clone()),
        }
    }

    /// Whether a step of `commands` could be gated: the request can ask, and a step names a
    /// command the caller can run. A step is gated by its command's own policy or by the one an
    /// approval middleware's commands list gives it, which the server cannot see, so any command
    /// counts: the approval middleware decides each step from both.
    fn may_gate<'s>(&self, mut commands: impl Iterator<Item = &'s str>) -> bool {
        self.can_elicit() && commands.any(|name| self.exposed(name).is_some())
    }

    /// The steps of an `afd-batch` for its up-front approval: `None` when the request cannot ask
    /// or no step names a command the caller can run. Every item's input is known up front.
    pub(super) fn batch_up_front(&self, request: &BatchRequest<Value>) -> Option<Vec<UpFrontStep>> {
        if !self.may_gate(request.commands.iter().map(|item| item.command.as_str())) {
            return None;
        }
        Some(
            request
                .commands
                .iter()
                .enumerate()
                .map(|(index, item)| self.up_front_step(index, &item.command, item.input.clone()))
                .collect(),
        )
    }

    /// The steps of an `afd-pipe` for its up-front approval: a step whose input reads an earlier
    /// step's data is not known up front; any other has its `$input` references resolved, as the
    /// pipeline will.
    pub(super) fn pipeline_up_front(&self, request: &PipelineRequest) -> Option<Vec<UpFrontStep>> {
        if !self.may_gate(request.steps.iter().map(|step| step.command.as_str())) {
            return None;
        }
        let context = PipelineContext::new(request.input.clone());
        Some(
            request
                .steps
                .iter()
                .enumerate()
                .map(|(index, step)| match step.input.as_ref() {
                    // A command the caller cannot run is not one: it fails as a missing name.
                    _ if self.exposed(&step.command).is_none() => UpFrontStep {
                        index,
                        command: step.command.clone(),
                        dynamic: false,
                        input: None,
                        sent: None,
                        approval: None,
                        confirm_prompt: None,
                    },
                    Some(input) if reads_step_data(input) => {
                        self.unresolved_step(index, &step.command, true)
                    }
                    // An input over the limits fails when its step runs: nothing to approve.
                    Some(input) => match try_resolve_variables(input, &context) {
                        Ok(input) => self.up_front_step(index, &step.command, input),
                        Err(_) => self.unresolved_step(index, &step.command, false),
                    },
                    None => self.up_front_step(index, &step.command, json!({})),
                })
                .collect(),
        )
    }

    /// Run a batch or pipeline (`run`, given the steps' context) under one up-front approval:
    /// nothing runs unless every gated step is approved, and the human is asked once for all.
    pub(super) async fn run_up_front<R, F, Fut>(
        &self,
        call: UpFrontCall,
        steps: Vec<UpFrontStep>,
        round: &Arc<Round>,
        run: F,
    ) -> UpFrontOutcome<R>
    where
        F: Fn(CommandContext) -> Fut,
        Fut: Future<Output = R>,
    {
        if confirmations::is_modern(self.context) {
            let answers = Arc::clone(round);
            let channel = Arc::new(ApprovalRelayChannel::up_front(Box::new(move || {
                answers.answers()
            })));
            let up_front = Arc::new(call.approval(steps, Arc::clone(&channel)));
            let result = run(self.up_front_context(&up_front)).await;
            if channel.unbindable() {
                return UpFrontOutcome::Internal;
            }
            if let Some(hold) = channel.held() {
                return round
                    .ask_approval(&hold)
                    .map_or(UpFrontOutcome::Internal, UpFrontOutcome::Ask);
            }
            return finished(&up_front, result);
        }
        // A 2025 connection asks in band, then runs the call again with the answer. Nothing ran
        // while the question was pending, so running again runs each step once.
        let mut answers = RoundAnswers::default();
        for _ in 0..LEGACY_APPROVAL_ROUNDS {
            let carried = Arc::new(answers);
            let channel = Arc::new(ApprovalRelayChannel::up_front(Box::new(move || {
                Some(Arc::clone(&carried))
            })));
            let up_front = Arc::new(call.approval(steps.clone(), Arc::clone(&channel)));
            let result = run(self.up_front_context(&up_front)).await;
            let Some(hold) = channel.held() else {
                return finished(&up_front, result);
            };
            let elicitation = json!({
                "mode": "form",
                "message": hold.message,
                "requestedSchema": confirmations::approval_requested_schema(),
            });
            let answer = match serde_json::from_value(elicitation) {
                Ok(params) => self.context.peer.create_elicitation(params).await.ok(),
                Err(_) => None,
            };
            let Some(answer) = answer else {
                return finished(&up_front, result);
            };
            let answer = serde_json::to_value(answer).unwrap_or(Value::Null);
            let accept =
                answer["action"] == "accept" && answer["content"]["approve"] == Value::Bool(true);
            answers = RoundAnswers::default();
            for question in &hold.questions {
                let asked = question.asked(i64::MAX);
                if accept {
                    answers.accepted.push(asked);
                } else {
                    answers.declined.push(asked);
                }
            }
        }
        let carried = Arc::new(answers);
        let channel = Arc::new(ApprovalRelayChannel::up_front(Box::new(move || {
            Some(Arc::clone(&carried))
        })));
        let up_front = Arc::new(call.approval(steps, channel));
        let result = run(self.up_front_context(&up_front)).await;
        finished(&up_front, result)
    }

    /// The context of an up-front call's steps: a relay channel that never asks for one step, and
    /// the up-front approval.
    fn up_front_context(&self, up_front: &Arc<UpFrontApproval>) -> CommandContext {
        let mut context = self.step_context();
        context.server_mut().up_front_approval = Some(Arc::clone(up_front));
        context
    }
}

/// The run's result, or the refusal the approval middleware recorded instead (nothing ran).
fn finished<R>(up_front: &UpFrontApproval, result: R) -> UpFrontOutcome<R> {
    match up_front.refusal() {
        Some(error) => UpFrontOutcome::Refused(error),
        None => UpFrontOutcome::Ran(result),
    }
}

//! Tool call routing: the meta-tools, grouped tools and command tools, as TypeScript's tool
//! router dispatches them.
//!
//! The context hook ([`super::context_hook`]) runs first, once per call, before the tool is
//! looked up and before the confirmation gate; a refusal answers the call whatever its name.
//! The request's declared context fields (`spec/context-fields.md`) are then added from `_meta`
//! for each name the hook did not set. Every route then ends in
//! [`CommandRegistry::execute`](crate::CommandRegistry::execute)
//! (directly, or for each batch item or pipeline step) with the hook's context, on which the
//! server re-asserts interface `mcp`, the remote flag (under which an unexposed command is
//! indistinguishable from an unknown one, D4), a trace ID, its default actor, clock and random
//! source, and the request's active context, which the hook cannot set. The confirmation gate
//! sees every command a call would run before any of them runs, and the registry's middleware
//! (the approval middleware among them) wraps each execution. No route reaches a command that a
//! direct tool call could not.
//!
//! A host-verified command goes to the host's relay instead of the confirmation gate
//! ([`super::human_relay`]), and only on a route to that one command: a batch or pipeline naming
//! one fails before any step runs. A call to one command that can carry a form elicitation also
//! binds the form-mode approval relay's channel to its context, which the approval middleware
//! claims ([`crate::ApprovalRelay::McpElicitation`]); a host-verified command never gets one.
//!
//! A call to one command that may run as a task becomes a task once every check above has passed,
//! when the request declares the Tasks extension ([`super::tasks`]); a batch or pipeline naming a
//! command that runs only as a task fails before any step runs.
//!
//! Every tool result carries the whole result as `structuredContent` next to the JSON text, as
//! TypeScript's `resultContent` does.

use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use rmcp::model::{CallToolRequestParams, CallToolResponse, CallToolResult, ContentBlock};
use rmcp::service::RequestContext;
use rmcp::{ErrorData, RoleServer};
use serde::Serialize;
use serde_json::{json, Map, Value};

use crate::commands::Visibility;
use crate::contexts::{not_in_context_error, ContextScope};
use crate::{
    error_codes, execute_pipeline, failure, BatchRequest, CommandContext, CommandDefinition,
    CommandError, CommandExecutor, CommandResult, PipelineRequest, TaskSupport,
};

use super::authz;
use super::confirmations::{self, Acknowledgement, Decision, Round, Step};
use super::context_hook;
use super::human_relay::{self, RelayDecision, RelayGate};
use super::meta_argument;
use super::meta_tools;
use super::strategy::{command_action, command_group, ToolStrategy};
use super::tasks;
use super::McpServer;
use crate::approval::relay::{ApprovalRelayChannel, Asked, RoundAnswers, APPROVAL_INPUT_KEY};

static TRACE_COUNTER: AtomicU64 = AtomicU64::new(0);

/// How many approval questions a 2025 connection is asked in band for one call: one, and one more
/// when the first answer expired or was already used.
const LEGACY_APPROVAL_ROUNDS: usize = 2;

/// A trace ID: `<prefix>-<nanoseconds>-<counter>`.
pub(crate) fn trace_id(prefix: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_nanos());
    let count = TRACE_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}-{nanos:x}-{count}")
}

/// The answer to a call whose confirmation state cannot be bound: a generic internal error that
/// names no one, as TypeScript and Python answer.
fn confirmation_internal() -> ErrorData {
    ErrorData::internal_error("Internal error", None)
}

fn internal(error: impl std::fmt::Display) -> ErrorData {
    ErrorData::internal_error(error.to_string(), None)
}

/// A tool result: the JSON as text content, the same JSON as `structuredContent` (when it is an
/// object, as every AFD result is), and `isError`.
pub(crate) fn tool_result(
    value: &impl Serialize,
    is_error: bool,
) -> Result<CallToolResponse, ErrorData> {
    let structured = serde_json::to_value(value).map_err(internal)?;
    let text = serde_json::to_string(&structured).map_err(internal)?;
    let content = vec![ContentBlock::text(text)];
    let mut result = if is_error {
        CallToolResult::error(content)
    } else {
        CallToolResult::success(content)
    };
    if structured.is_object() {
        result.structured_content = Some(structured);
    }
    Ok(result.into())
}

fn command_result(result: &CommandResult<Value>) -> Result<CallToolResponse, ErrorData> {
    tool_result(result, !result.success)
}

fn refused(error: CommandError) -> Result<CallToolResponse, ErrorData> {
    command_result(&failure(error))
}

/// The pipeline result of a request that runs no step: one synthetic failed step at index -1,
/// as TypeScript reports it.
fn pipeline_failure(error: &CommandError) -> Value {
    json!({
        "metadata": {
            "confidence": 0,
            "confidenceBreakdown": [],
            "reasoning": [],
            "warnings": [],
            "sources": [],
            "alternatives": [],
            "executionTimeMs": 0,
            "completedSteps": 0,
            "totalSteps": 0,
        },
        "steps": [{
            "index": -1,
            "command": "",
            "status": "failure",
            "executionTimeMs": 0,
            "error": error,
        }],
    })
}

fn batch_failure(error: CommandError) -> Result<CallToolResponse, ErrorData> {
    let started_at = chrono::Utc::now().to_rfc3339();
    tool_result(
        &crate::create_failed_batch_result::<Value>(error, &started_at),
        true,
    )
}

/// `args` without a top-level `confirm`, which the executors do not know.
fn without_confirm(mut args: Map<String, Value>) -> Map<String, Value> {
    args.remove("confirm");
    args
}

fn named(value: &Value) -> Acknowledgement {
    match value.as_array() {
        Some(names) => Acknowledgement::Names(
            names
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect::<HashSet<_>>(),
        ),
        None => Acknowledgement::None,
    }
}

fn flag(value: &Value) -> Acknowledgement {
    if value == &Value::Bool(true) {
        Acknowledgement::All
    } else {
        Acknowledgement::None
    }
}

fn input_or_empty(value: Option<&Value>) -> Value {
    match value {
        None | Some(Value::Null) => json!({}),
        Some(value) => value.clone(),
    }
}

/// One tool call being routed.
pub(crate) struct Call<'a> {
    server: &'a McpServer,
    request: &'a CallToolRequestParams,
    context: &'a RequestContext<RoleServer>,
    scope: Option<ContextScope>,
    /// The hook's context, with the server's invariants (see the module docs).
    base: CommandContext,
    /// The listing filter of an authorized caller (`spec/authorization.md`, M6, "Listing").
    visible: Option<Visibility>,
}

impl Call<'_> {
    fn active(&self) -> Option<String> {
        self.scope.as_ref().and_then(ContextScope::active)
    }

    /// MCP-exposed commands in the active context that the caller may see.
    fn callable(&self) -> Vec<Arc<CommandDefinition>> {
        let active = self.active();
        self.server
            .exposed_commands()
            .into_iter()
            .filter(|command| command.is_accessible_in_context(active.as_deref()))
            .filter(|command| self.shows(command))
            .collect()
    }

    /// Whether a listing shows `command` to this caller.
    fn shows(&self, command: &CommandDefinition) -> bool {
        self.visible
            .as_ref()
            .is_none_or(|visible| visible.allows(command))
    }

    /// The MCP-exposed command named `name`.
    fn exposed(&self, name: &str) -> Option<Arc<CommandDefinition>> {
        self.server
            .inner
            .registry
            .get(name)
            .filter(|command| command.expose.mcp)
    }

    /// The `COMMAND_NOT_IN_CONTEXT` result when `command` is outside the active context.
    fn denial(&self, command: &CommandDefinition) -> Option<Result<CallToolResponse, ErrorData>> {
        let active = self.active()?;
        if command.is_accessible_in_context(Some(&active)) {
            return None;
        }
        let tools = self.exposed(crate::AFD_CONTEXT_COMMAND_NAMES[0]).is_some();
        Some(refused(not_in_context_error(command, &active, tools)))
    }

    /// The context every execution of this call starts from: the hook's context with the
    /// request's context scope and the tool surface `afd-help` reports, which only the server
    /// sets.
    fn execution_context(&self) -> CommandContext {
        let mut context = self.base.clone();
        context.context_scope = self.scope.clone();
        let mut surface = self.server.tool_surface();
        surface.visible = self.visible.clone();
        context.tool_surface = Some(surface);
        context.scope_check = authz::execution_check(self.server, context.credentials.as_ref());
        context
    }

    /// The call's principal binding (#532): who is calling, as the hook (and the verified
    /// credentials) left the context, so a state answered for one caller is never another's.
    /// `None` for credentials with an empty issuer, subject or client id (only host code could
    /// build them), which are never bound: no state is then read or minted.
    fn principal(&self) -> Option<String> {
        crate::principal_binding(self.base.actor.as_ref(), self.base.credentials.as_deref()).ok()
    }

    /// The round of this call, which runs `steps`: the answers its retry carries.
    fn round(&self, steps: &[Step], principal: Option<&str>) -> Arc<Round> {
        let channel = self.channel(principal);
        Arc::new(Round::new(
            Arc::clone(&self.server.inner.confirmations),
            &channel,
            steps,
        ))
    }

    fn channel<'a>(&'a self, principal: Option<&'a str>) -> confirmations::Channel<'a> {
        confirmations::Channel {
            request: self.request,
            context: self.context,
            legacy_back_channel: self.server.inner.legacy_back_channel,
            principal,
        }
    }

    async fn confirm(
        &self,
        steps: &[Step],
        acknowledged: Acknowledgement,
        how_to_acknowledge: &str,
        round: &Round,
        principal: Option<&str>,
    ) -> Decision {
        let registry = &self.server.inner.registry;
        let channel = self.channel(principal);
        confirmations::check(
            &self.server.inner.confirmations,
            steps,
            |name| {
                // A host-verified command is never confirmed with a form or an acknowledgement.
                registry
                    .get(name)
                    .filter(|command| command.expose.mcp && !command.is_host_verified())
                    .and_then(|command| command.confirm_prompt.clone())
            },
            acknowledged,
            how_to_acknowledge,
            &channel,
            round,
        )
        .await
    }

    /// The refusal of a batch or pipeline that names a host-verified command: only a call to that
    /// one command can be relayed, so nothing runs.
    fn host_verified_steps(&self, steps: &[Step]) -> Option<CommandError> {
        let mut names: Vec<String> = Vec::new();
        for step in steps {
            let host_verified = self
                .exposed(&step.command)
                .is_some_and(|command| command.is_host_verified());
            if host_verified && !names.contains(&step.command) {
                names.push(step.command.clone());
            }
        }
        (!names.is_empty())
            .then(|| human_relay::unrelayable(&names, self.server.inner.human_relay.is_some()))
    }

    /// Whether this request can carry a form elicitation: a modern request that declares it, or
    /// a 2025 connection with a back channel whose client declared it.
    fn can_elicit(&self) -> bool {
        confirmations::allows_form_elicitation(self.context)
            && (confirmations::is_modern(self.context) || self.server.inner.legacy_back_channel)
    }

    /// Run a call that routes to the one command `command` with `input` as sent: the host's relay
    /// for a host-verified command, else the confirmation gate and the form-mode approval relay.
    async fn single(
        &self,
        command: &CommandDefinition,
        input: Value,
        acknowledged: Acknowledgement,
        how_to_acknowledge: &str,
    ) -> Result<CallToolResponse, ErrorData> {
        let name = command.name.as_str();
        if command.is_host_verified() {
            let execution = self.execution_context();
            let gate = RelayGate {
                relay: self.server.inner.human_relay.as_ref(),
                request: self.request,
                context: self.context,
                registry: &self.server.inner.registry,
                command,
                execution: &execution,
            };
            return match human_relay::check(gate, input.clone()).await {
                RelayDecision::Proceed(evidence) => {
                    let mut execution = execution;
                    execution.relay_evidence = Some(Arc::new(evidence));
                    command_result(
                        &self
                            .server
                            .inner
                            .registry
                            .execute(name, input, Some(execution))
                            .await,
                    )
                }
                RelayDecision::Refuse(error) => refused(error),
                RelayDecision::Ask(response) => Ok(response),
                RelayDecision::Internal => Err(confirmation_internal()),
            };
        }
        let principal = self.principal();
        let steps = [Step::new(name, input.clone())];
        let round = self.round(&steps, principal.as_deref());
        match self
            .confirm(
                &steps,
                acknowledged,
                how_to_acknowledge,
                &round,
                principal.as_deref(),
            )
            .await
        {
            Decision::Proceed => self.dispatch(command, input, round).await,
            Decision::Refuse(error) => refused(error),
            Decision::Ask(response) => Ok(response),
            Decision::Internal => Err(confirmation_internal()),
        }
    }

    /// Run the one command this call routes to, once every check before dispatch passed: as a
    /// task when it may be one and the request declares the Tasks extension
    /// (`spec/command-metadata.md`, "Tasks"); JSON-RPC `-32021` for a `required` command when
    /// the request does not; inline otherwise.
    async fn dispatch(
        &self,
        command: &CommandDefinition,
        input: Value,
        round: Arc<Round>,
    ) -> Result<CallToolResponse, ErrorData> {
        let support = command.task_support();
        if support.allows_task() {
            if tasks::declares_tasks(self.context) {
                return self
                    .server
                    .start_task(command, input, self.execution_context())
                    .await;
            }
            if support == TaskSupport::Required {
                return Err(tasks::missing_capability());
            }
        }
        self.execute_asking(&command.name, input, round).await
    }

    /// The refusal of a batch or pipeline with a step naming a command that runs only as a task:
    /// only a call to that one command can become a task, so nothing runs.
    fn task_only_steps(&self, steps: &[Step], code: &str, kind: &str) -> Option<CommandError> {
        let mut names: Vec<String> = Vec::new();
        for step in steps {
            let required = self
                .exposed(&step.command)
                .is_some_and(|command| command.task_support() == TaskSupport::Required);
            if required && !names.contains(&step.command) {
                names.push(step.command.clone());
            }
        }
        if names.is_empty() {
            return None;
        }
        Some(
            CommandError::new(
                code,
                format!(
                    "{} runs only as a task, which a {kind} step cannot be",
                    confirmations::quoted(&names)
                ),
            )
            .with_suggestion(format!(
                "Call each of {} on its own (its tool or afd-call) from a client that declares the {} extension; nothing ran.",
                confirmations::quoted(&names),
                tasks::TASKS_EXTENSION_ID
            ))
            .with_retryable(false),
        )
    }

    /// Execute the one command this call routes to with the form-mode approval relay's channel
    /// on its context when the request can carry a form elicitation: a hold the approval
    /// middleware records becomes `input_required` on MCP 2026-07-28, or a server-sent elicitation
    /// on a 2025 connection with a back channel.
    async fn execute_asking(
        &self,
        name: &str,
        input: Value,
        round: Arc<Round>,
    ) -> Result<CallToolResponse, ErrorData> {
        if !self.can_elicit() {
            return self.execute(name, input).await;
        }
        if confirmations::is_modern(self.context) {
            let answers = Arc::clone(&round);
            let channel = Arc::new(ApprovalRelayChannel::asking(
                name,
                Box::new(move || answers.answers()),
            ));
            let result = self.execute_with_relay(name, input, &channel).await;
            if channel.unbindable() {
                return Err(confirmation_internal());
            }
            return match channel.held() {
                Some(hold) => round.ask_approval(&hold).ok_or_else(confirmation_internal),
                None => command_result(&result),
            };
        }
        // A 2025 connection asks in band, then runs the call again with the answer.
        let mut answers = RoundAnswers::default();
        for _ in 0..LEGACY_APPROVAL_ROUNDS {
            let carried = Arc::new(answers);
            let channel = Arc::new(ApprovalRelayChannel::asking(
                name,
                Box::new(move || Some(Arc::clone(&carried))),
            ));
            let result = self.execute_with_relay(name, input.clone(), &channel).await;
            let Some(hold) = channel.held() else {
                return command_result(&result);
            };
            let elicitation = json!({
                "mode": "form",
                "message": hold.message,
                "requestedSchema": confirmations::approval_requested_schema(),
            });
            let Ok(params) = serde_json::from_value(elicitation) else {
                return command_result(&result);
            };
            let Ok(answer) = self.context.peer.create_elicitation(params).await else {
                return command_result(&result);
            };
            let answer = serde_json::to_value(answer).unwrap_or(Value::Null);
            let asked = Asked {
                k: APPROVAL_INPUT_KEY.to_owned(),
                b: hold.binding,
                t: i64::MAX,
                n: Some(hold.nonce),
                x: Some(hold.expires_at),
                m: Some(hold.mac),
            };
            answers = RoundAnswers::default();
            if answer["action"] == "accept" && answer["content"]["approve"] == Value::Bool(true) {
                answers.accepted.push(asked);
            } else {
                answers.declined.push(asked);
            }
        }
        let carried = Arc::new(answers);
        let channel = Arc::new(ApprovalRelayChannel::asking(
            name,
            Box::new(move || Some(Arc::clone(&carried))),
        ));
        command_result(&self.execute_with_relay(name, input, &channel).await)
    }

    async fn execute_with_relay(
        &self,
        name: &str,
        input: Value,
        channel: &Arc<ApprovalRelayChannel>,
    ) -> CommandResult<Value> {
        let mut context = self.execution_context();
        context.approval_relay = Some(Arc::clone(channel));
        self.server
            .inner
            .registry
            .execute(name, input, Some(context))
            .await
    }

    /// The context of a batch's or pipeline's steps: when the request could carry a form
    /// elicitation, a relay channel that never asks, so the approval middleware tells the agent
    /// to call the command on its own.
    fn step_context(&self) -> CommandContext {
        let mut context = self.execution_context();
        if self.can_elicit() {
            context.approval_relay = Some(Arc::new(ApprovalRelayChannel::never_asks()));
        }
        context
    }

    async fn execute(&self, name: &str, input: Value) -> Result<CallToolResponse, ErrorData> {
        let result = self
            .server
            .inner
            .registry
            .execute(name, input, Some(self.execution_context()))
            .await;
        command_result(&result)
    }

    async fn afd_call(&self, args: &Map<String, Value>) -> Result<CallToolResponse, ErrorData> {
        let args = match meta_tools::parse_args(
            "afd-call",
            args,
            "Provide { command: \"command-name\", input: {...} }",
        ) {
            Ok(args) => args,
            Err(error) => return refused(*error),
        };
        let name = args["command"].as_str().unwrap_or_default();
        let Some(command) = self.exposed(name) else {
            // An unexposed command gets the same answer as an unknown one (D4).
            let callable: Vec<String> = self
                .callable()
                .iter()
                .map(|command| command.name.clone())
                .collect();
            return refused(
                CommandError::new(
                    error_codes::COMMAND_NOT_FOUND,
                    format!(
                        "Command '{}' not found",
                        crate::commands::truncate_name(name)
                    ),
                )
                .with_suggestion(crate::commands::not_found_suggestion(name, &callable, true))
                .with_retryable(false),
            );
        };
        if let Some(denied) = self.denial(&command) {
            return denied;
        }
        let input = input_or_empty(args.get("input"));
        self.single(
            &command,
            input,
            flag(&args["confirm"]),
            "repeat the afd-call with confirm: true",
        )
        .await
    }

    fn afd_discover(&self, args: &Map<String, Value>) -> Result<CallToolResponse, ErrorData> {
        match meta_tools::parse_args(
            "afd-discover",
            args,
            "Provide optional { category, tag, tagMode, search, includeMutation, limit, offset }",
        ) {
            Ok(args) => command_result(&meta_tools::discover(&self.callable(), &args)),
            Err(error) => refused(*error),
        }
    }

    fn afd_detail(&self, args: &Map<String, Value>) -> Result<CallToolResponse, ErrorData> {
        match meta_tools::parse_args(
            "afd-detail",
            args,
            "Provide { command: \"command-name\" } or { command: [\"name-1\", \"name-2\"] } (max 10)",
        ) {
            Ok(args) => {
                let commands: Vec<_> = self
                    .callable()
                    .into_iter()
                    .map(|command| {
                        let tool = self.server.command_tool(&command.name);
                        (command, tool)
                    })
                    .collect();
                command_result(&meta_tools::detail(&commands, &args))
            }
            Err(error) => refused(*error),
        }
    }

    async fn afd_batch(&self, args: Map<String, Value>) -> Result<CallToolResponse, ErrorData> {
        const USAGE: &str = "Provide { commands: [...] } with command objects";
        let invalid = |suggestion: String, details: Option<&CommandError>| {
            let mut error = CommandError::new(
                error_codes::INVALID_BATCH_REQUEST,
                "Invalid batch request envelope",
            )
            .with_suggestion(suggestion);
            if let Some(details) = details.and_then(|error| error.details.clone()) {
                error = error.with_details(details);
            }
            batch_failure(error)
        };
        if let Err(error) = meta_tools::check_args("afd-batch", Value::Object(args.clone())) {
            return invalid(
                format!("{}. {USAGE}", meta_tools::usage_prefix(&error)),
                Some(&error),
            );
        }
        let acknowledged = named(args.get("confirm").unwrap_or(&Value::Null));
        // `BatchRequest::context`, which the in-process batch API merges into each item's
        // `extra`, is not an `afd-batch` argument (`spec/meta-tools.json`): declared context
        // fields come only from `_meta` (`spec/context-fields.md`). So a `context` argument is
        // ignored, like any other argument the tool does not declare.
        let mut args = without_confirm(args);
        args.remove("context");
        let request: BatchRequest<Value> = match serde_json::from_value(Value::Object(args)) {
            Ok(request) => request,
            Err(_) => return invalid(USAGE.to_owned(), None),
        };
        let steps: Vec<Step> = request
            .commands
            .iter()
            .map(|item| Step::new(&item.command, input_or_empty(Some(&item.input))))
            .collect();
        if let Some(error) =
            self.task_only_steps(&steps, error_codes::INVALID_BATCH_REQUEST, "batch")
        {
            return batch_failure(error);
        }
        if let Some(error) = self.host_verified_steps(&steps) {
            return batch_failure(error);
        }
        let principal = self.principal();
        let round = self.round(&steps, principal.as_deref());
        match self
            .confirm(
                &steps,
                acknowledged,
                "repeat the afd-batch with confirm: [the command names]",
                &round,
                principal.as_deref(),
            )
            .await
        {
            Decision::Proceed => {}
            Decision::Refuse(error) => return batch_failure(error),
            Decision::Ask(response) => return Ok(response),
            Decision::Internal => return Err(confirmation_internal()),
        }
        let result = self
            .server
            .inner
            .registry
            .execute_batch_with_context(request, self.step_context())
            .await;
        tool_result(&result, !result.success)
    }

    async fn afd_pipe(&self, args: Map<String, Value>) -> Result<CallToolResponse, ErrorData> {
        const USAGE: &str = "Provide steps with nonempty command names, object inputs, valid conditions, and correctly typed options; input must be JSON";
        let invalid = |suggestion: String, details: Option<&CommandError>| {
            let mut error = CommandError::new(
                error_codes::INVALID_PIPELINE_REQUEST,
                "Invalid pipeline request envelope",
            )
            .with_suggestion(suggestion);
            if let Some(details) = details.and_then(|error| error.details.clone()) {
                error = error.with_details(details);
            }
            tool_result(&pipeline_failure(&error), true)
        };
        if let Err(error) = meta_tools::check_args("afd-pipe", Value::Object(args.clone())) {
            return invalid(
                format!("{}. {USAGE}", meta_tools::usage_prefix(&error)),
                Some(&error),
            );
        }
        let acknowledged = named(args.get("confirm").unwrap_or(&Value::Null));
        let request: PipelineRequest =
            match serde_json::from_value(Value::Object(without_confirm(args))) {
                Ok(request) => request,
                Err(_) => return invalid(USAGE.to_owned(), None),
            };
        let steps: Vec<Step> = request
            .steps
            .iter()
            .map(|step| Step::new(&step.command, input_or_empty(step.input.as_ref())))
            .collect();
        if let Some(error) =
            self.task_only_steps(&steps, error_codes::INVALID_PIPELINE_REQUEST, "pipeline")
        {
            return tool_result(&pipeline_failure(&error), true);
        }
        if let Some(error) = self.host_verified_steps(&steps) {
            return tool_result(&pipeline_failure(&error), true);
        }
        let principal = self.principal();
        let round = self.round(&steps, principal.as_deref());
        match self
            .confirm(
                &steps,
                acknowledged,
                "repeat the afd-pipe with confirm: [the command names]",
                &round,
                principal.as_deref(),
            )
            .await
        {
            Decision::Proceed => {}
            Decision::Refuse(error) => return tool_result(&pipeline_failure(&error), true),
            Decision::Ask(response) => return Ok(response),
            Decision::Internal => return Err(confirmation_internal()),
        }
        let registry = Arc::clone(&self.server.inner.registry);
        let base = self.step_context();
        let executor: CommandExecutor = Arc::new(move |command, input, step| {
            let registry = Arc::clone(&registry);
            let mut context = base.clone();
            if let Some(trace) = step.get("traceId").and_then(Value::as_str) {
                context.trace_id = Some(trace.to_owned());
            }
            Box::pin(async move { registry.execute(&command, input, Some(context)).await })
        });
        let result = execute_pipeline(&request, &executor, None).await;
        let failed = result
            .steps
            .iter()
            .any(|step| step.status == crate::StepStatus::Failure);
        tool_result(&result, failed)
    }

    /// A grouped tool call; `None` when `name` is not a group.
    async fn grouped(
        &self,
        name: &str,
        args: &Map<String, Value>,
    ) -> Option<Result<CallToolResponse, ErrorData>> {
        let group_by = self.server.inner.group_by.as_ref();
        let members: Vec<Arc<CommandDefinition>> = self
            .server
            .exposed_commands()
            .into_iter()
            .filter(|command| command_group(command, group_by) == name)
            .collect();
        if let Some(action) = args
            .get("action")
            .and_then(Value::as_str)
            .filter(|a| !a.is_empty())
        {
            let candidates: Vec<&Arc<CommandDefinition>> = members
                .iter()
                .filter(|command| command_action(command) == action)
                .collect();
            let [command] = candidates.as_slice() else {
                let code = if candidates.is_empty() {
                    error_codes::COMMAND_NOT_FOUND
                } else {
                    error_codes::AMBIGUOUS_ACTION
                };
                return Some(refused(
                    CommandError::new(
                        code,
                        format!(
                            "Action '{}' does not identify one command in group '{}'",
                            crate::commands::truncate_name(action),
                            crate::commands::truncate_name(name)
                        ),
                    )
                    .with_suggestion(
                        "Use afd-call with the full command name, or list tools to find a valid action.",
                    ),
                ));
            };
            if let Some(denied) = self.denial(command) {
                return Some(denied);
            }
            let params = input_or_empty(args.get("params"));
            return Some(
                self.single(
                    command,
                    params,
                    flag(args.get("confirm").unwrap_or(&Value::Null)),
                    &format!("repeat the {name} call with confirm: true"),
                )
                .await,
            );
        }
        // A group whose every action the caller may not see looks like a tool that does not
        // exist (`spec/authorization.md`, M6, "Listing").
        let actions: Vec<String> = members
            .iter()
            .filter(|command| self.shows(command))
            .map(|command| command_action(command))
            .collect();
        if actions.is_empty() {
            return None;
        }
        Some(refused(
            CommandError::new(
                error_codes::INVALID_GROUPED_CALL,
                format!("Grouped tool '{name}' requires an 'action' parameter"),
            )
            .with_suggestion(format!(
                "Provide {{ action: \"<action>\", params: {{...}} }}. Available actions: {}",
                actions.join(", ")
            )),
        ))
    }

    /// A call to a command's own tool (in any strategy).
    async fn direct(
        &self,
        name: &str,
        args: Map<String, Value>,
    ) -> Result<CallToolResponse, ErrorData> {
        let command = self.exposed(name);
        if let Some(denied) = command.as_ref().and_then(|command| self.denial(command)) {
            return denied;
        }
        // A confirm-gated tool advertises an optional `confirm` argument, removed here before the
        // command validates its input, unless the command's own schema declares `confirm`. A
        // host-verified command advertises none and accepts none: a `confirm` it receives is input
        // like any other.
        let mut input = args;
        let mut acknowledged = Acknowledgement::None;
        let gated = command
            .as_ref()
            .is_some_and(|command| command.confirm_prompt.is_some() && !command.is_host_verified());
        if gated && self.server.inner.confirmations.mode != confirmations::ConfirmationMode::Off {
            acknowledged = flag(input.get("confirm").unwrap_or(&Value::Null));
            if !confirmations::declares_confirm(self.server.command_tool(name).as_ref()) {
                input.remove("confirm");
            }
        }
        let input = Value::Object(input);
        match command {
            Some(command) => {
                self.single(
                    &command,
                    input,
                    acknowledged,
                    "repeat the call with confirm: true",
                )
                .await
            }
            // Unknown or unexposed: the registry answers, as for any other name.
            None => self.execute(name, input).await,
        }
    }
}

/// The trace ID prefix of the executions `name` routes to, as TypeScript names them.
fn trace_prefix(server: &McpServer, name: &str) -> &'static str {
    match name {
        "afd-call" => "afd-call",
        "afd-batch" => "batch",
        "afd-pipe" => "pipeline",
        _ if server.inner.strategy == ToolStrategy::Grouped
            && server
                .exposed_commands()
                .iter()
                .any(|command| command_group(command, server.inner.group_by.as_ref()) == name) =>
        {
            "trace"
        }
        _ => "mcp",
    }
}

/// Route one `tools/call`.
pub(crate) async fn route(
    server: &McpServer,
    request: &CallToolRequestParams,
    context: &RequestContext<RoleServer>,
) -> Result<CallToolResponse, ErrorData> {
    let name = request.name.as_ref();
    // M1: on a server with authorization, an HTTP request the bearer layer did not verify is
    // refused before anything else runs.
    let credentials = match authz::call_credentials(server, context) {
        Ok(credentials) => credentials,
        Err(error) => return refused(*error),
    };
    // A meta-tool's `meta` argument counts as `_meta` from here on, for the hook, the active
    // context and the declared context fields alike (TypeScript lifts it first too).
    let keys = meta_argument::meta_argument_keys(&server.inner.registry.context_fields());
    let lifted = match meta_argument::lift_meta_argument(
        name,
        request.arguments.as_ref(),
        &context.meta,
        &keys,
    ) {
        Ok(lifted) => lifted,
        Err(error) => return refused(*error),
    };
    let (owned_request, owned_context);
    let (request, context) = match lifted {
        None => (request, context),
        Some(lifted) => {
            let mut params = request.clone();
            params.arguments = lifted.args;
            let mut scoped = context.clone();
            **scoped.meta = lifted.meta;
            owned_request = params;
            owned_context = scoped;
            (&owned_request, &owned_context)
        }
    };
    // The hook runs before anything else but that, so a refused caller reaches neither a confirmation
    // prompt nor the unknown-tool answer.
    let mut base = server
        .base_context()
        .with_trace_id(trace_id(trace_prefix(server, name)));
    // Verified credentials (`spec/authorization.md`, M4): the hook sees them and the actor they
    // map to by default, `{ kind: "agent", id: <clientId>, onBehalfOf: <subject> }`, which also
    // replaces an actor the hook removes.
    let mut defaults = server.inner.context_defaults.clone();
    if let Some(credentials) = &credentials {
        base.credentials = Some(Arc::clone(credentials));
        base.actor = Some(credentials.default_actor());
        defaults.actor = Some(credentials.default_actor());
    }
    let mut base = match context_hook::build_context(
        server.inner.context_hook.as_ref(),
        &defaults,
        name,
        context,
        base,
    )
    .await
    {
        Ok(base) => base,
        Err(error) => return refused(*error),
    };
    // Only the server sets credentials, from the verified request: the hook cannot add, change
    // or drop them.
    base.credentials = credentials;
    // M6 after routing: every call that carries credentials is decided again, after the hook and
    // before the confirmation gate, so a missing scope reaches neither a handler nor a person.
    let args = request.arguments.clone().unwrap_or_default();
    if let Some(error) = authz::call_refusal(server, name, &args, base.credentials.as_deref()) {
        return match name {
            "afd-batch" => batch_failure(error),
            "afd-pipe" => tool_result(&pipeline_failure(&error), true),
            _ => refused(error),
        };
    }
    // The declared context fields from `_meta`, after the hook so a name it set wins. `rmcp`
    // moves `params._meta` into the request context on both eras and both transports.
    context_hook::add_declared_fields(
        &server.inner.registry.context_fields(),
        &context.meta,
        &mut base,
    );
    let scope = server.request_scope(context)?;
    let visible = authz::visibility(server, base.credentials.as_ref());
    let call = Call {
        server,
        request,
        context,
        scope,
        base,
        visible,
    };
    match name {
        "afd-call" => call.afd_call(&args).await,
        "afd-discover" => call.afd_discover(&args),
        "afd-detail" => call.afd_detail(&args),
        "afd-batch" => call.afd_batch(args).await,
        "afd-pipe" => call.afd_pipe(args).await,
        _ => {
            if server.inner.strategy == ToolStrategy::Grouped {
                if let Some(response) = call.grouped(name, &args).await {
                    return response;
                }
            }
            call.direct(name, args).await
        }
    }
}

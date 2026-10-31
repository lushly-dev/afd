//! Tool call routing: the meta-tools, grouped tools and command tools, as TypeScript's tool
//! router dispatches them.
//!
//! The context hook ([`super::context_hook`]) runs first, once per call, before the tool is
//! looked up and before the confirmation gate; a refusal answers the call whatever its name.
//! Every route then ends in [`CommandRegistry::execute`](crate::CommandRegistry::execute)
//! (directly, or for each batch item or pipeline step) with the hook's context, on which the
//! server re-asserts interface `mcp`, the remote flag (under which an unexposed command is
//! indistinguishable from an unknown one, D4), a trace ID, its default actor, clock and random
//! source, and the request's active context, which the hook cannot set. The confirmation gate
//! sees every command a call would run before any of them runs, and the registry's middleware
//! (the approval middleware among them) wraps each execution. No route reaches a command that a
//! direct tool call could not.
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

use crate::contexts::{not_in_context_error, ContextScope};
use crate::{
    error_codes, execute_pipeline, failure, BatchRequest, CommandContext, CommandDefinition,
    CommandError, CommandExecutor, CommandResult, PipelineRequest,
};

use super::confirmations::{self, Acknowledgement, Decision, Step};
use super::context_hook;
use super::meta_tools;
use super::strategy::{command_action, command_group, ToolStrategy};
use super::McpServer;

static TRACE_COUNTER: AtomicU64 = AtomicU64::new(0);

/// A trace ID: `<prefix>-<nanoseconds>-<counter>`.
pub(crate) fn trace_id(prefix: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_nanos());
    let count = TRACE_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}-{nanos:x}-{count}")
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
}

impl Call<'_> {
    fn active(&self) -> Option<String> {
        self.scope.as_ref().and_then(ContextScope::active)
    }

    /// MCP-exposed commands in the active context.
    fn callable(&self) -> Vec<Arc<CommandDefinition>> {
        let active = self.active();
        self.server
            .exposed_commands()
            .into_iter()
            .filter(|command| command.is_accessible_in_context(active.as_deref()))
            .collect()
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
        context.tool_surface = Some(self.server.tool_surface());
        context
    }

    async fn confirm(
        &self,
        steps: &[Step],
        acknowledged: Acknowledgement,
        how_to_acknowledge: &str,
    ) -> Decision {
        let registry = &self.server.inner.registry;
        let channel = confirmations::Channel {
            request: self.request,
            context: self.context,
            legacy_back_channel: self.server.inner.legacy_back_channel,
        };
        confirmations::check(
            &self.server.inner.confirmations,
            steps,
            |name| {
                registry
                    .get(name)
                    .filter(|command| command.expose.mcp)
                    .and_then(|command| command.confirm_prompt.clone())
            },
            acknowledged,
            how_to_acknowledge,
            &channel,
        )
        .await
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
        match self
            .confirm(
                &[Step::new(name, input.clone())],
                flag(&args["confirm"]),
                "repeat the afd-call with confirm: true",
            )
            .await
        {
            Decision::Proceed => self.execute(name, input).await,
            Decision::Refuse(error) => refused(error),
            Decision::Ask(response) => Ok(response),
        }
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
        let request: BatchRequest<Value> =
            match serde_json::from_value(Value::Object(without_confirm(args))) {
                Ok(request) => request,
                Err(_) => return invalid(USAGE.to_owned(), None),
            };
        let steps: Vec<Step> = request
            .commands
            .iter()
            .map(|item| Step::new(&item.command, input_or_empty(Some(&item.input))))
            .collect();
        match self
            .confirm(
                &steps,
                acknowledged,
                "repeat the afd-batch with confirm: [the command names]",
            )
            .await
        {
            Decision::Proceed => {}
            Decision::Refuse(error) => return batch_failure(error),
            Decision::Ask(response) => return Ok(response),
        }
        let result = self
            .server
            .inner
            .registry
            .execute_batch_with_context(request, self.execution_context())
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
        match self
            .confirm(
                &steps,
                acknowledged,
                "repeat the afd-pipe with confirm: [the command names]",
            )
            .await
        {
            Decision::Proceed => {}
            Decision::Refuse(error) => return tool_result(&pipeline_failure(&error), true),
            Decision::Ask(response) => return Ok(response),
        }
        let registry = Arc::clone(&self.server.inner.registry);
        let base = self.execution_context();
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
                match self
                    .confirm(
                        &[Step::new(&command.name, params.clone())],
                        flag(args.get("confirm").unwrap_or(&Value::Null)),
                        &format!("repeat the {name} call with confirm: true"),
                    )
                    .await
                {
                    Decision::Proceed => self.execute(&command.name, params).await,
                    Decision::Refuse(error) => refused(error),
                    Decision::Ask(response) => Ok(response),
                },
            );
        }
        if members.is_empty() {
            return None;
        }
        let actions: Vec<String> = members
            .iter()
            .map(|command| command_action(command))
            .collect();
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
        // command validates its input, unless the command's own schema declares `confirm`.
        let mut input = args;
        let mut acknowledged = Acknowledgement::None;
        let gated = command
            .as_ref()
            .is_some_and(|command| command.confirm_prompt.is_some());
        if gated && self.server.inner.confirmations.mode != confirmations::ConfirmationMode::Off {
            acknowledged = flag(input.get("confirm").unwrap_or(&Value::Null));
            if !confirmations::declares_confirm(self.server.command_tool(name).as_ref()) {
                input.remove("confirm");
            }
        }
        let input = Value::Object(input);
        match self
            .confirm(
                &[Step::new(name, input.clone())],
                acknowledged,
                "repeat the call with confirm: true",
            )
            .await
        {
            Decision::Proceed => self.execute(name, input).await,
            Decision::Refuse(error) => refused(error),
            Decision::Ask(response) => Ok(response),
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
    // The hook runs before anything else, so a refused caller reaches neither a confirmation
    // prompt nor the unknown-tool answer.
    let base = server
        .base_context()
        .with_trace_id(trace_id(trace_prefix(server, name)));
    let base = match context_hook::build_context(
        server.inner.context_hook.as_ref(),
        &server.inner.context_defaults,
        name,
        context,
        base,
    )
    .await
    {
        Ok(base) => base,
        Err(error) => return refused(*error),
    };
    let scope = server.request_scope(context)?;
    let call = Call {
        server,
        request,
        context,
        scope,
        base,
    };
    let args = request.arguments.clone().unwrap_or_default();
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

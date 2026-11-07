//! What a call needs, and which commands a request names (`spec/authorization.md`, M6).

use std::sync::Arc;

use serde_json::{json, Map, Value};

use crate::credentials::Credentials;
use crate::CommandDefinition;

use super::super::strategy::{command_action, command_group, ToolStrategy};
use super::super::McpServer;
use super::Authorization;

/// A scope decision for one call (`spec/authorization.md`, M6).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScopeDecision {
    /// The credentials hold every scope the call needs.
    Allowed,
    /// The call lacks these scopes, in the decider's order. Each must be a scope token.
    Missing(Vec<String>),
    /// Let the call through, so the registry answers it: for when naming a scope would reveal
    /// something (a space the caller may not read, for example).
    Defer,
}

/// A host's per-call scope rule, installed with
/// [`Authorization::with_resolver`](super::Authorization::with_resolver). It decides every call
/// instead of the static rule (a command's `scopes`); the server's required scopes still apply
/// to every request.
pub trait ScopeResolver: Send + Sync {
    /// Decide a call of `command` with `input` (the arguments as sent, before validation). For a
    /// tool that names no command (`afd-discover`, `afd-detail`, an unknown tool, a grouped call
    /// that resolves to no command), `command` is the tool's own name and `input` its arguments.
    fn resolve(&self, command: &str, input: &Value, credentials: &Credentials) -> ScopeDecision;

    /// Whether the caller may see `command` on the listings (`tools/list`, `afd-discover`,
    /// `afd-detail`, `afd-help`, `afd-docs`, `afd-schema` and grouped actions), when the server
    /// filters them ([`Authorization::with_filter_tools_by_scope`](super::Authorization::with_filter_tools_by_scope)).
    fn visible(&self, command: &str, credentials: &Credentials) -> bool;
}

/// The static rule (`spec/authorization.md`, M6): a call needs `required` (the server's required
/// scopes), then the command's `scopes`, without repeats. It is [`ScopeDecision::Allowed`] when
/// `held` holds each one exactly, else [`ScopeDecision::Missing`] with those not held, in that
/// order. It never defers.
pub fn static_decision(required: &[String], scopes: &[String], held: &[String]) -> ScopeDecision {
    let mut missing: Vec<String> = Vec::new();
    for scope in required.iter().chain(scopes) {
        if !held.contains(scope) && !missing.contains(scope) {
            missing.push(scope.clone());
        }
    }
    if missing.is_empty() {
        ScopeDecision::Allowed
    } else {
        ScopeDecision::Missing(missing)
    }
}

/// The missing scopes of a whole request whose steps were decided `decisions`
/// (`spec/authorization.md`, M6): every missing scope of every step, each once, in step order.
/// Empty when no step is [`ScopeDecision::Missing`], so the request proceeds and any
/// [`ScopeDecision::Defer`] step is answered by the registry.
pub fn forbidden_scopes(decisions: &[ScopeDecision]) -> Vec<String> {
    let mut missing: Vec<String> = Vec::new();
    for decision in decisions {
        if let ScopeDecision::Missing(scopes) = decision {
            for scope in scopes {
                if !missing.contains(scope) {
                    missing.push(scope.clone());
                }
            }
        }
    }
    missing
}

/// One call a request names.
#[derive(Debug)]
pub(crate) enum Named {
    /// A command name (registered or not) and its input as sent.
    Command(String, Value),
    /// A tool that names no command: its own name and its arguments.
    Tool(String, Value),
}

fn input_or_empty(value: Option<&Value>) -> Value {
    match value {
        None | Some(Value::Null) => json!({}),
        Some(value) => value.clone(),
    }
}

/// The steps of `afd-batch` (`commands`) or `afd-pipe` (`steps`): every step's command and input,
/// or `None` when the list is missing, empty, or holds a step without a command name (the router
/// then refuses the whole request).
fn steps(list: Option<&Value>) -> Option<Vec<Named>> {
    let items = list?.as_array().filter(|items| !items.is_empty())?;
    items
        .iter()
        .map(|item| {
            let command = item.get("command")?.as_str()?;
            Some(Named::Command(
                command.to_owned(),
                input_or_empty(item.get("input")),
            ))
        })
        .collect()
}

/// The calls a `tools/call` of `tool` with `args` names, resolved as the router resolves them
/// (`spec/authorization.md`, M6, "Which commands a request names").
///
/// A grouped call that resolves to no single command (no action, an unknown or ambiguous one) is
/// decided under the grouped tool's own name, as a tool that names no command, so it still needs
/// the server's required scopes.
pub(crate) fn named_calls(server: &McpServer, tool: &str, args: &Map<String, Value>) -> Vec<Named> {
    let own = || vec![Named::Tool(tool.to_owned(), Value::Object(args.clone()))];
    match tool {
        "afd-call" => match args.get("command").and_then(Value::as_str) {
            Some(command) => vec![Named::Command(
                command.to_owned(),
                input_or_empty(args.get("input")),
            )],
            None => own(),
        },
        "afd-batch" => steps(args.get("commands")).unwrap_or_else(own),
        "afd-pipe" => steps(args.get("steps")).unwrap_or_else(own),
        "afd-discover" | "afd-detail" => own(),
        _ => {
            if server.inner.strategy == ToolStrategy::Grouped {
                let group_by = server.inner.group_by.as_ref();
                let members: Vec<Arc<CommandDefinition>> = server
                    .exposed_commands()
                    .into_iter()
                    .filter(|command| command_group(command, group_by) == tool)
                    .collect();
                if let Some(action) = args
                    .get("action")
                    .and_then(Value::as_str)
                    .filter(|action| !action.is_empty())
                {
                    let candidates: Vec<&Arc<CommandDefinition>> = members
                        .iter()
                        .filter(|command| command_action(command) == action)
                        .collect();
                    return match candidates.as_slice() {
                        [command] => vec![Named::Command(
                            command.name.clone(),
                            input_or_empty(args.get("params")),
                        )],
                        _ => own(),
                    };
                }
                if !members.is_empty() {
                    return own();
                }
            }
            vec![Named::Command(tool.to_owned(), Value::Object(args.clone()))]
        }
    }
}

/// The scopes of an MCP-exposed command; none for an unknown or unexposed one, so that a scope
/// never reveals a command a remote caller cannot see (`spec/error-codes.md`, D4).
fn exposed_scopes(server: &McpServer, name: &str) -> Vec<String> {
    server
        .inner
        .registry
        .get(name)
        .filter(|command| command.expose.mcp)
        .and_then(|command| command.scopes.clone())
        .unwrap_or_default()
}

/// Decide one named call: the server's required scopes, then the resolver's decision when one is
/// installed, else the command's own scopes.
pub(crate) fn decide(
    server: &McpServer,
    auth: &Authorization,
    call: &Named,
    credentials: &Credentials,
) -> ScopeDecision {
    let required = static_decision(&auth.required_scopes, &[], &credentials.scopes);
    let (name, input, command) = match call {
        Named::Command(name, input) => (name, input, true),
        Named::Tool(name, input) => (name, input, false),
    };
    let decision = match &auth.resolver {
        Some(resolver) => resolver.resolve(name, input, credentials),
        None if command => static_decision(&[], &exposed_scopes(server, name), &credentials.scopes),
        None => ScopeDecision::Allowed,
    };
    match (required, decision) {
        (ScopeDecision::Missing(mut missing), ScopeDecision::Missing(more)) => {
            for scope in more {
                if !missing.contains(&scope) {
                    missing.push(scope);
                }
            }
            ScopeDecision::Missing(missing)
        }
        (ScopeDecision::Missing(missing), _) => ScopeDecision::Missing(missing),
        (_, decision) => decision,
    }
}

/// The missing scopes of a `tools/call` of `tool` with `args`, in step order; empty to proceed.
pub(crate) fn call_missing(
    server: &McpServer,
    auth: &Authorization,
    tool: &str,
    args: &Map<String, Value>,
    credentials: &Credentials,
) -> Vec<String> {
    let decisions: Vec<ScopeDecision> = named_calls(server, tool, args)
        .iter()
        .map(|call| decide(server, auth, call, credentials))
        .collect();
    forbidden_scopes(&decisions)
}

/// The missing required scopes of a request that names no command (`tools/list`,
/// `server/discover`, `resources/*`, `initialize` and every other method).
pub(crate) fn request_missing(auth: &Authorization, credentials: &Credentials) -> Vec<String> {
    match static_decision(&auth.required_scopes, &[], &credentials.scopes) {
        ScopeDecision::Missing(missing) => missing,
        _ => Vec::new(),
    }
}

/// Whether the caller may see `command` on the listings: the server's required scopes are held,
/// and the resolver's `visible` holds (under the static rule: every scope of the command is
/// held).
pub(crate) fn visible(
    auth: &Authorization,
    command: &CommandDefinition,
    credentials: &Credentials,
) -> bool {
    if !request_missing(auth, credentials).is_empty() {
        return false;
    }
    match &auth.resolver {
        Some(resolver) => resolver.visible(&command.name, credentials),
        None => command
            .scopes
            .iter()
            .flatten()
            .all(|scope| credentials.has_scope(scope)),
    }
}

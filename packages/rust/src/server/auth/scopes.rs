//! What a call needs, and which commands a request names (`spec/authorization.md`, M6).

use std::sync::Arc;

use serde_json::{json, Map, Value};

use crate::credentials::{is_scope_token, Credentials};
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
///
/// # Two phases
///
/// `resolve` is asked twice for a call that runs a command (`spec/authorization.md`, M6):
///
/// 1. **Before dispatch**, on the arguments **as sent**: by the bearer layer for the 403, and
///    again after the context hook. The input is not validated yet, defaults are not applied,
///    and an `afd-pipe` step's `$prev` references are unresolved. This is the early answer that
///    lets a client step up its token; it cannot see the values the command will run with.
/// 2. **At execution**, by the registry, for every command it runs with credentials (each batch
///    item, each pipeline step, nested calls that pass their context on), on the **validated**
///    input, with defaults applied and pipeline references resolved. `Missing` there fails the
///    command with `INSUFFICIENT_SCOPE` before the middleware and the handler run.
///
/// So a rule keyed on an argument holds even when the caller leaves the argument out (a default
/// supplies it) or draws it from a previous step. Both phases must agree for the same input, so
/// decide on the values, not on whether they were sent. `Missing` must name scope tokens: an
/// empty list, or a name that is not one, still refuses the call (it is logged as the
/// resolver's mistake and left out of the challenge).
pub trait ScopeResolver: Send + Sync {
    /// Decide a call of `command` with `input`: the arguments as sent before dispatch, the
    /// validated input at execution (see [the two phases](ScopeResolver#two-phases)). For a tool
    /// that names no command (`afd-discover`, `afd-detail`, a grouped call that resolves to no
    /// command), `command` is the tool's own name and `input` its arguments; that is decided
    /// before dispatch only. It is never asked about a command name that does not exist for the
    /// caller (unknown, not exposed to MCP, or not [`known`](ScopeResolver::known)): such a call
    /// needs the server's required scopes alone, and the registry answers it as an unknown name.
    fn resolve(&self, command: &str, input: &Value, credentials: &Credentials) -> ScopeDecision;

    /// Whether the caller may see `command` on the listings (`tools/list`, `afd-discover`,
    /// `afd-detail`, `afd-help`, `afd-docs`, `afd-schema` and grouped actions), when the server
    /// filters them ([`Authorization::with_filter_tools_by_scope`](super::Authorization::with_filter_tools_by_scope)).
    /// A command is listed only when it is also [`known`](ScopeResolver::known).
    ///
    /// It must be a pure function of `command` and `credentials`: the same answer for the same
    /// arguments, on every route and at any point of a request.
    fn visible(&self, command: &str, credentials: &Credentials) -> bool;

    /// Whether `command` exists for the caller at all, when the server filters listings
    /// (`spec/authorization.md`, M6, "Hidden commands"). A command it is not known to is answered
    /// exactly as a name that does not exist, on every route and before anything else looks at
    /// the call: its own tool, a hybrid first-class tool, a grouped action, `afd-call`, every
    /// `afd-batch` and `afd-pipe` step, and the describing tools. No input validation,
    /// middleware, confirmation, relay or task sees it. A command it is known to but not
    /// [`visible`](ScopeResolver::visible) to is left off the listings, and a call of it is
    /// decided by [`resolve`](ScopeResolver::resolve) as before, so the caller can be told which
    /// scope to obtain.
    ///
    /// The default is [`visible`](ScopeResolver::visible): a command the caller cannot list does
    /// not exist for it. Override it to keep a command that can be stepped up to (a missing
    /// scope the caller may be told about) known while it is not listed.
    ///
    /// It must be a pure function of `command` and `credentials`, as `visible` is. AFD never asks
    /// [`resolve`](ScopeResolver::resolve) about a command the caller does not know, as it never
    /// asks about a name that does not exist: both need the server's required scopes alone.
    fn known(&self, command: &str, credentials: &Credentials) -> bool {
        self.visible(command, credentials)
    }
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

/// What a whole request gets from the decisions on its steps (`spec/authorization.md`, M6).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RequestDecision {
    /// No step is [`ScopeDecision::Missing`]: the request proceeds, and any
    /// [`ScopeDecision::Defer`] step is answered by the registry.
    Proceed,
    /// At least one step is [`ScopeDecision::Missing`]: the whole request is refused, naming
    /// every missing scope of every step, each once, in step order. The list holds only scope
    /// tokens, so it is empty when a resolver answered `Missing` without naming one it could
    /// name: the request is refused all the same.
    Forbidden(Vec<String>),
}

/// The decision on a whole request whose steps were decided `decisions`
/// (`spec/authorization.md`, M6). Any [`ScopeDecision::Missing`] refuses the request, even one
/// that names no scope or a name that is not a scope token (a resolver's mistake, logged at
/// `warn` without the call's input and left out of the list): it never proceeds.
pub fn request_decision(decisions: &[ScopeDecision]) -> RequestDecision {
    let mut refused = false;
    let mut missing: Vec<String> = Vec::new();
    for decision in decisions {
        let ScopeDecision::Missing(scopes) = decision else {
            continue;
        };
        refused = true;
        if scopes.is_empty() || scopes.iter().any(|scope| !is_scope_token(scope)) {
            tracing::warn!(
                target: "afd::auth",
                "a scope decision answered Missing without valid scope names; the call is refused"
            );
        }
        for scope in scopes.iter().filter(|scope| is_scope_token(scope)) {
            if !missing.contains(scope) {
                missing.push(scope.clone());
            }
        }
    }
    if refused {
        RequestDecision::Forbidden(missing)
    } else {
        RequestDecision::Proceed
    }
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
///
/// `known` says which commands exist for the caller (`spec/authorization.md`, M6, "Hidden
/// commands"): a grouped action naming one it does not is resolved as an unknown action, and a
/// group whose every member it does not is a tool that does not exist, as the router answers
/// them.
pub(crate) fn named_calls(
    server: &McpServer,
    tool: &str,
    args: &Map<String, Value>,
    known: &dyn Fn(&CommandDefinition) -> bool,
) -> Vec<Named> {
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
                    .filter(|command| known(command))
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

/// The command named `name` when it exists for the caller: registered, exposed to MCP and not
/// hidden from it (`spec/authorization.md`, M6, "Hidden commands"). `None` for any other name,
/// which is decided as a name that does not exist (`spec/error-codes.md`, D4).
fn known_command(
    server: &McpServer,
    auth: &Authorization,
    name: &str,
    credentials: &Credentials,
) -> Option<Arc<CommandDefinition>> {
    server
        .inner
        .registry
        .get(name)
        .filter(|command| command.expose.mcp && knows(auth, name, credentials))
}

/// Decide one named call: the server's required scopes, then, for a command that exists for the
/// caller, the resolver's decision when one is installed, else the command's own scopes; for a
/// tool that names no command, the resolver's decision on the tool. A command name that does not
/// exist for the caller (unknown, unexposed or hidden) is decided on the required scopes alone:
/// the resolver is never asked about it, so no resolver can answer a hidden command otherwise
/// than a name that does not exist.
pub(crate) fn decide(
    server: &McpServer,
    auth: &Authorization,
    call: &Named,
    credentials: &Credentials,
) -> ScopeDecision {
    let required = static_decision(&auth.required_scopes, &[], &credentials.scopes);
    let decision = match call {
        Named::Command(name, input) => match known_command(server, auth, name, credentials) {
            None => ScopeDecision::Allowed,
            Some(command) => match &auth.resolver {
                Some(resolver) => resolver.resolve(name, input, credentials),
                None => static_decision(
                    &[],
                    command.scopes.as_deref().unwrap_or_default(),
                    &credentials.scopes,
                ),
            },
        },
        Named::Tool(name, input) => match &auth.resolver {
            Some(resolver) => resolver.resolve(name, input, credentials),
            None => ScopeDecision::Allowed,
        },
    };
    merge(required, decision)
}

/// The decision on a `tools/call` of `tool` with `args`, over every call it names.
pub(crate) fn call_decision(
    server: &McpServer,
    auth: &Authorization,
    tool: &str,
    args: &Map<String, Value>,
    credentials: &Credentials,
) -> RequestDecision {
    let known = |command: &CommandDefinition| knows(auth, &command.name, credentials);
    let decisions: Vec<ScopeDecision> = named_calls(server, tool, args, &known)
        .iter()
        .map(|call| decide(server, auth, call, credentials))
        .collect();
    request_decision(&decisions)
}

/// The decision on one command about to run, at execute time: the validated input, with
/// defaults applied and pipeline references resolved (`spec/authorization.md`, M6, "At
/// execution"). Only a resolver can depend on the input, so only it is asked again, after the
/// required scopes.
pub(crate) fn execution_decision(
    auth: &Authorization,
    command: &str,
    input: &Value,
    credentials: &Credentials,
) -> RequestDecision {
    let Some(resolver) = &auth.resolver else {
        return RequestDecision::Proceed;
    };
    let required = static_decision(&auth.required_scopes, &[], &credentials.scopes);
    let decision = merge(required, resolver.resolve(command, input, credentials));
    request_decision(&[decision])
}

/// The required scopes' decision, then a call's own.
fn merge(required: ScopeDecision, decision: ScopeDecision) -> ScopeDecision {
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

/// The decision on a request that names no command (`tools/list`, `server/discover`,
/// `resources/*`, `initialize` and every other method): the required scopes.
pub(crate) fn request_missing(auth: &Authorization, credentials: &Credentials) -> RequestDecision {
    request_decision(&[static_decision(
        &auth.required_scopes,
        &[],
        &credentials.scopes,
    )])
}

/// Whether the caller may see `command` on the listings: the server's required scopes are held,
/// and the resolver's `visible` and `known` hold (under the static rule: every scope of the
/// command is held).
pub(crate) fn visible(
    auth: &Authorization,
    command: &CommandDefinition,
    credentials: &Credentials,
) -> bool {
    if request_missing(auth, credentials) != RequestDecision::Proceed {
        return false;
    }
    match &auth.resolver {
        Some(resolver) => {
            resolver.visible(&command.name, credentials)
                && resolver.known(&command.name, credentials)
        }
        None => command
            .scopes
            .iter()
            .flatten()
            .all(|scope| credentials.has_scope(scope)),
    }
}

/// The resolver that may hide commands from a caller (`spec/authorization.md`, M6, "Hidden
/// commands"): only one on a server that filters its listings does.
pub(crate) fn hider(auth: &Authorization) -> Option<&Arc<dyn ScopeResolver>> {
    auth.resolver
        .as_ref()
        .filter(|_| auth.filter_tools_by_scope)
}

/// Whether the command named `command` exists for the caller (M6, "Hidden commands"): every
/// command does unless [`hider`] says otherwise.
pub(crate) fn knows(auth: &Authorization, command: &str, credentials: &Credentials) -> bool {
    hider(auth).is_none_or(|resolver| resolver.known(command, credentials))
}

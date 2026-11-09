//! Command definition and registry types.
//!
//! Commands are the core abstraction in AFD. Every application action
//! is defined as a command with a clear schema.

use async_trait::async_trait;
use futures_util::{stream::FuturesUnordered, FutureExt, StreamExt};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;
use std::future::Future;
use std::panic::AssertUnwindSafe;
use std::pin::Pin;
use std::sync::{Arc, OnceLock, PoisonError, RwLock, RwLockReadGuard, RwLockWriteGuard};
use std::time::Duration;

use crate::actor::{with_context_defaults, Actor, ContextDefaults};
use crate::approval::{approval_mode, ApprovalPolicy};
use crate::batch::{
    create_batch_result, create_failed_batch_result, BatchCommandResult, BatchRequest, BatchResult,
    BatchTiming,
};
use crate::clock::{Clock, RandomSource, SYSTEM_CLOCK, SYSTEM_RANDOM};
use crate::context_fields::{apply_context_fields, check_context_fields, ContextField};
use crate::credentials::Credentials;
use crate::errors::{error_codes, CommandError};
use crate::handoff::HandoffCommandLike;
use crate::journal::{JournalContextState, JournalRecorder};
use crate::result::{execution_failure, failure, CommandResult, ResultMetadata};
use crate::time::Instant;
use crate::validation::validate_input;

type BatchExecutionFuture<'a> =
    Pin<Box<dyn Future<Output = (usize, BatchCommandResult<serde_json::Value>)> + Send + 'a>>;

// ═══════════════════════════════════════════════════════════════════════════════
// COMMAND NAME VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

fn command_name_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r"^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)+$")
            .expect("command name regex should be valid")
    })
}

/// Validate that a command name follows the `domain-action` kebab-case convention.
pub fn validate_command_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("Command name must not be empty".to_string());
    }

    if !command_name_pattern().is_match(name) {
        return Err(format!(
            "Command name '{name}' must use kebab-case with at least two segments (e.g., 'domain-action')."
        ));
    }

    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════════
// JSON SCHEMA TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/// JSON Schema type for command parameter validation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum JsonSchemaType {
    String,
    Number,
    Boolean,
    Object,
    Array,
    Null,
    Integer,
}

/// JSON Schema subset for command parameter validation.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct JsonSchema {
    /// The type of the value.
    #[serde(rename = "type")]
    pub schema_type: Option<JsonSchemaType>,

    /// Human-readable description.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    /// For object schemas, required property names.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required: Option<Vec<String>>,

    /// Default value.
    #[serde(
        default,
        deserialize_with = "crate::schema_legacy::deserialize_present_value",
        skip_serializing_if = "Option::is_none"
    )]
    pub default: Option<serde_json::Value>,

    /// Allowed values (enum).
    #[serde(rename = "enum", skip_serializing_if = "Option::is_none")]
    pub enum_values: Option<Vec<serde_json::Value>>,

    /// Schema for array items.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub items: Option<Box<JsonSchema>>,

    /// Properties for object schemas.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub properties: Option<HashMap<String, JsonSchema>>,

    /// Additional properties schema.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub additional_properties: Option<Box<JsonSchema>>,

    /// Minimum value for numbers.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub minimum: Option<f64>,

    /// Maximum value for numbers.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub maximum: Option<f64>,

    /// Minimum length for strings/arrays.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_length: Option<usize>,

    /// Maximum length for strings/arrays.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_length: Option<usize>,

    /// Regex pattern for strings.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pattern: Option<String>,

    /// Format hint (e.g., "date", "email").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMMAND PARAMETER
// ═══════════════════════════════════════════════════════════════════════════════

/// Definition for a single command parameter.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandParameter {
    /// Parameter name.
    pub name: String,

    /// JSON Schema type.
    #[serde(rename = "type")]
    pub param_type: JsonSchemaType,

    /// Human-readable description.
    pub description: String,

    /// Whether this parameter is required.
    #[serde(default)]
    pub required: bool,

    /// Default value if not provided.
    #[serde(
        default,
        deserialize_with = "crate::schema_legacy::deserialize_present_value",
        skip_serializing_if = "Option::is_none"
    )]
    pub default: Option<serde_json::Value>,

    /// For enum types, the allowed values.
    #[serde(rename = "enum", skip_serializing_if = "Option::is_none")]
    pub enum_values: Option<Vec<serde_json::Value>>,

    /// Full JSON Schema for complex validation.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schema: Option<JsonSchema>,
}

impl CommandParameter {
    /// Create a new required string parameter.
    pub fn required_string(name: &str, description: &str) -> Self {
        Self {
            name: name.to_string(),
            param_type: JsonSchemaType::String,
            description: description.to_string(),
            required: true,
            default: None,
            enum_values: None,
            schema: None,
        }
    }

    /// Create a new optional string parameter.
    pub fn optional_string(name: &str, description: &str) -> Self {
        Self {
            name: name.to_string(),
            param_type: JsonSchemaType::String,
            description: description.to_string(),
            required: false,
            default: None,
            enum_values: None,
            schema: None,
        }
    }

    /// Create a new required number parameter.
    pub fn required_number(name: &str, description: &str) -> Self {
        Self {
            name: name.to_string(),
            param_type: JsonSchemaType::Number,
            description: description.to_string(),
            required: true,
            default: None,
            enum_values: None,
            schema: None,
        }
    }

    /// Create a new required boolean parameter.
    pub fn required_boolean(name: &str, description: &str) -> Self {
        Self {
            name: name.to_string(),
            param_type: JsonSchemaType::Boolean,
            description: description.to_string(),
            required: true,
            default: None,
            enum_values: None,
            schema: None,
        }
    }

    /// Set a default value.
    pub fn with_default(mut self, default: serde_json::Value) -> Self {
        self.default = Some(default);
        self
    }

    /// Set enum values.
    pub fn with_enum(mut self, values: Vec<serde_json::Value>) -> Self {
        self.enum_values = Some(values);
        self
    }
}

/// A concrete input example for a command.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommandExample<T = serde_json::Value> {
    /// Short description of what this example demonstrates.
    pub title: String,

    /// A valid input payload.
    pub input: T,
}

impl<T> CommandExample<T> {
    /// Create a new command example.
    pub fn new(title: impl Into<String>, input: T) -> Self {
        Self {
            title: title.into(),
            input,
        }
    }
}

/// An interface that invokes commands. Each has a flag in [`ExposeOptions`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CommandInterface {
    /// Command palette (exposed by default).
    Palette,
    /// External MCP agents (opt-in).
    Mcp,
    /// In-app AI assistant (exposed by default).
    Agent,
    /// Terminal/CLI (opt-in).
    Cli,
}

impl CommandInterface {
    /// The interface name, as used for the `expose` keys.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Palette => "palette",
            Self::Mcp => "mcp",
            Self::Agent => "agent",
            Self::Cli => "cli",
        }
    }
}

impl fmt::Display for CommandInterface {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Controls which interfaces a command is exposed to.
///
/// A flag that is left out takes its own default, as in TypeScript's
/// `isExposedTo`: `palette` and `agent` default to `true`, `mcp` and `cli` to
/// `false`. So `{"mcp": true}` deserializes to palette, agent and MCP
/// exposure, the same as `ExposeOptions::new().with_mcp(true)`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExposeOptions {
    /// Command palette (default `true`).
    #[serde(default = "default_true")]
    pub palette: bool,
    /// External MCP agents (default `false`: opt in).
    #[serde(default = "default_false")]
    pub mcp: bool,
    /// In-app AI assistant (default `true`).
    #[serde(default = "default_true")]
    pub agent: bool,
    /// Terminal/CLI (default `false`: opt in).
    #[serde(default = "default_false")]
    pub cli: bool,
}

impl ExposeOptions {
    /// The default exposure: palette and agent, not MCP or CLI.
    pub fn new() -> Self {
        Self::default()
    }

    /// Set palette exposure.
    pub fn with_palette(mut self, exposed: bool) -> Self {
        self.palette = exposed;
        self
    }

    /// Set MCP exposure.
    pub fn with_mcp(mut self, exposed: bool) -> Self {
        self.mcp = exposed;
        self
    }

    /// Set in-app agent exposure.
    pub fn with_agent(mut self, exposed: bool) -> Self {
        self.agent = exposed;
        self
    }

    /// Set CLI exposure.
    pub fn with_cli(mut self, exposed: bool) -> Self {
        self.cli = exposed;
        self
    }

    /// Whether these options expose a command to `interface`.
    pub fn is_exposed_to(&self, interface: CommandInterface) -> bool {
        match interface {
            CommandInterface::Palette => self.palette,
            CommandInterface::Mcp => self.mcp,
            CommandInterface::Agent => self.agent,
            CommandInterface::Cli => self.cli,
        }
    }
}

const fn default_true() -> bool {
    true
}

const fn default_false() -> bool {
    false
}

impl Default for ExposeOptions {
    fn default() -> Self {
        Self {
            palette: true,
            mcp: false,
            agent: true,
            cli: false,
        }
    }
}

/// Return the default command exposure configuration.
pub fn default_expose() -> ExposeOptions {
    ExposeOptions::default()
}

/// Whether `command` is exposed to `interface` (TypeScript `isExposedTo`).
pub fn is_exposed_to(command: &CommandDefinition, interface: CommandInterface) -> bool {
    command.expose.is_exposed_to(interface)
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMMAND CONTEXT
// ═══════════════════════════════════════════════════════════════════════════════

/// How an MCP server lists its tools, for `afd-help` (`spec/tool-strategies.md`, H8). Only the
/// MCP server sets it, so `afd-help` run in process reports none of it.
#[derive(Clone, Debug)]
pub(crate) struct ToolSurface {
    pub(crate) strategy: &'static str,
    /// The first-class tool names in list order, on a hybrid server.
    pub(crate) first_class_tools: Option<Arc<Vec<String>>>,
    /// Which commands the caller may see on the describing surfaces (`afd-help`, `afd-docs`,
    /// `afd-schema`), when the server filters listings by scope (`spec/authorization.md`, M6).
    pub(crate) visible: Option<Visibility>,
}

/// A filter the MCP server sets for one request (which commands the caller may list, or which
/// exist for it): the names it admits, decided once when the request arrives.
#[derive(Clone)]
pub(crate) struct Visibility(pub(crate) Arc<std::collections::HashSet<String>>);

impl Visibility {
    pub(crate) fn allows(&self, command: &CommandDefinition) -> bool {
        self.0.contains(&command.name)
    }

    pub(crate) fn allows_name(&self, name: &str) -> bool {
        self.0.contains(name)
    }

    /// `names` without those it does not admit, in order: a command's `requires` as this caller
    /// may read it (`spec/authorization.md`, M6, "Hidden commands").
    pub(crate) fn admitted(&self, names: &[String]) -> Vec<String> {
        names
            .iter()
            .filter(|name| self.allows_name(name))
            .cloned()
            .collect()
    }
}

/// The execute-time scope decision an authorized MCP server sets for a caller with credentials
/// when a host resolver is installed (`spec/authorization.md`, M6, "At execution"): asked with
/// the command, its validated input and the credentials; `Some` refuses the call before the
/// middleware and the handler run.
#[derive(Clone)]
pub(crate) struct ScopeCheck(pub(crate) Arc<ScopeCheckFn>);

/// What a [`ScopeCheck`] calls.
pub(crate) type ScopeCheckFn =
    dyn Fn(&str, &serde_json::Value, &Credentials) -> Option<CommandError> + Send + Sync;

impl fmt::Debug for ScopeCheck {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("ScopeCheck(..)")
    }
}

impl fmt::Debug for Visibility {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Visibility(..)")
    }
}

/// Context provided to command handlers.
///
/// Build it with [`CommandContext::new`] and the `with_*` methods.
#[derive(Clone, Default)]
#[non_exhaustive]
pub struct CommandContext {
    /// Unique ID for this command invocation.
    pub trace_id: Option<String>,

    /// Deadline for the command in milliseconds.
    ///
    /// [`CommandRegistry::execute`] enforces it with `tokio::time::timeout`
    /// (the `native` feature, inside a Tokio runtime with time enabled) and
    /// returns `TIMEOUT` when it passes. Without `native`, a context with a
    /// timeout is rejected with `UNSUPPORTED_OPTION` before the handler runs.
    pub timeout_ms: Option<u64>,

    /// The interface invoking the command.
    ///
    /// When set, [`CommandRegistry::execute`] rejects commands that are not
    /// exposed to it with `COMMAND_NOT_EXPOSED`. Leave it unset for trusted
    /// in-process calls.
    pub interface: Option<CommandInterface>,

    /// Who is calling: a human, an agent, a service, a script or a test.
    ///
    /// The MCP server (feature `server`) sets `agent` unless configured otherwise. When it is
    /// set, [`CommandRegistry::execute`] reports its kind as `metadata.actorKind` on the
    /// handler's result (never the id).
    pub actor: Option<Actor>,

    /// The verified claims of the request's access token, on a server configured with
    /// authorization (`spec/authorization.md`, M4; the `server-auth` feature). Only the server
    /// sets it, from a verified request, never from tool arguments, `_meta` or a header; the
    /// context hook sees it and cannot change it. In process it is absent unless trusted host
    /// code sets it ([`CommandContext::with_credentials`]). It never holds the raw token, is not
    /// journaled, and prints redacted.
    pub credentials: Option<Arc<Credentials>>,

    /// Approval evidence for a command whose approval policy requires it: the
    /// `details.approvalToken` of an `APPROVAL_REQUIRED` result, set by the surface once a human
    /// approved (`spec/command-metadata.md`, "Approvals"). Only trusted surface code sets it,
    /// never tool arguments: whoever holds a valid token can run the call. The MCP server never
    /// sets it.
    pub approval: Option<String>,

    /// Source of the current time. Read time from [`CommandContext::clock`] instead of the
    /// system time so tests and replays can control it.
    ///
    /// [`CommandRegistry::execute`] always sets it for the handler (to
    /// [`SYSTEM_CLOCK`] unless the caller set one).
    pub clock: Option<Arc<dyn Clock>>,

    /// Source of randomness. Read random numbers from [`CommandContext::random`] so tests
    /// and replays can seed them.
    ///
    /// [`CommandRegistry::execute`] always sets it for the handler (to
    /// [`SYSTEM_RANDOM`] unless the caller set one).
    pub random: Option<Arc<dyn RandomSource>>,

    /// Custom context values.
    pub extra: HashMap<String, serde_json::Value>,

    /// What a journal recorder and replay pass to nested calls.
    pub(crate) journal_state: JournalContextState,
    pub(crate) direct_approval: Option<Arc<std::sync::Mutex<crate::direct::Exchange>>>,
    /// The active-context state: a session stack, one request's context, or no session.
    pub(crate) context_scope: Option<crate::contexts::ContextScope>,
    /// A remote MCP caller: an unexposed command looks unknown, and recovery points to
    /// `afd-discover` (`spec/error-codes.md`, D4). Only the MCP server sets it.
    pub(crate) remote: bool,
    /// How the MCP server lists its tools: read by `afd-help`. Only the MCP server sets it.
    pub(crate) tool_surface: Option<ToolSurface>,
    /// Which commands exist for the caller (`spec/authorization.md`, M6, "Hidden commands"):
    /// one it rejects is looked up as a name that does not exist, before anything else, by every
    /// execution under this context (batch items, pipeline steps, nested calls that pass the
    /// context on). Only the MCP server sets it.
    pub(crate) known: Option<Visibility>,
    /// The caller's output budget ask (`spec/output-budgets.md`, B2) in its `_meta` form,
    /// `{ "maxBytes": n }`, not yet validated: [`CommandRegistry::execute`] checks it after the
    /// declared context fields. Set in process by [`CommandContext::with_output_budget_ask`], and
    /// by the MCP server from `_meta["dev.afd/outputBudget"]`.
    pub(crate) output_budget_ask: Option<serde_json::Value>,
    /// The effective output budget (B3, B4): set by [`CommandRegistry::execute`] for the
    /// middleware and the handler.
    pub(crate) output_budget: Option<u64>,
    /// The execute-time scope decision (`spec/authorization.md`, M6, "At execution"). Only the
    /// MCP server sets it, and every execution under this context (batch items, pipeline steps,
    /// nested calls that pass the context on) is decided again on its validated input.
    pub(crate) scope_check: Option<ScopeCheck>,
    /// Relay evidence (`spec/command-metadata.md`, "Relay evidence"): only the MCP server sets it,
    /// after the host's [`HumanRelay`](crate::server::HumanRelay) returned `Approved` for this
    /// call; the approval middleware then considers it and nothing else. Never read from a
    /// request, never serialized, and removed before the handler runs, so a command the handler
    /// calls in process never sees it.
    pub(crate) relay_evidence: Option<Arc<crate::approval::relay::RelayEvidence>>,
    /// The form-mode approval relay of one MCP tool call (`spec/command-metadata.md`, "Asking the
    /// human over MCP"): only the MCP server sets it. The handler gets one that never asks.
    pub(crate) approval_relay: Option<Arc<crate::approval::relay::ApprovalRelayChannel>>,
    /// The cancellation signal of a call the MCP server runs as a task (`spec/command-metadata.md`,
    /// "Tasks"): only the server sets it. Read it with [`CommandContext::cancellation`].
    pub(crate) cancellation: Option<crate::cancellation::CancellationSignal>,
    /// Where a task's progress goes ([`CommandContext::report_progress`]): only the server sets it.
    pub(crate) task_progress: Option<Arc<crate::cancellation::TaskProgress>>,
}

impl fmt::Debug for CommandContext {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("CommandContext")
            .field("trace_id", &self.trace_id)
            .field("timeout_ms", &self.timeout_ms)
            .field("interface", &self.interface)
            // The actor's id and principal may come from the credentials (a client id and a
            // subject), so they print redacted, as the credentials do.
            .field("actor", &self.actor.as_ref().map(RedactedActor))
            .field("credentials", &self.credentials)
            // An approval token is a credential: never print it.
            .field("approval", &self.approval.as_ref().map(|_| "[redacted]"))
            .field("clock", &self.clock.as_ref().map(|_| ".."))
            .field("random", &self.random.as_ref().map(|_| ".."))
            .field("extra", &self.extra)
            .field("journal_state", &self.journal_state)
            .field("context_scope", &self.context_scope)
            .field("tool_surface", &self.tool_surface)
            .field("known", &self.known)
            .field("output_budget_ask", &self.output_budget_ask)
            .field("output_budget", &self.output_budget)
            .field("scope_check", &self.scope_check)
            // Relay evidence names the caller: never print it.
            .field(
                "relay_evidence",
                &self.relay_evidence.as_ref().map(|_| "[redacted]"),
            )
            .field("approval_relay", &self.approval_relay)
            .field("cancellation", &self.cancellation)
            .field("task_progress", &self.task_progress)
            .finish()
    }
}

/// An actor in debug output: its kind and label, with `[redacted]` for its id and principal.
struct RedactedActor<'a>(&'a Actor);

impl fmt::Debug for RedactedActor<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        const REDACTED: &str = "[redacted]";
        f.debug_struct("Actor")
            .field("kind", &self.0.kind)
            .field("id", &self.0.id.as_ref().map(|_| REDACTED))
            .field("label", &self.0.label)
            .field(
                "on_behalf_of",
                &self.0.on_behalf_of.as_ref().map(|_| REDACTED),
            )
            .finish()
    }
}

impl CommandContext {
    /// Create an empty context.
    pub fn new() -> Self {
        Self::default()
    }

    /// Set the trace ID.
    pub fn with_trace_id(mut self, trace_id: impl Into<String>) -> Self {
        self.trace_id = Some(trace_id.into());
        self
    }

    /// Set the deadline in milliseconds.
    pub fn with_timeout(mut self, timeout_ms: u64) -> Self {
        self.timeout_ms = Some(timeout_ms);
        self
    }

    /// Set the invoking interface, which turns on exposure checks.
    pub fn with_interface(mut self, interface: CommandInterface) -> Self {
        self.interface = Some(interface);
        self
    }

    /// Set the calling actor.
    pub fn with_actor(mut self, actor: impl Into<Actor>) -> Self {
        self.actor = Some(actor.into());
        self
    }

    /// Set the verified credentials of the caller's token. Trusted host code only: commands,
    /// middleware and scope checks believe them.
    pub fn with_credentials(mut self, credentials: impl Into<Arc<Credentials>>) -> Self {
        self.credentials = Some(credentials.into());
        self
    }

    /// Set the approval evidence: a token a human approved. Trusted surface code only.
    pub fn with_approval(mut self, token: impl Into<String>) -> Self {
        self.approval = Some(token.into());
        self
    }

    /// Set the clock, for example a [`fixed_clock`](crate::fixed_clock).
    pub fn with_clock(mut self, clock: impl Clock + 'static) -> Self {
        self.clock = Some(Arc::new(clock));
        self
    }

    /// Set the random source, for example a [`seeded_random`](crate::seeded_random).
    pub fn with_random(mut self, random: impl RandomSource + 'static) -> Self {
        self.random = Some(Arc::new(random));
        self
    }

    /// The context's clock, or [`SYSTEM_CLOCK`] when it has none.
    pub fn clock(&self) -> &dyn Clock {
        match &self.clock {
            Some(clock) => clock.as_ref(),
            None => &SYSTEM_CLOCK,
        }
    }

    /// The context's random source, or [`SYSTEM_RANDOM`] when it has none.
    pub fn random(&self) -> &dyn RandomSource {
        match &self.random {
            Some(random) => random.as_ref(),
            None => &SYSTEM_RANDOM,
        }
    }

    /// Run with `context` active, for this call only: commands outside it return
    /// `COMMAND_NOT_IN_CONTEXT`, and `afd-context-enter` and `afd-context-exit` report that
    /// nothing persists (see [`crate::contexts`]).
    pub fn with_active_context(mut self, context: impl Into<String>) -> Self {
        self.context_scope = Some(crate::contexts::ContextScope::Request(Some(context.into())));
        self
    }

    /// Run in the session whose contexts `stack` holds: its top is the active context, and
    /// `afd-context-enter` and `afd-context-exit` change it (see [`crate::contexts`]).
    pub fn with_context_stack(mut self, stack: crate::contexts::ContextStack) -> Self {
        self.context_scope = Some(crate::contexts::ContextScope::Session(stack));
        self
    }

    /// The cancellation signal of a call the MCP server runs as a task (`spec/command-metadata.md`,
    /// "Tasks"): it fires on `tasks/cancel`, when the task's `ttlMs` ends, and when the token
    /// that started the task expires. `None` for every other call.
    ///
    /// The server stops the handler when it fires, at the handler's next `.await`, and settles
    /// the task itself (`cancelled`, `TASK_TOKEN_EXPIRED`, or gone at its TTL). Work the handler
    /// spawned elsewhere, and a loop that does not await, should read it and stop.
    pub fn cancellation(&self) -> Option<&crate::cancellation::CancellationSignal> {
        self.cancellation.as_ref()
    }

    /// Whether this call runs as a task whose cancellation signal fired (see
    /// [`Self::cancellation`]); always `false` for a call that is not a task.
    pub fn is_cancelled(&self) -> bool {
        self.cancellation
            .as_ref()
            .is_some_and(crate::cancellation::CancellationSignal::is_cancelled)
    }

    /// Report progress: for a call the MCP server runs as a task, `message` becomes the task's
    /// `statusMessage` and moves its `lastUpdatedAt` (`spec/command-metadata.md`, "Tasks"); no
    /// progress or log notification is sent. A message longer than
    /// [`MAX_PROGRESS_MESSAGE_BYTES`](crate::MAX_PROGRESS_MESSAGE_BYTES) is cut. Any other call
    /// ignores it. The client sees `statusMessage` and may show it to a person or a model, so
    /// report a phase or a count, never content.
    pub fn report_progress(&self, message: impl Into<String>) {
        if let Some(progress) = &self.task_progress {
            progress.report(message.into());
        }
    }

    /// The active context, if any.
    pub fn active_context(&self) -> Option<String> {
        self.context_scope
            .as_ref()
            .and_then(crate::contexts::ContextScope::active)
    }

    /// Ask for an output budget of at most `max_bytes` for this call (`spec/output-budgets.md`,
    /// B2): the in-process form of `_meta["dev.afd/outputBudget"] = { "maxBytes": n }`.
    ///
    /// It matters only for a command that declares a budget
    /// ([`CommandDefinition::with_output_budget`]): its effective budget is then
    /// `min(max_bytes, maxBytes)`, a larger ask being clamped. [`CommandRegistry::execute`]
    /// validates the ask like any call's: `max_bytes` must be from 1 to 9007199254740991, or the
    /// call fails with `VALIDATION_ERROR` before the middleware and the handler run, whether or
    /// not the command declares a budget. A value set here is trusted code's: the MCP server's
    /// context hook may set it, and it is never overwritten from `_meta`.
    pub fn with_output_budget_ask(mut self, max_bytes: u64) -> Self {
        self.output_budget_ask = Some(crate::output_budget::ask_value(max_bytes));
        self
    }

    /// The effective output budget of this call in bytes (B3, B4): the command's declared default
    /// or the caller's ask clamped to its maximum. `None` for a command without a declaration.
    /// [`CommandRegistry::execute`] sets it before the middleware and the handler run; a handler
    /// of a budgeted command should fit its result to it structurally (fewer items, shorter
    /// excerpts, a window with a way to read on) and never cut a JSON value in the middle.
    pub fn output_budget(&self) -> Option<u64> {
        self.output_budget
    }

    /// Add a custom context value.
    pub fn with_extra(mut self, key: impl Into<String>, value: serde_json::Value) -> Self {
        self.extra.insert(key.into(), value);
        self
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIRMATION MODE OF ONE COMMAND
// ═══════════════════════════════════════════════════════════════════════════════

/// How one command is confirmed over MCP (`spec/command-metadata.md`, "Host-verified
/// confirmation"), reported as `confirmationMode` in `_meta` and `afd-detail`. Unset, the
/// server's [`ConfirmationMode`](crate::server::ConfirmationMode) option applies to the command's
/// `confirm_prompt`.
///
/// Named apart from the server option, which says how a server treats `confirm_prompt`; this one
/// says that only the host can confirm the command at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[non_exhaustive]
#[serde(rename_all = "kebab-case")]
pub enum CommandConfirmationMode {
    /// `host-verified`: only the host can prove that a person decided, through the server's
    /// [`HumanRelay`](crate::server::HumanRelay). On every MCP surface, whatever the server's
    /// confirmation option says (`Off` included), the server never sends a form elicitation for
    /// the command, never accepts an acknowledgement or a form answer for it, and gates it whether
    /// or not it declares `confirm_prompt`. Without a relay a call fails with
    /// `CONFIRMATION_REQUIRED`. `DirectClient` and in-process registries are unchanged: the host
    /// owns in-process calls.
    HostVerified,
}

impl CommandConfirmationMode {
    /// The wire spelling: `host-verified`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::HostVerified => "host-verified",
        }
    }
}

impl fmt::Display for CommandConfirmationMode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TASK SUPPORT OF ONE COMMAND
// ═══════════════════════════════════════════════════════════════════════════════

/// Whether an MCP `tools/call` to a command may run as a task under the Tasks extension,
/// `io.modelcontextprotocol/tasks` (`spec/command-metadata.md`, "Tasks"), reported as `task` in
/// `_meta`, grouped `_meta.actions` and `afd-detail`.
///
/// | `task` | A request that declares the extension | One that does not |
/// | --- | --- | --- |
/// | [`Never`](Self::Never) (default) | Inline | Inline |
/// | [`Optional`](Self::Optional) | A task | Inline |
/// | [`Required`](Self::Required) | A task | JSON-RPC `-32021`, naming the extension |
///
/// Only a call that routes to one command (its own tool, a hybrid first-class tool, a grouped
/// tool or `afd-call`) becomes a task; in `afd-batch` and `afd-pipe` an `Optional` step runs
/// inline and a `Required` step fails the whole request before any step runs. `DirectClient`,
/// in-process registries and the CLI always run inline. A task never asks a person, so
/// [`CommandRegistry::register`] refuses `Optional` or `Required` beside `confirm_prompt`, an
/// approval policy other than `not-required`, or a `confirmation_mode`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[non_exhaustive]
#[serde(rename_all = "kebab-case")]
pub enum TaskSupport {
    /// `never`: every call runs inline.
    #[default]
    Never,
    /// `optional`: a task for a request that declares the extension, inline otherwise.
    Optional,
    /// `required`: only as a task; a request that does not declare the extension gets JSON-RPC
    /// `-32021` (missing required client capability).
    Required,
}

impl TaskSupport {
    /// The wire spelling: `never`, `optional` or `required`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Never => "never",
            Self::Optional => "optional",
            Self::Required => "required",
        }
    }

    /// Whether a call may run as a task (`Optional` or `Required`).
    pub fn allows_task(self) -> bool {
        self != Self::Never
    }
}

impl fmt::Display for TaskSupport {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXECUTION TIME ESTIMATE
// ═══════════════════════════════════════════════════════════════════════════════

/// Estimated execution time category.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum ExecutionTime {
    /// < 100ms
    Instant,
    /// 100ms - 1s
    Fast,
    /// 1s - 10s
    Slow,
    /// > 10s
    LongRunning,
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMMAND DEFINITION
// ═══════════════════════════════════════════════════════════════════════════════

/// A boxed, `Send` future, as returned by middleware.
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Runs the rest of the middleware chain and then the handler.
pub type MiddlewareNext =
    Arc<dyn Fn() -> BoxFuture<'static, CommandResult<serde_json::Value>> + Send + Sync>;

/// Middleware that wraps command execution, added with
/// [`CommandRegistry::add_middleware`].
///
/// It receives the command name, the validated input, the context and `next`,
/// and returns the result: usually `next().await`, possibly inspected or
/// replaced.
///
/// # Example
///
/// ```rust
/// use afd::{CommandMiddleware, CommandRegistry};
/// use std::sync::Arc;
///
/// let logging: CommandMiddleware = Arc::new(|name, _input, _context, next| {
///     Box::pin(async move {
///         let result = next().await;
///         println!("{name}: success={}", result.success);
///         result
///     })
/// });
///
/// let registry = CommandRegistry::new();
/// registry.add_middleware(logging);
/// ```
pub type CommandMiddleware = Arc<
    dyn Fn(
            String,
            serde_json::Value,
            CommandContext,
            MiddlewareNext,
        ) -> BoxFuture<'static, CommandResult<serde_json::Value>>
        + Send
        + Sync,
>;

/// Trait for command handlers.
#[async_trait]
pub trait CommandHandler: Send + Sync {
    /// Execute the command with the given input.
    async fn execute(
        &self,
        input: serde_json::Value,
        context: CommandContext,
    ) -> CommandResult<serde_json::Value>;
}

/// Full command definition with schema, handler, and metadata.
pub struct CommandDefinition {
    /// Unique command name using kebab-case (e.g., 'document-create').
    pub name: String,

    /// Human-readable description.
    pub description: String,

    /// A short human-readable label (`spec/command-metadata.md`, "Tool titles"): the MCP tool
    /// `title` of the command's own tool, and reported by `afd-detail` and `afd-help` (`full`).
    /// Display text, so never in `_meta`. `None` is unset; nothing is derived from the name.
    pub title: Option<String>,

    /// Category for grouping related commands.
    pub category: Option<String>,

    /// Command parameters with types and descriptions.
    pub parameters: Vec<CommandParameter>,

    /// Schema describing the return type.
    pub returns: Option<JsonSchema>,

    /// Error codes this command may return.
    pub errors: Option<Vec<String>>,

    /// Whether this is a handoff command.
    pub handoff: bool,

    /// Protocol for handoff commands (websocket, webrtc, sse, http-stream).
    pub handoff_protocol: Option<String>,

    /// The command handler.
    handler: Arc<dyn CommandHandler>,

    /// Command version.
    pub version: Option<String>,

    /// Tags for categorization.
    pub tags: Option<Vec<String>>,

    /// Commands that should be called before this one.
    ///
    /// Metadata only: the registry does not enforce it. `afd-help` lists it.
    pub requires: Option<Vec<String>>,

    /// Contexts this command belongs to.
    ///
    /// [`CommandRegistry::execute`] runs the command only when no context is
    /// active or one of these is ([`CommandDefinition::is_accessible_in_context`];
    /// see [`crate::contexts`]).
    pub contexts: Option<Vec<String>>,

    /// Whether this command performs side effects.
    pub mutation: bool,

    /// Estimated execution time.
    pub execution_time: Option<ExecutionTime>,

    /// Which interfaces this command is exposed to.
    pub expose: ExposeOptions,

    /// Concrete input examples to help agents construct valid payloads.
    pub examples: Option<Vec<CommandExample>>,

    /// Whether the command's effects are hard to reverse. `None` is unset.
    pub destructive: Option<bool>,

    /// The question a frontend asks before running the command. A server may enforce it
    /// (`spec/command-metadata.md`, "Confirmations").
    pub confirm_prompt: Option<String>,

    /// Whether the command's effects can be undone. `None` is unset.
    pub undoable: Option<bool>,

    /// Whether a call needs a human's approval before the handler runs. `None` is unset
    /// (`not-required`). Enforced by the approval middleware; reported as `_meta.approval`.
    pub approval: Option<ApprovalPolicy>,

    /// Extra `_meta` entries emitted on the command's tool and reported by `afd-detail` as
    /// `toolMeta` (`spec/mcp-resources.md`, T1). Keys follow the key rule
    /// ([`check_meta_entry`](crate::check_meta_entry)); the registry refuses anything else when the
    /// command is registered. `None` or empty is omitted.
    pub tool_meta: Option<serde_json::Map<String, serde_json::Value>>,

    /// The declared output budget (`spec/output-budgets.md`, B1), `None` for no budget. Checked
    /// when the command is registered.
    pub output_budget: Option<crate::output_budget::OutputBudget>,

    /// The OAuth scopes a caller's token needs to run the command over HTTP on a server
    /// configured with authorization (`spec/command-metadata.md`, "Scopes";
    /// `spec/authorization.md`, M6), beside the server's required scopes. Metadata: reported as
    /// `_meta.scopes` and by `afd-detail`, and enforced only by an authorized HTTP server (the
    /// `server-auth` feature), unless a host `ScopeResolver` decides instead. stdio, the CLI,
    /// `DirectClient` and in-process registries ignore it. Each must be a scope token
    /// ([`is_scope_token`](crate::is_scope_token)); the registry refuses anything else when the
    /// command is registered. `None` or empty is no scope of its own.
    pub scopes: Option<Vec<String>>,

    /// How the command is confirmed over MCP: `None` lets the server's confirmation option apply;
    /// [`CommandConfirmationMode::HostVerified`] lets only the host's
    /// [`HumanRelay`](crate::server::HumanRelay) confirm it (`spec/command-metadata.md`,
    /// "Host-verified confirmation"). Reported as `confirmationMode` in `_meta`, grouped
    /// `_meta.actions` and `afd-detail`.
    pub confirmation_mode: Option<CommandConfirmationMode>,

    /// Whether an MCP call may run as a task (`spec/command-metadata.md`, "Tasks"): `None` is
    /// unset, read as [`TaskSupport::Never`]. Reported as `task` in `_meta`, grouped
    /// `_meta.actions` and `afd-detail` when set. [`CommandRegistry::register`] refuses
    /// [`TaskSupport::Optional`] or [`TaskSupport::Required`] beside `confirm_prompt`, an approval
    /// policy other than `not-required`, or a `confirmation_mode`.
    pub task: Option<TaskSupport>,
}

impl CommandDefinition {
    /// Create a new command definition.
    pub fn new<H: CommandHandler + 'static>(
        name: impl Into<String>,
        description: impl Into<String>,
        parameters: Vec<CommandParameter>,
        handler: H,
    ) -> Self {
        Self {
            name: name.into(),
            description: description.into(),
            title: None,
            category: None,
            parameters,
            returns: None,
            errors: None,
            handoff: false,
            handoff_protocol: None,
            handler: Arc::new(handler),
            version: None,
            tags: None,
            requires: None,
            contexts: None,
            mutation: false,
            execution_time: None,
            expose: default_expose(),
            examples: None,
            destructive: None,
            confirm_prompt: None,
            undoable: None,
            approval: None,
            tool_meta: None,
            output_budget: None,
            scopes: None,
            confirmation_mode: None,
            task: None,
        }
    }

    /// Declare whether an MCP call may run as a task (see [`CommandDefinition::task`]).
    pub fn with_task(mut self, task: TaskSupport) -> Self {
        self.task = Some(task);
        self
    }

    /// The command's task support: [`TaskSupport::Never`] when unset.
    pub fn task_support(&self) -> TaskSupport {
        self.task.unwrap_or_default()
    }

    /// Set how the command is confirmed over MCP (see [`CommandDefinition::confirmation_mode`]):
    /// [`CommandConfirmationMode::HostVerified`] lets only the host's
    /// [`HumanRelay`](crate::server::HumanRelay) confirm it, whatever the server's confirmation
    /// option says.
    pub fn with_confirmation_mode(mut self, mode: CommandConfirmationMode) -> Self {
        self.confirmation_mode = Some(mode);
        self
    }

    /// Whether only the host can confirm the command ([`CommandConfirmationMode::HostVerified`]).
    pub fn is_host_verified(&self) -> bool {
        self.confirmation_mode == Some(CommandConfirmationMode::HostVerified)
    }

    /// Declare the OAuth scopes a caller's token needs to run the command on an authorized HTTP
    /// server (see [`CommandDefinition::scopes`]), compared exactly. Each must be a scope token
    /// (RFC 6749 3.3); [`CommandRegistry::register`] refuses the command otherwise, naming it and
    /// the scope.
    pub fn with_scopes<I, S>(mut self, scopes: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.scopes = Some(scopes.into_iter().map(Into::into).collect());
        self
    }

    /// Declare an output budget (`spec/output-budgets.md`, B1): a result may use `default_bytes`
    /// unless the caller asks for another budget, and `max_bytes` at most
    /// ([`CommandContext::with_output_budget_ask`], or `_meta["dev.afd/outputBudget"]` over MCP).
    ///
    /// Both must be integers from 1 to 9007199254740991 with `default_bytes <= max_bytes`; the
    /// registry refuses the command otherwise ([`CommandRegistry::register`]), naming it and the
    /// field. After the handler, a successful result over its effective budget is replaced by an
    /// `OUTPUT_BUDGET_EXCEEDED` failure, or, for a [mutation](Self::as_mutation), kept with a
    /// warning of that code. Nothing truncates structured output.
    pub fn with_output_budget(mut self, default_bytes: u64, max_bytes: u64) -> Self {
        self.output_budget = Some(crate::output_budget::OutputBudget::new(
            default_bytes,
            max_bytes,
        ));
        self
    }

    /// Add one extra `_meta` entry to the command's tool (`spec/mcp-resources.md`, T1 and T2): a
    /// prefixed key with two or more labels outside `dev.afd/` and MCP's reserved prefixes (for
    /// example `dev.umbel/origin`), or `ui`, the MCP Apps key. A later call with the same key
    /// replaces the value. The key is checked when the command is registered
    /// ([`CommandRegistry::register`]), which refuses the command, naming it and the key.
    pub fn with_tool_meta(mut self, key: impl Into<String>, value: serde_json::Value) -> Self {
        self.tool_meta
            .get_or_insert_with(serde_json::Map::new)
            .insert(key.into(), value);
        self
    }

    /// Set the display label, reported as the MCP tool `title`.
    pub fn with_title(mut self, title: impl Into<String>) -> Self {
        self.title = Some(title.into());
        self
    }

    /// Set the category.
    pub fn with_category(mut self, category: impl Into<String>) -> Self {
        self.category = Some(category.into());
        self
    }

    /// Set the return schema.
    pub fn with_returns(mut self, returns: JsonSchema) -> Self {
        self.returns = Some(returns);
        self
    }

    /// Mark as mutation.
    pub fn as_mutation(mut self) -> Self {
        self.mutation = true;
        self
    }

    /// Declare whether the command's effects are hard to reverse.
    pub fn with_destructive(mut self, destructive: bool) -> Self {
        self.destructive = Some(destructive);
        self
    }

    /// Set the question to ask before running the command.
    pub fn with_confirm_prompt(mut self, prompt: impl Into<String>) -> Self {
        self.confirm_prompt = Some(prompt.into());
        self
    }

    /// Set the approval policy: [`ApprovalPolicy::Required`], [`ApprovalPolicy::NotRequired`],
    /// an [`ApprovalDecision`](crate::ApprovalDecision), or a function
    /// ([`ApprovalPolicy::when`]). Enforced by the approval middleware.
    pub fn with_approval(mut self, approval: impl Into<ApprovalPolicy>) -> Self {
        self.approval = Some(approval.into());
        self
    }

    /// Declare whether the command's effects can be undone.
    pub fn with_undoable(mut self, undoable: bool) -> Self {
        self.undoable = Some(undoable);
        self
    }

    /// Set execution time estimate.
    pub fn with_execution_time(mut self, time: ExecutionTime) -> Self {
        self.execution_time = Some(time);
        self
    }

    /// Set tags for categorization.
    pub fn with_tags(mut self, tags: Vec<String>) -> Self {
        self.tags = Some(tags);
        self
    }

    /// Set the version for this command.
    pub fn with_version(mut self, version: impl Into<String>) -> Self {
        self.version = Some(version.into());
        self
    }

    /// Set the commands that should be called before this one (metadata only).
    pub fn with_requires<I, S>(mut self, requires: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.requires = Some(requires.into_iter().map(Into::into).collect());
        self
    }

    /// Set the contexts this command belongs to (see [`crate::contexts`]).
    pub fn with_contexts<I, S>(mut self, contexts: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.contexts = Some(contexts.into_iter().map(Into::into).collect());
        self
    }

    /// Whether this command is available while `active_context` is active.
    ///
    /// As in TypeScript: every command is available when no context is
    /// active, and a command without `contexts` is available in every context.
    pub fn is_accessible_in_context(&self, active_context: Option<&str>) -> bool {
        match (active_context, self.contexts.as_deref()) {
            (None, _) | (_, None | Some([])) => true,
            (Some(active), Some(contexts)) => contexts.iter().any(|context| context == active),
        }
    }

    /// Set the command exposure configuration.
    pub fn with_expose(mut self, expose: ExposeOptions) -> Self {
        self.expose = expose;
        self
    }

    /// Set concrete command examples.
    pub fn with_examples(mut self, examples: Vec<CommandExample>) -> Self {
        self.examples = Some(examples);
        self
    }

    /// Mark as a handoff command.
    pub fn as_handoff(mut self) -> Self {
        self.handoff = true;
        self
    }

    /// Mark as a handoff command with a specific protocol.
    pub fn as_handoff_with_protocol(mut self, protocol: impl Into<String>) -> Self {
        self.handoff = true;
        self.handoff_protocol = Some(protocol.into());
        self
    }

    /// Call the command's handler directly.
    ///
    /// This skips everything [`CommandRegistry::execute`] enforces: input
    /// validation, parameter defaults, exposure, the timeout and middleware.
    pub async fn execute(
        &self,
        input: serde_json::Value,
        context: CommandContext,
    ) -> CommandResult<serde_json::Value> {
        self.handler.execute(input, context).await
    }
}

impl HandoffCommandLike for CommandDefinition {
    fn is_handoff(&self) -> bool {
        self.handoff
    }

    fn handoff_protocol(&self) -> Option<&str> {
        self.handoff_protocol.as_deref()
    }

    fn tags(&self) -> Option<&[String]> {
        self.tags.as_deref()
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMMAND REGISTRY
// ═══════════════════════════════════════════════════════════════════════════════

/// Registry for managing and executing command definitions.
///
/// Registration takes `&self` (the registry uses interior mutability), so a
/// registry shared as `Arc<CommandRegistry>` can still gain commands, such as
/// the bootstrap commands that describe it
/// ([`register_bootstrap_commands`](crate::bootstrap::register_bootstrap_commands)).
/// [`CommandRegistry::list`] returns commands in registration order.
///
/// [`CommandRegistry::execute`] enforces each command's metadata; see its
/// documentation.
#[derive(Default)]
pub struct CommandRegistry {
    commands: RwLock<RegisteredCommands>,
    middleware: RwLock<Vec<CommandMiddleware>>,
    journal: RwLock<Option<Arc<JournalRecorder>>>,
    context_fields: RwLock<Arc<Vec<ContextField>>>,
}

/// Commands by name, plus their registration order.
#[derive(Default)]
struct RegisteredCommands {
    by_name: HashMap<String, Arc<CommandDefinition>>,
    ordered: Vec<Arc<CommandDefinition>>,
    /// The whole input schemas commands validate with ([`CommandRegistry::register_with_schema`]).
    schemas: HashMap<String, serde_json::Value>,
    /// The input schemas commands advertise in place of the validation schema
    /// ([`CommandRegistry::register_with_schemas`]).
    advertised: HashMap<String, serde_json::Value>,
}

/// Read a lock, ignoring poisoning: no registry invariant spans a panic.
fn read_lock<T>(lock: &RwLock<T>) -> RwLockReadGuard<'_, T> {
    lock.read().unwrap_or_else(PoisonError::into_inner)
}

fn write_lock<T>(lock: &RwLock<T>) -> RwLockWriteGuard<'_, T> {
    lock.write().unwrap_or_else(PoisonError::into_inner)
}

impl CommandRegistry {
    /// Create a new empty registry.
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a command.
    ///
    /// # Errors
    /// Returns an error if the name is not `domain-action` kebab-case, a
    /// command with the same name already exists, an extra `_meta` key of
    /// [`CommandDefinition::with_tool_meta`] breaks the key rule, a scope of
    /// [`CommandDefinition::with_scopes`] is not a scope token, or the command may run as a task
    /// ([`CommandDefinition::with_task`]) beside `confirm_prompt`, an approval policy other than
    /// `not-required`, or a `confirmation_mode`.
    pub fn register(&self, command: CommandDefinition) -> Result<(), String> {
        validate_command_name(&command.name)?;
        validate_tool_meta(&command)?;
        validate_output_budget(&command)?;
        validate_scopes(&command)?;
        validate_person_gates(&command)?;
        for parameter in &command.parameters {
            if let Some(schema) = &parameter.schema {
                crate::validation::validate_schema_definition(
                    schema,
                    &format!("#/properties/{}", parameter.name),
                )?;
            }
        }

        let mut commands = write_lock(&self.commands);
        if commands.by_name.contains_key(&command.name) {
            return Err(format!("Command '{}' is already registered", command.name));
        }
        let command = Arc::new(command);
        commands
            .by_name
            .insert(command.name.clone(), Arc::clone(&command));
        commands.ordered.push(command);
        Ok(())
    }

    /// Register a whole input JSON Schema without converting it to legacy parameters.
    /// Unsupported keywords fail registration. Use [`Self::get_tool`] to export this schema.
    pub fn register_with_schema(
        &self,
        command: CommandDefinition,
        schema: serde_json::Value,
    ) -> Result<(), String> {
        self.register_whole(command, schema, None)
    }

    fn register_whole(
        &self,
        command: CommandDefinition,
        schema: serde_json::Value,
        advertised: Option<serde_json::Value>,
    ) -> Result<(), String> {
        crate::schema_validation::compile(&schema)?;
        validate_command_name(&command.name)?;
        validate_tool_meta(&command)?;
        validate_output_budget(&command)?;
        validate_scopes(&command)?;
        validate_person_gates(&command)?;
        let mut commands = write_lock(&self.commands);
        if commands.by_name.contains_key(&command.name) {
            return Err(format!("Command '{}' is already registered", command.name));
        }
        commands.schemas.insert(command.name.clone(), schema);
        if let Some(advertised) = advertised {
            commands.advertised.insert(command.name.clone(), advertised);
        }
        let command = Arc::new(command);
        commands
            .by_name
            .insert(command.name.clone(), Arc::clone(&command));
        commands.ordered.push(command);
        Ok(())
    }

    /// [`Self::register_with_schema`] with a second schema the command advertises
    /// (`spec/mcp-resources.md`, V1 and V2).
    ///
    /// `validation` is compiled and every call is validated against it, exactly as for
    /// [`Self::register_with_schema`]. `advertised` is what every surface shows (a tool's
    /// `inputSchema`, grouped `_meta.actions`, `afd-detail`, `afd-schema` and `afd-docs`) and is
    /// checked for one thing only: a JSON object whose `type` is `"object"`. Nothing else in it is
    /// compiled, so it may use keywords the validator refuses. AFD cannot prove the two agree;
    /// keeping `validation` no wider than `advertised` is the caller's duty.
    ///
    /// # Errors
    /// The command is refused, naming it, when `advertised` is not an object schema, and for every
    /// reason [`Self::register_with_schema`] refuses one.
    pub fn register_with_schemas(
        &self,
        command: CommandDefinition,
        validation: serde_json::Value,
        advertised: serde_json::Value,
    ) -> Result<(), String> {
        if advertised.get("type").and_then(serde_json::Value::as_str) != Some("object") {
            return Err(format!(
                "Command '{}': the advertised input schema must be a JSON object whose type is \"object\"",
                command.name
            ));
        }
        self.register_whole(command, validation, Some(advertised))
    }

    /// Export the authoritative MCP tool, including any whole schema registered with it.
    ///
    /// The tool carries the command's `title` only when it sets one, and its `_meta` the approval
    /// mode, the output budget declaration (`dev.afd/outputBudget`: `{ defaultBytes,
    /// maxBytes }`), the `scopes` (when not empty), `confirmationMode`, `task` and the extra tool
    /// `_meta` entries, each only when set.
    ///
    /// A command with `mutation: true` also carries MCP `annotations`
    /// (`readOnlyHint: false`, `destructiveHint` from `destructive`; `spec/command-metadata.md`). `mutation`
    /// has no unset state here, so a non-mutating command claims nothing.
    pub fn get_tool(&self, name: &str) -> Option<serde_json::Value> {
        let commands = read_lock(&self.commands);
        let command = commands.by_name.get(name)?;
        let mut tool = serde_json::to_value(command_to_mcp_tool(command)).expect("tool serializes");
        if let Some(schema) = commands
            .advertised
            .get(name)
            .or_else(|| commands.schemas.get(name))
        {
            tool["inputSchema"] = schema.clone();
        }
        if let Some(annotations) = command_tool_annotations(command) {
            tool["annotations"] = annotations;
        }
        if let Some(approval) = approval_mode(command.approval.as_ref()) {
            if !tool["_meta"].is_object() {
                tool["_meta"] = serde_json::json!({});
            }
            tool["_meta"]["approval"] = serde_json::json!(approval);
        }
        // The output budget declaration (`spec/output-budgets.md`, B1).
        if let Some(budget) = &command.output_budget {
            if !tool["_meta"].is_object() {
                tool["_meta"] = serde_json::json!({});
            }
            tool["_meta"][crate::output_budget::AFD_OUTPUT_BUDGET_META_KEY] =
                serde_json::json!(budget);
        }
        // The scopes the command needs (`spec/command-metadata.md`, "Scopes"); `_meta` omits an
        // empty array.
        if let Some(scopes) = command.scopes.as_ref().filter(|scopes| !scopes.is_empty()) {
            if !tool["_meta"].is_object() {
                tool["_meta"] = serde_json::json!({});
            }
            tool["_meta"]["scopes"] = serde_json::json!(scopes);
        }
        // Only the host can confirm it (`spec/command-metadata.md`, "Host-verified confirmation").
        if let Some(mode) = command.confirmation_mode {
            if !tool["_meta"].is_object() {
                tool["_meta"] = serde_json::json!({});
            }
            tool["_meta"]["confirmationMode"] = serde_json::json!(mode);
        }
        // Whether a call may run as a task (`spec/command-metadata.md`, "Tasks"), when set.
        if let Some(task) = command.task {
            if !tool["_meta"].is_object() {
                tool["_meta"] = serde_json::json!({});
            }
            tool["_meta"]["task"] = serde_json::json!(task);
        }
        // The key rule keeps these from replacing any entry the server sets.
        if let Some(extra) = command.tool_meta.as_ref().filter(|extra| !extra.is_empty()) {
            if !tool["_meta"].is_object() {
                tool["_meta"] = serde_json::json!({});
            }
            for (key, value) in extra {
                tool["_meta"][key] = value.clone();
            }
        }
        Some(tool)
    }

    /// Add a middleware to the chain that wraps every command execution.
    ///
    /// Middleware runs in the order it was added (the first added is the
    /// outermost), after input validation, with the validated input. Each one
    /// calls `next()` to run the rest of the chain and can inspect or replace
    /// the result, or return without calling `next()` to short-circuit.
    pub fn add_middleware(&self, middleware: CommandMiddleware) {
        write_lock(&self.middleware).push(middleware);
    }

    /// Record every accepted call to a journal (`spec/journal.md`), replacing any recorder set
    /// before.
    ///
    /// The recorder runs after input validation and around the middleware chain; see
    /// [`JournalRecorder`]. Replay with [`replay_journal`](crate::replay_journal).
    pub fn set_journal(&self, recorder: JournalRecorder) {
        *write_lock(&self.journal) = Some(Arc::new(recorder));
    }

    /// Stop recording to the journal set with [`Self::set_journal`].
    pub fn clear_journal(&self) {
        *write_lock(&self.journal) = None;
    }

    /// Declare the request values calls may carry (`spec/context-fields.md`), replacing any
    /// declared before; an empty list removes them.
    ///
    /// A call carries its value for a field in [`CommandContext::extra`] under the field's name.
    /// [`Self::execute`] validates it after the input and before the middleware and the handler,
    /// and gives them the schema's output. An invalid value, or a missing required one, fails
    /// the call with `VALIDATION_ERROR`. A journal recorder keeps the values of the fields
    /// declared `journal: true`, and [`replay_journal`](crate::replay_journal) restores them;
    /// see [`crate::context_fields`]. The MCP server (feature `server`) reads the values from
    /// each `tools/call`'s `_meta` and lists the fields in `server/discover`; `afd-help` returns
    /// them as `contextFields`.
    ///
    /// # Errors
    /// Returns a message naming the field, and keeps the previous declarations, for an empty,
    /// reserved or repeated name, a `meta` key without a reverse-DNS prefix, with a reserved
    /// prefix (`dev.afd/`, or a label `mcp` or `modelcontextprotocol`) or repeated, or a schema
    /// outside the subset [`Self::register_with_schema`] supports.
    pub fn set_context_fields(
        &self,
        fields: impl IntoIterator<Item = ContextField>,
    ) -> Result<(), String> {
        let fields: Vec<ContextField> = fields.into_iter().collect();
        check_context_fields(&fields)?;
        *write_lock(&self.context_fields) = Arc::new(fields);
        Ok(())
    }

    /// The context fields declared with [`Self::set_context_fields`], in declaration order.
    pub fn context_fields(&self) -> Vec<ContextField> {
        read_lock(&self.context_fields).as_ref().clone()
    }

    /// Get a command by name.
    pub fn get(&self, name: &str) -> Option<Arc<CommandDefinition>> {
        read_lock(&self.commands).by_name.get(name).cloned()
    }

    /// Check if a command exists.
    pub fn has(&self, name: &str) -> bool {
        read_lock(&self.commands).by_name.contains_key(name)
    }

    /// Get all registered commands, in registration order.
    pub fn list(&self) -> Vec<Arc<CommandDefinition>> {
        read_lock(&self.commands).ordered.clone()
    }

    fn list_where(&self, keep: impl Fn(&CommandDefinition) -> bool) -> Vec<Arc<CommandDefinition>> {
        read_lock(&self.commands)
            .ordered
            .iter()
            .filter(|command| keep(command))
            .cloned()
            .collect()
    }

    /// Get commands by category.
    pub fn list_by_category(&self, category: &str) -> Vec<Arc<CommandDefinition>> {
        self.list_where(|command| command.category.as_deref() == Some(category))
    }

    /// Get the commands exposed to `interface`.
    pub fn list_by_exposure(&self, interface: CommandInterface) -> Vec<Arc<CommandDefinition>> {
        self.list_where(|command| command.expose.is_exposed_to(interface))
    }

    /// Get all handoff commands.
    pub fn list_handoff_commands(&self) -> Vec<Arc<CommandDefinition>> {
        self.list_where(crate::handoff::is_handoff_command)
    }

    /// Execute a command by name, enforcing its metadata.
    ///
    /// In order:
    ///
    /// 1. An unknown name returns `COMMAND_NOT_FOUND`. Its suggestion names up
    ///    to three close matches, as in TypeScript, chosen among the commands
    ///    exposed to `context.interface` (all commands when it is unset) and
    ///    available in the active context, and points to `afd-help` when that
    ///    is one of them (`afd-discover` for the MCP server's calls). On an
    ///    authorized MCP server, a command its resolver hides from the caller
    ///    is an unknown name here, with the same answer
    ///    (`spec/authorization.md`, M6, "Hidden commands").
    /// 2. When `context.interface` is set, a command not exposed to that
    ///    interface returns `COMMAND_NOT_EXPOSED` (see [`ExposeOptions`]); the
    ///    MCP server's calls get `COMMAND_NOT_FOUND` instead, as for an unknown
    ///    name.
    /// 3. With an active context ([`CommandContext::active_context`]), a
    ///    command outside it returns `COMMAND_NOT_IN_CONTEXT` (see
    ///    [`crate::contexts`]).
    /// 4. A `context.timeout_ms` without the `native` feature returns
    ///    `UNSUPPORTED_OPTION`.
    /// 5. The input is validated against the command's `parameters`, parameter
    ///    defaults are applied, and undeclared keys are dropped, as Zod does in
    ///    TypeScript. Invalid input returns `VALIDATION_ERROR` (`Input
    ///    validation failed`) with the problems in `suggestion` and
    ///    `details.errors`.
    /// 6. The declared context fields ([`Self::set_context_fields`]) are
    ///    validated on `context.extra`, each value replaced by its schema's
    ///    output; `null` counts as no value. An invalid value or a missing
    ///    required one returns `VALIDATION_ERROR` (`Context field '<name>'
    ///    is not valid` or `is required`), with `details.field`,
    ///    `details.meta` and `details.errors`. Commands named `afd-*` do not
    ///    enforce `required`.
    ///    The output budget ask ([`CommandContext::with_output_budget_ask`]) is
    ///    validated next, whether or not the command declares a budget: an
    ///    invalid ask returns `VALIDATION_ERROR` (`details.field` is
    ///    `outputBudget`, `details.meta` is `dev.afd/outputBudget`). The
    ///    effective budget ([`CommandContext::output_budget`]) is then set on
    ///    the context (`spec/output-budgets.md`, B3).
    /// 7. The middleware chain and then the handler run with the validated
    ///    input. With `context.timeout_ms`, a run that outlasts it returns
    ///    `TIMEOUT` (this needs a Tokio runtime with time enabled). A panic in
    ///    a middleware layer or the handler returns `COMMAND_EXECUTION_ERROR`
    ///    with the generic message of [`execution_failure`], as TypeScript
    ///    does for a thrown exception outside `devMode`; the panic payload is
    ///    never included. The failure is what the journal records (with
    ///    `with_record_failures(true)`), and a batch or pipeline treats it as
    ///    any failed command. Only unwinding panics are caught: with
    ///    `panic = "abort"`, and on `wasm32-unknown-unknown` (which cannot
    ///    unwind), a panic aborts the process.
    ///
    /// The innermost link of the chain checks a successful result against the
    /// effective output budget right after the handler, before `metadata` is
    /// stamped (B5, B6): an over-budget read becomes an `OUTPUT_BUDGET_EXCEEDED`
    /// failure, an over-budget [mutation](CommandDefinition::as_mutation) keeps
    /// its result with a warning of that code, and a result within budget
    /// carries `metadata["dev.afd/outputBudget"] = { limitBytes, usedBytes }`.
    /// A handler's own failure passes unchanged.
    ///
    /// The middleware and the handler always see a `clock` and a `random`
    /// source on the context ([`SYSTEM_CLOCK`] and [`SYSTEM_RANDOM`] unless the
    /// caller set them). When the context has an `actor`, the handler's result
    /// carries its kind as `metadata.actorKind`.
    ///
    /// The handler is not called when any check fails.
    pub async fn execute(
        &self,
        name: &str,
        input: serde_json::Value,
        context: Option<CommandContext>,
    ) -> CommandResult<serde_json::Value> {
        let context = with_context_defaults(context.unwrap_or_default(), &ContextDefaults::new());
        let active_context = context.active_context();
        let visible = |candidate: &CommandDefinition| {
            context
                .interface
                .is_none_or(|interface| candidate.expose.is_exposed_to(interface))
        };
        // A command that does not exist for the caller (one an authorized server's resolver
        // hides from it, `spec/authorization.md`, M6) is a missing one, before any other check.
        let known = |candidate: &CommandDefinition| {
            context
                .known
                .as_ref()
                .is_none_or(|known| known.allows(candidate))
        };
        // A remote caller cannot tell an unexposed command from a missing one (D4).
        let command = self
            .get(name)
            .filter(|command| known(command))
            .filter(|command| !context.remote || visible(command));
        let Some(command) = command else {
            // Suggest only names the caller could call: an interface caller must
            // not learn the names of commands that are not exposed to it, nor one an
            // authorized server hides from it by scope (`spec/authorization.md`, M6): the
            // listing filter, which the server sets whenever it sets `known`, holds only
            // commands that exist for the caller.
            let listed = context
                .tool_surface
                .as_ref()
                .and_then(|surface| surface.visible.as_ref());
            let callable: Vec<String> = read_lock(&self.commands)
                .ordered
                .iter()
                .filter(|candidate| visible(candidate))
                .filter(|candidate| candidate.is_accessible_in_context(active_context.as_deref()))
                .filter(|candidate| listed.is_none_or(|listed| listed.allows(candidate)))
                .map(|candidate| candidate.name.clone())
                .collect();
            return failure(
                CommandError::new(
                    error_codes::COMMAND_NOT_FOUND,
                    format!("Command '{}' not found", truncate_name(name)),
                )
                .with_suggestion(not_found_suggestion(name, &callable, context.remote))
                .with_retryable(false),
            );
        };

        if let Some(interface) = context.interface {
            if !command.expose.is_exposed_to(interface) {
                return failure(
                    CommandError::new(
                        error_codes::COMMAND_NOT_EXPOSED,
                        format!("Command '{name}' is not exposed to {interface}"),
                    )
                    .with_suggestion(format!(
                        "Call it from an interface it is exposed to, or set expose.{interface} to true in its definition"
                    ))
                    .with_retryable(false),
                );
            }
        }

        if let Some(active) = active_context.as_deref() {
            if !command.is_accessible_in_context(Some(active)) {
                let context_tools = self
                    .get(crate::builtin_names::AFD_CONTEXT_COMMAND_NAMES[0])
                    .is_some_and(|list| visible(&list) && known(&list));
                return failure(crate::contexts::not_in_context_error(
                    &command,
                    active,
                    context_tools,
                ));
            }
        }

        if context.timeout_ms.is_some() && !cfg!(feature = "native") {
            return failure(
                CommandError::new(
                    error_codes::UNSUPPORTED_OPTION,
                    "Command timeouts require the native feature",
                )
                .with_suggestion("Enable the native feature or omit timeout_ms from the context")
                .with_retryable(false),
            );
        }

        let input = match self.validate(&command, input) {
            Ok(input) => input,
            Err(error) => return failure(*error),
        };

        let mut context = context;
        let context_fields = Arc::clone(&read_lock(&self.context_fields));
        if let Err(error) = apply_context_fields(&context_fields, &command.name, &mut context) {
            return failure(*error);
        }
        if let Err(error) = crate::output_budget::apply_output_budget(&command, &mut context) {
            return failure(*error);
        }
        // The execute-time scope decision on the validated input, with defaults applied and any
        // pipeline references resolved (`spec/authorization.md`, M6, "At execution").
        if let (Some(check), Some(credentials)) = (&context.scope_check, &context.credentials) {
            if let Some(error) = (check.0)(&command.name, &input, credentials) {
                return failure(error);
            }
        }

        let timeout_ms = context.timeout_ms;
        let middleware = read_lock(&self.middleware).clone();
        // Replayed calls, and the calls nested in them, are never recorded.
        let journal = read_lock(&self.journal)
            .clone()
            .filter(|recorder| !context.journal_state.replaying && recorder.records(name));
        let recording = journal
            .as_ref()
            .map(|recorder| recorder.start(&command.name, &input, &mut context, &context_fields));
        let chain = middleware_chain(&command, &middleware, input, context);
        // `chain()` runs inside the guarded future, so a middleware layer that
        // panics while building its future is caught too.
        let run = run_guarded(async move { chain().await });

        // The deadline covers the chain only: a slow journal append cannot turn a finished call
        // into a TIMEOUT, and a call that timed out is not recorded.
        let result = match timeout_ms {
            #[cfg(feature = "native")]
            Some(timeout_ms) => {
                match tokio::time::timeout(Duration::from_millis(timeout_ms), run).await {
                    Ok(result) => result,
                    Err(_) => return failure(CommandError::timeout(&command.name, timeout_ms)),
                }
            }
            _ => run.await,
        };
        match (journal, recording) {
            (Some(recorder), Some(recording)) => recorder.finish(recording, result).await,
            _ => result,
        }
    }

    /// `input` validated against `command`'s schema, defaults applied, exactly as
    /// [`CommandRegistry::execute`] validates it before the middleware: the MCP server's
    /// host-verified gate validates with it before asking anyone, so the person decides on the
    /// input that runs. A host asking a person through a channel of its own (a terminal that
    /// waits for a decision made elsewhere) validates with it too, so that
    /// [`crate::input_digest`] of the result names what will run.
    ///
    /// # Errors
    /// `VALIDATION_ERROR`, as [`CommandRegistry::execute`] answers it.
    pub fn validate(
        &self,
        command: &CommandDefinition,
        input: serde_json::Value,
    ) -> Result<serde_json::Value, Box<CommandError>> {
        let schema = read_lock(&self.commands)
            .schemas
            .get(&command.name)
            .cloned();
        match schema {
            Some(schema) => crate::schema_validation::execute(&schema, input),
            None => validate_input(&command.parameters, input),
        }
    }

    /// Execute multiple commands in a batch with a default context.
    ///
    /// See [`CommandRegistry::execute_batch_with_context`].
    pub async fn execute_batch(
        &self,
        request: BatchRequest<serde_json::Value>,
    ) -> BatchResult<serde_json::Value> {
        self.execute_batch_with_context(request, CommandContext::new())
            .await
    }

    /// Execute multiple commands in a batch.
    ///
    /// Uses partial success semantics, as in TypeScript: every command runs
    /// unless `stopOnError` is set, and [`BatchResult::success`] is `true`
    /// whenever the batch itself ran. It is `false` only for an invalid
    /// request: no commands, a blank command name, a negative or non-finite
    /// `timeout`, or a zero `parallelism` or `maxFailures` return
    /// `INVALID_BATCH_REQUEST` with TypeScript's message, `Invalid batch
    /// request envelope`, before any command runs. A handler that panics
    /// produces a `COMMAND_EXECUTION_ERROR` result for its own command (see
    /// [`CommandRegistry::execute`]); the other results are kept.
    ///
    /// Every command runs through [`CommandRegistry::execute`] with a copy of
    /// `context` (so exposure checks, validation, the timeout and middleware
    /// apply to each) and a per-command trace ID, `<batch trace ID>-<index>`.
    /// The batch trace ID is `context.trace_id`, or `batch-<timestamp>`.
    /// The request's `context` entries are added to each command's
    /// [`CommandContext::extra`], without replacing keys the caller set; they
    /// never change the trace ID, interface or timeout.
    pub async fn execute_batch_with_context(
        &self,
        request: BatchRequest<serde_json::Value>,
        context: CommandContext,
    ) -> BatchResult<serde_json::Value> {
        let start_time = Instant::now();
        let started_at = chrono::Utc::now().to_rfc3339();
        let options = request.options.unwrap_or_default();
        if request.commands.is_empty()
            || request
                .commands
                .iter()
                .any(|command| crate::wire::is_blank(&command.command))
            || options
                .timeout
                .is_some_and(|timeout| !timeout.is_finite() || timeout < 0.0)
            || options.parallelism == Some(0)
            || options.max_failures == Some(0)
        {
            // TypeScript's error. The suggestion also names maxFailures, a Rust extension.
            return create_failed_batch_result(
                CommandError::new(error_codes::INVALID_BATCH_REQUEST, "Invalid batch request envelope")
                    .with_suggestion(
                        "Provide at least one command with a nonempty command name and optional string ID, and valid boolean stopOnError, nonnegative timeout, and positive integer parallelism and maxFailures options",
                    )
                    .with_retryable(false),
                &started_at,
            );
        }
        #[cfg(not(feature = "native"))]
        if options.timeout.is_some() {
            return create_failed_batch_result(
                CommandError::new(
                    error_codes::UNSUPPORTED_OPTION,
                    "Batch deadlines require the native feature",
                )
                .with_suggestion("Enable the native feature or omit timeout")
                .with_retryable(false),
                &started_at,
            );
        }
        let parallelism = options.parallelism.unwrap_or(1);

        let batch_trace_id = context
            .trace_id
            .clone()
            .unwrap_or_else(|| format!("batch-{}", chrono::Utc::now().timestamp_millis()));
        let mut base_context = context;
        for (key, value) in request.context.into_iter().flatten() {
            base_context.extra.entry(key).or_insert(value);
        }
        let total_commands = request.commands.len();
        let command_metadata: Vec<_> = request
            .commands
            .iter()
            .enumerate()
            .map(|(index, command)| {
                (
                    command.id.clone().unwrap_or_else(|| format!("cmd-{index}")),
                    command.command.clone(),
                )
            })
            .collect();
        let timeout_error = || {
            CommandError::new(
                error_codes::BATCH_TIMEOUT,
                format!(
                    "Batch timeout exceeded ({}ms)",
                    options.timeout.unwrap_or(0.0)
                ),
            )
            .with_suggestion("Increase timeout or reduce the number of batch commands")
            .with_retryable(true)
        };
        let stop_on_error = options.stops_on_error();
        let max_failures = options.max_failures;
        let deadline = options
            .timeout
            .and_then(|timeout| deadline_after(start_time, timeout));
        let mut pending = request.commands.into_iter().enumerate();
        let mut active: FuturesUnordered<BatchExecutionFuture<'_>> = FuturesUnordered::new();
        let mut results: Vec<Option<BatchCommandResult<serde_json::Value>>> =
            (0..total_commands).map(|_| None).collect();
        let mut failures = 0usize;
        let mut stopped = false;
        let mut timed_out = false;

        loop {
            while !stopped && active.len() < parallelism {
                let Some((index, cmd)) = pending.next() else {
                    break;
                };
                let (id, command_name) = command_metadata[index].clone();
                let context = base_context
                    .clone()
                    .with_trace_id(format!("{batch_trace_id}-{index}"));
                let timeout_error = &timeout_error;
                active.push(Box::pin(async move {
                    let command_start = Instant::now();
                    let name = command_name.clone();
                    let execution = self.execute(&name, cmd.input, Some(context));
                    let result = match deadline {
                        None => Some(execution.await),
                        Some(deadline) => {
                            let remaining = deadline.saturating_duration_since(Instant::now());
                            if remaining.is_zero() {
                                None
                            } else {
                                #[cfg(feature = "native")]
                                {
                                    tokio::time::timeout(remaining, execution).await.ok()
                                }
                                // Unreachable: deadlines are rejected above without `native`.
                                #[cfg(not(feature = "native"))]
                                {
                                    Some(execution.await)
                                }
                            }
                        }
                    };
                    let result = result.unwrap_or_else(|| failure(timeout_error()));
                    (
                        index,
                        BatchCommandResult::new(id, index, command_name, result)
                            .with_duration(elapsed_ms(command_start)),
                    )
                }));
            }

            let Some((index, command_result)) = active.next().await else {
                break;
            };
            if !command_result.result.success {
                failures += 1;
                timed_out |= command_result
                    .result
                    .error
                    .as_ref()
                    .is_some_and(|error| error.code == error_codes::BATCH_TIMEOUT);
                stopped = timed_out
                    || stop_on_error
                    || max_failures.is_some_and(|maximum| failures >= maximum);
            }
            results[index] = Some(command_result);
        }

        let results: Vec<_> = results
            .into_iter()
            .enumerate()
            .map(|(index, result)| {
                result.unwrap_or_else(|| {
                    let (id, command) = command_metadata[index].clone();
                    let error = if timed_out {
                        timeout_error()
                    } else {
                        CommandError::new(
                            error_codes::COMMAND_SKIPPED,
                            "Command skipped because batch execution stopped after a failure",
                        )
                        .with_suggestion("Disable stopOnError to execute every command")
                    };
                    BatchCommandResult::new(id, index, command, failure(error))
                })
            })
            .collect();

        let total_ms = elapsed_ms(start_time);
        let average_ms = (total_ms / results.len() as f64 * 100.0).round() / 100.0;
        create_batch_result(
            results,
            BatchTiming::new(
                started_at.clone(),
                chrono::Utc::now().to_rfc3339(),
                total_ms,
                average_ms,
            ),
            Some(ResultMetadata::new().with_trace_id(batch_trace_id)),
        )
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXECUTION HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/// Longest command name (in UTF-16 code units) echoed back in an error, as in
/// TypeScript.
const MAX_ECHOED_NAME_LENGTH: usize = crate::similarity::MAX_SIMILARITY_INPUT_LENGTH;

/// `name` cut to [`MAX_ECHOED_NAME_LENGTH`] UTF-16 code units, with `…` when
/// cut, as TypeScript's `truncateName` does. A character that would straddle
/// the cut (a surrogate pair) is left out whole.
pub(crate) fn truncate_name(name: &str) -> String {
    let mut length = 0;
    for (end, character) in name.char_indices() {
        length += character.len_utf16();
        if length > MAX_ECHOED_NAME_LENGTH {
            return format!("{}…", &name[..end]);
        }
    }
    name.to_string()
}

/// How many close matches a `COMMAND_NOT_FOUND` suggestion names at most, as in TypeScript.
const MAX_NOT_FOUND_MATCHES: usize = 3;

/// The bootstrap command that lists the commands a caller can call.
const HELP_COMMAND: &str = "afd-help";

/// Recovery guidance for an unknown command name, as in TypeScript's
/// `notFoundSuggestion`: at most [`MAX_NOT_FOUND_MATCHES`] close matches
/// (bounded fuzzy matching; none for very long names), never the whole list,
/// and a pointer to `afd-help`.
///
/// TypeScript points to `afd-discover`, which its server always routes. Here
/// the pointer is `afd-help`, and only when `callable` contains it: it exists
/// only after [`register_bootstrap_commands`](crate::bootstrap::register_bootstrap_commands),
/// and is not exposed to every interface.
///
/// `name` is untrusted and never echoed; `callable` holds the names the caller
/// may call, in registration order (ties keep that order, as in TypeScript).
pub(crate) fn not_found_suggestion(name: &str, callable: &[String], remote: bool) -> String {
    // The MCP server routes afd-discover in every tool strategy.
    let list = if remote {
        "Use afd-discover to list all commands."
    } else if callable.iter().any(|candidate| candidate == HELP_COMMAND) {
        "Use afd-help to list all commands."
    } else {
        "Check the command name against the available commands."
    };
    let mut matches =
        crate::similarity::find_similar_tools(name, callable, Some(MAX_NOT_FOUND_MATCHES))
            .into_iter();
    let Some(best) = matches.next() else {
        return list.to_string();
    };
    let others: Vec<String> = matches.map(|other| format!("'{other}'")).collect();
    let also_close = if others.is_empty() {
        String::new()
    } else {
        format!(" Other close matches: {}.", others.join(", "))
    };
    format!("Did you mean '{best}'?{also_close} {list}")
}

/// Build the middleware chain around `command`'s handler.
///
/// The returned function can be called more than once (a retry middleware
/// calls `next()` again); each call clones the input and context.
fn middleware_chain(
    command: &Arc<CommandDefinition>,
    middleware: &[CommandMiddleware],
    input: serde_json::Value,
    context: CommandContext,
) -> MiddlewareNext {
    let handler: MiddlewareNext = {
        let command = Arc::clone(command);
        let input = input.clone();
        let context = context.clone();
        Arc::new(move || {
            let command = Arc::clone(&command);
            let input = input.clone();
            let mut context = context.clone();
            // Relay evidence and the approval relay serve the call that reached the middleware,
            // never a command the handler runs in process with this context.
            context.relay_evidence = None;
            if context.approval_relay.is_some() {
                context.approval_relay = Some(Arc::new(
                    crate::approval::relay::ApprovalRelayChannel::never_asks(),
                ));
            }
            Box::pin(async move {
                // Only the kind is reported, never the actor's id or label.
                let actor_kind = context.actor.as_ref().map(|actor| actor.kind);
                let output_budget = context.output_budget;
                let mut result = command.execute(input, context).await;
                // The output budget check (`spec/output-budgets.md`, B5): right after the
                // handler, before `metadata` is stamped and before any middleware sees it.
                if let Some(limit) = output_budget {
                    result = crate::output_budget::check_result(&command, limit, result);
                }
                if let Some(actor_kind) = actor_kind {
                    let metadata = result.metadata.get_or_insert_with(ResultMetadata::new);
                    metadata.actor_kind = Some(actor_kind);
                    // A handler that still writes the key into `extra` would serialize it twice.
                    metadata.extra.remove("actorKind");
                }
                result
            })
        })
    };

    middleware.iter().rev().fold(handler, |next, layer| {
        let layer = Arc::clone(layer);
        let name = command.name.clone();
        let input = input.clone();
        let context = context.clone();
        Arc::new(move || {
            layer(
                name.clone(),
                input.clone(),
                context.clone(),
                Arc::clone(&next),
            )
        })
    })
}

/// Milliseconds since `start`, rounded to two decimals as in TypeScript.
pub(crate) fn elapsed_ms(start: Instant) -> f64 {
    (start.elapsed().as_secs_f64() * 100_000.0).round() / 100.0
}

/// The instant `timeout_ms` after `start`, or `None` when it is too far away
/// to represent (effectively no deadline).
pub(crate) fn deadline_after(start: Instant, timeout_ms: f64) -> Option<Instant> {
    Duration::try_from_secs_f64(timeout_ms / 1000.0)
        .ok()
        .and_then(|timeout| start.checked_add(timeout))
}

/// The result reported in place of one when a command handler panics: the
/// redacted `COMMAND_EXECUTION_ERROR`. The panic payload is not included, as
/// it may contain internal details.
pub(crate) fn handler_panic_failure() -> CommandResult<serde_json::Value> {
    execution_failure("The command handler panicked", false)
}

/// Run a command future, turning a panic into a `COMMAND_EXECUTION_ERROR`
/// failure so one handler cannot abort its caller, a batch or a pipeline.
pub(crate) async fn run_guarded<F>(future: F) -> CommandResult<serde_json::Value>
where
    F: Future<Output = CommandResult<serde_json::Value>>,
{
    AssertUnwindSafe(future)
        .catch_unwind()
        .await
        .unwrap_or_else(|_| handler_panic_failure())
}

// ═══════════════════════════════════════════════════════════════════════════════
// MCP TOOL CONVERSION
// ═══════════════════════════════════════════════════════════════════════════════

/// MCP Tool format for command export.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpTool {
    pub name: String,
    /// Display label (`spec/command-metadata.md`, "Tool titles"), only when the command sets one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub description: String,
    pub input_schema: McpInputSchema,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpInputSchema {
    #[serde(rename = "type")]
    pub schema_type: String,
    pub properties: HashMap<String, JsonSchema>,
    pub required: Vec<String>,
}

/// MCP tool annotations for a command (`spec/command-metadata.md`, "Annotations").
///
/// Only what the command declares is reported. `mutation` has no unset state here, so a
/// mutation gives `readOnlyHint: false` and `destructiveHint` from `destructive` (`false` when
/// unset), and anything else gives `None`.
pub fn command_tool_annotations(command: &CommandDefinition) -> Option<serde_json::Value> {
    command.mutation.then(|| {
        serde_json::json!({
            "readOnlyHint": false,
            "destructiveHint": command.destructive.unwrap_or(false),
        })
    })
}

/// The MCP `outputSchema` of a command tool: the CommandResult envelope, with `data` typed by
/// `data_schema` (`spec/command-metadata.md`, "Structured results").
pub fn command_result_output_schema(data_schema: &serde_json::Value) -> serde_json::Value {
    let mut data = data_schema.clone();
    if let Some(object) = data.as_object_mut() {
        object.remove("$schema");
    }
    serde_json::json!({
        "type": "object",
        "properties": {
            "success": { "type": "boolean" },
            "data": data,
            "error": { "type": "object" },
            "metadata": { "type": "object" },
        },
        "required": ["success"],
    })
}

/// Convert a legacy definition to a tool. For whole-schema registrations, use
/// [`CommandRegistry::get_tool`] instead: the definition alone does not carry the override.
pub fn command_to_mcp_tool(command: &CommandDefinition) -> McpTool {
    let mut properties = HashMap::new();
    let mut required = Vec::new();

    for param in &command.parameters {
        let mut schema = param.schema.clone().unwrap_or_else(|| JsonSchema {
            schema_type: Some(param.param_type.clone()),
            description: Some(param.description.clone()),
            default: param.default.clone(),
            enum_values: param.enum_values.clone(),
            ..Default::default()
        });

        if param.default.is_some() {
            schema.default = param.default.clone();
        }
        let has_default = schema.default.is_some();
        properties.insert(param.name.clone(), schema);

        if param.required && !has_default {
            required.push(param.name.clone());
        }
    }

    McpTool {
        name: command.name.clone(),
        title: command.title.clone(),
        description: command.description.clone(),
        input_schema: McpInputSchema {
            schema_type: "object".to_string(),
            properties,
            required,
        },
    }
}

/// Refuse a command whose output budget declaration is out of bounds, naming the command and the
/// field (`spec/output-budgets.md`, B1).
fn validate_output_budget(command: &CommandDefinition) -> Result<(), String> {
    match &command.output_budget {
        Some(budget) => budget
            .check()
            .map_err(|reason| format!("Command '{}': {reason}", command.name)),
        None => Ok(()),
    }
}

/// Refuse a command whose `scopes` hold something that is not a scope token, naming the command
/// and the scope (`spec/command-metadata.md`, "Scopes").
fn validate_scopes(command: &CommandDefinition) -> Result<(), String> {
    for scope in command.scopes.iter().flatten() {
        if !crate::credentials::is_scope_token(scope) {
            return Err(format!(
                "Command '{}': scope {scope:?} is not an OAuth scope token (one or more visible ASCII characters other than '\"' and '\\', RFC 6749 3.3)",
                command.name
            ));
        }
    }
    Ok(())
}

/// The registration check of the settings that make a call ask a person: `confirm_prompt`, an
/// approval policy other than `not-required`, and `confirmation_mode`.
///
/// A command that may run as a task (`task: optional` or `required`) is refused beside any of
/// the three, naming the command and the setting (`spec/command-metadata.md`, "Tasks": a task
/// never asks a person, so no AFD task is ever `input_required`).
fn validate_person_gates(command: &CommandDefinition) -> Result<(), String> {
    let task = command.task_support();
    if !task.allows_task() {
        return Ok(());
    }
    let asks_approval = !matches!(
        command.approval,
        None | Some(crate::ApprovalPolicy::NotRequired)
    );
    let gate = if command.confirm_prompt.is_some() {
        Some("confirm_prompt")
    } else if asks_approval {
        Some("an approval policy other than not-required")
    } else if command.confirmation_mode.is_some() {
        Some("confirmation_mode")
    } else {
        None
    };
    match gate {
        Some(gate) => Err(format!(
            "Command '{}': task \"{task}\" cannot be combined with {gate}: a task never asks a person (spec/command-metadata.md, \"Tasks\")",
            command.name
        )),
        None => Ok(()),
    }
}

/// Refuse a command whose extra tool `_meta` breaks the key rule, naming the command and the key.
fn validate_tool_meta(command: &CommandDefinition) -> Result<(), String> {
    for (key, value) in command.tool_meta.iter().flatten() {
        crate::meta_keys::check_meta_entry(key, value, true)
            .map_err(|reason| format!("Command '{}': {reason}", command.name))?;
    }
    Ok(())
}

pub fn create_command_registry() -> CommandRegistry {
    CommandRegistry::new()
}

#[cfg(test)]
mod tests;

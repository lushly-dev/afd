//! Command definitions: names, parameters, schemas, exposure, confirmation and task support,
//! and [`CommandDefinition`].

#[allow(clippy::wildcard_imports)]
use super::*;

// COMMAND NAME VALIDATION

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

// JSON SCHEMA TYPES

/// JSON Schema type for command parameter validation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum JsonSchemaType {
    /// JSON string.
    String,
    /// JSON floating-point or integer number.
    Number,
    /// JSON boolean.
    Boolean,
    /// JSON object.
    Object,
    /// JSON array.
    Array,
    /// JSON `null`.
    Null,
    /// JSON integer.
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

// COMMAND PARAMETER

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
    /// Another app, through a host (opt-in; each call needs the registry's call grant, see
    /// [`CommandRegistry::set_call_grant`]).
    Apps,
}

impl CommandInterface {
    /// The interface name, as used for the `expose` keys.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Palette => "palette",
            Self::Mcp => "mcp",
            Self::Agent => "agent",
            Self::Cli => "cli",
            Self::Apps => "apps",
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
/// `isExposedTo`: `palette` and `agent` default to `true`, `mcp`, `cli` and
/// `apps` to `false`. So `{"mcp": true}` deserializes to palette, agent and MCP
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
    /// Other apps, each under a host's grant (default `false`: opt in). The callee's
    /// declaration that another app may call the command; a call with
    /// [`CommandInterface::Apps`] also needs [`CommandRegistry::set_call_grant`]'s grant
    /// (`spec/app-calls.md`). Serialized only when `true`, so the
    /// default serializes as it did before the flag existed.
    #[serde(default = "default_false", skip_serializing_if = "is_false")]
    pub apps: bool,
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

    /// Set exposure to other apps (see [`ExposeOptions::apps`]).
    pub fn with_apps(mut self, exposed: bool) -> Self {
        self.apps = exposed;
        self
    }

    /// Whether these options expose a command to `interface`.
    pub fn is_exposed_to(&self, interface: CommandInterface) -> bool {
        match interface {
            CommandInterface::Palette => self.palette,
            CommandInterface::Mcp => self.mcp,
            CommandInterface::Agent => self.agent,
            CommandInterface::Cli => self.cli,
            CommandInterface::Apps => self.apps,
        }
    }
}

const fn default_true() -> bool {
    true
}

const fn default_false() -> bool {
    false
}

#[allow(clippy::trivially_copy_pass_by_ref)] // serde's skip_serializing_if passes a reference
const fn is_false(value: &bool) -> bool {
    !*value
}

impl Default for ExposeOptions {
    fn default() -> Self {
        Self {
            palette: true,
            mcp: false,
            agent: true,
            cli: false,
            apps: false,
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

// CONFIRMATION MODE OF ONE COMMAND

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

// TASK SUPPORT OF ONE COMMAND

/// Whether an MCP `tools/call` to a command may run as a task under the Tasks extension,
/// `io.modelcontextprotocol/tasks` (`spec/tasks.md`), reported as `task` in
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

// EXECUTION TIME ESTIMATE

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
    /// (`spec/confirmations.md`).
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

    /// Whether an MCP call may run as a task (`spec/tasks.md`): `None` is
    /// unset, read as [`TaskSupport::Never`]. Reported as `task` in `_meta`, grouped
    /// `_meta.actions` and `afd-detail` when set. [`CommandRegistry::register`] refuses
    /// [`TaskSupport::Optional`] or [`TaskSupport::Required`] beside `confirm_prompt`, an approval
    /// policy other than `not-required`, or a `confirmation_mode`.
    pub task: Option<TaskSupport>,

    /// Whether the command takes or returns a secret (a password argument, an issued token):
    /// a journal never records a call to it unless the recorder also has a redactor, which
    /// removes the secret; a filter alone never admits it (`spec/journal.md`). Not reported.
    /// Set it with [`Self::as_secret`].
    pub secret: bool,
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
            secret: false,
        }
    }

    /// Declare that the command takes or returns a secret (see [`CommandDefinition::secret`]):
    /// a [`JournalRecorder`](crate::JournalRecorder) records calls to it only when it has a
    /// redactor, and the call reads off any recording parent's tape.
    pub fn as_secret(mut self) -> Self {
        self.secret = true;
        self
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

    /// Replace the handler with `wrap` of it, keeping every other field: a host that registers
    /// a definition someone else built can run its own code around the handler (a turn, a
    /// deadline), as TypeScript and Python reach `handler` directly.
    pub fn map_handler(
        mut self,
        wrap: impl FnOnce(Arc<dyn CommandHandler>) -> Arc<dyn CommandHandler>,
    ) -> Self {
        self.handler = wrap(self.handler);
        self
    }

    /// Call the command's handler directly.
    ///
    /// This skips everything [`CommandRegistry::execute`] enforces: input
    /// validation, parameter defaults, exposure, the timeout, middleware and
    /// the approval admission check (a declared approval policy does not hold
    /// here). It still keeps a [secret](Self::secret) command's readings off any
    /// recording parent's tape, as the registry does: the tape is marked `truncated` when the
    /// call was given the recording sources themselves, or once it reads through a host's
    /// wrapper around them.
    pub async fn execute(
        &self,
        input: serde_json::Value,
        mut context: CommandContext,
    ) -> CommandResult<serde_json::Value> {
        // Not a dispatch, so no dispatch id: a context the registry gave a handler keeps no id of
        // the outer call here (`spec/dispatch.md`, "The dispatch id").
        context.dispatch_id = None;
        if !self.secret {
            return self.handler.execute(input, context).await;
        }
        crate::journal::off_tape(&mut context);
        let scope = crate::journal::secret_scope::enter();
        crate::journal::secret_scope::scoped(Some(scope), self.handler.execute(input, context))
            .await
    }

    /// The handler alone, for the registry, which has already taken a secret command off its
    /// parents' tapes.
    pub(crate) async fn call_handler(
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

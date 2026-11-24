//! [`CommandRegistry`]: registration, lookup, limits and configuration.

#[allow(clippy::wildcard_imports)]
use super::*;

// COMMAND REGISTRY

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
/// Normative server-level default per-command deadline in milliseconds (`spec/execution-controls.md`).
pub const DEFAULT_COMMAND_TIMEOUT_MS: u64 = 30_000;

/// Normative default maximum number of commands in a single batch (`spec/execution-controls.md`).
pub const DEFAULT_MAX_BATCH_SIZE: usize = 500;

/// Normative default maximum concurrent commands in a single batch (`spec/execution-controls.md`).
pub const DEFAULT_MAX_BATCH_PARALLELISM: usize = 16;

/// Normative default cap on reported issues per `VALIDATION_ERROR` (`spec/execution-controls.md`).
pub const DEFAULT_MAX_VALIDATION_ISSUES: usize = 100;

#[derive(Debug, Clone, Copy)]
struct ExecutionLimits {
    default_timeout_ms: Option<u64>,
    max_batch_size: usize,
    max_batch_parallelism: usize,
    max_validation_issues: usize,
}

impl Default for ExecutionLimits {
    fn default() -> Self {
        Self {
            default_timeout_ms: None,
            max_batch_size: DEFAULT_MAX_BATCH_SIZE,
            max_batch_parallelism: DEFAULT_MAX_BATCH_PARALLELISM,
            max_validation_issues: DEFAULT_MAX_VALIDATION_ISSUES,
        }
    }
}

/// Registry that stores AFD command definitions and dispatches validated executions.
#[derive(Default)]
pub struct CommandRegistry {
    pub(super) commands: RwLock<RegisteredCommands>,
    /// Copied on write, so a call takes the list with one reference count.
    pub(super) middleware: RwLock<Arc<Vec<CommandMiddleware>>>,
    pub(super) journal: RwLock<Option<Arc<JournalRecorder>>>,
    pub(super) context_fields: RwLock<Arc<Vec<ContextField>>>,
    pub(super) call_grant: RwLock<Option<CallGrant>>,
    limits: RwLock<ExecutionLimits>,
}

/// A host's grant check for app-to-app calls ([`CommandRegistry::set_call_grant`]): whether the
/// caller in the context holds a grant naming the command.
pub type CallGrant = Arc<dyn Fn(&str, &CommandContext) -> bool + Send + Sync>;

/// The one `CALL_NOT_GRANTED` refusal (`spec/command-metadata.md`, "App-to-app calls"): fixed
/// bytes that name neither the command nor the reason.
pub(super) fn call_not_granted() -> CommandError {
    CommandError::new(
        error_codes::CALL_NOT_GRANTED,
        "This app may not call that command",
    )
    .with_suggestion(
        "Ask the deployer for a calls grant that names the command; the command must also set expose.apps",
    )
    .with_retryable(false)
}

/// Commands by name, plus their registration order.
#[derive(Default)]
pub(super) struct RegisteredCommands {
    pub(super) by_name: HashMap<String, Arc<CommandDefinition>>,
    pub(super) ordered: Vec<Arc<CommandDefinition>>,
    /// The whole input schemas commands validate with ([`CommandRegistry::register_with_schema`]).
    pub(super) schemas: HashMap<String, Arc<serde_json::Value>>,
    /// The input schemas commands advertise in place of the validation schema
    /// ([`CommandRegistry::register_with_schemas`]).
    pub(super) advertised: HashMap<String, serde_json::Value>,
}

/// Read a lock, ignoring poisoning: no registry invariant spans a panic.
pub(super) fn read_lock<T>(lock: &RwLock<T>) -> RwLockReadGuard<'_, T> {
    lock.read().unwrap_or_else(PoisonError::into_inner)
}

pub(super) fn write_lock<T>(lock: &RwLock<T>) -> RwLockWriteGuard<'_, T> {
    lock.write().unwrap_or_else(PoisonError::into_inner)
}

/// Check a batch request against `max_batch_size` and `max_batch_parallelism`
/// (`spec/execution-controls.md`).
///
/// Returns `Some(CommandError)` with `INVALID_BATCH_REQUEST` (`retryable: false`)
/// when either ceiling is exceeded, or `None` when the request is within bounds.
pub fn check_batch_limits<T>(
    request: &BatchRequest<T>,
    max_batch_size: usize,
    max_batch_parallelism: usize,
) -> Option<CommandError> {
    let hint = format!(
        "Send between 1 and {max_batch_size} commands with parallelism at most {max_batch_parallelism}"
    );
    if request.commands.len() > max_batch_size {
        let mut details = HashMap::new();
        details.insert(
            "count".to_string(),
            serde_json::json!(request.commands.len()),
        );
        details.insert(
            "maxBatchSize".to_string(),
            serde_json::json!(max_batch_size),
        );
        return Some(
            CommandError::new(
                error_codes::INVALID_BATCH_REQUEST,
                format!(
                    "Batch size {} exceeds maximum of {max_batch_size} commands",
                    request.commands.len(),
                ),
            )
            .with_suggestion(hint)
            .with_retryable(false)
            .with_details(details),
        );
    }
    let requested_parallelism = request
        .options
        .as_ref()
        .and_then(|opts| opts.parallelism)
        .unwrap_or(1);
    if requested_parallelism > max_batch_parallelism {
        let mut details = HashMap::new();
        details.insert(
            "parallelism".to_string(),
            serde_json::json!(requested_parallelism),
        );
        details.insert(
            "maxBatchParallelism".to_string(),
            serde_json::json!(max_batch_parallelism),
        );
        return Some(
            CommandError::new(
                error_codes::INVALID_BATCH_REQUEST,
                format!(
                    "Batch parallelism {requested_parallelism} exceeds maximum of {max_batch_parallelism}"
                ),
            )
            .with_suggestion(hint)
            .with_retryable(false)
            .with_details(details),
        );
    }
    None
}

impl CommandRegistry {
    /// Create a new empty registry.
    pub fn new() -> Self {
        Self::default()
    }

    /// Set the registry's default per-command deadline in milliseconds (`spec/execution-controls.md`).
    /// `None` or `Some(0)` disables the default deadline.
    pub fn set_default_timeout_ms(&self, timeout_ms: Option<u64>) {
        write_lock(&self.limits).default_timeout_ms = timeout_ms.filter(|&ms| ms > 0);
    }

    /// The registry's default per-command deadline in milliseconds, if configured.
    pub fn default_timeout_ms(&self) -> Option<u64> {
        read_lock(&self.limits).default_timeout_ms
    }

    /// Set the maximum number of commands accepted in a single batch (default: 500).
    pub fn set_max_batch_size(&self, max: usize) -> Result<(), String> {
        if max == 0 {
            return Err("max_batch_size must be at least 1".to_string());
        }
        write_lock(&self.limits).max_batch_size = max;
        Ok(())
    }

    /// The maximum number of commands accepted in a single batch.
    pub fn max_batch_size(&self) -> usize {
        read_lock(&self.limits).max_batch_size
    }

    /// Set the maximum `options.parallelism` accepted in a single batch (default: 16).
    pub fn set_max_batch_parallelism(&self, max: usize) -> Result<(), String> {
        if max == 0 {
            return Err("max_batch_parallelism must be at least 1".to_string());
        }
        write_lock(&self.limits).max_batch_parallelism = max;
        Ok(())
    }

    /// The maximum `options.parallelism` accepted in a single batch.
    pub fn max_batch_parallelism(&self) -> usize {
        read_lock(&self.limits).max_batch_parallelism
    }

    /// Set the maximum number of validation issues reported per `VALIDATION_ERROR` (default: 100).
    pub fn set_max_validation_issues(&self, max: usize) -> Result<(), String> {
        if max == 0 {
            return Err("max_validation_issues must be at least 1".to_string());
        }
        write_lock(&self.limits).max_validation_issues = max;
        Ok(())
    }

    /// The maximum number of validation issues reported per `VALIDATION_ERROR`.
    pub fn max_validation_issues(&self) -> usize {
        read_lock(&self.limits).max_validation_issues
    }

    /// Check batch size and parallelism against the registry's configured limits
    /// (`spec/execution-controls.md`).
    pub(crate) fn check_batch_limits(
        &self,
        request: &BatchRequest<serde_json::Value>,
    ) -> Option<CommandError> {
        let limits = *read_lock(&self.limits);
        check_batch_limits(request, limits.max_batch_size, limits.max_batch_parallelism)
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
        // A boolean schema is allowed below the root, but a command's input is an object
        // (spec/validation.md).
        if !schema.is_object() {
            return Err(format!(
                "Command '{}': an input schema must be a JSON Schema object",
                command.name
            ));
        }
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
        commands
            .schemas
            .insert(command.name.clone(), Arc::new(schema));
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
            .or_else(|| commands.schemas.get(name).map(|schema| &**schema))
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
    /// calls `next(context)` to run the rest of the chain with the context it passes, and can
    /// inspect or replace the result, or return without calling `next` to short-circuit.
    pub fn add_middleware(&self, middleware: CommandMiddleware) {
        Arc::make_mut(&mut write_lock(&self.middleware)).push(middleware);
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

    /// Set the host's grant check for app-to-app calls (`spec/command-metadata.md`, "App-to-app
    /// calls"): whether the caller in `context` holds a grant naming `command`. AFD does not
    /// define a grant's shape or who the caller is; a host reads its own declared context field,
    /// such as Loam's `caller`, from [`CommandContext::extra`].
    ///
    /// A call with [`CommandInterface::Apps`] runs only when the command exists for the caller,
    /// sets [`ExposeOptions::apps`] and this returns `true`. Otherwise, and without a grant
    /// check, it returns `CALL_NOT_GRANTED` before any other check ([`Self::execute`]). A grant
    /// check that panics refuses (where the target can unwind). It replaces any earlier one.
    pub fn set_call_grant(
        &self,
        grant: impl Fn(&str, &CommandContext) -> bool + Send + Sync + 'static,
    ) {
        *write_lock(&self.call_grant) = Some(Arc::new(grant));
    }

    /// Whether an app's call to `name` may run (see [`Self::set_call_grant`]).
    pub(super) fn app_call_granted(&self, name: &str, context: &CommandContext) -> bool {
        let Some(grant) = read_lock(&self.call_grant).clone() else {
            return false;
        };
        let exposed = self.get(name).is_some_and(|command| {
            command.expose.apps
                && context
                    .server()
                    .known
                    .as_ref()
                    .is_none_or(|known| known.allows(&command))
        });
        exposed
            && std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| grant(name, context)))
                .unwrap_or(false)
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

/// Create an empty [`CommandRegistry`].
pub fn create_command_registry() -> CommandRegistry {
    CommandRegistry::new()
}

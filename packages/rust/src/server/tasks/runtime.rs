//! Creating, running and answering for tasks (see the [parent module](super)).

use std::collections::HashMap;
use std::panic::AssertUnwindSafe;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::future::{select, Either};
use futures_util::FutureExt;
use rmcp::model::{
    CallToolResponse, CancelTaskMethod, CancelTaskParams, ClientCapabilities, ConstString,
    CreateTaskResult, DetailedTask, GetTaskMethod, GetTaskParams, GetTaskResult,
    ServerCapabilities, Task, TaskPayload, TaskStatus, UpdateTaskMethod, UpdateTaskParams,
    TASKS_EXTENSION_ID,
};
use rmcp::service::RequestContext;
use rmcp::{ErrorData, RoleServer};
use serde_json::{json, Map, Value};

use super::{
    InMemoryTaskStore, TaskChange, TaskOptions, TaskOwner, TaskRecord, TaskState, TaskStore,
    TaskStoreError,
};
use crate::cancellation::{CancellationSignal, TaskProgress};
use crate::server::{authz, confirmations, context_hook, router, McpServer};
use crate::{
    error_codes, failure, Clock, CommandContext, CommandDefinition, CommandError, CommandRegistry,
    CommandResult, Credentials, SYSTEM_CLOCK,
};

/// The answer to a task that is not the caller's, has expired, or does not exist: one answer
/// for all, so an id reveals nothing (SEP-2663: `-32602` for an invalid or unknown task id).
fn task_not_found() -> ErrorData {
    ErrorData::invalid_params("Task not found", None)
}

/// A generic internal error that names no one and nothing.
fn internal() -> ErrorData {
    ErrorData::internal_error("Internal error", None)
}

/// The JSON-RPC error object of a task that failed inside the server.
fn internal_error_object() -> Map<String, Value> {
    let mut error = Map::new();
    error.insert("code".into(), json!(-32603));
    error.insert("message".into(), json!("Internal error"));
    error
}

/// JSON-RPC `-32021`, naming the Tasks extension (SEP-2663).
pub(crate) fn missing_capability() -> ErrorData {
    ErrorData::missing_required_client_capability(
        ClientCapabilities::builder().enable_tasks().build(),
    )
}

/// Whether this request may get a task: an MCP 2026-07-28 request whose own `_meta` client
/// capabilities declare the extension. A 2025 request never does, whatever its session declared
/// (SEP-2663, "Backward Compatibility").
pub(crate) fn declares_tasks(context: &RequestContext<RoleServer>) -> bool {
    confirmations::is_modern(context)
        && context
            .meta
            .client_capabilities()
            .is_some_and(|capabilities| capabilities.supports_tasks())
}

// ═══════════════════════════════════════════════════════════════════════════════
// IDS AND THE WIRE
// ═══════════════════════════════════════════════════════════════════════════════

const BASE32: &[u8; 32] = b"abcdefghijklmnopqrstuvwxyz234567";
/// 128 bits in unpadded base32.
const ID_LENGTH: usize = 26;

/// A task id: 128 bits from the OS random source, unpadded lowercase base32 (RFC 4648).
fn new_task_id() -> Result<String, getrandom::Error> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes)?;
    let mut id = String::with_capacity(ID_LENGTH);
    let mut buffer: u32 = 0;
    let mut bits = 0;
    for byte in bytes {
        buffer = (buffer << 8) | u32::from(byte);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            id.push(BASE32[((buffer >> bits) & 31) as usize] as char);
        }
    }
    if bits > 0 {
        id.push(BASE32[((buffer << (5 - bits)) & 31) as usize] as char);
    }
    Ok(id)
}

/// Whether `id` could be a task id this server issued; anything else is unknown without asking
/// the store.
fn is_task_id(id: &str) -> bool {
    id.len() == ID_LENGTH && id.bytes().all(|byte| BASE32.contains(&byte))
}

/// Milliseconds since the epoch as ISO 8601 with milliseconds, in UTC.
fn iso(ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(ms)
        .unwrap_or_default()
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// The extension's `Task` of a record.
fn wire_task(record: &TaskRecord) -> Task {
    let status = match record.status {
        TaskState::Working => TaskStatus::Working,
        TaskState::Completed => TaskStatus::Completed,
        TaskState::Failed => TaskStatus::Failed,
        TaskState::Cancelled => TaskStatus::Cancelled,
    };
    let mut task = Task::new(
        record.id.clone(),
        status,
        iso(record.created_at),
        iso(record.last_updated_at),
    )
    .with_ttl_ms(record.ttl_ms)
    .with_poll_interval_ms(record.poll_interval_ms);
    if let Some(message) = &record.status_message {
        task = task.with_status_message(message.clone());
    }
    task
}

/// The extension's `DetailedTask` of a record.
fn detailed(record: &TaskRecord) -> DetailedTask {
    let payload = match record.status {
        TaskState::Working => TaskPayload::Working,
        TaskState::Completed => TaskPayload::Completed {
            result: record.result.clone().unwrap_or_default(),
        },
        TaskState::Failed => TaskPayload::Failed {
            error: record.error.clone().unwrap_or_else(internal_error_object),
        },
        TaskState::Cancelled => TaskPayload::Cancelled,
    };
    DetailedTask::new(wire_task(record), payload)
}

// ═══════════════════════════════════════════════════════════════════════════════
// THE RUNTIME
// ═══════════════════════════════════════════════════════════════════════════════

/// Why a running task was stopped.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Stop {
    /// `tasks/cancel`.
    Cancelled,
    /// The token that started it expired.
    TokenExpired,
    /// Its `ttlMs` ended, or its record is gone.
    TtlEnded,
}

/// A task running in this process.
struct Running {
    signal: CancellationSignal,
    reason: Mutex<Option<Stop>>,
}

impl Running {
    /// Stop it for `reason` (the first reason wins) and fire its signal.
    fn stop(&self, reason: Stop) {
        {
            let mut current = lock(&self.reason);
            if current.is_none() {
                *current = Some(reason);
            }
        }
        self.signal.cancel();
    }

    fn reason(&self) -> Option<Stop> {
        *lock(&self.reason)
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// The server's tasks: the store, the options and the tasks running in this process.
pub(crate) struct TaskRuntime {
    pub(crate) store: Arc<dyn TaskStore>,
    pub(crate) options: TaskOptions,
    running: Mutex<HashMap<String, Arc<Running>>>,
}

impl Default for TaskRuntime {
    fn default() -> Self {
        Self::new(Arc::new(InMemoryTaskStore::new()), TaskOptions::default())
    }
}

impl TaskRuntime {
    pub(crate) fn new(store: Arc<dyn TaskStore>, options: TaskOptions) -> Self {
        Self {
            store,
            options,
            running: Mutex::new(HashMap::new()),
        }
    }

    /// Hold a place for task `id` among the tasks running in this process, unless
    /// [`TaskOptions::max_running`] already run.
    fn reserve(&self, id: &str) -> Option<Arc<Running>> {
        let mut running = lock(&self.running);
        if running.len() >= self.options.max_running() {
            return None;
        }
        let task = Arc::new(Running {
            signal: CancellationSignal::new(),
            reason: Mutex::new(None),
        });
        running.insert(id.to_owned(), Arc::clone(&task));
        Some(task)
    }

    fn unregister(&self, id: &str) {
        lock(&self.running).remove(id);
    }

    fn running(&self, id: &str) -> Option<Arc<Running>> {
        lock(&self.running).get(id).cloned()
    }
}

/// The caller of a `tasks/*` request: its owner key and its verified credentials.
struct Caller {
    owner: TaskOwner,
    credentials: Option<Arc<Credentials>>,
}

/// A context hook's refusal of a `tasks/*` request, as a JSON-RPC error: only the fields a
/// client can act on (the hook's refusal already has no `details`).
fn hook_refusal(error: CommandError) -> ErrorData {
    let mut data = Map::new();
    data.insert("code".into(), json!(error.code));
    if let Some(suggestion) = &error.suggestion {
        data.insert("suggestion".into(), json!(suggestion));
    }
    ErrorData::invalid_request(error.message, Some(Value::Object(data)))
}

/// One answer for every limit (the owner's, the store's, the process's running tasks), so the
/// answer says no more than that a limit was reached.
fn task_limit() -> CommandError {
    CommandError::new(
        error_codes::RATE_LIMITED,
        "The task could not start: a task limit was reached, so nothing ran",
    )
    .with_suggestion("Wait for one of your tasks to finish or expire, then call again.")
    .with_retryable(true)
}

/// Unregisters a task from the running set however its runner ends.
struct Registered(Arc<TaskRuntime>, String);

impl Drop for Registered {
    fn drop(&mut self) {
        self.0.unregister(&self.1);
    }
}

/// The refusal of a `required` command on a server that cannot tell its HTTP callers apart: it
/// cannot run inline, and no task is created without an owner that tells callers apart.
pub(crate) fn unidentified_callers(command: &str) -> CommandError {
    CommandError::new(
        error_codes::UNAUTHORIZED,
        format!(
            "Command '{}' runs only as a task, and this server cannot tell its callers apart, so it starts no task",
            crate::commands::truncate_name(command)
        ),
    )
    .with_suggestion(
        "Nothing ran. The server's operator must configure authorization, or declare that the server's context hook identifies every caller; calling again will not help until then.",
    )
    .with_retryable(false)
}

/// Remove the Tasks extension from `capabilities`.
pub(crate) fn without_tasks(capabilities: &mut ServerCapabilities) {
    if let Some(extensions) = capabilities.extensions.as_mut() {
        extensions.remove(TASKS_EXTENSION_ID);
        if extensions.is_empty() {
            capabilities.extensions = None;
        }
    }
}

impl McpServer {
    /// Whether an MCP-exposed command may run as a task.
    pub(crate) fn serves_tasks(&self) -> bool {
        self.inner
            .registry
            .list()
            .iter()
            .any(|command| command.expose.mcp && command.task_support().allows_task())
    }

    /// Whether the configuration identifies every HTTP caller: authorization, or the declaration
    /// that the context hook does, while a hook is installed.
    pub(crate) fn identifies_http_callers(&self) -> bool {
        authz::configured(self) || self.hook_identifies_callers()
    }

    /// The host declared that its context hook identifies every caller, and a hook is installed.
    fn hook_identifies_callers(&self) -> bool {
        self.inner.tasks.options.callers_identified_by_hook() && self.inner.context_hook.is_some()
    }

    /// Whether the server declares the extension to the request `context`: a task command, and a
    /// caller it can tell apart from the configuration (a request without HTTP, or a server that
    /// identifies its HTTP callers).
    pub(crate) fn declares_tasks_to(&self, context: &RequestContext<RoleServer>) -> bool {
        self.serves_tasks()
            && (context.extensions.get::<http::request::Parts>().is_none()
                || self.identifies_http_callers())
    }

    /// Whether a task may be created for, or answered to, this caller: a request without HTTP
    /// (one client per connection), verified credentials, or the hook's declaration.
    pub(crate) fn identifies_caller(
        &self,
        context: &RequestContext<RoleServer>,
        credentials: Option<&Credentials>,
    ) -> bool {
        context.extensions.get::<http::request::Parts>().is_none()
            || credentials.is_some()
            || self.hook_identifies_callers()
    }

    /// The clock tasks are timed by: the server's ([`McpServer::with_clock`]).
    fn task_clock(&self) -> Arc<dyn Clock> {
        self.inner
            .context_defaults
            .clock
            .clone()
            .unwrap_or_else(|| Arc::new(SYSTEM_CLOCK))
    }

    /// Create a task for a call routed to `command`, after every check an inline call meets
    /// before dispatch, and start it. `context` is the context the inline call would run with.
    pub(crate) async fn start_task(
        &self,
        command: &CommandDefinition,
        input: Value,
        mut context: CommandContext,
    ) -> Result<CallToolResponse, ErrorData> {
        // The owner (M8). Credentials that cannot be bound get no task, and nothing runs.
        let Ok(binding) =
            crate::principal_binding(context.actor.as_ref(), context.credentials.as_deref())
        else {
            return Err(internal());
        };
        let owner = TaskOwner::from_binding(binding);
        let Ok(id) = new_task_id() else {
            return Err(internal());
        };
        let runtime = Arc::clone(&self.inner.tasks);
        let clock = self.task_clock();
        let now = clock.now();
        let _ = runtime.store.expire(now).await;
        let options = runtime.options.clone();
        let expires_at = context
            .credentials
            .as_ref()
            .map(|credentials| credentials.expires_at);
        let record = TaskRecord::new(
            id.clone(),
            owner.clone(),
            command.name.clone(),
            now,
            options.ttl_for(now, expires_at),
            options.poll_interval_ms(),
        );
        let task = wire_task(&record);
        let ttl_deadline = record.expires_at();
        // A place among the tasks this process runs, whatever the store allows.
        let Some(running) = runtime.reserve(&id) else {
            return refused(task_limit());
        };
        let registered = Registered(Arc::clone(&runtime), id.clone());
        // Durable before the server answers; a store that cannot record it fails the call.
        match runtime.store.create(record).await {
            Ok(()) => {}
            Err(TaskStoreError::OwnerLimit { .. } | TaskStoreError::TotalLimit { .. }) => {
                return refused(task_limit());
            }
            Err(_) => {
                return refused(
                    CommandError::new(
                        error_codes::INTERNAL_ERROR,
                        "The task could not be recorded, so nothing ran",
                    )
                    .with_suggestion("Retry later.")
                    .with_retryable(true),
                );
            }
        }
        let progress = Arc::new(TaskProgress::default());
        context.cancellation = Some(running.signal.clone());
        context.task_progress = Some(Arc::clone(&progress));
        let token_deadline = context
            .credentials
            .as_ref()
            .map(|credentials| credentials.expires_at.saturating_mul(1000));
        let job = Job {
            registered,
            runtime,
            registry: Arc::clone(&self.inner.registry),
            clock,
            id,
            owner,
            command: command.name.clone(),
            mutation: command.mutation,
            input,
            context,
            running,
            progress,
            token_deadline,
            ttl_deadline,
        };
        tokio::spawn(run(job));
        Ok(CallToolResponse::Task(CreateTaskResult::new(task)))
    }

    /// Authorize a `tasks/*` request as a `tools/call` that names no command, run the context
    /// hook, and bind the caller (`spec/command-metadata.md`, "Tasks").
    async fn task_caller<M: ConstString>(
        &self,
        context: &RequestContext<RoleServer>,
    ) -> Result<Caller, ErrorData> {
        let method = M::VALUE;
        // A server that cannot tell its HTTP callers apart has no tasks: the answer of a server
        // without the extension, whatever the request declared.
        if !self.declares_tasks_to(context) {
            return Err(ErrorData::method_not_found::<M>());
        }
        // `rmcp` refuses a request that does not declare the extension; a 2025 request is
        // refused here too, since the extension is not defined for it.
        if !declares_tasks(context) {
            return Err(missing_capability());
        }
        // With authorization, the request reached here only with verified credentials.
        let credentials = authz::check_request(self, context)?;
        let mut base = self.base_context().with_trace_id(router::trace_id("task"));
        let mut defaults = self.inner.context_defaults.clone();
        if let Some(credentials) = &credentials {
            base.credentials = Some(Arc::clone(credentials));
            base.actor = Some(credentials.default_actor());
            defaults.actor = Some(credentials.default_actor());
        }
        let base = context_hook::build_context(
            self.inner.context_hook.as_ref(),
            &defaults,
            method,
            context,
            base,
        )
        .await
        .map_err(|error| hook_refusal(*error))?;
        // The verified credentials, whatever the hook did with them.
        let Ok(binding) = crate::principal_binding(base.actor.as_ref(), credentials.as_deref())
        else {
            return Err(internal());
        };
        Ok(Caller {
            owner: TaskOwner::from_binding(binding),
            credentials,
        })
    }

    /// The caller's live task `id`, or the one unknown-task answer. `needs_command` also asks
    /// that the caller still hold what the task's command needs; `tasks/cancel` does not, since
    /// stopping a task only takes authority away.
    async fn find_task(
        &self,
        caller: &Caller,
        id: &str,
        needs_command: bool,
    ) -> Result<TaskRecord, ErrorData> {
        if !is_task_id(id) {
            return Err(task_not_found());
        }
        let now = self.task_clock().now();
        let found = self
            .inner
            .tasks
            .store
            .get(id, &caller.owner)
            .await
            .map_err(|_| internal())?;
        // The owner check again, whatever the store did, and the TTL, whether or not the store
        // purged.
        let record = match found {
            Some(record)
                if record.id == id
                    && record.owner.matches(&caller.owner)
                    && !record.is_expired(now) =>
            {
                record
            }
            _ => return Err(task_not_found()),
        };
        // The owner must still hold what the task's command needs.
        if needs_command {
            if let Some(refusal) =
                authz::task_refusal(self, &record.command, caller.credentials.as_deref())
            {
                return Err(refusal);
            }
        }
        Ok(record)
    }

    pub(crate) async fn serve_get_task(
        &self,
        params: GetTaskParams,
        context: &RequestContext<RoleServer>,
    ) -> Result<GetTaskResult, ErrorData> {
        let caller = self.task_caller::<GetTaskMethod>(context).await?;
        let record = self.find_task(&caller, &params.task_id, true).await?;
        Ok(GetTaskResult::new(detailed(&record)))
    }

    /// No AFD task waits for input, so every `inputResponses` key is one that is not
    /// outstanding, which the extension says to ignore: the answer is the acknowledgement.
    pub(crate) async fn serve_update_task(
        &self,
        params: UpdateTaskParams,
        context: &RequestContext<RoleServer>,
    ) -> Result<(), ErrorData> {
        let caller = self.task_caller::<UpdateTaskMethod>(context).await?;
        self.find_task(&caller, &params.task_id, true).await?;
        Ok(())
    }

    /// Cooperative cancellation: record the request, so a runner in any process sharing the
    /// store stops the task, and stop it now when it runs here. A finished task is unchanged.
    pub(crate) async fn serve_cancel_task(
        &self,
        params: CancelTaskParams,
        context: &RequestContext<RoleServer>,
    ) -> Result<(), ErrorData> {
        let caller = self.task_caller::<CancelTaskMethod>(context).await?;
        let record = self.find_task(&caller, &params.task_id, false).await?;
        if record.status.is_terminal() {
            return Ok(());
        }
        let runtime = &self.inner.tasks;
        runtime
            .store
            .update(&record.id, &caller.owner, TaskChange::CancelRequested)
            .await
            .map_err(|_| internal())?;
        if let Some(running) = runtime.running(&record.id) {
            running.stop(Stop::Cancelled);
        }
        Ok(())
    }
}

fn refused(error: CommandError) -> Result<CallToolResponse, ErrorData> {
    router::tool_result(&failure::<Value>(error), true)
}

// ═══════════════════════════════════════════════════════════════════════════════
// THE RUNNER
// ═══════════════════════════════════════════════════════════════════════════════

struct Job {
    /// Keeps the task in the running set until the runner ends, however it ends.
    registered: Registered,
    runtime: Arc<TaskRuntime>,
    registry: Arc<CommandRegistry>,
    clock: Arc<dyn Clock>,
    id: String,
    owner: TaskOwner,
    command: String,
    /// Whether the command changes state, so a stopped run may have changed it.
    mutation: bool,
    input: Value,
    context: CommandContext,
    running: Arc<Running>,
    progress: Arc<TaskProgress>,
    /// The credentials' `expiresAt`, in milliseconds.
    token_deadline: Option<i64>,
    /// When the task's `ttlMs` ends.
    ttl_deadline: i64,
}

/// How far the handler got when a task was stopped.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Stage {
    /// It never started.
    NotStarted,
    /// It was stopped at an `.await`.
    Running,
    /// It returned, after the stop was due.
    Finished,
}

enum Outcome {
    Finished(Box<CommandResult<Value>>),
    Stopped(Stop, Stage),
    /// The runner itself failed.
    Internal,
}

/// What is due at `now`: the token's expiry first, then the TTL.
fn due(token_deadline: Option<i64>, ttl_deadline: i64, now: i64) -> Option<Stop> {
    if token_deadline.is_some_and(|deadline| now >= deadline) {
        Some(Stop::TokenExpired)
    } else if now >= ttl_deadline {
        Some(Stop::TtlEnded)
    } else {
        None
    }
}

/// The outcome of a handler that returned: its result, unless the token had expired or the TTL
/// had ended by then. A `tasks/cancel` that came too late to stop it does not discard a result
/// the command already produced (SEP-2663: a cancelled task "MAY ultimately reach a terminal
/// status other than `cancelled` if the work finished before cancellation could take effect").
fn finished(due: Option<Stop>, result: CommandResult<Value>) -> Outcome {
    match due {
        Some(stop) => Outcome::Stopped(stop, Stage::Finished),
        None => Outcome::Finished(Box::new(result)),
    }
}

async fn run(job: Job) {
    let runtime = Arc::clone(&job.runtime);
    let store = Arc::clone(&runtime.store);
    let clock = Arc::clone(&job.clock);
    let id = job.id.clone();
    let owner = job.owner.clone();
    let mutation = job.mutation;
    let options = runtime.options.clone();
    let outcome = AssertUnwindSafe(drive(job))
        .catch_unwind()
        .await
        .unwrap_or(Outcome::Internal);
    let now = clock.now();
    let change = match outcome {
        Outcome::Finished(result) => completion(&result, options.max_result_bytes(), now),
        Outcome::Stopped(Stop::Cancelled, _) => TaskChange::Cancelled { at: now },
        Outcome::Stopped(Stop::TokenExpired, stage) => {
            completion(&failure(token_expired(stage, mutation)), usize::MAX, now)
        }
        Outcome::Stopped(Stop::TtlEnded, _) => {
            // Gone: its record goes with its TTL.
            let _ = store.expire(now).await;
            return;
        }
        Outcome::Internal => TaskChange::Failed {
            error: internal_error_object(),
            at: now,
        },
    };
    // A store that fails is asked again; the task stays `working` until its TTL if it never
    // answers.
    let pause = Duration::from_millis(options.check_interval_ms());
    for attempt in 0..3 {
        if store.update(&id, &owner, change.clone()).await.is_ok() {
            break;
        }
        if attempt < 2 {
            tokio::time::sleep(pause).await;
        }
    }
}

/// Run the command until it finishes or the task is stopped.
async fn drive(job: Job) -> Outcome {
    let Job {
        registered: _registered,
        runtime,
        registry,
        clock,
        id,
        owner,
        command,
        mutation: _,
        input,
        context,
        running,
        progress,
        token_deadline,
        ttl_deadline,
    } = job;
    let store = Arc::clone(&runtime.store);
    let check = runtime.options.check_interval_ms();
    // A token that expired before the task could start, or a cancel that came first: the
    // handler never runs.
    if let Some(stop) = due(token_deadline, ttl_deadline, clock.now()).or(running.reason()) {
        return Outcome::Stopped(stop, Stage::NotStarted);
    }
    let mut execution = Box::pin(registry.execute(&command, input, Some(context)));
    loop {
        let now = clock.now();
        if let Some(stop) = due(token_deadline, ttl_deadline, now) {
            running.stop(stop);
        }
        if running.reason().is_none() {
            if let Some(message) = progress.take() {
                let _ = store
                    .update(&id, &owner, TaskChange::Progress { message, at: now })
                    .await;
            }
            // A cancellation recorded by another process, or a record that is gone.
            match store.get(&id, &owner).await {
                Ok(Some(record)) if record.cancel_requested => running.stop(Stop::Cancelled),
                Ok(Some(record)) if record.is_expired(now) => running.stop(Stop::TtlEnded),
                Ok(None) => running.stop(Stop::TtlEnded),
                _ => {}
            }
        }
        if let Some(stop) = running.reason() {
            // Dropping the execution stops the handler at its next `.await`.
            return Outcome::Stopped(stop, Stage::Running);
        }
        let nearest = token_deadline.map_or(ttl_deadline, |token| token.min(ttl_deadline));
        let until = u64::try_from(nearest.saturating_sub(now))
            .unwrap_or(0)
            .max(1);
        let wait = Duration::from_millis(check.min(until));
        let stopped = running.signal.cancelled();
        let tick = Box::pin(tokio::time::sleep(wait));
        match select(execution.as_mut(), select(stopped, tick)).await {
            Either::Left((result, _)) => {
                return finished(due(token_deadline, ttl_deadline, clock.now()), result);
            }
            Either::Right(_) => continue,
        }
    }
}

/// `TASK_TOKEN_EXPIRED` (`spec/error-codes.md`). Retryable as it is unless the command is a
/// mutation whose handler started: it may then have made its change, in part or in full.
fn token_expired(stage: Stage, mutation: bool) -> CommandError {
    let (message, suggestion) = match (stage, mutation) {
        (Stage::NotStarted, _) => (
            "The task did not start: the access token that started it had expired",
            "Nothing ran. Obtain a new access token and start the task again.",
        ),
        (Stage::Running, false) => (
            "The task stopped because the access token that started it expired",
            "Obtain a new access token and start the task again.",
        ),
        (Stage::Running, true) => (
            "The task stopped because the access token that started it expired",
            "The command may have made part of its change before it stopped: check its effect, then start it again with a new access token if it is still needed.",
        ),
        (Stage::Finished, false) => (
            "The task finished after the access token that started it expired, so its result is not delivered",
            "Obtain a new access token and start the task again.",
        ),
        (Stage::Finished, true) => (
            "The task finished after the access token that started it expired, so its result is not delivered",
            "The command ran to the end and made its change: check its effect before starting it again with a new access token.",
        ),
    };
    CommandError::new(error_codes::TASK_TOKEN_EXPIRED, message)
        .with_suggestion(suggestion)
        .with_retryable(stage == Stage::NotStarted || !mutation)
}

/// The change that completes a task with `result`, as an inline call would return it: a result
/// larger than `limit` bytes is replaced by a failure that says the command ran.
fn completion(result: &CommandResult<Value>, limit: usize, at: i64) -> TaskChange {
    let Some(kept) = call_tool_result(result) else {
        return TaskChange::Failed {
            error: internal_error_object(),
            at,
        };
    };
    let size = serde_json::to_vec(&kept).map_or(usize::MAX, |bytes| bytes.len());
    if size <= limit {
        return TaskChange::Completed { result: kept, at };
    }
    let too_large = CommandError::new(
        error_codes::INTERNAL_ERROR,
        "The command ran, but its result is larger than this server keeps for a task",
    )
    .with_suggestion(
        "The command ran: check its effect before running it again. For a read, ask for less (narrow the request or set an output budget).",
    )
    .with_details(HashMap::from([
        ("limitBytes".to_owned(), json!(limit)),
        ("actualBytes".to_owned(), json!(size)),
    ]))
    .with_retryable(false);
    match call_tool_result(&failure(too_large)) {
        Some(result) => TaskChange::Completed { result, at },
        None => TaskChange::Failed {
            error: internal_error_object(),
            at,
        },
    }
}

/// The `CallToolResult` an inline call returns for `result`, as a JSON object.
fn call_tool_result(result: &CommandResult<Value>) -> Option<Map<String, Value>> {
    match router::tool_result(result, !result.success) {
        Ok(CallToolResponse::Complete(call)) => match serde_json::to_value(call) {
            Ok(Value::Object(object)) => Some(object),
            _ => None,
        },
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_128_random_bits_in_base32() {
        let first = new_task_id().unwrap();
        let second = new_task_id().unwrap();
        assert_eq!(first.len(), ID_LENGTH);
        assert!(is_task_id(&first));
        assert_ne!(first, second);
        // The last character carries 3 bits: 128 = 25 × 5 + 3.
        let last = first.as_bytes()[ID_LENGTH - 1];
        let value = BASE32.iter().position(|&c| c == last).unwrap();
        assert_eq!(value & 0b11, 0);
    }

    #[test]
    fn malformed_ids_are_not_task_ids() {
        assert!(!is_task_id(""));
        assert!(!is_task_id("ABCDEFGHIJKLMNOPQRSTUVWXYZ"));
        assert!(!is_task_id("abcdefghijklmnopqrstuvwxy1"));
        assert!(!is_task_id(&"a".repeat(27)));
    }

    #[test]
    fn the_token_is_due_before_the_ttl() {
        assert_eq!(due(Some(10), 10, 10), Some(Stop::TokenExpired));
        assert_eq!(due(Some(20), 10, 10), Some(Stop::TtlEnded));
        assert_eq!(due(None, 10, 9), None);
        assert_eq!(due(Some(10), 20, 9), None);
    }

    #[test]
    fn a_late_cancel_keeps_a_finished_result_and_a_late_token_does_not() {
        let result = || crate::success(json!(1));
        assert!(matches!(finished(None, result()), Outcome::Finished(_)));
        assert!(matches!(
            finished(Some(Stop::TokenExpired), result()),
            Outcome::Stopped(Stop::TokenExpired, Stage::Finished)
        ));
        assert!(matches!(
            finished(Some(Stop::TtlEnded), result()),
            Outcome::Stopped(Stop::TtlEnded, Stage::Finished)
        ));
    }

    #[test]
    fn token_expiry_is_retryable_unless_a_mutation_may_have_run() {
        for (stage, mutation, retryable) in [
            (Stage::NotStarted, true, true),
            (Stage::NotStarted, false, true),
            (Stage::Running, false, true),
            (Stage::Running, true, false),
            (Stage::Finished, false, true),
            (Stage::Finished, true, false),
        ] {
            let error = token_expired(stage, mutation);
            assert_eq!(error.code, error_codes::TASK_TOKEN_EXPIRED);
            assert_eq!(error.retryable, Some(retryable), "{stage:?} {mutation}");
        }
    }

    #[test]
    fn iso_timestamps_have_milliseconds() {
        assert_eq!(iso(1_793_016_000_123), "2026-10-26T12:00:00.123Z");
    }
}

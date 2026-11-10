//! MCP Tasks for long-running commands (`spec/command-metadata.md`, "Tasks"; the Tasks extension
//! `io.modelcontextprotocol/tasks`, SEP-2663, revision 2026-07-28).
//!
//! A command declares [`TaskSupport`](crate::TaskSupport) with
//! [`CommandDefinition::with_task`](crate::CommandDefinition::with_task). The server declares the
//! extension in its capabilities when one MCP-exposed command may run as a task, and then:
//!
//! - **Negotiation.** Only an MCP 2026-07-28 request that declares the extension in its own
//!   `_meta` client capabilities gets a task; a 2025 request, or one that does not declare it,
//!   never does (SEP-2663: under 2025-11-25 the extension "is not defined"). For such a request
//!   an `optional` command runs inline and a `required` one is JSON-RPC `-32021`, naming the
//!   extension. Only a call that routes to one command (its own tool, a hybrid first-class tool,
//!   a grouped tool or `afd-call`) becomes a task; in `afd-batch` and `afd-pipe` an `optional`
//!   step runs inline and a `required` step fails the whole request (`INVALID_BATCH_REQUEST`,
//!   `INVALID_PIPELINE_REQUEST`) before any step runs.
//! - **Creating.** Everything an inline call meets before dispatch happens first: the bearer
//!   layer's 403, the context hook, the scope check after routing, the context check and the
//!   confirmation gate. The id holds 128 bits from the OS random source. The record is in the
//!   [`TaskStore`] before the server answers with `CreateTaskResult`: a store that cannot record
//!   it fails the call and nothing runs. Its owner ([`TaskOwner`]) is the call's
//!   [principal binding](crate::principal_binding); it holds no token and no credentials.
//! - **Running.** The command runs through [`CommandRegistry::execute`](crate::CommandRegistry::execute)
//!   (validation, middleware, handler) on a fresh context with the call's actor, credentials,
//!   trace id, declared context fields and output budget ask, and a
//!   [`CancellationSignal`](crate::CancellationSignal). The signal fires on `tasks/cancel`, when
//!   the task's `ttlMs` ends, and at the credentials' `expiresAt`; the server then stops the
//!   handler at its next `.await`. The result is the `CallToolResult` an inline call returns:
//!   `completed`, with `isError` for a failed `CommandResult`; `failed` only for a JSON-RPC error;
//!   `cancelled` after a `tasks/cancel` that stopped it (a handler that had already returned
//!   keeps its result). A task still working at its token's expiry completes with the failure
//!   `TASK_TOKEN_EXPIRED`, and so does one whose handler returned after it (the result is not
//!   delivered) or whose token expired before it could start (the handler never runs); it is
//!   retryable unless the command is a mutation whose handler started, which may have made its
//!   change. At its `ttlMs` the task is gone; [`TaskOptions::with_ttl_capped_at_token_expiry`]
//!   ends the TTL at the token's expiry plus a grace. Progress
//!   ([`CommandContext::report_progress`](crate::CommandContext::report_progress)) sets
//!   `statusMessage` and `lastUpdatedAt`; no notification is sent.
//! - **`tasks/get`, `tasks/update`, `tasks/cancel`.** Each passes the same checks as a
//!   `tools/call` that names no command (fail closed without verified credentials, the required
//!   scopes), runs the context hook (with [`ContextHookRequest::tool`](super::ContextHookRequest::tool)
//!   set to the method name), and then the **owner check**: the caller's principal binding must
//!   equal the task's owner, in the store and again in the server. A task owned by anyone else,
//!   an expired task, a malformed id and an unknown id all get the same JSON-RPC `-32602`
//!   "Task not found", so an id reveals nothing. On an authorized server the owner must also
//!   still hold what the task's command needs (its `scopes`, or the resolver's `visible`) to read
//!   or update it, else `-32600` with `data.code` `INSUFFICIENT_SCOPE`; cancelling only takes
//!   authority away, so `tasks/cancel` does not ask that. `tasks/update` finds no task waiting for
//!   input and acknowledges, ignoring every `inputResponses` key, as the extension says for keys
//!   that are not outstanding. `tasks/cancel` asks for cancellation and acknowledges; a finished
//!   task is unchanged. On Streamable HTTP, `rmcp` checks that `Mcp-Name` carries the task id.
//!
//! The default store, [`InMemoryTaskStore`], serves one process and is bounded: at most
//! [`DEFAULT_MAX_TASKS_PER_OWNER`] tasks per owner and [`DEFAULT_MAX_TASKS`] in all, dropping
//! finished tasks early to make room, with every kept result at most
//! [`DEFAULT_MAX_TASK_RESULT_BYTES`] ([`TaskOptions::with_max_result_bytes`]); and one process
//! runs at most [`DEFAULT_MAX_RUNNING_TASKS`] at once ([`TaskOptions::with_max_running`]),
//! whatever the store allows. A call over a limit fails with `RATE_LIMITED` (retryable) and
//! nothing runs. A host with several processes behind one URL supplies a shared store with
//! [`McpServer::with_task_store`](super::McpServer::with_task_store); cancellation then reaches a
//! task in another process through the store's `cancelRequested` flag, which the runner reads
//! every [`TaskOptions::with_check_interval_ms`].
//!
//! # Callers the server must tell apart
//!
//! A task's owner is only as good as the principal binding, so the server creates a task only
//! for a caller it can tell apart from every other:
//!
//! - **Without an HTTP request** (stdio, or a transport marked trusted), there is one client per
//!   connection: tasks work as described.
//! - **Over HTTP**, the call must carry verified credentials (authorization, the `server-auth`
//!   feature), or the host must declare that its context hook identifies callers
//!   ([`TaskOptions::with_callers_identified_by_hook`], counted only while a hook is installed).
//!
//! Otherwise the server cannot tell its HTTP callers apart, and it behaves as a server without the
//! extension: it does not declare it (`server/discover`, `initialize`), `tasks/get`,
//! `tasks/update` and `tasks/cancel` are `-32601`, and an `optional` command runs inline. A
//! `required` command, which cannot run inline, fails with an `UNAUTHORIZED` result whose
//! suggestion names the two configurations, before anything runs, whether or not the request
//! declared the extension. This is decided per request, from the configuration and the request,
//! not at registration or startup: a `required` command registers on any server, since
//! authorization may be configured later, and a host that serves the server on its own HTTP stack
//! is held to the same rule.

use std::collections::HashMap;
use std::fmt;
use std::sync::Mutex;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::{CommandContext, CommandDefinition, CommandError};

pub use rmcp::model::TASKS_EXTENSION_ID;

mod runtime;
pub(crate) use runtime::{
    declares_tasks, missing_capability, unidentified_callers, without_tasks, TaskRuntime,
};

/// The `CallToolResult` an inline call returns for a command that failed with `error`, as a
/// task's result holds it (`completed`, with `isError`): for a host's store that ends a task
/// itself, as one whose process died. `None` only when the result cannot be serialized.
pub fn failure_result(error: CommandError) -> Option<Map<String, Value>> {
    runtime::call_tool_result(&crate::failure(error))
}

/// A task's default `ttlMs`: one hour, as Umbel's tasks (its section 12.2).
pub const DEFAULT_TASK_TTL_MS: u64 = 3_600_000;

/// A task's default `pollIntervalMs`: one second.
pub const DEFAULT_TASK_POLL_INTERVAL_MS: u64 = 1_000;

/// How often a running task's deadlines, progress and the store's cancellation flag are checked
/// by default: every second.
pub const DEFAULT_TASK_CHECK_INTERVAL_MS: u64 = 1_000;

/// The largest result a task keeps by default, in bytes of its JSON: 1 MiB.
pub const DEFAULT_MAX_TASK_RESULT_BYTES: usize = 1024 * 1024;

/// [`InMemoryTaskStore`]'s default limit of tasks one owner holds at once (working or finished,
/// until each one's `ttlMs` ends).
pub const DEFAULT_MAX_TASKS_PER_OWNER: usize = 32;

/// [`InMemoryTaskStore`]'s default limit of tasks it holds at once, all owners together.
pub const DEFAULT_MAX_TASKS: usize = 256;

// ═══════════════════════════════════════════════════════════════════════════════
// THE OWNER
// ═══════════════════════════════════════════════════════════════════════════════

/// Who owns a task: the [principal binding](crate::principal_binding) of the call that started it
/// (`spec/authorization.md`, M8), the canonical JSON of the actor's `kind`, `id` and
/// `onBehalfOf` and the credentials' `issuer`, `subject` and `clientId`. Two calls share an owner
/// only when all of those are equal: a different client of the same person is a different
/// owner.
///
/// It names its holder, so it prints redacted and should not be logged. A store keeps it as a
/// string ([`Self::as_str`], [`Self::from_binding`]) and compares it with [`Self::matches`].
#[derive(Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct TaskOwner(String);

impl TaskOwner {
    /// The owner whose principal binding is `binding`, as a store read it back.
    pub fn from_binding(binding: impl Into<String>) -> Self {
        Self(binding.into())
    }

    /// The principal binding.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Whether `other` is the same owner, compared in time that depends only on the lengths.
    pub fn matches(&self, other: &TaskOwner) -> bool {
        constant_time_eq(self.0.as_bytes(), other.0.as_bytes())
    }
}

impl fmt::Debug for TaskOwner {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("TaskOwner([redacted])")
    }
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter()
        .zip(b)
        .fold(0u8, |difference, (x, y)| difference | (x ^ y))
        == 0
}

// ═══════════════════════════════════════════════════════════════════════════════
// THE RECORD
// ═══════════════════════════════════════════════════════════════════════════════

/// A task's status (SEP-2663). AFD never asks a person in a task, so it is never
/// `input_required`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[non_exhaustive]
#[serde(rename_all = "snake_case")]
pub enum TaskState {
    /// The command is running.
    Working,
    /// The command finished with a `CallToolResult`, `isError` included.
    Completed,
    /// The command failed with a JSON-RPC error.
    Failed,
    /// `tasks/cancel` stopped the command.
    Cancelled,
}

impl TaskState {
    /// Whether the task is finished (`completed`, `failed` or `cancelled`).
    pub fn is_terminal(self) -> bool {
        self != Self::Working
    }
}

/// One task as a [`TaskStore`] keeps it. It holds no token, no credentials and no input: the
/// owner's principal binding, the command's name, the status, and the result or error once
/// finished. Times are milliseconds since the Unix epoch, from the server's clock.
#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct TaskRecord {
    /// The task id: 128 bits from the OS random source, unpadded lowercase base32 (26
    /// characters).
    pub id: String,
    /// Who may read, update and cancel it.
    pub owner: TaskOwner,
    /// The command it runs.
    pub command: String,
    /// Its status.
    pub status: TaskState,
    /// The latest progress message, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status_message: Option<String>,
    /// When it was created.
    pub created_at: i64,
    /// When its status, message or result last changed.
    pub last_updated_at: i64,
    /// How long it lives from `created_at`, in milliseconds; past that it is gone.
    pub ttl_ms: u64,
    /// The suggested polling interval, in milliseconds.
    pub poll_interval_ms: u64,
    /// Whether `tasks/cancel` asked to cancel it.
    #[serde(default)]
    pub cancel_requested: bool,
    /// The `CallToolResult` of a `completed` task.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Map<String, Value>>,
    /// The JSON-RPC error of a `failed` task.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<Map<String, Value>>,
}

impl TaskRecord {
    /// A `working` record, created at `created_at`.
    pub fn new(
        id: impl Into<String>,
        owner: TaskOwner,
        command: impl Into<String>,
        created_at: i64,
        ttl_ms: u64,
        poll_interval_ms: u64,
    ) -> Self {
        Self {
            id: id.into(),
            owner,
            command: command.into(),
            status: TaskState::Working,
            status_message: None,
            created_at,
            last_updated_at: created_at,
            ttl_ms,
            poll_interval_ms,
            cancel_requested: false,
            result: None,
            error: None,
        }
    }

    /// When its `ttlMs` ends.
    pub fn expires_at(&self) -> i64 {
        self.created_at
            .saturating_add(i64::try_from(self.ttl_ms).unwrap_or(i64::MAX))
    }

    /// Whether its `ttlMs` has ended at `now`: it is then gone, whatever its status.
    pub fn is_expired(&self, now: i64) -> bool {
        now >= self.expires_at()
    }

    /// Apply `change`, as every store must: a finished task is unchanged, and so is anything but
    /// the changed fields. Returns whether the record changed.
    pub fn apply(&mut self, change: &TaskChange) -> bool {
        if self.status.is_terminal() {
            return false;
        }
        match change {
            TaskChange::Progress { message, at } => {
                self.status_message = Some(message.clone());
                self.last_updated_at = *at;
            }
            TaskChange::CancelRequested => self.cancel_requested = true,
            TaskChange::Completed { result, at } => {
                self.status = TaskState::Completed;
                self.result = Some(result.clone());
                self.last_updated_at = *at;
            }
            TaskChange::Failed { error, at } => {
                self.status = TaskState::Failed;
                self.error = Some(error.clone());
                self.last_updated_at = *at;
            }
            TaskChange::Cancelled { at } => {
                self.status = TaskState::Cancelled;
                self.last_updated_at = *at;
            }
        }
        true
    }
}

impl fmt::Debug for TaskRecord {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("TaskRecord")
            .field("id", &"[redacted]")
            .field("owner", &self.owner)
            .field("command", &self.command)
            .field("status", &self.status)
            .field("created_at", &self.created_at)
            .field("last_updated_at", &self.last_updated_at)
            .field("ttl_ms", &self.ttl_ms)
            .field("cancel_requested", &self.cancel_requested)
            .field("result", &self.result.as_ref().map(|_| ".."))
            .field("error", &self.error.as_ref().map(|_| ".."))
            .finish_non_exhaustive()
    }
}

/// A change to a working task ([`TaskRecord::apply`]). Times are milliseconds since the Unix
/// epoch.
#[derive(Clone, PartialEq)]
#[non_exhaustive]
pub enum TaskChange {
    /// Progress: a new `statusMessage`.
    Progress {
        /// The message.
        message: String,
        /// When it was reported.
        at: i64,
    },
    /// `tasks/cancel` asked to cancel it. Its status is unchanged until the runner stops it.
    CancelRequested,
    /// It finished with this `CallToolResult`.
    Completed {
        /// The result.
        result: Map<String, Value>,
        /// When it finished.
        at: i64,
    },
    /// It failed with this JSON-RPC error.
    Failed {
        /// The error object (`code`, `message`).
        error: Map<String, Value>,
        /// When it failed.
        at: i64,
    },
    /// It was cancelled.
    Cancelled {
        /// When it stopped.
        at: i64,
    },
}

impl fmt::Debug for TaskChange {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Progress { at, .. } => f.debug_struct("Progress").field("at", at).finish(),
            Self::CancelRequested => f.write_str("CancelRequested"),
            Self::Completed { at, .. } => f.debug_struct("Completed").field("at", at).finish(),
            Self::Failed { at, .. } => f.debug_struct("Failed").field("at", at).finish(),
            Self::Cancelled { at } => f.debug_struct("Cancelled").field("at", at).finish(),
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// THE STORE
// ═══════════════════════════════════════════════════════════════════════════════

/// Why a [`TaskStore`] could not do what it was asked.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum TaskStoreError {
    /// The owner already holds `limit` tasks: the call fails with `RATE_LIMITED`.
    OwnerLimit {
        /// The limit.
        limit: usize,
    },
    /// The store already holds `limit` tasks: the call fails with `RATE_LIMITED`.
    TotalLimit {
        /// The limit.
        limit: usize,
    },
    /// The store failed. The message is for the host's logs; callers get a generic error.
    Unavailable(String),
}

impl fmt::Display for TaskStoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::OwnerLimit { limit } => write!(f, "the owner already holds {limit} tasks"),
            Self::TotalLimit { limit } => write!(f, "the store already holds {limit} tasks"),
            Self::Unavailable(message) => write!(f, "the task store failed: {message}"),
        }
    }
}

impl std::error::Error for TaskStoreError {}

/// The call a task is created for, as [`TaskStore::create_for`] sees it: the command, the input
/// as the request gave it (validated later, when the task runs), and the context the command will
/// run with (after the context hook, with the verified credentials and the host's own `extra`).
///
/// It is for a host's store to keep **its own** fields beside the record (who the caller is by
/// its own mapping, which of its spaces the call names). A store must never keep the input, the
/// credentials or anything else of the context beyond such fields.
#[derive(Clone, Copy)]
#[non_exhaustive]
pub struct TaskCall<'a> {
    /// The command the task runs.
    pub command: &'a CommandDefinition,
    /// The input as the request gave it; the registry validates it when the task runs.
    pub input: &'a Value,
    /// The context the command will run with.
    pub context: &'a CommandContext,
}

impl<'a> TaskCall<'a> {
    /// A call, for a host testing its store; the server builds the calls it creates tasks for.
    pub fn new(
        command: &'a CommandDefinition,
        input: &'a Value,
        context: &'a CommandContext,
    ) -> Self {
        Self {
            command,
            input,
            context,
        }
    }
}

impl fmt::Debug for TaskCall<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("TaskCall")
            .field("command", &self.command.name)
            .finish_non_exhaustive()
    }
}

/// Where task records live (`spec/command-metadata.md`, "Tasks"; Umbel phase 5, section 3.3).
///
/// Each method must keep these rules, which the server relies on:
///
/// - **`create` is durable before it returns.** Once it returns `Ok`, a `get` for the id by the
///   same owner finds the record, from any process that shares the store. It refuses an id it
///   already holds rather than replacing the record, and may refuse a new task with
///   [`TaskStoreError::OwnerLimit`] or [`TaskStoreError::TotalLimit`] to bound itself.
/// - **`get` and `update` are by owner.** `get` returns `None` unless the record's owner
///   [matches](TaskOwner::matches) `owner`; `update` changes nothing for another owner, an
///   unknown id or a finished task, and applies a change as [`TaskRecord::apply`] does,
///   atomically. Neither may reveal whether the id exists for someone else.
/// - **`expire(now)` removes every task whose `ttlMs` has ended** ([`TaskRecord::is_expired`])
///   and returns how many it removed. The server also treats an expired record as gone, so a
///   store may purge lazily.
/// - **No content beyond the record.** The record holds no token or credentials; a store must
///   not add them.
///
/// The server creates a task with [`Self::create_for`], which gives the store the call too; its
/// default is [`Self::create`], so a store that keeps only the record implements `create` alone.
#[async_trait]
pub trait TaskStore: Send + Sync {
    /// Record a new task, durably, before returning.
    async fn create(&self, record: TaskRecord) -> Result<(), TaskStoreError>;

    /// Record a new task for `call`, durably, before returning, as [`Self::create`] does: the
    /// method the server calls. A host's store overrides it to keep its own fields from the call
    /// ([`TaskCall`]); the default ignores the call.
    async fn create_for(
        &self,
        record: TaskRecord,
        call: TaskCall<'_>,
    ) -> Result<(), TaskStoreError> {
        let _ = call;
        self.create(record).await
    }

    /// The task `id` when `owner` owns it; `None` otherwise.
    async fn get(&self, id: &str, owner: &TaskOwner) -> Result<Option<TaskRecord>, TaskStoreError>;

    /// Apply `change` to the task `id` when `owner` owns it and it is working.
    async fn update(
        &self,
        id: &str,
        owner: &TaskOwner,
        change: TaskChange,
    ) -> Result<(), TaskStoreError>;

    /// Remove every task whose `ttlMs` ended by `now`; returns how many.
    async fn expire(&self, now: i64) -> Result<u64, TaskStoreError>;

    /// The runner of task `id`, owned by `owner`, is alive at `now`: the server calls it from the
    /// runner itself, at every check while the task runs ([`TaskOptions::with_check_interval_ms`])
    /// and never from a `tasks/*` request, so a store shared by several processes can lease a
    /// task to the process running it and find a dead or hung runner by its silence. The default
    /// does nothing.
    async fn heartbeat(&self, id: &str, owner: &TaskOwner, now: i64) -> Result<(), TaskStoreError> {
        let _ = (id, owner, now);
        Ok(())
    }
}

/// A shared store: several servers (one per connection, or one per process behind a test) can
/// hold the same store.
#[async_trait]
impl<T: TaskStore + ?Sized> TaskStore for std::sync::Arc<T> {
    async fn create(&self, record: TaskRecord) -> Result<(), TaskStoreError> {
        (**self).create(record).await
    }

    async fn create_for(
        &self,
        record: TaskRecord,
        call: TaskCall<'_>,
    ) -> Result<(), TaskStoreError> {
        (**self).create_for(record, call).await
    }

    async fn get(&self, id: &str, owner: &TaskOwner) -> Result<Option<TaskRecord>, TaskStoreError> {
        (**self).get(id, owner).await
    }

    async fn update(
        &self,
        id: &str,
        owner: &TaskOwner,
        change: TaskChange,
    ) -> Result<(), TaskStoreError> {
        (**self).update(id, owner, change).await
    }

    async fn expire(&self, now: i64) -> Result<u64, TaskStoreError> {
        (**self).expire(now).await
    }

    async fn heartbeat(&self, id: &str, owner: &TaskOwner, now: i64) -> Result<(), TaskStoreError> {
        (**self).heartbeat(id, owner, now).await
    }
}

/// The default [`TaskStore`]: in memory, for one process, bounded per owner and in all.
///
/// It holds at most a per-owner limit of tasks for one owner (default
/// [`DEFAULT_MAX_TASKS_PER_OWNER`]) and a total limit in all (default [`DEFAULT_MAX_TASKS`]),
/// finished tasks included until their `ttlMs` ends, since their results are kept until then.
/// When a new task would go over a limit, the store makes room by dropping a finished task
/// before its TTL ends: for the owner's limit, the owner's own oldest finished task; for the
/// total, the oldest finished task of the owner holding the most finished tasks. Only when
/// every task in the way is still working is the new task refused, with
/// [`TaskStoreError::OwnerLimit`] or [`TaskStoreError::TotalLimit`]. Expired tasks are purged on
/// every `create` and `expire`. With the server's result limit
/// ([`TaskOptions::with_max_result_bytes`]) that bounds the memory one owner holds to about
/// `per_owner × max_result_bytes`, and the total to `total × max_result_bytes`.
///
/// Many principals can still fill the total with working tasks: the limits bound memory, not the
/// number of principals, which the host bounds (who may get a token, how many clients may
/// register), and [`TaskOptions::with_max_running`] bounds the tasks one process runs.
pub struct InMemoryTaskStore {
    records: Mutex<HashMap<String, TaskRecord>>,
    per_owner: usize,
    total: usize,
}

impl Default for InMemoryTaskStore {
    fn default() -> Self {
        Self::new()
    }
}

impl InMemoryTaskStore {
    /// A store with the default limits.
    pub fn new() -> Self {
        Self::with_limits(DEFAULT_MAX_TASKS_PER_OWNER, DEFAULT_MAX_TASKS)
    }

    /// A store holding at most `per_owner` tasks for one owner and `total` in all (0 refuses
    /// every task).
    pub fn with_limits(per_owner: usize, total: usize) -> Self {
        Self {
            records: Mutex::new(HashMap::new()),
            per_owner,
            total,
        }
    }

    fn records(&self) -> std::sync::MutexGuard<'_, HashMap<String, TaskRecord>> {
        self.records
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

impl fmt::Debug for InMemoryTaskStore {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("InMemoryTaskStore")
            .field("tasks", &self.records().len())
            .field("per_owner", &self.per_owner)
            .field("total", &self.total)
            .finish()
    }
}

#[async_trait]
impl TaskStore for InMemoryTaskStore {
    async fn create(&self, record: TaskRecord) -> Result<(), TaskStoreError> {
        let mut records = self.records();
        let now = record.created_at;
        records.retain(|_, kept| !kept.is_expired(now));
        if records.contains_key(&record.id) {
            return Err(TaskStoreError::Unavailable(
                "the task id is already in use".into(),
            ));
        }
        // The owner's own oldest finished task makes room for the owner, never another's.
        let owned = records
            .values()
            .filter(|kept| kept.owner.matches(&record.owner))
            .count();
        if owned >= self.per_owner {
            let oldest = oldest_finished(&records, |kept| kept.owner.matches(&record.owner));
            match oldest {
                Some(id) if self.per_owner > 0 => {
                    records.remove(&id);
                }
                _ => {
                    return Err(TaskStoreError::OwnerLimit {
                        limit: self.per_owner,
                    })
                }
            }
        }
        // A full store makes room by dropping the oldest finished task of the owner that holds
        // the most, so finished results cannot keep everyone else out until their TTL ends.
        if records.len() >= self.total {
            let largest = largest_holder(&records);
            let oldest = largest
                .and_then(|owner| oldest_finished(&records, |kept| kept.owner.matches(&owner)));
            match oldest {
                Some(id) if self.total > 0 => {
                    records.remove(&id);
                }
                _ => return Err(TaskStoreError::TotalLimit { limit: self.total }),
            }
        }
        records.insert(record.id.clone(), record);
        Ok(())
    }

    async fn get(&self, id: &str, owner: &TaskOwner) -> Result<Option<TaskRecord>, TaskStoreError> {
        Ok(self
            .records()
            .get(id)
            .filter(|record| record.owner.matches(owner))
            .cloned())
    }

    async fn update(
        &self,
        id: &str,
        owner: &TaskOwner,
        change: TaskChange,
    ) -> Result<(), TaskStoreError> {
        if let Some(record) = self
            .records()
            .get_mut(id)
            .filter(|record| record.owner.matches(owner))
        {
            record.apply(&change);
        }
        Ok(())
    }

    async fn expire(&self, now: i64) -> Result<u64, TaskStoreError> {
        let mut records = self.records();
        let before = records.len();
        records.retain(|_, record| !record.is_expired(now));
        Ok((before - records.len()) as u64)
    }
}

/// The id of the finished task, among those `select` picks, that last changed longest ago.
fn oldest_finished(
    records: &HashMap<String, TaskRecord>,
    select: impl Fn(&TaskRecord) -> bool,
) -> Option<String> {
    records
        .values()
        .filter(|kept| kept.status.is_terminal() && select(kept))
        .min_by_key(|kept| kept.last_updated_at)
        .map(|kept| kept.id.clone())
}

/// The owner holding the most finished tasks.
fn largest_holder(records: &HashMap<String, TaskRecord>) -> Option<TaskOwner> {
    let mut counts: HashMap<&TaskOwner, usize> = HashMap::new();
    for kept in records.values().filter(|kept| kept.status.is_terminal()) {
        *counts.entry(&kept.owner).or_default() += 1;
    }
    counts
        .into_iter()
        .max_by_key(|(_, count)| *count)
        .map(|(owner, _)| owner.clone())
}

// ═══════════════════════════════════════════════════════════════════════════════
// OPTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/// The default limit of tasks running at once in one server process
/// ([`TaskOptions::with_max_running`]), whatever the store holds.
pub const DEFAULT_MAX_RUNNING_TASKS: usize = 64;

/// How the server runs tasks ([`McpServer::with_task_options`](super::McpServer::with_task_options)).
/// Every value is at least 1; the builders clamp, and the fields are read through the getters.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct TaskOptions {
    ttl_ms: u64,
    poll_interval_ms: u64,
    check_interval_ms: u64,
    max_result_bytes: usize,
    max_running: usize,
    token_expiry_grace_ms: Option<u64>,
    callers_identified_by_hook: bool,
}

impl Default for TaskOptions {
    fn default() -> Self {
        Self {
            ttl_ms: DEFAULT_TASK_TTL_MS,
            poll_interval_ms: DEFAULT_TASK_POLL_INTERVAL_MS,
            check_interval_ms: DEFAULT_TASK_CHECK_INTERVAL_MS,
            max_result_bytes: DEFAULT_MAX_TASK_RESULT_BYTES,
            max_running: DEFAULT_MAX_RUNNING_TASKS,
            token_expiry_grace_ms: None,
            callers_identified_by_hook: false,
        }
    }
}

impl TaskOptions {
    /// The defaults.
    pub fn new() -> Self {
        Self::default()
    }

    /// Every task's `ttlMs` (at least 1, at most `i64::MAX`; default [`DEFAULT_TASK_TTL_MS`]).
    /// The task and its result are gone once it ends, and its handler is stopped if it is still
    /// running.
    pub fn with_ttl_ms(mut self, ttl_ms: u64) -> Self {
        self.ttl_ms = ttl_ms.clamp(1, i64::MAX as u64);
        self
    }

    /// Every task's `pollIntervalMs` (at least 1; default [`DEFAULT_TASK_POLL_INTERVAL_MS`]).
    pub fn with_poll_interval_ms(mut self, poll_interval_ms: u64) -> Self {
        self.poll_interval_ms = poll_interval_ms.max(1);
        self
    }

    /// How often a running task checks its deadlines, writes progress and reads the store's
    /// cancellation flag (at least 1; default [`DEFAULT_TASK_CHECK_INTERVAL_MS`]). Its deadlines
    /// are read from the server's clock ([`McpServer::with_clock`](super::McpServer::with_clock))
    /// at each check, so a deadline takes effect within one interval.
    pub fn with_check_interval_ms(mut self, check_interval_ms: u64) -> Self {
        self.check_interval_ms = check_interval_ms.max(1);
        self
    }

    /// The largest result a task keeps (at least 1 byte; default
    /// [`DEFAULT_MAX_TASK_RESULT_BYTES`]). A larger result is replaced by an `INTERNAL_ERROR`
    /// failure with `details.limitBytes` and `actualBytes` that says the command ran: the change
    /// a mutation made stands.
    pub fn with_max_result_bytes(mut self, max_result_bytes: usize) -> Self {
        self.max_result_bytes = max_result_bytes.max(1);
        self
    }

    /// The most tasks one server process runs at once (at least 1; default
    /// [`DEFAULT_MAX_RUNNING_TASKS`]), whatever its store allows: a call beyond it fails with
    /// `RATE_LIMITED` and nothing runs.
    pub fn with_max_running(mut self, max_running: usize) -> Self {
        self.max_running = max_running.max(1);
        self
    }

    /// End each task's `ttlMs` no later than `grace_ms` after the `expiresAt` of the token that
    /// started it (Umbel phase 5, section 12.2: "never past the starting token's `exp`" is a
    /// grace of 0). Without it (the default) the TTL is [`Self::with_ttl_ms`] alone. A task of a
    /// call without credentials is not capped. The capped `ttlMs` is the one the client sees.
    pub fn with_ttl_capped_at_token_expiry(mut self, grace_ms: u64) -> Self {
        self.token_expiry_grace_ms = Some(grace_ms.min(i64::MAX as u64));
        self
    }

    /// Declare that the server's context hook
    /// ([`McpServer::with_context_hook`](super::McpServer::with_context_hook)) identifies every
    /// HTTP caller, so tasks may run over HTTP without authorization (see
    /// [the module docs](self#callers-the-server-must-tell-apart)).
    ///
    /// **This is a security declaration.** A task's owner is the principal binding of the actor
    /// the hook leaves, so every distinct caller must map to a distinct actor (`kind`, `id` and
    /// `onBehalfOf`), from something a layer in front of the service verified, never from a
    /// header a caller can choose. Two callers the hook maps to one actor can read and cancel each
    /// other's tasks. It counts only while a context hook is installed; prefer authorization
    /// (`server-auth`), under which verified credentials identify callers without it.
    pub fn with_callers_identified_by_hook(mut self) -> Self {
        self.callers_identified_by_hook = true;
        self
    }

    /// Whether [`Self::with_callers_identified_by_hook`] was declared.
    pub fn callers_identified_by_hook(&self) -> bool {
        self.callers_identified_by_hook
    }

    /// Every task's `ttlMs`, before any cap at the token's expiry.
    pub fn ttl_ms(&self) -> u64 {
        self.ttl_ms
    }

    /// Every task's `pollIntervalMs`.
    pub fn poll_interval_ms(&self) -> u64 {
        self.poll_interval_ms
    }

    /// How often a running task is checked.
    pub fn check_interval_ms(&self) -> u64 {
        self.check_interval_ms
    }

    /// The largest result a task keeps, in bytes of its JSON.
    pub fn max_result_bytes(&self) -> usize {
        self.max_result_bytes
    }

    /// The most tasks one server process runs at once.
    pub fn max_running(&self) -> usize {
        self.max_running
    }

    /// The grace after the token's `expiresAt` at which a task's `ttlMs` ends, when capped.
    pub fn token_expiry_grace_ms(&self) -> Option<u64> {
        self.token_expiry_grace_ms
    }

    /// The `ttlMs` of a task created at `now` by a call whose credentials expire at
    /// `expires_at` (seconds), if any: at least 1.
    pub(crate) fn ttl_for(&self, now: i64, expires_at: Option<i64>) -> u64 {
        let (Some(grace), Some(expires_at)) = (self.token_expiry_grace_ms, expires_at) else {
            return self.ttl_ms;
        };
        let end = expires_at
            .saturating_mul(1000)
            .saturating_add(i64::try_from(grace).unwrap_or(i64::MAX));
        let remaining = u64::try_from(end.saturating_sub(now)).unwrap_or(0);
        self.ttl_ms.min(remaining).max(1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn options_clamp_to_at_least_one() {
        let options = TaskOptions::new()
            .with_ttl_ms(0)
            .with_poll_interval_ms(0)
            .with_check_interval_ms(0)
            .with_max_result_bytes(0)
            .with_max_running(0);
        assert_eq!(options.ttl_ms(), 1);
        assert_eq!(options.poll_interval_ms(), 1);
        assert_eq!(options.check_interval_ms(), 1);
        assert_eq!(options.max_result_bytes(), 1);
        assert_eq!(options.max_running(), 1);
    }

    #[test]
    fn the_ttl_is_capped_at_the_token_expiry_plus_grace() {
        let options = TaskOptions::new().with_ttl_ms(60_000);
        assert_eq!(options.ttl_for(1_000_000, Some(1_010)), 60_000);
        let capped = options.clone().with_ttl_capped_at_token_expiry(5_000);
        assert_eq!(capped.ttl_for(1_000_000, Some(1_010)), 15_000);
        assert_eq!(capped.ttl_for(1_000_000, Some(2_000)), 60_000);
        assert_eq!(capped.ttl_for(1_000_000, None), 60_000);
        // A token already past its grace still gets a TTL of at least 1.
        assert_eq!(capped.ttl_for(1_000_000, Some(900)), 1);
    }
}

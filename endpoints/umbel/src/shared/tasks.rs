//! The shared task store (phase 5 specification, sections 10.2 and 12.2; D126, D127):
//! `state/shared/tasks.sqlite3`, AFD's [`TaskStore`] for every process behind one URL, so a task
//! one process starts is polled and cancelled through any of them, by its owner only.
//!
//! **What a row holds** (`task-record.v1`, checked against the schema before it is written): the
//! id, the owner as section 12.2 names it (`effectivePrincipal`, `actor`, the issuer alias and the
//! client id) beside a keyed digest of AFD's principal binding that every lookup compares, the
//! command, the call's space, the status, a phase name, the times, the lease, and the result or
//! error. Never a token, credentials, the input or content: a task command is never a read
//! (manifest version 5), a result labelled `dev.umbel/trust: "content"` is replaced by a failure
//! before it is written, a result whose code is a notice's is replaced by the host's own notice,
//! and AFD caps every result at [`MAX_RESULT_BYTES`]. The results are not encrypted at rest:
//! they are counts and ids the owner may read, sealed already where they name positions, in a
//! 0600 file of a 0700 directory that only the operator reads, and section 12.2 asks for none.
//!
//! **Owner checked.** `get`, `update` and `heartbeat` find a row only by its id **and** the
//! HMAC-SHA256 of the caller's principal binding under `state/keys/limits.key`
//! (domain-separated), so another actor, issuer, subject or client finds nothing, exactly as for
//! an unknown id. That lookup is the guarantee: the record a `get` returns carries the caller's
//! own owner, so AFD's second owner check, which compares the two, cannot fail here.
//!
//! **Durable first.** `create` commits (`synchronous = FULL`) before it returns, so the record is
//! on disk, and visible to every process, before AFD answers with `CreateTaskResult`.
//!
//! **Bounded.** At most [`MAX_TASKS_PER_OWNER`] tasks per owner and [`MAX_TASKS`] in all,
//! finished tasks counted until they are purged; over a limit, a finished task makes room as in
//! AFD's own store (the owner's oldest for the owner's limit; the oldest of the largest holder for
//! the total), and only working tasks in the way refuse the new one. The total is shared by every
//! owner: a full store, and a finished task dropped early to make room, reflect everyone's
//! activity together, never whose.
//!
//! **Expiry and the token.** A row is gone at its `ttlMs`, which AFD ends at the starting
//! token's `exp` plus [`TOKEN_EXPIRY_GRACE_MS`]. Inside that grace the store keeps only the
//! notice that the token expired (`TASK_TOKEN_EXPIRED`, written by the runner once it had) or
//! that the task was lost (`TASK_LOST`, the store's own): any other outcome, a result above all,
//! is gone at the token's `exp`, so no result outlives the authorization that produced it (step
//! 8's amendment). Every write purges what has gone, with `secure_delete` on, and then truncates
//! the write-ahead log, so a purged result is left in neither file.
//!
//! **Leases.** A working task is leased to the process that runs it for [`LEASE_MS`]. Only AFD's
//! runner renews it, through [`TaskStore::heartbeat`] at every check; a `tasks/*` read never
//! does. When any process, the running one included, reads a working task whose lease has run
//! out, its runner died or hung: the task completes, once and atomically, with `TASK_LOST`, and
//! a runner that wakes up later finds it ended and stops (AFD's `Stop::Lost`). The host refuses a
//! `store.lock_timeout_ms` above [`MAX_LOCK_WAIT_MS`] in a hosted mode, so a renewal that waits
//! for another process's write still lands in time.
//!
//! The store's times are the host's clock (AFD's task clock), so the tests drive TTLs, token
//! expiry and leases on one injected clock. The file is WAL, mode 0600 in a 0700
//! `state/shared/`, schema `user_version` 1; it is opened on first use. A lock wait past
//! `store.lock_timeout_ms`, like any other failure, is AFD's [`TaskStoreError::Unavailable`]
//! (which has no timeout of its own): a create fails closed with AFD's `INTERNAL_ERROR` ("nothing
//! ran", retryable), and a read with JSON-RPC's internal error.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use afd::server::{
    TaskCall, TaskChange, TaskOwner, TaskRecord, TaskState, TaskStore, TaskStoreError,
};
use afd::{Clock, CommandError};
use rusqlite::{Connection, ErrorCode, OptionalExtension, TransactionBehavior, params};
use serde_json::{Map, Value, json};

use crate::middleware::TRUST_KEY;
use crate::principal::Principal;
use crate::provenance::effective_principal;
use crate::workspace::WorkspaceError;

/// The store's name in errors and logs.
pub(crate) const STORE: &str = "tasks";
/// The schema version this host writes (`PRAGMA user_version`).
const SCHEMA_VERSION: i64 = 1;
/// How long a working task's lease lasts without renewal (section 12.2: "a dead process (lease
/// not renewed for 10 seconds) means `TASK_LOST`").
pub(crate) const LEASE_MS: i64 = 10_000;
/// A runner's heartbeat renews its lease when less than this is left of it: about once a second
/// (AFD's check interval), so a renewal held up by a lock wait of up to [`MAX_LOCK_WAIT_MS`]
/// still lands with three seconds of the lease to spare.
const RENEW_BELOW_MS: i64 = LEASE_MS - 1_000;
/// The longest `store.lock_timeout_ms` a hosted workspace may set: half the lease, so a renewal
/// that waits that long for another process's write still lands before the lease runs out (the
/// host refuses a longer one at seal).
pub(crate) const MAX_LOCK_WAIT_MS: u64 = 5_000;
/// The most tasks one owner holds at once, working or finished (AFD's default).
pub(crate) const MAX_TASKS_PER_OWNER: i64 = afd::server::tasks::DEFAULT_MAX_TASKS_PER_OWNER as i64;
/// The most tasks the store holds at once, every owner together (AFD's default).
pub(crate) const MAX_TASKS: i64 = afd::server::tasks::DEFAULT_MAX_TASKS as i64;
/// The largest result a task keeps, in bytes of its JSON (AFD's default, 1 MiB): AFD replaces a
/// larger one, and the store refuses one that is larger still.
pub(crate) const MAX_RESULT_BYTES: usize = afd::server::tasks::DEFAULT_MAX_TASK_RESULT_BYTES;
/// How long after the starting token's `exp` a task's record lasts (step 8's amendment): long
/// enough for its owner to poll with a new token and learn that the token expired, and holding
/// nothing but that notice.
pub(crate) const TOKEN_EXPIRY_GRACE_MS: u64 = 60_000;
/// A task whose process died (section 10.5).
pub(crate) const TASK_LOST: &str = "TASK_LOST";
/// The longest phase name a task's `statusMessage` holds (`task-record.v1`).
const MAX_PHASE_CHARS: usize = 64;

/// What a call's owner is, as `task-record.v1` names it.
#[derive(Clone, Debug, PartialEq, Eq)]
struct OwnerFields {
    effective_principal: String,
    actor: Value,
    issuer: Option<String>,
    client_id: Option<String>,
}

impl OwnerFields {
    /// The owner of `call`, from the principal the context hook set and the verified credentials:
    /// `None` when the call carries no principal, no effective principal, or credentials whose
    /// issuer alias the principal does not name (the record could not say who owns it).
    fn of(call: &TaskCall<'_>) -> Option<Self> {
        let principal = Principal::from_context(call.context)?;
        let effective = effective_principal(&principal.actor)?;
        let client_id = call
            .context
            .credentials
            .as_deref()
            .map(|credentials| credentials.client_id.clone());
        if client_id.is_some() != principal.issuer.is_some() {
            return None;
        }
        let mut actor = serde_json::to_value(&principal.actor).ok()?;
        // The record names who owns the task, not how the client labels itself.
        if let Some(actor) = actor.as_object_mut() {
            actor.remove("label");
        }
        Some(Self {
            effective_principal: effective,
            actor,
            issuer: principal.issuer,
            client_id,
        })
    }

    fn to_json(&self) -> Value {
        json!({
            "effectivePrincipal": self.effective_principal,
            "actor": self.actor,
            "issuer": self.issuer,
            "clientId": self.client_id,
        })
    }
}

/// The space a call names: its `space` input when it is a well-formed space id, else the default
/// space. The record keeps it for the owner; the access check, when the task runs, refuses a
/// space the caller may not read with section 5.4's one answer, exactly as for an inline call,
/// so nothing here depends on whether the space exists.
fn space_of(input: &Value, default_space: &str) -> String {
    input
        .get("space")
        .and_then(Value::as_str)
        .filter(|space| is_space_id(space))
        .unwrap_or(default_space)
        .to_owned()
}

fn is_space_id(text: &str) -> bool {
    let mut bytes = text.bytes();
    matches!(bytes.next(), Some(b'a'..=b'z'))
        && text.len() <= 63
        && bytes.all(|byte| matches!(byte, b'a'..=b'z' | b'0'..=b'9' | b'-'))
}

/// Whether `message` is a phase name (`task-record.v1`'s `statusMessage`): anything else, a count
/// or a document's title, is never kept.
pub(crate) fn is_phase(message: &str) -> bool {
    let mut bytes = message.bytes();
    matches!(bytes.next(), Some(b'a'..=b'z'))
        && message.len() <= MAX_PHASE_CHARS
        && bytes.all(|byte| matches!(byte, b'a'..=b'z' | b'0'..=b'9' | b'-'))
}

/// Whether a `CallToolResult` carries content (`dev.umbel/trust: "content"`, in the command
/// result's metadata or the result's `_meta`).
fn carries_content(result: &Map<String, Value>) -> bool {
    // Any trust label: `content` from a compiled plugin or a pipeline over one, and `external`,
    // which the host writes over a mounted plugin's results (and a mounted plugin's pipeline's).
    let labelled = |value: Option<&Value>| value.and_then(|meta| meta.get(TRUST_KEY)).is_some();
    labelled(
        result
            .get("structuredContent")
            .and_then(|structured| structured.get("metadata")),
    ) || labelled(result.get("_meta"))
}

/// The error code of a completed task's `CommandResult`, when it failed.
fn error_code(result: &Map<String, Value>) -> Option<&str> {
    result
        .get("structuredContent")?
        .get("error")?
        .get("code")?
        .as_str()
}

/// Whether a completed result, finished at `at`, is the notice the store keeps past the token's
/// `exp`: AFD's `TASK_TOKEN_EXPIRED`, written once the token had expired (`content_until_ms` is
/// the token's `exp`). A command's own failure with that code, returned before the `exp`, is not
/// one, so nothing a command produced outlives its token. (`TASK_LOST` is the store's own, set
/// where it is found.)
fn is_notice(result: &Map<String, Value>, at: i64, content_until_ms: i64) -> bool {
    at >= content_until_ms && error_code(result) == Some(afd::error_codes::TASK_TOKEN_EXPIRED)
}

/// `TASK_LOST`: the process running the task ended (or stalled past its lease) before it
/// finished. Retryable unless the command changes state, which it may have done, in part.
pub(crate) fn task_lost(mutation: bool) -> CommandError {
    let suggestion = if mutation {
        "The command may have made part of its change before its process stopped: check its effect, then start it again if it is still needed."
    } else {
        "Start the task again."
    };
    CommandError::new(
        TASK_LOST,
        "The task stopped: the process running it ended before it finished",
    )
    .with_suggestion(suggestion)
    .with_retryable(!mutation)
}

/// `TASK_TOKEN_EXPIRED` as the store keeps it: the host's own words, whatever the result named
/// it carried. Retryable unless the command changes state.
fn token_expired(mutation: bool) -> CommandError {
    let suggestion = if mutation {
        "The command may have made part of its change before it stopped: check its effect, then start it again with a new access token if it is still needed."
    } else {
        "Obtain a new access token and start the task again."
    };
    CommandError::new(
        afd::error_codes::TASK_TOKEN_EXPIRED,
        "The task stopped because the access token that started it expired",
    )
    .with_suggestion(suggestion)
    .with_retryable(!mutation)
}

/// A completed result whose code is a notice's (`TASK_TOKEN_EXPIRED` or `TASK_LOST`), replaced by
/// the host's own canonical notice, so nothing else the result held (a message, details, data)
/// is kept; any other result as it is.
fn canonical(result: Map<String, Value>, mutation: bool) -> Map<String, Value> {
    let notice = match error_code(&result) {
        Some(afd::error_codes::TASK_TOKEN_EXPIRED) => token_expired(mutation),
        Some(TASK_LOST) => task_lost(mutation),
        _ => return result,
    };
    afd::server::failure_result(notice).unwrap_or_default()
}

/// The failure that replaces a result a task may not keep: it carried content, or it was larger
/// than [`MAX_RESULT_BYTES`]. The command ran either way.
fn not_kept(why: &str) -> CommandError {
    CommandError::new(
        afd::error_codes::INTERNAL_ERROR,
        format!("The command ran, but its result {why}, which a task does not keep"),
    )
    .with_suggestion(
        "The command ran: check its effect before running it again, and call it without a task to receive its result.",
    )
    .with_retryable(false)
}

/// The fixed codes of Umbel's host and its task commands that a task keeps as they came, beside
/// AFD's catalog ([`afd::ERROR_CODE_CATALOG`]). Any other code, which a command could have built
/// from its input, is kept as `COMMAND_EXECUTION_ERROR` (#3010).
const UMBEL_CODES: &[&str] = &[
    TASK_LOST,
    crate::plugins::TASK_SPACE_UNREADABLE,
    "TASK_STOPPED",
    "SPACE_NOT_FOUND",
    "SPACE_NOT_READABLE",
    "ACCESS_INVALID",
    "PLUGIN_GRANT_DENIED",
    "STORE_BUSY",
    "STORE_CONFLICT",
    "STORE_CORRUPT",
    "STORE_IO",
    "STORE_PROVENANCE_REQUIRED",
    "STORE_WRITE_NOT_ALLOWED",
    "COLLECTION_FAILED",
    "COLLECTION_NOT_FOUND",
    "CONTENT_FLAGGED",
    "FRONTMATTER_INVALID",
    "FRONTMATTER_SCHEMA",
    "KNOWLEDGE_FAILED",
    "KNOWLEDGE_INDEX_INVALID",
    "KNOWLEDGE_PACK_INVALID",
    "KNOWLEDGE_TOO_LARGE",
    "OKF_VERSION_UNKNOWN",
    "SOURCES_PACK_INVALID",
    "SOURCE_CONFLICT",
    "SOURCE_FAILED",
    "SOURCE_INVALID",
    "SOURCE_LIMIT",
    "SOURCE_PATH_INVALID",
    "SOURCE_TOO_LARGE",
    "SOURCE_UNREADABLE",
];

/// `code` as a task keeps it: itself when AFD's catalog or [`UMBEL_CODES`] has it.
fn kept_code(code: &str) -> &'static str {
    afd::ERROR_CODE_CATALOG
        .iter()
        .map(|entry| entry.code)
        .chain(UMBEL_CODES.iter().copied())
        .find(|kept| *kept == code)
        .unwrap_or(afd::error_codes::COMMAND_EXECUTION_ERROR)
}

/// The `error` of a failed result: `isError`, `success: false`, or any `error` at all, whatever
/// the flags say (an embedder may return a failure without an `error`, or an `error` beside
/// `success: true`). `None` for a success.
fn failed_error(result: &Map<String, Value>) -> Option<&Map<String, Value>> {
    static EMPTY: std::sync::OnceLock<Map<String, Value>> = std::sync::OnceLock::new();
    let structured = result.get("structuredContent");
    let error = structured.and_then(|s| s.get("error"));
    let failed = result.get("isError") == Some(&Value::Bool(true))
        || structured.and_then(|s| s.get("success")) == Some(&Value::Bool(false))
        || error.is_some_and(|error| !error.is_null());
    if !failed {
        return None;
    }
    Some(
        structured
            .and_then(|s| s.get("error"))
            .and_then(Value::as_object)
            .unwrap_or_else(|| EMPTY.get_or_init(Map::new)),
    )
}

/// A failure as a task keeps it (#3010): never the command's own words, which may repeat the
/// call's input (`sources-sync`'s `COLLECTION_NOT_FOUND` names the collection asked for), and no
/// fact a command could have supplied. The host's notices are rebuilt in the host's words with
/// their own recovery advice, from what the store knows itself (the command's `mutation` and
/// [`MAX_RESULT_BYTES`]): AFD's oversized result (it says the command ran), AFD's `TIMEOUT` (as
/// though the work had started: only the runner knows it had not) and Umbel's
/// `TASK_SPACE_UNREADABLE`. Any other failure keeps its code ([`kept_code`]) and whether it is
/// retryable, with no details, and a suggestion that never invites a mutation to run again
/// unchecked. (`TASK_TOKEN_EXPIRED` and `TASK_LOST` are rebuilt by [`canonical`] before this.)
fn failure_as_kept(error: &Map<String, Value>, mutation: bool) -> CommandError {
    let code = error
        .get("code")
        .and_then(Value::as_str)
        .unwrap_or_default();
    // AFD's oversized result, by its shape: both sizes, as whole numbers. Only the host's own
    // limit is kept, never a size the result supplied.
    let sized = error
        .get("details")
        .and_then(Value::as_object)
        .is_some_and(|details| {
            ["limitBytes", "actualBytes"]
                .iter()
                .all(|key| details.get(*key).and_then(Value::as_u64).is_some())
        });
    if code == afd::error_codes::INTERNAL_ERROR && sized {
        return not_kept("is larger than a task keeps").with_details(
            std::collections::HashMap::from([("limitBytes".to_owned(), json!(MAX_RESULT_BYTES))]),
        );
    }
    if code == afd::error_codes::TIMEOUT {
        let suggestion = if mutation {
            "The command may have made part of its change before it stopped: check its effect, then start it again if it is still needed."
        } else {
            "Start the task again, or ask the operator for a longer run budget."
        };
        return CommandError::new(
            afd::error_codes::TIMEOUT,
            "The task stopped because its execution run budget elapsed",
        )
        .with_suggestion(suggestion)
        .with_retryable(!mutation);
    }
    if code == crate::plugins::TASK_SPACE_UNREADABLE {
        return crate::plugins::space_unreadable();
    }
    let code = kept_code(code);
    let retryable = error
        .get("retryable")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let suggestion = if mutation {
        "The command may have made part of its change: check its effect, then call it without a task to see the failure in full before running it again."
    } else {
        "Call the command without a task to see the failure in full, then correct the call."
    };
    CommandError::new(
        code,
        format!(
            "The command failed with {code}. A task keeps only the code and whether it is retryable, since the command's own words may repeat the call's input"
        ),
    )
    .with_suggestion(suggestion)
    .with_retryable(retryable)
}

/// The JSON-RPC error a `failed` task holds: only the internal error (`task-record.v1`).
fn internal_error_object() -> Map<String, Value> {
    let mut error = Map::new();
    error.insert("code".into(), json!(-32603));
    error.insert("message".into(), json!("Internal error"));
    error
}

fn unavailable(error: &dyn std::fmt::Display) -> TaskStoreError {
    TaskStoreError::Unavailable(format!("{STORE}: {error}"))
}

fn sql_error(error: &rusqlite::Error) -> TaskStoreError {
    match error.sqlite_error_code() {
        Some(ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked) => TaskStoreError::Unavailable(
            format!("{STORE}: the store was held past store.lock_timeout_ms"),
        ),
        _ => unavailable(error),
    }
}

/// A new process id: `p-` and 26 base32 characters (128 random bits).
fn process_id() -> Option<String> {
    crate::person::service::random_id().map(|id| format!("p-{id}"))
}

/// The SQLite task store (section 10.2), one per process: its process id is the lease holder's.
#[derive(Clone)]
pub(crate) struct SqliteTasks(Arc<Inner>);

struct Inner {
    path: PathBuf,
    lock_timeout_ms: u64,
    /// `state/keys/limits.key`: the owner digest's key, shared by every process.
    key: Vec<u8>,
    /// This process's lease name.
    process: String,
    clock: Arc<dyn Clock>,
    default_space: String,
    connection: Mutex<Option<Connection>>,
}

impl std::fmt::Debug for SqliteTasks {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SqliteTasks").finish_non_exhaustive()
    }
}

/// One row, as read.
struct Row {
    id: String,
    command: String,
    status: TaskState,
    status_message: Option<String>,
    created_ms: i64,
    updated_ms: i64,
    ttl_ms: i64,
    expires_ms: i64,
    content_until_ms: i64,
    poll_ms: i64,
    cancel_requested: bool,
    mutation: bool,
    lease_until_ms: Option<i64>,
    result: Option<Map<String, Value>>,
    error: Option<Map<String, Value>>,
}

const COLUMNS: &str = "id, command, status, status_message, created_ms, updated_ms, ttl_ms, expires_ms, content_until_ms, poll_ms, cancel_requested, mutation, lease_until_ms, result, error";

fn parse_state(text: &str) -> Option<TaskState> {
    Some(match text {
        "working" => TaskState::Working,
        "completed" => TaskState::Completed,
        "failed" => TaskState::Failed,
        "cancelled" => TaskState::Cancelled,
        _ => return None,
    })
}

fn object(text: Option<String>) -> rusqlite::Result<Option<Map<String, Value>>> {
    match text {
        None => Ok(None),
        Some(text) => match serde_json::from_str::<Value>(&text) {
            Ok(Value::Object(object)) => Ok(Some(object)),
            _ => Err(rusqlite::Error::InvalidColumnType(
                0,
                "result".into(),
                rusqlite::types::Type::Text,
            )),
        },
    }
}

fn read_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Row> {
    let status: String = row.get(2)?;
    Ok(Row {
        id: row.get(0)?,
        command: row.get(1)?,
        status: parse_state(&status).ok_or_else(|| {
            rusqlite::Error::InvalidColumnType(2, "status".into(), rusqlite::types::Type::Text)
        })?,
        status_message: row.get(3)?,
        created_ms: row.get(4)?,
        updated_ms: row.get(5)?,
        ttl_ms: row.get(6)?,
        expires_ms: row.get(7)?,
        content_until_ms: row.get(8)?,
        poll_ms: row.get(9)?,
        cancel_requested: row.get::<_, i64>(10)? != 0,
        mutation: row.get::<_, i64>(11)? != 0,
        lease_until_ms: row.get(12)?,
        result: object(row.get(13)?)?,
        error: object(row.get(14)?)?,
    })
}

impl Row {
    /// Whether the row is gone at `now_ms`: its TTL ended, or it finished and holds more than a
    /// notice past the token's `exp`.
    fn gone(&self, now_ms: i64) -> bool {
        now_ms >= self.expires_ms
            || (self.status != TaskState::Working && now_ms >= self.content_until_ms)
    }

    /// AFD's record of the row, owned by `owner` (whose digest the row matched).
    fn record(self, owner: &TaskOwner) -> TaskRecord {
        let mut record = TaskRecord::new(
            self.id,
            owner.clone(),
            self.command,
            self.created_ms,
            u64::try_from(self.ttl_ms).unwrap_or(1).max(1),
            u64::try_from(self.poll_ms).unwrap_or(1).max(1),
        );
        record.status = self.status;
        record.status_message = self.status_message;
        record.last_updated_at = self.updated_ms;
        record.cancel_requested = self.cancel_requested;
        record.result = self.result;
        record.error = self.error;
        record
    }
}

impl SqliteTasks {
    /// The store at `path`, owners digested under `key`, on `clock`, with `default_space` for a
    /// call that names none. Nothing is opened until the first use.
    ///
    /// # Errors
    /// `INTERNAL_ERROR`-worthy only when the OS random source that names this process fails.
    pub(crate) fn new(
        path: &Path,
        lock_timeout_ms: u64,
        key: Vec<u8>,
        clock: Arc<dyn Clock>,
        default_space: String,
    ) -> Result<Self, WorkspaceError> {
        let process = process_id().ok_or_else(|| {
            WorkspaceError::unwritable(path, "the OS random source is unavailable")
        })?;
        Ok(Self(Arc::new(Inner {
            path: path.to_path_buf(),
            lock_timeout_ms,
            key,
            process,
            clock,
            default_space,
            connection: Mutex::new(None),
        })))
    }

    /// This process's lease name.
    #[cfg(test)]
    pub(crate) fn process(&self) -> &str {
        &self.0.process
    }

    /// Run `work` on the store, off the async runtime.
    async fn blocking<T: Send + 'static>(
        &self,
        work: impl FnOnce(&Inner, &mut Connection) -> Result<T, TaskStoreError> + Send + 'static,
    ) -> Result<T, TaskStoreError> {
        let inner = Arc::clone(&self.0);
        tokio::task::spawn_blocking(move || inner.with(|connection| work(&inner, connection)))
            .await
            .map_err(|error| unavailable(&error))?
    }
}

impl Inner {
    fn with<T>(
        &self,
        work: impl FnOnce(&mut Connection) -> Result<T, TaskStoreError>,
    ) -> Result<T, TaskStoreError> {
        let mut guard = self
            .connection
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if guard.is_none() {
            *guard = Some(self.open_patiently()?);
        }
        let Some(connection) = guard.as_mut() else {
            return Err(unavailable(&"the store is not open"));
        };
        work(connection)
    }

    fn open_patiently(&self) -> Result<Connection, TaskStoreError> {
        let deadline =
            std::time::Instant::now() + Duration::from_millis(self.lock_timeout_ms.max(1));
        loop {
            match self.open() {
                Ok(connection) => return Ok(connection),
                Err(error) => {
                    let text = error.to_string();
                    let busy =
                        text.contains("database is locked") || text.contains("database is busy");
                    if !busy || std::time::Instant::now() >= deadline {
                        return Err(unavailable(&error));
                    }
                    std::thread::sleep(Duration::from_millis(5));
                }
            }
        }
    }

    fn open(&self) -> Result<Connection, WorkspaceError> {
        let path = &self.path;
        let unwritable = |error: &dyn std::fmt::Display| WorkspaceError::unwritable(path, error);
        if let Some(dir) = path.parent() {
            super::ensure_dir(dir)?;
        }
        super::ensure_private_file(path)?;
        let connection = Connection::open(path).map_err(|error| unwritable(&error))?;
        connection
            .busy_timeout(Duration::from_millis(self.lock_timeout_ms))
            .map_err(|error| unwritable(&error))?;
        let mode: String = connection
            .query_row("PRAGMA journal_mode = WAL", [], |row| row.get(0))
            .map_err(|error| unwritable(&error))?;
        if !mode.eq_ignore_ascii_case("wal") {
            return Err(unwritable(&format!(
                "the store could not enter WAL mode (it reports {mode})"
            )));
        }
        connection
            .execute_batch(
                "PRAGMA synchronous = FULL;
                 PRAGMA secure_delete = ON;
                 BEGIN IMMEDIATE;
                 CREATE TABLE IF NOT EXISTS tasks (
                     id TEXT PRIMARY KEY NOT NULL,
                     owner_key TEXT NOT NULL,
                     owner_json TEXT NOT NULL,
                     command TEXT NOT NULL,
                     space TEXT NOT NULL,
                     mutation INTEGER NOT NULL,
                     status TEXT NOT NULL,
                     status_message TEXT,
                     created_ms INTEGER NOT NULL,
                     updated_ms INTEGER NOT NULL,
                     ttl_ms INTEGER NOT NULL,
                     expires_ms INTEGER NOT NULL,
                     content_until_ms INTEGER NOT NULL,
                     poll_ms INTEGER NOT NULL,
                     cancel_requested INTEGER NOT NULL DEFAULT 0,
                     lease_process TEXT,
                     lease_until_ms INTEGER,
                     result TEXT,
                     error TEXT
                 ) WITHOUT ROWID;
                 CREATE INDEX IF NOT EXISTS tasks_owner ON tasks (owner_key);
                 CREATE INDEX IF NOT EXISTS tasks_expires ON tasks (expires_ms);
                 COMMIT;",
            )
            .map_err(|error| unwritable(&error))?;
        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(|error| unwritable(&error))?;
        match version {
            0 => connection
                .execute_batch(&format!("PRAGMA user_version = {SCHEMA_VERSION}"))
                .map_err(|error| unwritable(&error))?,
            SCHEMA_VERSION => {}
            other => {
                return Err(unwritable(&format!(
                    "the store has schema version {other}; this host reads {SCHEMA_VERSION}"
                )));
            }
        }
        Ok(connection)
    }

    /// The owner digest of `owner`: who may read, update and cancel a task.
    fn owner_key(&self, owner: &TaskOwner) -> String {
        super::keyed_name("task", &self.key, &["task-owner", owner.as_str()])
    }
}

/// After a commit that purged rows: copy the write-ahead log into the database and truncate it,
/// so a purged result's bytes, which `secure_delete` zeroes in the database, are not left in the
/// log either. Best effort: a reader in another process may hold the log, and the next purge
/// tries again.
fn truncate_log(connection: &Connection, purged: u64) {
    if purged > 0 {
        let _ = connection.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()));
    }
}

/// Purge every row that has gone at `now_ms`; returns how many.
fn purge(transaction: &rusqlite::Transaction<'_>, now_ms: i64) -> Result<u64, TaskStoreError> {
    let removed = transaction
        .execute(
            "DELETE FROM tasks WHERE expires_ms <= ?1
                 OR (status <> 'working' AND content_until_ms <= ?1)",
            params![now_ms],
        )
        .map_err(|error| sql_error(&error))?;
    Ok(removed as u64)
}

fn read(connection: &Connection, id: &str, owner_key: &str) -> Result<Option<Row>, TaskStoreError> {
    connection
        .query_row(
            &format!("SELECT {COLUMNS} FROM tasks WHERE id = ?1 AND owner_key = ?2"),
            params![id, owner_key],
            read_row,
        )
        .optional()
        .map_err(|error| sql_error(&error))
}

/// Make room for one more task of `owner_key`, as AFD's own store does: over the owner's limit,
/// drop the owner's oldest finished task; over the total, the oldest finished task of the owner
/// holding the most finished tasks. Only working tasks in the way refuse it.
fn make_room(
    transaction: &rusqlite::Transaction<'_>,
    owner_key: &str,
) -> Result<(), TaskStoreError> {
    let count = |sql: &str, args: &[&dyn rusqlite::ToSql]| -> Result<i64, TaskStoreError> {
        transaction
            .query_row(sql, args, |row| row.get(0))
            .map_err(|error| sql_error(&error))
    };
    let drop_oldest = |owner: &str| -> Result<bool, TaskStoreError> {
        let removed = transaction
            .execute(
                "DELETE FROM tasks WHERE id IN (SELECT id FROM tasks
                     WHERE owner_key = ?1 AND status <> 'working'
                     ORDER BY updated_ms, id LIMIT 1)",
                params![owner],
            )
            .map_err(|error| sql_error(&error))?;
        Ok(removed == 1)
    };
    let owned = count(
        "SELECT COUNT(*) FROM tasks WHERE owner_key = ?1",
        &[&owner_key],
    )?;
    if owned >= MAX_TASKS_PER_OWNER && !drop_oldest(owner_key)? {
        return Err(TaskStoreError::OwnerLimit {
            limit: MAX_TASKS_PER_OWNER as usize,
        });
    }
    let total = count("SELECT COUNT(*) FROM tasks", &[])?;
    if total >= MAX_TASKS {
        let largest: Option<String> = transaction
            .query_row(
                "SELECT owner_key FROM tasks WHERE status <> 'working'
                 GROUP BY owner_key ORDER BY COUNT(*) DESC, owner_key LIMIT 1",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| sql_error(&error))?;
        let made = match largest {
            Some(owner) => drop_oldest(&owner)?,
            None => false,
        };
        if !made {
            return Err(TaskStoreError::TotalLimit {
                limit: MAX_TASKS as usize,
            });
        }
    }
    Ok(())
}

/// What a `Completed` change stores: a success as it came, a failure in the host's words
/// ([`failure_as_kept`]), and in place of a result labelled content (or `external`), or one larger
/// than [`MAX_RESULT_BYTES`] as it would be stored, a failure that says the command ran.
fn kept_result(result: Map<String, Value>, mutation: bool) -> Map<String, Value> {
    let notice = matches!(
        error_code(&result),
        Some(afd::error_codes::TASK_TOKEN_EXPIRED | TASK_LOST)
    );
    let result = canonical(result, mutation);
    let kept = if notice {
        result
    } else if let Some(error) = failed_error(&result) {
        afd::server::failure_result(failure_as_kept(error, mutation)).unwrap_or_default()
    } else if carries_content(&result) {
        afd::server::failure_result(not_kept("is labelled as content")).unwrap_or_default()
    } else {
        result
    };
    let size = serde_json::to_vec(&kept).map_or(usize::MAX, |bytes| bytes.len());
    if size > MAX_RESULT_BYTES {
        return afd::server::failure_result(not_kept("is larger than a task keeps"))
            .unwrap_or_default();
    }
    kept
}

#[async_trait::async_trait]
impl TaskStore for SqliteTasks {
    /// A record without its call cannot say who owns it in `task-record.v1`'s terms: refused.
    async fn create(&self, _record: TaskRecord) -> Result<(), TaskStoreError> {
        Err(unavailable(&"a task is recorded only with its call"))
    }

    async fn create_for(
        &self,
        record: TaskRecord,
        call: TaskCall<'_>,
    ) -> Result<(), TaskStoreError> {
        let owner = OwnerFields::of(&call)
            .ok_or_else(|| unavailable(&"the call carries no owner a task record can name"))?;
        let owner_json = owner.to_json().to_string();
        let space = space_of(call.input, &self.0.default_space);
        let mutation = call.command.mutation;
        let expires_ms = record.expires_at();
        // No outcome but a notice outlives the starting token's `exp`.
        let content_until_ms = call
            .context
            .credentials
            .as_deref()
            .map_or(expires_ms, |credentials| {
                credentials.expires_at.saturating_mul(1000).min(expires_ms)
            });
        let owner_key = self.0.owner_key(&record.owner);
        // The record as `task-record.v1` gives it, checked before anything is written: a call
        // whose owner, command or space the schema refuses gets no task.
        let v1 = json!({
            "version": crate::versions::TASK_VERSION,
            "id": record.id,
            "owner": owner.to_json(),
            "command": record.command,
            "space": space,
            "status": "working",
            "statusMessage": null,
            "createdAt": crate::person::iso(record.created_at),
            "lastUpdatedAt": crate::person::iso(record.created_at),
            "ttlMs": record.ttl_ms,
            "pollIntervalMs": record.poll_interval_ms,
            "cancelRequested": false,
            "lease": {
                "process": self.0.process,
                "until": crate::person::iso(record.created_at.saturating_add(LEASE_MS)),
            },
            "result": null,
            "error": null,
        });
        if !record_schema().is_some_and(|schema| schema.is_valid(&v1)) {
            return Err(unavailable(
                &"the task's record is not a valid task-record.v1",
            ));
        }
        self.blocking(move |inner, connection| {
            let transaction = connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(|error| sql_error(&error))?;
            let purged = purge(&transaction, record.created_at)?;
            make_room(&transaction, &owner_key)?;
            let inserted = transaction
                .execute(
                    "INSERT INTO tasks (id, owner_key, owner_json, command, space, mutation,
                         status, status_message, created_ms, updated_ms, ttl_ms, expires_ms,
                         content_until_ms, poll_ms, cancel_requested, lease_process,
                         lease_until_ms, result, error)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'working', NULL, ?7, ?7, ?8, ?9, ?10, ?11, 0,
                         ?12, ?13, NULL, NULL)
                     ON CONFLICT (id) DO NOTHING",
                    params![
                        record.id,
                        owner_key,
                        owner_json,
                        record.command,
                        space,
                        i64::from(mutation),
                        record.created_at,
                        i64::try_from(record.ttl_ms).unwrap_or(i64::MAX),
                        expires_ms,
                        content_until_ms,
                        i64::try_from(record.poll_interval_ms).unwrap_or(i64::MAX),
                        inner.process,
                        record.created_at.saturating_add(LEASE_MS),
                    ],
                )
                .map_err(|error| sql_error(&error))?;
            if inserted != 1 {
                // 128 random bits never collide; a collision is a broken random source.
                return Err(unavailable(&"the task id is already in use"));
            }
            transaction.commit().map_err(|error| sql_error(&error))?;
            truncate_log(connection, purged);
            Ok(())
        })
        .await
    }

    async fn get(&self, id: &str, owner: &TaskOwner) -> Result<Option<TaskRecord>, TaskStoreError> {
        let owner_key = self.0.owner_key(owner);
        let id = id.to_owned();
        let owner = owner.clone();
        self.blocking(move |inner, connection| {
            let now = inner.clock.now();
            let Some(row) = read(connection, &id, &owner_key)? else {
                return Ok(None);
            };
            if row.gone(now) {
                let transaction = connection
                    .transaction_with_behavior(TransactionBehavior::Immediate)
                    .map_err(|error| sql_error(&error))?;
                let purged = purge(&transaction, now)?;
                transaction.commit().map_err(|error| sql_error(&error))?;
                truncate_log(connection, purged);
                return Ok(None);
            }
            let until = row.lease_until_ms.unwrap_or(i64::MIN);
            if row.status != TaskState::Working || until > now {
                return Ok(Some(row.record(&owner)));
            }
            // The lease ran out: its runner's heartbeat stopped, its process dead or the runner
            // hung. Whichever process reads it first, its own included, ends it, once, tightening
            // its TTL to post-completion retention (never wider than its initial `ttl_ms`). As a
            // host notice (phase 5 spec, section 12.2), `TASK_LOST` stays visible through any
            // token-expiry grace within `new_expires_ms`.
            let lost = afd::server::failure_result(task_lost(row.mutation))
                .ok_or_else(|| unavailable(&"the lost task's result could not be built"))?;
            let elapsed = now.saturating_sub(row.created_ms).max(0);
            let retention =
                i64::try_from(afd::server::tasks::DEFAULT_TASK_TTL_MS).unwrap_or(i64::MAX);
            let new_ttl_ms = elapsed.saturating_add(retention).min(row.ttl_ms).max(1);
            let new_expires_ms = row.created_ms.saturating_add(new_ttl_ms);
            connection
                .execute(
                    "UPDATE tasks SET status = 'completed', result = ?1, lease_process = NULL,
                         lease_until_ms = NULL, updated_ms = ?2, ttl_ms = ?3, expires_ms = ?4,
                         content_until_ms = ?4
                     WHERE id = ?5 AND status = 'working' AND lease_until_ms <= ?2",
                    params![
                        Value::Object(lost).to_string(),
                        now,
                        new_ttl_ms,
                        new_expires_ms,
                        id,
                    ],
                )
                .map_err(|error| sql_error(&error))?;
            Ok(read(connection, &id, &owner_key)?.map(|row| row.record(&owner)))
        })
        .await
    }

    async fn update(
        &self,
        id: &str,
        owner: &TaskOwner,
        change: TaskChange,
    ) -> Result<(), TaskStoreError> {
        let owner_key = self.0.owner_key(owner);
        let id = id.to_owned();
        self.blocking(move |inner, connection| {
            let now = inner.clock.now();
            let transaction = connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(|error| sql_error(&error))?;
            let Some(row) = read(&transaction, &id, &owner_key)? else {
                return Ok(());
            };
            // A finished task is unchanged (AFD's `TaskRecord::apply`).
            if row.status != TaskState::Working {
                return Ok(());
            }
            let finish = |status: &str,
                          result: Option<Map<String, Value>>,
                          error: Option<Map<String, Value>>,
                          at: i64,
                          ttl_ms: Option<u64>|
             -> Result<(), TaskStoreError> {
                let notice = result
                    .as_ref()
                    .is_some_and(|result| is_notice(result, at, row.content_until_ms));
                let new_ttl_ms = ttl_ms.map_or(row.ttl_ms, |ms| {
                    i64::try_from(ms.clamp(1, i64::MAX as u64))
                        .unwrap_or(i64::MAX)
                        .min(row.ttl_ms)
                });
                let new_expires_ms = row.created_ms.saturating_add(new_ttl_ms);
                let new_content_until_ms = if notice {
                    new_expires_ms
                } else {
                    row.content_until_ms.min(new_expires_ms)
                };
                transaction
                    .execute(
                        "UPDATE tasks SET status = ?1, result = ?2, error = ?3, updated_ms = ?4,
                             ttl_ms = ?5, expires_ms = ?6, content_until_ms = ?7,
                             lease_process = NULL, lease_until_ms = NULL
                         WHERE id = ?8 AND status = 'working'",
                        params![
                            status,
                            result.map(|result| Value::Object(result).to_string()),
                            error.map(|error| Value::Object(error).to_string()),
                            at,
                            new_ttl_ms,
                            new_expires_ms,
                            new_content_until_ms,
                            id,
                        ],
                    )
                    .map(drop)
                    .map_err(|error| sql_error(&error))
            };
            match change {
                TaskChange::Progress { message, at } => {
                    if is_phase(&message) {
                        transaction
                            .execute(
                                "UPDATE tasks SET status_message = ?1, updated_ms = ?2
                                 WHERE id = ?3 AND status = 'working'",
                                params![message, at, id],
                            )
                            .map_err(|error| sql_error(&error))?;
                    }
                }
                TaskChange::CancelRequested => {
                    transaction
                        .execute(
                            "UPDATE tasks SET cancel_requested = 1
                             WHERE id = ?1 AND status = 'working'",
                            params![id],
                        )
                        .map_err(|error| sql_error(&error))?;
                }
                TaskChange::Completed { result, at, ttl_ms } => {
                    finish(
                        "completed",
                        Some(kept_result(result, row.mutation)),
                        None,
                        at,
                        ttl_ms,
                    )?;
                }
                TaskChange::Failed { at, ttl_ms, .. } => {
                    finish("failed", None, Some(internal_error_object()), at, ttl_ms)?;
                }
                TaskChange::Cancelled { at, ttl_ms } => {
                    finish("cancelled", None, None, at, ttl_ms)?
                }
                _ => {}
            }
            let purged = purge(&transaction, now)?;
            transaction.commit().map_err(|error| sql_error(&error))?;
            truncate_log(connection, purged);
            Ok(())
        })
        .await
    }

    async fn expire(&self, now: i64) -> Result<u64, TaskStoreError> {
        self.blocking(move |_, connection| {
            let transaction = connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(|error| sql_error(&error))?;
            let removed = purge(&transaction, now)?;
            transaction.commit().map_err(|error| sql_error(&error))?;
            truncate_log(connection, removed);
            Ok(removed)
        })
        .await
    }

    /// The runner of `id` is alive: renew the lease this process holds on it, about once a second.
    /// Only AFD's runner calls it, never a `tasks/*` request, so a runner that died or hung (its
    /// process alive or not) stops renewing, and its task is lost once the lease runs out.
    async fn heartbeat(&self, id: &str, owner: &TaskOwner, now: i64) -> Result<(), TaskStoreError> {
        let owner_key = self.0.owner_key(owner);
        let id = id.to_owned();
        self.blocking(move |inner, connection| {
            connection
                .execute(
                    "UPDATE tasks SET lease_until_ms = ?1
                     WHERE id = ?2 AND owner_key = ?3 AND status = 'working'
                         AND lease_process = ?4 AND lease_until_ms > ?5
                         AND lease_until_ms - ?5 < ?6",
                    params![
                        now.saturating_add(LEASE_MS),
                        id,
                        owner_key,
                        inner.process,
                        now,
                        RENEW_BELOW_MS,
                    ],
                )
                .map(drop)
                .map_err(|error| sql_error(&error))
        })
        .await
    }
}

/// `task-record.v1`, compiled once.
fn record_schema() -> Option<&'static jsonschema::Validator> {
    static SCHEMA: std::sync::OnceLock<Option<jsonschema::Validator>> = std::sync::OnceLock::new();
    SCHEMA
        .get_or_init(|| {
            let schema: Value =
                serde_json::from_str(include_str!("../../schemas/task-record.v1.json")).ok()?;
            jsonschema::validator_for(&schema).ok()
        })
        .as_ref()
}

/// The options of every hosted surface's tasks (section 12.2, step 8's amendment): AFD's TTL,
/// poll and check intervals, the result cap, and each task's TTL ended at its token's `exp` plus
/// [`TOKEN_EXPIRY_GRACE_MS`].
pub(crate) fn options() -> afd::server::TaskOptions {
    afd::server::TaskOptions::new()
        .with_max_result_bytes(MAX_RESULT_BYTES)
        .with_ttl_capped_at_token_expiry(TOKEN_EXPIRY_GRACE_MS)
}

/// `server` with the workspace's shared task store and [`options`], on `clock` (the host's, or
/// the system's): what the hosted HTTP surfaces serve, so every process behind one URL holds the
/// same tasks. A task's owner there always has verified credentials, so AFD tells callers apart.
///
/// # Errors
/// The errors of reading `state/keys/limits.key` (the owner digest's key), and of the OS random
/// source that names this process.
pub(crate) fn serve(
    server: afd::server::McpServer,
    workspace: &crate::Workspace,
    clock: Option<&Arc<dyn Clock>>,
) -> Result<afd::server::McpServer, crate::HostError> {
    let clock: Arc<dyn Clock> = clock.map_or_else(|| Arc::new(afd::SYSTEM_CLOCK) as _, Arc::clone);
    let store = SqliteTasks::new(
        &workspace.layout().tasks_store(),
        workspace.config().store.lock_timeout_ms,
        workspace.limits_key()?,
        Arc::clone(&clock),
        workspace.default_space().as_str().to_owned(),
    )?;
    Ok(server
        .with_clock(clock)
        .with_task_store(store)
        .with_task_options(options()))
}

#[cfg(test)]
impl SqliteTasks {
    /// The row `id` as `task-record.v1` gives it, whoever owns it.
    pub(crate) fn record_v1(&self, id: &str) -> Option<Value> {
        use crate::person::iso;
        self.0
            .with(|connection| {
                connection
                    .query_row(
                        "SELECT owner_json, space, lease_process, lease_until_ms FROM tasks
                         WHERE id = ?1",
                        params![id],
                        |row| {
                            Ok((
                                row.get::<_, String>(0)?,
                                row.get::<_, String>(1)?,
                                row.get::<_, Option<String>>(2)?,
                                row.get::<_, Option<i64>>(3)?,
                            ))
                        },
                    )
                    .optional()
                    .map_err(|error| sql_error(&error))
                    .and_then(|found| {
                        let Some(extra) = found else { return Ok(None) };
                        let row = connection
                            .query_row(
                                &format!("SELECT {COLUMNS} FROM tasks WHERE id = ?1"),
                                params![id],
                                read_row,
                            )
                            .map_err(|error| sql_error(&error))?;
                        Ok(Some((extra, row)))
                    })
            })
            .ok()
            .flatten()
            .map(|((owner, space, process, until), row)| {
                let lease = match (process, until) {
                    (Some(process), Some(until)) => {
                        json!({ "process": process, "until": iso(until) })
                    }
                    _ => Value::Null,
                };
                let status = match row.status {
                    TaskState::Working => "working",
                    TaskState::Completed => "completed",
                    TaskState::Cancelled => "cancelled",
                    _ => "failed",
                };
                json!({
                    "version": crate::versions::TASK_VERSION,
                    "id": row.id,
                    "owner": serde_json::from_str::<Value>(&owner).unwrap_or(Value::Null),
                    "command": row.command,
                    "space": space,
                    "status": status,
                    "statusMessage": row.status_message,
                    "createdAt": iso(row.created_ms),
                    "lastUpdatedAt": iso(row.updated_ms),
                    "ttlMs": row.ttl_ms,
                    "pollIntervalMs": row.poll_ms,
                    "cancelRequested": row.cancel_requested,
                    "lease": lease,
                    "result": row.result,
                    "error": row.error,
                })
            })
    }
}

#[cfg(test)]
mod tests;

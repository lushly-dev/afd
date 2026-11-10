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
    let labelled = |value: Option<&Value>| {
        value
            .and_then(|meta| meta.get(TRUST_KEY))
            .and_then(Value::as_str)
            == Some("content")
    };
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

/// What a `Completed` change stores: the result, unless it carries content or is too large, which
/// a failure that says the command ran replaces.
fn kept_result(result: Map<String, Value>, mutation: bool) -> Map<String, Value> {
    let result = canonical(result, mutation);
    let size = serde_json::to_vec(&result).map_or(usize::MAX, |bytes| bytes.len());
    let replacement = if carries_content(&result) {
        Some(not_kept("is labelled as content"))
    } else if size > MAX_RESULT_BYTES {
        Some(not_kept("is larger than a task keeps"))
    } else {
        None
    };
    match replacement {
        None => result,
        Some(error) => afd::server::failure_result(error).unwrap_or_default(),
    }
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
            // hung. Whichever process reads it first, its own included, ends it, once.
            let lost = afd::server::failure_result(task_lost(row.mutation))
                .ok_or_else(|| unavailable(&"the lost task's result could not be built"))?;
            connection
                .execute(
                    "UPDATE tasks SET status = 'completed', result = ?1, lease_process = NULL,
                         lease_until_ms = NULL, updated_ms = ?2, content_until_ms = expires_ms
                     WHERE id = ?3 AND status = 'working' AND lease_until_ms <= ?2",
                    params![Value::Object(lost).to_string(), now, id],
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
                          at: i64|
             -> Result<(), TaskStoreError> {
                let notice = result
                    .as_ref()
                    .is_some_and(|result| is_notice(result, at, row.content_until_ms));
                transaction
                    .execute(
                        "UPDATE tasks SET status = ?1, result = ?2, error = ?3, updated_ms = ?4,
                             lease_process = NULL, lease_until_ms = NULL,
                             content_until_ms = CASE WHEN ?5 THEN expires_ms
                                 ELSE content_until_ms END
                         WHERE id = ?6 AND status = 'working'",
                        params![
                            status,
                            result.map(|result| Value::Object(result).to_string()),
                            error.map(|error| Value::Object(error).to_string()),
                            at,
                            notice,
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
                TaskChange::Completed { result, at } => {
                    finish(
                        "completed",
                        Some(kept_result(result, row.mutation)),
                        None,
                        at,
                    )?;
                }
                TaskChange::Failed { at, .. } => {
                    finish("failed", None, Some(internal_error_object()), at)?;
                }
                TaskChange::Cancelled { at } => finish("cancelled", None, None, at)?,
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
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::*;
    use crate::principal::{Authentication, Transport};
    use afd::{Actor, ActorKind, CommandContext, CommandDefinition, Credentials, ManualClock};

    const NOW: i64 = 1_793_016_000_000;
    const TTL: u64 = 3_600_000;

    struct Nothing;

    #[async_trait::async_trait]
    impl afd::CommandHandler for Nothing {
        async fn execute(
            &self,
            _input: Value,
            _context: CommandContext,
        ) -> afd::CommandResult<Value> {
            afd::success(Value::Null)
        }
    }

    fn command(mutation: bool) -> CommandDefinition {
        let mut command = CommandDefinition::new("job-run", "Run a job.", vec![], Nothing);
        command.mutation = mutation;
        command
    }

    /// A verified caller's context: `agent:corp/<client>` for `corp/<subject>`, issuer `as`,
    /// its token expiring at `exp` seconds.
    fn context(subject: &str, client: &str, exp: i64) -> CommandContext {
        let actor = Actor::new(ActorKind::Agent)
            .with_id(format!("corp/{client}"))
            .with_on_behalf_of(format!("corp/{subject}"))
            .with_label("Some label");
        let mut principal =
            Principal::new(actor.clone(), Transport::Http, Authentication::Verified);
        principal.namespace = Some("corp".into());
        principal.issuer = Some("as".into());
        let mut context = CommandContext::new().with_actor(actor);
        principal.apply(&mut context);
        context.credentials = Some(Arc::new(Credentials::new(
            "https://as.example",
            subject,
            client,
            "https://umbel.example/mcp",
            NOW / 1000,
            exp,
        )));
        context
    }

    fn owner(context: &CommandContext) -> TaskOwner {
        TaskOwner::from_binding(
            afd::principal_binding(context.actor.as_ref(), context.credentials.as_deref()).unwrap(),
        )
    }

    struct Fixture {
        dir: tempfile::TempDir,
        clock: ManualClock,
    }

    impl Fixture {
        fn new() -> Self {
            Self {
                dir: tempfile::tempdir().unwrap(),
                clock: afd::fixed_clock(NOW),
            }
        }

        /// A store, as one process opens it.
        fn store(&self) -> SqliteTasks {
            SqliteTasks::new(
                &self.dir.path().join("shared").join("tasks.sqlite3"),
                1_000,
                vec![7; 32],
                Arc::new(self.clock.clone()),
                "main".into(),
            )
            .unwrap()
        }
    }

    fn new_id() -> String {
        crate::person::service::random_id().unwrap()
    }

    async fn create(
        store: &SqliteTasks,
        context: &CommandContext,
        input: Value,
        ttl: u64,
        mutation: bool,
    ) -> Result<String, TaskStoreError> {
        let id = new_id();
        let record = TaskRecord::new(id.clone(), owner(context), "job-run", NOW, ttl, 1_000);
        let command = command(mutation);
        store
            .create_for(record, TaskCall::new(&command, &input, context))
            .await
            .map(|()| id)
    }

    fn completed(data: Value) -> Map<String, Value> {
        afd::server::tasks::failure_result(CommandError::new("X", "x"))
            .map(|_| ())
            .unwrap();
        let Value::Object(result) = json!({
            "resultType": "complete",
            "content": [{ "type": "text", "text": data.to_string() }],
            "structuredContent": { "success": true, "data": data },
            "isError": false,
        }) else {
            unreachable!()
        };
        result
    }

    #[tokio::test]
    async fn a_task_is_found_only_by_its_owner_and_only_its_owners_fields_are_kept() {
        let fixture = Fixture::new();
        let store = fixture.store();
        let ada = context("ada", "app", NOW / 1000 + 300);
        let id = create(
            &store,
            &ada,
            json!({ "space": "alpha", "secret": "canary-input" }),
            TTL,
            true,
        )
        .await
        .unwrap();
        let found = store.get(&id, &owner(&ada)).await.unwrap().unwrap();
        assert_eq!(found.id, id);
        assert_eq!(found.status, TaskState::Working);
        assert!(found.owner.matches(&owner(&ada)));
        // Another subject, another client, another issuer, another actor: nothing, as for an
        // unknown id.
        let mut other_issuer = context("ada", "app", NOW / 1000 + 300);
        other_issuer.credentials = Some(Arc::new(Credentials::new(
            "https://other.example",
            "ada",
            "app",
            "https://umbel.example/mcp",
            NOW / 1000,
            NOW / 1000 + 300,
        )));
        let mut other_actor = context("ada", "app", NOW / 1000 + 300);
        other_actor.actor = Some(Actor::new(ActorKind::Agent).with_id("corp/other"));
        for stranger in [
            context("bo", "app", NOW / 1000 + 300),
            context("ada", "other-app", NOW / 1000 + 300),
            other_issuer,
            other_actor,
        ] {
            assert!(store.get(&id, &owner(&stranger)).await.unwrap().is_none());
            // Nor can a stranger change it.
            store
                .update(&id, &owner(&stranger), TaskChange::CancelRequested)
                .await
                .unwrap();
        }
        assert!(
            !store
                .get(&id, &owner(&ada))
                .await
                .unwrap()
                .unwrap()
                .cancel_requested
        );
        assert!(store.get(&new_id(), &owner(&ada)).await.unwrap().is_none());
        // The record is task-record.v1, and holds nothing of the token, the input or the label.
        let v1 = store.record_v1(&id).unwrap();
        let schema: Value =
            serde_json::from_str(include_str!("../../schemas/task-record.v1.json")).unwrap();
        let validator = jsonschema::validator_for(&schema).unwrap();
        assert!(validator.is_valid(&v1), "{v1}");
        assert_eq!(
            v1["owner"],
            json!({
                "effectivePrincipal": "human:corp/ada",
                "actor": { "kind": "agent", "id": "corp/app", "onBehalfOf": "corp/ada" },
                "issuer": "as",
                "clientId": "app",
            })
        );
        assert_eq!(v1["space"], json!("alpha"));
        assert_eq!(v1["lease"]["process"], json!(store.process()));
        let file = std::fs::read(fixture.dir.path().join("shared").join("tasks.sqlite3")).unwrap();
        let text = String::from_utf8_lossy(&file);
        for canary in ["canary-input", "Some label", "https://as.example"] {
            assert!(!text.contains(canary), "{canary}");
        }
    }

    #[tokio::test]
    async fn a_space_is_the_input_s_well_formed_space_else_the_default() {
        let fixture = Fixture::new();
        let store = fixture.store();
        let ada = context("ada", "app", NOW / 1000 + 300);
        for (input, space) in [
            (json!({}), "main"),
            (json!({ "space": "beta" }), "beta"),
            (json!({ "space": "Not A Space" }), "main"),
            (json!({ "space": 7 }), "main"),
        ] {
            let id = create(&store, &ada, input, TTL, true).await.unwrap();
            assert_eq!(store.record_v1(&id).unwrap()["space"], json!(space));
        }
    }

    #[tokio::test]
    async fn a_call_with_no_owner_the_record_can_name_is_refused() {
        let fixture = Fixture::new();
        let store = fixture.store();
        // Credentials without the principal's issuer alias: the record could not say who owns it.
        let mut context = context("ada", "app", NOW / 1000 + 300);
        context.extra.clear();
        let error = create(&store, &context, json!({}), TTL, true)
            .await
            .unwrap_err();
        assert!(matches!(error, TaskStoreError::Unavailable(_)), "{error:?}");
        // A bare record, without its call, is refused too.
        let record = TaskRecord::new(new_id(), owner(&context), "job-run", NOW, TTL, 1_000);
        assert!(store.create(record).await.is_err());
    }

    #[tokio::test]
    async fn an_owner_holds_at_most_its_limit_and_a_finished_task_makes_room() {
        let fixture = Fixture::new();
        let store = fixture.store();
        let ada = context("ada", "app", NOW / 1000 + 300);
        let mut ids = Vec::new();
        for _ in 0..MAX_TASKS_PER_OWNER {
            ids.push(create(&store, &ada, json!({}), TTL, true).await.unwrap());
        }
        assert_eq!(
            create(&store, &ada, json!({}), TTL, true)
                .await
                .unwrap_err(),
            TaskStoreError::OwnerLimit {
                limit: MAX_TASKS_PER_OWNER as usize
            }
        );
        // Another owner is not held back by ada's tasks.
        let bo = context("bo", "app", NOW / 1000 + 300);
        create(&store, &bo, json!({}), TTL, true).await.unwrap();
        // A finished task of ada's makes room, and is the one dropped.
        store
            .update(&ids[3], &owner(&ada), TaskChange::Cancelled { at: NOW })
            .await
            .unwrap();
        create(&store, &ada, json!({}), TTL, true).await.unwrap();
        assert!(store.get(&ids[3], &owner(&ada)).await.unwrap().is_none());
        assert!(store.get(&ids[4], &owner(&ada)).await.unwrap().is_some());
    }

    #[tokio::test]
    async fn the_store_holds_at_most_its_total() {
        let fixture = Fixture::new();
        let store = fixture.store();
        let per = MAX_TASKS_PER_OWNER;
        let owners = MAX_TASKS / per;
        let mut first = None;
        for n in 0..owners {
            let caller = context(&format!("u{n}"), "app", NOW / 1000 + 300);
            for _ in 0..per {
                let id = create(&store, &caller, json!({}), TTL, true).await.unwrap();
                first.get_or_insert((caller.clone(), id));
            }
        }
        let late = context("late", "app", NOW / 1000 + 300);
        assert_eq!(
            create(&store, &late, json!({}), TTL, true)
                .await
                .unwrap_err(),
            TaskStoreError::TotalLimit {
                limit: MAX_TASKS as usize
            }
        );
        let (caller, id) = first.unwrap();
        store
            .update(&id, &owner(&caller), TaskChange::Cancelled { at: NOW })
            .await
            .unwrap();
        create(&store, &late, json!({}), TTL, true).await.unwrap();
        assert!(store.get(&id, &owner(&caller)).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn a_result_is_gone_at_the_token_s_exp_and_only_a_notice_lasts_the_grace() {
        let fixture = Fixture::new();
        let store = fixture.store();
        let exp = NOW / 1000 + 120;
        let ada = context("ada", "app", exp);
        let ttl = 120_000 + TOKEN_EXPIRY_GRACE_MS;
        let done = create(&store, &ada, json!({}), ttl, true).await.unwrap();
        let expired = create(&store, &ada, json!({}), ttl, true).await.unwrap();
        let cancelled = create(&store, &ada, json!({}), ttl, true).await.unwrap();
        store
            .update(
                &done,
                &owner(&ada),
                TaskChange::Completed {
                    result: completed(json!({ "indexed": 3 })),
                    at: NOW,
                },
            )
            .await
            .unwrap();
        store
            .update(&cancelled, &owner(&ada), TaskChange::Cancelled { at: NOW })
            .await
            .unwrap();
        fixture.clock.advance(119_999);
        for id in [&done, &expired, &cancelled] {
            assert!(store.get(id, &owner(&ada)).await.unwrap().is_some());
        }
        fixture.clock.advance(1);
        assert!(store.get(&done, &owner(&ada)).await.unwrap().is_none());
        assert!(store.get(&cancelled, &owner(&ada)).await.unwrap().is_none());
        // The runner writes the notice once the token has expired; it lasts the grace.
        let notice = afd::server::tasks::failure_result(CommandError::new(
            afd::error_codes::TASK_TOKEN_EXPIRED,
            "expired",
        ))
        .unwrap();
        store
            .update(
                &expired,
                &owner(&ada),
                TaskChange::Completed {
                    result: notice,
                    at: NOW + 120_000,
                },
            )
            .await
            .unwrap();
        assert!(store.get(&expired, &owner(&ada)).await.unwrap().is_some());
        fixture.clock.advance(TOKEN_EXPIRY_GRACE_MS as i64 - 1);
        assert!(store.get(&expired, &owner(&ada)).await.unwrap().is_some());
        fixture.clock.advance(1);
        assert!(store.get(&expired, &owner(&ada)).await.unwrap().is_none());
        // Gone means purged: no row is left.
        assert_eq!(store.expire(fixture.clock_now()).await.unwrap(), 0);
        assert!(store.record_v1(&expired).is_none());
        assert!(store.record_v1(&done).is_none());
    }

    #[tokio::test]
    async fn a_command_s_own_failure_named_like_the_notice_does_not_outlive_the_token() {
        let fixture = Fixture::new();
        let store = fixture.store();
        let exp = NOW / 1000 + 120;
        let ada = context("ada", "app", exp);
        let ttl = 120_000 + TOKEN_EXPIRY_GRACE_MS;
        let id = create(&store, &ada, json!({}), ttl, true).await.unwrap();
        // Before the token's exp, a failure with the notice's code is the command's own: it may
        // carry what the command produced.
        let forged = afd::server::tasks::failure_result(CommandError::new(
            afd::error_codes::TASK_TOKEN_EXPIRED,
            "canary-forged",
        ))
        .unwrap();
        store
            .update(
                &id,
                &owner(&ada),
                TaskChange::Completed {
                    result: forged,
                    at: NOW + 5,
                },
            )
            .await
            .unwrap();
        fixture.clock.advance(120_000);
        assert!(store.get(&id, &owner(&ada)).await.unwrap().is_none());
        assert!(store.record_v1(&id).is_none());
    }

    impl Fixture {
        fn clock_now(&self) -> i64 {
            Clock::now(&self.clock)
        }
    }

    #[tokio::test]
    async fn only_the_runner_s_heartbeat_renews_a_lease_and_another_process_loses_it_once() {
        let fixture = Fixture::new();
        let running = fixture.store();
        let other = fixture.store();
        assert_ne!(running.process(), other.process());
        let ada = context("ada", "app", NOW / 1000 + 3_600);
        let id = create(&running, &ada, json!({}), TTL, true).await.unwrap();
        // A heartbeat in time renews it, however late in the lease.
        fixture.clock.advance(LEASE_MS - 1);
        running
            .heartbeat(&id, &owner(&ada), fixture.clock_now())
            .await
            .unwrap();
        fixture.clock.advance(LEASE_MS - 1);
        assert_eq!(
            other.get(&id, &owner(&ada)).await.unwrap().unwrap().status,
            TaskState::Working
        );
        // Another process's heartbeat, a stranger's, and reads renew nothing.
        other
            .heartbeat(&id, &owner(&ada), fixture.clock_now())
            .await
            .unwrap();
        let bo = context("bo", "app", NOW / 1000 + 3_600);
        running
            .heartbeat(&id, &owner(&bo), fixture.clock_now())
            .await
            .unwrap();
        running.get(&id, &owner(&ada)).await.unwrap().unwrap();
        fixture.clock.advance(1);
        let lost = other.get(&id, &owner(&ada)).await.unwrap().unwrap();
        assert_eq!(lost.status, TaskState::Completed);
        let result = lost.result.unwrap();
        assert_eq!(
            result["structuredContent"]["error"]["code"],
            json!(TASK_LOST)
        );
        assert_eq!(
            result["structuredContent"]["error"]["retryable"],
            json!(false)
        );
        // Once: the running process's late outcome changes nothing.
        running
            .update(
                &id,
                &owner(&ada),
                TaskChange::Completed {
                    result: completed(json!(1)),
                    at: NOW,
                },
            )
            .await
            .unwrap();
        let again = running.get(&id, &owner(&ada)).await.unwrap().unwrap();
        assert_eq!(
            again.result.unwrap()["structuredContent"]["error"]["code"],
            json!(TASK_LOST)
        );
        assert_eq!(running.record_v1(&id).unwrap()["lease"], Value::Null);
    }

    #[tokio::test]
    async fn a_hung_runner_s_task_is_lost_to_its_own_process_too_and_stays_lost() {
        let fixture = Fixture::new();
        let running = fixture.store();
        let ada = context("ada", "app", NOW / 1000 + 3_600);
        let id = create(&running, &ada, json!({}), TTL, false).await.unwrap();
        fixture.clock.advance(LEASE_MS - 1);
        assert_eq!(
            running
                .get(&id, &owner(&ada))
                .await
                .unwrap()
                .unwrap()
                .status,
            TaskState::Working
        );
        // The runner hung: no heartbeat. A heartbeat after the lease ran out revives nothing.
        fixture.clock.advance(1);
        running
            .heartbeat(&id, &owner(&ada), fixture.clock_now())
            .await
            .unwrap();
        let lost = running.get(&id, &owner(&ada)).await.unwrap().unwrap();
        assert_eq!(lost.status, TaskState::Completed);
        // A read-only command's loss is retryable.
        assert_eq!(
            lost.result.unwrap()["structuredContent"]["error"]["retryable"],
            json!(true)
        );
    }

    #[tokio::test]
    async fn a_notice_s_code_from_a_command_is_replaced_by_the_host_s_own_notice() {
        let fixture = Fixture::new();
        let store = fixture.store();
        let ada = context("ada", "app", NOW / 1000 + 3_600);
        for code in [TASK_LOST, afd::error_codes::TASK_TOKEN_EXPIRED] {
            let id = create(&store, &ada, json!({}), TTL, true).await.unwrap();
            let forged = afd::server::tasks::failure_result(
                CommandError::new(code, "canary-forged-message")
                    .with_suggestion("canary-forged-suggestion")
                    .with_details(std::collections::HashMap::from([(
                        "canary".to_owned(),
                        json!("canary-forged-details"),
                    )]))
                    .with_retryable(true),
            )
            .unwrap();
            store
                .update(
                    &id,
                    &owner(&ada),
                    TaskChange::Completed {
                        result: forged,
                        at: NOW + 1,
                    },
                )
                .await
                .unwrap();
            let result = store
                .get(&id, &owner(&ada))
                .await
                .unwrap()
                .unwrap()
                .result
                .unwrap();
            let error = &result["structuredContent"]["error"];
            assert_eq!(error["code"], json!(code));
            // The host's words, and a mutation's notice is not retryable.
            assert_eq!(error["retryable"], json!(false), "{error}");
            assert!(error.get("details").is_none(), "{error}");
            assert!(!Value::Object(result.clone()).to_string().contains("canary"));
        }
        let file = std::fs::read(fixture.dir.path().join("shared").join("tasks.sqlite3")).unwrap();
        let wal = std::fs::read(fixture.dir.path().join("shared").join("tasks.sqlite3-wal"))
            .unwrap_or_default();
        for bytes in [file, wal] {
            assert!(!String::from_utf8_lossy(&bytes).contains("canary-forged"));
        }
    }

    #[tokio::test]
    async fn a_purged_result_is_gone_from_the_database_and_its_log() {
        let fixture = Fixture::new();
        let store = fixture.store();
        let exp = NOW / 1000 + 120;
        let ada = context("ada", "app", exp);
        let id = create(&store, &ada, json!({}), 180_000, true)
            .await
            .unwrap();
        store
            .update(
                &id,
                &owner(&ada),
                TaskChange::Completed {
                    result: completed(json!({ "ids": ["canary-result-id"] })),
                    at: NOW + 1,
                },
            )
            .await
            .unwrap();
        let read = |name: &str| {
            std::fs::read(fixture.dir.path().join("shared").join(name)).unwrap_or_default()
        };
        let held = |bytes: &[u8]| String::from_utf8_lossy(bytes).contains("canary-result-id");
        assert!(held(&read("tasks.sqlite3")) || held(&read("tasks.sqlite3-wal")));
        fixture.clock.advance(120_000);
        assert!(store.get(&id, &owner(&ada)).await.unwrap().is_none());
        assert!(!held(&read("tasks.sqlite3")), "the database");
        assert!(!held(&read("tasks.sqlite3-wal")), "the log");
    }

    #[tokio::test]
    async fn a_record_the_schema_refuses_is_never_written() {
        let fixture = Fixture::new();
        let store = fixture.store();
        // A client id with a control character: `task-record.v1` refuses it.
        let bad = context("ada", "app\u{7}", NOW / 1000 + 300);
        let error = create(&store, &bad, json!({}), TTL, true)
            .await
            .unwrap_err();
        assert!(matches!(error, TaskStoreError::Unavailable(_)), "{error:?}");
        assert!(
            !fixture
                .dir
                .path()
                .join("shared")
                .join("tasks.sqlite3")
                .exists()
        );
    }

    #[tokio::test]
    async fn progress_keeps_phase_names_only_and_content_never_reaches_a_record() {
        let fixture = Fixture::new();
        let store = fixture.store();
        let ada = context("ada", "app", NOW / 1000 + 3_600);
        let id = create(&store, &ada, json!({}), TTL, true).await.unwrap();
        let progress = |message: &str| TaskChange::Progress {
            message: message.into(),
            at: NOW + 1,
        };
        store
            .update(&id, &owner(&ada), progress("indexing"))
            .await
            .unwrap();
        for refused in ["indexed 42 of 100", "Indexing", "secret plans.md", ""] {
            store
                .update(&id, &owner(&ada), progress(refused))
                .await
                .unwrap();
        }
        let record = store.get(&id, &owner(&ada)).await.unwrap().unwrap();
        assert_eq!(record.status_message.as_deref(), Some("indexing"));
        // A result labelled as content is replaced by a failure that says the command ran.
        let mut labelled = completed(json!({ "text": "canary-content" }));
        labelled["structuredContent"]["metadata"] = json!({ "dev.umbel/trust": "content" });
        store
            .update(
                &id,
                &owner(&ada),
                TaskChange::Completed {
                    result: labelled,
                    at: NOW + 2,
                },
            )
            .await
            .unwrap();
        let record = store.get(&id, &owner(&ada)).await.unwrap().unwrap();
        let result = record.result.unwrap();
        assert_eq!(result["isError"], json!(true));
        assert!(!Value::Object(result).to_string().contains("canary-content"));
        // So is one larger than a task keeps.
        let big = create(&store, &ada, json!({}), TTL, true).await.unwrap();
        store
            .update(
                &big,
                &owner(&ada),
                TaskChange::Completed {
                    result: completed(json!("x".repeat(MAX_RESULT_BYTES))),
                    at: NOW + 2,
                },
            )
            .await
            .unwrap();
        let result = store
            .get(&big, &owner(&ada))
            .await
            .unwrap()
            .unwrap()
            .result
            .unwrap();
        assert_eq!(result["isError"], json!(true));
        // A failed task holds only the internal error.
        let failed = create(&store, &ada, json!({}), TTL, true).await.unwrap();
        let mut error = Map::new();
        error.insert("code".into(), json!(-32603));
        error.insert("message".into(), json!("canary-error"));
        store
            .update(
                &failed,
                &owner(&ada),
                TaskChange::Failed { error, at: NOW + 2 },
            )
            .await
            .unwrap();
        let v1 = store.record_v1(&failed).unwrap();
        assert_eq!(
            v1["error"],
            json!({ "code": -32603, "message": "Internal error" })
        );
        let file = std::fs::read(fixture.dir.path().join("shared").join("tasks.sqlite3")).unwrap();
        let wal = std::fs::read(fixture.dir.path().join("shared").join("tasks.sqlite3-wal"))
            .unwrap_or_default();
        for bytes in [file, wal] {
            let text = String::from_utf8_lossy(&bytes);
            for canary in ["canary-content", "canary-error", "secret plans"] {
                assert!(!text.contains(canary), "{canary}");
            }
        }
    }

    #[tokio::test]
    async fn the_file_is_private_and_durable_before_create_returns() {
        let fixture = Fixture::new();
        let store = fixture.store();
        let ada = context("ada", "app", NOW / 1000 + 3_600);
        let id = create(&store, &ada, json!({}), TTL, true).await.unwrap();
        // Another process, opening the file now, finds it.
        assert!(
            fixture
                .store()
                .get(&id, &owner(&ada))
                .await
                .unwrap()
                .is_some()
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let shared = fixture.dir.path().join("shared");
            let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode(&shared), 0o700);
            assert_eq!(mode(&shared.join("tasks.sqlite3")), 0o600);
        }
    }
}

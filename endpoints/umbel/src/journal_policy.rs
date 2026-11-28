//! Per-command journal policies: the required journal mode (D208 as amended by D221, with D224's
//! details).
//!
//! An embedder names a policy for each command that needs one, with [`JournalPolicies`], and hands
//! it to [`HostBuilder::with_journal_policies`](crate::HostBuilder::with_journal_policies). A
//! plugin manifest never sets one. A workspace whose embedder sets none keeps Umbel's default
//! journal, fail-open (D66), byte for byte: neither the middleware nor the sink below is
//! installed, and no write-ahead file is made.
//!
//! - **required** (commands that start something): before the handler runs, the innermost
//!   middleware appends an intent record to the write-ahead file (`state/journal.ahead.jsonl`)
//!   and syncs it to disk. The record holds the call's dispatch id
//!   ([`CommandContext::dispatch_id`]), its trace id as correlation only, the command, the actor,
//!   the time and the input keys the command's digest mode keeps (no input when it keeps none). If
//!   the append or the sync fails, the call is refused with the retryable [`JOURNAL_UNAVAILABLE`]
//!   and the handler never runs; a call with no dispatch id is refused with
//!   [`DISPATCH_ID_MISSING`]. When `next` returns, the middleware appends the outcome beside the
//!   intent, which settles it. A second intent under a dispatch id that already holds one (a
//!   retrying middleware outside this one) is a new attempt, told apart by its `seq`.
//! - **buffered** (commands that stop something): the call always runs. While the journal cannot
//!   be written, the entry of a call that succeeded waits in a bounded buffer and is written, in
//!   order, before any later entry once the journal takes writes again. When the buffer is full a
//!   further entry is dropped and counted.
//! - **droppable** (reads): an entry that cannot be written is dropped and counted. The entry of a
//!   refusal or failure of any command is droppable, and so is the entry of a command with no
//!   policy (D224).
//!
//! On open, every intent with no outcome is reported through [`JournalHealth::unsettled`], so the
//! embedder can reconcile it with what the effect left. [`JournalHealth`] also reads `writable`,
//! `pending` and `dropped`.

use afd::{
    BoxFuture, Clock, CommandContext, CommandError, CommandMiddleware, CommandResult, JournalEntry,
    JournalRange, JournalRecord, JournalSink, MiddlewareNext, failure,
};
use async_trait::async_trait;
use serde_json::{Map, Value, json};
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::io;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

/// The code of a required call refused because its intent could not be written (retryable).
pub const JOURNAL_UNAVAILABLE: &str = "JOURNAL_UNAVAILABLE";
/// The code of a required call refused because it has no dispatch id: it was run outside a
/// registry, or on a build with no random source (not retryable).
pub const DISPATCH_ID_MISSING: &str = "DISPATCH_ID_MISSING";
/// How many buffered entries wait while the journal cannot be written, unless the embedder sets
/// another bound.
pub const DEFAULT_BUFFER: usize = 1024;
/// The version every write-ahead record carries as `v`.
pub const AHEAD_VERSION: u64 = 1;

const DEFAULT_SUGGESTION: &str = "The workspace's journal cannot be written (its disk may be full or its file locked). Free the space or the lock, then retry; reads and stops still run.";

/// A command's journal policy (D208).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum JournalPolicy {
    /// An intent written and synced before the handler; refused when it cannot be. The intent
    /// keeps the command's digest-kept input keys before the handler has judged them, so give it
    /// only to a command whose kept keys hold no value its handler could refuse as a secret
    /// (D224).
    Required,
    /// The call always runs; its entry waits in a bounded buffer while the journal is down.
    Buffered,
    /// An entry that cannot be written is dropped and counted.
    Droppable,
}

impl JournalPolicy {
    /// `required`, `buffered` or `droppable`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Required => "required",
            Self::Buffered => "buffered",
            Self::Droppable => "droppable",
        }
    }
}

/// Where the policies write: the write-ahead file, and a check before each journal entry.
///
/// The host's own is the file `state/journal.ahead.jsonl`, appended to and synced with
/// `sync_data`. A test, or a harness that must fail writes on demand, gives its own with
/// [`JournalPolicies::with_storage`]; the journal itself and the event projection stay real.
pub trait JournalStorage: Send + Sync + 'static {
    /// Append `line` (one JSON record and its newline) to the write-ahead file and sync it to
    /// disk. Returns only once the bytes are durable.
    ///
    /// # Errors
    /// Any failure to open, write or sync: the record is then not durable.
    fn append_ahead(&self, line: &[u8]) -> io::Result<()>;

    /// The write-ahead file's bytes; empty when there is no file yet.
    ///
    /// # Errors
    /// A failure to read a file that exists.
    fn read_ahead(&self) -> io::Result<Vec<u8>>;

    /// Whether the write-ahead file can be opened for appending, without writing to it: what
    /// [`JournalHealth::writable`] reports before any required call.
    ///
    /// # Errors
    /// The failure to open it.
    fn check_ahead(&self) -> io::Result<()>;

    /// Called before each journal entry is written: an error stands for a journal that cannot be
    /// written, and the entry is held or dropped by its policy. The host's own storage always
    /// answers `Ok`, so a real failure is the journal's own.
    ///
    /// # Errors
    /// A journal the storage says cannot be written now.
    fn check_journal(&self) -> io::Result<()> {
        Ok(())
    }
}

/// The host's write-ahead file.
struct FileStorage {
    path: PathBuf,
    lock: Mutex<()>,
    /// Whether this process has synced the file's directory since it last appended: until it
    /// has, the file's own entry may not be durable, whoever made the file.
    directory_synced: AtomicBool,
}

impl FileStorage {
    fn new(path: PathBuf) -> Self {
        Self {
            path,
            lock: Mutex::new(()),
            directory_synced: AtomicBool::new(false),
        }
    }
}

impl JournalStorage for FileStorage {
    fn append_ahead(&self, line: &[u8]) -> io::Result<()> {
        use std::io::{Read, Seek, SeekFrom, Write};
        let _guard = self
            .lock
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .read(true)
            .append(true)
            .open(&self.path)?;
        // A write a crash tore leaves a last line with no newline; the record must not be joined
        // to it, or the report would skip both.
        if file.metadata()?.len() > 0 {
            let mut last = [0u8; 1];
            file.seek(SeekFrom::End(-1))?;
            file.read_exact(&mut last)?;
            if last[0] != b'\n' {
                file.write_all(b"\n")?;
            }
        }
        file.write_all(line)?;
        file.sync_data()?;
        // The file's directory entry must be durable too, or a crash can lose the file whole.
        // Synced on this process's first append, and on each later one until a sync succeeds.
        if !self.directory_synced.load(Ordering::SeqCst) {
            #[cfg(unix)]
            if let Some(parent) = self.path.parent() {
                std::fs::File::open(parent)?.sync_all()?;
            }
            self.directory_synced.store(true, Ordering::SeqCst);
        }
        Ok(())
    }

    fn read_ahead(&self) -> io::Result<Vec<u8>> {
        match std::fs::read(&self.path) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Vec::new()),
            other => other,
        }
    }

    fn check_ahead(&self) -> io::Result<()> {
        if self.path.exists() {
            return std::fs::OpenOptions::new()
                .append(true)
                .open(&self.path)
                .map(drop);
        }
        // No file yet: one is made by the first required call and not before, so that a fresh
        // workspace stays empty for a restore. A probe beside it shows the directory takes one.
        // Named for this process and this check, so two checks (two flushes, two processes) or a
        // probe a crash left never make a writable directory look unwritable.
        static PROBES: AtomicU64 = AtomicU64::new(0);
        let mut probe = self.path.clone().into_os_string();
        probe.push(format!(
            ".probe-{}-{}",
            std::process::id(),
            PROBES.fetch_add(1, Ordering::SeqCst)
        ));
        let probe = PathBuf::from(probe);
        std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&probe)
            .map(drop)?;
        match std::fs::remove_file(&probe) {
            Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error),
            _ => Ok(()),
        }
    }
}

/// An intent the write-ahead file holds with no outcome: a call that never returned (a timeout,
/// a dropped future, a panic, a crash) or whose outcome could not be written.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub struct UnsettledIntent {
    /// The call's dispatch id.
    pub dispatch_id: String,
    /// Which attempt under that id this was, from 1: a retrying middleware runs the call again
    /// under the same id.
    pub attempt: u32,
    /// The intent's sequence number in the write-ahead file.
    pub seq: u64,
    /// The call's trace id, for correlation only.
    pub trace_id: Option<String>,
    /// The command.
    pub command: String,
    /// The actor, as the record holds it.
    pub actor: Option<Value>,
    /// When the intent was written, ISO 8601 UTC with milliseconds.
    pub at: String,
    /// The input keys the command's digest mode keeps; `None` when it keeps none.
    pub input: Option<Map<String, Value>>,
    /// The approval that admitted the call, when the approval step filed one: the approval
    /// summary without its input digest.
    pub approval: Option<Value>,
}

/// What the write-ahead file held on open.
struct Report {
    unsettled: Vec<UnsettledIntent>,
    unreadable: usize,
    next_seq: u64,
}

/// Read the write-ahead file's records. A line that is not a record (a write torn by a crash) is
/// counted and skipped.
fn read_report(bytes: &[u8]) -> Report {
    struct Seen {
        intent: UnsettledIntent,
        settled: bool,
    }
    let text = String::from_utf8_lossy(bytes);
    let mut intents: Vec<Seen> = Vec::new();
    let mut by_attempt: HashMap<(String, u64), usize> = HashMap::new();
    let mut attempts: HashMap<String, u32> = HashMap::new();
    let mut approvals: HashMap<String, Value> = HashMap::new();
    let mut unreadable = 0;
    let mut next_seq = 1;
    for line in text.lines().filter(|line| !line.trim().is_empty()) {
        let Ok(Value::Object(record)) = serde_json::from_str::<Value>(line) else {
            unreadable += 1;
            continue;
        };
        let text = |key: &str| record.get(key).and_then(Value::as_str).map(str::to_owned);
        let (Some(kind), Some(dispatch)) = (text("kind"), text("dispatchId")) else {
            unreadable += 1;
            continue;
        };
        let seq = record.get("seq").and_then(Value::as_u64);
        match (kind.as_str(), seq) {
            ("intent", Some(seq)) => {
                let Some(command) = text("command") else {
                    unreadable += 1;
                    continue;
                };
                next_seq = next_seq.max(seq + 1);
                let attempt = attempts.entry(dispatch.clone()).or_insert(0);
                *attempt += 1;
                by_attempt.insert((dispatch.clone(), seq), intents.len());
                intents.push(Seen {
                    intent: UnsettledIntent {
                        dispatch_id: dispatch,
                        attempt: *attempt,
                        seq,
                        trace_id: text("traceId"),
                        command,
                        actor: record
                            .get("actor")
                            .cloned()
                            .filter(|actor| !actor.is_null()),
                        at: text("at").unwrap_or_default(),
                        input: record.get("input").and_then(Value::as_object).cloned(),
                        approval: None,
                    },
                    settled: false,
                });
            }
            ("outcome", Some(seq)) => {
                if let Some(index) = by_attempt.get(&(dispatch, seq)) {
                    intents[*index].settled = true;
                }
            }
            ("approval", _) => {
                if let Some(approval) = record.get("approval") {
                    approvals.insert(dispatch, approval.clone());
                }
            }
            _ => unreadable += 1,
        }
    }
    let unsettled = intents
        .into_iter()
        .filter(|seen| !seen.settled)
        .map(|seen| {
            let mut intent = seen.intent;
            intent.approval = approvals.get(&intent.dispatch_id).cloned();
            intent
        })
        .collect();
    Report {
        unsettled,
        unreadable,
        next_seq,
    }
}

/// The live state an embedder reads: shared by the handle, the middleware and the sink.
#[derive(Default)]
struct Live {
    ahead_ok: AtomicBool,
    journal_ok: AtomicBool,
    pending: AtomicUsize,
    dropped: AtomicU64,
    unreadable: AtomicUsize,
    opened: AtomicBool,
    unsettled: OnceLock<Vec<UnsettledIntent>>,
    report_error: OnceLock<String>,
    /// Weak: the sink core holds the policies, which hold this state.
    core: OnceLock<std::sync::Weak<SinkCore>>,
}

/// What an embedder reads of the journal policies: `writable`, `pending`, `dropped` and the
/// intents left unsettled when the host opened. Cheap to clone; every clone reads the same host.
/// Before [`HostBuilder::seal`](crate::HostBuilder::seal) it reads as a journal that is writable
/// with nothing pending.
#[derive(Clone)]
pub struct JournalHealth {
    live: Arc<Live>,
}

impl std::fmt::Debug for JournalHealth {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("JournalHealth")
            .field("writable", &self.writable())
            .field("pending", &self.pending())
            .field("dropped", &self.dropped())
            .finish_non_exhaustive()
    }
}

impl JournalHealth {
    fn new() -> Self {
        let live = Live::default();
        live.ahead_ok.store(true, Ordering::SeqCst);
        live.journal_ok.store(true, Ordering::SeqCst);
        Self {
            live: Arc::new(live),
        }
    }

    /// Whether the last write to the write-ahead file and the last write to the journal both
    /// succeeded. At open, whether the write-ahead file can be opened for appending.
    pub fn writable(&self) -> bool {
        self.live.ahead_ok.load(Ordering::SeqCst) && self.live.journal_ok.load(Ordering::SeqCst)
    }

    /// How many buffered entries wait for the journal.
    pub fn pending(&self) -> usize {
        self.live.pending.load(Ordering::SeqCst)
    }

    /// How many entries were dropped since the host opened: droppable entries the journal could
    /// not take, and buffered ones that found the buffer full.
    pub fn dropped(&self) -> u64 {
        self.live.dropped.load(Ordering::SeqCst)
    }

    /// The intents with no outcome when the host opened, in the order they were written.
    pub fn unsettled(&self) -> &[UnsettledIntent] {
        self.live.unsettled.get().map_or(&[], Vec::as_slice)
    }

    /// The lines of the write-ahead file that were not records when the host opened (a write a
    /// crash tore), which the report skipped.
    pub fn unreadable(&self) -> usize {
        self.live.unreadable.load(Ordering::SeqCst)
    }

    /// Why the write-ahead file could not be read when the host opened, if it could not: the
    /// report of unsettled intents is then empty and incomplete.
    pub fn report_error(&self) -> Option<&str> {
        self.live.report_error.get().map(String::as_str)
    }

    /// Ask again whether the write-ahead file can be opened, and write the buffered entries now,
    /// in order, if the journal takes them. Every journal write tries the buffer first anyway;
    /// this is for an embedder that wants it written without waiting for the next call. Returns
    /// how many entries still wait.
    pub async fn flush(&self) -> usize {
        let Some(core) = self.live.core.get().and_then(std::sync::Weak::upgrade) else {
            return 0;
        };
        // On a task of its own, so a caller that stops waiting cannot leave a write half done.
        tokio::spawn(async move {
            core.refresh_ahead().await;
            let mut queue = core.queue.lock().await;
            core.drain(&mut queue).await;
            queue.len()
        })
        .await
        .unwrap_or_else(|_| self.pending())
    }
}

/// The policies an embedder sets, per command, and how they write. Give it to
/// [`HostBuilder::with_journal_policies`](crate::HostBuilder::with_journal_policies); keep
/// [`Self::health`] to read the live counts after the host is sealed.
pub struct JournalPolicies {
    policies: BTreeMap<String, JournalPolicy>,
    buffer: usize,
    suggestion: String,
    storage: Option<Arc<dyn JournalStorage>>,
    health: JournalHealth,
}

impl Default for JournalPolicies {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Debug for JournalPolicies {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("JournalPolicies")
            .field("policies", &self.policies)
            .field("buffer", &self.buffer)
            .finish_non_exhaustive()
    }
}

impl JournalPolicies {
    /// No policies yet, a buffer of [`DEFAULT_BUFFER`] entries and the host's own write-ahead file.
    pub fn new() -> Self {
        Self {
            policies: BTreeMap::new(),
            buffer: DEFAULT_BUFFER,
            suggestion: DEFAULT_SUGGESTION.to_owned(),
            storage: None,
            health: JournalHealth::new(),
        }
    }

    /// Give `command` the policy `policy`. `seal` refuses a name no sealed command has.
    #[must_use]
    pub fn with(mut self, command: impl Into<String>, policy: JournalPolicy) -> Self {
        self.policies.insert(command.into(), policy);
        self
    }

    /// Hold at most `entries` buffered entries while the journal cannot be written (at least 1).
    #[must_use]
    pub fn with_buffer(mut self, entries: usize) -> Self {
        self.buffer = entries.max(1);
        self
    }

    /// The suggestion a [`JOURNAL_UNAVAILABLE`] refusal carries, for an embedder with its own
    /// health command to point at.
    #[must_use]
    pub fn with_unavailable_suggestion(mut self, suggestion: impl Into<String>) -> Self {
        let suggestion = suggestion.into();
        // A refusal always says what to do: blank text keeps the host's own.
        if !suggestion.trim().is_empty() {
            self.suggestion = suggestion;
        }
        self
    }

    /// Write through `storage` instead of `state/journal.ahead.jsonl`.
    #[must_use]
    pub fn with_storage(mut self, storage: impl JournalStorage) -> Self {
        self.storage = Some(Arc::new(storage));
        self
    }

    /// The handle that reads these policies' live state once the host is sealed.
    pub fn health(&self) -> JournalHealth {
        self.health.clone()
    }

    /// The policy of `command`, if it has one.
    pub fn policy(&self, command: &str) -> Option<JournalPolicy> {
        self.policies.get(command).copied()
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.policies.is_empty()
    }

    pub(crate) fn names(&self) -> impl Iterator<Item = &str> {
        self.policies.keys().map(String::as_str)
    }

    /// Open the policies over a workspace: read the write-ahead file and report its unsettled
    /// intents, check that it can be appended to, and build what the host installs.
    pub(crate) fn open(
        self,
        ahead_file: PathBuf,
        clock: Option<Arc<dyn Clock>>,
        kept: BTreeMap<String, Vec<String>>,
    ) -> Result<Arc<Policies>, String> {
        let live = Arc::clone(&self.health.live);
        if live.opened.swap(true, Ordering::SeqCst) {
            return Err("these journal policies already belong to a sealed host".to_owned());
        }
        let storage = self
            .storage
            .unwrap_or_else(|| Arc::new(FileStorage::new(ahead_file)));
        let next_seq = match storage.read_ahead() {
            Ok(bytes) => {
                let report = read_report(&bytes);
                if report.unreadable > 0 {
                    tracing::warn!(
                        "journal: {} line(s) of the write-ahead file are not records and were skipped",
                        report.unreadable
                    );
                }
                live.unreadable.store(report.unreadable, Ordering::SeqCst);
                let _ = live.unsettled.set(report.unsettled);
                report.next_seq
            }
            Err(error) => {
                let message = format!("the write-ahead file could not be read: {error}");
                tracing::error!("journal: {message}");
                let _ = live.report_error.set(message);
                let _ = live.unsettled.set(Vec::new());
                // Numbering restarts; the dispatch id still tells two attempts' records apart.
                1
            }
        };
        let ahead_ok = storage.check_ahead().is_ok();
        live.ahead_ok.store(ahead_ok, Ordering::SeqCst);
        live.journal_ok
            .store(storage.check_journal().is_ok(), Ordering::SeqCst);
        Ok(Arc::new(Policies {
            policies: self.policies,
            buffer: self.buffer,
            suggestion: self.suggestion,
            storage,
            live,
            next_seq: AtomicU64::new(next_seq),
            clock,
            kept,
        }))
    }
}

/// The sealed policies: what the middleware, the approval hook and the sink share.
pub(crate) struct Policies {
    policies: BTreeMap<String, JournalPolicy>,
    buffer: usize,
    suggestion: String,
    storage: Arc<dyn JournalStorage>,
    live: Arc<Live>,
    next_seq: AtomicU64,
    clock: Option<Arc<dyn Clock>>,
    /// The input keys each digest command keeps (phase 3 section 7.1).
    kept: BTreeMap<String, Vec<String>>,
}

impl Policies {
    fn now(&self) -> String {
        let ms = self.clock.as_ref().map_or_else(
            || chrono::Utc::now().timestamp_millis(),
            |clock| clock.now(),
        );
        crate::person::iso(ms)
    }

    /// The handle that reads these policies' live state.
    pub(crate) fn health(&self) -> JournalHealth {
        JournalHealth {
            live: Arc::clone(&self.live),
        }
    }

    pub(crate) fn is_required(&self, command: &str) -> bool {
        self.policies.get(command) == Some(&JournalPolicy::Required)
    }

    /// Append one record and sync it, off the async runtime; records whether it worked.
    async fn append_ahead(&self, record: &Value) -> io::Result<()> {
        let mut line = serde_json::to_vec(record).map_err(io::Error::other)?;
        line.push(b'\n');
        let storage = Arc::clone(&self.storage);
        let outcome = tokio::task::spawn_blocking(move || storage.append_ahead(&line))
            .await
            .unwrap_or_else(|error| Err(io::Error::other(error.to_string())));
        self.live.ahead_ok.store(outcome.is_ok(), Ordering::SeqCst);
        outcome
    }

    fn unavailable(&self, command: &str) -> CommandError {
        CommandError::new(
            JOURNAL_UNAVAILABLE,
            format!("'{command}' was not run: its intent could not be written to the journal"),
        )
        .with_suggestion(self.suggestion.clone())
        .with_retryable(true)
    }

    /// File the approval that admitted a held required call beside its intent (D221), from the
    /// approval step's `on_approval_accepted` hook. Best effort: if it cannot be written, the
    /// intent that follows it cannot be either, and the call is refused there.
    pub(crate) async fn file_approval(
        &self,
        summary: &afd::ApprovalSummary,
        dispatch_id: Option<String>,
    ) {
        if !self.is_required(&summary.command) {
            return;
        }
        let Some(dispatch_id) = dispatch_id else {
            return;
        };
        let mut approval = serde_json::to_value(summary).unwrap_or(Value::Null);
        // An unkeyed digest of the whole input would confirm a guess at what the intent leaves out.
        if let Value::Object(map) = &mut approval {
            map.remove("inputDigest");
        }
        let record = json!({
            "v": AHEAD_VERSION,
            "kind": "approval",
            "dispatchId": dispatch_id,
            "at": self.now(),
            "approval": approval,
        });
        if let Err(error) = self.append_ahead(&record).await {
            tracing::error!(
                "journal: the approval of '{}' could not be written beside its intent: {error}",
                summary.command
            );
        }
    }

    /// The input keys a required call's intent keeps.
    fn kept_input(&self, command: &str, input: &Value) -> Option<Map<String, Value>> {
        let keep = self.kept.get(command)?;
        Some(crate::host::kept_input(input, keep)).filter(|kept| !kept.is_empty())
    }
}

/// The required-mode middleware, innermost: after every gate and the approval step, so a call that
/// any of them refuses writes no intent, and right before the handler.
pub(crate) fn middleware(policies: Arc<Policies>) -> CommandMiddleware {
    Arc::new(
        move |name: String,
              input: Arc<Value>,
              context: CommandContext,
              next: MiddlewareNext|
              -> BoxFuture<'static, CommandResult<Value>> {
            if !policies.is_required(&name) {
                return next(context);
            }
            let policies = Arc::clone(&policies);
            Box::pin(async move {
                let Some(dispatch_id) = context.dispatch_id().map(str::to_owned) else {
                    return failure(
                        CommandError::new(
                            DISPATCH_ID_MISSING,
                            format!("'{name}' was not run: the call has no dispatch id to journal it under"),
                        )
                        .with_suggestion("Run the command through the host's registry (a surface, `registry.execute` or `Host::context`), which gives every call a dispatch id.")
                        .with_retryable(false),
                    );
                };
                let seq = policies.next_seq.fetch_add(1, Ordering::SeqCst);
                let actor = context
                    .actor
                    .as_ref()
                    .and_then(|actor| serde_json::to_value(actor).ok());
                let mut intent = json!({
                    "v": AHEAD_VERSION,
                    "kind": "intent",
                    "seq": seq,
                    "dispatchId": dispatch_id,
                    "traceId": context.trace_id,
                    "command": name,
                    "actor": actor,
                    "at": policies.now(),
                });
                if let Some(kept) = policies.kept_input(&name, &input) {
                    intent["input"] = Value::Object(kept);
                }
                if let Err(error) = policies.append_ahead(&intent).await {
                    tracing::error!(
                        "journal: the intent of '{name}' could not be written: {error}"
                    );
                    return failure(policies.unavailable(&name));
                }
                let result = next(context).await;
                let outcome = json!({
                    "v": AHEAD_VERSION,
                    "kind": "outcome",
                    "seq": seq,
                    "dispatchId": dispatch_id,
                    "at": policies.now(),
                    "success": result.success,
                    "code": result.error.as_ref().map(|error| error.code.clone()),
                });
                if let Err(error) = policies.append_ahead(&outcome).await {
                    // The call's result stands; the intent stays unsettled and is reported on open.
                    tracing::error!(
                        "journal: the outcome of '{name}' could not be written; its intent stays unsettled: {error}"
                    );
                }
                result
            })
        },
    )
}

/// What the sink holds: the journal under it, the buffer and the live counts.
pub(crate) struct SinkCore {
    inner: Arc<dyn JournalSink>,
    policies: Arc<Policies>,
    queue: tokio::sync::Mutex<VecDeque<JournalRecord>>,
}

impl SinkCore {
    /// Whether `record` waits in the buffer when the journal cannot take it: the successful
    /// entry of a buffered or required command. Everything else is dropped and counted.
    fn holds(&self, record: &JournalRecord) -> bool {
        record.result.success
            && matches!(
                self.policies.policies.get(&record.command),
                Some(JournalPolicy::Buffered | JournalPolicy::Required)
            )
    }

    async fn write(&self, record: JournalRecord) -> Result<JournalEntry, String> {
        let live = &self.policies.live;
        if let Err(error) = self.policies.storage.check_journal() {
            live.journal_ok.store(false, Ordering::SeqCst);
            return Err(format!("the journal cannot be written: {error}"));
        }
        let outcome = self.inner.append(record).await;
        live.journal_ok.store(outcome.is_ok(), Ordering::SeqCst);
        outcome
    }

    /// Write the buffered entries in order, stopping at the first the journal refuses.
    async fn drain(&self, queue: &mut VecDeque<JournalRecord>) {
        while let Some(front) = queue.front() {
            if self.write(front.clone()).await.is_err() {
                break;
            }
            queue.pop_front();
        }
        self.policies
            .live
            .pending
            .store(queue.len(), Ordering::SeqCst);
    }

    async fn refresh_ahead(&self) {
        let storage = Arc::clone(&self.policies.storage);
        let ok = tokio::task::spawn_blocking(move || storage.check_ahead().is_ok())
            .await
            .unwrap_or(false);
        self.policies.live.ahead_ok.store(ok, Ordering::SeqCst);
        // The journal is known writable only by a write; a storage that says it is not is believed.
        if self.policies.storage.check_journal().is_err() {
            self.policies.live.journal_ok.store(false, Ordering::SeqCst);
        }
    }
}

/// The journal sink with the policies: Umbel's projecting sink under it.
pub(crate) struct PolicySink(Arc<SinkCore>);

impl PolicySink {
    pub(crate) fn new(inner: Arc<dyn JournalSink>, policies: &Arc<Policies>) -> Self {
        let core = Arc::new(SinkCore {
            inner,
            policies: Arc::clone(policies),
            queue: tokio::sync::Mutex::new(VecDeque::new()),
        });
        let _ = policies.live.core.set(Arc::downgrade(&core));
        Self(core)
    }
}

#[async_trait]
impl JournalSink for PolicySink {
    /// Runs on a task of its own: a dropped call (a timeout) must not stop it between writing
    /// a held entry and taking it off the queue, or the entry would be written twice.
    async fn append(&self, record: JournalRecord) -> Result<JournalEntry, String> {
        let core = Arc::clone(&self.0);
        tokio::spawn(async move { core.append(record).await })
            .await
            .unwrap_or_else(|error| Err(format!("the journal append did not finish: {error}")))
    }

    async fn read(&self, range: JournalRange) -> Result<Vec<JournalEntry>, String> {
        self.0.inner.read(range).await
    }
}

impl SinkCore {
    async fn append(&self, record: JournalRecord) -> Result<JournalEntry, String> {
        let core = self;
        let live = &core.policies.live;
        let holds = core.holds(&record);
        let mut queue = core.queue.lock().await;
        core.drain(&mut queue).await;
        let error = if queue.is_empty() {
            match core.write(record.clone()).await {
                Ok(entry) => return Ok(entry),
                Err(error) => error,
            }
        } else {
            // Entries already wait: this one must not be written ahead of them.
            format!("{} earlier entries still wait for the journal", queue.len())
        };
        if holds && queue.len() < core.policies.buffer {
            queue.push_back(record);
            live.pending.store(queue.len(), Ordering::SeqCst);
            Err(format!(
                "held for the journal ({} waiting): {error}",
                queue.len()
            ))
        } else {
            live.dropped.fetch_add(1, Ordering::SeqCst);
            Err(format!("dropped: {error}"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use afd::{CommandDefinition, CommandRegistry, success};

    #[derive(Default)]
    struct Memory(Mutex<Vec<u8>>);

    impl JournalStorage for Arc<Memory> {
        fn append_ahead(&self, line: &[u8]) -> io::Result<()> {
            self.0
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .extend_from_slice(line);
            Ok(())
        }
        fn read_ahead(&self) -> io::Result<Vec<u8>> {
            Ok(self
                .0
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .clone())
        }
        fn check_ahead(&self) -> io::Result<()> {
            Ok(())
        }
    }

    fn records(memory: &Memory) -> Vec<Value> {
        let bytes = memory
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone();
        String::from_utf8_lossy(&bytes)
            .lines()
            .filter_map(|line| serde_json::from_str(line).ok())
            .collect()
    }

    fn opened(memory: &Arc<Memory>) -> Arc<Policies> {
        JournalPolicies::new()
            .with("job-start", JournalPolicy::Required)
            .with_storage(Arc::clone(memory))
            .open(PathBuf::new(), None, BTreeMap::new())
            .unwrap_or_else(|problem| panic!("{problem}"))
    }

    struct Counter(Arc<AtomicUsize>);

    #[async_trait]
    impl afd::CommandHandler for Counter {
        async fn execute(&self, _input: Value, _context: CommandContext) -> CommandResult<Value> {
            self.0.fetch_add(1, Ordering::SeqCst);
            success(json!({}))
        }
    }

    fn counting(runs: &Arc<AtomicUsize>) -> MiddlewareNext {
        let runs = Arc::clone(runs);
        Arc::new(move |_| {
            runs.fetch_add(1, Ordering::SeqCst);
            Box::pin(async { success(json!({})) })
        })
    }

    #[tokio::test]
    async fn a_required_call_with_no_dispatch_id_is_refused_before_the_handler() {
        let memory = Arc::new(Memory::default());
        let layer = middleware(opened(&memory));
        let runs = Arc::new(AtomicUsize::new(0));
        // Called outside a registry: the context has no dispatch id.
        let result = layer(
            "job-start".to_owned(),
            Arc::new(json!({})),
            CommandContext::new(),
            counting(&runs),
        )
        .await;
        let error = result.error.unwrap_or_else(|| panic!("refused"));
        assert_eq!(error.code, DISPATCH_ID_MISSING);
        assert_eq!(error.retryable, Some(false));
        assert_eq!(runs.load(Ordering::SeqCst), 0);
        assert!(records(&memory).is_empty());
        // A command with no policy passes untouched, dispatch id or not.
        let passed = layer(
            "job-look".to_owned(),
            Arc::new(json!({})),
            CommandContext::new(),
            counting(&runs),
        )
        .await;
        assert!(passed.success);
        assert_eq!(runs.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn a_retry_outside_the_policy_is_a_new_attempt_under_the_same_id() {
        let memory = Arc::new(Memory::default());
        let registry = CommandRegistry::new();
        // A retrying middleware outside the policy's: it runs the inner links twice.
        registry.add_middleware(Arc::new(
            |_name: String, _input: Arc<Value>, context: CommandContext, next: MiddlewareNext| {
                Box::pin(async move {
                    let _ = next(context.clone()).await;
                    next(context).await
                }) as BoxFuture<'static, CommandResult<Value>>
            },
        ));
        registry.add_middleware(middleware(opened(&memory)));
        let runs = Arc::new(AtomicUsize::new(0));
        let counter = Arc::clone(&runs);
        registry
            .register(CommandDefinition::new(
                "job-start",
                "Start a job",
                vec![],
                Counter(counter),
            ))
            .unwrap_or_else(|problem| panic!("{problem}"));
        let result = registry.execute("job-start", json!({}), None).await;
        assert!(result.success, "{result:?}");
        assert_eq!(runs.load(Ordering::SeqCst), 2);
        let written = records(&memory);
        let kinds: Vec<&str> = written.iter().filter_map(|r| r["kind"].as_str()).collect();
        assert_eq!(kinds, vec!["intent", "outcome", "intent", "outcome"]);
        assert_eq!(written[0]["dispatchId"], written[2]["dispatchId"]);
        assert_ne!(written[0]["seq"], written[2]["seq"]);
        // Read back, the two are attempts 1 and 2, both settled.
        let report = read_report(&memory.read_ahead().unwrap_or_default());
        assert!(report.unsettled.is_empty());
        assert_eq!(report.next_seq, 3);
    }

    #[test]
    fn an_append_after_a_torn_line_starts_a_line_of_its_own() {
        let dir = std::env::temp_dir().join(format!(
            "umbel-ahead-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        std::fs::create_dir_all(&dir).unwrap_or_else(|error| panic!("{error}"));
        let path = dir.join("journal.ahead.jsonl");
        let storage = FileStorage::new(path.clone());
        assert!(storage.check_ahead().is_ok());
        assert!(!path.exists(), "the check makes no file");
        // A crash tore the last record.
        std::fs::write(&path, br#"{"v":1,"kind":"intent","seq":1,"dispa"#)
            .unwrap_or_else(|error| panic!("{error}"));
        let line = b"{\"v\":1,\"kind\":\"intent\",\"seq\":2,\"dispatchId\":\"b\",\"command\":\"x\",\"at\":\"t\"}\n";
        storage
            .append_ahead(line)
            .unwrap_or_else(|error| panic!("{error}"));
        let report = read_report(&storage.read_ahead().unwrap_or_default());
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(report.unreadable, 1);
        assert_eq!(report.unsettled.len(), 1, "the new intent is read");
        assert_eq!(report.unsettled[0].dispatch_id, "b");
    }

    #[test]
    fn a_second_open_of_one_set_of_policies_is_refused() {
        let memory = Arc::new(Memory::default());
        let policies = JournalPolicies::new()
            .with("job-start", JournalPolicy::Required)
            .with_storage(Arc::clone(&memory));
        let health = policies.health();
        assert!(policies.open(PathBuf::new(), None, BTreeMap::new()).is_ok());
        let again = JournalPolicies {
            health,
            ..JournalPolicies::new()
        };
        assert!(again.open(PathBuf::new(), None, BTreeMap::new()).is_err());
    }

    #[test]
    fn the_report_pairs_outcomes_with_attempts_and_skips_a_torn_line() {
        let file = concat!(
            r#"{"v":1,"kind":"intent","seq":1,"dispatchId":"a","command":"x","at":"t"}"#,
            "\n",
            r#"{"v":1,"kind":"outcome","seq":1,"dispatchId":"a","success":true}"#,
            "\n",
            r#"{"v":1,"kind":"intent","seq":2,"dispatchId":"a","command":"x","at":"t"}"#,
            "\n",
            r#"{"v":1,"kind":"approval","dispatchId":"a","approval":{"via":"token"}}"#,
            "\n",
            r#"{"v":1,"kind":"intent","seq":3,"dispatchId":"b","command":"y","at":"t","input":{"k":1}}"#,
            "\n",
            r#"{"v":1,"kind":"outcome","seq":3,"dispatchId":"b","success":false,"code":"E"}"#,
            "\n",
            r#"{"v":1,"kind":"intent","seq":9,"dispa"#,
        );
        let report = read_report(file.as_bytes());
        assert_eq!(report.unreadable, 1);
        assert_eq!(report.next_seq, 4);
        assert_eq!(report.unsettled.len(), 1);
        let left = &report.unsettled[0];
        assert_eq!(
            (left.dispatch_id.as_str(), left.attempt, left.seq),
            ("a", 2, 2)
        );
        assert_eq!(left.approval, Some(json!({"via": "token"})));
    }
}

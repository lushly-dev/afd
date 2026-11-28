//! Recording: a [`JournalRecorder`] appends a [`JournalEntry`](super::JournalEntry) for each
//! accepted command call.

use futures_util::FutureExt;
use serde_json::Value;
use std::fmt;
use std::panic::AssertUnwindSafe;
use std::sync::{Arc, Mutex, PoisonError};

use super::secret_scope::{self, Scope};
use super::{
    create_context_digest_with_fields, journal_context_fields, JournalContextDigest,
    JournalContextFields, JournalRecord, JournalSink, JournalTape,
};
use crate::actor::Actor;
use crate::clock::{Clock, RandomSource, SYSTEM_CLOCK, SYSTEM_RANDOM};
use crate::commands::CommandContext;
use crate::context_fields::ContextField;
use crate::result::CommandResult;

const DEFAULT_MAX_TAPE_READS: usize = 1000;

type Filter = Arc<dyn Fn(&str) -> bool + Send + Sync>;
type Redact = Arc<dyn Fn(JournalRecord, &JournalRedactInfo) -> Option<JournalRecord> + Send + Sync>;
type OnError = Arc<dyn Fn(&str) + Send + Sync>;

/// Journal state a context carries between a recorder, replay and nested calls. Crate-private.
#[derive(Debug, Clone, Default)]
pub(crate) struct JournalContextState {
    /// Set by [`replay_journal`](super::replay_journal): no recorder records this call or the
    /// calls nested in it.
    pub(crate) replaying: bool,
    /// The clock under any recording wrappers, so a nested recorder's own timing lands on no
    /// tape.
    pub(crate) untaped_clock: Option<Arc<dyn Clock>>,
}

/// What a recording source carries: the source under every recording wrapper, and every tape a
/// read of it reaches (its own and each recording parent's), outermost first. It travels with
/// the source, so a call given a fresh context that holds a recording source still finds it.
pub(crate) struct Taping<T: ?Sized> {
    untaped: Arc<T>,
    tapes: Vec<Arc<TapeWriter>>,
}

impl<T: ?Sized> Taping<T> {
    /// The taping of a recording source over `inner` that writes to `tape`.
    fn over(inner: &Arc<T>, inner_taping: Option<&Taping<T>>, tape: &Arc<TapeWriter>) -> Self {
        let (untaped, mut tapes) = match inner_taping {
            Some(taping) => (Arc::clone(&taping.untaped), taping.tapes.clone()),
            None => (Arc::clone(inner), Vec::new()),
        };
        tapes.push(Arc::clone(tape));
        Self { untaped, tapes }
    }

    /// Mark every tape a read would reach `truncated` and return the source under them.
    fn leave(&self) -> Arc<T> {
        for tape in &self.tapes {
            tape.truncate();
        }
        Arc::clone(&self.untaped)
    }
}

/// Move a call to a command declaring `secret` off every recording parent's tape
/// (`spec/journal.md`): the call would read the clock and random source a recording parent
/// wrapped, which would put the values that built the secret on the parent's tape. It reads
/// the sources under the wrappers instead, and each tape they reached is marked `truncated`, so
/// its replay says it cannot restore every value. The recording sources carry their tapes, so
/// this holds whatever context the call was given. The call's own recording, if any, starts
/// after this, so its reads stay on its own entry.
pub(crate) fn off_tape(context: &mut CommandContext) {
    let clock = context
        .clock
        .as_ref()
        .and_then(|clock| clock.journal_taping())
        .map(Taping::leave);
    if let Some(clock) = clock {
        context.clock = Some(clock);
    }
    let random = context
        .random
        .as_ref()
        .and_then(|random| random.journal_taping())
        .map(Taping::leave);
    if let Some(random) = random {
        context.random = Some(random);
    }
}

/// What a redactor set with [`JournalRecorder::with_redact_info`] is told about the call
/// besides its record.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub struct JournalRedactInfo {
    /// Whether the command declares `secret` ([`CommandDefinition::secret`](crate::CommandDefinition::secret)),
    /// read from the command the registry runs, never from its name. When `true`, remove the
    /// secret from the record, or return `None`. The recorder always runs inside the registry,
    /// so the answer is always known.
    pub secret: bool,
}

/// Records each accepted command call of a registry to a [`JournalSink`].
///
/// Set it with [`CommandRegistry::set_journal`](crate::CommandRegistry::set_journal). The
/// registry runs it after lookup, exposure and input validation, so a call rejected there is
/// never recorded, and around the whole middleware chain: the recorder swaps the clock and
/// random source before the chain starts, and every step of the chain keeps them whatever
/// context a middleware passes to `next`. The tape therefore holds what the middleware and the
/// handler read.
///
/// Each entry holds the command, its validated input, the actor, the trace ID, a context
/// digest (a hash plus the interface), the values of the registry's declared context fields
/// marked `journal: true` (each up to
/// [`MAX_JOURNAL_CONTEXT_BYTES`](super::MAX_JOURNAL_CONTEXT_BYTES) of canonical JSON; a larger
/// one is only named), the call's effective output budget, the result, the duration and the tape.
/// No other context value is kept.
/// Appends are awaited, so entries are in call order for sequential calls. A sink error goes
/// to [`with_on_error`](Self::with_on_error) and never changes the command result.
/// Commands named `auth-*` are not recorded unless [`with_filter`](Self::with_filter) allows
/// them, and a command that declares `secret`
/// ([`CommandDefinition::as_secret`](crate::CommandDefinition::as_secret)) is never recorded
/// without a redactor ([`with_redact`](Self::with_redact) or
/// [`with_redact_info`](Self::with_redact_info)), whatever the filter says. Such a call puts
/// nothing on a recording parent's tape: given the parent's recording sources themselves, it
/// runs on the sources under them and the tape is marked `truncated`; given them inside a host's
/// own wrapper, the tape refuses its readings and is marked only once the call reads through
/// it. During
/// [`replay_journal`](super::replay_journal) nothing is recorded.
///
/// ```rust
/// use afd::{CommandRegistry, JournalRecorder, MemoryJournalSink};
/// use std::sync::Arc;
///
/// let journal = Arc::new(MemoryJournalSink::new());
/// let registry = CommandRegistry::new();
/// registry.set_journal(JournalRecorder::new(journal.clone()).with_record_failures(true));
/// ```
#[derive(Clone)]
pub struct JournalRecorder {
    sink: Arc<dyn JournalSink>,
    record_failures: bool,
    filter: Option<Filter>,
    redact: Option<Redact>,
    max_tape_reads: usize,
    on_error: Option<OnError>,
}

impl fmt::Debug for JournalRecorder {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("JournalRecorder")
            .field("record_failures", &self.record_failures)
            .field("max_tape_reads", &self.max_tape_reads)
            .finish_non_exhaustive()
    }
}

impl JournalRecorder {
    /// A recorder that appends successful calls to `sink`.
    pub fn new(sink: Arc<dyn JournalSink>) -> Self {
        Self {
            sink,
            record_failures: false,
            filter: None,
            redact: None,
            max_tape_reads: DEFAULT_MAX_TAPE_READS,
            on_error: None,
        }
    }

    /// Also record calls that fail after validation: a failure result from the handler or a
    /// middleware, and a panic (recorded as the redacted `COMMAND_EXECUTION_ERROR` the
    /// registry returns). Default `false`: only successful calls are recorded. A call that
    /// times out is never recorded.
    pub fn with_record_failures(mut self, record_failures: bool) -> Self {
        self.record_failures = record_failures;
        self
    }

    /// Record only the commands `filter` returns `true` for. It replaces the default, which
    /// skips commands named `auth-*`, so exclude them in it too unless you redact them. A
    /// command that declares `secret` is never recorded without a redactor, whatever this
    /// returns.
    pub fn with_filter(mut self, filter: impl Fn(&str) -> bool + Send + Sync + 'static) -> Self {
        self.filter = Some(Arc::new(filter));
        self
    }

    /// Last look at each record before it is stored: return it (changed or not), or `None` to
    /// skip it. Use it to drop secrets from inputs or results. Giving it also lets calls to
    /// commands that declare `secret` be recorded (when the filter allows them), so it must
    /// remove their secrets: [`with_redact_info`](Self::with_redact_info) says which calls those
    /// are. When a secret is derived from `context.random`, drop `record.tape` too: the
    /// recorded values would rebuild it. It replaces a redactor set before.
    pub fn with_redact(
        self,
        redact: impl Fn(JournalRecord) -> Option<JournalRecord> + Send + Sync + 'static,
    ) -> Self {
        self.with_redact_info(move |record, _| redact(record))
    }

    /// [`with_redact`](Self::with_redact), told with each record whether the command declares
    /// `secret` ([`JournalRedactInfo::secret`]). It replaces a redactor set before.
    pub fn with_redact_info(
        mut self,
        redact: impl Fn(JournalRecord, &JournalRedactInfo) -> Option<JournalRecord>
            + Send
            + Sync
            + 'static,
    ) -> Self {
        self.redact = Some(Arc::new(redact));
        self
    }

    /// Most clock readings and most random values kept per call, each. Past it the tape is
    /// marked `truncated`. Default 1000.
    pub fn with_max_tape_reads(mut self, max_tape_reads: usize) -> Self {
        self.max_tape_reads = max_tape_reads;
        self
    }

    /// Called with a message when building or appending an entry fails (or panics).
    pub fn with_on_error(mut self, on_error: impl Fn(&str) + Send + Sync + 'static) -> Self {
        self.on_error = Some(Arc::new(on_error));
        self
    }

    /// Whether the filter admits calls to `command`. A filter that panics records nothing. A
    /// command that declares `secret` is recorded only when the recorder also has a redactor,
    /// whatever this returns.
    pub fn records(&self, command: &str) -> bool {
        match &self.filter {
            Some(filter) => std::panic::catch_unwind(AssertUnwindSafe(|| filter(command)))
                .unwrap_or_else(|_| {
                    self.report("The journal filter panicked");
                    false
                }),
            None => !command.starts_with("auth-"),
        }
    }

    /// Whether a call to `command`, which declares `secret` or not, is recorded: a secret one
    /// only with a redactor, then like any other by the filter.
    pub(crate) fn records_call(&self, command: &str, secret: bool) -> bool {
        (!secret || self.redact.is_some()) && self.records(command)
    }

    /// Start recording a call: put recording sources on `context` and note what the entry
    /// needs from it, including the values of the `fields` declared `journal: true`. `scope` is
    /// the secret scope the call runs in ([`super::secret_scope`]).
    pub(crate) fn start(
        &self,
        command: &str,
        secret: bool,
        scope: Option<Scope>,
        input: &Value,
        context: &mut CommandContext,
        fields: &[ContextField],
    ) -> Recording {
        let clock: Arc<dyn Clock> = context
            .clock
            .clone()
            .unwrap_or_else(|| Arc::new(SYSTEM_CLOCK));
        let random: Arc<dyn RandomSource> = context
            .random
            .clone()
            .unwrap_or_else(|| Arc::new(SYSTEM_RANDOM));
        // This recorder's own timing reads the clock under any outer recorder's wrapper (a
        // replay's own clock first).
        let timing = context
            .journal_state
            .untaped_clock
            .clone()
            .or_else(|| {
                clock
                    .journal_taping()
                    .map(|taping| Arc::clone(&taping.untaped))
            })
            .unwrap_or_else(|| Arc::clone(&clock));
        let journaled = journal_context_fields(
            context,
            fields
                .iter()
                .filter(|field| field.journal)
                .map(|field| field.name.as_str()),
        );
        let digest = create_context_digest_with_fields(context, &journaled);
        let start = timing.now();

        let tape = Arc::new(TapeWriter::new(self.max_tape_reads, scope));
        context.clock = Some(Arc::new(RecordingClock {
            taping: Taping::over(&clock, clock.journal_taping(), &tape),
            inner: clock,
            tape: Arc::clone(&tape),
        }));
        context.random = Some(Arc::new(RecordingRandom {
            taping: Taping::over(&random, random.journal_taping(), &tape),
            inner: random,
            tape: Arc::clone(&tape),
        }));
        context.journal_state.untaped_clock = Some(Arc::clone(&timing));

        Recording {
            command: command.to_string(),
            secret,
            input: input.clone(),
            trace_id: context.trace_id.clone(),
            idempotency_key: context.idempotency_key.clone(),
            actor: context.actor.clone(),
            digest,
            journaled,
            output_budget: context.output_budget,
            start,
            timing,
            tape,
        }
    }

    /// Finish recording a call that returned `result`, appending its entry when it qualifies.
    /// Returns `result` unchanged.
    pub(crate) async fn finish(
        &self,
        recording: Recording,
        result: CommandResult<Value>,
    ) -> CommandResult<Value> {
        let duration_ms = recording
            .timing
            .now()
            .saturating_sub(recording.start)
            .max(0) as f64;
        if result.success || self.record_failures {
            let append = AssertUnwindSafe(self.append(recording, &result, duration_ms));
            if append.catch_unwind().await.is_err() {
                self.report("Recording a journal entry panicked");
            }
        }
        result
    }

    async fn append(&self, recording: Recording, result: &CommandResult<Value>, duration_ms: f64) {
        let Some(timestamp) = iso_timestamp(recording.start) else {
            self.report(&format!(
                "Clock reading {} is not a representable date",
                recording.start
            ));
            return;
        };
        let tape = recording.tape.take();
        let record = JournalRecord {
            timestamp,
            trace_id: recording.trace_id,
            idempotency_key: recording.idempotency_key,
            command: recording.command,
            input: recording.input,
            actor: recording.actor,
            context_digest: recording.digest,
            context: recording.journaled.context,
            context_omitted: recording.journaled.context_omitted,
            output_budget: recording.output_budget,
            result: result.clone(),
            duration_ms,
            tape: (!tape.is_empty()).then_some(tape),
        };
        let info = JournalRedactInfo {
            secret: recording.secret,
        };
        let record = match &self.redact {
            Some(redact) => redact(record, &info),
            None => Some(record),
        };
        if let Some(record) = record {
            if let Err(error) = self.sink.append(record).await {
                self.report(&error);
            }
        }
    }

    fn report(&self, message: &str) {
        if let Some(on_error) = &self.on_error {
            // A panicking `on_error` has nowhere left to report.
            let _ = std::panic::catch_unwind(AssertUnwindSafe(|| on_error(message)));
        }
    }
}

/// `ms` as an ISO 8601 string, like TypeScript's `Date.prototype.toISOString`.
pub(crate) fn iso_timestamp(ms: i64) -> Option<String> {
    chrono::DateTime::from_timestamp_millis(ms)
        .map(|at| at.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
}

/// A call being recorded, from [`JournalRecorder::start`].
pub(crate) struct Recording {
    command: String,
    secret: bool,
    input: Value,
    trace_id: Option<String>,
    idempotency_key: Option<String>,
    actor: Option<Actor>,
    digest: JournalContextDigest,
    journaled: JournalContextFields,
    output_budget: Option<u64>,
    start: i64,
    timing: Arc<dyn Clock>,
    tape: Arc<TapeWriter>,
}

/// The tape a call's recording sources write to.
struct TapeWriter {
    tape: Mutex<JournalTape>,
    max_reads: usize,
    /// The secret scope the call started in: a reading taken in a secret call nested below it
    /// is dropped and the tape marked `truncated` ([`super::secret_scope`]).
    scope: Option<Scope>,
}

impl TapeWriter {
    fn new(max_reads: usize, scope: Option<Scope>) -> Self {
        Self {
            tape: Mutex::new(JournalTape::default()),
            max_reads,
            scope,
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, JournalTape> {
        self.tape.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn clock(&self, reading: f64) {
        let mut tape = self.lock();
        if !secret_scope::reaches(self.scope.as_ref()) {
            tape.truncated = true;
        } else if tape.clock.len() < self.max_reads {
            tape.clock.push(reading);
        } else {
            tape.truncated = true;
        }
    }

    fn random(&self, value: f64) {
        let mut tape = self.lock();
        if !secret_scope::reaches(self.scope.as_ref()) {
            tape.truncated = true;
        } else if tape.random.len() < self.max_reads {
            tape.random.push(value);
        } else {
            tape.truncated = true;
        }
    }

    fn truncate(&self) {
        self.lock().truncated = true;
    }

    fn take(&self) -> JournalTape {
        std::mem::take(&mut *self.lock())
    }
}

/// A clock that passes readings through and writes them to the tape.
struct RecordingClock {
    inner: Arc<dyn Clock>,
    tape: Arc<TapeWriter>,
    taping: Taping<dyn Clock>,
}

impl Clock for RecordingClock {
    fn now(&self) -> i64 {
        let reading = self.inner.now();
        self.tape.clock(reading as f64);
        reading
    }

    #[allow(private_interfaces)]
    fn journal_taping(&self) -> Option<&Taping<dyn Clock>> {
        Some(&self.taping)
    }
}

/// A random source that passes values through and writes them to the tape.
struct RecordingRandom {
    inner: Arc<dyn RandomSource>,
    tape: Arc<TapeWriter>,
    taping: Taping<dyn RandomSource>,
}

impl RandomSource for RecordingRandom {
    fn next(&self) -> f64 {
        let value = self.inner.next();
        self.tape.random(value);
        value
    }

    fn seed(&self) -> Option<&str> {
        self.inner.seed()
    }

    #[allow(private_interfaces)]
    fn journal_taping(&self) -> Option<&Taping<dyn RandomSource>> {
        Some(&self.taping)
    }
}

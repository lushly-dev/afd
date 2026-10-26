//! Replay a command journal against a registry and diff the results.
//!
//! Replay restores the clock and random values each call read (its tape) and reports, per
//! entry, whether the result is the same. It does not make handlers deterministic: any other
//! nondeterminism (I/O, global state, the system time read directly) shows up as divergence.

use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeSet;
use std::fmt;
use std::panic::AssertUnwindSafe;
use std::sync::{Arc, Mutex, PoisonError};

use super::JournalEntry;
use crate::clock::{fixed_clock, seeded_random, Clock, ClockInstant, RandomSource, SeededRandom};
use crate::commands::{CommandContext, CommandInterface, CommandRegistry};
use crate::result::CommandResult;

const DEFAULT_IGNORE: &str = "metadata.executionTimeMs";
const DEFAULT_SEED: &str = "afd-replay";
const DEFAULT_MAX_DIFFERENCES: usize = 100;

type ContextFn = Arc<dyn Fn(&JournalEntry, CommandContext) -> CommandContext + Send + Sync>;

/// Options for [`replay_journal`].
#[derive(Clone)]
pub struct ReplayJournalOptions {
    /// Adjusts each call's context, e.g. to add a fresh database handle. It receives the entry
    /// and the restored context (trace ID, actor, interface, clock and random source) and
    /// returns the context to execute with; what it sets wins.
    pub context: Option<ContextFn>,
    /// Exact result paths left out of the comparison, with everything under them, such as
    /// `metadata`, `metadata.executionTimeMs` or `data.items[0].updatedAt` (no wildcards).
    /// Default: `["metadata.executionTimeMs"]`.
    pub ignore: Vec<String>,
    /// Seed for random numbers an entry has no recorded values for (no tape, or more reads
    /// than the tape holds). `:` and the entry's `seq` are appended, so each entry gets its
    /// own sequence. Default `afd-replay`.
    pub seed: String,
    /// Stop after the first entry that is not `same`. Default `false`.
    pub stop_on_divergence: bool,
    /// Most differences listed per entry. Default 100.
    pub max_differences: usize,
}

impl Default for ReplayJournalOptions {
    fn default() -> Self {
        Self {
            context: None,
            ignore: vec![DEFAULT_IGNORE.to_string()],
            seed: DEFAULT_SEED.to_string(),
            stop_on_divergence: false,
            max_differences: DEFAULT_MAX_DIFFERENCES,
        }
    }
}

impl fmt::Debug for ReplayJournalOptions {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ReplayJournalOptions")
            .field("context", &self.context.as_ref().map(|_| "<fn>"))
            .field("ignore", &self.ignore)
            .field("seed", &self.seed)
            .field("stop_on_divergence", &self.stop_on_divergence)
            .field("max_differences", &self.max_differences)
            .finish()
    }
}

impl ReplayJournalOptions {
    /// Set [`context`](Self::context).
    pub fn with_context(
        mut self,
        context: impl Fn(&JournalEntry, CommandContext) -> CommandContext + Send + Sync + 'static,
    ) -> Self {
        self.context = Some(Arc::new(context));
        self
    }

    /// Set [`ignore`](Self::ignore).
    pub fn with_ignore(mut self, ignore: impl IntoIterator<Item = impl Into<String>>) -> Self {
        self.ignore = ignore.into_iter().map(Into::into).collect();
        self
    }

    /// Set [`seed`](Self::seed).
    pub fn with_seed(mut self, seed: impl Into<String>) -> Self {
        self.seed = seed.into();
        self
    }

    /// Set [`stop_on_divergence`](Self::stop_on_divergence).
    pub fn with_stop_on_divergence(mut self, stop_on_divergence: bool) -> Self {
        self.stop_on_divergence = stop_on_divergence;
        self
    }

    /// Set [`max_differences`](Self::max_differences).
    pub fn with_max_differences(mut self, max_differences: usize) -> Self {
        self.max_differences = max_differences;
        self
    }
}

/// How a replayed entry compares with the recording.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ReplayStatus {
    /// The replayed result equals the recorded one.
    Same,
    /// The results differ; see [`ReplayEntryReport::differences`].
    Different,
    /// The entry could not be replayed; see [`ReplayEntryReport::error`].
    Error,
}

/// What kind of difference a [`ReplayDifference`] is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ReplayDifferenceKind {
    /// Both have a value, and they differ.
    Changed,
    /// Only the replay has a value.
    Added,
    /// Only the recording has a value.
    Removed,
}

/// One difference between the recorded and the replayed result.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ReplayDifference {
    /// Where, e.g. `data.title` or `data.items[2]`. Empty for the whole result.
    pub path: String,
    /// What kind of difference.
    pub kind: ReplayDifferenceKind,
    /// The recorded value. `None` for `added`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recorded: Option<Value>,
    /// The replayed value. `None` for `removed`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replayed: Option<Value>,
}

/// The outcome of replaying one entry.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ReplayEntryReport {
    pub seq: u64,
    pub command: String,
    pub status: ReplayStatus,
    /// The result in the journal.
    pub recorded: CommandResult<Value>,
    /// The result of the replay. `None` when `status` is `error`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replayed: Option<CommandResult<Value>>,
    /// The differences, when `status` is `different`.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub differences: Vec<ReplayDifference>,
    /// Why the entry could not be replayed, when `status` is `error`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// What replay could not restore, e.g. a tape that ran out. Hints for a divergence.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub notes: Vec<String>,
}

/// The outcome of [`replay_journal`].
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct ReplayReport {
    /// One report per replayed entry, in `seq` order.
    pub entries: Vec<ReplayEntryReport>,
    pub same: usize,
    pub different: usize,
    pub errors: usize,
    /// Whether any entry was not `same`.
    pub diverged: bool,
    /// Entries not replayed because `stop_on_divergence` stopped the run.
    pub skipped: usize,
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAPE SOURCES
// ═══════════════════════════════════════════════════════════════════════════════

/// How a replay source was read.
#[derive(Debug, Default)]
struct TapeState {
    /// Tape values read.
    used: usize,
    /// Whether more values were read than the tape holds.
    overran: bool,
}

/// Replays the recorded clock readings, then holds the last one.
struct TapeClock {
    readings: Vec<f64>,
    state: Mutex<(TapeState, i64)>,
}

impl TapeClock {
    fn new(readings: Vec<f64>, start: i64) -> Self {
        Self {
            readings,
            state: Mutex::new((TapeState::default(), start)),
        }
    }

    fn state(&self) -> (usize, bool) {
        let state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        (state.0.used, state.0.overran)
    }
}

impl Clock for TapeClock {
    fn now(&self) -> i64 {
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        let (tape, last) = &mut *state;
        match self.readings.get(tape.used) {
            Some(reading) => {
                tape.used += 1;
                // Whole milliseconds, as `Clock::now` reads them.
                *last = *reading as i64;
            }
            None => tape.overran = true,
        }
        *last
    }
}

/// Replays the recorded random values, then continues with a seeded source.
struct TapeRandom {
    values: Vec<f64>,
    fallback: SeededRandom,
    state: Mutex<TapeState>,
}

impl TapeRandom {
    fn new(values: Vec<f64>, seed: String) -> Self {
        Self {
            values,
            fallback: seeded_random(seed),
            state: Mutex::new(TapeState::default()),
        }
    }

    fn state(&self) -> (usize, bool) {
        let state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        (state.used, state.overran)
    }
}

impl RandomSource for TapeRandom {
    fn next(&self) -> f64 {
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        match self.values.get(state.used) {
            Some(value) => {
                state.used += 1;
                *value
            }
            None => {
                state.overran = true;
                drop(state);
                self.fallback.next()
            }
        }
    }

    fn seed(&self) -> Option<&str> {
        self.fallback.seed()
    }
}

/// What replay could not restore for `entry`, from how its tape was read.
fn tape_notes(entry: &JournalEntry, clock: Option<&TapeClock>, random: &TapeRandom) -> Vec<String> {
    let Some(tape) = &entry.tape else {
        return Vec::new();
    };
    let mut notes = Vec::new();
    if tape.truncated {
        notes.push("the recorded tape was truncated; values past it are not restored".to_string());
    }
    if let Some(clock) = clock {
        let (used, overran) = clock.state();
        if overran {
            notes.push(format!(
                "clock: the tape holds {} readings and the replay read more; later readings repeat the last one",
                tape.clock.len()
            ));
        } else if used < tape.clock.len() {
            notes.push(format!(
                "clock: the replay read {used} of {} recorded readings",
                tape.clock.len()
            ));
        }
    }
    let (used, overran) = random.state();
    if overran {
        notes.push(format!(
            "random: the tape holds {} values and the replay read more; later values come from seed '{}'",
            tape.random.len(),
            random.seed().unwrap_or_default()
        ));
    } else if used < tape.random.len() {
        notes.push(format!(
            "random: the replay read {used} of {} recorded values",
            tape.random.len()
        ));
    }
    notes
}

// ═══════════════════════════════════════════════════════════════════════════════
// DIFF
// ═══════════════════════════════════════════════════════════════════════════════

fn child_path(path: &str, key: &str) -> String {
    if path.is_empty() {
        key.to_string()
    } else {
        format!("{path}.{key}")
    }
}

/// Whether two JSON values are equal as JavaScript sees them: `1` equals `1.0`.
fn same_scalar(recorded: &Value, replayed: &Value) -> bool {
    match (recorded, replayed) {
        (Value::Number(a), Value::Number(b)) => a == b || a.as_f64() == b.as_f64(),
        _ => recorded == replayed,
    }
}

/// Structural differences between two JSON values, skipping `ignore` paths.
fn diff_json(
    recorded: &Value,
    replayed: &Value,
    path: &str,
    ignore: &BTreeSet<&str>,
    out: &mut Vec<ReplayDifference>,
    max: usize,
) {
    if out.len() >= max || ignore.contains(path) {
        return;
    }
    let push = |out: &mut Vec<ReplayDifference>, difference: ReplayDifference| {
        if !ignore.contains(difference.path.as_str()) && out.len() < max {
            out.push(difference);
        }
    };
    match (recorded, replayed) {
        (Value::Array(recorded), Value::Array(replayed)) => {
            for index in 0..recorded.len().max(replayed.len()) {
                let at = format!("{path}[{index}]");
                match (recorded.get(index), replayed.get(index)) {
                    (Some(recorded), Some(replayed)) => {
                        diff_json(recorded, replayed, &at, ignore, out, max);
                    }
                    (Some(recorded), None) => push(out, removed(at, recorded)),
                    (None, Some(replayed)) => push(out, added(at, replayed)),
                    (None, None) => {}
                }
            }
        }
        (Value::Object(recorded), Value::Object(replayed)) => {
            let keys: BTreeSet<&String> = recorded.keys().chain(replayed.keys()).collect();
            for key in keys {
                let at = child_path(path, key);
                match (recorded.get(key), replayed.get(key)) {
                    (Some(recorded), Some(replayed)) => {
                        diff_json(recorded, replayed, &at, ignore, out, max);
                    }
                    (Some(recorded), None) => push(out, removed(at, recorded)),
                    (None, Some(replayed)) => push(out, added(at, replayed)),
                    (None, None) => {}
                }
            }
        }
        _ if same_scalar(recorded, replayed) => {}
        _ => out.push(ReplayDifference {
            path: path.to_string(),
            kind: ReplayDifferenceKind::Changed,
            recorded: Some(recorded.clone()),
            replayed: Some(replayed.clone()),
        }),
    }
}

fn removed(path: String, recorded: &Value) -> ReplayDifference {
    ReplayDifference {
        path,
        kind: ReplayDifferenceKind::Removed,
        recorded: Some(recorded.clone()),
        replayed: None,
    }
}

fn added(path: String, replayed: &Value) -> ReplayDifference {
    ReplayDifference {
        path,
        kind: ReplayDifferenceKind::Added,
        recorded: None,
        replayed: Some(replayed.clone()),
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// REPLAY
// ═══════════════════════════════════════════════════════════════════════════════

/// The context to replay an entry with, and its tape sources.
struct ReplayCall {
    context: CommandContext,
    /// `None` when the entry has no tape (the clock is fixed at its timestamp).
    clock: Option<Arc<TapeClock>>,
    random: Arc<TapeRandom>,
}

fn replay_call(entry: &JournalEntry, seed: &str) -> Result<ReplayCall, String> {
    let start = ClockInstant::parse(&entry.timestamp)?.as_millis();
    let tape = entry.tape.clone().unwrap_or_default();
    let random = Arc::new(TapeRandom::new(
        tape.random,
        format!("{seed}:{}", entry.seq),
    ));
    let clock = entry
        .tape
        .is_some()
        .then(|| Arc::new(TapeClock::new(tape.clock, start)));

    let mut context = CommandContext::new();
    context.trace_id.clone_from(&entry.trace_id);
    context.actor.clone_from(&entry.actor);
    if let Some(interface) = &entry.context_digest.interface {
        let interface: CommandInterface = serde_json::from_value(Value::String(interface.clone()))
            .map_err(|_| format!("Interface '{interface}' is not one this implementation knows"))?;
        context.interface = Some(interface);
    }
    context.clock = Some(match &clock {
        Some(clock) => Arc::clone(clock) as Arc<dyn Clock>,
        None => Arc::new(fixed_clock(start)),
    });
    context.random = Some(Arc::clone(&random) as Arc<dyn RandomSource>);
    context.journal_state.replaying = true;
    Ok(ReplayCall {
        context,
        clock,
        random,
    })
}

/// Re-execute journal entries in `seq` order against `registry` and compare each result with
/// the recorded one.
///
/// Each call gets the entry's trace ID, actor and interface, and a clock and random source
/// that return the values recorded on its tape. An entry without a tape gets a clock fixed at
/// its `timestamp` and a random source seeded with `<seed>:<seq>`. The registry should be fresh
/// (or reset to the state the recording started from): replay re-runs mutations. Give it the
/// same middleware as the recording registry, since the tape holds what the middleware read
/// too. A journal recorder set on it records nothing during replay.
///
/// An entry is `error` when it cannot be replayed here: a timestamp that is not RFC 3339, or
/// an interface this implementation does not have.
///
/// ```rust
/// # async fn example(registry: afd::CommandRegistry, text: &str) -> Result<(), String> {
/// use afd::{parse_journal, replay_journal, ReplayJournalOptions};
///
/// let entries = parse_journal(text)?;
/// let report = replay_journal(&registry, &entries, ReplayJournalOptions::default()).await;
/// if report.diverged {
///     println!("{} of {} entries diverged", report.different + report.errors, report.entries.len());
/// }
/// # Ok(())
/// # }
/// ```
pub async fn replay_journal(
    registry: &CommandRegistry,
    entries: &[JournalEntry],
    options: ReplayJournalOptions,
) -> ReplayReport {
    let ignore: BTreeSet<&str> = options.ignore.iter().map(String::as_str).collect();
    let mut ordered: Vec<&JournalEntry> = entries.iter().collect();
    ordered.sort_by_key(|entry| entry.seq);
    let mut report = ReplayReport::default();

    for (index, entry) in ordered.iter().enumerate() {
        let mut outcome = ReplayEntryReport {
            seq: entry.seq,
            command: entry.command.clone(),
            status: ReplayStatus::Error,
            recorded: entry.result.clone(),
            replayed: None,
            differences: Vec::new(),
            error: None,
            notes: Vec::new(),
        };
        match replay_call(entry, &options.seed) {
            Err(error) => outcome.error = Some(error),
            Ok(ReplayCall {
                context,
                clock,
                random,
            }) => {
                let context = match &options.context {
                    Some(adjust) => {
                        let adjusted =
                            std::panic::catch_unwind(AssertUnwindSafe(|| adjust(entry, context)));
                        match adjusted {
                            Ok(mut adjusted) => {
                                // The adjusted context may be a new one: keep it a replay.
                                adjusted.journal_state.replaying = true;
                                adjusted
                            }
                            Err(_) => {
                                outcome.error = Some("The replay context function panicked".into());
                                record_outcome(&mut report, outcome);
                                if options.stop_on_divergence {
                                    report.skipped = ordered.len() - index - 1;
                                    break;
                                }
                                continue;
                            }
                        }
                    }
                    None => context,
                };
                let replayed = registry
                    .execute(&entry.command, entry.input.clone(), Some(context))
                    .await;
                let recorded = serde_json::to_value(&entry.result).unwrap_or(Value::Null);
                let replayed_value = serde_json::to_value(&replayed).unwrap_or(Value::Null);
                diff_json(
                    &recorded,
                    &replayed_value,
                    "",
                    &ignore,
                    &mut outcome.differences,
                    options.max_differences,
                );
                outcome.status = if outcome.differences.is_empty() {
                    ReplayStatus::Same
                } else {
                    ReplayStatus::Different
                };
                outcome.replayed = Some(replayed);
                outcome.notes = tape_notes(entry, clock.as_deref(), &random);
            }
        }

        let diverged = outcome.status != ReplayStatus::Same;
        record_outcome(&mut report, outcome);
        if diverged && options.stop_on_divergence {
            report.skipped = ordered.len() - index - 1;
            break;
        }
    }
    report
}

/// Add `outcome` to `report` and its counts.
fn record_outcome(report: &mut ReplayReport, outcome: ReplayEntryReport) {
    match outcome.status {
        ReplayStatus::Same => report.same += 1,
        ReplayStatus::Different => report.different += 1,
        ReplayStatus::Error => report.errors += 1,
    }
    report.diverged |= outcome.status != ReplayStatus::Same;
    report.entries.push(outcome);
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn diff(recorded: Value, replayed: Value, ignore: &[&str]) -> Vec<ReplayDifference> {
        let ignore: BTreeSet<&str> = ignore.iter().copied().collect();
        let mut out = Vec::new();
        diff_json(&recorded, &replayed, "", &ignore, &mut out, 100);
        out
    }

    #[test]
    fn diff_reports_paths_and_kinds() {
        let differences = diff(
            json!({"data": {"items": [{"title": "a"}, {"title": "b"}], "count": 2}}),
            json!({"data": {"items": [{"title": "A"}], "count": 2, "extra": true}}),
            &[],
        );
        let summary: Vec<(&str, ReplayDifferenceKind)> = differences
            .iter()
            .map(|difference| (difference.path.as_str(), difference.kind))
            .collect();
        assert_eq!(
            summary,
            [
                ("data.extra", ReplayDifferenceKind::Added),
                ("data.items[0].title", ReplayDifferenceKind::Changed),
                ("data.items[1]", ReplayDifferenceKind::Removed),
            ]
        );
        assert_eq!(differences[1].recorded, Some(json!("a")));
        assert_eq!(differences[1].replayed, Some(json!("A")));
    }

    #[test]
    fn diff_skips_ignored_paths_and_compares_numbers_as_javascript_does() {
        assert!(diff(
            json!({"metadata": {"executionTimeMs": 3}, "confidence": 1}),
            json!({"metadata": {"executionTimeMs": 9}, "confidence": 1.0}),
            &["metadata.executionTimeMs"],
        )
        .is_empty());
        assert_eq!(diff(json!(1), json!(2), &[]).len(), 1);
        assert!(diff(json!(1), json!(2), &[""]).is_empty());
    }

    #[test]
    fn diff_stops_at_the_limit() {
        let ignore = BTreeSet::new();
        let mut out = Vec::new();
        diff_json(
            &json!([1, 2, 3]),
            &json!([4, 5, 6]),
            "",
            &ignore,
            &mut out,
            2,
        );
        assert_eq!(out.len(), 2);
    }

    #[test]
    fn tape_sources_replay_then_fall_back() {
        let clock = TapeClock::new(vec![10.0, 20.9], 5);
        assert_eq!([clock.now(), clock.now(), clock.now()], [10, 20, 20]);
        assert_eq!(clock.state(), (2, true));

        let random = TapeRandom::new(vec![0.25], "afd-replay:1".to_string());
        assert_eq!(random.next(), 0.25);
        let fallback = seeded_random("afd-replay:1");
        assert_eq!(random.next(), fallback.next());
        assert_eq!(random.state(), (1, true));
        assert_eq!(random.seed(), Some("afd-replay:1"));
    }
}

//! The caller's run state (phase 4 specification, sections 2.3 and 7.3): one `state` record per
//! (space, principal), `s-` and 20 hex of SHA-256 of `<space>\0<principal>`, readable by its
//! principal alone, holding the cursors a run continues from and the lock.
//!
//! - **The lock.** `curator-plan` takes it by compare-and-set with `until = now + 10 minutes`. A
//!   second run of the same caller in the space gets `CURATOR_BUSY` (retryable); a lock past its
//!   `until` is taken over. `curator-finish` releases it **only if `lock.trace` is its own run**,
//!   and only then moves the cursors; otherwise it records its report and leaves the state.
//! - **The cursors.** `feedAfter` (the record store's change revision the knowledge feed continues
//!   after), `memoryAfter` (the memory changes feed's), `scanAfter` (the rotating `memory_list`
//!   cursor) and `reviewAfter` (the rotating document cursor of re-verification). They move only
//!   when a run finishes, so a run that stopped part way is read again in full by the next.

use serde_json::{Value, json};
use umbel_sdk::{Cx, HostError, Outcome, failure};
use umbel_store::memory::{MemoryCursor, Millis, format_instant, parse_instant};
use umbel_store::{ContentHash, Sensitivity};

use crate::fail;
use crate::records::{self, STATE, VERSION};

/// How long a run holds the lock before another may take it over.
pub const LOCK_MS: Millis = 10 * 60 * 1000;

/// The state record's id: `s-` and 20 hex of SHA-256 of `<space>\0<principal>`.
#[must_use]
pub fn state_id(space: &str, principal: &str) -> String {
    let hash = ContentHash::of(format!("{space}\0{principal}").as_bytes());
    let hex = hash.as_str().strip_prefix("sha256:").unwrap_or_default();
    format!("s-{}", &hex[..20])
}

/// A run record's id: `r-` and 20 hex of SHA-256 of the run's trace id.
#[must_use]
pub fn run_id(run: &str) -> String {
    let hash = ContentHash::of(run.as_bytes());
    let hex = hash.as_str().strip_prefix("sha256:").unwrap_or_default();
    format!("r-{}", &hex[..20])
}

/// Who holds the lock, and until when.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Lock {
    /// The run's trace id.
    pub trace: String,
    /// When another run may take it over.
    pub until: Millis,
}

/// Where the next run continues.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Cursors {
    /// The memory changes feed's revision.
    pub memory_after: u64,
    /// The rotating memory scan's cursor; `None` starts from the newest.
    pub scan_after: Option<MemoryCursor>,
    /// The rotating document cursor; `None` starts from the first.
    pub review_after: Option<String>,
}

/// The caller's state record.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct State {
    /// The knowledge feed's revision.
    pub feed_after: u64,
    /// The other cursors.
    pub cursors: Cursors,
    /// The last finished run's record id.
    pub last_run: Option<String>,
    /// The lock.
    pub lock: Option<Lock>,
}

fn instant(value: &Value) -> Option<Millis> {
    value.as_str().and_then(|text| parse_instant(text).ok())
}

impl State {
    fn parse(body: &Value) -> Option<Self> {
        let scan_after = match body.get("scanAfter")? {
            Value::Null => None,
            cursor => Some(MemoryCursor {
                recorded_at: instant(cursor.get("recordedAt")?)?,
                id: cursor.get("id")?.as_str()?.to_owned(),
            }),
        };
        let lock = match body.get("lock")? {
            Value::Null => None,
            lock => Some(Lock {
                trace: lock.get("trace")?.as_str()?.to_owned(),
                until: instant(lock.get("until")?)?,
            }),
        };
        Some(Self {
            feed_after: body.get("feedAfter")?.as_u64()?,
            cursors: Cursors {
                memory_after: body.get("memoryAfter")?.as_u64()?,
                scan_after,
                review_after: body
                    .get("reviewAfter")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
            },
            last_run: body
                .get("lastRun")
                .and_then(Value::as_str)
                .map(str::to_owned),
            lock,
        })
    }

    fn body(&self, space: &str, principal: &str) -> Value {
        json!({
            "version": VERSION,
            "kind": STATE,
            "id": state_id(space, principal),
            "space": space,
            "principal": principal,
            "access": records::own(principal),
            "feedAfter": self.feed_after,
            "memoryAfter": self.cursors.memory_after,
            "scanAfter": self.cursors.scan_after.as_ref().map(|c| json!({
                "recordedAt": format_instant(c.recorded_at),
                "id": c.id,
            })),
            "reviewAfter": self.cursors.review_after,
            "lastRun": self.last_run,
            "lock": self.lock.as_ref().map(|l| json!({
                "trace": l.trace,
                "until": format_instant(l.until),
            })),
        })
    }
}

/// The caller's state in `space` and its record's hash; the default state when none is stored.
///
/// # Errors
/// The store's failures; `CURATOR_FAILED` for a state record that does not read.
pub(crate) fn load(
    cx: &Cx,
    space: &str,
    principal: &str,
) -> Result<(State, Option<ContentHash>), Outcome> {
    let Some(record) = records::get(cx, space, principal, STATE, &state_id(space, principal))?
    else {
        return Ok((State::default(), None));
    };
    let state = State::parse(&record.body).ok_or_else(|| {
        failure(
            "CURATOR_FAILED",
            "the curator's state record does not read",
            "Run store-check; the curator's records are its own and hold no memory text.",
        )
    })?;
    Ok((state, Some(record.content_hash)))
}

fn put(
    cx: &Cx,
    space: &str,
    principal: &str,
    now: Millis,
    state: &State,
    hash: Option<&ContentHash>,
) -> Result<(), HostError> {
    let envelope = records::envelope(
        space,
        now,
        umbel_store::Origin::AgentInferred,
        records::own(principal),
        Sensitivity::Internal,
    );
    cx.record_put(
        space,
        STATE,
        &state_id(space, principal),
        state.body(space, principal),
        envelope,
        records::expect(hash),
    )
    .map(|_| ())
}

/// `CURATOR_BUSY` (section 11.3): another run of the caller holds the lock in the space.
fn busy(until: Option<Millis>) -> Outcome {
    let mut outcome = failure(
        "CURATOR_BUSY",
        "another curator run of yours holds the lock in this space",
        "Wait for it to finish, or run again after the lock's until; an unfinished run's lock expires after 10 minutes.",
    )
    .with_retryable(true);
    if let Some(until) = until {
        outcome = outcome.with_error_details(json!({ "until": format_instant(until) }));
    }
    outcome
}

/// Take the caller's lock for `run` at `now` by compare-and-set: free, expired, or already this
/// run's. Returns the state as it was before.
///
/// # Errors
/// `CURATOR_BUSY` when another unexpired run holds it, or when another run wrote the state
/// meanwhile; the store's failures.
pub(crate) fn take(
    cx: &Cx,
    space: &str,
    principal: &str,
    run: &str,
    now: Millis,
) -> Result<State, Outcome> {
    let (state, hash) = load(cx, space, principal)?;
    if let Some(lock) = &state.lock
        && lock.trace != run
        && lock.until > now
    {
        return Err(busy(Some(lock.until)));
    }
    let mut locked = state.clone();
    locked.lock = Some(Lock {
        trace: run.to_owned(),
        until: now.saturating_add(LOCK_MS),
    });
    match put(cx, space, principal, now, &locked, hash.as_ref()) {
        Ok(()) => Ok(state),
        Err(HostError::Conflict { .. }) => Err(busy(None)),
        Err(error) => Err(fail::host(&error)),
    }
}

/// Finish `run`: when it still holds the lock, release it and move the cursors and `lastRun`;
/// otherwise leave the state as another run left it. Returns whether the lock was this run's.
///
/// # Errors
/// The store's failures.
pub(crate) fn release(
    cx: &Cx,
    space: &str,
    principal: &str,
    run: &str,
    now: Millis,
    next: State,
) -> Result<bool, Outcome> {
    // Two attempts: a write of the state between the read and the write is either another run
    // taking an expired lock over (then this run no longer holds it) or nothing that matters.
    for _ in 0..2 {
        let (state, hash) = load(cx, space, principal)?;
        if state.lock.as_ref().is_none_or(|lock| lock.trace != run) {
            return Ok(false);
        }
        let released = State {
            lock: None,
            ..next.clone()
        };
        match put(cx, space, principal, now, &released, hash.as_ref()) {
            Ok(()) => return Ok(true),
            Err(HostError::Conflict { .. }) => {}
            Err(error) => return Err(fail::host(&error)),
        }
    }
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_ids_are_content_free_derivations() {
        let id = state_id("main", "human:local");
        assert!(id.starts_with("s-") && id.len() == 22, "{id}");
        assert_ne!(id, state_id("main", "human:ada"));
        assert_ne!(id, state_id("beta", "human:local"));
        let run = run_id("5e1f0a2b3c4d5e6f708192a3b4c5d6e7");
        assert!(run.starts_with("r-") && run.len() == 22, "{run}");
    }

    #[test]
    fn a_state_reads_back_as_written() {
        let state = State {
            feed_after: 7,
            cursors: Cursors {
                memory_after: 3,
                scan_after: Some(MemoryCursor {
                    recorded_at: 1_767_225_600_000,
                    id: "mem-000000000000000000000001".into(),
                }),
                review_after: Some("notes/a".into()),
            },
            last_run: Some(run_id("t")),
            lock: Some(Lock {
                trace: "t".into(),
                until: 1_767_225_600_000 + LOCK_MS,
            }),
        };
        assert_eq!(
            State::parse(&state.body("main", "human:local")),
            Some(state)
        );
    }
}

//! The work a running server carries on (the specification's 3.2 and 5.7):
//! a pass of sync every few minutes and whenever one is asked for, and a
//! rebuild when one is asked for or a stopped one is found.
//!
//! - One piece of work runs at a time, in the background, so that a call
//!   returns within a mounted call's limits: `mail-sync` and `mail-rebuild`
//!   on a server ask for the work and return at once.
//! - A rebuild goes before a pass that waits beside it. One that a stop left
//!   unfinished is carried on as the server starts: until it ends, new mail
//!   waits for it to be derived.
//! - A pass of every account is due five minutes after the last pass of
//!   every account; asking for one account's pass does not put it off.
//! - `mail-status` reports what runs, what waits and how the last of each
//!   ended, in ids, counts and the engine's own words.
//! - Without a server nothing here runs, and the two commands work inline.

use std::future::Future;
use std::panic::AssertUnwindSafe;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::task::Poll;
use std::time::{Duration, Instant};

use afd::{Clock, SystemClock};
use serde_json::{Value, json};
use tokio::sync::Notify;

use crate::engine::Engine;

/// Which accounts a pass of sync covers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Accounts {
    /// Every account.
    All,
    /// The account with this id.
    One(i64),
}

impl Accounts {
    /// One pass that covers both what was asked before and `other`.
    fn with(self, other: Self) -> Self {
        match (self, other) {
            (Self::One(a), Self::One(b)) if a == b => self,
            _ => Self::All,
        }
    }

    fn id(self) -> Option<i64> {
        match self {
            Self::All => None,
            Self::One(id) => Some(id),
        }
    }
}

/// What runs now.
#[derive(Debug, Clone, Copy)]
enum Running {
    Sync {
        accounts: Accounts,
        started_at: i64,
    },
    Rebuild {
        started_at: i64,
        done: u64,
        total: u64,
    },
}

/// How a piece of work ended.
#[derive(Debug, Clone)]
struct Ended {
    started_at: i64,
    ended_at: i64,
    outcome: Value,
}

#[derive(Debug)]
struct State {
    serving: bool,
    sync_asked: Option<Accounts>,
    /// A rebuild waits; `true` when it carries on one begun before.
    rebuild_asked: Option<bool>,
    running: Option<Running>,
    last_sync: Option<Ended>,
    last_rebuild: Option<Ended>,
    /// When the next pass of every account is due, by the wall clock, as
    /// `mail-status` reports it.
    next_sync_at: i64,
    /// The same, by a clock that never goes back, as the worker waits for it.
    next_due: Instant,
    /// When a rebuild that failed and left the store rebuilding is tried
    /// again.
    rebuild_retry: Option<Instant>,
}

impl Default for State {
    fn default() -> Self {
        Self {
            serving: false,
            sync_asked: None,
            rebuild_asked: None,
            running: None,
            last_sync: None,
            last_rebuild: None,
            next_sync_at: 0,
            next_due: Instant::now(),
            rebuild_retry: None,
        }
    }
}

/// What the server will do, and has done.
#[derive(Debug, Default)]
pub struct Work {
    state: Mutex<State>,
    wake: Notify,
}

/// What asking for work found: whether this request added it, and whether
/// work of its kind runs now.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Asked {
    /// The work was not waiting before; it waits now.
    pub queued: bool,
    /// Work of this kind runs now.
    pub running: bool,
}

impl Asked {
    /// As a result.
    #[must_use]
    pub fn json(self, work: &str) -> Value {
        json!({ "work": work, "queued": self.queued, "running": self.running })
    }
}

/// The piece of work the worker takes next.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Job {
    Sync(Accounts),
    /// `true` when it carries on a rebuild begun before.
    Rebuild(bool),
}

impl Work {
    fn state(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Whether a server runs this engine's work: then `mail-sync` and
    /// `mail-rebuild` ask for it, and a call's limits apply.
    #[must_use]
    pub fn serving(&self) -> bool {
        self.state().serving
    }

    /// Asks for a pass of sync over `accounts`, after any that runs now.
    pub fn ask_sync(&self, accounts: Accounts) -> Asked {
        let asked = {
            let mut state = self.state();
            let queued = state.sync_asked.is_none();
            state.sync_asked = Some(match state.sync_asked {
                Some(before) => before.with(accounts),
                None => accounts,
            });
            Asked {
                queued,
                running: matches!(state.running, Some(Running::Sync { .. })),
            }
        };
        self.wake.notify_one();
        asked
    }

    /// Asks for a rebuild, after the work that runs now. The caller has
    /// already marked the store as rebuilding, so that a stop before this one
    /// runs loses nothing: the next server carries it on. `resumed` says
    /// whether it was marked before this request.
    pub fn ask_rebuild(&self, resumed: bool) -> Asked {
        let asked = {
            let mut state = self.state();
            let running = matches!(state.running, Some(Running::Rebuild { .. }));
            // The rebuild that runs covers the request, unless the request
            // marked the store anew after it finished.
            let queued = state.rebuild_asked.is_none() && !(running && resumed);
            if queued {
                state.rebuild_asked = Some(resumed);
            }
            Asked { queued, running }
        };
        self.wake.notify_one();
        asked
    }

    /// The work as `mail-status` reports it; `null` when no server runs it.
    #[must_use]
    pub fn status(&self) -> Value {
        let state = self.state();
        if !state.serving {
            return Value::Null;
        }
        let ended = |ended: &Option<Ended>| match ended {
            Some(ended) => json!({
                "startedAt": ended.started_at,
                "endedAt": ended.ended_at,
                "outcome": ended.outcome,
            }),
            None => Value::Null,
        };
        let (sync_running, rebuild_running) = match state.running {
            Some(Running::Sync {
                accounts,
                started_at,
            }) => (
                json!({ "account": accounts.id(), "startedAt": started_at }),
                Value::Null,
            ),
            Some(Running::Rebuild {
                started_at,
                done,
                total,
            }) => (
                Value::Null,
                // The highest message id derived, and the highest there is.
                json!({ "startedAt": started_at, "throughMessage": done, "lastMessage": total }),
            ),
            None => (Value::Null, Value::Null),
        };
        json!({
            "sync": {
                "running": sync_running,
                "queued": state.sync_asked.map(|accounts| json!({ "account": accounts.id() })),
                "everyAccountDueAt": state.next_sync_at,
                "last": ended(&state.last_sync),
            },
            "rebuild": {
                "running": rebuild_running,
                "queued": state.rebuild_asked.is_some(),
                "retryQueued": state.rebuild_retry.is_some(),
                "last": ended(&state.last_rebuild),
            },
        })
    }

    /// Takes the next piece of work, if one waits or a pass is due: a
    /// rebuild first, then a pass, which covers every account when that is
    /// due.
    fn take(&self, now: i64, at: Instant) -> Option<Job> {
        let mut state = self.state();
        let retry = state.rebuild_retry.is_some_and(|retry| at >= retry);
        let rebuild = match state.rebuild_asked.take() {
            Some(resumed) => Some(resumed),
            None if retry => Some(true),
            None => None,
        };
        if let Some(resumed) = rebuild {
            state.rebuild_retry = None;
            state.running = Some(Running::Rebuild {
                started_at: now,
                done: 0,
                total: 0,
            });
            return Some(Job::Rebuild(resumed));
        }
        if at >= state.next_due {
            state.sync_asked = Some(Accounts::All);
        }
        let accounts = state.sync_asked.take()?;
        state.running = Some(Running::Sync {
            accounts,
            started_at: now,
        });
        Some(Job::Sync(accounts))
    }

    /// How long until a pass, or a rebuild tried again, is due without
    /// being asked for.
    fn until_due(&self, at: Instant) -> Duration {
        let state = self.state();
        let due = match state.rebuild_retry {
            Some(retry) => retry.min(state.next_due),
            None => state.next_due,
        };
        due.saturating_duration_since(at)
    }

    /// Tries a rebuild that failed again at `at`, unless one is asked for
    /// before.
    fn retry_rebuild(&self, at: Instant) {
        self.state().rebuild_retry = Some(at);
    }

    fn rebuilt(&self, done: u64, total: u64) {
        if let Some(Running::Rebuild {
            done: at,
            total: of,
            ..
        }) = &mut self.state().running
        {
            *at = done;
            *of = total;
        }
    }

    /// Records the end of the running work. After a pass of every account,
    /// the next is due `every` from now.
    fn ended(&self, now: i64, at: Instant, outcome: Value, every: Duration) {
        let mut state = self.state();
        match state.running.take() {
            Some(Running::Sync {
                accounts,
                started_at,
            }) => {
                state.last_sync = Some(Ended {
                    started_at,
                    ended_at: now,
                    outcome,
                });
                if accounts == Accounts::All {
                    let every_ms = i64::try_from(every.as_millis()).unwrap_or(i64::MAX);
                    state.next_sync_at = now.saturating_add(every_ms);
                    state.next_due = at.checked_add(every).unwrap_or(at);
                }
            }
            Some(Running::Rebuild { started_at, .. }) => {
                state.last_rebuild = Some(Ended {
                    started_at,
                    ended_at: now,
                    outcome,
                });
            }
            None => {}
        }
    }

    /// Marks the engine as served from `now`, with a pass of every account
    /// due at once, after a rebuild a stop left unfinished.
    fn begin(&self, now: i64, at: Instant, rebuild_unfinished: bool) {
        let mut state = self.state();
        state.serving = true;
        state.next_sync_at = now;
        state.next_due = at;
        if rebuild_unfinished && state.rebuild_asked.is_none() {
            state.rebuild_asked = Some(true);
        }
    }

    /// Marks the engine as no longer served.
    fn end(&self) {
        let mut state = self.state();
        state.serving = false;
        state.running = None;
    }
}

/// The server's work, running in the background until it is stopped.
#[derive(Debug)]
pub struct Worker {
    engine: Arc<Engine>,
    task: tokio::task::JoinHandle<()>,
}

impl Worker {
    /// Marks `engine` as served, so that from now on `mail-sync` and
    /// `mail-rebuild` ask for work and a call's limits apply, and starts its
    /// work. Call it inside a Tokio runtime, with the store open.
    #[must_use]
    pub fn start(engine: &Arc<Engine>) -> Self {
        // A store that cannot be read now is reported by the first pass.
        let unfinished = engine
            .with_store(|store| store.rebuilding())
            .unwrap_or(false);
        engine
            .work()
            .begin(SystemClock.now(), Instant::now(), unfinished);
        Self {
            engine: Arc::clone(engine),
            task: tokio::spawn(run(Arc::clone(engine))),
        }
    }

    /// Stops the work between two of its steps, and waits for it. A pass
    /// asked for and not begun is dropped: the next server syncs as it
    /// starts. A rebuild asked for is kept in the store, and carried on then.
    pub async fn stop(self) {
        self.task.abort();
        let _ = self.task.await;
        self.engine.work().end();
    }
}

/// A failure as a piece of work's outcome.
fn failed(error: &afd::CommandError) -> Value {
    json!({ "error": { "code": error.code, "message": error.message } })
}

/// Runs `work` to its end, and a panic in it as a failure, so that one
/// broken step does not end the server's work for good.
async fn guarded(work: impl Future<Output = Value>) -> Value {
    let mut work = Box::pin(work);
    std::future::poll_fn(move |context| {
        match std::panic::catch_unwind(AssertUnwindSafe(|| work.as_mut().poll(context))) {
            Ok(polled) => polled,
            Err(_) => Poll::Ready(failed(&afd::CommandError::new(
                "COMMAND_EXECUTION_ERROR",
                "the work failed unexpectedly",
            ))),
        }
    })
    .await
}

/// Runs the server's work until the task is stopped: a pass of sync at
/// once and every `every` after the last pass of every account ended, and
/// whatever is asked for between. Stopping it between two steps leaves the
/// store as sync and rebuild leave it after any stop: they carry on next
/// time.
async fn run(engine: Arc<Engine>) {
    let clock = SystemClock;
    let work = engine.work();
    loop {
        // Made before looking, so a request that comes in between wakes it.
        let woken = work.wake.notified();
        tokio::pin!(woken);
        woken.as_mut().enable();
        let job = work.take(clock.now(), Instant::now());
        let outcome = match job {
            Some(Job::Sync(accounts)) => {
                guarded(async {
                    match crate::commands::sync_now(&engine, accounts.id(), &clock).await {
                        Ok(report) => report,
                        Err(error) => failed(&error),
                    }
                })
                .await
            }
            Some(Job::Rebuild(resumed)) => {
                guarded(async {
                    let rebuilt =
                        crate::commands::rebuild_in_steps(&engine, clock.now(), resumed, |step| {
                            work.rebuilt(step.done, step.total);
                        })
                        .await;
                    match rebuilt {
                        Ok(rebuilt) => rebuilt,
                        Err(error) => failed(&error),
                    }
                })
                .await
            }
            None => {
                let wait = work.until_due(Instant::now());
                tokio::select! {
                    () = woken => {}
                    () = tokio::time::sleep(wait) => {}
                }
                continue;
            }
        };
        let failed_rebuild = matches!(job, Some(Job::Rebuild(_))) && outcome.get("error").is_some();
        let every = engine.sync_options().every;
        work.ended(clock.now(), Instant::now(), outcome, every);
        // A rebuild that failed and left the store rebuilding holds new mail
        // back until it ends: it is tried again after a pass's interval.
        if failed_rebuild
            && engine
                .with_store(|store| store.rebuilding())
                .unwrap_or(true)
        {
            work.retry_rebuild(
                Instant::now()
                    .checked_add(every)
                    .unwrap_or_else(Instant::now),
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const EVERY: Duration = Duration::from_secs(300);

    #[test]
    fn requests_merge_and_a_rebuild_goes_first() {
        let work = Work::default();
        assert_eq!(work.status(), Value::Null, "nothing is reported unserved");
        let start = Instant::now();
        work.begin(0, start, false);
        let asked = work.ask_sync(Accounts::One(1));
        assert!(asked.queued && !asked.running);
        assert!(!work.ask_sync(Accounts::One(2)).queued, "it already waits");
        assert!(work.ask_rebuild(false).queued);
        assert!(!work.ask_rebuild(true).queued);
        assert_eq!(work.take(0, start), Some(Job::Rebuild(false)));
        // Asked again while it runs: it covers the request.
        let asked = work.ask_rebuild(true);
        assert!(asked.running && !asked.queued);
        // Asked again after it finished, marking the store anew: it waits.
        let asked = work.ask_rebuild(false);
        assert!(asked.running && asked.queued);
        work.ended(5, start, json!({ "messages": 0 }), EVERY);
        assert_eq!(work.take(6, start), Some(Job::Rebuild(false)));
        work.ended(7, start, json!({}), EVERY);
        // Two accounts asked for become one pass of every account; it is due
        // at once in any case.
        assert_eq!(work.take(8, start), Some(Job::Sync(Accounts::All)));
        assert!(work.ask_sync(Accounts::One(1)).running);
        work.ended(10, start, json!({}), EVERY);
        assert_eq!(work.take(11, start), Some(Job::Sync(Accounts::One(1))));
        work.ended(20, start, json!({}), EVERY);
        // Nothing waits, and the next pass of every account is due five
        // minutes after the last one, not after the pass of one.
        assert!(work.take(21, start).is_none());
        assert_eq!(work.until_due(start), EVERY);
        assert_eq!(work.status()["sync"]["everyAccountDueAt"], json!(300_010));
        assert_eq!(
            work.take(300_010, start + EVERY),
            Some(Job::Sync(Accounts::All))
        );
        assert_eq!(work.status()["rebuild"]["last"]["outcome"], json!({}));
    }

    #[test]
    fn asking_for_one_account_does_not_put_off_the_others() {
        let work = Work::default();
        let start = Instant::now();
        work.begin(0, start, false);
        assert_eq!(work.take(0, start), Some(Job::Sync(Accounts::All)));
        work.ended(1, start, json!({}), EVERY);
        // Account 1 asked for just before every account is due, again and
        // again: every account's pass still comes when it is due.
        let just_before = start + EVERY - Duration::from_secs(1);
        work.ask_sync(Accounts::One(1));
        assert_eq!(work.take(2, just_before), Some(Job::Sync(Accounts::One(1))));
        work.ended(3, just_before, json!({}), EVERY);
        work.ask_sync(Accounts::One(1));
        assert_eq!(work.take(4, start + EVERY), Some(Job::Sync(Accounts::All)));
    }

    #[test]
    fn a_rebuild_a_stop_left_is_carried_on_first() {
        let work = Work::default();
        let start = Instant::now();
        work.begin(0, start, true);
        assert_eq!(work.take(0, start), Some(Job::Rebuild(true)));
        work.ended(1, start, json!({}), EVERY);
        assert_eq!(work.take(2, start), Some(Job::Sync(Accounts::All)));
        work.end();
        assert_eq!(work.status(), Value::Null);
    }

    #[test]
    fn a_panic_in_the_work_is_its_failure() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap();
        let outcome = runtime.block_on(guarded(async {
            if Instant::now().elapsed() < Duration::from_secs(3600) {
                panic!("broken");
            }
            json!({})
        }));
        assert_eq!(outcome["error"]["code"], json!("COMMAND_EXECUTION_ERROR"));
    }

    #[test]
    fn a_rebuild_that_failed_is_tried_again_after_an_interval() {
        let work = Work::default();
        let start = Instant::now();
        work.begin(0, start, true);
        assert_eq!(work.take(0, start), Some(Job::Rebuild(true)));
        work.ended(
            1,
            start,
            json!({ "error": { "code": "STORE_FAILED" } }),
            EVERY,
        );
        work.retry_rebuild(start + EVERY);
        assert_eq!(work.status()["rebuild"]["retryQueued"], json!(true));
        assert_eq!(work.take(2, start), Some(Job::Sync(Accounts::All)));
        work.ended(3, start, json!({}), EVERY);
        assert!(work.take(4, start).is_none());
        assert_eq!(work.until_due(start), EVERY);
        assert_eq!(work.take(5, start + EVERY), Some(Job::Rebuild(true)));
        assert_eq!(work.status()["rebuild"]["retryQueued"], json!(false));
    }
}

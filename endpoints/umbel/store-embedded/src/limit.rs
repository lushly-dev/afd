//! The cap on how many threads of one host work on its SQLite stores at once (`store.max_connections`,
//! Umbel decision D204).
//!
//! A thread takes a turn before it opens or takes a pooled connection, and gives it back when its
//! work ends, so at most `max` threads hold connections of one limit at once. A thread that
//! already holds a turn of a limit takes another of the same limit at once: the memory store opens
//! its key file inside a memory connection's work, and that must never wait on itself. The count
//! is per limit and per thread, and the thread's turn of a limit is given back only when its last
//! guard is dropped, in whatever order the guards go. A guard cannot leave its thread. Past the
//! cap a thread waits up to the store's lock timeout, then answers [`StoreError::Busy`].

use std::cell::RefCell;
use std::marker::PhantomData;
use std::sync::{Arc, Condvar, Mutex, PoisonError};
use std::time::{Duration, Instant};

use umbel_store::StoreError;

thread_local! {
    /// The turns this thread holds: each limit's address and how many guards share its turn.
    static HELD: RefCell<Vec<(usize, usize)>> = const { RefCell::new(Vec::new()) };
}

/// A cap shared by the stores of one host; clones share the count.
#[derive(Clone)]
pub struct ConnectionLimit(Arc<Inner>);

struct Inner {
    max: usize,
    used: Mutex<usize>,
    freed: Condvar,
}

impl ConnectionLimit {
    /// A cap of `max` threads at once (at least one).
    #[must_use]
    pub fn new(max: usize) -> Self {
        Self(Arc::new(Inner {
            max: max.max(1),
            used: Mutex::new(0),
            freed: Condvar::new(),
        }))
    }

    /// The cap.
    #[must_use]
    pub fn max(&self) -> usize {
        self.0.max
    }

    /// How many threads hold a turn now.
    #[must_use]
    pub fn in_use(&self) -> usize {
        *self.0.used.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// This limit's key in a thread's table: its address, which cannot be reused while a guard
    /// holds a clone of it.
    fn key(&self) -> usize {
        Arc::as_ptr(&self.0) as usize
    }

    /// A turn for this thread: at once when it already holds one of this limit, else as soon as
    /// one is free, waiting at most `timeout`. Dropping the last guard gives it back.
    pub(crate) fn turn(&self, timeout: Duration) -> Result<Turn, StoreError> {
        let key = self.key();
        let nested = HELD.with(|held| {
            let mut held = held.borrow_mut();
            let entry = held.iter_mut().find(|(at, _)| *at == key);
            entry.map(|(_, guards)| *guards += 1).is_some()
        });
        if !nested {
            let deadline = Instant::now() + timeout;
            let mut used = self.0.used.lock().unwrap_or_else(PoisonError::into_inner);
            while *used >= self.0.max {
                let left = deadline.saturating_duration_since(Instant::now());
                if left.is_zero() {
                    return Err(StoreError::Busy);
                }
                used = self
                    .0
                    .freed
                    .wait_timeout(used, left)
                    .unwrap_or_else(PoisonError::into_inner)
                    .0;
            }
            *used += 1;
            drop(used);
            HELD.with(|held| held.borrow_mut().push((key, 1)));
        }
        Ok(Turn {
            limit: self.clone(),
            _thread: PhantomData,
        })
    }

    /// Hold one turn of this limit on a thread of its own until the hold is dropped, so a test
    /// can fill the cap. Compiled in only with the `testkit` feature.
    ///
    /// # Panics
    /// When no turn comes within ten seconds.
    #[cfg(feature = "testkit")]
    #[must_use]
    pub fn hold(&self) -> Hold {
        let (release, released) = std::sync::mpsc::channel::<()>();
        let (taken, take) = std::sync::mpsc::channel();
        let limit = self.clone();
        let thread = std::thread::spawn(move || {
            let turn = limit.turn(Duration::from_secs(10));
            let ok = turn.is_ok();
            let _ = taken.send(ok);
            let _ = released.recv();
            drop(turn);
        });
        assert_eq!(take.recv().ok(), Some(true), "the hold took a turn");
        Hold {
            release: Some(release),
            thread: Some(thread),
        }
    }
}

impl std::fmt::Debug for ConnectionLimit {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ConnectionLimit")
            .field("max", &self.0.max)
            .field("in_use", &self.in_use())
            .finish()
    }
}

/// One guard of a thread's turn of a limit ([`ConnectionLimit::turn`]). Neither `Send` nor
/// `Sync`: it is dropped on the thread that took it.
#[must_use = "the turn is given back when its last guard is dropped"]
pub(crate) struct Turn {
    limit: ConnectionLimit,
    _thread: PhantomData<*const ()>,
}

impl Drop for Turn {
    fn drop(&mut self) {
        let key = self.limit.key();
        let last = HELD.with(|held| {
            let mut held = held.borrow_mut();
            let Some(index) = held.iter().position(|(at, _)| *at == key) else {
                return false;
            };
            held[index].1 -= 1;
            if held[index].1 == 0 {
                held.swap_remove(index);
                return true;
            }
            false
        });
        if last {
            let mut used = self
                .limit
                .0
                .used
                .lock()
                .unwrap_or_else(PoisonError::into_inner);
            *used = used.saturating_sub(1);
            drop(used);
            self.limit.0.freed.notify_one();
        }
    }
}

/// A turn held on a thread of its own ([`ConnectionLimit::hold`]); dropping it gives the turn
/// back and waits for that.
#[cfg(feature = "testkit")]
#[derive(Debug)]
pub struct Hold {
    release: Option<std::sync::mpsc::Sender<()>>,
    thread: Option<std::thread::JoinHandle<()>>,
}

#[cfg(feature = "testkit")]
impl Drop for Hold {
    fn drop(&mut self) {
        drop(self.release.take());
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

/// A turn of `limit`, or none when no limit is set.
pub(crate) fn enter(
    limit: Option<&ConnectionLimit>,
    timeout: Duration,
) -> Result<Option<Turn>, StoreError> {
    limit.map(|limit| limit.turn(timeout)).transpose()
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    const SHORT: Duration = Duration::from_millis(50);

    /// Whether another thread can take a turn of `limit` within [`SHORT`].
    fn other_thread_gets_one(limit: &ConnectionLimit) -> bool {
        let limit = limit.clone();
        std::thread::spawn(move || limit.turn(SHORT).map(drop).is_ok())
            .join()
            .unwrap()
    }

    #[test]
    fn a_thread_past_the_cap_waits_then_is_refused_busy() {
        let limit = ConnectionLimit::new(1);
        let held = limit.turn(SHORT).unwrap();
        assert_eq!(limit.in_use(), 1);
        let started = Instant::now();
        assert!(!other_thread_gets_one(&limit));
        assert!(started.elapsed() >= SHORT);
        drop(held);
        assert_eq!(limit.in_use(), 0);
        assert!(other_thread_gets_one(&limit));
    }

    #[test]
    fn a_waiting_thread_gets_the_turn_given_back() {
        let limit = ConnectionLimit::new(1);
        let held = limit.turn(SHORT).unwrap();
        let other = limit.clone();
        let waiter =
            std::thread::spawn(move || other.turn(Duration::from_secs(10)).map(drop).is_ok());
        std::thread::sleep(Duration::from_millis(20));
        drop(held);
        assert!(waiter.join().unwrap());
        assert_eq!(limit.in_use(), 0);
    }

    #[test]
    fn the_turn_is_given_back_only_with_its_last_guard_in_any_order() {
        let limit = ConnectionLimit::new(1);
        let outer = limit.turn(SHORT).unwrap();
        let inner = limit.turn(Duration::ZERO).unwrap();
        assert_eq!(limit.in_use(), 1, "a nested guard shares the turn");
        drop(outer);
        assert_eq!(limit.in_use(), 1, "the inner guard still holds it");
        assert!(!other_thread_gets_one(&limit));
        drop(inner);
        assert_eq!(limit.in_use(), 0);
        assert!(other_thread_gets_one(&limit));
    }

    #[test]
    fn a_turn_of_one_limit_is_not_a_turn_of_another() {
        let first = ConnectionLimit::new(1);
        let second = ConnectionLimit::new(1);
        let _first = first.turn(SHORT).unwrap();
        let in_second = second.turn(SHORT).unwrap();
        assert_eq!(
            second.in_use(),
            1,
            "the second limit counts this thread too"
        );
        assert!(!other_thread_gets_one(&second));
        drop(in_second);
        assert!(other_thread_gets_one(&second));
        assert_eq!(first.in_use(), 1);
    }
}

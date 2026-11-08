//! A call's cancellation signal and progress, as an MCP task sets them
//! (`spec/command-metadata.md`, "Tasks").
//!
//! The MCP server (feature `server`) puts a [`CancellationSignal`] on the context of a command it
//! runs as a task, and fires it on `tasks/cancel`, when the task's `ttlMs` ends, and when the token
//! that started it expires. The server stops the handler then, at its next `.await`: work the
//! handler spawned elsewhere, and a loop that does not await, read the signal and stop by
//! themselves. A call that is not a task has no signal and never reports progress.
//!
//! Both need no feature and no runtime, so they compile for every target.

use std::fmt;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll, Waker};

/// The longest progress message a task keeps, in bytes; a longer one is cut at a character
/// boundary.
pub const MAX_PROGRESS_MESSAGE_BYTES: usize = 1024;

#[derive(Default)]
struct SignalState {
    fired: AtomicBool,
    wakers: Mutex<Vec<Waker>>,
}

/// A signal that fires once and stays fired: [`CommandContext::cancellation`] of a command that
/// runs as an MCP task.
///
/// Clones share the signal. Read it with [`Self::is_cancelled`], or await [`Self::cancelled`].
///
/// [`CommandContext::cancellation`]: crate::CommandContext::cancellation
#[derive(Clone, Default)]
pub struct CancellationSignal(Arc<SignalState>);

impl CancellationSignal {
    /// A signal that has not fired. Only the server fires one.
    #[cfg_attr(not(feature = "server"), allow(dead_code))]
    pub(crate) fn new() -> Self {
        Self::default()
    }

    /// Whether the signal fired.
    pub fn is_cancelled(&self) -> bool {
        self.0.fired.load(Ordering::SeqCst)
    }

    /// Resolves once the signal fires (at once when it already has).
    pub fn cancelled(&self) -> Cancelled {
        Cancelled(self.clone())
    }

    /// Fire the signal and wake everything waiting on it. Firing again does nothing.
    #[cfg_attr(not(feature = "server"), allow(dead_code))]
    pub(crate) fn cancel(&self) {
        if self.0.fired.swap(true, Ordering::SeqCst) {
            return;
        }
        let wakers = std::mem::take(&mut *lock(&self.0.wakers));
        for waker in wakers {
            waker.wake();
        }
    }
}

impl fmt::Debug for CancellationSignal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("CancellationSignal")
            .field("cancelled", &self.is_cancelled())
            .finish()
    }
}

/// The future of [`CancellationSignal::cancelled`].
#[derive(Debug)]
#[must_use = "futures do nothing unless awaited"]
pub struct Cancelled(CancellationSignal);

impl Future for Cancelled {
    type Output = ();

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<()> {
        let state = &(self.0).0;
        if state.fired.load(Ordering::SeqCst) {
            return Poll::Ready(());
        }
        let mut wakers = lock(&state.wakers);
        // Checked again under the lock: `cancel` takes the wakers under it after setting the flag.
        if state.fired.load(Ordering::SeqCst) {
            return Poll::Ready(());
        }
        if !wakers.iter().any(|waker| waker.will_wake(cx.waker())) {
            wakers.push(cx.waker().clone());
        }
        Poll::Pending
    }
}

/// The latest progress message of a task, which the server writes to the task's
/// `statusMessage` (`spec/command-metadata.md`, "Tasks": progress updates `statusMessage` and
/// `lastUpdatedAt`; no notification is sent).
#[derive(Default)]
pub(crate) struct TaskProgress {
    latest: Mutex<Option<String>>,
}

impl TaskProgress {
    /// Keep `message` (cut to [`MAX_PROGRESS_MESSAGE_BYTES`]) as the latest.
    pub(crate) fn report(&self, message: String) {
        let message = truncate(message, MAX_PROGRESS_MESSAGE_BYTES);
        *lock(&self.latest) = Some(message);
    }

    /// The message reported since the last call, if any.
    #[cfg_attr(not(feature = "server"), allow(dead_code))]
    pub(crate) fn take(&self) -> Option<String> {
        lock(&self.latest).take()
    }
}

impl fmt::Debug for TaskProgress {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("TaskProgress(..)")
    }
}

fn truncate(mut text: String, max: usize) -> String {
    if text.len() > max {
        let mut end = max;
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        text.truncate(end);
    }
    text
}

/// A poisoned lock still holds consistent data here (a flag and a list of wakers, or a string).
fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fires_once_and_stays_fired() {
        let signal = CancellationSignal::new();
        let clone = signal.clone();
        assert!(!clone.is_cancelled());
        signal.cancel();
        signal.cancel();
        assert!(clone.is_cancelled());
    }

    #[test]
    fn progress_keeps_the_latest_and_cuts_long_messages() {
        let progress = TaskProgress::default();
        assert_eq!(progress.take(), None);
        progress.report("one".into());
        progress.report("two".into());
        assert_eq!(progress.take().as_deref(), Some("two"));
        assert_eq!(progress.take(), None);
        progress.report("é".repeat(MAX_PROGRESS_MESSAGE_BYTES));
        let cut = progress.take().unwrap();
        assert!(cut.len() <= MAX_PROGRESS_MESSAGE_BYTES);
        assert!(cut.chars().all(|c| c == 'é'));
    }
}

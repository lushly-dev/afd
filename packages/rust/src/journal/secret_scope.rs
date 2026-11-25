//! Secret scopes: where a recording tape refuses the reads of a secret call nested in its own.
//!
//! A call to a command declaring `secret` runs inside a scope that is current on the thread
//! only while its future is polled. A recording tape remembers the scope its call started in,
//! and drops (marking itself `truncated`) any reading taken inside a secret scope nested below
//! that one. This holds wherever the reading comes from: through a host's own clock or random
//! source wrapping a recording one, or a fresh context the call was handed, so isolation never
//! depends on a wrapper forwarding anything (`spec/journal.md`).

use futures_util::future::{BoxFuture, Either};
use std::cell::RefCell;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::task::{Context, Poll};

/// The ids of the secret calls a scope is nested in, outermost first.
pub(crate) type Scope = Arc<[u64]>;

static NEXT_SCOPE: AtomicU64 = AtomicU64::new(1);

thread_local! {
    static CURRENT: RefCell<Option<Scope>> = const { RefCell::new(None) };
}

/// The secret scope current on this thread: `None` outside every secret call.
pub(crate) fn current() -> Option<Scope> {
    CURRENT.with(|current| current.borrow().clone())
}

/// A new secret scope nested in the current one, for a secret call about to run.
pub(crate) fn enter() -> Scope {
    let id = NEXT_SCOPE.fetch_add(1, Ordering::Relaxed);
    let mut ids = current().map(|scope| scope.to_vec()).unwrap_or_default();
    ids.push(id);
    ids.into()
}

/// Whether a reading taken now reaches a tape whose call started in `tape`: only from that
/// call's own scope or one it encloses (a non-secret call it makes, or a task outside every
/// secret call), never from a secret call nested below it or a sibling secret call.
pub(crate) fn reaches(tape: Option<&Scope>) -> bool {
    let tape: &[u64] = tape.map_or(&[], |scope| scope);
    CURRENT.with(|current| {
        current
            .borrow()
            .as_deref()
            .is_none_or(|now| tape.starts_with(now))
    })
}

/// `f`, run with `scope` current on the thread when it is `Some`.
pub(crate) fn within<T>(scope: Option<&Scope>, f: impl FnOnce() -> T) -> T {
    let Some(scope) = scope else {
        return f();
    };
    let _restore = Restore(CURRENT.with(|current| current.replace(Some(Arc::clone(scope)))));
    f()
}

/// `future`, polled with `scope` current on the thread when it is `Some`; boxed only then.
pub(crate) fn scoped<F: Future>(scope: Option<Scope>, future: F) -> Either<F, Scoped<F>> {
    match scope {
        Some(scope) => Either::Right(Scoped {
            scope,
            future: Box::pin(future),
        }),
        None => Either::Left(future),
    }
}

/// A step of the middleware chain, polled with `scope` current when it is `Some`: every step
/// takes the call's scope again, so a middleware that moves the rest of the chain to another
/// task cannot take the handler out of it. Entering the scope a step is already in changes
/// nothing.
pub(crate) fn scoped_step<T: Send + 'static>(
    scope: Option<&Scope>,
    step: BoxFuture<'static, T>,
) -> BoxFuture<'static, T> {
    match scope {
        Some(scope) => Box::pin(Scoped {
            scope: Arc::clone(scope),
            future: Box::pin(step),
        }),
        None => step,
    }
}

/// A future polled inside a secret scope: see [`scoped`].
pub(crate) struct Scoped<F> {
    scope: Scope,
    future: Pin<Box<F>>,
}

/// Restores the scope that was current before a poll, even when the poll panics.
struct Restore(Option<Scope>);

impl Drop for Restore {
    fn drop(&mut self) {
        let previous = self.0.take();
        CURRENT.with(|current| *current.borrow_mut() = previous);
    }
}

impl<F: Future> Future for Scoped<F> {
    type Output = F::Output;

    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<F::Output> {
        let scope = Arc::clone(&self.scope);
        let _restore = Restore(CURRENT.with(|current| current.replace(Some(scope))));
        self.future.as_mut().poll(cx)
    }
}

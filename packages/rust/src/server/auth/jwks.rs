//! A [`KeySource`] over the JWKS document the host loads (`spec/authorization.md`, M3 rule 3):
//! the counterpart of TypeScript's `jwksKeySource(load, options)` and Python's
//! `jwks_key_source(load, ...)`. AFD opens no socket: the host's [`JwksLoader`] fetches the
//! document, and this module caches it, refetches it and decides `unknown` against
//! `unavailable`.

use std::collections::HashMap;
use std::fmt;
use std::future::Future;
use std::panic::AssertUnwindSafe;
use std::sync::{Arc, Mutex, PoisonError, Weak};

use async_trait::async_trait;
use futures_util::future::{BoxFuture, FutureExt, Shared};
use serde_json::Value;

use crate::clock::{Clock, SYSTEM_CLOCK};

use super::jwt::{read_jwks, Jwk, KeyError, KeySource};

/// The host's fetch of an issuer's JWKS document (RFC 7517 5), such as a GET of the `jwks_uri`
/// its authorization server metadata names. [`JwksKeySource`] calls it; AFD opens no socket.
///
/// It is implemented for every `Fn(&str) -> impl Future<Output = Result<Value, E>>` whose error
/// is `Display`, so a closure serves:
///
/// ```no_run
/// # async fn fetch(_url: &str) -> Result<serde_json::Value, std::io::Error> { unimplemented!() }
/// use afd::server::auth::{JwksKeySource, JwksKeySourceOptions};
///
/// let keys = JwksKeySource::new(
///     |_issuer: &str| fetch("https://auth.example.com/.well-known/jwks.json"),
///     JwksKeySourceOptions::default(),
/// )?;
/// # Ok::<(), String>(())
/// ```
///
/// The error, and a panic, count as a failed load: [`JwksKeySource`] keeps its last good keys
/// and drops the error, so log it here if the host wants it. Cap the response's size, and give
/// the fetch a deadline of its own: every caller that needs a load waits for the one under way,
/// whatever its own deadline.
#[async_trait]
pub trait JwksLoader: Send + Sync {
    /// The JWKS document of `issuer` (its exact configured `iss` string).
    async fn load(&self, issuer: &str) -> Result<Value, String>;
}

#[async_trait]
impl<F, Fut, E> JwksLoader for F
where
    F: Fn(&str) -> Fut + Send + Sync,
    Fut: Future<Output = Result<Value, E>> + Send,
    E: fmt::Display,
{
    async fn load(&self, issuer: &str) -> Result<Value, String> {
        self(issuer).await.map_err(|error| error.to_string())
    }
}

/// What [`JwksKeySource::new`] takes besides the loader: TypeScript's `JwksKeySourceOptions`.
#[derive(Debug, Clone)]
pub struct JwksKeySourceOptions {
    min_refetch_interval_ms: u64,
    max_age_ms: u64,
    max_stale_ms: u64,
    clock: Arc<dyn Clock>,
}

impl Default for JwksKeySourceOptions {
    fn default() -> Self {
        Self {
            min_refetch_interval_ms: 30_000,
            max_age_ms: 300_000,
            max_stale_ms: 3_600_000,
            clock: Arc::new(SYSTEM_CLOCK),
        }
    }
}

impl JwksKeySourceOptions {
    /// The shortest time between two loads of one issuer's keys, in milliseconds. Default: 30
    /// seconds.
    pub fn with_min_refetch_interval_ms(mut self, ms: u64) -> Self {
        self.min_refetch_interval_ms = ms;
        self
    }

    /// How long loaded keys are used before they are loaded again, in milliseconds. Default: 5
    /// minutes.
    pub fn with_max_age_ms(mut self, ms: u64) -> Self {
        self.max_age_ms = ms;
        self
    }

    /// How long the last good keys are kept while every load fails, in milliseconds, counted
    /// from the load that fetched them. Past it the source answers [`KeyError::Unavailable`], so
    /// a key the issuer withdrew stops verifying even when its JWKS cannot be reached. Default: 1
    /// hour; at least the maximum age ([`JwksKeySource::new`] refuses less).
    pub fn with_max_stale_ms(mut self, ms: u64) -> Self {
        self.max_stale_ms = ms;
        self
    }

    /// Read the intervals' time from `clock`. Default: the system clock.
    pub fn with_clock(mut self, clock: impl Clock + 'static) -> Self {
        self.clock = Arc::new(clock);
        self
    }
}

/// A [`KeySource`] over JWKS documents the host's [`JwksLoader`] fetches.
///
/// Per issuer:
///
/// - **Loading.** The first call loads the keys; loaded keys are used for the maximum age, then
///   loaded again.
/// - **Unknown `kid`.** A `kid` the keys do not hold loads them again at most once per minimum
///   refetch interval, counted from the start of the last load, so a stream of made-up `kid`s
///   (the `kid` is read from a token not yet verified) costs at most one load per interval.
///   Between loads it is [`KeyError::Unknown`].
/// - **One load at a time.** Concurrent callers that need a load share one call of the loader.
/// - **Failures.** A load that fails (the loader's error or panic, or a document with no `keys`
///   array, or a key that is not an object with a non-empty `kid` that no other key has) keeps
///   the last good keys for up to the maximum staleness. With no good keys, keys older than
///   that, or a failed load for an unknown `kid`, the answer is [`KeyError::Unavailable`], and
///   the request fails closed.
/// - **`Unknown` after a failed refresh.** When the keys are past the maximum age but still within
///   the maximum staleness, a failed refresh keeps them; a `kid` they do not hold is then
///   [`KeyError::Unknown`] while the refetch interval (when positive) has not passed, because
///   that refresh was the interval's load. A failed refetch caused by the missing `kid` itself
///   is [`KeyError::Unavailable`]. TypeScript answers the same.
///
/// **Time** is the configured clock's ([`JwksKeySourceOptions::with_clock`]; wall time by
/// default), as TypeScript's `Date.now`: a backwards jump extends how long keys are kept and
/// how long a refetch waits.
///
/// **What the host bounds.** The loader should cap the response's size and give its fetch a
/// deadline of its own: a caller's deadline does not end a hung load, because the next caller
/// joins it. The issuer map grows by the issuers asked about; [`JwtVerifier`](super::JwtVerifier)
/// asks only about configured ones, so a host that calls [`KeySource::key`] itself should do the
/// same.
///
/// A fixed document needs no loader: use [`StaticKeys`](super::StaticKeys), TypeScript's
/// `jwksKeySource(document)`.
///
/// Rust differs from TypeScript in two places. The loader is given the issuer, and the keys and
/// intervals are kept per issuer, so one source (cloned, since clones share their state) may
/// serve several issuers without a `kid` of one naming a key of another; TypeScript's loader
/// takes no issuer, and its `JwtVerifier` refuses two issuers that share a source. And a load
/// runs while a caller awaits it: when every caller waiting on it is dropped, it resumes with
/// the next caller that needs a load, where TypeScript's promise runs on alone.
#[derive(Clone)]
pub struct JwksKeySource {
    inner: Arc<Inner>,
}

impl fmt::Debug for JwksKeySource {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("JwksKeySource")
            .field("min_refetch_interval_ms", &self.inner.min_interval)
            .field("max_age_ms", &self.inner.max_age)
            .field("max_stale_ms", &self.inner.max_stale)
            .finish_non_exhaustive()
    }
}

impl JwksKeySource {
    /// A key source over the documents `loader` fetches, under `options`.
    ///
    /// # Errors
    /// The maximum staleness is shorter than the maximum age.
    pub fn new(
        loader: impl JwksLoader + 'static,
        options: JwksKeySourceOptions,
    ) -> Result<Self, String> {
        if options.max_stale_ms < options.max_age_ms {
            return Err("[AFD] max_stale_ms must be at least max_age_ms".to_owned());
        }
        let ms = |ms: u64| i64::try_from(ms).unwrap_or(i64::MAX);
        Ok(Self {
            inner: Arc::new(Inner {
                loader: Arc::new(loader),
                clock: options.clock,
                min_interval: ms(options.min_refetch_interval_ms),
                max_age: ms(options.max_age_ms),
                max_stale: ms(options.max_stale_ms),
                issuers: Mutex::new(HashMap::new()),
            }),
        })
    }
}

#[async_trait]
impl KeySource for JwksKeySource {
    async fn key(&self, issuer: &str, kid: &str) -> Result<Jwk, KeyError> {
        let inner = &self.inner;
        let now = inner.clock.now();
        let load = inner.with_issuer(issuer, |state| {
            let expired = state.keys.is_none() || since(now, state.loaded_at) >= inner.max_age;
            (expired && inner.may_load(state, now)).then(|| inner.refresh(issuer, state))
        });
        if let Some(load) = load {
            load.await;
        }
        let now = inner.clock.now();
        let next = inner.with_issuer(issuer, |state| {
            // Keys older than the maximum staleness (every load since has failed) verify nothing.
            let keys = match &state.keys {
                Some(keys) if since(now, state.loaded_at) < inner.max_stale => keys,
                _ => return Err(KeyError::Unavailable),
            };
            if let Some(key) = keys.get(kid) {
                return Ok(Next::Found(key.clone()));
            }
            Ok(if inner.may_load(state, now) {
                Next::Refetch(inner.refresh(issuer, state))
            } else {
                Next::Unknown
            })
        })?;
        match next {
            Next::Found(key) => Ok(key),
            Next::Unknown => Err(KeyError::Unknown),
            Next::Refetch(load) => {
                if !load.await {
                    return Err(KeyError::Unavailable);
                }
                // A waiter may resume long after the load finished: check the keys' age again.
                let now = inner.clock.now();
                inner.with_issuer(issuer, |state| match &state.keys {
                    Some(keys) if since(now, state.loaded_at) < inner.max_stale => {
                        keys.get(kid).cloned().ok_or(KeyError::Unknown)
                    }
                    _ => Err(KeyError::Unavailable),
                })
            }
        }
    }
}

/// One load of an issuer's keys, shared by every caller waiting on it; whether it succeeded.
type Load = Shared<BoxFuture<'static, bool>>;

enum Next {
    Found(Jwk),
    Refetch(Load),
    Unknown,
}

struct Inner {
    loader: Arc<dyn JwksLoader>,
    clock: Arc<dyn Clock>,
    min_interval: i64,
    max_age: i64,
    max_stale: i64,
    /// Bounded by the issuers asked about: `JwtVerifier` asks only about configured issuers.
    issuers: Mutex<HashMap<String, IssuerKeys>>,
}

/// One issuer's keys and load times (`None`: never), in the clock's milliseconds.
#[derive(Default)]
struct IssuerKeys {
    keys: Option<Arc<HashMap<String, Jwk>>>,
    loaded_at: Option<i64>,
    attempted_at: Option<i64>,
    pending: Option<(u64, Load)>,
    loads: u64,
}

/// Milliseconds from `at` to `now`; unbounded when `at` never happened.
fn since(now: i64, at: Option<i64>) -> i64 {
    at.map_or(i64::MAX, |at| now.saturating_sub(at))
}

impl Inner {
    /// `f` on the state of `issuer`, under the lock, which is never held across an await.
    fn with_issuer<T>(&self, issuer: &str, f: impl FnOnce(&mut IssuerKeys) -> T) -> T {
        let mut issuers = self.issuers.lock().unwrap_or_else(PoisonError::into_inner);
        f(issuers.entry(issuer.to_owned()).or_default())
    }

    /// Whether a caller may start a load now, or join the one under way.
    fn may_load(&self, state: &IssuerKeys, now: i64) -> bool {
        state.pending.is_some() || since(now, state.attempted_at) >= self.min_interval
    }

    /// The load under way for `issuer`, or a new one.
    fn refresh(self: &Arc<Self>, issuer: &str, state: &mut IssuerKeys) -> Load {
        if let Some((_, load)) = &state.pending {
            return load.clone();
        }
        state.attempted_at = Some(self.clock.now());
        state.loads = state.loads.wrapping_add(1);
        let id = state.loads;
        // A weak reference, so a load nobody drives does not keep the source alive.
        let load = attempt(
            Arc::downgrade(self),
            Arc::clone(&self.loader),
            issuer.to_owned(),
            id,
        )
        .boxed()
        .shared();
        state.pending = Some((id, load.clone()));
        load
    }
}

async fn attempt(inner: Weak<Inner>, loader: Arc<dyn JwksLoader>, issuer: String, id: u64) -> bool {
    // The call and its await together: a hand-written loader may panic before it returns a
    // future, and that panic must fail this load, not poison the shared one.
    let loaded = AssertUnwindSafe(async { loader.load(&issuer).await })
        .catch_unwind()
        .await;
    let keys = match loaded {
        Ok(Ok(document)) => read_jwks(&document).ok(),
        _ => None,
    };
    let Some(inner) = inner.upgrade() else {
        return false;
    };
    let (finished, loaded) = inner.with_issuer(&issuer, |state| {
        let finished = state.pending.take_if(|(pending, _)| *pending == id);
        let loaded = keys.is_some();
        if let Some(keys) = keys {
            state.keys = Some(Arc::new(keys));
            state.loaded_at = Some(inner.clock.now());
        }
        (finished, loaded)
    });
    // Dropped outside the lock: the waiting callers hold their own clones of this load.
    drop(finished);
    loaded
}

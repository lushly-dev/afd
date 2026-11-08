//! The read limit (phase 5 specification, section 11; D128): `read_bytes_per_minute` per effective
//! principal, a host middleware inside the registry (section 6.3, layer 7: after the scope gate,
//! before the plugin gate).
//!
//! Before the handler runs, the call is refused with `RATE_LIMITED` (`details.retryAfterMs`) when
//! the result bytes already counted for its effective principal in the last minute reach the
//! limit; after it, the bytes of its result are counted. So a call's own result is never withheld
//! once it ran, a mutation's least of all, and one call can carry a principal past the limit only
//! by the size of that call's result. The counters are shared by every process behind one URL
//! (`state/shared/limits.sqlite3`, section 10.2). A counter's name is the HMAC of the principal
//! under the workspace's `state/keys/limits.key`, so the store holds no identifier a dictionary
//! could recover. The store and the key are opened on the first call that is limited, so the
//! operator, who never is, never depends on `state/shared/`.
//!
//! It applies in hosted modes to every caller but the operator (section 11: operators are not
//! limited), stdio and the library included (section 4.7). A shared store held past
//! `store.lock_timeout_ms` refuses the call with `WORKSPACE_SHARED_TIMEOUT` (retryable,
//! `details.store`); any other store failure refuses it too. Counting after the handler only logs
//! a failure: the result is the caller's.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use super::limits::{Admission, LimitStore, SqliteLimits};
use super::{SharedError, codes};
use crate::access::Caller;
use crate::workspace::Workspace;
use afd::{
    BoxFuture, CommandContext, CommandError, CommandMiddleware, CommandResult, MiddlewareNext,
    error_codes, failure,
};
use serde_json::{Value, json};

/// The window of `read_bytes_per_minute`.
const MINUTE_MS: i64 = 60_000;

/// The limit counters, and the key that names them.
type Opened = (Arc<dyn LimitStore>, Arc<Vec<u8>>);

/// The limit counters and the key that names them, opened on first use and kept; a failure to
/// open is not kept, so the next limited call tries again.
pub(crate) struct LazyLimits {
    workspace: Arc<Workspace>,
    opened: std::sync::Mutex<Option<Opened>>,
}

impl LazyLimits {
    pub(crate) fn new(workspace: Arc<Workspace>) -> Self {
        Self {
            workspace,
            opened: std::sync::Mutex::new(None),
        }
    }

    /// The store and the key, opening them when this is the first use. Blocks: call it off the
    /// async threads.
    fn get(&self) -> Result<Opened, SharedError> {
        let mut opened = self
            .opened
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some((store, key)) = opened.as_ref() {
            return Ok((Arc::clone(store), Arc::clone(key)));
        }
        let failed = |error: &dyn std::fmt::Display| SharedError::Failed {
            store: "limits",
            message: error.to_string(),
        };
        let key = Arc::new(
            self.workspace
                .limits_key()
                .map_err(|error| failed(&error))?,
        );
        let store: Arc<dyn LimitStore> = Arc::new(
            SqliteLimits::open(
                &self.workspace.layout().limits_store(),
                self.workspace.config().store.lock_timeout_ms,
            )
            .map_err(|error| failed(&error))?,
        );
        *opened = Some((Arc::clone(&store), Arc::clone(&key)));
        Ok((store, key))
    }
}

/// `WORKSPACE_SHARED_TIMEOUT` for `store` (section 10.5).
pub(crate) fn shared_timeout(store: &str) -> CommandError {
    CommandError::new(
        codes::WORKSPACE_SHARED_TIMEOUT,
        "The server's shared state is busy",
    )
    .with_suggestion("Retry in a moment; nothing ran.")
    .with_details(HashMap::from([("store".to_owned(), json!(store))]))
    .with_retryable(true)
}

/// A shared store failed: nothing ran, and the call may be retried.
pub(crate) fn store_failed() -> CommandError {
    CommandError::new(
        error_codes::INTERNAL_ERROR,
        "The server's shared state could not be used",
    )
    .with_suggestion("Retry later; nothing ran. The operator's log says what failed.")
    .with_retryable(true)
}

fn rate_limited(retry_after_ms: i64) -> CommandError {
    let seconds = retry_after_ms.saturating_add(999) / 1000;
    CommandError::new(
        error_codes::RATE_LIMITED,
        "Too much data was read in the last minute",
    )
    .with_suggestion(format!(
        "Retry after {} seconds, or read less at a time (a narrower query, a smaller limit).",
        seconds.max(1)
    ))
    .with_details(HashMap::from([(
        "retryAfterMs".to_owned(),
        json!(retry_after_ms),
    )]))
    .with_retryable(true)
}

/// The system clock in epoch milliseconds: limits never read a host's injected clock, which a
/// replay could freeze.
fn now_ms() -> i64 {
    super::nonces::now_ms()
}

/// The read limit over `store`.
pub(crate) fn read_limit(
    workspace: Arc<Workspace>,
    limits: Arc<LazyLimits>,
    per_minute: u64,
    lock_timeout: Duration,
) -> CommandMiddleware {
    Arc::new(
        move |_name: String,
              _input: Value,
              context: CommandContext,
              next: MiddlewareNext|
              -> BoxFuture<'static, CommandResult<Value>> {
            let caller = Caller::of(workspace.config(), &context);
            if !caller.gets_one_answer() {
                return next();
            }
            let principal = caller.principal().unwrap_or("-").to_owned();
            let limits = Arc::clone(&limits);
            Box::pin(async move {
                let checked = tokio::time::timeout(
                    lock_timeout.saturating_add(Duration::from_secs(1)),
                    tokio::task::spawn_blocking(move || {
                        let (store, key) = limits.get()?;
                        let name = super::keyed_name("read", &key, &[&principal]);
                        let admitted = store.bytes_admit(&name, per_minute, MINUTE_MS, now_ms())?;
                        Ok::<_, SharedError>((admitted, store, name))
                    }),
                )
                .await;
                let (store, name) = match checked {
                    Ok(Ok(Ok((Admission::Allowed, store, name)))) => (store, name),
                    Ok(Ok(Ok((Admission::Refused { retry_after_ms }, _, _)))) => {
                        return failure(rate_limited(retry_after_ms));
                    }
                    Ok(Ok(Err(SharedError::Timeout { store }))) => {
                        tracing::warn!(target: "umbel::shared", store, "a shared store was held past store.lock_timeout_ms; the call is refused");
                        return failure(shared_timeout(store));
                    }
                    Err(_) => {
                        tracing::warn!(target: "umbel::shared", "the read limit's check took past store.lock_timeout_ms; the call is refused");
                        return failure(shared_timeout("limits"));
                    }
                    Ok(Ok(Err(SharedError::Failed { store, message }))) => {
                        tracing::error!(target: "umbel::shared", store, %message, "a shared store failed; the call is refused");
                        return failure(store_failed());
                    }
                    Ok(Err(error)) => {
                        tracing::error!(target: "umbel::shared", %error, "the read limit's check did not finish; the call is refused");
                        return failure(store_failed());
                    }
                };
                let result = next().await;
                let bytes = serde_json::to_vec(&result).map_or(0, |bytes| bytes.len());
                let bytes = u64::try_from(bytes).unwrap_or(u64::MAX);
                let counted = tokio::task::spawn_blocking(move || {
                    store.bytes_add(&name, bytes, MINUTE_MS, now_ms())
                })
                .await;
                if !matches!(counted, Ok(Ok(()))) {
                    tracing::error!(target: "umbel::shared", "a call's result bytes could not be counted against read_bytes_per_minute");
                }
                result
            })
        },
    )
}

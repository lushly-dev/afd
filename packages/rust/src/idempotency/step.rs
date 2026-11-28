//! The engine's idempotency step (`spec/idempotency.md`, S1 to S13): answers a repeat of a call
//! to a `keyed` command from a store, between the approval admission check and the handler.
//!
//! [`CommandRegistry::execute`](crate::CommandRegistry::execute) asks the step at three points:
//! before input validation, whether it can tell the caller apart (S3); after the declared context
//! fields, the call's digest (S4); and in the innermost link, under the principal middleware
//! left, what to do for the call (S5) and, once the handler returns, how to settle (S6).
//!
//! The engine drops a call at its deadline (S7, `drops`): nothing settles the reservation then,
//! and it is live until its lease runs out and never settled after that.

use std::future::Future;
use std::panic::AssertUnwindSafe;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use futures_util::FutureExt;
use serde_json::{json, Map, Value};

use super::store::{
    IdempotencyRecord, IdempotencyRecordState, IdempotencyReservation, IdempotencyReserveOutcome,
    IdempotencySettlement, IdempotencyStore, InMemoryIdempotencyStore,
};
use super::{
    in_progress_error, internal_principal_error, key_reused_error, outcome_unknown_error,
    store_failed_error, unidentified_callers_error, IDEMPOTENT_REPLAY_KEY,
};
use crate::clock::{Clock, SYSTEM_CLOCK};
use crate::commands::CommandContext;
use crate::errors::{error_codes, CommandError};
use crate::result::{failure, CommandResult};

/// The default time the store remembers a key: one day (S8).
pub const DEFAULT_IDEMPOTENCY_TTL_MS: u64 = 86_400_000;
/// The default time a reservation stays live past the call's deadline (S7).
pub const DEFAULT_IDEMPOTENCY_LEASE_MS: u64 = 60_000;

/// The largest duration the step takes, `2^53 - 1` milliseconds, as JavaScript's safe integers.
const MAX_DURATION_MS: u64 = 9_007_199_254_740_991;

/// The idempotency step's options (`spec/idempotency.md`, S1 to S13), given to
/// [`CommandRegistry::set_idempotency`](crate::CommandRegistry::set_idempotency).
#[derive(Clone)]
pub struct IdempotencyOptions {
    store: Option<Arc<dyn IdempotencyStore>>,
    ttl_ms: u64,
    lease_ms: u64,
    clock: Option<Arc<dyn Clock>>,
    callers_identified_by_hook: bool,
}

impl std::fmt::Debug for IdempotencyOptions {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("IdempotencyOptions")
            .field("store", &self.store.as_ref().map(|_| ".."))
            .field("ttl_ms", &self.ttl_ms)
            .field("lease_ms", &self.lease_ms)
            .field("clock", &self.clock.as_ref().map(|_| ".."))
            .field(
                "callers_identified_by_hook",
                &self.callers_identified_by_hook,
            )
            .finish()
    }
}

impl Default for IdempotencyOptions {
    fn default() -> Self {
        Self::new()
    }
}

impl IdempotencyOptions {
    /// The defaults: an [`InMemoryIdempotencyStore`], a `ttl_ms` of one day, a `lease_ms` of 60
    /// seconds and [`SYSTEM_CLOCK`].
    pub fn new() -> Self {
        Self {
            store: None,
            ttl_ms: DEFAULT_IDEMPOTENCY_TTL_MS,
            lease_ms: DEFAULT_IDEMPOTENCY_LEASE_MS,
            clock: None,
            callers_identified_by_hook: false,
        }
    }

    /// Where keys and results are kept (S12). Default: an [`InMemoryIdempotencyStore`], for this
    /// process only, which a restart forgets (S13). A host with several processes behind one
    /// address gives them one shared store, or leaves the step off.
    pub fn with_store(mut self, store: Arc<dyn IdempotencyStore>) -> Self {
        self.store = Some(store);
        self
    }

    /// How long a stored result, or a reservation never settled, answers repeats, from the time
    /// the key was reserved (S8). Must be greater than the default deadline plus `lease_ms`.
    pub fn with_ttl_ms(mut self, ttl_ms: u64) -> Self {
        self.ttl_ms = ttl_ms;
        self
    }

    /// How long a reservation still unsettled stays live past the call's deadline, or past the
    /// reservation where the call has none (S7). A host whose handlers run longer than that
    /// without a deadline sets it to cover them.
    pub fn with_lease_ms(mut self, lease_ms: u64) -> Self {
        self.lease_ms = lease_ms;
        self
    }

    /// The step's clock: the server's or registry's own, never one a caller supplies (S8).
    /// Default [`SYSTEM_CLOCK`]. A call's [`CommandContext::with_clock`] does not reach it.
    pub fn with_clock(mut self, clock: Arc<dyn Clock>) -> Self {
        self.clock = Some(clock);
        self
    }

    /// Security declaration: the MCP server's context hook identifies every HTTP caller with a
    /// distinct actor, so the step may act on HTTP calls without `server-auth` credentials (S3),
    /// as [`TaskOptions`](crate::server::TaskOptions)' declaration of the same name does for
    /// tasks. Counted only while a context hook is installed.
    pub fn with_callers_identified_by_hook(mut self) -> Self {
        self.callers_identified_by_hook = true;
        self
    }

    /// The `ttl_ms` set.
    pub fn ttl_ms(&self) -> u64 {
        self.ttl_ms
    }

    /// The `lease_ms` set.
    pub fn lease_ms(&self) -> u64 {
        self.lease_ms
    }

    /// Whether [`Self::with_callers_identified_by_hook`] was declared.
    pub fn callers_identified_by_hook(&self) -> bool {
        self.callers_identified_by_hook
    }
}

/// Check S8 for `ttl_ms` and `lease_ms` against the deadline a call gets without its own
/// (`None`: none): both are positive integers of milliseconds no greater than `2^53 - 1`, and
/// `ttl_ms` is greater than the deadline plus `lease_ms`, or a key could become new while the
/// engine still waits for its first handler.
///
/// # Errors
/// A message naming the rule the configuration breaks.
pub fn check_idempotency_options(
    ttl_ms: u64,
    lease_ms: u64,
    default_timeout_ms: Option<u64>,
) -> Result<(), String> {
    for (name, value) in [("ttl_ms", ttl_ms), ("lease_ms", lease_ms)] {
        if !(1..=MAX_DURATION_MS).contains(&value) {
            return Err(format!(
                "idempotency {name} must be a positive integer of milliseconds no greater than 2^53 - 1"
            ));
        }
    }
    let deadline = default_timeout_ms.unwrap_or(0);
    if u128::from(ttl_ms) <= u128::from(deadline) + u128::from(lease_ms) {
        return Err(format!(
            "idempotency ttl_ms ({ttl_ms}) must be greater than the default deadline ({deadline}) plus lease_ms ({lease_ms}), or a key could become new while its first call still runs"
        ));
    }
    Ok(())
}

/// Who a transport says the caller is, for S3: set by the MCP server on each call.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(not(feature = "server"), allow(dead_code))]
pub(crate) enum IdempotencyCaller {
    /// An HTTP request: `identified` when the server can tell its callers apart.
    Http { identified: bool },
    /// A connection transport (stdio): a caller that, as middleware leaves it, has no identity of
    /// its own (see `anonymous`: no credentials, and no actor, a bare agent or the server's
    /// `default_actor`) is told apart by `connection` alone.
    Connection {
        connection: Arc<str>,
        default_actor: Option<crate::Actor>,
    },
}

/// The step, built once per registry and shared by its calls.
pub(crate) struct IdempotencyStep {
    store: Arc<dyn IdempotencyStore>,
    ttl_ms: i64,
    lease_ms: i64,
    clock: Arc<dyn Clock>,
    callers_identified_by_hook: bool,
}

impl IdempotencyStep {
    /// The step for `options`, checked against the deadline a call gets without its own (S8).
    pub(crate) fn new(
        options: IdempotencyOptions,
        default_timeout_ms: Option<u64>,
    ) -> Result<Self, String> {
        check_idempotency_options(options.ttl_ms, options.lease_ms, default_timeout_ms)?;
        Ok(Self {
            store: options
                .store
                .unwrap_or_else(|| Arc::new(InMemoryIdempotencyStore::new())),
            // Both fit: `check_idempotency_options` bounds them by 2^53 - 1.
            ttl_ms: i64::try_from(options.ttl_ms).unwrap_or(i64::MAX),
            lease_ms: i64::try_from(options.lease_ms).unwrap_or(i64::MAX),
            clock: options.clock.unwrap_or_else(|| Arc::new(SYSTEM_CLOCK)),
            callers_identified_by_hook: options.callers_identified_by_hook,
        })
    }

    /// See [`IdempotencyOptions::ttl_ms`].
    #[cfg_attr(not(feature = "server"), allow(dead_code))]
    pub(crate) fn ttl_ms(&self) -> u64 {
        self.ttl_ms.unsigned_abs()
    }

    /// See [`IdempotencyOptions::lease_ms`].
    #[cfg_attr(not(feature = "server"), allow(dead_code))]
    pub(crate) fn lease_ms(&self) -> u64 {
        self.lease_ms.unsigned_abs()
    }

    /// See [`IdempotencyOptions::callers_identified_by_hook`].
    #[cfg_attr(not(feature = "server"), allow(dead_code))]
    pub(crate) fn callers_identified_by_hook(&self) -> bool {
        self.callers_identified_by_hook
    }

    /// The step's clock, now.
    pub(crate) fn now(&self) -> i64 {
        self.clock.now()
    }

    /// The scope's principal part for the caller of `context` (S3, K5), or the refusal: S3's
    /// `UNAUTHORIZED` for an HTTP caller the server cannot tell apart, M8's internal error for
    /// credentials it cannot bind.
    pub(crate) fn principal(&self, context: &CommandContext) -> Result<String, Box<CommandError>> {
        match &context.server().idempotency_caller {
            Some(IdempotencyCaller::Http { identified: false }) => {
                Err(Box::new(unidentified_callers_error()))
            }
            // Decided from the context as middleware left it: an auth middleware may have set
            // the actor or credentials (K5).
            Some(IdempotencyCaller::Connection {
                connection,
                default_actor,
            }) if anonymous(context, default_actor.as_ref()) => Ok(crate::canonical::nearest(
                &json!({ "connection": &**connection }),
            )),
            _ => crate::principal_binding(context.actor.as_ref(), context.credentials.as_deref())
                .map_err(|_| Box::new(internal_principal_error())),
        }
    }
}

/// Whether a connection caller, as middleware left its context, has no identity of its own (S3):
/// no credentials, and no actor, the server's default actor or a bare agent. Compared as M8
/// binds an actor, so a label alone never makes one.
fn anonymous(context: &CommandContext, default_actor: Option<&crate::Actor>) -> bool {
    if context.credentials.is_some() {
        return false;
    }
    let Some(actor) = context.actor.as_ref() else {
        return true;
    };
    let bare_agent =
        actor.kind == crate::ActorKind::Agent && actor.id.is_none() && actor.on_behalf_of.is_none();
    let default = default_actor.is_some_and(|default| {
        actor.kind == default.kind
            && actor.id == default.id
            && actor.on_behalf_of == default.on_behalf_of
    });
    bare_agent || default
}

/// The digest of a call (S4): the unpadded base64url SHA-256 of the canonical JSON of
/// `{ "context": <fields>, "input": <input> }`, or `None` when the input has no canonical form.
pub(crate) fn call_digest(fields: Map<String, Value>, input: &Value) -> Option<String> {
    crate::canonical::input_digest(&json!({ "context": fields, "input": input })).ok()
}

/// What the engine leaves on a call's context for the innermost link: the registry's step, and
/// the call it acts on, when it does (S2).
pub(crate) struct StepCall {
    pub(crate) step: Arc<IdempotencyStep>,
    pub(crate) acting: Option<Acting>,
}

/// A call the step acts on, prepared before the middleware ran.
pub(crate) struct Acting {
    pub(crate) command: String,
    pub(crate) key: String,
    pub(crate) digest: String,
    /// When the call's chain, and its deadline, started, on the step's clock.
    pub(crate) started_at: i64,
    /// The call's deadline in milliseconds, as the engine enforces it, or `None`.
    pub(crate) timeout_ms: Option<u64>,
    /// Set once the step reserved the key, for R3's recovery on the engine's `TIMEOUT`.
    pub(crate) reserved: Arc<AtomicBool>,
}

impl std::fmt::Debug for StepCall {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StepCall")
            .field(
                "acting",
                &self.acting.as_ref().map(|acting| &acting.command),
            )
            .finish_non_exhaustive()
    }
}

/// `result` without a handler-supplied `metadata.idempotentReplay`, which is the engine's (S9).
pub(crate) fn without_replay_marker(mut result: CommandResult<Value>) -> CommandResult<Value> {
    if let Some(metadata) = result.metadata.as_mut() {
        metadata.extra.remove(IDEMPOTENT_REPLAY_KEY);
    }
    result
}

/// Run the innermost link's handler under the step (S1, S5, S6). Without `call` (no step on the
/// registry) the handler runs as it would without one; with a step that does not act on the
/// call, a handler's own `idempotentReplay` is still removed (S9).
///
/// `handler` is called at most once. A panic in it marks the reservation never settled, then
/// unwinds on, so the registry still answers `COMMAND_EXECUTION_ERROR`.
pub(crate) async fn run<F, Fut>(
    call: Option<Arc<StepCall>>,
    name: &str,
    context: CommandContext,
    handler: F,
) -> CommandResult<Value>
where
    F: FnOnce(CommandContext) -> Fut,
    Fut: Future<Output = CommandResult<Value>>,
{
    let Some(call) = call else {
        if context.is_cancelled() {
            return failure(crate::commands::command_cancelled_error(name));
        }
        return handler(context).await;
    };
    let step = &call.step;
    let Some(acting) = &call.acting else {
        if context.is_cancelled() {
            return failure(crate::commands::command_cancelled_error(name));
        }
        return without_replay_marker(handler(context).await);
    };
    // The scope of the principal as middleware left it (S3, K5): an auth middleware may have set
    // the actor. A caller refused before middleware ran never reaches here.
    let principal = match step.principal(&context) {
        Ok(principal) => principal,
        Err(error) => return failure(*error),
    };
    let scope = crate::canonical::nearest(&json!({
        "command": acting.command,
        "key": acting.key,
        "principal": principal,
    }));
    let now = step.now();
    let deadline = acting.timeout_ms.map(|timeout| {
        acting
            .started_at
            .saturating_add(i64::try_from(timeout).unwrap_or(i64::MAX))
    });
    let request = IdempotencyReservation {
        digest: acting.digest.clone(),
        reserved_at: now,
        expires_at: now.saturating_add(step.ttl_ms),
        lease_ends_at: deadline.unwrap_or(now).saturating_add(step.lease_ms),
    };
    let reservation = match step.store.reserve(&scope, request, now).await {
        Ok(IdempotencyReserveOutcome::Reserved(reservation)) => reservation,
        Ok(IdempotencyReserveOutcome::Held(record)) => {
            return answer_for(&record, &acting.digest, now)
        }
        Err(_) => return failure(store_failed_error()),
    };
    acting.reserved.store(true, Ordering::SeqCst);
    // The cancellation check again, now the key is held (S5): nothing ran, so nothing is kept.
    if context.is_cancelled() {
        let _ = step.store.release(&scope, &reservation).await;
        return failure(crate::commands::command_cancelled_error(name));
    }
    let outcome = AssertUnwindSafe(handler(context)).catch_unwind().await;
    let result = match outcome {
        Ok(result) => without_replay_marker(result),
        Err(panic) => {
            // A store that fails here leaves the reservation to its lease (S7): unknown then too.
            let _ = step
                .store
                .complete(&scope, &reservation, IdempotencySettlement::Unknown)
                .await;
            std::panic::resume_unwind(panic);
        }
    };
    let settled = match result.error.as_ref().filter(|_| !result.success) {
        // "May still have run" (`spec/error-codes.md`): nobody can say.
        Some(error) if error.code == error_codes::TIMEOUT => {
            step.store
                .complete(&scope, &reservation, IdempotencySettlement::Unknown)
                .await
        }
        // A keyed command that returns a retryable failure promises nothing was applied.
        Some(error) if error.retryable == Some(true) => {
            step.store.release(&scope, &reservation).await
        }
        _ => {
            step.store
                .complete(
                    &scope,
                    &reservation,
                    IdempotencySettlement::Result(Box::new(result.clone())),
                )
                .await
        }
    };
    // The handler's result stands: a store that failed to keep it leaves the reservation to its
    // lease (S7), after which a repeat is told the outcome is unknown.
    let _ = settled;
    result
}

/// The answer for a call whose scope `record` holds (S5).
fn answer_for(record: &IdempotencyRecord, digest: &str, now: i64) -> CommandResult<Value> {
    if record.digest != digest {
        return failure(key_reused_error());
    }
    match (record.state, &record.result) {
        (IdempotencyRecordState::Stored, Some(result)) => {
            let mut replay = result.clone();
            replay
                .metadata
                .get_or_insert_with(crate::ResultMetadata::new)
                .extra
                .insert(IDEMPOTENT_REPLAY_KEY.to_owned(), Value::Bool(true));
            replay
        }
        (IdempotencyRecordState::Reserved, _) if now <= record.lease_ends_at => {
            failure(in_progress_error())
        }
        _ => failure(outcome_unknown_error()),
    }
}

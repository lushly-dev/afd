//! Private approval-aware calls for in-process agents. The registry's `execute` remains a
//! trusted host API; never expose that API or its approval evidence directly to an agent.

use crate::commands::{BoxFuture, CommandContext, CommandRegistry};
use crate::{
    error_codes, failure, Actor, ActorKind, CommandError, CommandInterface, CommandResult,
};
use futures_util::FutureExt;
use serde_json::Value;
use std::panic::AssertUnwindSafe;
use std::sync::{Arc, Mutex, MutexGuard};

/// What a declined approval tells the caller, as the approval middleware words a decline.
const DECLINED_SUGGESTION: &str =
    "Do not run this again without asking the user first; the user chose not to approve it.";

/// Token-free decision metadata passed to the trusted application's approval hook.
#[derive(Clone, Debug)]
pub struct DirectApprovalRequest {
    /// Name of the held command.
    pub command: String,
    /// Validated input payload for the held command.
    pub input: Value,
    /// Human-readable summary of the action awaiting approval.
    pub summary: String,
    /// RFC 3339 timestamp when the approval request expires.
    pub expires_at: String,
    /// Optional reason why approval was requested.
    pub reason: Option<String>,
    /// The `approvalId` the approval summary of this call will carry once the hook approves it
    /// (`spec/command-metadata.md`, "The approval summary", rule 5): [`crate::approval_id`] of the
    /// held token's nonce. It names the approval without granting it, so keep it beside the
    /// person who decides.
    pub approval_id: String,
}

/// Only `Ok(true)` permits one retry. Errors and panics leave the original hold in place.
pub type DirectApprovalHook =
    Arc<dyn Fn(DirectApprovalRequest) -> BoxFuture<'static, Result<bool, String>> + Send + Sync>;

#[derive(Clone)]
pub(crate) struct Hold {
    pub token: String,
    pub summary: String,
    pub expires_at: String,
    pub reason: Option<String>,
    pub approval_id: String,
}

#[derive(Default)]
pub(crate) struct Exchange {
    disposed: bool,
    hold: Option<Hold>,
    evidence: Option<String>,
}

impl Exchange {
    #[cfg(feature = "approval")]
    pub(crate) fn hold(&mut self, hold: Hold) {
        if !self.disposed {
            self.hold = Some(hold);
        }
    }

    #[cfg(feature = "approval")]
    pub(crate) fn take(&mut self) -> Option<String> {
        if self.disposed {
            None
        } else {
            self.evidence.take()
        }
    }
}

pub(crate) fn locked<T>(state: &Mutex<T>) -> MutexGuard<'_, T> {
    state
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

struct Dispose(Arc<Mutex<Exchange>>);
impl Drop for Dispose {
    fn drop(&mut self) {
        let mut state = locked(&self.0);
        state.disposed = true;
        state.hold = None;
        state.evidence = None;
    }
}

fn public_result(mut result: CommandResult<Value>) -> CommandResult<Value> {
    if let Some(error) = &mut result.error {
        if error.code == error_codes::APPROVAL_REQUIRED {
            if let Some(details) = &mut error.details {
                details.remove("approvalToken");
            }
        }
    }
    result
}

/// Agent-facing calls over a validating registry, with a private per-call approval exchange.
///
/// The configured hook is trusted host code. Caller contexts, JSON inputs and returned holds
/// cannot authorize execution. A deadline covers the initial call, human wait and single retry;
/// dropping the call future cancels that flow. No CLI or remote approval relay is provided.
pub struct DirectClient {
    registry: Arc<CommandRegistry>,
    on_approval_needed: Option<DirectApprovalHook>,
    interface: CommandInterface,
}

impl DirectClient {
    /// Create a direct client backed by `registry` using [`CommandInterface::Agent`].
    pub fn new(registry: Arc<CommandRegistry>) -> Self {
        Self {
            registry,
            on_approval_needed: None,
            interface: CommandInterface::Agent,
        }
    }

    /// The interface every call runs as. Default: `CommandInterface::Agent`.
    ///
    /// The interface decides which commands a call may run and which an unknown name's
    /// suggestions list, as `expose` declares them (`CommandInterface::Cli` runs a CLI-only
    /// command that an agent cannot reach). The caller's context cannot override it. The
    /// approval exchange is the same on every interface.
    pub fn with_interface(mut self, interface: CommandInterface) -> Self {
        self.interface = interface;
        self
    }

    /// Install a trusted host hook to decide held approval requests.
    pub fn with_on_approval_needed(mut self, hook: DirectApprovalHook) -> Self {
        self.on_approval_needed = Some(hook);
        self
    }

    /// Execute `name` with `input` and an optional caller context.
    pub async fn call(
        &self,
        name: &str,
        input: Value,
        context: Option<CommandContext>,
    ) -> CommandResult<Value> {
        let mut context = context.unwrap_or_default();
        // `0` means no deadline, as `CommandRegistry::execute` reads it.
        let timeout = context.timeout_ms.filter(|&ms| ms > 0);
        if timeout.is_some() && !cfg!(feature = "native") {
            return failure(
                CommandError::new(
                    error_codes::UNSUPPORTED_OPTION,
                    "Command timeouts require the native feature",
                )
                .with_suggestion("Enable the native feature or omit timeout_ms from the context")
                .with_retryable(false),
            );
        }
        let state = Arc::new(Mutex::new(Exchange::default()));
        let _dispose = Dispose(Arc::clone(&state));
        context.approval = None;
        context.direct_approval = Some(Arc::clone(&state));
        context.interface = Some(self.interface);
        context
            .actor
            .get_or_insert_with(|| Actor::new(ActorKind::Human));
        // The outer deadline owns both attempts and the decision, rather than restarting it. It
        // fires a child of the caller's signal, which the command sees, so work it spawned and a
        // loop that does not await stop at the deadline; the caller's own signal is not fired.
        if context.timeout_ms.is_some() {
            // The caller chose the deadline (or none): the registry's default does not apply.
            context.timeout_ms = None;
            context.default_timeout_override = Some(None);
        }
        let deadline_signal = timeout.map(|_| {
            let signal = context.cancellation().map_or_else(
                crate::cancellation::CancellationSignal::new,
                crate::cancellation::CancellationSignal::child,
            );
            context = std::mem::take(&mut context).with_cancellation(signal.clone());
            signal
        });
        #[cfg(feature = "native")]
        let started = tokio::time::Instant::now();
        let expired = || {
            #[cfg(feature = "native")]
            {
                timeout.is_some_and(|ms| {
                    started.elapsed() >= std::time::Duration::from_millis(ms.min(2_147_483_647))
                })
            }
            #[cfg(not(feature = "native"))]
            {
                false
            }
        };
        let timed_out = || {
            if let Some(signal) = &deadline_signal {
                signal.cancel();
            }
            failure(CommandError::timeout(name, timeout.unwrap_or_default()))
        };
        let run = async {
            let result = public_result(
                self.registry
                    .execute(name, input.clone(), Some(context.clone()))
                    .await,
            );
            if expired() {
                return timed_out();
            }
            let pending = locked(&state).hold.clone();
            let held = !result.success
                && result
                    .error
                    .as_ref()
                    .is_some_and(|e| e.code == error_codes::APPROVAL_REQUIRED);
            if let (true, Some(pending), Some(hook)) = (held, pending, &self.on_approval_needed) {
                let request = DirectApprovalRequest {
                    command: name.to_owned(),
                    input: input.clone(),
                    summary: pending.summary,
                    expires_at: pending.expires_at,
                    reason: pending.reason,
                    approval_id: pending.approval_id,
                };
                let asked = AssertUnwindSafe(async { hook(request).await }).catch_unwind();
                // A cancelled call stops waiting for the person, as TypeScript's does.
                let answer = match context.cancellation().cloned() {
                    Some(signal) => {
                        let cancelled = signal.cancelled();
                        futures_util::pin_mut!(asked, cancelled);
                        match futures_util::future::select(asked, cancelled).await {
                            futures_util::future::Either::Left((answer, _)) => answer,
                            futures_util::future::Either::Right(_) => {
                                return if expired() {
                                    timed_out()
                                } else {
                                    failure(crate::commands::command_cancelled_error(name))
                                };
                            }
                        }
                    }
                    None => asked.await,
                };
                if expired() {
                    return timed_out();
                }
                if matches!(answer, Ok(Ok(true))) {
                    {
                        let mut exchange = locked(&state);
                        exchange.evidence = Some(pending.token);
                        exchange.hold = None;
                    }
                    let result =
                        public_result(self.registry.execute(name, input, Some(context)).await);
                    return if expired() { timed_out() } else { result };
                }
                // The host's hook declined: no step makes this call succeed
                // (`spec/recovery.md`, "Engine errors"). An error or panic keeps the hold as it is.
                if matches!(answer, Ok(Ok(false))) {
                    let mut result = result;
                    if let Some(error) = result.error.as_mut() {
                        // The prose says the same as the recovery (rule 1).
                        error.suggestion = Some(DECLINED_SUGGESTION.to_owned());
                        error.recovery = Some(Box::new(crate::Recovery::stop()));
                    }
                    return result;
                }
            }
            result
        };
        #[cfg(feature = "native")]
        if let Some(timeout) = timeout {
            return tokio::time::timeout(
                std::time::Duration::from_millis(timeout.min(2_147_483_647)),
                run,
            )
            .await
            .unwrap_or_else(|_| timed_out());
        }
        run.await
    }
}

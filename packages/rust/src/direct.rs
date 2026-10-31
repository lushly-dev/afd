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

/// Token-free decision metadata passed to the trusted application's approval hook.
#[derive(Clone, Debug)]
pub struct DirectApprovalRequest {
    pub command: String,
    pub input: Value,
    pub summary: String,
    pub expires_at: String,
    pub reason: Option<String>,
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
}

impl DirectClient {
    pub fn new(registry: Arc<CommandRegistry>) -> Self {
        Self {
            registry,
            on_approval_needed: None,
        }
    }

    pub fn with_on_approval_needed(mut self, hook: DirectApprovalHook) -> Self {
        self.on_approval_needed = Some(hook);
        self
    }

    pub async fn call(
        &self,
        name: &str,
        input: Value,
        context: Option<CommandContext>,
    ) -> CommandResult<Value> {
        let mut context = context.unwrap_or_default();
        let timeout = context.timeout_ms;
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
        context.interface = Some(CommandInterface::Agent);
        context
            .actor
            .get_or_insert_with(|| Actor::new(ActorKind::Human));
        // The outer deadline owns both attempts and the decision, rather than restarting it.
        context.timeout_ms = None;
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
        let timed_out = || failure(CommandError::timeout(name, timeout.unwrap_or_default()));
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
                };
                let answer = AssertUnwindSafe(async { hook(request).await })
                    .catch_unwind()
                    .await;
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
            .unwrap_or_else(|_| failure(CommandError::timeout(name, timeout)));
        }
        run.await
    }
}

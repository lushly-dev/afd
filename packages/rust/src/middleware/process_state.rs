//! Per-process state marked on approval middleware and carried through
//! [`compose_middleware`](super::compose_middleware).
//!
//! Mirrors TypeScript's `approval-process-state.ts` without changing the public
//! [`CommandMiddleware`] type alias: entries are keyed by [`Weak`] pointers and
//! matched with [`Weak::ptr_eq`], pruning dropped middleware on write so the table
//! never grows unbounded.

use std::sync::{Arc, Mutex, PoisonError, Weak};

use crate::commands::{BoxFuture, CommandContext, CommandMiddleware, MiddlewareNext};
use crate::result::CommandResult;

type MiddlewareDyn = dyn Fn(
        String,
        Arc<serde_json::Value>,
        CommandContext,
        MiddlewareNext,
    ) -> BoxFuture<'static, CommandResult<serde_json::Value>>
    + Send
    + Sync;

/// Whether an approval middleware asks over MCP (so the server's confirmation key signs its
/// `requestState`), and whether its nonce store lives only in this process's memory.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) struct ApprovalProcessState {
    /// `relay == ApprovalRelay::McpElicitation`.
    pub(crate) relay: bool,
    /// `replay == ApprovalReplay::SingleUse` with no shared `nonce_store`.
    pub(crate) per_process_nonces: bool,
    /// No shared `nonce_store` at all (matters when `HumanRelay` spends `relay:<decisionId>`
    /// regardless of `ApprovalReplay`).
    pub(crate) per_process_relay_nonces: bool,
}

impl ApprovalProcessState {
    /// Combine another middleware's per-process state into this aggregated summary.
    pub(crate) fn merge(&mut self, other: Self) {
        self.relay |= other.relay;
        self.per_process_nonces |= other.per_process_nonces;
        self.per_process_relay_nonces |= other.per_process_relay_nonces;
    }
}

static STATES: Mutex<Vec<(Weak<MiddlewareDyn>, ApprovalProcessState)>> = Mutex::new(Vec::new());

/// Record `state` for `middleware`.
#[cfg_attr(not(feature = "approval"), allow(dead_code))]
pub(crate) fn mark_approval_process_state(
    middleware: &CommandMiddleware,
    state: ApprovalProcessState,
) {
    let mut table = STATES.lock().unwrap_or_else(PoisonError::into_inner);
    table.retain(|(weak, _)| weak.strong_count() > 0);
    table.push((Arc::downgrade(middleware), state));
}

/// Read the [`ApprovalProcessState`] recorded for `middleware`, if any.
///
/// Compares weak pointers without upgrading other entries under the mutex, so dropping another
/// middleware's last strong `Arc` can never run inside the lock.
pub(crate) fn approval_process_state(
    middleware: &CommandMiddleware,
) -> Option<ApprovalProcessState> {
    let target = Arc::downgrade(middleware);
    let table = STATES.lock().unwrap_or_else(PoisonError::into_inner);
    table
        .iter()
        .find_map(|(weak, state)| Weak::ptr_eq(weak, &target).then_some(*state))
}

/// Propagate any part's [`ApprovalProcessState`] onto `composed`.
pub(crate) fn carry_approval_process_state(
    composed: &CommandMiddleware,
    parts: &[CommandMiddleware],
) {
    let mut any = false;
    let mut combined = ApprovalProcessState::default();
    for part in parts {
        if let Some(state) = approval_process_state(part) {
            any = true;
            combined.merge(state);
        }
    }
    if any {
        mark_approval_process_state(composed, combined);
    }
}

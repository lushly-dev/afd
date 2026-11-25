//! Per-process approval and elicitation state checks (`ServerInstances`).
//!
//! Mirrors TypeScript's `packages/server/src/instance-state.ts`:
//!
//! - An MCP server's elicitation `requestState` key (`with_confirmations_key` /
//!   `with_confirmation_key`, else a random per-process key) and each approval middleware's
//!   spent-nonce store (`ApprovalMiddlewareOptions::with_nonce_store`, else in-process memory)
//!   hold only within one process.
//! - With [`ServerInstances::Multiple`], [`McpServer::validate`](super::McpServer::validate)
//!   returns `Err` when any active per-process default would be relied on.
//! - When omitted, serving over HTTP logs one warning per process to stderr when a per-process
//!   default is in use. [`ServerInstances::Single`] silences that warning; stdio logs nothing.

use std::sync::atomic::{AtomicBool, Ordering};

use crate::middleware::process_state::ApprovalProcessState;

use super::ConfirmationMode;

/// How many processes serve this server's URL.
///
/// Two things are per process unless the host shares them: the confirmation key (a random key
/// otherwise), used when confirmations are on or an approval middleware has
/// `ApprovalRelay::McpElicitation`; and the spent single-use tokens (or `HumanRelay` decisions)
/// of each approval middleware without a shared `ApprovalNonceStore`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServerInstances {
    /// One process serves every request, so the per-process defaults are enough. Silences the
    /// one-time HTTP warning.
    Single,
    /// Several processes serve one URL (for example behind a load balancer). Starting the server
    /// returns an error unless every active per-process default is replaced by a shared key or
    /// store.
    Multiple,
}

/// Validate `instances` against active per-process defaults and return the optional HTTP warning.
pub(crate) fn check_instance_state(
    name: &str,
    instances: Option<ServerInstances>,
    confirmation_mode: ConfirmationMode,
    has_shared_confirmation_key: bool,
    has_human_relay: bool,
    approvals: ApprovalProcessState,
) -> Result<Option<String>, String> {
    let elicits = confirmation_mode != ConfirmationMode::Off || approvals.relay;
    let per_process_nonces =
        approvals.per_process_nonces || (has_human_relay && approvals.per_process_relay_nonces);

    let mut missing: Vec<&'static str> = Vec::new();
    if elicits && !has_shared_confirmation_key {
        missing.push(
            "confirmation key (each process signs elicitation requestState with its own random key, so an answer must reach the process that asked)",
        );
    }
    if per_process_nonces {
        missing.push(if approvals.per_process_nonces {
            "the approval middleware's nonce_store (spent single-use tokens are kept in this process's memory, so a token works once on each process)"
        } else {
            "the approval middleware's nonce_store (spent HumanRelay decisions are kept in this process's memory, so a decision can be replayed once on each process)"
        });
    }

    if missing.is_empty() {
        return Ok(None);
    }

    let joined = missing.join(" and ");
    if instances == Some(ServerInstances::Multiple) {
        return Err(format!(
            "[AFD] {name}: ServerInstances::Multiple needs {joined}. Pass the same confirmation key (at least 32 bytes) to every instance with with_confirmations_key or with_confirmation_key, and give ApprovalMiddlewareOptions::with_nonce_store a store every instance shares."
        ));
    }

    Ok(match instances {
        Some(ServerInstances::Single) => None,
        None => Some(format!(
            "[{name}] warning: one process must serve every request: this server has no {joined}. Behind several processes, share them and set with_instances(ServerInstances::Multiple); with one process, set with_instances(ServerInstances::Single) to silence this."
        )),
        Some(ServerInstances::Multiple) => unreachable!(),
    })
}

static WARNED: AtomicBool = AtomicBool::new(false);

/// Log `message` to stderr once per process across all HTTP servers in this process.
pub(crate) fn warn_instances_once(message: Option<&str>) {
    warn_instances_once_with(message, |line| eprintln!("{line}"));
}

pub(crate) fn warn_instances_once_with(message: Option<&str>, log: impl FnOnce(&str)) {
    let Some(message) = message else {
        return;
    };
    if WARNED
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_ok()
    {
        log(message);
    }
}

#[cfg(test)]
pub(crate) fn reset_instances_warning_for_tests() {
    WARNED.store(false, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    // Serialize unit tests that touch the process-wide WARNED atomic.
    static TEST_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn http_warning_formats_both_defaults_and_fires_once_per_process() {
        let _guard = TEST_LOCK.lock().unwrap();
        reset_instances_warning_for_tests();

        let state = ApprovalProcessState {
            relay: false,
            per_process_nonces: true,
            per_process_relay_nonces: true,
        };
        let warning =
            check_instance_state("todo", None, ConfirmationMode::Enforce, false, false, state)
                .unwrap()
                .expect("should produce warning");
        assert!(warning.contains("[todo] warning: one process must serve every request"));
        assert!(warning.contains("confirmation key"));
        assert!(warning.contains("the approval middleware's nonce_store"));

        // Single silences warning and does not consume the once flag.
        assert!(check_instance_state(
            "todo",
            Some(ServerInstances::Single),
            ConfirmationMode::Enforce,
            false,
            false,
            state,
        )
        .unwrap()
        .is_none());

        let mut logged = Vec::new();
        warn_instances_once_with(None, |line| logged.push(line.to_owned()));
        assert!(logged.is_empty());

        warn_instances_once_with(Some(&warning), |line| logged.push(line.to_owned()));
        warn_instances_once_with(Some(&warning), |line| logged.push(line.to_owned()));
        assert_eq!(logged.len(), 1);
    }

    #[test]
    fn human_relay_within_ttl_warning_mentions_relay_decisions() {
        let state = ApprovalProcessState {
            relay: false,
            per_process_nonces: false,
            per_process_relay_nonces: true,
        };
        let err = check_instance_state(
            "todo",
            Some(ServerInstances::Multiple),
            ConfirmationMode::Off,
            false,
            true,
            state,
        )
        .unwrap_err();
        assert!(err.contains("spent HumanRelay decisions"));
    }
}

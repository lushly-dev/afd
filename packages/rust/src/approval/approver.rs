//! An approver client's call (`spec/command-metadata.md`, "Approval evidence from an approver
//! client"): only the MCP server marks one, on the context of a call whose caller its
//! [`with_approver`](crate::server::McpServer::with_approver) predicate names. The approval
//! middleware then includes the token in every held result, never asks with a form, verifies
//! every token against the call's principal binding (M8), and takes the evidence of
//! `_meta["dev.afd/approval"]` once.

use std::sync::{Mutex, PoisonError};

/// One approver's call: the evidence it carried, until the first approval check takes it.
#[derive(Default)]
pub(crate) struct ApproverCall {
    evidence: Mutex<Option<String>>,
}

impl ApproverCall {
    /// A call that carried `evidence` in `_meta["dev.afd/approval"]`, or none.
    pub(crate) fn new(evidence: Option<String>) -> Self {
        Self {
            evidence: Mutex::new(evidence),
        }
    }

    /// Take the carried evidence, once: the command the call routes to is the first checked, so
    /// a command its handler runs in process never sees it.
    #[cfg_attr(not(feature = "approval"), allow(dead_code))]
    pub(crate) fn take(&self) -> Option<String> {
        self.evidence
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take()
    }
}

impl std::fmt::Debug for ApproverCall {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Evidence is a credential: never print it.
        f.write_str("ApproverCall([redacted])")
    }
}

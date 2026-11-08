//! What the MCP server hands the approval middleware through a call's context: relay evidence
//! from a [`HumanRelay`](crate::server::HumanRelay) decision, and the form-mode approval relay's
//! channel (`spec/command-metadata.md`, "Relay evidence" and "Asking the human over MCP").
//!
//! Both live in crate-private context fields, as the private in-process exchange (#460) does: no
//! public API sets them, nothing reads them from tool arguments, `_meta`, a header or a
//! `requestState`, and they are never serialized.
//!
//! The server writes them and the approval middleware reads them, so only with both features does
//! every item have a user.
#![cfg_attr(not(all(feature = "server", feature = "approval")), allow(dead_code))]

use std::fmt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};

use serde::{Deserialize, Serialize};

/// The input key of the form-mode approval elicitation.
pub(crate) const APPROVAL_INPUT_KEY: &str = "approval";

/// How long a relay decision lives at most, and so how long its spent `relay:<decisionId>` key is
/// kept (`spec/command-metadata.md`, "Relay evidence", rule 4).
pub(crate) const RELAY_DECISION_TTL_MS: i64 = 24 * 60 * 60_000;

/// Relay evidence: set by the server only after the host's relay returned `Approved` for this
/// call, so one decision covers the confirmation and the approval.
#[derive(Clone)]
pub(crate) struct RelayEvidence {
    /// The command's name.
    pub(crate) command: String,
    /// The digest the relay was given ([`crate::input_digest`] of the validated input).
    pub(crate) input_digest: String,
    /// The actor JSON approval tokens bind, or `null`.
    pub(crate) actor: String,
    /// [`crate::credentials_binding`] of the call's credentials.
    pub(crate) credentials_binding: String,
    /// The relay's decision id.
    pub(crate) decision_id: String,
}

impl fmt::Debug for RelayEvidence {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // The actor and credentials bindings name the caller: never print them.
        f.debug_struct("RelayEvidence")
            .field("command", &self.command)
            .finish_non_exhaustive()
    }
}

/// One question a form elicitation asked, as the signed `requestState` carries it: its input key
/// (`k`), its binding (`b`), the deadline of its answer (`t`, epoch milliseconds, kept when it is
/// carried to a later round) and, for an approval, its nonce (`n`), expiry (`x`) and the MAC of
/// both under the approval secret (`m`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Asked {
    pub(crate) k: String,
    pub(crate) b: String,
    pub(crate) t: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) n: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) x: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) m: Option<String>,
}

/// The answers one request carries: the questions accepted (in earlier rounds, then in this one)
/// and those declined in this one.
#[derive(Debug, Clone, Default)]
pub(crate) struct RoundAnswers {
    pub(crate) accepted: Vec<Asked>,
    pub(crate) declined: Vec<Asked>,
}

/// A call held for the human's approval, recorded by the middleware for the server to ask.
#[derive(Debug, Clone)]
pub(crate) struct ApprovalHold {
    /// The keyed digest of the command, its validated input and the actor, under the signing key.
    pub(crate) binding: String,
    /// The same digest under every verification key: earlier answers to any of them are dropped.
    pub(crate) bindings: Vec<String>,
    pub(crate) nonce: String,
    /// The approval's expiry, epoch milliseconds on the middleware's clock.
    pub(crate) expires_at: i64,
    pub(crate) mac: String,
    /// The question shown to the human.
    pub(crate) message: String,
}

/// The human's answer to an earlier approval elicitation for one binding.
pub(crate) enum RelayAnswer {
    Accept {
        binding: String,
        nonce: String,
        expires_at: i64,
        mac: String,
    },
    Decline,
    Missing,
}

/// Reads the answers a request carries, once; `None` when the call's principal cannot be bound
/// (`spec/authorization.md`, M8), so no state may be read or minted for it.
pub(crate) type ReadAnswers = Box<dyn Fn() -> Option<Arc<RoundAnswers>> + Send + Sync>;

/// What one MCP `tools/call` offers the approval middleware: the routed command may claim it once,
/// read the human's answer from it, or record a hold the server then asks about.
pub(crate) struct ApprovalRelayChannel {
    /// The one command the tool call routes to; `None` for a channel that never asks (the steps
    /// of `afd-batch` and `afd-pipe`).
    routed: Option<String>,
    claimed: AtomicBool,
    answers: ReadAnswers,
    held: Mutex<Option<ApprovalHold>>,
    unbindable: AtomicBool,
}

impl ApprovalRelayChannel {
    /// A channel the command `routed` may claim, reading the request's answers with `answers`.
    pub(crate) fn asking(routed: impl Into<String>, answers: ReadAnswers) -> Self {
        Self {
            routed: Some(routed.into()),
            claimed: AtomicBool::new(false),
            answers,
            held: Mutex::new(None),
            unbindable: AtomicBool::new(false),
        }
    }

    /// A channel nothing can claim: the middleware then tells the agent to call the command on its
    /// own, so that the client can be asked.
    pub(crate) fn never_asks() -> Self {
        Self {
            routed: None,
            claimed: AtomicBool::new(false),
            answers: Box::new(|| Some(Arc::new(RoundAnswers::default()))),
            held: Mutex::new(None),
            unbindable: AtomicBool::new(false),
        }
    }

    /// Take the channel for `command`: only the routed command, and only once, so a command run by
    /// another command's handler (or a later step) cannot turn the tool call into an elicitation.
    pub(crate) fn claim(&self, command: &str) -> bool {
        self.routed.as_deref() == Some(command)
            && self
                .claimed
                .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok()
    }

    /// The answer this request carries for any of `bindings` (one per verification key): a decline
    /// wins, else the latest acceptance carrying a nonce, expiry and MAC, else `Missing`.
    pub(crate) fn answer(&self, bindings: &[String]) -> RelayAnswer {
        let Some(answers) = (self.answers)() else {
            self.unbindable.store(true, Ordering::SeqCst);
            return RelayAnswer::Missing;
        };
        let asks = |item: &&Asked| item.k == APPROVAL_INPUT_KEY && bindings.contains(&item.b);
        if answers.declined.iter().any(|item| asks(&item)) {
            return RelayAnswer::Decline;
        }
        match answers.accepted.iter().rev().find(asks) {
            Some(Asked {
                b,
                n: Some(nonce),
                x: Some(expires_at),
                m: Some(mac),
                ..
            }) => RelayAnswer::Accept {
                binding: b.clone(),
                nonce: nonce.clone(),
                expires_at: *expires_at,
                mac: mac.clone(),
            },
            _ => RelayAnswer::Missing,
        }
    }

    /// Record that the call needs the human's approval; the first hold wins.
    pub(crate) fn hold(&self, hold: ApprovalHold) {
        let mut held = self.held.lock().unwrap_or_else(PoisonError::into_inner);
        if held.is_none() {
            *held = Some(hold);
        }
    }

    /// The hold the middleware recorded, if any.
    pub(crate) fn held(&self) -> Option<ApprovalHold> {
        self.held
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    /// Whether the middleware read answers for a call whose principal cannot be bound: the server
    /// then answers with an internal error instead of the held result.
    pub(crate) fn unbindable(&self) -> bool {
        self.unbindable.load(Ordering::SeqCst)
    }
}

impl fmt::Debug for ApprovalRelayChannel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ApprovalRelayChannel")
            .field("routed", &self.routed)
            .finish_non_exhaustive()
    }
}

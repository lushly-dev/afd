//! What the MCP server hands the approval middleware through a call's context: relay evidence
//! from a [`HumanRelay`](crate::server::HumanRelay) decision, the form-mode approval relay's
//! channel, and the up-front approval of an `afd-batch` or `afd-pipe` (#459)
//! (`spec/command-metadata.md`, "Relay evidence" and "Asking the human over MCP").
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
use serde_json::Value;

use crate::CommandError;

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

/// One approval asked of the human: a command, its validated input and the actor.
#[derive(Debug, Clone)]
pub(crate) struct ApprovalQuestion {
    /// The keyed digest of the command, its validated input and the actor, under the signing key.
    pub(crate) binding: String,
    /// The same digest under every verification key: earlier answers to any of them are dropped.
    pub(crate) bindings: Vec<String>,
    pub(crate) nonce: String,
    /// The approval's expiry, epoch milliseconds on the middleware's clock.
    pub(crate) expires_at: i64,
    pub(crate) mac: String,
}

impl ApprovalQuestion {
    /// The question as the signed `requestState` carries it, its answer due at `deadline`.
    pub(crate) fn asked(&self, deadline: i64) -> Asked {
        Asked {
            k: APPROVAL_INPUT_KEY.to_owned(),
            b: self.binding.clone(),
            t: deadline,
            n: Some(self.nonce.clone()),
            x: Some(self.expires_at),
            m: Some(self.mac.clone()),
        }
    }
}

/// A call held for the human's approval, recorded by the middleware for the server to ask: one
/// command's question, or every gated step's of an `afd-batch` or `afd-pipe`, all answered by
/// one form.
#[derive(Debug, Clone)]
pub(crate) struct ApprovalHold {
    pub(crate) questions: Vec<ApprovalQuestion>,
    /// The question shown to the human.
    pub(crate) message: String,
}

impl ApprovalHold {
    /// Every binding of every question, under every key: earlier answers to them are dropped.
    pub(crate) fn bindings(&self) -> Vec<String> {
        self.questions
            .iter()
            .flat_map(|question| question.bindings.iter().cloned())
            .collect()
    }
}

/// An accepted approval as the request carries it.
#[derive(Debug, Clone)]
pub(crate) struct AcceptedApproval {
    pub(crate) binding: String,
    pub(crate) nonce: String,
    pub(crate) expires_at: i64,
    pub(crate) mac: String,
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
        Self::up_front(Box::new(|| Some(Arc::new(RoundAnswers::default()))))
    }

    /// The channel of an up-front approval: no single command can claim it, but the middleware
    /// reads the request's answers from it and records one hold for every gated step.
    pub(crate) fn up_front(answers: ReadAnswers) -> Self {
        Self {
            routed: None,
            claimed: AtomicBool::new(false),
            answers,
            held: Mutex::new(None),
            unbindable: AtomicBool::new(false),
        }
    }

    /// Every approval answer this request carries: the acceptances (each with its nonce, expiry
    /// and MAC), then the bindings declined. `None` when the call's principal cannot be bound.
    pub(crate) fn all_answers(&self) -> Option<(Vec<AcceptedApproval>, Vec<String>)> {
        let Some(answers) = (self.answers)() else {
            self.unbindable.store(true, Ordering::SeqCst);
            return None;
        };
        let accepted = answers
            .accepted
            .iter()
            .filter(|item| item.k == APPROVAL_INPUT_KEY)
            .filter_map(|item| match item {
                Asked {
                    b,
                    n: Some(nonce),
                    x: Some(expires_at),
                    m: Some(mac),
                    ..
                } => Some(AcceptedApproval {
                    binding: b.clone(),
                    nonce: nonce.clone(),
                    expires_at: *expires_at,
                    mac: mac.clone(),
                }),
                _ => None,
            })
            .collect();
        let declined = answers
            .declined
            .iter()
            .filter(|item| item.k == APPROVAL_INPUT_KEY)
            .map(|item| item.b.clone())
            .collect();
        Some((accepted, declined))
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

/// One step of an `afd-batch` or `afd-pipe`, as its up-front approval sees it.
#[derive(Debug, Clone)]
pub(crate) struct UpFrontStep {
    /// The step's position in the request, 0-based as in its results.
    pub(crate) index: usize,
    pub(crate) command: String,
    /// Whether the step's input reads an earlier step's data (`$prev`, `$first`, `$steps`), so
    /// it is not known until the pipeline runs.
    pub(crate) dynamic: bool,
    /// The validated input of a step that is not dynamic; `None` when it does not validate.
    pub(crate) input: Option<Value>,
    /// The input as sent (after `$input` references are resolved): how the registry finds the
    /// step it is about to run. `None` for a step that never runs on [`UpFrontStep::input`].
    pub(crate) sent: Option<Value>,
    /// The approval policy of the command, as the server registered it: the approval middleware
    /// decides each step from it (#1886). `None` for a command the caller cannot run.
    pub(crate) approval: Option<crate::approval::ApprovalPolicy>,
    /// The command's confirmation prompt, the default summary of its step.
    pub(crate) confirm_prompt: Option<String>,
}

/// An approval the human gave up front, taken once by a step bound to it.
#[derive(Debug)]
pub(crate) struct Approved {
    pub(crate) binding: String,
    /// The accepted hold's nonce and expiry, for the step's approval summary.
    pub(crate) nonce: String,
    pub(crate) expires_at: i64,
    pub(crate) used: bool,
}

/// What the approval middleware decided for an up-front call, before any step ran.
#[derive(Debug)]
pub(crate) enum UpFrontPlan {
    /// Every step runs; each gated one takes one unused approval of its own binding.
    Run(Mutex<Vec<Approved>>),
    /// Nothing runs: a gated step's input is not known up front, a decline, or a question.
    Refuse(CommandError),
}

/// The up-front approval of one `afd-batch` or `afd-pipe` call that can carry a form elicitation
/// (#459): every step runs, each gated step on its own single-use approval, or none does.
pub(crate) struct UpFrontApproval {
    /// `afd-batch` or `afd-pipe`.
    pub(crate) tool: &'static str,
    /// The whole request as sent (its steps or commands, inputs, conditions and options), as
    /// canonical JSON: every approval is bound to it, so it covers this call and no other.
    pub(crate) call: String,
    /// Whether a step runs only under a condition (`when`), so one may run while another is
    /// skipped.
    pub(crate) conditional: bool,
    pub(crate) steps: Vec<UpFrontStep>,
    /// Reads the human's answers and records the hold.
    pub(crate) channel: Arc<ApprovalRelayChannel>,
    /// Decided once, by the first step to reach the approval middleware; the others wait for it.
    pub(crate) plan: futures_util::lock::Mutex<Option<Arc<UpFrontPlan>>>,
    /// The call's tag under each approval key, which the middleware computes once.
    pub(crate) call_tags: std::sync::OnceLock<Vec<String>>,
    refusal: Mutex<Option<CommandError>>,
    /// The positions in `steps` whose validated input the registry already took.
    taken: Mutex<Vec<usize>>,
}

impl UpFrontApproval {
    pub(crate) fn new(
        tool: &'static str,
        call: String,
        conditional: bool,
        steps: Vec<UpFrontStep>,
        channel: Arc<ApprovalRelayChannel>,
    ) -> Self {
        Self {
            tool,
            call,
            conditional,
            steps,
            channel,
            plan: futures_util::lock::Mutex::new(None),
            call_tags: std::sync::OnceLock::new(),
            refusal: Mutex::new(None),
            taken: Mutex::new(Vec::new()),
        }
    }

    /// The input validated up front for a step that runs `command` on `input` as sent, handed
    /// out once per step, so two steps sent alike take one each (#1414). The registry runs the
    /// step on it instead of on a second validation's result: the input that runs is the one
    /// the human was shown. `None` for a step that is not known up front or did not validate;
    /// it runs on its own validation, as usual.
    pub(crate) fn validated(&self, command: &str, input: &Value) -> Option<Value> {
        let mut taken = self.taken.lock().unwrap_or_else(PoisonError::into_inner);
        let at = self.steps.iter().enumerate().position(|(at, step)| {
            step.command == command
                && step.input.is_some()
                && step.sent.as_ref() == Some(input)
                && !taken.contains(&at)
        })?;
        taken.push(at);
        self.steps[at].input.clone()
    }

    /// Record that nothing may run; the first refusal wins.
    pub(crate) fn refuse(&self, error: &CommandError) {
        let mut refusal = self.refusal.lock().unwrap_or_else(PoisonError::into_inner);
        if refusal.is_none() {
            *refusal = Some(error.clone());
        }
    }

    /// The refusal the server answers with instead of the run, if any.
    pub(crate) fn refusal(&self) -> Option<CommandError> {
        self.refusal
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }
}

impl fmt::Debug for UpFrontApproval {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("UpFrontApproval")
            .field("tool", &self.tool)
            .finish_non_exhaustive()
    }
}

impl fmt::Debug for ApprovalRelayChannel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ApprovalRelayChannel")
            .field("routed", &self.routed)
            .finish_non_exhaustive()
    }
}

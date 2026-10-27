//! The pre-execution approval gate (`spec/command-metadata.md`, "Approvals").
//!
//! A command declares an [`ApprovalPolicy`] with
//! [`CommandDefinition::with_approval`](crate::CommandDefinition::with_approval): whether a call
//! needs a human's approval before the handler runs. The policy is reported as `_meta.approval`
//! (see [`approval_mode`]), in `afd-help` and in `afd-docs`.
//!
//! The approval middleware ([`create_approval_middleware`], the `approval` feature, on by
//! default) enforces it: a held call fails with `APPROVAL_REQUIRED` and a signed, short-lived
//! token bound to the command, the validated input and the actor. Once a human approves, trusted
//! surface code retries the same call with that token as [`CommandContext::approval`]. Without
//! the middleware, a policy is a declaration only.
//!
//! Tokens are byte-compatible with TypeScript's `createApprovalMiddleware`: a token issued by
//! one server verifies on another with the same secret.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fmt;
use std::sync::Arc;

use crate::commands::{BoxFuture, CommandContext};

#[cfg(feature = "approval")]
mod middleware;
#[cfg(feature = "approval")]
mod token;

#[cfg(feature = "approval")]
#[cfg_attr(docsrs, doc(cfg(feature = "approval")))]
pub use middleware::{
    create_approval_middleware, ApprovalMiddlewareOptions, ApprovalNonceStore, ApprovalReplay,
    ApprovalRequest,
};
#[cfg(feature = "approval")]
#[cfg_attr(docsrs, doc(cfg(feature = "approval")))]
pub use token::canonical_json;

/// Whether one call needs a human's approval before its handler runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ApprovalDecision {
    /// The call runs without approval.
    NotRequired,
    /// The call is held until a human approves it.
    Required,
}

/// A policy function: decides from the validated input and the call context.
pub type ApprovalPolicyFn =
    Arc<dyn Fn(&Value, &CommandContext) -> BoxFuture<'static, ApprovalDecision> + Send + Sync>;

/// A command's approval policy: a fixed decision, or a function of the validated input and the
/// call context (for example, "agents need approval, humans do not"). Unset means
/// [`ApprovalPolicy::NotRequired`]. Enforced only where the approval middleware is installed.
#[derive(Clone)]
pub enum ApprovalPolicy {
    /// Never hold the call.
    NotRequired,
    /// Always hold the call until a human approves it.
    Required,
    /// Decide per call. Reported as `conditional`.
    Conditional(ApprovalPolicyFn),
}

impl ApprovalPolicy {
    /// A policy decided per call by `decide`.
    ///
    /// # Example
    ///
    /// ```rust
    /// use afd::{ActorKind, ApprovalDecision, ApprovalPolicy};
    ///
    /// // Agents need approval; humans do not.
    /// let policy = ApprovalPolicy::when(|_input, context| {
    ///     match context.actor.as_ref().map(|actor| actor.kind) {
    ///         Some(ActorKind::Human) => ApprovalDecision::NotRequired,
    ///         _ => ApprovalDecision::Required,
    ///     }
    /// });
    /// # let _ = policy;
    /// ```
    pub fn when<F>(decide: F) -> Self
    where
        F: Fn(&Value, &CommandContext) -> ApprovalDecision + Send + Sync + 'static,
    {
        Self::Conditional(Arc::new(move |input, context| {
            let decision = decide(input, context);
            Box::pin(async move { decision })
        }))
    }

    /// A policy decided per call by an asynchronous `decide`. The returned future cannot borrow
    /// the input or the context: clone what it needs first.
    pub fn when_async<F>(decide: F) -> Self
    where
        F: Fn(&Value, &CommandContext) -> BoxFuture<'static, ApprovalDecision>
            + Send
            + Sync
            + 'static,
    {
        Self::Conditional(Arc::new(decide))
    }

    /// Decide one call. A function policy that panics fails the call before the handler (the
    /// registry turns the panic into `COMMAND_EXECUTION_ERROR`).
    pub async fn decide(&self, input: &Value, context: &CommandContext) -> ApprovalDecision {
        match self {
            Self::NotRequired => ApprovalDecision::NotRequired,
            Self::Required => ApprovalDecision::Required,
            Self::Conditional(decide) => decide(input, context).await,
        }
    }
}

impl From<ApprovalDecision> for ApprovalPolicy {
    fn from(decision: ApprovalDecision) -> Self {
        match decision {
            ApprovalDecision::NotRequired => Self::NotRequired,
            ApprovalDecision::Required => Self::Required,
        }
    }
}

impl fmt::Debug for ApprovalPolicy {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotRequired => f.write_str("NotRequired"),
            Self::Required => f.write_str("Required"),
            Self::Conditional(_) => f.write_str("Conditional(..)"),
        }
    }
}

/// How a policy is reported in `_meta.approval`, `afd-help` and `afd-docs`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[non_exhaustive]
#[serde(rename_all = "kebab-case")]
pub enum ApprovalMode {
    /// [`ApprovalPolicy::NotRequired`].
    NotRequired,
    /// [`ApprovalPolicy::Required`].
    Required,
    /// A function policy, which cannot be serialized.
    Conditional,
}

impl ApprovalMode {
    /// The wire spelling: `not-required`, `required` or `conditional`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NotRequired => "not-required",
            Self::Required => "required",
            Self::Conditional => "conditional",
        }
    }
}

impl fmt::Display for ApprovalMode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// How a policy is reported: a function policy is `conditional`. `None` when no policy is
/// declared (TypeScript's `approvalMode`).
pub fn approval_mode(policy: Option<&ApprovalPolicy>) -> Option<ApprovalMode> {
    policy.map(|policy| match policy {
        ApprovalPolicy::NotRequired => ApprovalMode::NotRequired,
        ApprovalPolicy::Required => ApprovalMode::Required,
        ApprovalPolicy::Conditional(_) => ApprovalMode::Conditional,
    })
}

/// Why a supplied approval token was not accepted (`details.reason`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[non_exhaustive]
#[serde(rename_all = "kebab-case")]
pub enum ApprovalRejection {
    /// Not a token: wrong shape, too long, or a signed payload that is not a token.
    Malformed,
    /// No configured secret signed it.
    InvalidSignature,
    /// Its expiry has passed on the server's clock.
    Expired,
    /// It was issued for another command.
    CommandMismatch,
    /// It was issued for another validated input.
    InputMismatch,
    /// It was issued for another actor.
    ActorMismatch,
    /// A single-use token that already ran the command.
    AlreadyUsed,
}

impl ApprovalRejection {
    /// The wire spelling, such as `input-mismatch`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Malformed => "malformed",
            Self::InvalidSignature => "invalid-signature",
            Self::Expired => "expired",
            Self::CommandMismatch => "command-mismatch",
            Self::InputMismatch => "input-mismatch",
            Self::ActorMismatch => "actor-mismatch",
            Self::AlreadyUsed => "already-used",
        }
    }
}

impl fmt::Display for ApprovalRejection {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[cfg(all(test, feature = "approval"))]
mod tests;

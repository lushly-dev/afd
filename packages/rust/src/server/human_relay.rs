//! Host-verified confirmation (`spec/command-metadata.md`, "Host-verified confirmation" and
//! "Relay evidence"): the [`HumanRelay`] a host installs with
//! [`McpServer::with_human_relay`](super::McpServer::with_human_relay), and the gate that asks it.
//!
//! A command with [`CommandConfirmationMode::HostVerified`](crate::CommandConfirmationMode) is
//! confirmed only by the host, which proves that a person decided (for example by a fresh login
//! at the person's identity provider, on a page the host serves). A form answer and an
//! acknowledgement prove nothing of the kind, since client code can produce either, so for such a
//! command, on every MCP route and whatever the server's
//! [`ConfirmationMode`](super::ConfirmationMode) says (`Off` included), the server:
//!
//! - never sends a form elicitation for it, never advertises or accepts an acknowledgement
//!   (`confirm: true`, a `confirm` list, `_meta["dev.afd/confirm"]`), never accepts a form answer,
//!   and never asks for its approval with the form-mode approval relay;
//! - gates it whether or not it declares `confirm_prompt`;
//! - relays only a call that routes to the one command (its own tool, a hybrid first-class tool, a
//!   grouped tool or `afd-call`) on an MCP 2026-07-28 request. A step of `afd-batch` or `afd-pipe`
//!   and a 2025 request fail with `CONFIRMATION_REQUIRED` before any step runs, and so does every
//!   call when no relay is installed. Rust serves no `/rpc`, `/batch` or `/stream` route.
//!
//! A relayed call goes through these steps:
//!
//! 1. **Validation first.** The input is validated against the command's schema exactly as the
//!    registry validates it, defaults applied, before anyone is asked (`VALIDATION_ERROR`
//!    otherwise); on an authorized server the host's scope resolver is asked again on that input.
//!    [`RelayCall::input_digest`] is [`crate::input_digest`] of the validated input.
//! 2. **Begin.** A call carrying no relay answer calls [`HumanRelay::begin`]. Its `CommandError` is
//!    the call's result; its [`RelayPrompt`] becomes `input_required` with one URL-mode
//!    elicitation under the input key `relay`, whose `elicitationId` is the unpadded base64url
//!    SHA-256 of the URL and whose `requestState` is the relay's `state`. A client that did not
//!    declare URL-mode elicitation never receives one: the call fails with `CONFIRMATION_REQUIRED`.
//! 3. **The retry.** `decline` or `cancel` fails with `CONFIRMATION_DECLINED` without asking the
//!    relay. `accept` means only that the user agreed to open the link (MCP: URL mode is out of
//!    band and never authorizes a user by itself), so the server calls [`HumanRelay::resume`]:
//!    [`RelayOutcome::Approved`] runs the command with relay evidence on its context, so one
//!    decision also covers an approval policy; [`RelayOutcome::Declined`] is
//!    `CONFIRMATION_DECLINED`; [`RelayOutcome::Pending`] asks again with its prompt;
//!    [`RelayOutcome::Invalid`] begins again.
//!
//! The server never trusts the relay's state itself: it hands it back to the relay, which must
//! keep the guarantees listed on [`HumanRelay`]. Credentials missing an issuer, subject or client
//! id are never bound (`spec/authorization.md`, M8): such a call is refused with an internal error
//! before the relay is asked. `DirectClient` and in-process registries never relay: the host owns
//! in-process calls.

use std::collections::HashMap;
use std::fmt;
use std::sync::Arc;

use async_trait::async_trait;
use rmcp::model::{
    CallToolRequestParams, CallToolResponse, ClientCapabilities, InputRequiredResult,
};
use rmcp::service::RequestContext;
use rmcp::RoleServer;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::approval::relay::RelayEvidence;
use crate::{
    error_codes, Actor, CommandContext, CommandDefinition, CommandError, CommandRegistry,
    Credentials, IncompleteCredentials,
};

use super::confirmations::{declined, is_modern, quoted};

/// The `inputRequests` key of the URL-mode elicitation a [`HumanRelay`] prompt becomes.
pub const RELAY_INPUT_KEY: &str = "relay";

/// The host's way to prove that a person decided a call to a host-verified command
/// (`spec/command-metadata.md`, "Host-verified confirmation").
///
/// A relay guarantees:
///
/// - **Its `state`** ([`RelayPrompt::state`]) is integrity-protected, expires within 24 hours, and
///   binds the decision, the command, [`RelayCall::input_digest`] and the call's principal binding
///   ([`RelayCall::principal_binding`], `spec/authorization.md` M8). [`HumanRelay::resume`]
///   returns [`RelayOutcome::Invalid`] for a state that does not verify, has expired, or was
///   issued to another command, input or principal. The server hands the state, as the client
///   echoed it, only to the relay; it is untrusted input until the relay verifies it.
/// - **[`RelayOutcome::Approved`]** is returned at most once per decision, and only for a decision
///   the person made after [`HumanRelay::begin`], atomically: two concurrent retries carrying the
///   same state get one `Approved` between them. Its `decision_id` is not empty. For a command with
///   no approval policy (or a registry without the approval middleware) this is the only guard
///   against running one decision twice: nothing else in AFD spends the decision.
/// - **The URL** ([`RelayPrompt::url`]) is an absolute `https` URL that holds no identity and is
///   not pre-authenticated; the host verifies who opens it and that it is the person the call is
///   for (MCP 2026-07-28, elicitation, URL mode). The server refuses a URL that is not `https` or
///   names user information, with an internal error.
///
/// When the command has an approval policy, an `Approved` call carries relay evidence that the
/// approval middleware accepts once: it spends `relay:<decisionId>` in its nonce store for 24
/// hours, so a relay that spends its own key for the decision in a shared store must use another
/// one.
#[async_trait]
pub trait HumanRelay: Send + Sync {
    /// Start a decision for `call`, or refuse it (the `CommandError` is the call's result, for
    /// example for a client without URL-mode elicitation: see
    /// [`RelayCall::supports_url_elicitation`]).
    async fn begin(&self, call: &RelayCall) -> Result<RelayPrompt, CommandError>;

    /// What has become of the decision `state` names, for `call` (the same command, input digest
    /// and principal it was issued to, or [`RelayOutcome::Invalid`]).
    async fn resume(&self, state: &str, call: &RelayCall) -> RelayOutcome;
}

/// One call a [`HumanRelay`] is asked about.
#[derive(Clone)]
#[non_exhaustive]
pub struct RelayCall {
    /// The command's name.
    pub command: String,
    /// [`crate::input_digest`] of the input validated against the command's schema: what the
    /// person decides on is exactly what will run.
    pub input_digest: String,
    /// The actor the command runs with (after the context hook and the verified credentials).
    pub actor: Option<Actor>,
    /// The call's verified credentials, on an authorized server.
    pub credentials: Option<Arc<Credentials>>,
    /// The client capabilities the request declared.
    pub client_capabilities: Option<ClientCapabilities>,
}

impl RelayCall {
    /// A call, for a host testing its relay; the server builds the calls it asks about itself.
    pub fn new(
        command: impl Into<String>,
        input_digest: impl Into<String>,
        actor: Option<Actor>,
        credentials: Option<Arc<Credentials>>,
        client_capabilities: Option<ClientCapabilities>,
    ) -> Self {
        Self {
            command: command.into(),
            input_digest: input_digest.into(),
            actor,
            credentials,
            client_capabilities,
        }
    }

    /// The call's principal binding ([`crate::principal_binding`]), which the relay's state must
    /// bind.
    ///
    /// # Errors
    /// [`IncompleteCredentials`]; the server never asks a relay about such a call.
    pub fn principal_binding(&self) -> Result<String, IncompleteCredentials> {
        crate::principal_binding(self.actor.as_ref(), self.credentials.as_deref())
    }

    /// Whether the client declared URL-mode elicitation, without which the server never sends the
    /// relay's prompt.
    pub fn supports_url_elicitation(&self) -> bool {
        supports_url(self.client_capabilities.as_ref())
    }
}

impl fmt::Debug for RelayCall {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // The actor's id and principal and the credentials name the caller.
        f.debug_struct("RelayCall")
            .field("command", &self.command)
            .field("input_digest", &self.input_digest)
            .field("actor", &self.actor.as_ref().map(|actor| actor.kind))
            .field("credentials", &self.credentials)
            .field("client_capabilities", &self.client_capabilities)
            .finish()
    }
}

/// What the person is asked to open, and the state that names the pending decision.
#[derive(Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct RelayPrompt {
    /// An absolute `https` URL that holds no identity and is not pre-authenticated.
    pub url: String,
    /// The elicitation's message: ids, never content.
    pub message: String,
    /// The `requestState`: integrity-protected by the relay (see [`HumanRelay`]).
    pub state: String,
}

impl RelayPrompt {
    /// A prompt.
    pub fn new(
        url: impl Into<String>,
        message: impl Into<String>,
        state: impl Into<String>,
    ) -> Self {
        Self {
            url: url.into(),
            message: message.into(),
            state: state.into(),
        }
    }
}

impl fmt::Debug for RelayPrompt {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("RelayPrompt")
            .field("url", &self.url)
            .field("message", &self.message)
            .finish_non_exhaustive()
    }
}

/// What [`HumanRelay::resume`] found.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum RelayOutcome {
    /// The person approved, after `begin`; returned at most once per decision.
    Approved {
        /// The decision's id, spent once by the approval middleware as `relay:<decisionId>`.
        decision_id: String,
    },
    /// The person declined: `CONFIRMATION_DECLINED`, not retryable.
    Declined,
    /// Not decided yet: the call is asked again with this prompt.
    Pending(RelayPrompt),
    /// The state is not an answer (it does not verify, has expired, or names another command,
    /// input or principal): the server begins again.
    Invalid,
}

/// What the gate decided for a call to a host-verified command.
pub(crate) enum RelayDecision {
    /// Run the command with this evidence on its context.
    Proceed(RelayEvidence),
    /// Answer with this failure.
    Refuse(CommandError),
    /// Answer with this `input_required` result.
    Ask(CallToolResponse),
    /// Answer with a JSON-RPC internal error that names no one: the call's credentials cannot be
    /// bound, or the relay broke its contract (an unusable URL or state, an empty decision id).
    Internal,
}

/// What the gate reads for one call.
pub(crate) struct RelayGate<'a> {
    pub(crate) relay: Option<&'a Arc<dyn HumanRelay>>,
    pub(crate) request: &'a CallToolRequestParams,
    pub(crate) context: &'a RequestContext<RoleServer>,
    pub(crate) registry: &'a CommandRegistry,
    pub(crate) command: &'a CommandDefinition,
    /// The context the command would run with: its actor, credentials and scope check.
    pub(crate) execution: &'a CommandContext,
}

fn supports_url(capabilities: Option<&ClientCapabilities>) -> bool {
    capabilities
        .and_then(|capabilities| capabilities.elicitation.as_ref())
        .is_some_and(|elicitation| elicitation.url.is_some())
}

fn required(names: &[String], suggestion: String) -> CommandError {
    CommandError::new(
        error_codes::CONFIRMATION_REQUIRED,
        match names {
            [name] => format!("'{name}' needs a person's confirmation through the host"),
            _ => format!(
                "{} need a person's confirmation through the host",
                quoted(names)
            ),
        },
    )
    .with_suggestion(suggestion)
    .with_retryable(false)
    .with_details(HashMap::from([("commands".to_owned(), json!(names))]))
}

/// The refusal of a host-verified command the server cannot relay: no relay is installed, or the
/// call is a batch or pipeline step or a 2025 request.
pub(crate) fn unrelayable(names: &[String], has_relay: bool) -> CommandError {
    let suggestion = if !has_relay {
        format!(
            "This server cannot confirm {} over MCP: only the host can, and it has no way to ask the person here. Do not retry; ask the user to run it through the application.",
            quoted(names)
        )
    } else {
        format!(
            "Call {} on its own (its own tool, a grouped tool or afd-call) from an MCP 2026-07-28 client, so the host can ask the person.",
            quoted(names)
        )
    };
    required(names, suggestion)
}

/// Whether `url` is an absolute `https` URL with a host, no user information and no whitespace
/// or control character.
fn is_relay_url(url: &str) -> bool {
    let Some(rest) = url
        .get(..8)
        .filter(|scheme| scheme.eq_ignore_ascii_case("https://"))
        .map(|_| &url[8..])
    else {
        return false;
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
    !authority.is_empty()
        && !authority.contains('@')
        && !url
            .chars()
            .any(|character| character.is_whitespace() || character.is_control())
}

/// The `input_required` result for a relay's prompt, or why it cannot be sent.
fn present(gate: &RelayGate<'_>, prompt: RelayPrompt) -> RelayDecision {
    let capabilities = gate.context.client_capabilities();
    if !supports_url(capabilities.as_ref()) {
        return RelayDecision::Refuse(required(
            std::slice::from_ref(&gate.command.name),
            format!(
                "Use an MCP client that supports URL-mode elicitation: only a person, through the link the host sends, can confirm '{}'.",
                gate.command.name
            ),
        ));
    }
    if !is_relay_url(&prompt.url) || prompt.state.is_empty() {
        return RelayDecision::Internal;
    }
    // One id per URL, so a pending decision keeps one id.
    let elicitation_id = crate::canonical::base64url_encode(&Sha256::digest(prompt.url.as_bytes()));
    let result: Result<InputRequiredResult, _> = serde_json::from_value(json!({
        "resultType": "input_required",
        "inputRequests": {
            RELAY_INPUT_KEY: {
                "method": "elicitation/create",
                "params": {
                    "mode": "url",
                    "message": prompt.message,
                    "url": prompt.url,
                    "elicitationId": elicitation_id,
                },
            }
        },
        "requestState": prompt.state,
    }));
    match result {
        Ok(result) => RelayDecision::Ask(CallToolResponse::InputRequired(result)),
        Err(_) => RelayDecision::Internal,
    }
}

/// Decide a call to a host-verified command with `input` as sent (see the module docs).
pub(crate) async fn check(gate: RelayGate<'_>, input: Value) -> RelayDecision {
    let name = gate.command.name.clone();
    let names = std::slice::from_ref(&name);
    let Some(relay) = gate.relay else {
        return RelayDecision::Refuse(unrelayable(names, false));
    };
    if !is_modern(gate.context) {
        return RelayDecision::Refuse(unrelayable(names, true));
    }
    // M8: credentials that cannot be bound never reach the relay, on the first call or a retry.
    let execution = gate.execution;
    let Ok(credentials_binding) = crate::credentials_binding(execution.credentials.as_deref())
    else {
        return RelayDecision::Internal;
    };
    // Validate first, as the registry will, so the person decides on exactly what will run.
    let validated = match gate.registry.validate(gate.command, input) {
        Ok(validated) => validated,
        Err(error) => return RelayDecision::Refuse(*error),
    };
    if let (Some(scope_check), Some(credentials)) = (&execution.scope_check, &execution.credentials)
    {
        if let Some(error) = (scope_check.0)(&name, &validated, credentials) {
            return RelayDecision::Refuse(error);
        }
    }
    let input_digest = match crate::input_digest(&validated) {
        Ok(digest) => digest,
        Err(message) => {
            return RelayDecision::Refuse(
                CommandError::new(error_codes::VALIDATION_ERROR, message)
                    .with_suggestion("Pass plain JSON input: integers within ±2^53")
                    .with_retryable(false),
            )
        }
    };
    let call = RelayCall {
        command: name.clone(),
        input_digest,
        actor: execution.actor.clone(),
        credentials: execution.credentials.clone(),
        client_capabilities: gate.context.client_capabilities(),
    };

    if let (Some(responses), Some(state)) =
        (&gate.request.input_responses, &gate.request.request_state)
    {
        let response = responses
            .get(RELAY_INPUT_KEY)
            .cloned()
            .unwrap_or(Value::Null);
        match response["action"].as_str() {
            // Ending the elicitation is an answer only to stop: nothing is asked of the relay.
            Some("decline" | "cancel") => return RelayDecision::Refuse(declined(names)),
            // `accept` only says the user agreed to open the link; the relay decides.
            Some("accept") => match relay.resume(state, &call).await {
                RelayOutcome::Approved { decision_id } => {
                    if decision_id.is_empty() {
                        return RelayDecision::Internal;
                    }
                    return RelayDecision::Proceed(RelayEvidence {
                        command: name,
                        input_digest: call.input_digest,
                        actor: crate::credentials::actor_binding_json(execution.actor.as_ref()),
                        credentials_binding,
                        decision_id,
                    });
                }
                RelayOutcome::Declined => return RelayDecision::Refuse(declined(names)),
                RelayOutcome::Pending(prompt) => return present(&gate, prompt),
                // Not an answer: begin again, as for a tampered confirmation state.
                RelayOutcome::Invalid => {}
            },
            _ => {}
        }
    }
    match relay.begin(&call).await {
        Ok(prompt) => present(&gate, prompt),
        Err(error) => RelayDecision::Refuse(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relay_urls_are_https_without_identity() {
        for url in [
            "https://umbel.example.com/person/abc",
            "HTTPS://umbel.example.com",
            "https://umbel.example.com:8443/p?d=1#x",
        ] {
            assert!(is_relay_url(url), "{url}");
        }
        for url in [
            "http://umbel.example.com/person",
            "https://",
            "https:///path",
            "https://user@umbel.example.com/",
            "https://umbel.example.com/a b",
            "https://umbel.example.com/\n",
            "javascript:alert(1)",
            "",
            "https:/umbel.example.com",
        ] {
            assert!(!is_relay_url(url), "{url}");
        }
    }
}

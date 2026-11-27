//! Umbel's `HumanRelay` (phase 5 specification, sections 7.2 and 7.3; D116; owner decision 7):
//! how a `person.mcp = "verified"` command, registered host-verified, is decided over MCP.
//!
//! - **Begin.** Only for a client that declared URL-mode elicitation (`APPROVAL_REQUIRED` with
//!   `details.reason` `url-elicitation-required` otherwise), and for a verified caller acting for a
//!   person in a namespace that serves verified commands (`PERSON_VERIFICATION_UNAVAILABLE`
//!   otherwise): the decision is written ([`super::service::PersonService::begin`]) and the prompt
//!   is its page's URL, a message naming only the command, the ids the decision keeps (its
//!   preview's declared properties, each an id-shaped value; step 6, so knowledge's names
//!   `proposal <id>`) and the spaces, and a `requestState` sealed under `relay.key` that binds the
//!   decision to the command, the input digest and the principal binding.
//! - **Resume.** A state that does not open for this call, a decision that is gone, expired, or
//!   for another `for`, command or input, is `Invalid` (AFD begins again). Pending asks again with
//!   the same URL and a fresh state; declined is `Declined`; approved is spent once as
//!   `person:<id>` and is `Approved`, so of two retries carrying one state, in any processes,
//!   exactly one runs.
//! - **The pending list** (`person.pending_list`, off by default; #2010). For a client without
//!   URL-mode elicitation, instead of `url-elicitation-required`: the live decisions for this
//!   `for` (namespace, subject, actor, issuer and client id), command and input digest, begun by
//!   this relay for the same principal binding (its MAC under `person.key`, kept with the
//!   decision), are found with no state. An approved one, newest first, is spent once as
//!   `person:<id>`, as on resume, and runs; a declined one is answered once, spent as it is
//!   answered. Otherwise the newest pending one is `CONFIRMATION_REQUIRED` naming it, its page and
//!   the list (`/d/`), and with none a new one is begun. A decision begun before the binding was
//!   kept, or at the CLI, is never found. The person decides on the same page, with
//!   the same login, so the decision is `verified` as in URL mode.
//! - **The approved call's fields** ([`super::PERSON_DECISION_KEY`] and `humanPresent`), for the
//!   plugin gate and the handler.

use std::sync::Arc;

use afd::server::{
    HumanRelay, PendingListOutcome, RelayCall, RelayOutcome, RelayPending, RelayPrompt,
};
use afd::{CommandError, error_codes};
use async_trait::async_trait;
use serde_json::{Map, Value, json};

use super::service::{BeginRequest, PersonService};
use super::{Surface, for_of_mcp, unavailable};
use crate::shared::person::{Decision, Status};

/// Umbel's relay, over the workspace's person service.
pub(crate) struct UmbelRelay {
    service: Arc<PersonService>,
}

impl UmbelRelay {
    pub(crate) fn new(service: Arc<PersonService>) -> Self {
        Self { service }
    }

    fn prompt(&self, decision: &Decision, call: &RelayCall) -> Option<RelayPrompt> {
        let state = self.service.seal_state(&decision.id, call)?;
        let ids = named_ids(&self.service.message_properties(decision));
        let what = if ids.is_empty() {
            call.command.clone()
        } else {
            format!("{} ({})", call.command, ids.join(", "))
        };
        let message = if decision.spaces.is_empty() {
            format!("Open the link to review {what}")
        } else {
            format!(
                "Open the link to review {what} in {}",
                decision.spaces.join(", ")
            )
        };
        Some(RelayPrompt::new(
            self.service.url(&decision.id),
            message,
            state,
        ))
    }

    /// Who the call is for, in a namespace that serves verified commands now (7.2, step 1).
    fn who(&self, call: &RelayCall) -> Result<super::DecisionFor, CommandError> {
        let who = for_of_mcp(&call.context).map_err(|reason| {
            tracing::info!(target: "umbel::person", reason, "no person can be proven for a call");
            unavailable(
                &call.command,
                "this caller acts for no person in a namespace with a person login",
            )
        })?;
        if !self.service.served(&who.namespace) {
            return Err(unavailable(
                &call.command,
                "the caller's namespace's person login cannot be used now",
            ));
        }
        Ok(who)
    }

    /// The pending list's answer for `call` (see the module's rules).
    async fn list_answer(&self, call: &RelayCall) -> Result<PendingListOutcome, CommandError> {
        let who = self.who(call)?;
        // AFD never asks about credentials that cannot be bound (M8), so this is a broken store.
        let binding = self
            .service
            .binding_of(call)
            .ok_or_else(crate::shared::read_limit::store_failed)?;
        let now = self.service.now();
        let found: Vec<_> = self
            .service
            .for_call(&call.command, &call.input_digest)
            .await?
            .into_iter()
            .filter(|decision| {
                decision.for_ == who
                    && decision.binding.as_deref() == Some(binding.as_str())
                    && decision.live(now)
            })
            .collect();
        // A decided decision first, newest first, so a newer pending one never hides it. Spent
        // already (an identical call won it, here or on another process): look further.
        for decision in &found {
            let answer = match decision.status {
                Status::Approved => PendingListOutcome::Approved {
                    decision_id: decision.id.clone(),
                },
                Status::Declined => PendingListOutcome::Declined,
                Status::Pending => continue,
            };
            let spent = self
                .service
                .spend(&decision.id)
                .await
                .map_err(|error| super::service::store_failure(&error))?;
            if spent {
                return Ok(answer);
            }
        }
        if let Some(decision) = found
            .iter()
            .find(|decision| decision.status == Status::Pending)
        {
            return Ok(self.pending(&decision.id));
        }
        let decision = self
            .service
            .begin(BeginRequest {
                who,
                command: &call.command,
                input: &call.input,
                input_digest: &call.input_digest,
                context: &call.context,
                surface: Surface::Mcp,
                binding: Some(binding),
            })
            .await?;
        Ok(self.pending(&decision.id))
    }

    fn pending(&self, id: &str) -> PendingListOutcome {
        PendingListOutcome::Pending(RelayPending::new(
            id,
            self.service.url(id),
            self.service.list_url(),
        ))
    }
}

/// Whether `text` is id-shaped: 1 to 64 ASCII letters, digits, `_` and `-`, starting with a
/// letter or a digit. No space, so no sentence; no `.`, `:` or `/`, so no host name or URL; no
/// markup.
fn id_shaped(text: &str) -> bool {
    (1..=64).contains(&text.len())
        && text
            .bytes()
            .next()
            .is_some_and(|b| b.is_ascii_alphanumeric())
        && text
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
}

/// The ids a prompt names (7.3, 7.4: "only ids, never content"): each property the decision
/// keeps (its preview's declared inputs) but `space` and `spaces`, which the message names apart,
/// as `<name> <value>`, when the value is one id-shaped string. Anything else is left out, never
/// cut. Knowledge's preview declares `proposal`, so its message names the proposal's id.
fn named_ids(properties: &Map<String, Value>) -> Vec<String> {
    properties
        .iter()
        .filter(|(name, _)| !matches!(name.as_str(), "space" | "spaces") && id_shaped(name))
        .filter_map(|(name, value)| {
            value
                .as_str()
                .filter(|value| id_shaped(value))
                .map(|value| format!("{name} {value}"))
        })
        .collect()
}

/// `APPROVAL_REQUIRED` for a client that cannot open a URL elicitation (7.3).
fn url_elicitation_required(command: &str) -> CommandError {
    let mut details = std::collections::HashMap::new();
    details.insert("reason".to_owned(), json!("url-elicitation-required"));
    CommandError::new(
        error_codes::APPROVAL_REQUIRED,
        format!("'{command}' is decided by a person on a page this server links to"),
    )
    .with_suggestion(
        "Use an MCP client that supports URL-mode elicitation, so the person can open the link and decide; or run it with the umbel command at a terminal.",
    )
    .with_retryable(false)
    .with_details(details)
}

#[async_trait]
impl HumanRelay for UmbelRelay {
    async fn begin(&self, call: &RelayCall) -> Result<RelayPrompt, CommandError> {
        if !call.supports_url_elicitation() {
            return Err(url_elicitation_required(&call.command));
        }
        let who = self.who(call)?;
        let decision = self
            .service
            .begin(BeginRequest {
                who,
                command: &call.command,
                input: &call.input,
                input_digest: &call.input_digest,
                context: &call.context,
                surface: Surface::Mcp,
                binding: self.service.binding_of(call),
            })
            .await?;
        self.prompt(&decision, call)
            .ok_or_else(crate::shared::read_limit::store_failed)
    }

    async fn resume(&self, state: &str, call: &RelayCall) -> RelayOutcome {
        let Some(id) = self.service.open_state(state, call) else {
            return RelayOutcome::Invalid;
        };
        let Ok(Some(decision)) = self.service.decision(&id).await else {
            return RelayOutcome::Invalid;
        };
        // Every field of `for` equals the retrying caller's, and the command and the input are the
        // ones decided on (the state's binding already says so; read back, it is checked again).
        let Ok(who) = for_of_mcp(&call.context) else {
            return RelayOutcome::Invalid;
        };
        if decision.for_ != who
            || decision.command != call.command
            || decision.input_digest != call.input_digest
        {
            return RelayOutcome::Invalid;
        }
        // Decided and unexpired: an expired decision, decided or not, is asked again.
        if !decision.live(self.service.now()) {
            return RelayOutcome::Invalid;
        }
        match decision.status {
            Status::Pending => self
                .prompt(&decision, call)
                .map_or(RelayOutcome::Invalid, RelayOutcome::Pending),
            Status::Declined => RelayOutcome::Declined,
            Status::Approved => match self.service.spend(&decision.id).await {
                Ok(true) => RelayOutcome::Approved {
                    decision_id: decision.id,
                },
                // Spent already (a replayed retry, here or on another process), or the store
                // failed: never run it, begin again.
                Ok(false) | Err(_) => RelayOutcome::Invalid,
            },
        }
    }

    async fn pending_list(
        &self,
        call: &RelayCall,
    ) -> Option<Result<PendingListOutcome, CommandError>> {
        if !self.service.pending_list() || call.supports_url_elicitation() {
            return None;
        }
        Some(self.list_answer(call).await)
    }

    async fn approved_context(&self, decision_id: &str, call: &RelayCall) -> Map<String, Value> {
        let Ok(Some(decision)) = self.service.decision(decision_id).await else {
            return Map::new();
        };
        if decision.command != call.command || decision.input_digest != call.input_digest {
            return Map::new();
        }
        let principal = crate::principal::Principal::from_context(&call.context);
        self.service
            .run_fields(&decision, Surface::Mcp, principal)
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_prompt_names_id_shaped_values_and_nothing_else() {
        let properties: Map<String, Value> = serde_json::from_value(json!({
            "space": "alpha",
            "proposal": "p-0123456789abcdef0123",
            "reason": "approve it, it is safe",
            "note": "<b>x</b>",
            "ids": ["a", "b"],
            "count": 3,
        }))
        .unwrap_or_default();
        assert_eq!(named_ids(&properties), ["proposal p-0123456789abcdef0123"]);
        assert!(id_shaped("p-1") && id_shaped("a_b-c"));
        assert!(!id_shaped("") && !id_shaped("-p") && !id_shaped("a b") && !id_shaped("é"));
        // Nothing a link or a host name could be read from.
        for urlish in ["https://evil.example", "evil.example", "a:b", "a/b", "x.y"] {
            assert!(!id_shaped(urlish), "{urlish}");
        }
        assert!(!id_shaped(&"a".repeat(65)));
    }
}

//! The principal behind a call, version 0.
//!
//! A surface sets the principal on every call, always overwriting
//! `CommandContext.extra["dev.umbel/principal"]`: the CLI, [`Host::context`](crate::Host::context)
//! and the MCP context hook. Nothing is ever read from a request's headers or query, nor the HTTP
//! bearer token: over HTTP the hook reads only the credentials AFD's server admitted (phase 5
//! section 4.2), and in the hosted modes it fails closed until step 2b maps them. A command takes the
//! caller's identity **only** from this key, through [`Principal::from_context`], never from
//! `context.actor` alone.

use crate::workspace::{AuthConfig, AuthMode, PrincipalConfig};
use afd::server::ContextHookRequest;
use afd::{Actor, ActorKind, CommandContext, CommandError, error_codes};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;

/// The version of the principal projection this crate writes.
pub const PRINCIPAL_VERSION: u32 = 0;

/// The `CommandContext.extra` key the host owns; no caller can set it.
pub const PRINCIPAL_KEY: &str = "dev.umbel/principal";

/// How the call reached the host.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Transport {
    /// `umbel serve --stdio`.
    Stdio,
    /// `umbel serve --http`.
    Http,
    /// The `umbel` command line.
    Cli,
    /// An embedder's call through [`Host::context`](crate::Host::context).
    Library,
}

/// What vouches for the actor in version 0.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Authentication {
    /// Nothing: the HTTP bearer token grants access but names no one.
    None,
    /// The process boundary is the trust boundary (stdio and the CLI).
    Process,
    /// The embedding application vouches for the actor.
    Embedder,
}

/// The principal projection, version 0 (`schemas/principal.v0.json`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Principal {
    /// Always [`PRINCIPAL_VERSION`].
    pub version: u32,
    /// AFD's actor, equal to `CommandContext.actor`.
    pub actor: Actor,
    /// How the call reached the host.
    pub transport: Transport,
    /// What vouches for the actor.
    pub authentication: Authentication,
}

impl Principal {
    /// A version 0 principal.
    pub fn new(actor: Actor, transport: Transport, authentication: Authentication) -> Self {
        Self {
            version: PRINCIPAL_VERSION,
            actor,
            transport,
            authentication,
        }
    }

    /// The principal the host set on `context`, or `None` for a context no surface prepared (a
    /// bare `registry.execute`).
    pub fn from_context(context: &CommandContext) -> Option<Self> {
        let principal: Self =
            serde_json::from_value(context.extra.get(PRINCIPAL_KEY)?.clone()).ok()?;
        (principal.version == PRINCIPAL_VERSION).then_some(principal)
    }

    /// The JSON value stored under [`PRINCIPAL_KEY`].
    pub fn to_value(&self) -> Value {
        serde_json::to_value(self).unwrap_or(Value::Null)
    }

    /// Make `context` carry this principal: the actor, and the principal under
    /// [`PRINCIPAL_KEY`], overwriting whatever was there.
    pub(crate) fn apply(&self, context: &mut CommandContext) {
        context.actor = Some(self.actor.clone());
        context
            .extra
            .insert(PRINCIPAL_KEY.to_owned(), self.to_value());
    }
}

/// What the context hook needs to know of `[auth]` to tell HTTP callers apart (phase 5 section
/// 4.2): the mode, and the public URL its refusals point to.
#[derive(Debug, Clone)]
pub(crate) struct HttpAuth {
    mode: AuthMode,
    public_url: Option<String>,
}

impl HttpAuth {
    /// From the workspace's configuration.
    pub(crate) fn new(auth: &AuthConfig, public_url: Option<&str>) -> Self {
        Self {
            mode: auth.mode,
            public_url: public_url.map(str::to_owned),
        }
    }

    /// The refusal of an HTTP request the hook cannot attribute (4.2; 10.5's `UNAUTHORIZED`). It
    /// names no reason: the reason goes to the log.
    fn unauthorized(&self) -> CommandError {
        let suggestion = match self.mode {
            AuthMode::Gateway => "The gateway must connect with its pinned certificate and send a valid Umbel-Gateway-Assertion.".to_owned(),
            AuthMode::Oauth | AuthMode::None => format!(
                "Obtain an access token for {} from an authorization server its protected-resource metadata names, and send it as Authorization: Bearer.",
                self.public_url.as_deref().unwrap_or("this server")
            ),
        };
        CommandError::new(
            error_codes::UNAUTHORIZED,
            "The caller could not be identified",
        )
        .with_suggestion(suggestion)
        .with_retryable(false)
    }
}

/// The MCP context hook, version 1's table (phase 5 section 4.2), as far as phase 5 step 2a
/// builds it. It runs on every `tools/call` (and AFD's `tasks/*`) and always overwrites
/// [`PRINCIPAL_KEY`]:
///
/// | Transport | Mode | `actor` | `authentication` |
/// | --- | --- | --- | --- |
/// | stdio | any | an agent with `principal.local_id`, acting for `principal.on_behalf_of` when set | `process` |
/// | Streamable HTTP | `none` | an agent with id `loopback` | `none` |
/// | Streamable HTTP | `oauth` | refused with `UNAUTHORIZED` (below) | - |
/// | Streamable HTTP | `gateway` | refused with `UNAUTHORIZED` until step 4 | - |
///
/// A request that carries HTTP parts came over Streamable HTTP, and one that does not came over
/// stdio; AFD sets the parts itself, so a caller cannot choose its transport. The hook **fails
/// closed** in the hosted modes: an HTTP request without verified credentials (a layer missing)
/// is refused, and so, until step 2b maps credentials to a version 1 principal (section 4.1), is
/// one with them. It reads only what AFD's server set from admitted credentials
/// (`context.credentials`), never a header the caller controls. The CLI and the library set
/// their principals elsewhere, unchanged.
pub(crate) fn hook(
    config: &PrincipalConfig,
    auth: HttpAuth,
    clock: Option<Arc<dyn afd::Clock>>,
) -> impl Fn(
    ContextHookRequest,
    CommandContext,
) -> std::future::Ready<Result<CommandContext, CommandError>>
+ Send
+ Sync
+ 'static {
    let local_id = config.local_id.clone();
    let on_behalf_of = config.on_behalf_of.clone();
    move |request, mut context| {
        let principal = if request.http_parts().is_some() {
            match auth.mode {
                AuthMode::None => Principal::new(
                    Actor::new(ActorKind::Agent).with_id(LOOPBACK_ID),
                    Transport::Http,
                    Authentication::None,
                ),
                AuthMode::Oauth => {
                    if context.credentials.is_some() {
                        tracing::warn!(
                            target: "umbel::auth",
                            "refused a verified caller: mapping credentials to a principal arrives in phase 5 step 2b"
                        );
                    } else {
                        tracing::error!(
                            target: "umbel::auth",
                            "refused an HTTP request that reached the context hook without verified credentials: a layer is missing"
                        );
                    }
                    return std::future::ready(Err(auth.unauthorized()));
                }
                AuthMode::Gateway => {
                    tracing::error!(
                        target: "umbel::auth",
                        "refused an HTTP request in auth.mode = \"gateway\", which arrives in phase 5 step 4"
                    );
                    return std::future::ready(Err(auth.unauthorized()));
                }
            }
        } else {
            let mut actor = Actor::new(ActorKind::Agent).with_id(&local_id);
            if let Some(person) = &on_behalf_of {
                actor = actor.with_on_behalf_of(person);
            }
            Principal::new(actor, Transport::Stdio, Authentication::Process)
        };
        principal.apply(&mut context);
        if let Some(clock) = &clock {
            context.clock = Some(Arc::clone(clock));
        }
        std::future::ready(Ok(context))
    }
}

/// The actor id of every caller of the loopback HTTP endpoint: the bearer token grants access
/// and names no one.
pub(crate) const LOOPBACK_ID: &str = "loopback";

#[cfg(test)]
mod tests {
    use super::*;
    use afd::ActorKind;
    use serde_json::json;

    #[test]
    fn the_projection_has_the_documented_shape() {
        let principal = Principal::new(
            Actor::new(ActorKind::Agent)
                .with_id("local")
                .with_on_behalf_of("ada"),
            Transport::Stdio,
            Authentication::Process,
        );
        assert_eq!(
            principal.to_value(),
            json!({
                "version": 0,
                "actor": {"kind": "agent", "id": "local", "onBehalfOf": "ada"},
                "transport": "stdio",
                "authentication": "process",
            })
        );
    }

    #[test]
    fn apply_overwrites_a_forged_value_and_round_trips() {
        let mut context = CommandContext::new().with_extra(PRINCIPAL_KEY, json!({"forged": true}));
        let principal = Principal::new(
            Actor::new(ActorKind::Human).with_id("local"),
            Transport::Cli,
            Authentication::Process,
        );
        principal.apply(&mut context);
        assert_eq!(Principal::from_context(&context), Some(principal.clone()));
        assert_eq!(context.actor, Some(principal.actor));
    }

    #[test]
    fn a_context_without_or_with_a_malformed_principal_has_none() {
        assert_eq!(Principal::from_context(&CommandContext::new()), None);
        let forged = CommandContext::new().with_extra(PRINCIPAL_KEY, json!({"version": 9}));
        assert_eq!(Principal::from_context(&forged), None);
    }
}

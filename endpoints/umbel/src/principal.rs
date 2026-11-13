//! The principal behind a call, version 1 (phase 5 specification, section 2.1).
//!
//! A surface sets the principal on every call, always overwriting
//! `CommandContext.extra["dev.umbel/principal"]`: the CLI, [`Host::context`](crate::Host::context)
//! and the MCP context hook. Nothing is ever read from a request's headers or query, nor the HTTP
//! bearer token: over HTTP in mode `oauth` the hook reads only the caller the host's token
//! verifier mapped (section 4.1), and in mode `gateway` the caller the gateway layer mapped from
//! its verified assertion (section 4.4), beside the credentials AFD's server admitted (section
//! 4.2). A
//! command takes the caller's identity **only** from this key, through
//! [`Principal::from_context`], never from `context.actor` alone. Version 0 principals are read
//! only from journal entries already written; every surface writes version 1.

use std::collections::BTreeMap;

use crate::auth::caller::{CallerSlot, VerifiedCaller, Vouched};
use crate::auth::{ChainEntry, SCOPE_VERBS, Scope, ScopeVerb, TokenBinding};
use crate::workspace::{AuthConfig, AuthMode, Config};
use afd::server::ContextHookRequest;
use afd::{Actor, ActorKind, CommandContext, CommandError, error_codes};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::sync::Arc;

/// The version of the principal projection this crate writes.
pub const PRINCIPAL_VERSION: u32 = 1;

/// The `CommandContext.extra` key the host owns; no caller can set it.
pub const PRINCIPAL_KEY: &str = "dev.umbel/principal";

/// The `CommandContext.extra` key holding the `[access.groups]` a verified caller's token makes
/// it a member of (section 4.5): an array of group ids, empty for every other caller. The hook
/// always sets it, so no caller can, and it lasts no longer than the request's token.
pub const CLAIM_GROUPS_KEY: &str = "dev.umbel/claim-groups";

/// The `CommandContext.extra` key the context hook always sets: the id of the HTTP request's
/// usage slot (phase 5 section 12.1), or `null`. No caller can set it.
pub(crate) const USAGE_KEY: &str = "dev.umbel/usage";

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

/// What vouches for the actor.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Authentication {
    /// Nothing: the HTTP bearer token grants access but names no one.
    None,
    /// The process boundary is the trust boundary (stdio and the CLI).
    Process,
    /// The embedding application vouches for the actor.
    Embedder,
    /// A verified access token (section 3.2).
    Verified,
    /// A verified gateway assertion (section 4.4).
    Gateway,
}

/// `humanPresent`: a person proven for this call. Only the host sets it (the CLI's terminal
/// check, a completed person decision, a decision on the local page); no token claim and no
/// gateway does.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HumanPresent {
    /// `terminal`, `verified` or `local`.
    pub level: String,
    /// `cli-terminal`, `person-page` or `local-page`.
    pub method: String,
    /// When, ISO 8601 UTC with milliseconds.
    pub at: String,
    /// The login's `auth_time`, for `verified`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth_time: Option<String>,
    /// The login's `acr`, for `verified`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub acr: Option<String>,
}

/// `policyDecision`: the policy that admitted the caller, and a rule code (never a claim value).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PolicyDecision {
    /// `allow` or `deny`.
    pub decision: String,
    /// The policy's code.
    pub policy: String,
    /// A rule code, or `None`.
    pub reason: Option<String>,
}

impl PolicyDecision {
    /// The authentication policy admitted the caller.
    fn allowed() -> Self {
        Self {
            decision: "allow".to_owned(),
            policy: "auth".to_owned(),
            reason: None,
        }
    }
}

/// The principal projection, version 1 (`schemas/principal.v1.json`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Principal {
    /// Always [`PRINCIPAL_VERSION`].
    pub version: u32,
    /// AFD's actor, equal to `CommandContext.actor`.
    pub actor: Actor,
    /// How the call reached the host.
    pub transport: Transport,
    /// What vouches for the actor.
    pub authentication: Authentication,
    /// The identity namespace; `None` without a token or assertion.
    pub namespace: Option<String>,
    /// The issuer alias; `None` without a token or assertion.
    pub issuer: Option<String>,
    /// Outermost first; empty without a token or assertion.
    pub delegation_chain: Vec<ChainEntry>,
    /// How the token is held; `None` without one.
    pub token_binding: Option<TokenBinding>,
    /// A person proven for this call, set only by the host.
    pub human_present: Option<HumanPresent>,
    /// The granted Umbel scopes; `None` without a token or assertion (nothing narrows).
    pub scopes: Option<Vec<String>>,
    /// Per readable space, the verbs the scopes grant there; `None` without a token.
    pub spaces: Option<BTreeMap<String, Vec<String>>>,
    /// The policy that admitted the caller.
    pub policy_decision: PolicyDecision,
    /// The SHA-256 of the `[auth]` and `[access]` tables as read.
    pub policy_version: String,
}

/// The policy version of a workspace with neither `[auth]` nor `[access]`.
fn empty_policy_version() -> String {
    policy_version_of(None, None)
}

/// `sha256:<hex>` of the canonical JSON `{"access": <access>, "auth": <auth>}` (2.1's
/// `policyVersion`), each table as read or `null`.
pub(crate) fn policy_version_of(auth: Option<&Value>, access: Option<&Value>) -> String {
    let mut document = serde_json::Map::new();
    document.insert("access".into(), access.cloned().unwrap_or(Value::Null));
    document.insert("auth".into(), auth.cloned().unwrap_or(Value::Null));
    let canonical = canonical(&Value::Object(document));
    let mut text = String::from("sha256:");
    for byte in Sha256::digest(canonical.as_bytes()) {
        text.push_str(&format!("{byte:02x}"));
    }
    text
}

/// JSON with every object's members sorted by name, and no whitespace.
fn canonical(value: &Value) -> String {
    match value {
        Value::Object(members) => {
            let mut names: Vec<&String> = members.keys().collect();
            names.sort();
            let inner: Vec<String> = names
                .into_iter()
                .map(|name| {
                    format!(
                        "{}:{}",
                        Value::String(name.clone()),
                        canonical(&members[name.as_str()])
                    )
                })
                .collect();
            format!("{{{}}}", inner.join(","))
        }
        Value::Array(items) => {
            let inner: Vec<String> = items.iter().map(canonical).collect();
            format!("[{}]", inner.join(","))
        }
        other => other.to_string(),
    }
}

impl Principal {
    /// A version 1 principal with no token: `namespace`, `issuer`, `tokenBinding`, `scopes`,
    /// `spaces` and `humanPresent` `null`, an empty chain, the `auth` policy's `allow`, and the
    /// policy version of an empty policy until [`Self::with_policy_version`] sets the
    /// workspace's.
    pub fn new(actor: Actor, transport: Transport, authentication: Authentication) -> Self {
        Self {
            version: PRINCIPAL_VERSION,
            actor,
            transport,
            authentication,
            namespace: None,
            issuer: None,
            delegation_chain: Vec::new(),
            token_binding: None,
            human_present: None,
            scopes: None,
            spaces: None,
            policy_decision: PolicyDecision::allowed(),
            policy_version: empty_policy_version(),
        }
    }

    /// Set `policyVersion`.
    #[must_use]
    pub fn with_policy_version(mut self, policy_version: impl Into<String>) -> Self {
        self.policy_version = policy_version.into();
        self
    }

    /// The principal of a verified caller (2.1, 4.1, 4.4): its actor, namespace, issuer (the
    /// issuer's or the gateway's alias), chain, binding and scopes, and per readable space the
    /// verbs those scopes grant there. A token's caller is `verified` with its binding; a gateway
    /// assertion's is `gateway` with none.
    pub(crate) fn verified(config: &Config, caller: &VerifiedCaller) -> Self {
        let (authentication, binding) = match &caller.vouched {
            Vouched::Token(binding) => (Authentication::Verified, Some(binding.clone())),
            Vouched::Gateway => (Authentication::Gateway, None),
        };
        let mut principal = Self::new(caller.actor.clone(), Transport::Http, authentication)
            .with_policy_version(config.policy_version.clone());
        principal.namespace = Some(caller.namespace.clone());
        principal.issuer = Some(caller.issuer.clone());
        principal.delegation_chain = caller.chain.clone();
        principal.token_binding = binding;
        principal.scopes = Some(caller.scopes.clone());
        principal.spaces = Some(granted_spaces(config, caller));
        principal
    }

    /// The principal the host set on `context`, or `None` for a context no surface prepared (a
    /// bare `registry.execute`).
    pub fn from_context(context: &CommandContext) -> Option<Self> {
        let principal: Self =
            serde_json::from_value(context.extra.get(PRINCIPAL_KEY)?.clone()).ok()?;
        (principal.version == PRINCIPAL_VERSION).then_some(principal)
    }

    /// The delegation chain of the principal `context` carries, as a version 3 envelope records
    /// it (phase 5 section 2.4): outermost first, empty without a token or assertion, or for a
    /// context no surface prepared.
    pub(crate) fn chain_of(context: &CommandContext) -> Vec<umbel_store::ChainLink> {
        Self::from_context(context)
            .map(|principal| {
                principal
                    .delegation_chain
                    .iter()
                    .map(|entry| umbel_store::ChainLink {
                        kind: entry.kind.as_str().to_owned(),
                        id: entry.id.clone(),
                    })
                    .collect()
            })
            .unwrap_or_default()
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

/// Per space the caller may read (its `readers`, with equivalents and claim groups), the verbs
/// the caller's scopes grant there (5.1's order: a verb on every space, every verb on a space
/// implying `read` there). A space with no verb is left out.
fn granted_spaces(config: &Config, caller: &VerifiedCaller) -> BTreeMap<String, Vec<String>> {
    let principal = caller.effective_principal();
    let held: Vec<Scope> = caller
        .scopes
        .iter()
        .filter_map(|scope| Scope::parse(&config.auth.scope_prefix, scope))
        .collect();
    let mut granted = BTreeMap::new();
    for space in &config.spaces {
        if !crate::access::may_read_space(
            config,
            space,
            principal.as_deref(),
            caller.claim_groups(),
        ) {
            continue;
        }
        let verbs: Vec<String> = [
            ScopeVerb::Read,
            ScopeVerb::Write,
            ScopeVerb::Approve,
            ScopeVerb::Erase,
        ]
        .into_iter()
        .filter(|verb| {
            let wanted = Scope {
                verb: *verb,
                space: Some(space.id.clone()),
            };
            held.iter().any(|scope| scope.implies(&wanted))
        })
        .map(|verb| verb.as_str().to_owned())
        .collect();
        debug_assert!(
            verbs
                .iter()
                .all(|verb| SCOPE_VERBS.contains(&verb.as_str()))
        );
        if !verbs.is_empty() {
            granted.insert(space.id.as_str().to_owned(), verbs);
        }
    }
    granted
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

/// The verified caller of an HTTP request in a hosted mode: the one the host's verifier (mode
/// `oauth`) or gateway layer (mode `gateway`) left in the request's [`CallerSlot`], **only**
/// when its credentials equal the ones AFD's server admitted for this request and it was
/// vouched for as `mode` vouches. Anything else (no credentials, no slot, an empty slot, a slot
/// for other credentials, a token's caller in mode `gateway` or an assertion's in mode `oauth`)
/// identifies no one.
fn verified_caller(
    request: &ContextHookRequest,
    context: &CommandContext,
    mode: AuthMode,
) -> Result<Arc<VerifiedCaller>, &'static str> {
    let slot = request
        .http_parts()
        .and_then(|parts| parts.extensions.get::<CallerSlot>());
    hosted_caller(slot, context.credentials.as_deref(), mode)
}

/// The principal of a hosted caller and the claim groups the hook stores beside it, never a
/// gateway's (section 4.5): [`VerifiedCaller::claim_groups`].
fn hosted_principal(config: &Config, caller: &VerifiedCaller) -> (Principal, Vec<String>) {
    (
        Principal::verified(config, caller),
        caller.claim_groups().to_vec(),
    )
}

/// The caller in `slot` when it was mapped for exactly `credentials` and vouched for as `mode`
/// vouches; the reason logged otherwise.
fn hosted_caller(
    slot: Option<&CallerSlot>,
    credentials: Option<&afd::Credentials>,
    mode: AuthMode,
) -> Result<Arc<VerifiedCaller>, &'static str> {
    let caller = caller_for(slot, credentials)?;
    if caller.vouched_for(mode) {
        Ok(caller)
    } else {
        Err("refused a caller vouched for otherwise than this auth.mode vouches")
    }
}

/// The caller in `slot` when it was mapped for exactly `credentials`; the reason logged
/// otherwise.
fn caller_for(
    slot: Option<&CallerSlot>,
    credentials: Option<&afd::Credentials>,
) -> Result<Arc<VerifiedCaller>, &'static str> {
    let Some(credentials) = credentials else {
        return Err(
            "refused an HTTP request that reached the context hook without verified credentials: a layer is missing",
        );
    };
    match slot.and_then(CallerSlot::caller) {
        Some(caller) if caller.credentials == *credentials => Ok(Arc::clone(caller)),
        Some(_) => Err("refused a request whose mapped caller belongs to other credentials"),
        None => Err(
            "refused verified credentials that the host's verifier or gateway layer did not map: it is not installed",
        ),
    }
}

/// The MCP context hook, version 1 (phase 5 section 4.2). It runs on every `tools/call` (and
/// AFD's `tasks/*`) and always overwrites [`PRINCIPAL_KEY`] and [`CLAIM_GROUPS_KEY`]:
///
/// | Transport | Mode | `actor` | `authentication` |
/// | --- | --- | --- | --- |
/// | stdio | any | an agent with `principal.local_id`, acting for `principal.on_behalf_of` when set | `process` |
/// | Streamable HTTP | `none` | an agent with id `loopback` | `none` |
/// | Streamable HTTP | `oauth` | section 4.1's mapping of the verified token | `verified` |
/// | Streamable HTTP | `gateway` | section 4.4's mapping of the verified assertion | `gateway` |
///
/// A request that carries HTTP parts came over Streamable HTTP, and one that does not came over
/// stdio; AFD sets the parts itself, so a caller cannot choose its transport. The hook **fails
/// closed** in the hosted modes: an HTTP request without the caller the host's verifier (or, in
/// mode `gateway`, its gateway layer) mapped for the admitted credentials (a layer or the
/// verifier missing) is refused. It reads nothing a caller sends: only AFD's admitted credentials
/// and the request extension the host's own verifier or gateway layer filled. The CLI and the
/// library set their principals elsewhere.
pub(crate) fn hook(
    config: Arc<Config>,
    auth: HttpAuth,
    clock: Option<Arc<dyn afd::Clock>>,
) -> impl Fn(
    ContextHookRequest,
    CommandContext,
) -> std::future::Ready<Result<CommandContext, CommandError>>
+ Send
+ Sync
+ 'static {
    move |request, mut context| {
        let mut claim_groups: Vec<String> = Vec::new();
        let principal = if request.http_parts().is_some() {
            match auth.mode {
                AuthMode::None => Principal::new(
                    Actor::new(ActorKind::Agent).with_id(LOOPBACK_ID),
                    Transport::Http,
                    Authentication::None,
                ),
                mode @ (AuthMode::Oauth | AuthMode::Gateway) => {
                    match verified_caller(&request, &context, mode) {
                        Ok(caller) => {
                            let (principal, groups) = hosted_principal(&config, &caller);
                            claim_groups = groups;
                            principal
                        }
                        Err(reason) => {
                            tracing::error!(target: "umbel::auth", "{reason}");
                            return std::future::ready(Err(auth.unauthorized()));
                        }
                    }
                }
            }
        } else {
            let mut actor = Actor::new(ActorKind::Agent).with_id(&config.principal.local_id);
            if let Some(person) = &config.principal.on_behalf_of {
                actor = actor.with_on_behalf_of(person);
            }
            Principal::new(actor, Transport::Stdio, Authentication::Process)
        }
        .with_policy_version(config.policy_version.clone());
        principal.apply(&mut context);
        context
            .extra
            .insert(CLAIM_GROUPS_KEY.to_owned(), Value::from(claim_groups));
        // A person decision is the host's to record, after the relay approves a call (phase 5
        // section 7.2): never anything a request brought, whatever context fields are declared.
        context
            .extra
            .insert(crate::person::PERSON_DECISION_KEY.to_owned(), Value::Null);
        // Nor the host's own check before a decision is begun (step 6).
        context
            .extra
            .insert(crate::person::PERSON_CHECK_KEY.to_owned(), Value::Null);
        // Nor the page of a preview the person page asks for (the Ideas host-review
        // specification, section 2).
        context
            .extra
            .insert(crate::person::PREVIEW_PAGE_KEY.to_owned(), Value::Null);
        // Which request's usage record this call belongs to (section 12.1): the host's own slot,
        // never anything a request brought.
        #[cfg(feature = "auth")]
        crate::usage::note_call(request.http_parts(), &mut context);
        #[cfg(not(feature = "auth"))]
        context.extra.insert(USAGE_KEY.to_owned(), Value::Null);
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
    fn the_policy_version_is_sha256_of_the_canonical_tables() {
        // Persisted and compared across releases, so the text must not change with the hash
        // crate: `printf '%s' '{"access":null,"auth":null}' | shasum -a 256`.
        assert_eq!(
            empty_policy_version(),
            "sha256:f66c0c8f302078c1157fc316fddb776f88ec1f014a71763ece72df49e8a5a820"
        );
    }

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
                "version": 1,
                "actor": {"kind": "agent", "id": "local", "onBehalfOf": "ada"},
                "transport": "stdio",
                "authentication": "process",
                "namespace": null,
                "issuer": null,
                "delegationChain": [],
                "tokenBinding": null,
                "humanPresent": null,
                "scopes": null,
                "spaces": null,
                "policyDecision": {"decision": "allow", "policy": "auth", "reason": null},
                "policyVersion": policy_version_of(None, None),
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

    fn caller(credentials: &afd::Credentials) -> VerifiedCaller {
        VerifiedCaller {
            credentials: credentials.clone(),
            namespace: "corp".into(),
            issuer: "as".into(),
            actor: Actor::new(ActorKind::Agent)
                .with_id("corp/app")
                .with_on_behalf_of("corp/ada"),
            chain: Vec::new(),
            vouched: Vouched::Token(TokenBinding::Bearer),
            scopes: Vec::new(),
            claim_groups: Vec::new(),
        }
    }

    #[test]
    fn the_hook_trusts_a_mapped_caller_only_beside_its_own_credentials() {
        let mine = afd::Credentials::new(
            "https://as.example.com",
            "ada",
            "app",
            "https://r.example.com/mcp",
            1,
            2,
        );
        let other = afd::Credentials::new(
            "https://as.example.com",
            "bo",
            "app",
            "https://r.example.com/mcp",
            1,
            2,
        );
        let slot = CallerSlot::default();
        assert!(slot.fill(caller(&mine)));
        assert!(!slot.fill(caller(&mine)), "a slot is filled once");
        assert!(caller_for(Some(&slot), Some(&mine)).is_ok());
        assert!(caller_for(Some(&slot), Some(&other)).is_err());
        assert!(caller_for(Some(&slot), None).is_err());
        assert!(caller_for(Some(&CallerSlot::default()), Some(&mine)).is_err());
        assert!(caller_for(None, Some(&mine)).is_err());
    }

    #[test]
    fn each_hosted_mode_trusts_only_its_own_kind_of_caller() {
        let base = afd::Credentials::new("https://as.example.com", "u", "c", "https://r/mcp", 1, 2);
        let token = caller(&base);
        let mut asserted = caller(&base);
        asserted.vouched = Vouched::Gateway;
        assert!(token.vouched_for(AuthMode::Oauth));
        assert!(asserted.vouched_for(AuthMode::Gateway));
        assert!(!asserted.vouched_for(AuthMode::Oauth));
        assert!(!token.vouched_for(AuthMode::Gateway));
        assert!(!token.vouched_for(AuthMode::None));
        assert!(!asserted.vouched_for(AuthMode::None));
        // Through the hook's own lookup: a token's caller is no one in mode gateway, and an
        // assertion's no one in mode oauth, though each sits beside its own credentials.
        let credentials = afd::Credentials::new(
            "https://as.example.com",
            "ada",
            "app",
            "https://r.example.com/mcp",
            1,
            2,
        );
        let token_slot = CallerSlot::default();
        assert!(token_slot.fill(caller(&credentials)));
        let mut asserted = caller(&credentials);
        asserted.vouched = Vouched::Gateway;
        let gateway_slot = CallerSlot::default();
        assert!(gateway_slot.fill(asserted));
        assert!(hosted_caller(Some(&token_slot), Some(&credentials), AuthMode::Oauth).is_ok());
        assert!(hosted_caller(Some(&token_slot), Some(&credentials), AuthMode::Gateway).is_err());
        assert!(hosted_caller(Some(&gateway_slot), Some(&credentials), AuthMode::Gateway).is_ok());
        assert!(hosted_caller(Some(&gateway_slot), Some(&credentials), AuthMode::Oauth).is_err());
    }

    #[test]
    fn a_gateway_caller_is_gateway_with_no_binding_and_no_person() {
        let config = crate::workspace::ConfigFile::parse("config_version = 5\n")
            .and_then(|file| file.into_config(std::path::Path::new("/w")))
            .unwrap();
        let mut gateway = caller(&afd::Credentials::new(
            "https://gateway.example.com",
            "ada",
            "app",
            "https://r.example.com/mcp",
            1,
            2,
        ));
        gateway.vouched = Vouched::Gateway;
        // Groups are never taken from a gateway, whatever the caller's field holds: neither in
        // what the hook stores beside the principal nor in the spaces it reads through them.
        gateway.claim_groups = vec!["eng".into()];
        let (principal, groups) = hosted_principal(&config, &gateway);
        assert!(groups.is_empty());
        let mut token = caller(&gateway.credentials);
        token.claim_groups = vec!["eng".into()];
        assert_eq!(hosted_principal(&config, &token).1, ["eng"]);
        assert_eq!(principal.authentication, Authentication::Gateway);
        assert_eq!(principal.token_binding, None);
        assert_eq!(principal.human_present, None);
        assert_eq!(principal.transport, Transport::Http);
        let token = Principal::verified(&config, &caller(&gateway.credentials));
        assert_eq!(token.authentication, Authentication::Verified);
        assert_eq!(token.token_binding, Some(TokenBinding::Bearer));
    }
}

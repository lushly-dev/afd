//! OAuth 2.1 resource-server authorization for the MCP server over HTTP (feature `server-auth`),
//! as `spec/authorization.md` specifies it (MCP 2026-07-28 Authorization).
//!
//! It is opt-in. [`McpServer::with_authorization`](super::McpServer::with_authorization) configures
//! it with an [`Authorization`]: the [`ProtectedResource`] metadata, a [`TokenVerifier`] (AFD's
//! [`JwtVerifier`], or the host's, for introspection), the server's required scopes, an optional
//! [`ScopeResolver`] and whether listings are filtered by scope.
//! [`McpServer::authorized_http_service`](super::McpServer::authorized_http_service) then builds the
//! Streamable HTTP service behind its [`BearerLayer`], both from the same server:
//!
//! ```no_run
//! # fn run(keys: afd::server::auth::StaticKeys) -> Result<(), String> {
//! use std::sync::Arc;
//! use afd::server::auth::{
//!     Authorization, JwtIssuer, JwtVerifier, ProtectedResource, SigningAlgorithm, TokenRules,
//! };
//! use afd::server::{HttpOptions, McpServer};
//! use afd::CommandRegistry;
//!
//! let resource = "https://todo.example.com/mcp";
//! let metadata = ProtectedResource::new(resource, ["https://auth.example.com"])?
//!     .with_scopes_supported(["todo:read"])?;
//! let issuer = JwtIssuer::new(
//!     "auth",
//!     "https://auth.example.com",
//!     [SigningAlgorithm::RS256, SigningAlgorithm::ES256],
//!     keys,
//! )?;
//! let verifier = JwtVerifier::new(TokenRules::new(resource)?, vec![issuer])?;
//! let authorization = Authorization::new(metadata, verifier)?.with_required_scopes(["todo:read"])?;
//! let server = McpServer::new(Arc::new(CommandRegistry::new()), "todo", "1.0.0")
//!     .with_authorization(authorization);
//! // Mount it where it receives both `/mcp` and the metadata paths.
//! let service = server.authorized_http_service(HttpOptions::default())?;
//! # let _ = service;
//! # Ok(())
//! # }
//! ```
//!
//! # What the server does
//!
//! - **The bearer layer** ([`BearerLayer`]) serves the metadata at its two well-known paths
//!   without authentication (M7), takes the one bearer token (M2), verifies it (M3), and answers
//!   401 with the exact challenge and body of M5. It parses a `tools/call` body and decides every
//!   command it names before dispatch (`afd-call`, every step of `afd-batch` and `afd-pipe`,
//!   grouped actions, hybrid first-class tools): any missing scope is one 403 naming every
//!   missing scope in step order (M6). It strips the `Authorization` header and passes the
//!   verified [`Credentials`] on in the request's extensions.
//! - **A host's own layer** that admits credentials itself ([`Authorization::admit`]) runs the
//!   same decision before dispatch through
//!   [`McpServer::pre_dispatch_check`](super::McpServer::pre_dispatch_check): the bearer layer
//!   runs that same [`PreDispatchCheck`], so the two answer every request alike, but for a 403's
//!   challenge when the host names its own scheme ([`ScopeChallenge`]).
//! - **Fail closed** (M1). A server with authorization accepts only credentials admitted for its
//!   own configuration ([`Authorization::admit`], which its bearer layer calls). An HTTP request
//!   without them (the layer left out, or a layer from another server) is refused with
//!   `UNAUTHORIZED` before any command, hook or listing runs, and so is a request on any transport
//!   other than HTTP unless it is stdio through `serve_stdio` or marked trusted with
//!   [`McpServer::with_trusted_transport`](super::McpServer::with_trusted_transport). stdio, the
//!   CLI, `DirectClient` and in-process registries carry no credentials and no scope is checked
//!   on them.
//! - **Credentials** (M4) are on every call's [`CommandContext::credentials`](crate::CommandContext::credentials).
//!   Without a host mapping the actor is `{ kind: "agent", id: <clientId>, onBehalfOf: <subject> }`;
//!   the context hook sees both and may map the actor, but cannot change the credentials.
//! - **After routing** (M6), after the context hook and before the confirmation gate, every call
//!   that carries credentials is decided again; a missing scope fails it with
//!   `INSUFFICIENT_SCOPE` (`retryable: false`, `details.scopes`), a batch or pipeline as a whole.
//! - **At execution** (M6), with a resolver, the registry asks it once more for every command it
//!   runs with credentials, on the validated input (defaults applied, pipeline references
//!   resolved); see [`ScopeResolver`]'s two phases.
//! - **Any `Missing` refuses**, even one that names no valid scope ([`request_decision`]).
//! - **Listing** (M6): with [`Authorization::with_filter_tools_by_scope`], `tools/list`,
//!   `afd-discover`, `afd-detail`, `afd-help`, `afd-docs`, `afd-schema` and grouped actions show
//!   only commands the caller may see, no "did you mean" suggestion names another, and
//!   `tools/list` carries `cacheScope: "private"`.
//! - **Hidden commands** (M6): with filtered listings and a resolver, a command the resolver's
//!   [`ScopeResolver::known`] (by default its `visible`) rejects for a caller is answered to that
//!   caller exactly as a name that does not exist, on every route, before validation, the
//!   middleware, a confirmation, a relay or a task.
//! - **Other methods** (`tools/list`, `server/discover`, `resources/*`, `initialize` and the rest)
//!   need the server's required scopes.
//!
//! A refused token's rule code ([`RuleCode`]) is logged at `warn` (target `afd::auth`) with the
//! issuer's alias, never the token or a claim value, and never sent.
//!
//! The rules that need no key or network are public functions, so a host's introspection
//! verifier applies exactly the same rules: [`check_introspection`] and [`check_claims`]
//! (rules 5 to 10), [`check_jws_header`] (rule 2), [`check_key_fit`] (rule 3),
//! [`parse_scope_claim`] (M3.2), [`audience_accepts`] (M3.1), [`extract_bearer`] (M2),
//! [`static_decision`] and [`request_decision`] (M6).

use std::fmt;
use std::sync::Arc;

use async_trait::async_trait;

pub use crate::credentials::Credentials;

mod bearer;
mod claims;
mod dispatch;
mod jwt;
mod layer;
mod resource;
pub(crate) mod scopes;

pub use bearer::extract_bearer;
pub use claims::{
    check_claims, check_introspection, check_jws_header, check_key_fit, parse_scope_claim,
    TokenRules, DEFAULT_CLOCK_SKEW_S, DEFAULT_MAX_TOKEN_LIFETIME_S, DEFAULT_SCOPE_LIMIT,
    MAX_CLAIM_CHARS, MAX_CLOCK_SKEW_S,
};
pub use dispatch::{PreDispatch, PreDispatchCheck, ScopeChallenge};
pub use jwt::{
    is_compact_jws, ClientCertificate, Jwk, JwtIssuer, JwtVerifier, KeyError, KeySource,
    SigningAlgorithm, StaticKeys,
};
pub use layer::{BearerBody, BearerLayer, BearerService};
pub use resource::{audience_accepts, ProtectedResource, PROTECTED_RESOURCE_WELL_KNOWN};
pub use scopes::{
    request_decision, static_decision, RequestDecision, ScopeDecision, ScopeResolver,
};

/// The default cap on a request body the bearer layer reads (1 MiB, as [`HttpOptions`]).
///
/// [`HttpOptions`]: super::HttpOptions
pub const DEFAULT_MAX_BODY_BYTES: usize = 1024 * 1024;

/// The rule a refused token or request broke (`spec/authorization.md`, M5, "Rule codes"). Logged,
/// never sent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum RuleCode {
    /// No token on the request.
    NoToken,
    /// A token in the query or a form body, or a second `Authorization` header.
    TokenLocation,
    /// The `Authorization` value is not `Bearer <b64token>`.
    TokenMalformed,
    /// No configured issuer for this token.
    UnknownIssuer,
    /// Rule 2: `typ`.
    Typ,
    /// Rule 2: `alg`.
    Alg,
    /// Rule 2: `kid`.
    Kid,
    /// Rule 2: `crit`.
    Crit,
    /// Rule 2: `jku`, `x5u`, `x5c` or `jwk`.
    KeyReference,
    /// Rule 3: the key.
    Key,
    /// Rule 4: the signature.
    Signature,
    /// Rule 5: the issuer.
    Issuer,
    /// Rule 6: the audience.
    Audience,
    /// Rule 7, or a required introspection field missing.
    Claims,
    /// Rule 8: expired.
    Expired,
    /// Rule 8: `iat` or `nbf` in the future.
    NotYetValid,
    /// Rule 8: `exp - iat` too long.
    Lifetime,
    /// Rule 9: a malformed `scope` claim.
    ScopeMalformed,
    /// Rule 9: too many scopes.
    ScopesTooMany,
    /// Rule 10: a DPoP-bound token.
    DpopUnsupported,
    /// Rule 10: the certificate binding.
    Binding,
    /// Introspection said `active: false`.
    Inactive,
    /// The key source or introspection endpoint could not answer.
    Unavailable,
}

impl RuleCode {
    /// Every rule code, in the specification's order.
    pub const ALL: [RuleCode; 23] = [
        Self::NoToken,
        Self::TokenLocation,
        Self::TokenMalformed,
        Self::UnknownIssuer,
        Self::Typ,
        Self::Alg,
        Self::Kid,
        Self::Crit,
        Self::KeyReference,
        Self::Key,
        Self::Signature,
        Self::Issuer,
        Self::Audience,
        Self::Claims,
        Self::Expired,
        Self::NotYetValid,
        Self::Lifetime,
        Self::ScopeMalformed,
        Self::ScopesTooMany,
        Self::DpopUnsupported,
        Self::Binding,
        Self::Inactive,
        Self::Unavailable,
    ];

    /// The rule code as the specification writes it (`audience`, `scopes-too-many`, ...).
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NoToken => "no-token",
            Self::TokenLocation => "token-location",
            Self::TokenMalformed => "token-malformed",
            Self::UnknownIssuer => "unknown-issuer",
            Self::Typ => "typ",
            Self::Alg => "alg",
            Self::Kid => "kid",
            Self::Crit => "crit",
            Self::KeyReference => "key-reference",
            Self::Key => "key",
            Self::Signature => "signature",
            Self::Issuer => "issuer",
            Self::Audience => "audience",
            Self::Claims => "claims",
            Self::Expired => "expired",
            Self::NotYetValid => "not-yet-valid",
            Self::Lifetime => "lifetime",
            Self::ScopeMalformed => "scope-malformed",
            Self::ScopesTooMany => "scopes-too-many",
            Self::DpopUnsupported => "dpop-unsupported",
            Self::Binding => "binding",
            Self::Inactive => "inactive",
            Self::Unavailable => "unavailable",
        }
    }

    /// The rule code written `name`.
    pub fn from_name(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|rule| rule.as_str() == name)
    }
}

impl fmt::Display for RuleCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// A refused token: the rule it broke and, once known, the alias of the issuer it claims. Never
/// the token or a claim value, so it can be logged as it is.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct AuthRefusal {
    /// The rule code.
    pub rule: RuleCode,
    /// The configured alias of the token's issuer, once the token was routed to one.
    pub issuer: Option<String>,
}

impl AuthRefusal {
    /// A refusal for `rule`, with no issuer.
    pub fn new(rule: RuleCode) -> Self {
        Self { rule, issuer: None }
    }

    /// Name the issuer's configured alias (never its `iss` claim as sent).
    pub fn with_issuer(mut self, alias: impl Into<String>) -> Self {
        self.issuer = Some(alias.into());
        self
    }
}

impl From<RuleCode> for AuthRefusal {
    fn from(rule: RuleCode) -> Self {
        Self::new(rule)
    }
}

/// Verifies one request's bearer token (`spec/authorization.md`, M3). AFD's [`JwtVerifier`]
/// handles JWTs; a host implements introspection (it needs an HTTP client) as its own verifier,
/// with [`check_introspection`] applying rules 5 to 10 to the endpoint's answer.
#[async_trait]
pub trait TokenVerifier: Send + Sync {
    /// Verify `token`, sent on the request whose head is `request` (the TLS client certificate,
    /// when there is one, is a [`ClientCertificate`] in its extensions).
    ///
    /// # Errors
    /// The first rule the token breaks. A key source or endpoint that cannot answer is
    /// [`RuleCode::Unavailable`]: the request fails closed.
    async fn verify(
        &self,
        token: &str,
        request: &http::request::Parts,
    ) -> Result<Credentials, AuthRefusal>;

    /// The claim rules this verifier applies, when it can say: [`Authorization::new`] then checks
    /// that the metadata publishes the same resource and binding requirement.
    fn rules(&self) -> Option<&TokenRules> {
        None
    }
}

#[async_trait]
impl<T: TokenVerifier + ?Sized> TokenVerifier for Arc<T> {
    async fn verify(
        &self,
        token: &str,
        request: &http::request::Parts,
    ) -> Result<Credentials, AuthRefusal> {
        (**self).verify(token, request).await
    }

    fn rules(&self) -> Option<&TokenRules> {
        (**self).rules()
    }
}

/// A server's authorization configuration (`spec/authorization.md`, "Options").
#[derive(Clone)]
pub struct Authorization {
    /// Which configuration this is: [`Self::admit`] marks credentials with it, and only a server
    /// holding this configuration (or a clone of it) accepts them.
    id: u64,
    pub(crate) metadata: ProtectedResource,
    pub(crate) verifier: Arc<dyn TokenVerifier>,
    pub(crate) required_scopes: Vec<String>,
    pub(crate) resolver: Option<Arc<dyn ScopeResolver>>,
    pub(crate) filter_tools_by_scope: bool,
    pub(crate) max_body_bytes: usize,
}

impl fmt::Debug for Authorization {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Authorization")
            .field("metadata", &self.metadata)
            .field("required_scopes", &self.required_scopes)
            .field("resolver", &self.resolver.is_some())
            .field("filter_tools_by_scope", &self.filter_tools_by_scope)
            .field("max_body_bytes", &self.max_body_bytes)
            .finish_non_exhaustive()
    }
}

impl Authorization {
    /// Authorization by `verifier` for the resource `metadata` describes, with no required scope,
    /// the static scope rule, unfiltered listings, and a 1 MiB body cap.
    ///
    /// # Errors
    /// The verifier's rules ([`TokenVerifier::rules`]) name another resource than the metadata,
    /// or disagree with it on whether bound tokens are required.
    pub fn new(
        metadata: ProtectedResource,
        verifier: impl TokenVerifier + 'static,
    ) -> Result<Self, String> {
        if let Some(rules) = verifier.rules() {
            if rules.resource() != metadata.resource() {
                return Err(format!(
                    "[AFD] the verifier accepts the audience {:?} but the metadata publishes the resource {:?}",
                    rules.resource(),
                    metadata.resource()
                ));
            }
            if rules.require_bound_tokens() != metadata.bound_tokens_required() {
                return Err("[AFD] the verifier and the metadata disagree on whether certificate-bound tokens are required".to_owned());
            }
        }
        static NEXT_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
        Ok(Self {
            id: NEXT_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
            metadata,
            verifier: Arc::new(verifier),
            required_scopes: Vec::new(),
            resolver: None,
            filter_tools_by_scope: false,
            max_body_bytes: DEFAULT_MAX_BODY_BYTES,
        })
    }

    /// Scopes every request needs (`requiredScopes`), checked before a call's own decision.
    ///
    /// # Errors
    /// A scope that is not a scope token.
    pub fn with_required_scopes<I, S>(mut self, scopes: I) -> Result<Self, String>
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        let mut required: Vec<String> = Vec::new();
        for scope in scopes {
            let scope = scope.into();
            if !crate::credentials::is_scope_token(&scope) {
                return Err(format!("[AFD] scope {scope:?} is not an OAuth scope token"));
            }
            if !required.contains(&scope) {
                required.push(scope);
            }
        }
        self.required_scopes = required;
        Ok(self)
    }

    /// Decide every call with `resolver` instead of the static rule (a command's `scopes`). The
    /// required scopes still apply.
    pub fn with_resolver(mut self, resolver: impl ScopeResolver + 'static) -> Self {
        self.resolver = Some(Arc::new(resolver));
        self
    }

    /// Filter the listings by scope (`filterToolsByScope`). Default: `false`. With a resolver, a
    /// command its [`ScopeResolver::known`] rejects is then also answered as one that does not
    /// exist, on every route (M6, "Hidden commands").
    pub fn with_filter_tools_by_scope(mut self, filter: bool) -> Self {
        self.filter_tools_by_scope = filter;
        self
    }

    /// The largest request body the bearer layer reads; a larger one is 413. Default:
    /// [`DEFAULT_MAX_BODY_BYTES`]. Keep it no larger than [`HttpOptions::max_body_bytes`].
    ///
    /// [`HttpOptions::max_body_bytes`]: super::HttpOptions::max_body_bytes
    pub fn with_max_body_bytes(mut self, bytes: usize) -> Self {
        self.max_body_bytes = bytes;
        self
    }

    /// The protected-resource metadata.
    pub fn metadata(&self) -> &ProtectedResource {
        &self.metadata
    }

    /// The required scopes.
    pub fn required_scopes(&self) -> &[String] {
        &self.required_scopes
    }

    /// Admit a request whose caller trusted host code has verified: put `credentials` in the
    /// request's `extensions`, marked as verified for this authorization. The bearer layer does
    /// this for every token it accepts; a host's own layer (a gateway that verified the caller
    /// another way) calls it to hand the server credentials it established.
    ///
    /// **Trust-bearing.** The server believes whatever is admitted, so call it only after your
    /// own verification, never from anything a caller sent. A server accepts only credentials
    /// admitted for its own authorization (this value or a clone of it): credentials inserted
    /// into the extensions without this mark, or admitted for another server's authorization,
    /// are refused with `UNAUTHORIZED` (M1).
    pub fn admit(&self, extensions: &mut http::Extensions, credentials: Credentials) {
        extensions.insert(credentials);
        extensions.insert(AdmittedBy(self.id));
    }
}

// ─── Server integration ──────────────────────────────────────────────────────────────────────

use rmcp::service::RequestContext;
use rmcp::RoleServer;
use serde_json::{json, Map, Value};

use crate::commands::{ScopeCheck, Visibility};
use crate::{error_codes, CommandError};

use super::McpServer;

/// Why a request that reached the MCP service is refused before anything runs.
pub(crate) enum Refused {
    /// M1: a request without credentials this server's bearer layer verified.
    Unauthenticated,
    /// The request's required scopes are missing (methods that name no command).
    MissingScopes(Vec<String>),
}

impl Refused {
    pub(crate) fn command_error(&self, auth: &Authorization) -> CommandError {
        match self {
            Self::Unauthenticated => unauthenticated(auth),
            Self::MissingScopes(missing) => insufficient_scope(auth, missing),
        }
    }
}

fn unauthenticated(auth: &Authorization) -> CommandError {
    CommandError::new(
        error_codes::UNAUTHORIZED,
        "This server requires a verified access token",
    )
    .with_suggestion(format!(
        "Obtain a token for {} from an authorization server named in {}.",
        auth.metadata.resource(),
        auth.metadata.metadata_url()
    ))
    .with_retryable(false)
}

/// The `INSUFFICIENT_SCOPE` failure for `missing` (`spec/authorization.md`, M6). `missing` may
/// be empty when a resolver refused without naming a scope.
pub(crate) fn insufficient_scope(auth: &Authorization, missing: &[String]) -> CommandError {
    CommandError::new(
        error_codes::INSUFFICIENT_SCOPE,
        "The access token lacks a scope this call needs",
    )
    .with_suggestion(auth.metadata.insufficient_scope_suggestion(missing))
    .with_details(std::collections::HashMap::from([(
        "scopes".to_owned(),
        json!(missing),
    )]))
    .with_retryable(false)
}

/// The mark that a request's credentials were verified for one [`Authorization`]: put beside
/// them in the request's extensions by [`Authorization::admit`], and required by the server
/// that holds the same authorization.
#[derive(Clone, Copy, PartialEq, Eq)]
struct AdmittedBy(u64);

/// The verified credentials of the request `context` belongs to (M1: fail closed).
///
/// - Over HTTP, the request must carry credentials admitted by this server's own
///   authorization ([`Authorization::admit`], which the bearer layer calls): credentials
///   admitted for another server's authorization, or none, are refused.
/// - Without an HTTP request, only a transport marked trusted (stdio through
///   [`McpServer::serve_stdio`], or [`McpServer::with_trusted_transport`]) proceeds, with no
///   credentials; any other transport is refused.
pub(crate) fn request_credentials(
    auth: &Authorization,
    trusted_transport: bool,
    context: &RequestContext<RoleServer>,
) -> Result<Option<Arc<Credentials>>, Refused> {
    let Some(parts) = context.extensions.get::<http::request::Parts>() else {
        return if trusted_transport {
            Ok(None)
        } else {
            Err(Refused::Unauthenticated)
        };
    };
    admitted(auth, &parts.extensions)
        .map(|credentials| Some(Arc::new(credentials.clone())))
        .ok_or(Refused::Unauthenticated)
}

/// The credentials in `extensions` admitted for `auth` ([`Authorization::admit`]), or `None`
/// when there are none, or they were admitted for another authorization or not at all.
pub(crate) fn admitted<'a>(
    auth: &Authorization,
    extensions: &'a http::Extensions,
) -> Option<&'a Credentials> {
    match (
        extensions.get::<AdmittedBy>(),
        extensions.get::<Credentials>(),
    ) {
        (Some(admitted), Some(credentials)) if *admitted == AdmittedBy(auth.id) => {
            Some(credentials)
        }
        _ => None,
    }
}

/// Fail closed, then check the required scopes of a request that names no command.
pub(crate) fn check_request(
    auth: &Authorization,
    trusted_transport: bool,
    context: &RequestContext<RoleServer>,
) -> Result<Option<Arc<Credentials>>, Refused> {
    let credentials = request_credentials(auth, trusted_transport, context)?;
    if let Some(credentials) = &credentials {
        if let scopes::RequestDecision::Forbidden(missing) =
            scopes::request_missing(auth, credentials)
        {
            return Err(Refused::MissingScopes(missing));
        }
    }
    Ok(credentials)
}

/// The JSON-RPC error of a refused request that is not a tool call.
pub(crate) fn error_data(auth: &Authorization, refused: &Refused) -> rmcp::ErrorData {
    let error = refused.command_error(auth);
    let mut data = Map::new();
    data.insert("code".into(), json!(error.code));
    if let Some(suggestion) = &error.suggestion {
        data.insert("suggestion".into(), json!(suggestion));
    }
    if let Refused::MissingScopes(missing) = refused {
        data.insert("scopes".into(), json!(missing));
    }
    rmcp::ErrorData::invalid_request(error.message, Some(Value::Object(data)))
}

/// A `tasks/*` request by a task's owner (`spec/command-metadata.md`, "Tasks"): the owner must
/// still hold what a call of the task's command needs, as far as it is known without the
/// input: under the static rule the command's `scopes` (named in the refusal), under a resolver
/// its `visible` and `known` (a refusal naming no scope; a command it does not know has made the
/// task unknown before, [`task_known`]). A command no longer exposed to MCP has no scope of
/// its own.
pub(crate) fn task_refusal(
    server: &McpServer,
    auth: &Authorization,
    command: &str,
    credentials: &Credentials,
) -> Option<rmcp::ErrorData> {
    let definition = server
        .inner
        .registry
        .get(command)
        .filter(|definition| definition.expose.mcp)?;
    let missing = match &auth.resolver {
        Some(_) if scopes::visible(auth, &definition, credentials) => return None,
        Some(_) => Vec::new(),
        None => match scopes::static_decision(
            &[],
            definition.scopes.as_deref().unwrap_or_default(),
            &credentials.scopes,
        ) {
            ScopeDecision::Missing(missing) => missing,
            ScopeDecision::Allowed | ScopeDecision::Defer => return None,
        },
    };
    Some(error_data(auth, &Refused::MissingScopes(missing)))
}

/// The names of `registry`'s commands that `admits`, as a filter: each command is decided once,
/// when the request arrives, so a filter consulted many times (and by a task's runner after the
/// request is answered) never asks the resolver again.
fn snapshot(
    registry: &crate::CommandRegistry,
    admits: impl Fn(&crate::CommandDefinition) -> bool,
) -> Visibility {
    let names: std::collections::HashSet<String> = registry
        .list()
        .into_iter()
        .filter(|command| admits(command))
        .map(|command| command.name.clone())
        .collect();
    Visibility(Arc::new(names))
}

/// Whether a task's `command` still exists for its owner (M6, "Hidden commands"): a task whose
/// command the owner no longer knows is answered as a task that does not exist.
pub(crate) fn task_known(auth: &Authorization, command: &str, credentials: &Credentials) -> bool {
    scopes::knows(auth, command, credentials)
}

/// The listing filter for a caller, when the server filters listings and the caller has
/// credentials: decided once per request ([`snapshot`]).
pub(crate) fn visibility(
    auth: &Authorization,
    registry: &crate::CommandRegistry,
    credentials: Option<&Arc<Credentials>>,
) -> Option<Visibility> {
    if !auth.filter_tools_by_scope {
        return None;
    }
    let credentials = credentials?;
    Some(snapshot(registry, |command| {
        scopes::visible(auth, command, credentials)
    }))
}

/// Which commands exist for a caller (M6, "Hidden commands"), when the server filters listings,
/// a resolver is installed and the caller has credentials: a command the resolver's `known`
/// rejects is answered as a name that does not exist, on every route. Decided once per request
/// ([`snapshot`]), so a task created by the request runs with the answer given while it was in
/// flight.
pub(crate) fn known(
    auth: &Authorization,
    registry: &crate::CommandRegistry,
    credentials: Option<&Arc<Credentials>>,
) -> Option<Visibility> {
    scopes::hider(auth)?;
    let credentials = credentials?;
    Some(snapshot(registry, |command| {
        scopes::knows(auth, &command.name, credentials)
    }))
}

/// The decision at execute time (M6, "At execution"), when a resolver is installed: the
/// registry asks it for every command it runs with credentials, on the validated input.
pub(crate) fn execution_check(auth: &Arc<Authorization>) -> Option<ScopeCheck> {
    auth.resolver.as_ref()?;
    let auth = Arc::clone(auth);
    Some(ScopeCheck(Arc::new(
        move |command, input, credentials| match scopes::execution_decision(
            &auth,
            command,
            input,
            credentials,
        ) {
            scopes::RequestDecision::Proceed => None,
            scopes::RequestDecision::Forbidden(missing) => {
                Some(insufficient_scope(&auth, &missing))
            }
        },
    )))
}

/// The Streamable HTTP service behind its bearer layer, as
/// [`McpServer::authorized_http_service`] builds it.
pub type AuthorizedHttpService = BearerService<
    rmcp::transport::streamable_http_server::StreamableHttpService<
        McpServer,
        rmcp::transport::streamable_http_server::session::local::LocalSessionManager,
    >,
>;

impl McpServer {
    /// Authorize requests with `authorization` (`spec/authorization.md`; see
    /// [`self::auth`](crate::server::auth)). The server then fails closed on any request whose
    /// credentials its own [bearer layer](Self::authorized_http_service) did not admit, decides
    /// every call that carries credentials, and filters listings when asked. stdio through
    /// [`Self::serve_stdio`] is unaffected; another transport must be marked trusted
    /// ([`Self::with_trusted_transport`]) to be served at all. It replaces any authorization set
    /// before.
    pub fn with_authorization(self, authorization: Authorization) -> Self {
        let authorization = Arc::new(authorization);
        self.with(|inner| inner.auth = Some(authorization))
    }

    /// The Streamable HTTP endpoint behind its bearer layer, both built from this server: the
    /// way to serve an authorized server over HTTP. Mount the service where it receives both the
    /// MCP path and the protected-resource metadata paths (`/.well-known/oauth-protected-resource`
    /// and the same followed by the resource's path), for example as the router's fallback;
    /// it answers the metadata itself. Build it after every other builder.
    ///
    /// [`Self::streamable_http_service`] alone serves no authorized request: without the layer,
    /// no request carries admitted credentials, so every one is refused with `UNAUTHORIZED`.
    ///
    /// # Errors
    /// The server has no [`Self::with_authorization`], or [`Self::validate`] fails.
    pub fn authorized_http_service(
        &self,
        options: super::HttpOptions,
    ) -> Result<AuthorizedHttpService, String> {
        let layer = self.bearer_layer()?;
        let service = self.try_streamable_http_service(options)?;
        Ok(tower_layer::Layer::layer(&layer, service))
    }

    /// The bearer layer alone, for a host that composes its own HTTP stack: put it outermost
    /// over a service built from this same server ([`Self::authorized_http_service`] does both).
    /// The server accepts only credentials admitted by its own authorization, so a layer from
    /// another server's authorization is refused like no layer at all.
    ///
    /// # Errors
    /// The server has no [`Self::with_authorization`].
    pub fn bearer_layer(&self) -> Result<BearerLayer, String> {
        let auth = self.inner.auth.clone().ok_or(
            "[AFD] bearer_layer needs with_authorization: the server has no authorization configured",
        )?;
        Ok(BearerLayer::new(PreDispatchCheck::new(self.clone(), auth)))
    }

    /// The bearer layer's decision before dispatch (`spec/authorization.md`, M6), for a host
    /// whose own HTTP layer admits credentials instead of the bearer layer
    /// ([`Authorization::admit`]), such as a gateway that vouches for each caller. Run
    /// [`PreDispatchCheck::decide`] on each request after admitting its credentials and reading
    /// its body, and pass the request on only when it says [`PreDispatch::Proceed`]: a missing
    /// scope is then the bearer layer's 403 before dispatch, decided by the same code, instead
    /// of `INSUFFICIENT_SCOPE` after routing. Build it from the server the service is built from,
    /// after every other builder, as [`Self::bearer_layer`].
    ///
    /// # Errors
    /// The server has no [`Self::with_authorization`].
    pub fn pre_dispatch_check(&self) -> Result<PreDispatchCheck, String> {
        let auth = self.inner.auth.clone().ok_or(
            "[AFD] pre_dispatch_check needs with_authorization: the server has no authorization configured",
        )?;
        Ok(PreDispatchCheck::new(self.clone(), auth))
    }

    /// Serve this server over a transport that carries no HTTP request and whose callers the
    /// host trusts as it trusts a stdio peer: an in-process pipe or a custom transport given to
    /// `rmcp`'s `ServiceExt::serve`. On a server with authorization, requests on such a
    /// transport carry no credentials and are checked against no scope (M1, "Unaffected"), so
    /// the host must authenticate the peer itself, as the process boundary does for stdio.
    /// Without this, an authorized server refuses every request that has no HTTP request with
    /// `UNAUTHORIZED`. [`Self::serve_stdio`] marks its own connection trusted. HTTP requests are
    /// never affected: they always need admitted credentials.
    pub fn with_trusted_transport(self) -> Self {
        self.with(|inner| inner.trusted_transport = true)
    }
}

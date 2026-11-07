//! OAuth 2.1 resource-server authorization for the MCP server over HTTP (feature `server-auth`),
//! as `spec/authorization.md` specifies it (MCP 2026-07-28 Authorization).
//!
//! It is opt-in. [`McpServer::with_authorization`](super::McpServer::with_authorization) configures
//! it with an [`Authorization`]: the [`ProtectedResource`] metadata, a [`TokenVerifier`] (AFD's
//! [`JwtVerifier`], or the host's, for introspection), the server's required scopes, an optional
//! [`ScopeResolver`] and whether listings are filtered by scope.
//! [`McpServer::bearer_layer`](super::McpServer::bearer_layer) then gives the [`BearerLayer`] to put
//! in front of [`McpServer::streamable_http_service`](super::McpServer::streamable_http_service):
//!
//! ```no_run
//! # fn run(keys: afd::server::auth::StaticKeys) -> Result<(), String> {
//! use std::sync::Arc;
//! use afd::server::auth::{
//!     Authorization, JwtIssuer, JwtVerifier, ProtectedResource, SigningAlgorithm, TokenRules,
//! };
//! use afd::server::{HttpOptions, McpServer};
//! use afd::CommandRegistry;
//! use tower::Layer;
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
//! let service = server
//!     .bearer_layer()?
//!     .layer(server.streamable_http_service(HttpOptions::default()));
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
//! - **Fail closed** (M1). A server with authorization refuses an HTTP request that reaches it
//!   without verified credentials (the layer left out) with `UNAUTHORIZED`, before any command,
//!   hook or listing runs. stdio, the CLI, `DirectClient` and in-process registries are
//!   unaffected: they carry no credentials and no scope is checked on them.
//! - **Credentials** (M4) are on every call's [`CommandContext::credentials`](crate::CommandContext::credentials).
//!   Without a host mapping the actor is `{ kind: "agent", id: <clientId>, onBehalfOf: <subject> }`;
//!   the context hook sees both and may map the actor, but cannot change the credentials.
//! - **After routing** (M6), after the context hook and before the confirmation gate, every call
//!   that carries credentials is decided again; a missing scope fails it with
//!   `INSUFFICIENT_SCOPE` (`retryable: false`, `details.scopes`), a batch or pipeline as a whole.
//! - **Listing** (M6): with [`Authorization::with_filter_tools_by_scope`], `tools/list`,
//!   `afd-discover`, `afd-detail`, `afd-help`, `afd-docs`, `afd-schema` and grouped actions show
//!   only commands the caller may see, and `tools/list` carries `cacheScope: "private"`.
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
//! [`static_decision`] and [`forbidden_scopes`] (M6).

use std::fmt;
use std::sync::Arc;

use async_trait::async_trait;

pub use crate::credentials::Credentials;

mod bearer;
mod claims;
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
pub use jwt::{
    is_compact_jws, ClientCertificate, Jwk, JwtIssuer, JwtVerifier, KeyError, KeySource,
    SigningAlgorithm, StaticKeys,
};
pub use layer::{BearerBody, BearerLayer, BearerService};
pub use resource::{audience_accepts, ProtectedResource, PROTECTED_RESOURCE_WELL_KNOWN};
pub use scopes::{forbidden_scopes, static_decision, ScopeDecision, ScopeResolver};

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
        Ok(Self {
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

    /// Filter the listings by scope (`filterToolsByScope`). Default: `false`.
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
}

// ─── Server integration ──────────────────────────────────────────────────────────────────────

use rmcp::service::RequestContext;
use rmcp::RoleServer;
use serde_json::{json, Map, Value};

use crate::commands::Visibility;
use crate::{error_codes, CommandError};

use super::McpServer;

/// Why a request that reached the MCP service is refused before anything runs.
pub(crate) enum Refused {
    /// M1: an HTTP request without verified credentials.
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

/// The `INSUFFICIENT_SCOPE` failure for `missing` (`spec/authorization.md`, M6).
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

/// The verified credentials of the request `context` belongs to: `Ok(None)` without
/// authorization or off HTTP (stdio), `Err` for an HTTP request the bearer layer did not verify
/// (M1: fail closed).
pub(crate) fn request_credentials(
    context: &RequestContext<RoleServer>,
) -> Result<Option<Arc<Credentials>>, Refused> {
    let Some(parts) = context.extensions.get::<http::request::Parts>() else {
        return Ok(None);
    };
    match parts.extensions.get::<Credentials>() {
        Some(credentials) => Ok(Some(Arc::new(credentials.clone()))),
        None => Err(Refused::Unauthenticated),
    }
}

/// Fail closed, then check the required scopes of a request that names no command.
pub(crate) fn check_request(
    auth: &Authorization,
    context: &RequestContext<RoleServer>,
) -> Result<Option<Arc<Credentials>>, Refused> {
    let credentials = request_credentials(context)?;
    if let Some(credentials) = &credentials {
        let missing = scopes::request_missing(auth, credentials);
        if !missing.is_empty() {
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

/// The listing filter for a caller, when the server filters listings and the caller has
/// credentials.
pub(crate) fn visibility(
    auth: &Arc<Authorization>,
    credentials: Option<&Arc<Credentials>>,
) -> Option<Visibility> {
    if !auth.filter_tools_by_scope {
        return None;
    }
    let credentials = Arc::clone(credentials?);
    let auth = Arc::clone(auth);
    Some(Visibility(Arc::new(move |command| {
        scopes::visible(&auth, command, &credentials)
    })))
}

impl McpServer {
    /// Authorize HTTP requests with `authorization` (`spec/authorization.md`; see [`self::auth`](crate::server::auth)).
    /// The server then fails closed on any HTTP request that the [bearer layer](Self::bearer_layer)
    /// did not verify, decides every call that carries credentials, and filters listings when
    /// asked. stdio is unaffected. It replaces any authorization set before.
    pub fn with_authorization(self, authorization: Authorization) -> Self {
        let authorization = Arc::new(authorization);
        self.with(|inner| inner.auth = Some(authorization))
    }

    /// The bearer layer to put in front of [`Self::streamable_http_service`].
    ///
    /// # Errors
    /// The server has no [`Self::with_authorization`].
    pub fn bearer_layer(&self) -> Result<BearerLayer, String> {
        let auth = self.inner.auth.clone().ok_or(
            "[AFD] bearer_layer needs with_authorization: the server has no authorization configured",
        )?;
        Ok(BearerLayer::new(self.clone(), auth))
    }
}

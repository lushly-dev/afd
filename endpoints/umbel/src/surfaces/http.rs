//! The Streamable HTTP surface (phase 0 section 5; phase 5 sections 3.3, 6.2 and 6.3).
//!
//! **Mode `none`** serves phase 0's surface: `http.path` and `/health` behind the workspace's
//! bearer token. The token layer is access control, not identity (D32): loopback is reachable by
//! every process and every user on the machine, so every request, `/health` included, must carry
//! it. A valid token says nothing about who calls: the context hook still sets the one loopback
//! principal.
//!
//! **Mode `oauth`** serves the hosted surface, its layers outermost first (6.3):
//!
//! 1. TLS, with the client certificate per `client_auth` ([`tls`], [`listener`]);
//! 2. the body size limit (`http.max_body_bytes`, [`layers::cap_body`]);
//! 3. the per-IP limit (`limits.ip_requests_per_minute`, [`layers::limit_ip`]), before any
//!    verification work;
//! 4. the public routes: `/health` and the protected-resource metadata at both well-known paths;
//! 5. AFD's bearer layer ([`McpServer::bearer_layer`]), with the host's token verifier
//!    ([`crate::auth::verifier`]) built from `[auth.issuers]`, which maps each verified token to a
//!    caller (section 4.1) in the request's caller slot, and Umbel's scope resolver
//!    ([`crate::auth::scopes`]), whose 403 comes before dispatch;
//! 6. the token gate ([`layers::TokenGate`]): a token with no Umbel scope is refused (403) on every
//!    request, then the per-token limit (`limits.calls_per_minute`, keyed on the verified issuer,
//!    subject and client);
//! 7. AFD's host and origin checks, then the MCP service built from the same server, where the
//!    context hook runs.
//!
//! **Mode `gateway`** (phase 5 step 4, section 4.4) serves the same layers with the gateway layer
//! ([`gateway`]) in place of AFD's bearer layer at 5: the pinned channel and a verified,
//! single-use assertion per request, no protected-resource metadata, and the bearer layer's own
//! decision before dispatch (AFD's `PreDispatchCheck`), whose 403 is in the gateway's scheme.

#[cfg(feature = "auth")]
pub(crate) mod gateway;
pub(crate) mod layers;
pub(crate) mod listener;
#[cfg(feature = "auth")]
pub(crate) mod tls;

use crate::host::HostError;
#[cfg(feature = "auth")]
use crate::workspace::AuthMode;
use crate::workspace::{Workspace, WorkspaceError};
use afd::server::{HttpOptions, McpServer};
use axum::Router;
use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::middleware::{Next, from_fn_with_state};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::convert::Infallible;
use std::net::IpAddr;
use std::sync::Arc;
use tower::Service;
#[cfg(feature = "auth")]
use tower::ServiceExt;

#[cfg(feature = "auth")]
use afd::server::auth::{
    AuthRefusal, Authorization, Credentials, ProtectedResource, RuleCode, TokenVerifier,
};

/// The names a loopback `Host` header may carry, which AFD's default also allows.
const LOOPBACK_NAMES: [&str; 3] = ["localhost", "127.0.0.1", "[::1]"];

/// `HttpOptions` from configuration, for mode `none`: the loopback names, the bound IP when it is
/// another loopback address, and `http.allowed_hosts`; `http.allowed_origins`;
/// `http.max_body_bytes`.
pub(crate) fn options(workspace: &Workspace) -> HttpOptions {
    let http = &workspace.config().http;
    let mut allowed_hosts: Vec<String> = LOOPBACK_NAMES.iter().map(|name| (*name).into()).collect();
    let bound = match http.bind.ip() {
        IpAddr::V4(ip) => ip.to_string(),
        IpAddr::V6(ip) => format!("[{ip}]"),
    };
    allowed_hosts.push(bound);
    allowed_hosts.extend(http.allowed_hosts.iter().cloned());
    HttpOptions {
        allowed_hosts,
        allowed_origins: http.allowed_origins.clone(),
        max_body_bytes: max_body_bytes(workspace),
    }
}

/// `http.max_body_bytes` as a size.
fn max_body_bytes(workspace: &Workspace) -> usize {
    usize::try_from(workspace.config().http.max_body_bytes).unwrap_or(usize::MAX)
}

/// The HTTP surface, built and ready to serve on a listener: the router with its layers and, with
/// `[http.tls]`, the TLS acceptor. [`Host::http_server`](crate::Host::http_server) builds it.
pub struct HttpServer {
    router: Router,
    #[cfg(feature = "auth")]
    tls: Option<tokio_rustls::TlsAcceptor>,
    /// The person page's service, whose logins are checked when serving starts.
    #[cfg(feature = "auth")]
    person: Option<Arc<crate::person::service::PersonService>>,
    /// `http.trusted_proxies`: the peers whose connections open with a PROXY protocol header.
    proxies: Arc<[IpAddr]>,
}

impl std::fmt::Debug for HttpServer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HttpServer")
            .field("tls", &self.is_tls())
            .finish_non_exhaustive()
    }
}

impl HttpServer {
    /// Whether the surface terminates TLS itself (`[http.tls]`).
    pub fn is_tls(&self) -> bool {
        #[cfg(feature = "auth")]
        return self.tls.is_some();
        #[cfg(not(feature = "auth"))]
        false
    }

    /// Serve connections from `listener` until `shutdown` completes, then give the requests in
    /// flight up to ten seconds before dropping their connections. At most 1024 connections are
    /// served at once; a TLS handshake has ten seconds, a request's headers thirty, and its body
    /// thirty more. Each connection's peer address, and its TLS client certificate when it
    /// presented one, reach every request it carries; nothing a request sends can stand in for
    /// them.
    ///
    /// # Errors
    /// None today: a connection that fails its handshake or its HTTP exchange is dropped and
    /// logged at `debug`, and the server goes on.
    pub async fn serve(
        self,
        listener: tokio::net::TcpListener,
        shutdown: impl std::future::Future<Output = ()> + Send + 'static,
    ) -> std::io::Result<()> {
        #[cfg(feature = "auth")]
        let tls = self.tls;
        #[cfg(not(feature = "auth"))]
        let tls = None;
        // Each person login's provider is checked at start (step 2c's follow-up), so its
        // namespace's verified commands are served as soon as it passes, and again before its
        // cache ends.
        #[cfg(feature = "auth")]
        if let Some(person) = self.person {
            tokio::spawn(async move { person.check_logins().await });
        }
        listener::serve(listener, self.router, tls, self.proxies, shutdown).await;
        Ok(())
    }
}

/// The surface `workspace` configures, over `server`: mode `none` (with TLS when `[http.tls]` is
/// set), mode `oauth`, with the host's verifier built from `[auth]` (phase 5 step 2b) unless a
/// test filled the slot with `verifier`, or mode `gateway`, with the gateway layer built from
/// `[auth.gateway]` (phase 5 step 4).
///
/// # Errors
/// `WORKSPACE_CONFIG_INVALID` naming `auth.mode` for a mode this build does not serve, naming the
/// `[http.tls]` key whose file is missing or invalid, naming the `[auth]` key the verifier cannot
/// be built from (an introspection secret unset, for example), naming `auth.gateway.keys` when
/// the gateway's pinned key set cannot be used, or naming `mcp.first_class_tools` when the
/// server's surface is invalid; the errors of reading `state/keys/http.token` in mode `none`,
/// and of opening `state/shared/limits.sqlite3` in the hosted modes.
pub(crate) fn server(
    server: &McpServer,
    workspace: &Workspace,
    #[cfg(feature = "auth")] policy: &Arc<crate::auth::scopes::ScopePolicy>,
    #[cfg(feature = "auth")] verifier: Option<Arc<dyn TokenVerifier>>,
    #[cfg(feature = "auth")] environment: &crate::auth::fetch::AuthEnvironment,
    #[cfg(feature = "auth")] person: Option<&Arc<crate::person::service::PersonService>>,
) -> Result<HttpServer, HostError> {
    #[cfg(not(feature = "auth"))]
    {
        refuse_without_auth(workspace)?;
        Ok(HttpServer {
            router: router(server, workspace)?,
            proxies: Arc::from(Vec::new()),
        })
    }
    #[cfg(feature = "auth")]
    {
        let config = workspace.config();
        let router = match config.auth.mode {
            AuthMode::None => router(server, workspace)?,
            AuthMode::Oauth => {
                let verifier: Arc<dyn TokenVerifier> = match verifier {
                    Some(verifier) => verifier,
                    None => {
                        // Every disclosure control mode `oauth` waited for is in: the doctor's
                        // hosted answers (step 2c), one answer and the listings (step 3), and
                        // exact filtering (step 7), so a shipped build serves it.
                        let verifier = crate::auth::verifier::HostVerifier::from_config(
                            config,
                            workspace.root(),
                            environment,
                        )?;
                        Arc::new(verifier)
                    }
                };
                oauth_router(server, workspace, policy, verifier, person)?
            }
            AuthMode::Gateway => gateway::router(server, workspace, policy, environment, person)?,
        };
        let tls = config
            .http
            .tls
            .as_ref()
            .map(|tls| tls::acceptor(workspace.root(), tls))
            .transpose()?;
        Ok(HttpServer {
            router,
            tls,
            person: person.filter(|_| config.auth.mode.is_hosted()).cloned(),
            proxies: Arc::from(config.http.trusted_proxies.clone()),
        })
    }
}

/// A `WORKSPACE_CONFIG_INVALID` naming `key`, with `details.key`.
fn not_served(key: &str, problem: &str) -> HostError {
    WorkspaceError::config_invalid(key, problem).into()
}

/// Without the `auth` feature the surface serves phase 0's loopback token only.
#[cfg(not(feature = "auth"))]
fn refuse_without_auth(workspace: &Workspace) -> Result<(), HostError> {
    let config = workspace.config();
    let key = if config.auth.mode.is_hosted() {
        "auth.mode"
    } else if config.http.tls.is_some() {
        "http.tls"
    } else {
        return Ok(());
    };
    Err(not_served(
        key,
        "asks for the hosted HTTP surface (TLS, token verification, the protected-resource metadata), which this build of umbel leaves out (it was built without the `auth` feature)",
    ))
}

/// The router alone, for an embedder or an in-process driver: phase 0's surface (mode `none`,
/// no TLS) behind the body size limit. A hosted mode or `[http.tls]` needs the listener, which
/// terminates TLS and knows each connection's peer address, so it is refused here.
///
/// # Errors
/// `WORKSPACE_CONFIG_INVALID` naming `auth.mode` or `http.tls`; the errors of [`server`]'s
/// mode `none`.
pub(crate) fn plain_router(server: &McpServer, workspace: &Workspace) -> Result<Router, HostError> {
    let config = workspace.config();
    let key = if config.auth.mode.is_hosted() {
        "auth.mode"
    } else if config.http.tls.is_some() {
        "http.tls"
    } else {
        return router(server, workspace);
    };
    Err(not_served(
        key,
        "asks for TLS or a hosted mode, which only the HTTP listener serves (Host::http_server, as `umbel serve --http` uses it), not a bare router",
    ))
}

/// Mode `none`: the MCP endpoint at `http.path` and `GET /health`, behind the token layer, behind
/// the body size limit.
///
/// # Errors
/// `WORKSPACE_KEY_INVALID` when `state/keys/http.token` exists but is malformed, and
/// `WORKSPACE_STATE_UNWRITABLE` when it cannot be created; `WORKSPACE_CONFIG_INVALID` naming
/// `mcp.first_class_tools` when the server's surface is invalid.
fn router(server: &McpServer, workspace: &Workspace) -> Result<Router, HostError> {
    let token = workspace.http_token()?;
    let service = server
        .try_streamable_http_service(options(workspace))
        .map_err(invalid_surface)?;
    let path = workspace.config().http.path.clone();
    // An exact-path service rather than `nest_service`: the path is deployer text, and axum
    // reads braces and wildcards in a nested path as captures.
    let mcp = tower::service_fn(move |request: Request| {
        let mut service = service.clone();
        let at_path = request.uri().path() == path;
        async move {
            if !at_path {
                return Ok::<Response, Infallible>(StatusCode::NOT_FOUND.into_response());
            }
            match service.call(request).await {
                Ok(response) => Ok(response.into_response()),
                Err(never) => match never {},
            }
        }
    });
    let bearer = Arc::new(Bearer::new(&token, &workspace.layout().http_token()));
    Ok(Router::new()
        .route("/health", get(health))
        .fallback_service(mcp)
        .layer(from_fn_with_state(bearer, require_bearer))
        .layer(from_fn_with_state(
            max_body_bytes(workspace),
            layers::cap_body,
        )))
}

fn invalid_surface(message: String) -> HostError {
    HostError::config_invalid(
        "mcp.first_class_tools",
        &format!("is not valid: {message}"),
        "Name 1 to 8 registered commands that are exposed to MCP.",
    )
}

/// The protected-resource metadata of section 3.3: `resource` is `http.public_url`;
/// `authorization_servers` lists, in configuration order, every issuer whose access tokens are
/// accepted (not a login-only issuer); `scopes_supported` is `<prefix>:read` alone, the rest
/// arriving by step-up; `tls_client_certificate_bound_access_tokens` is
/// `auth.require_bound_tokens`. Nothing else is published, `resource_name` included.
#[cfg(feature = "auth")]
pub(crate) fn protected_resource(workspace: &Workspace) -> Result<ProtectedResource, HostError> {
    let config = workspace.config();
    let invalid = |key: &str, message: String| -> HostError {
        WorkspaceError::config_invalid(key, format!("cannot be published: {message}")).into()
    };
    let resource = config.http.public_url.as_deref().ok_or_else(|| {
        HostError::from(WorkspaceError::config_invalid(
            "http.public_url",
            "is required when auth.mode is not \"none\"",
        ))
    })?;
    let servers: Vec<&str> = config
        .auth
        .issuers
        .iter()
        .filter(|issuer| issuer.access_tokens)
        .map(|issuer| issuer.issuer.as_str())
        .collect();
    ProtectedResource::new(resource, servers)
        .map_err(|message| invalid("auth.issuers", message))?
        .with_scopes_supported([format!("{}:read", config.auth.scope_prefix)])
        .map_err(|message| invalid("auth.scope_prefix", message))
        .map(|metadata| metadata.with_bound_tokens_required(config.auth.require_bound_tokens))
}

/// A verifier that verifies nothing: every token is refused as `unavailable`.
#[cfg(feature = "auth")]
struct Unverifiable;

#[cfg(feature = "auth")]
#[async_trait::async_trait]
impl TokenVerifier for Unverifiable {
    async fn verify(
        &self,
        _token: &str,
        _request: &axum::http::request::Parts,
    ) -> Result<Credentials, AuthRefusal> {
        Err(AuthRefusal::new(RuleCode::Unavailable))
    }
}

/// The authorization the host's own MCP server carries in a hosted mode, so that it fails closed
/// however it is served (phase 5 section 6.3; AFD's M1). Every HTTP request needs credentials
/// admitted for this authorization, which nothing admits: its verifier refuses every token, and
/// [`server`]'s listener serves a server of its own, with the verifier slot's authorization. So
/// an embedder serving [`Host::mcp_server`](crate::Host::mcp_server) over HTTP itself, with or
/// without its bearer layer, serves no method, listings and `initialize` included. stdio through
/// `serve_stdio` is unaffected; another transport must be marked trusted. `None` in mode `none`.
/// Mode `gateway` publishes no metadata, so its resource names only the public URL; nothing
/// serves it, and the listener serves a server with an authorization of its own
/// ([`gateway::router`]).
#[cfg(feature = "auth")]
pub(crate) fn base_authorization(
    workspace: &Workspace,
) -> Result<Option<Authorization>, HostError> {
    let config = workspace.config();
    let metadata = match config.auth.mode {
        AuthMode::None => return Ok(None),
        AuthMode::Oauth => protected_resource(workspace)?,
        AuthMode::Gateway => {
            let resource = config.http.public_url.as_deref().unwrap_or_default();
            ProtectedResource::new(resource, [resource]).map_err(|message| {
                HostError::from(WorkspaceError::config_invalid(
                    "http.public_url",
                    format!("cannot be used: {message}"),
                ))
            })?
        }
    };
    Authorization::new(metadata, Unverifiable)
        .map(Some)
        .map_err(|message| {
            HostError::from(WorkspaceError::config_invalid(
                "auth.mode",
                format!("cannot be served: {message}"),
            ))
        })
}

/// Mode `oauth`: layers 2 to 7 of section 6.3 around the MCP service, which the bearer layer and
/// the service share through one authorized server.
#[cfg(feature = "auth")]
fn oauth_router(
    server: &McpServer,
    workspace: &Workspace,
    policy: &Arc<crate::auth::scopes::ScopePolicy>,
    verifier: Arc<dyn TokenVerifier>,
    person: Option<&Arc<crate::person::service::PersonService>>,
) -> Result<Router, HostError> {
    let config = workspace.config();
    let metadata = protected_resource(workspace)?;
    // The bearer layer serves these itself, without authentication (M7), before any token work.
    let mut routed = metadata.metadata_paths();
    routed.push(config.http.path.clone());
    // The requests in flight, each with the caller its token was mapped to, for the resolver.
    let book = crate::auth::caller::CallerBook::default();
    let authorization = Authorization::new(metadata.clone(), verifier)
        .map_err(|message| {
            HostError::from(WorkspaceError::config_invalid(
                "http.public_url",
                format!("disagrees with the token verifier: {message}"),
            ))
        })?
        .with_filter_tools_by_scope(config.auth.filter_tools_by_scope)
        .with_resolver(crate::auth::scopes::UmbelScopes::new(
            Arc::clone(policy),
            book.clone(),
        ))
        .with_max_body_bytes(max_body_bytes(workspace));
    // The hosted surface admits only the configured public names: no loopback name is implied,
    // so a request must name the host `http.public_url` and `allowed_hosts` publish. An empty
    // list would switch AFD's host check off, so it is refused (configuration version 5 already
    // requires the public URL's host in it).
    if config.http.allowed_hosts.is_empty() {
        return Err(not_served(
            "http.allowed_hosts",
            "is empty, which would admit any Host header; name the public URL's host",
        ));
    }
    let options = HttpOptions {
        allowed_hosts: config.http.allowed_hosts.clone(),
        allowed_origins: config.http.allowed_origins.clone(),
        max_body_bytes: max_body_bytes(workspace),
    };
    let authorized = server.clone().with_authorization(authorization);
    let bearer = authorized
        .bearer_layer()
        .map_err(|message| invalid_surface(message.to_owned()))?;
    let service = authorized
        .try_streamable_http_service(options)
        .map_err(invalid_surface)?;
    let limits: Arc<dyn crate::shared::limits::LimitStore> =
        Arc::new(crate::shared::limits::SqliteLimits::open(
            &workspace.layout().limits_store(),
            config.store.lock_timeout_ms,
        )?);
    let lock_timeout = std::time::Duration::from_millis(config.store.lock_timeout_ms);
    // Layer 6, between the bearer layer and the service.
    let gated = layers::TokenGate::new(
        service,
        layers::SlidingLimit::new(
            Arc::clone(&limits),
            config.limits.calls_per_minute,
            lock_timeout,
        ),
        workspace.limits_key()?,
        layers::NoScope::Bearer(metadata),
        &config.auth.scope_prefix,
    );
    let service = tower::Layer::layer(&bearer, gated);
    let page = person_page(person, &config.http.path);
    let mcp = tower::service_fn(move |mut request: Request| {
        let service = service.clone();
        // The person page's routes, beside the MCP path and never behind the bearer layer (6.3,
        // layer 4): they authenticate by their own login.
        let page = page
            .clone()
            .filter(|page| page.serves(request.uri().path()));
        let at_path = routed.iter().any(|path| path == request.uri().path());
        // A fresh slot for the caller the verifier maps, replacing anything already there; the
        // context hook trusts it only beside the credentials AFD admits for the same request, and
        // the resolver finds it in the book while the request is in flight.
        let slot = crate::auth::caller::CallerSlot::default();
        request.extensions_mut().insert(slot.clone());
        let entry = page.is_none().then(|| book.enter(slot));
        async move {
            if let Some(page) = page {
                return Ok::<Response, Infallible>(page.handle(request).await);
            }
            if !at_path {
                return Ok::<Response, Infallible>(StatusCode::NOT_FOUND.into_response());
            }
            let response = match service.oneshot(request).await {
                Ok(response) => Ok(response.map(Body::new)),
                Err(never) => match never {},
            };
            drop(entry);
            response
        }
    });
    let ip = Arc::new(layers::IpLimit::new(
        limits,
        config.limits.ip_requests_per_minute,
        lock_timeout,
    ));
    tracing::info!(
        target: "umbel::http",
        "auth.mode = \"oauth\": serving {} with the protected-resource metadata",
        config.http.public_url.as_deref().unwrap_or_default()
    );
    // `layer` wraps what is already there, so the last one added is the outermost.
    Ok(Router::new()
        .route("/health", get(health))
        .fallback_service(mcp)
        .layer(from_fn_with_state(ip, layers::limit_ip))
        .layer(from_fn_with_state(
            max_body_bytes(workspace),
            layers::cap_body,
        )))
}

/// The person page's routes under `path`, in a hosted mode with a person service.
#[cfg(feature = "auth")]
pub(crate) fn person_page(
    person: Option<&Arc<crate::person::service::PersonService>>,
    path: &str,
) -> Option<crate::person::page::PersonPage> {
    person.and_then(|service| crate::person::page::PersonPage::new(Arc::clone(service), path))
}

async fn health() -> Response {
    json_response(StatusCode::OK, &json!({ "status": "ok" }).to_string())
}

fn json_response(status: StatusCode, body: &str) -> Response {
    let mut response = Response::new(Body::from(body.to_owned()));
    *response.status_mut() = status;
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        header::HeaderValue::from_static("application/json"),
    );
    response
}

/// The stored token as a digest, and the body of a refusal.
struct Bearer {
    digest: [u8; 32],
    refusal: String,
}

impl Bearer {
    fn new(token: &str, token_file: &std::path::Path) -> Self {
        Self {
            digest: Sha256::digest(token.as_bytes()).into(),
            refusal: json!({
                "error": "UNAUTHORIZED",
                "suggestion": format!(
                    "Send Authorization: Bearer <token>; the token is in {}, readable by the workspace owner.",
                    token_file.display()
                ),
            })
            .to_string(),
        }
    }

    /// Whether the request carries the token. Both sides are hashed first, so the comparison's
    /// time does not depend on how much of the token matches.
    fn permits(&self, headers: &HeaderMap) -> bool {
        let Some(value) = headers
            .get(header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
        else {
            return false;
        };
        let Some((scheme, presented)) = value.split_once(' ') else {
            return false;
        };
        if !scheme.eq_ignore_ascii_case("bearer") {
            return false;
        }
        let presented: [u8; 32] = Sha256::digest(presented.trim().as_bytes()).into();
        presented
            .iter()
            .zip(self.digest.iter())
            .fold(0u8, |difference, (a, b)| difference | (a ^ b))
            == 0
    }

    fn refuse(&self) -> Response {
        let mut response = json_response(StatusCode::UNAUTHORIZED, &self.refusal);
        response.headers_mut().insert(
            header::WWW_AUTHENTICATE,
            header::HeaderValue::from_static("Bearer realm=\"umbel\""),
        );
        response
    }
}

async fn require_bearer(
    State(bearer): State<Arc<Bearer>>,
    request: Request,
    next: Next,
) -> Response {
    if bearer.permits(request.headers()) {
        next.run(request).await
    } else {
        bearer.refuse()
    }
}

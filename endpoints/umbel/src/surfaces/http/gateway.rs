//! Mode `gateway`'s HTTP surface (phase 5 specification, sections 4.4 and 6.3): layers 2 to 7
//! around the MCP service, with the gateway layer in place of AFD's bearer layer.
//!
//! 1. TLS, with the client certificate per `client_auth` (the listener).
//! 2. The body size limit, then 3. the per-IP limit, both before any verification work. A
//!    connection presenting a pinned gateway certificate is authenticated at the channel and
//!    skips the per-IP limit ([`limit_ip_unless_pinned`]); the per-caller limits govern it.
//! 4. `/health` only: mode `gateway` publishes no protected-resource metadata (section 3.3), so
//!    both well-known paths, like every path but `http.path`, are 404.
//! 5. **The gateway layer** ([`GatewayService`]): the pinned channel, then the one assertion,
//!    then its `jti` spent once in the shared nonce store
//!    ([`crate::auth::gateway::GatewayVerifier`]). A refusal is one 401 with
//!    `WWW-Authenticate: Umbel-Gateway realm="umbel"` and a body naming no reason. A verified
//!    request's caller goes into its caller slot and its credentials are admitted for the served
//!    server's own authorization (AFD's `Authorization::admit`), so the context hook, the
//!    resolver's `visible` and `known`, and the decisions after routing and at execution see it
//!    as they see a verified token's. The assertion and any `Authorization` header are removed
//!    before anything behind the layer runs. Then, with the body read, the layer runs AFD's own
//!    decision before dispatch ([`afd::server::auth::PreDispatchCheck`], the one AFD's bearer
//!    layer runs): a call missing a scope is section 5.2's 403 before dispatch, one for a whole
//!    batch or pipeline, naming every missing scope in step order, with the gateway's challenge
//!    ([`crate::auth::gateway::scope_challenge`]) and a suggestion naming a new assertion. A
//!    hidden command is decided as a name that does not exist, as AFD decides it.
//! 6. The token gate: credentials whose scopes, cut to the ceiling, hold no Umbel scope are 403;
//!    then the per-token limit, keyed on the gateway's issuer, the subject and the client.
//! 7. AFD's host and origin checks, then the MCP service, where the decision after routing
//!    (`INSUFFICIENT_SCOPE`) and at execution stay as the second and third lines.

use std::convert::Infallible;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};

use afd::server::auth::{Authorization, PreDispatch, PreDispatchCheck, ProtectedResource};
use afd::server::{HttpOptions, McpServer};
use axum::Router;
use axum::body::{Body, Bytes};
use axum::extract::Request;
use axum::http::{HeaderValue, StatusCode, header};
use axum::middleware::from_fn_with_state;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use http_body_util::{BodyExt, Full};
use tower::ServiceExt;

use super::layers::{self, GateBody};
use crate::auth::caller::{CallerBook, CallerSlot};
use crate::auth::gateway::{self, GatewayVerifier, Refusal, Rule};
use crate::host::HostError;
use crate::shared::SharedError;
use crate::workspace::{Workspace, WorkspaceError};

/// A body for a response the gateway layer makes itself.
fn gate_body(text: String) -> GateBody {
    Full::new(Bytes::from(text))
        .map_err(|never: Infallible| match never {})
        .boxed()
}

/// The 401 of every gateway refusal (4.4): the same challenge and body whatever the reason.
fn unauthorized() -> axum::http::Response<GateBody> {
    let body = serde_json::json!({
        "error": afd::error_codes::UNAUTHORIZED,
        "suggestion": gateway::SUGGESTION,
    });
    let mut response = axum::http::Response::new(gate_body(body.to_string()));
    *response.status_mut() = StatusCode::UNAUTHORIZED;
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    headers.insert(
        header::WWW_AUTHENTICATE,
        HeaderValue::from_static(gateway::CHALLENGE),
    );
    response
}

/// A shared store's failure, as layers 3 and 6 answer theirs: 503 `WORKSPACE_SHARED_TIMEOUT`
/// with `Retry-After: 1` for a lock wait, 500 otherwise. Nothing was spent; the request fails
/// closed and may be retried with a new assertion.
fn shared_failure(error: &SharedError) -> axum::http::Response<GateBody> {
    let (status, body) = match error {
        SharedError::Timeout { store } => (
            StatusCode::SERVICE_UNAVAILABLE,
            serde_json::json!({
                "error": crate::shared::codes::WORKSPACE_SHARED_TIMEOUT,
                "suggestion": "The server's shared state is busy; retry in a moment.",
                "details": { "store": store },
            }),
        ),
        SharedError::Failed { .. } => (StatusCode::INTERNAL_SERVER_ERROR, serde_json::json!({})),
    };
    let mut response = axum::http::Response::new(gate_body(body.to_string()));
    *response.status_mut() = status;
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    if status == StatusCode::SERVICE_UNAVAILABLE {
        headers.insert(header::RETRY_AFTER, HeaderValue::from_static("1"));
    }
    response
}

struct Shared {
    verifier: GatewayVerifier,
    /// The served server's own authorization, whose `admit` marks the credentials it accepts.
    authorization: Authorization,
    /// AFD's decision before dispatch, from the served server, with the gateway's challenge.
    check: PreDispatchCheck,
}

/// Layer 5 in mode `gateway` (see the module's documentation), over layer 6.
#[derive(Clone)]
pub(crate) struct GatewayService<S> {
    inner: S,
    shared: Arc<Shared>,
}

impl<S> tower::Service<Request> for GatewayService<S>
where
    S: tower::Service<
            axum::http::Request<Full<Bytes>>,
            Response = axum::http::Response<GateBody>,
            Error = Infallible,
        > + Clone
        + Send
        + 'static,
    S::Future: Send + 'static,
{
    type Response = axum::http::Response<GateBody>;
    type Error = Infallible;
    type Future = Pin<Box<dyn Future<Output = Result<Self::Response, Self::Error>> + Send>>;

    fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.inner.poll_ready(cx)
    }

    fn call(&mut self, request: Request) -> Self::Future {
        // The inner service was readied for this call; keep a fresh clone for the next one.
        let clone = self.inner.clone();
        let mut inner = std::mem::replace(&mut self.inner, clone);
        let shared = Arc::clone(&self.shared);
        Box::pin(async move {
            let (mut parts, body) = request.into_parts();
            let refuse = |rule: Rule| {
                tracing::warn!(
                    target: "umbel::auth",
                    gateway = shared.verifier.alias(),
                    rule = rule.code(),
                    "refused a gateway request"
                );
                Ok(unauthorized())
            };
            // Before anything is verified (and so before a `jti` is spent), the slot the caller
            // goes into must be there: without it a layer is missing.
            let Some(slot) = parts.extensions.get::<CallerSlot>().cloned() else {
                tracing::error!(
                    target: "umbel::auth",
                    "refused a gateway request without the host's caller slot: a layer is missing"
                );
                return refuse(Rule::Unavailable);
            };
            let verified = shared.verifier.verify(&parts).await;
            // Nothing behind this layer reads the assertion or a token, whatever the outcome.
            parts.headers.remove(gateway::ASSERTION_HEADER);
            parts.headers.remove(header::AUTHORIZATION);
            let (credentials, caller) = match verified {
                Ok(verified) => verified,
                Err(Refusal::Rule(rule)) => return refuse(rule),
                Err(Refusal::Shared(error)) => {
                    if let SharedError::Failed { message, .. } = &error {
                        tracing::error!(
                            target: "umbel::auth",
                            gateway = shared.verifier.alias(),
                            "the shared nonce store could not spend an assertion's jti: {message}"
                        );
                    }
                    return Ok(shared_failure(&error));
                }
            };
            if !slot.fill(caller) {
                tracing::error!(
                    target: "umbel::auth",
                    "refused a second verification on one request"
                );
                return refuse(Rule::Unavailable);
            }
            shared
                .authorization
                .admit(&mut parts.extensions, credentials);
            // The body only now, once the caller is verified; layer 2 has capped it, and answers
            // 413 or 408 itself when it refused it.
            let bytes = match body.collect().await {
                Ok(collected) => collected.to_bytes(),
                Err(_) => {
                    let mut response = axum::http::Response::new(gate_body(String::new()));
                    *response.status_mut() = StatusCode::BAD_REQUEST;
                    return Ok(response);
                }
            };
            // 5.2: a missing scope is a 403 before dispatch, decided by AFD's bearer layer's own
            // code on the credentials just admitted.
            if let PreDispatch::Respond(response) = shared.check.decide(&parts, &bytes) {
                return Ok(response.map(|body| body.map_err(|never| match never {}).boxed()));
            }
            inner
                .call(axum::http::Request::from_parts(parts, Full::new(bytes)))
                .await
        })
    }
}

/// Layer 3 in mode `gateway`: the per-IP limit, except for a connection whose TLS client
/// certificate (verified in the handshake, never a header) is one the gateway's
/// `client_cert_sha256` pins. Such a connection is the gateway itself, authenticated at the
/// channel, carrying many callers from one address; the per-caller limits after verification
/// (`calls_per_minute` and the read limit) govern it. Every other connection keeps the per-IP
/// limit, before any verification work.
struct IpGate {
    limit: Arc<layers::IpLimit>,
    pins: std::collections::BTreeSet<String>,
}

async fn limit_ip_unless_pinned(
    axum::extract::State(gate): axum::extract::State<Arc<IpGate>>,
    request: Request,
    next: axum::middleware::Next,
) -> Response {
    if gateway::certificate_pinned(&gate.pins, request.extensions()) {
        return next.run(request).await;
    }
    layers::limit_ip(axum::extract::State(Arc::clone(&gate.limit)), request, next).await
}

/// The authorization the served server holds in mode `gateway`: never published (section 3.3),
/// with a verifier that refuses every token, since only the gateway layer admits credentials;
/// Umbel's scope resolver over `book`, and listings filtered as `auth.filter_tools_by_scope`
/// says, as in mode `oauth`.
fn authorization(
    workspace: &Workspace,
    policy: &Arc<crate::auth::scopes::ScopePolicy>,
    book: &CallerBook,
) -> Result<Authorization, HostError> {
    let config = workspace.config();
    let invalid = |key: &str, message: String| -> HostError {
        WorkspaceError::config_invalid(key, format!("cannot be served: {message}")).into()
    };
    let resource = config.http.public_url.as_deref().ok_or_else(|| {
        HostError::from(WorkspaceError::config_invalid(
            "http.public_url",
            "is required when auth.mode is not \"none\"",
        ))
    })?;
    let issuer = config
        .auth
        .gateway
        .as_ref()
        .map_or(resource, |gateway| gateway.issuer.as_str());
    let metadata = ProtectedResource::new(resource, [issuer])
        .map_err(|message| invalid("http.public_url", message))?
        .with_scope_source(crate::auth::GATEWAY_SCOPE_SOURCE);
    Ok(Authorization::new(metadata, super::Unverifiable)
        .map_err(|message| invalid("auth.mode", message))?
        .with_filter_tools_by_scope(config.auth.filter_tools_by_scope)
        .with_resolver(crate::auth::scopes::UmbelScopes::new(
            Arc::clone(policy),
            book.clone(),
        ))
        .with_max_body_bytes(super::max_body_bytes(workspace)))
}

/// Mode `gateway`: layers 2 to 7 of section 6.3 around the MCP service (see the module's
/// documentation).
///
/// # Errors
/// `WORKSPACE_CONFIG_INVALID` naming `auth.gateway.keys` when the pinned key set cannot be used,
/// `http.allowed_hosts` when it is empty, or `mcp.first_class_tools`; the errors of opening
/// `state/shared/limits.sqlite3` and reading `state/keys/limits.key`.
pub(crate) fn router(
    server: &McpServer,
    workspace: &Workspace,
    policy: &Arc<crate::auth::scopes::ScopePolicy>,
    environment: &crate::auth::fetch::AuthEnvironment,
    person: Option<&Arc<crate::person::service::PersonService>>,
) -> Result<Router, HostError> {
    let config = workspace.config();
    let lock_timeout = std::time::Duration::from_millis(config.store.lock_timeout_ms);
    let nonces: Arc<dyn crate::shared::nonces::NonceStore> =
        Arc::new(crate::shared::nonces::SqliteNonces::new(
            &workspace.layout().nonces_store(),
            config.store.lock_timeout_ms,
        ));
    let verifier = GatewayVerifier::from_config(config, workspace.root(), environment, nonces)?;
    // As in mode `oauth`: only the configured public names, never an empty list.
    if config.http.allowed_hosts.is_empty() {
        return Err(super::not_served(
            "http.allowed_hosts",
            "is empty, which would admit any Host header; name the public URL's host",
        ));
    }
    let book = CallerBook::default();
    let authorization = authorization(workspace, policy, &book)?;
    let options = HttpOptions {
        allowed_hosts: config.http.allowed_hosts.clone(),
        allowed_origins: config.http.allowed_origins.clone(),
        max_body_bytes: super::max_body_bytes(workspace),
    };
    let challenge = gateway::scope_challenge().map_err(|message| {
        HostError::from(WorkspaceError::config_invalid(
            "auth.mode",
            format!("cannot be served: {message}"),
        ))
    })?;
    // The check and the service from one authorized server, so the check decides exactly the
    // credentials the service accepts.
    let authorized = server.clone().with_authorization(authorization.clone());
    let check = authorized
        .pre_dispatch_check()
        .map_err(super::invalid_surface)?
        .with_challenge(challenge.clone());
    let service = authorized
        .try_streamable_http_service(options)
        .map_err(super::invalid_surface)?;
    let limits: Arc<dyn crate::shared::limits::LimitStore> =
        Arc::new(crate::shared::limits::SqliteLimits::open(
            &workspace.layout().limits_store(),
            config.store.lock_timeout_ms,
        )?);
    // Layer 6, between the gateway layer and the service.
    let gated = layers::TokenGate::new(
        service,
        layers::SlidingLimit::new(
            Arc::clone(&limits),
            config.limits.calls_per_minute,
            lock_timeout,
        ),
        workspace.limits_key()?,
        layers::NoScope::Gateway {
            metadata: authorization.metadata().clone(),
            challenge,
        },
        verifier.prefix(),
    );
    let service = GatewayService {
        inner: gated,
        shared: Arc::new(Shared {
            verifier,
            authorization,
            check,
        }),
    };
    let path = config.http.path.clone();
    let page = super::person_page(person, &path);
    let mcp = tower::service_fn(move |mut request: Request| {
        let service = service.clone();
        // The person page's routes, before the gateway layer (6.3, layer 4): a gateway's person
        // is proven only there (4.4), by their own login.
        let page = page
            .clone()
            .filter(|page| page.serves(request.uri().path()));
        // MCP at `http.path` only; nothing is published, so no other path is served.
        let at_path = request.uri().path() == path;
        // A fresh slot for the caller the gateway layer maps, replacing anything already there;
        // the context hook trusts it only beside the credentials admitted for the same request,
        // and the resolver finds it in the book while the request is in flight.
        let slot = CallerSlot::default();
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
    let ip = Arc::new(IpGate {
        limit: Arc::new(layers::IpLimit::new(
            limits,
            config.limits.ip_requests_per_minute,
            lock_timeout,
        )),
        pins: config
            .auth
            .gateway
            .iter()
            .flat_map(|gateway| gateway.client_cert_sha256.iter().cloned())
            .collect(),
    });
    tracing::info!(
        target: "umbel::http",
        "auth.mode = \"gateway\": serving {} to the pinned gateway, with no metadata",
        config.http.public_url.as_deref().unwrap_or_default()
    );
    // `layer` wraps what is already there, so the last one added is the outermost.
    Ok(Router::new()
        .route("/health", get(super::health))
        .fallback_service(mcp)
        .layer(from_fn_with_state(ip, limit_ip_unless_pinned))
        .layer(from_fn_with_state(
            super::max_body_bytes(workspace),
            layers::cap_body,
        )))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use crate::auth::caller::Vouched;
    use crate::auth::fetch::AuthEnvironment;
    use crate::shared::nonces::NonceStore;
    use crate::surfaces::http::layers::LocalAddr;
    use crate::workspace::ConfigFile;
    use std::collections::HashSet;
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use umbel_testkit_idp::TestIdp;

    const PUBLIC_URL: &str = "https://127.0.0.1/mcp";

    /// A nonce store that answers as told, counting its spends.
    struct Store {
        calls: AtomicUsize,
        failure: Option<SharedError>,
        spent: Mutex<HashSet<String>>,
        /// Each spend's key and the expiry it asked for.
        expiries: Mutex<Vec<(String, i64)>>,
    }

    impl Store {
        fn new(failure: Option<SharedError>) -> Arc<Self> {
            Arc::new(Self {
                calls: AtomicUsize::new(0),
                failure,
                spent: Mutex::default(),
                expiries: Mutex::default(),
            })
        }
    }

    impl NonceStore for Store {
        fn consume(&self, key: &str, expires_ms: i64, _: i64) -> Result<bool, SharedError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.expiries
                .lock()
                .unwrap()
                .push((key.to_owned(), expires_ms));
            match &self.failure {
                Some(failure) => Err(failure.clone()),
                None => Ok(self.spent.lock().unwrap().insert(key.to_owned())),
            }
        }
    }

    type Inner = tower::util::BoxCloneService<
        axum::http::Request<Full<Bytes>>,
        axum::http::Response<GateBody>,
        Infallible,
    >;

    /// What the service behind the gateway layer saw of each request.
    #[derive(Default)]
    struct Seen {
        headers: Vec<axum::http::HeaderMap>,
        admitted: Vec<bool>,
    }

    async fn layer(
        kit: &TestIdp,
        store: Arc<Store>,
        seen: Arc<Mutex<Seen>>,
    ) -> (tempfile::TempDir, GatewayService<Inner>) {
        layer_requiring(kit, store, seen, &[]).await
    }

    /// [`layer`], with a served server whose authorization requires `required`.
    async fn layer_requiring(
        kit: &TestIdp,
        store: Arc<Store>,
        seen: Arc<Mutex<Seen>>,
        required: &[&str],
    ) -> (tempfile::TempDir, GatewayService<Inner>) {
        let dir = tempfile::tempdir().unwrap();
        let mut jwks = kit.gateway().jwks();
        for key in jwks["keys"].as_array_mut().unwrap() {
            let alg = match (key["kty"].as_str(), key["crv"].as_str()) {
                (Some("RSA"), _) => "RS256",
                (Some("EC"), Some("P-256")) => "ES256",
                (Some("EC"), _) => "ES384",
                _ => "EdDSA",
            };
            key["alg"] = serde_json::json!(alg);
        }
        std::fs::write(dir.path().join("jwks.json"), jwks.to_string()).unwrap();
        let text = format!(
            "config_version = 5\n[principal]\nlocal_id = \"corp/ada\"\n[http]\npublic_url = \"{PUBLIC_URL}\"\nallowed_hosts = [\"127.0.0.1\"]\n[auth]\nmode = \"gateway\"\n[auth.namespaces.corp]\n[auth.gateway]\nalias = \"edge\"\nnamespace = \"corp\"\nissuer = \"{}\"\nkeys = \"jwks.json\"\nmax_scopes = [\"umbel:read\"]\n",
            kit.gateway().issuer()
        );
        let config = ConfigFile::parse(&text)
            .and_then(|file| file.into_config(dir.path()))
            .unwrap();
        let verifier =
            GatewayVerifier::from_config(&config, dir.path(), &AuthEnvironment::default(), store)
                .unwrap();
        let authorization = Authorization::new(
            ProtectedResource::new(PUBLIC_URL, [PUBLIC_URL])
                .unwrap()
                .with_scope_source(crate::auth::GATEWAY_SCOPE_SOURCE),
            super::super::Unverifiable,
        )
        .unwrap()
        .with_required_scopes(required.iter().copied())
        .unwrap();
        let check = McpServer::new(Arc::new(afd::CommandRegistry::new()), "t", "0")
            .with_authorization(authorization.clone())
            .pre_dispatch_check()
            .unwrap()
            .with_challenge(gateway::scope_challenge().unwrap());
        let inner = tower::service_fn(move |request: axum::http::Request<Full<Bytes>>| {
            let seen = Arc::clone(&seen);
            async move {
                let mut seen = seen.lock().unwrap();
                seen.headers.push(request.headers().clone());
                seen.admitted
                    .push(request.extensions().get::<afd::Credentials>().is_some());
                Ok::<_, Infallible>(axum::http::Response::new(gate_body("{}".to_owned())))
            }
        });
        let service = GatewayService {
            inner: tower::util::BoxCloneService::new(inner),
            shared: Arc::new(Shared {
                verifier,
                authorization,
                check,
            }),
        };
        (dir, service)
    }

    fn request(kit: &TestIdp, slot: Option<&CallerSlot>) -> Request {
        request_with(kit.gateway().assertion(PUBLIC_URL, "POST").sign(), slot)
    }

    fn request_with(assertion: String, slot: Option<&CallerSlot>) -> Request {
        let mut request = axum::http::Request::builder()
            .method("POST")
            .uri("/mcp")
            .header(gateway::ASSERTION_HEADER, assertion)
            .header("authorization", "Bearer some-token")
            .header("x-user", "bo")
            .body(Body::from("{}"))
            .unwrap();
        request
            .extensions_mut()
            .insert(LocalAddr("127.0.0.1:8443".parse().unwrap()));
        if let Some(slot) = slot {
            request.extensions_mut().insert(slot.clone());
        }
        request
    }

    #[tokio::test]
    async fn the_layer_admits_a_verified_caller_and_passes_on_no_assertion_and_no_token() {
        let kit = TestIdp::start().await.unwrap();
        let seen = Arc::new(Mutex::new(Seen::default()));
        let store = Store::new(None);
        let (_dir, service) = layer(&kit, Arc::clone(&store), Arc::clone(&seen)).await;
        let slot = CallerSlot::default();
        let response = service.oneshot(request(&kit, Some(&slot))).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let seen = seen.lock().unwrap();
        assert_eq!(seen.admitted, [true]);
        let headers = &seen.headers[0];
        assert!(headers.get(gateway::ASSERTION_HEADER).is_none());
        assert!(headers.get(header::AUTHORIZATION).is_none());
        let caller = slot.caller().unwrap();
        assert_eq!(caller.vouched, Vouched::Gateway);
        assert_eq!(caller.claim_groups, Vec::<String>::new());
        assert_eq!(store.calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn a_missing_scope_is_refused_before_the_service_with_the_gateways_challenge() {
        let kit = TestIdp::start().await.unwrap();
        let seen = Arc::new(Mutex::new(Seen::default()));
        let store = Store::new(None);
        // The assertion grants `umbel:read`; the served server requires two scopes it lacks.
        let (_dir, service) = layer_requiring(
            &kit,
            Arc::clone(&store),
            Arc::clone(&seen),
            &["umbel:read", "umbel:write", "umbel:approve"],
        )
        .await;
        let slot = CallerSlot::default();
        let response = service.oneshot(request(&kit, Some(&slot))).await.unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert!(seen.lock().unwrap().headers.is_empty(), "nothing passed on");
        assert_eq!(
            response.headers()[header::WWW_AUTHENTICATE],
            "Umbel-Gateway realm=\"umbel\", error=\"insufficient_scope\", scope=\"umbel:write umbel:approve\""
        );
        assert_eq!(response.headers()[header::CONTENT_TYPE], "application/json");
        let body = response.into_body().collect().await.unwrap().to_bytes();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
            serde_json::json!({
                "error": "INSUFFICIENT_SCOPE",
                "suggestion": "Obtain a new Umbel-Gateway-Assertion from the gateway, within its scope ceiling, that also grants umbel:write umbel:approve, then retry.",
            })
        );
        // The caller was verified and its assertion spent: the refusal is a scope's, not a 401.
        assert_eq!(store.calls.load(Ordering::SeqCst), 1);
        assert!(slot.caller().is_some());
    }

    #[tokio::test]
    async fn without_its_slot_the_layer_refuses_before_spending_anything() {
        let kit = TestIdp::start().await.unwrap();
        let seen = Arc::new(Mutex::new(Seen::default()));
        let store = Store::new(None);
        let (_dir, service) = layer(&kit, Arc::clone(&store), Arc::clone(&seen)).await;
        let response = service.oneshot(request(&kit, None)).await.unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(store.calls.load(Ordering::SeqCst), 0);
        assert!(seen.lock().unwrap().headers.is_empty());
    }

    #[tokio::test]
    async fn a_store_that_cannot_spend_fails_closed_and_never_as_a_replay() {
        let kit = TestIdp::start().await.unwrap();
        for (failure, status) in [
            (
                SharedError::Timeout { store: "nonces" },
                StatusCode::SERVICE_UNAVAILABLE,
            ),
            (
                SharedError::Failed {
                    store: "nonces",
                    message: "disk full".into(),
                },
                StatusCode::INTERNAL_SERVER_ERROR,
            ),
        ] {
            let seen = Arc::new(Mutex::new(Seen::default()));
            let store = Store::new(Some(failure));
            let (_dir, service) = layer(&kit, Arc::clone(&store), Arc::clone(&seen)).await;
            let slot = CallerSlot::default();
            let response = service.oneshot(request(&kit, Some(&slot))).await.unwrap();
            assert_eq!(response.status(), status);
            assert!(seen.lock().unwrap().headers.is_empty());
            assert!(slot.caller().is_none());
            let body = response.into_body().collect().await.unwrap().to_bytes();
            let text = String::from_utf8_lossy(&body);
            assert!(
                !text.contains("UNAUTHORIZED") && !text.contains("disk full"),
                "{text}"
            );
            if status == StatusCode::SERVICE_UNAVAILABLE {
                assert!(text.contains("WORKSPACE_SHARED_TIMEOUT"), "{text}");
            }
        }
    }

    #[tokio::test]
    async fn a_spent_jti_is_kept_until_its_assertion_could_no_longer_be_accepted() {
        let kit = TestIdp::start().await.unwrap();
        let store = Store::new(None);
        let seen = Arc::new(Mutex::new(Seen::default()));
        let (_dir, service) = layer(&kit, Arc::clone(&store), seen).await;
        // A 30-second assertion under the default 60-second age limit and 60-second skew: kept
        // until the later of its `exp` and `iat` plus the age limit, plus the skew and a second.
        let builder = kit.gateway().assertion(PUBLIC_URL, "POST").lifetime(30);
        let iat = builder.claims()["iat"].as_i64().unwrap();
        let exp = builder.claims()["exp"].as_i64().unwrap();
        let jti = builder.claims()["jti"].as_str().unwrap().to_owned();
        let slot = CallerSlot::default();
        let response = service
            .oneshot(request_with(builder.sign(), Some(&slot)))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let expiries = store.expiries.lock().unwrap().clone();
        assert_eq!(
            expiries,
            [(
                format!("gateway:{jti}"),
                (exp.max(iat + 60) + 60 + 1) * 1000
            )]
        );
    }
}

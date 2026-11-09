//! The HTTPS listener: TLS with the test CA (client certificates requested, not required), the
//! routes of both roles, and the faults that make them misbehave.

use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::extract::Request;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use hyper_util::rt::TokioIo;
use serde_json::{Value, json};
use tokio::net::TcpListener;
use tokio::task::JoinSet;
use tokio_rustls::TlsAcceptor;
use tokio_rustls::rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
use tokio_rustls::rustls::server::WebPkiClientVerifier;
use tokio_rustls::rustls::{RootCertStore, ServerConfig};
use tower::ServiceExt;

use crate::Error;
use crate::ca::{IssuedCertificate, TestCa};
use crate::role::{Endpoint, Fault, Role, RoleKind};

mod flows;

/// The largest request body read (64 KiB).
const MAX_BODY_BYTES: usize = 64 * 1024;
/// What [`Fault::Oversize`] pads a body past.
const OVERSIZE_BYTES: usize = 1024 * 1024;

/// The DER of the TLS client certificate a connection presented, in each of its requests'
/// extensions.
#[derive(Clone)]
pub(crate) struct PeerCertificate(pub(crate) Vec<u8>);

/// TLS 1.2 and 1.3 on `aws-lc-rs`, with the listener's certificate, asking for a client
/// certificate that chains to the CA but serving clients without one.
pub(crate) fn server_config(
    ca: &TestCa,
    certificate: &IssuedCertificate,
) -> Result<Arc<ServerConfig>, Error> {
    let tls = |error: &dyn std::fmt::Display| Error::new(format!("TLS configuration: {error}"));
    let provider = Arc::new(tokio_rustls::rustls::crypto::aws_lc_rs::default_provider());
    let mut roots = RootCertStore::empty();
    roots
        .add(CertificateDer::from(ca.certificate_der().to_vec()))
        .map_err(|error| tls(&error))?;
    let verifier =
        WebPkiClientVerifier::builder_with_provider(Arc::new(roots), Arc::clone(&provider))
            .allow_unauthenticated()
            .build()
            .map_err(|error| tls(&error))?;
    let key = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(
        certificate.private_key_der().to_vec(),
    ));
    let mut config = ServerConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|error| tls(&error))?
        .with_client_cert_verifier(verifier)
        .with_single_cert(
            vec![CertificateDer::from(certificate.certificate_der().to_vec())],
            key,
        )
        .map_err(|error| tls(&error))?;
    config.alpn_protocols = vec![b"http/1.1".to_vec()];
    Ok(Arc::new(config))
}

/// Accept connections, over TLS when `tls` is given, until the future is dropped, which drops
/// every connection.
pub(crate) async fn serve(listener: TcpListener, tls: Option<Arc<ServerConfig>>, router: Router) {
    let acceptor = tls.map(TlsAcceptor::from);
    let mut connections = JoinSet::new();
    loop {
        tokio::select! {
            accepted = listener.accept() => {
                let Ok((stream, _)) = accepted else { continue };
                let acceptor = acceptor.clone();
                let router = router.clone();
                connections.spawn(async move {
                    let Some(acceptor) = acceptor else {
                        serve_connection(stream, None, router).await;
                        return;
                    };
                    let Ok(stream) = acceptor.accept(stream).await else { return };
                    let peer = stream
                        .get_ref()
                        .1
                        .peer_certificates()
                        .and_then(|chain| chain.first())
                        .map(|leaf| PeerCertificate(leaf.to_vec()));
                    serve_connection(stream, peer, router).await;
                });
            }
            Some(_) = connections.join_next(), if !connections.is_empty() => {}
        }
    }
}

/// Serve HTTP/1.1 on one connection, with the client certificate, if any, in every request.
async fn serve_connection<S>(stream: S, peer: Option<PeerCertificate>, router: Router)
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let service = hyper::service::service_fn(move |request: Request<hyper::body::Incoming>| {
        let mut request = request.map(Body::new);
        if let Some(peer) = &peer {
            request.extensions_mut().insert(peer.clone());
        }
        router.clone().oneshot(request)
    });
    let _ = hyper::server::conn::http1::Builder::new()
        .serve_connection(TokioIo::new(stream), service)
        .await;
}

/// Every route of `roles`.
pub(crate) fn router(roles: &[Arc<Role>]) -> Router {
    let mut router = Router::new();
    for role in roles {
        for endpoint in Endpoint::DOCUMENTS {
            let path = match endpoint {
                Endpoint::OauthMetadata => {
                    format!("/.well-known/oauth-authorization-server{}", role.path)
                }
                Endpoint::OpenidMetadata => {
                    format!("/.well-known/openid-configuration{}", role.path)
                }
                Endpoint::OpenidMetadataAppended => {
                    format!("{}/.well-known/openid-configuration", role.path)
                }
                _ => format!("{}/jwks", role.path),
            };
            let served = Arc::clone(role);
            router = router.route(
                &path,
                get(move || {
                    let role = Arc::clone(&served);
                    async move { document(&role, endpoint).await }
                }),
            );
            let moved = Arc::clone(role);
            router = router.route(
                &role.moved_path(endpoint),
                get(move || {
                    let role = Arc::clone(&moved);
                    async move { moved_document(&role, endpoint) }
                }),
            );
        }
        let authorize = Arc::clone(role);
        router = router.route(
            &format!("{}/authorize", role.path),
            get(move |request: Request| {
                let role = Arc::clone(&authorize);
                async move {
                    let query = request.uri().query().unwrap_or("").to_owned();
                    endpoint_answer(&role, Endpoint::Authorization, async {
                        flows::authorize(&role, &query)
                    })
                    .await
                }
            }),
        );
        let login = Arc::clone(role);
        router = router.route(
            &format!("{}/login", role.path),
            post(move |request: Request| {
                let role = Arc::clone(&login);
                async move {
                    endpoint_answer(&role, Endpoint::Login, async {
                        let (_, body) = match read(request).await {
                            Ok(read) => read,
                            Err(answer) => return answer,
                        };
                        flows::login(&role, &body)
                    })
                    .await
                }
            }),
        );
        let token = Arc::clone(role);
        router = router.route(
            &format!("{}/token", role.path),
            post(move |request: Request| {
                let role = Arc::clone(&token);
                async move {
                    endpoint_answer(&role, Endpoint::Token, async {
                        let (parts, body) = match read(request).await {
                            Ok(read) => read,
                            Err(answer) => return answer,
                        };
                        let peer = parts.extensions.get::<PeerCertificate>();
                        flows::token(&role, &parts.headers, &body, peer)
                    })
                    .await
                }
            }),
        );
        if role.kind == RoleKind::AuthorizationServer {
            let introspect = Arc::clone(role);
            router = router.route(
                &format!("{}/introspect", role.path),
                post(move |request: Request| {
                    let role = Arc::clone(&introspect);
                    async move {
                        endpoint_answer(&role, Endpoint::Introspection, async {
                            let (parts, body) = match read(request).await {
                                Ok(read) => read,
                                Err(answer) => return answer,
                            };
                            flows::introspect(&role, &parts.headers, &body)
                        })
                        .await
                    }
                }),
            );
        }
    }
    router
}

/// The plain-HTTP listener's routes: each role's documents at their usual paths, counted in
/// `plain_hits` and never faulted.
pub(crate) fn plain_router(roles: &[Arc<Role>]) -> Router {
    let mut router = Router::new();
    for role in roles {
        for endpoint in Endpoint::DOCUMENTS {
            let Some(path) = role
                .endpoint_url(endpoint)
                .strip_prefix(&role.base)
                .map(str::to_owned)
            else {
                continue;
            };
            let served = Arc::clone(role);
            router = router.route(
                &path,
                get(move || {
                    let role = Arc::clone(&served);
                    async move {
                        *crate::lock(&role.state)
                            .plain_hits
                            .entry(endpoint)
                            .or_default() += 1;
                        Answer::json(StatusCode::OK, document_body(&role, endpoint)).into_response()
                    }
                }),
            );
        }
    }
    router
}

/// A request's head and its body, at most [`MAX_BODY_BYTES`].
async fn read(request: Request) -> Result<(axum::http::request::Parts, Vec<u8>), Answer> {
    let (parts, body) = request.into_parts();
    match axum::body::to_bytes(body, MAX_BODY_BYTES).await {
        Ok(bytes) => Ok((parts, bytes.to_vec())),
        Err(_) => Err(Answer::oauth_error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "invalid_request",
            "the request body is too large",
        )),
    }
}

/// The body of a metadata or JWKS endpoint.
fn document_body(role: &Role, endpoint: Endpoint) -> Value {
    if endpoint == Endpoint::Jwks {
        role.keys.jwks()
    } else {
        role.metadata()
    }
}

async fn document(role: &Role, endpoint: Endpoint) -> Response {
    endpoint_answer(role, endpoint, async {
        Answer::json(StatusCode::OK, document_body(role, endpoint))
    })
    .await
}

fn moved_document(role: &Role, endpoint: Endpoint) -> Response {
    *crate::lock(&role.state)
        .moved_hits
        .entry(endpoint)
        .or_default() += 1;
    Answer::json(StatusCode::OK, document_body(role, endpoint)).into_response()
}

/// Count the hit, apply `endpoint`'s fault, and otherwise answer with `answer`. A status,
/// redirect or body fault answers before `answer` runs, so it consumes no code or script.
async fn endpoint_answer(
    role: &Role,
    endpoint: Endpoint,
    answer: impl Future<Output = Answer>,
) -> Response {
    role.hit(endpoint);
    let fault = role.fault(endpoint);
    match fault {
        Some(Fault::Status(status)) => {
            let status = StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
            return Answer::json(status, json!({ "error": "testkit_fault" })).into_response();
        }
        Some(Fault::Redirect) => {
            let location = format!("{}{}", role.base, role.moved_path(endpoint));
            return Answer::redirect(&location).into_response();
        }
        Some(Fault::Body(text)) => {
            let mut response = Response::new(Body::from(text));
            response.headers_mut().insert(
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/json"),
            );
            return response;
        }
        Some(Fault::Delay(delay)) => tokio::time::sleep(delay).await,
        Some(Fault::Oversize) | None => {}
    }
    let answer = answer.await;
    if fault == Some(Fault::Oversize) {
        return answer.padded().into_response();
    }
    answer.into_response()
}

pub(crate) enum AnswerBody {
    Json(Value),
    Html(String),
    Empty,
}

/// A response before faults apply.
pub(crate) struct Answer {
    status: StatusCode,
    headers: Vec<(&'static str, String)>,
    body: AnswerBody,
}

impl Answer {
    pub(crate) fn json(status: StatusCode, value: Value) -> Self {
        Self {
            status,
            headers: Vec::new(),
            body: AnswerBody::Json(value),
        }
    }

    pub(crate) fn html(status: StatusCode, html: String) -> Self {
        Self {
            status,
            headers: Vec::new(),
            body: AnswerBody::Html(html),
        }
    }

    pub(crate) fn redirect(location: &str) -> Self {
        Self {
            status: StatusCode::FOUND,
            headers: vec![("location", location.to_owned())],
            body: AnswerBody::Empty,
        }
    }

    /// An OAuth error response (RFC 6749, section 5.2), not to be cached.
    pub(crate) fn oauth_error(status: StatusCode, error: &str, description: &str) -> Self {
        Self::json(
            status,
            json!({ "error": error, "error_description": description }),
        )
        .no_store()
    }

    pub(crate) fn header(mut self, name: &'static str, value: &str) -> Self {
        self.headers.push((name, value.to_owned()));
        self
    }

    /// `Cache-Control: no-store` and `Pragma: no-cache` (RFC 6749, section 5.1).
    pub(crate) fn no_store(self) -> Self {
        self.header("cache-control", "no-store")
            .header("pragma", "no-cache")
    }

    fn padded(mut self) -> Self {
        let padding = "x".repeat(OVERSIZE_BYTES + 1);
        match &mut self.body {
            AnswerBody::Json(Value::Object(members)) => {
                members.insert("x-testkit-padding".into(), Value::String(padding));
            }
            AnswerBody::Html(html) => html.push_str(&format!("<!-- {padding} -->")),
            _ => {}
        }
        self
    }
}

impl IntoResponse for Answer {
    fn into_response(self) -> Response {
        let (body, content_type) = match self.body {
            AnswerBody::Json(value) => (Body::from(value.to_string()), Some("application/json")),
            AnswerBody::Html(html) => (Body::from(html), Some("text/html; charset=utf-8")),
            AnswerBody::Empty => (Body::empty(), None),
        };
        let mut response = Response::new(body);
        *response.status_mut() = self.status;
        if let Some(content_type) = content_type {
            response
                .headers_mut()
                .insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
        }
        for (name, value) in self.headers {
            if let Ok(value) = HeaderValue::from_str(&value) {
                response.headers_mut().append(name, value);
            }
        }
        response
    }
}

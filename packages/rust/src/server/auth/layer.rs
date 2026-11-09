//! The bearer layer: a `tower` layer in front of the Streamable HTTP service
//! (`spec/authorization.md`, M1, M2, M5, M6 and M7).

use std::convert::Infallible;
use std::error::Error as StdError;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};

use bytes::Bytes;
use http::header::{ALLOW, AUTHORIZATION, CONTENT_TYPE};
use http::{HeaderValue, Method, Request, Response, StatusCode};
use http_body::Body;
use http_body_util::combinators::BoxBody;
use http_body_util::{BodyExt, Full, LengthLimitError, Limited};
use tower_layer::Layer;
use tower_service::Service;

use super::bearer::extract_bearer;
use super::dispatch::{json_response, plain, PreDispatch, PreDispatchCheck};
use super::{Authorization, RuleCode};

/// The response body of a [`BearerService`]: the inner service's, or the layer's own JSON.
pub type BearerBody<E> = BoxBody<Bytes, E>;

type BoxedFuture<T, E> = Pin<Box<dyn Future<Output = Result<T, E>> + Send>>;

struct Shared {
    /// The decision before dispatch, which a host's own layer runs too
    /// ([`McpServer::pre_dispatch_check`](super::super::McpServer::pre_dispatch_check)).
    check: PreDispatchCheck,
    metadata_paths: Vec<String>,
}

/// The bearer layer of a server configured with
/// [`McpServer::with_authorization`](super::super::McpServer::with_authorization), from
/// [`McpServer::bearer_layer`](super::super::McpServer::bearer_layer).
///
/// Put it outermost on the service that holds both the MCP endpoint and the metadata paths (the
/// root of the host's router), behind only TLS and the host's own limits
/// (`endpoints/umbel/docs/phases/5-auth-hosted/spec.md`, 6.3). For each request it:
///
/// 1. serves the protected-resource metadata at its two paths by `GET`, without authentication
///    (M7; another method is 405);
/// 2. takes the one bearer token (M2), and verifies it with the configured verifier (M3), or
///    answers 401 (M5), logging the rule code at `warn` with the issuer alias, never the token or
///    a claim value;
/// 3. reads the body (at most the configured size, else 413), removes the `Authorization`
///    header and admits the verified [`Credentials`](crate::Credentials) into the request's
///    extensions. Nothing behind the layer, the context hook included, ever sees the token;
/// 4. runs the decision before dispatch ([`PreDispatchCheck`], which a host's own layer can run
///    too): for a JSON-RPC `tools/call`, every command it names is decided, and any missing scope
///    is one 403 naming every missing scope in step order (M6). Every other request needs the
///    required scopes. Then it passes the request on.
#[derive(Clone)]
pub struct BearerLayer {
    shared: Arc<Shared>,
}

impl std::fmt::Debug for BearerLayer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("BearerLayer")
            .field("metadata_paths", &self.shared.metadata_paths)
            .finish_non_exhaustive()
    }
}

impl BearerLayer {
    pub(crate) fn new(check: PreDispatchCheck) -> Self {
        let metadata_paths = check.auth.metadata.metadata_paths();
        Self {
            shared: Arc::new(Shared {
                check,
                metadata_paths,
            }),
        }
    }
}

impl<S> Layer<S> for BearerLayer {
    type Service = BearerService<S>;

    fn layer(&self, inner: S) -> Self::Service {
        BearerService {
            inner,
            shared: Arc::clone(&self.shared),
        }
    }
}

/// The service a [`BearerLayer`] wraps around an inner HTTP service.
#[derive(Clone)]
pub struct BearerService<S> {
    inner: S,
    shared: Arc<Shared>,
}

impl<S> std::fmt::Debug for BearerService<S> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("BearerService").finish_non_exhaustive()
    }
}

/// One of the layer's own responses, as a [`BearerBody`].
fn boxed<E>(response: Response<Full<Bytes>>) -> Response<BearerBody<E>> {
    response.map(|body| body.map_err(|never: Infallible| match never {}).boxed())
}

fn is_form(headers: &http::HeaderMap) -> bool {
    headers
        .get_all(CONTENT_TYPE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .any(|value| {
            value
                .split(';')
                .next()
                .unwrap_or_default()
                .trim()
                .eq_ignore_ascii_case("application/x-www-form-urlencoded")
        })
}

/// Read a body of at most `limit` bytes: `Err(413)` over it, `Err(400)` when it cannot be read.
async fn read_body<B>(body: B, limit: usize) -> Result<Bytes, StatusCode>
where
    B: Body,
    B::Error: Into<Box<dyn StdError + Send + Sync>>,
{
    match Limited::new(body, limit).collect().await {
        Ok(collected) => Ok(collected.to_bytes()),
        Err(error) if error.is::<LengthLimitError>() => Err(StatusCode::PAYLOAD_TOO_LARGE),
        Err(_) => Err(StatusCode::BAD_REQUEST),
    }
}

impl Shared {
    fn auth(&self) -> &Authorization {
        &self.check.auth
    }

    fn unauthorized<E>(&self, rule: RuleCode, issuer: Option<&str>) -> Response<BearerBody<E>> {
        tracing::warn!(
            target: "afd::auth",
            rule = rule.as_str(),
            issuer = issuer.unwrap_or("-"),
            "refused a request's bearer token"
        );
        let metadata = &self.auth().metadata;
        boxed(json_response(
            StatusCode::UNAUTHORIZED,
            &metadata.unauthorized_body(),
            Some(metadata.unauthorized_challenge(rule != RuleCode::NoToken)),
        ))
    }

    fn metadata<E>(&self, method: &Method) -> Response<BearerBody<E>> {
        if method != Method::GET {
            let mut response = plain(StatusCode::METHOD_NOT_ALLOWED);
            response
                .headers_mut()
                .insert(ALLOW, HeaderValue::from_static("GET"));
            return boxed(response);
        }
        boxed(json_response(
            StatusCode::OK,
            &self.auth().metadata.document(),
            None,
        ))
    }
}

impl<S, ReqBody, ResBody> Service<Request<ReqBody>> for BearerService<S>
where
    S: Service<Request<Full<Bytes>>, Response = Response<ResBody>> + Clone + Send + 'static,
    S::Future: Send + 'static,
    S::Error: Send + 'static,
    ReqBody: Body + Send + 'static,
    ReqBody::Data: Send,
    ReqBody::Error: Into<Box<dyn StdError + Send + Sync>>,
    ResBody: Body<Data = Bytes> + Send + Sync + 'static,
    ResBody::Error: 'static,
{
    type Response = Response<BearerBody<ResBody::Error>>;
    type Error = S::Error;
    type Future = BoxedFuture<Self::Response, Self::Error>;

    fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.inner.poll_ready(cx)
    }

    fn call(&mut self, request: Request<ReqBody>) -> Self::Future {
        // The inner service was readied for this call; keep a fresh clone for the next one.
        let clone = self.inner.clone();
        let mut inner = std::mem::replace(&mut self.inner, clone);
        let shared = Arc::clone(&self.shared);
        Box::pin(async move {
            let (mut parts, body) = request.into_parts();
            // M7: the metadata is public.
            if shared
                .metadata_paths
                .iter()
                .any(|path| path == parts.uri.path())
            {
                return Ok(shared.metadata(&parts.method));
            }
            let limit = shared.auth().max_body_bytes;
            let mut body = Some(body);
            // M2: a form body is read before the token, since a token in it refuses the request.
            let form = if is_form(&parts.headers) {
                let body = body.take().expect("the body is read once");
                match read_body(body, limit).await {
                    Ok(bytes) => Some(bytes),
                    Err(status) => return Ok(boxed(plain(status))),
                }
            } else {
                None
            };
            let token = {
                let values: Vec<&[u8]> = parts
                    .headers
                    .get_all(AUTHORIZATION)
                    .iter()
                    .map(HeaderValue::as_bytes)
                    .collect();
                match extract_bearer(&values, parts.uri.query(), form.as_deref()) {
                    Ok(token) => token.to_owned(),
                    Err(rule) => return Ok(shared.unauthorized(rule, None)),
                }
            };
            // M3: verify, then forget the token.
            let verified = shared.auth().verifier.verify(&token, &parts).await;
            drop(token);
            let credentials = match verified {
                Ok(credentials) => credentials,
                Err(refusal) => {
                    return Ok(shared.unauthorized(refusal.rule, refusal.issuer.as_deref()))
                }
            };
            let bytes = match (form, body) {
                (Some(bytes), _) => bytes,
                (None, Some(body)) => match read_body(body, limit).await {
                    Ok(bytes) => bytes,
                    Err(status) => return Ok(boxed(plain(status))),
                },
                (None, None) => Bytes::new(),
            };
            // M2: nothing behind the layer receives the token.
            parts.headers.remove(AUTHORIZATION);
            shared.auth().admit(&mut parts.extensions, credentials);
            // M6: the 403 before dispatch, decided as a host's own layer decides it.
            if let PreDispatch::Respond(response) = shared.check.decide(&parts, &bytes) {
                return Ok(boxed(response));
            }
            let response = inner
                .call(Request::from_parts(parts, Full::new(bytes)))
                .await?;
            Ok(response.map(BoxBody::new))
        })
    }
}

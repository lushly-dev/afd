//! The limit layers of the HTTP surface (phase 5 section 6.3): the body size limit (layer 2) and
//! the per-IP limit (layer 3), each refusing before anything behind it runs.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicU8, Ordering};
use std::task::{Context, Poll};
use std::time::Duration;

use axum::body::{Body, Bytes};
use axum::extract::{Request, State};
use axum::http::{HeaderValue, StatusCode, header};
use axum::middleware::Next;
use axum::response::Response;
use http_body::{Frame, SizeHint};

#[cfg(feature = "auth")]
use crate::shared::SharedError;
#[cfg(feature = "auth")]
use crate::shared::limits::{Admission, LimitStore};

/// The peer address of the connection a request came on. Only the listener inserts it, from the
/// accepted socket; no header is ever read for it (`X-Forwarded-For` and the like are the
/// caller's to forge).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct PeerAddr(pub(crate) std::net::SocketAddr);

/// An empty response with `status`, closing the connection when asked.
fn plain(status: StatusCode, close: bool) -> Response {
    let mut response = Response::new(Body::empty());
    *response.status_mut() = status;
    if close {
        response
            .headers_mut()
            .insert(header::CONNECTION, HeaderValue::from_static("close"));
    }
    response
}

// ─── Layer 2: the body size limit ────────────────────────────────────────────────────────────

/// How long a request's body may take to arrive once its headers have. A body trickled slower
/// is cut off with 408, so a client cannot hold a connection by sending a few bytes at a time.
pub(crate) const BODY_TIMEOUT: Duration = Duration::from_secs(30);

/// What became of a capped body.
const BODY_OK: u8 = 0;
const BODY_TOO_LARGE: u8 = 1;
const BODY_TOO_SLOW: u8 = 2;

/// Layer 2: `http.max_body_bytes`. A request that declares a longer body (`Content-Length`) is
/// refused with 413 before anything else reads it, and the connection is closed so its body is
/// never read. A body sent without a length is capped as it streams: past the cap the reader
/// behind this layer gets an error instead of more bytes, and the answer is 413 whatever that
/// reader made of it. Nothing behind the layer ever sees more than `cap` bytes. A body still
/// arriving [`BODY_TIMEOUT`] after the headers is cut off the same way, with 408.
pub(crate) async fn cap_body(State(cap): State<usize>, request: Request, next: Next) -> Response {
    if declares_more_than(request.headers(), cap) {
        return plain(StatusCode::PAYLOAD_TOO_LARGE, true);
    }
    let outcome = Arc::new(AtomicU8::new(BODY_OK));
    let (parts, body) = request.into_parts();
    let body = Body::new(CappedBody {
        inner: body,
        remaining: cap,
        deadline: Box::pin(tokio::time::sleep(BODY_TIMEOUT)),
        outcome: Arc::clone(&outcome),
    });
    let response = next.run(Request::from_parts(parts, body)).await;
    match outcome.load(Ordering::SeqCst) {
        BODY_TOO_LARGE => plain(StatusCode::PAYLOAD_TOO_LARGE, true),
        BODY_TOO_SLOW => plain(StatusCode::REQUEST_TIMEOUT, true),
        _ => response,
    }
}

/// Whether any `Content-Length` declares more than `cap` bytes, or cannot be read as a length.
fn declares_more_than(headers: &axum::http::HeaderMap, cap: usize) -> bool {
    headers.get_all(header::CONTENT_LENGTH).iter().any(|value| {
        value
            .to_str()
            .ok()
            .and_then(|text| text.trim().parse::<u64>().ok())
            .is_none_or(|length| length > u64::try_from(cap).unwrap_or(u64::MAX))
    })
}

/// A body that yields at most `remaining` more data bytes before `deadline`, then only errors.
struct CappedBody {
    inner: Body,
    remaining: usize,
    deadline: Pin<Box<tokio::time::Sleep>>,
    outcome: Arc<AtomicU8>,
}

/// The error a capped body yields past its cap or its deadline.
#[derive(Debug)]
struct BodyRefused(u8);

impl std::fmt::Display for BodyRefused {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(if self.0 == BODY_TOO_SLOW {
            "the request body did not arrive in time"
        } else {
            "the request body is larger than http.max_body_bytes"
        })
    }
}

impl std::error::Error for BodyRefused {}

impl CappedBody {
    fn refuse(&mut self, outcome: u8) -> Poll<Option<Result<Frame<Bytes>, axum::Error>>> {
        self.remaining = 0;
        // The first refusal is the one reported; once refused, every later poll is an error too,
        // so a reader that ignored the first never takes a cut body for a whole one.
        let _ = self
            .outcome
            .compare_exchange(BODY_OK, outcome, Ordering::SeqCst, Ordering::SeqCst);
        Poll::Ready(Some(Err(axum::Error::new(BodyRefused(
            self.outcome.load(Ordering::SeqCst),
        )))))
    }
}

impl http_body::Body for CappedBody {
    type Data = Bytes;
    type Error = axum::Error;

    fn poll_frame(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Bytes>, axum::Error>>> {
        let this = &mut *self;
        let refused = this.outcome.load(Ordering::SeqCst);
        if refused != BODY_OK {
            return this.refuse(refused);
        }
        match Pin::new(&mut this.inner).poll_frame(cx) {
            Poll::Ready(Some(Ok(frame))) => {
                if let Some(data) = frame.data_ref() {
                    if data.len() > this.remaining {
                        return this.refuse(BODY_TOO_LARGE);
                    }
                    this.remaining -= data.len();
                }
                Poll::Ready(Some(Ok(frame)))
            }
            Poll::Pending => match this.deadline.as_mut().poll(cx) {
                Poll::Ready(()) => this.refuse(BODY_TOO_SLOW),
                Poll::Pending => Poll::Pending,
            },
            other => other,
        }
    }

    fn is_end_stream(&self) -> bool {
        self.outcome.load(Ordering::SeqCst) == BODY_OK && self.inner.is_end_stream()
    }

    fn size_hint(&self) -> SizeHint {
        self.inner.size_hint()
    }
}

// ─── Layers 3 and 6: the sliding limits ──────────────────────────────────────────────────────

/// The window of `ip_requests_per_minute` and `calls_per_minute`.
#[cfg(feature = "auth")]
const MINUTE_MS: i64 = 60_000;
/// The most keys whose refusal one process remembers.
#[cfg(feature = "auth")]
const REMEMBERED_REFUSALS: usize = 4096;

/// Why a sliding limit refused a request.
#[cfg(feature = "auth")]
pub(crate) enum Refusal {
    /// Over the limit: retry after this many milliseconds.
    TooMany(i64),
    /// A shared store was held past `store.lock_timeout_ms`.
    Busy(&'static str),
    /// The check could not be made; logged.
    Failed,
}

/// One per-minute limit on the shared counters (layers 3 and 6), its state in this process: the
/// limit, one check at a time per process against the store, bounded by
/// `store.lock_timeout_ms`, and the keys this process saw refused, until their window admits
/// again.
#[cfg(feature = "auth")]
pub(crate) struct SlidingLimit {
    store: Arc<dyn LimitStore>,
    per_minute: u64,
    lock_timeout: Duration,
    turn: Arc<tokio::sync::Semaphore>,
    refused: std::sync::Mutex<std::collections::HashMap<String, i64>>,
}

/// Layer 3's limit.
#[cfg(feature = "auth")]
pub(crate) type IpLimit = SlidingLimit;

#[cfg(feature = "auth")]
impl SlidingLimit {
    pub(crate) fn new(store: Arc<dyn LimitStore>, per_minute: u64, lock_timeout: Duration) -> Self {
        Self {
            store,
            per_minute,
            lock_timeout,
            turn: Arc::new(tokio::sync::Semaphore::new(1)),
            refused: std::sync::Mutex::default(),
        }
    }

    /// The limit's own clock is the system's, never a host's injected one: a frozen clock for a
    /// replay would hold every window shut.
    fn now_ms() -> i64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |elapsed| {
                i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX)
            })
    }

    /// When `key` was refused here and its window does not admit before `until`, the
    /// milliseconds left. Exact across processes: other processes can only add rows to the
    /// window, never take them out early.
    fn remembered(&self, key: &str, now: i64) -> Option<i64> {
        let mut refused = self
            .refused
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        match refused.get(key) {
            Some(until) if *until > now => Some(until - now),
            Some(_) => {
                refused.remove(key);
                None
            }
            None => None,
        }
    }

    fn remember(&self, key: String, until: i64, now: i64) {
        let mut refused = self
            .refused
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if refused.len() >= REMEMBERED_REFUSALS {
            refused.retain(|_, kept| *kept > now);
        }
        if refused.len() < REMEMBERED_REFUSALS {
            refused.insert(key, until);
        }
    }

    /// Count one request against `key`, or say why not. A key this process already saw refused
    /// is answered from memory until its window admits again, without touching the store. The
    /// check waits its turn no longer than the store's own lock timeout, so a flood queues here,
    /// cheaply, rather than in the blocking pool.
    pub(crate) async fn admit(&self, key: String) -> Result<(), Refusal> {
        let now = Self::now_ms();
        if let Some(left) = self.remembered(&key, now) {
            return Err(Refusal::TooMany(left));
        }
        let Ok(Ok(turn)) =
            tokio::time::timeout(self.lock_timeout, Arc::clone(&self.turn).acquire_owned()).await
        else {
            return Err(Refusal::Busy("limits"));
        };
        let store = Arc::clone(&self.store);
        let per_minute = self.per_minute;
        let checked = key.clone();
        let decided = tokio::task::spawn_blocking(move || {
            let decided = store.hit(&checked, per_minute, MINUTE_MS, now);
            drop(turn);
            decided
        })
        .await;
        match decided {
            Ok(Ok(Admission::Allowed)) => Ok(()),
            Ok(Ok(Admission::Refused { retry_after_ms })) => {
                self.remember(key, now.saturating_add(retry_after_ms), now);
                Err(Refusal::TooMany(retry_after_ms))
            }
            Ok(Err(SharedError::Timeout { store })) => {
                tracing::warn!(target: "umbel::http", store, "a shared store was held past store.lock_timeout_ms; refused");
                Err(Refusal::Busy(store))
            }
            Ok(Err(SharedError::Failed { store, message })) => {
                tracing::error!(target: "umbel::http", store, %message, "a shared store failed; refused");
                Err(Refusal::Failed)
            }
            Err(error) => {
                tracing::error!(target: "umbel::http", %error, "a limit's check did not finish; refused");
                Err(Refusal::Failed)
            }
        }
    }
}

/// The limit's key for a peer: an IPv4 address (an IPv4-mapped IPv6 address counts as its IPv4
/// address), or an IPv6 address's /64 prefix, the block one host or subnet is usually given, so a
/// caller cannot spread its requests over the addresses of its own prefix.
#[cfg(feature = "auth")]
pub(crate) fn ip_key(ip: std::net::IpAddr) -> String {
    use std::net::IpAddr;
    match ip {
        IpAddr::V4(v4) => format!("ip:{v4}"),
        IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(v4) => format!("ip:{v4}"),
            None => {
                let s = v6.segments();
                format!("ip:{:x}:{:x}:{:x}:{:x}::/64", s[0], s[1], s[2], s[3])
            }
        },
    }
}

/// Layer 3: at most `ip_requests_per_minute` requests from one peer in any minute, counted in the
/// shared store before any verification work, `/health` and the metadata included. Over the limit
/// is 429 with `Retry-After` (whole seconds, rounded up); a key this process already saw refused
/// is answered from memory until its window admits again, without touching the store. A request
/// with no peer address (the router served by something other than the listener) is refused with
/// 500: the limit cannot apply, so nothing behind it runs. A store this process or another holds
/// past `store.lock_timeout_ms` is 503 `WORKSPACE_SHARED_TIMEOUT` with `Retry-After: 1`; any
/// other store failure is 500. Both fail closed.
#[cfg(feature = "auth")]
pub(crate) async fn limit_ip(
    State(limit): State<Arc<IpLimit>>,
    request: Request,
    next: Next,
) -> Response {
    let Some(PeerAddr(peer)) = request.extensions().get::<PeerAddr>().copied() else {
        tracing::error!(
            target: "umbel::http",
            "a request without a peer address reached the per-IP limit; refused"
        );
        return plain(StatusCode::INTERNAL_SERVER_ERROR, false);
    };
    match limit.admit(ip_key(peer.ip())).await {
        Ok(()) => next.run(request).await,
        Err(Refusal::TooMany(left)) => too_many(left, "from this address"),
        Err(Refusal::Busy(store)) => shared_timeout(store),
        Err(Refusal::Failed) => plain(StatusCode::INTERNAL_SERVER_ERROR, false),
    }
}

/// A JSON refusal with `status`, `Retry-After: seconds`, and `body`.
#[cfg(feature = "auth")]
fn retry_later(status: StatusCode, seconds: i64, body: &serde_json::Value) -> Response {
    let mut response = Response::new(Body::from(body.to_string()));
    *response.status_mut() = status;
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    headers.insert(header::RETRY_AFTER, HeaderValue::from(seconds));
    response
}

/// 429: the limit's own answer names no limit and no caller, only which limit it is (`whose`:
/// "from this address", "with this token") and when to retry.
#[cfg(feature = "auth")]
fn too_many(retry_after_ms: i64, whose: &str) -> Response {
    let seconds = retry_after_ms.saturating_add(999) / 1000;
    let seconds = seconds.max(1);
    retry_later(
        StatusCode::TOO_MANY_REQUESTS,
        seconds,
        &serde_json::json!({
            "error": afd::error_codes::RATE_LIMITED,
            "suggestion": format!("Too many requests {whose}; retry after {seconds} seconds."),
        }),
    )
}

/// 503: a shared store was held too long (section 10.5: `details.store`).
#[cfg(feature = "auth")]
fn shared_timeout(store: &str) -> Response {
    retry_later(
        StatusCode::SERVICE_UNAVAILABLE,
        1,
        &serde_json::json!({
            "error": crate::shared::codes::WORKSPACE_SHARED_TIMEOUT,
            "suggestion": "The server's shared state is busy; retry in a moment.",
            "details": { "store": store },
        }),
    )
}

// ─── Layer 6: the token gate ─────────────────────────────────────────────────────────────────

/// The body of every response between AFD's bearer layer and the MCP service.
#[cfg(feature = "auth")]
pub(crate) type GateBody = http_body_util::combinators::BoxBody<Bytes, std::convert::Infallible>;

/// The name of a verified caller's per-token counter (section 11: the verified issuer, subject and
/// client): their HMAC under the workspace's `state/keys/limits.key`, so the shared store holds
/// no identifier a dictionary could recover.
#[cfg(feature = "auth")]
pub(crate) fn token_key(key: &[u8], credentials: &afd::Credentials) -> String {
    crate::shared::keyed_name(
        "token",
        key,
        &[
            &credentials.issuer,
            &credentials.subject,
            &credentials.client_id,
        ],
    )
}

#[cfg(feature = "auth")]
struct GateShared {
    limit: SlidingLimit,
    key: Vec<u8>,
    metadata: afd::server::auth::ProtectedResource,
    prefix: String,
}

/// Layer 6 (section 6.3), between AFD's bearer layer and the MCP service, on every request the
/// bearer layer admitted:
///
/// 1. **Any Umbel scope.** A token holding no scope under `auth.scope_prefix` is refused with 403
///    `insufficient_scope` naming `<prefix>:read`, whatever it asks for (section 5.2's space-less
///    rows: listings, resources, the Skills methods and `initialize` included). The answer depends
///    on the token alone.
/// 2. **The per-token limit** (`limits.calls_per_minute`, section 11): at most that many requests
///    in any minute per verified issuer, subject and client, counted on the shared counters; over
///    it, 429 with `Retry-After`; a store held too long, 503 `WORKSPACE_SHARED_TIMEOUT`; any other
///    store failure, 500. Each fails closed.
///
/// A request without admitted credentials passes untouched to the service, which refuses it
/// (AFD's M1): nothing here can stand in for the bearer layer.
#[cfg(feature = "auth")]
#[derive(Clone)]
pub(crate) struct TokenGate<S> {
    inner: S,
    shared: Arc<GateShared>,
}

#[cfg(feature = "auth")]
impl<S> TokenGate<S> {
    pub(crate) fn new(
        inner: S,
        limit: SlidingLimit,
        key: Vec<u8>,
        metadata: afd::server::auth::ProtectedResource,
        prefix: &str,
    ) -> Self {
        Self {
            inner,
            shared: Arc::new(GateShared {
                limit,
                key,
                metadata,
                prefix: prefix.to_owned(),
            }),
        }
    }
}

#[cfg(feature = "auth")]
fn gate_response(
    status: StatusCode,
    body: &serde_json::Value,
    headers: &[(header::HeaderName, String)],
) -> axum::http::Response<GateBody> {
    use http_body_util::BodyExt;
    let mut response = axum::http::Response::new(
        http_body_util::Full::new(Bytes::from(body.to_string()))
            .map_err(|never: std::convert::Infallible| match never {})
            .boxed(),
    );
    *response.status_mut() = status;
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    for (name, value) in headers {
        if let Ok(value) = HeaderValue::from_str(value) {
            response.headers_mut().insert(name.clone(), value);
        }
    }
    response
}

#[cfg(feature = "auth")]
impl<S> tower::Service<axum::http::Request<http_body_util::Full<Bytes>>> for TokenGate<S>
where
    S: tower::Service<
            axum::http::Request<http_body_util::Full<Bytes>>,
            Response = axum::http::Response<GateBody>,
            Error = std::convert::Infallible,
        > + Clone
        + Send
        + 'static,
    S::Future: Send + 'static,
{
    type Response = axum::http::Response<GateBody>;
    type Error = std::convert::Infallible;
    type Future = Pin<Box<dyn Future<Output = Result<Self::Response, Self::Error>> + Send>>;

    fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.inner.poll_ready(cx)
    }

    fn call(&mut self, request: axum::http::Request<http_body_util::Full<Bytes>>) -> Self::Future {
        // The inner service was readied for this call; keep a fresh clone for the next one.
        let clone = self.inner.clone();
        let mut inner = std::mem::replace(&mut self.inner, clone);
        let shared = Arc::clone(&self.shared);
        Box::pin(async move {
            let Some(credentials) = request.extensions().get::<afd::Credentials>().cloned() else {
                return inner.call(request).await;
            };
            let umbel = credentials
                .scopes
                .iter()
                .any(|scope| crate::auth::Scope::parse(&shared.prefix, scope).is_some());
            if !umbel {
                let missing = [format!("{}:read", shared.prefix)];
                return Ok(gate_response(
                    StatusCode::FORBIDDEN,
                    &shared.metadata.forbidden_body(&missing),
                    &[(
                        header::WWW_AUTHENTICATE,
                        shared.metadata.forbidden_challenge(&missing),
                    )],
                ));
            }
            match shared
                .limit
                .admit(token_key(&shared.key, &credentials))
                .await
            {
                Ok(()) => inner.call(request).await,
                Err(Refusal::TooMany(left)) => {
                    let seconds = (left.saturating_add(999) / 1000).max(1);
                    Ok(gate_response(
                        StatusCode::TOO_MANY_REQUESTS,
                        &serde_json::json!({
                            "error": afd::error_codes::RATE_LIMITED,
                            "suggestion": format!("Too many requests with this token; retry after {seconds} seconds."),
                        }),
                        &[(header::RETRY_AFTER, seconds.to_string())],
                    ))
                }
                Err(Refusal::Busy(store)) => Ok(gate_response(
                    StatusCode::SERVICE_UNAVAILABLE,
                    &serde_json::json!({
                        "error": crate::shared::codes::WORKSPACE_SHARED_TIMEOUT,
                        "suggestion": "The server's shared state is busy; retry in a moment.",
                        "details": { "store": store },
                    }),
                    &[(header::RETRY_AFTER, "1".to_owned())],
                )),
                Err(Refusal::Failed) => Ok(gate_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    &serde_json::json!({}),
                    &[],
                )),
            }
        })
    }
}

#[cfg(all(test, feature = "auth"))]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use axum::Router;
    use axum::middleware::from_fn_with_state;
    use axum::routing::post;
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
    use std::sync::atomic::AtomicUsize;
    use tower::ServiceExt;

    /// A body of `chunks` with no declared length, as a chunked request's is.
    struct Chunks(Vec<Bytes>);

    impl http_body::Body for Chunks {
        type Data = Bytes;
        type Error = std::convert::Infallible;

        fn poll_frame(
            mut self: Pin<&mut Self>,
            _cx: &mut Context<'_>,
        ) -> Poll<Option<Result<Frame<Bytes>, Self::Error>>> {
            if self.0.is_empty() {
                Poll::Ready(None)
            } else {
                Poll::Ready(Some(Ok(Frame::data(self.0.remove(0)))))
            }
        }
    }

    fn chunked(sizes: &[usize]) -> Request {
        let chunks = sizes
            .iter()
            .map(|size| Bytes::from(vec![b'x'; *size]))
            .collect();
        Request::post("/").body(Body::new(Chunks(chunks))).unwrap()
    }

    /// A handler that reads the whole body with no limit of its own and reports its length.
    async fn unbounded(body: Body) -> Response {
        match axum::body::to_bytes(body, usize::MAX).await {
            Ok(bytes) => Response::new(Body::from(bytes.len().to_string())),
            Err(_) => plain(StatusCode::BAD_REQUEST, false),
        }
    }

    #[tokio::test]
    async fn a_streamed_body_past_the_cap_never_reaches_a_reader_that_has_no_cap() {
        let router = Router::new()
            .route("/", post(unbounded))
            .layer(from_fn_with_state(1000usize, cap_body));
        let response = router
            .clone()
            .oneshot(chunked(&[600, 600, 600]))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
        assert_eq!(response.headers().get(header::CONNECTION).unwrap(), "close");
        let response = router.oneshot(chunked(&[500, 500])).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), 100)
            .await
            .unwrap();
        assert_eq!(&bytes[..], b"1000");
    }

    /// A body that never yields a byte, as a client that sent its headers and then stalled.
    struct Stalled;

    impl http_body::Body for Stalled {
        type Data = Bytes;
        type Error = std::convert::Infallible;

        fn poll_frame(
            self: Pin<&mut Self>,
            _cx: &mut Context<'_>,
        ) -> Poll<Option<Result<Frame<Bytes>, Self::Error>>> {
            Poll::Pending
        }
    }

    #[tokio::test(start_paused = true)]
    async fn a_body_that_stalls_is_cut_off_with_408() {
        let router = Router::new()
            .route("/", post(unbounded))
            .layer(from_fn_with_state(1000usize, cap_body));
        let request = Request::post("/").body(Body::new(Stalled)).unwrap();
        let started = tokio::time::Instant::now();
        // Bounded, so that a body limit without its deadline fails here rather than hanging.
        let response = tokio::time::timeout(BODY_TIMEOUT * 2, router.oneshot(request))
            .await
            .expect("the stalled body was never cut off")
            .unwrap();
        assert_eq!(response.status(), StatusCode::REQUEST_TIMEOUT);
        assert_eq!(response.headers().get(header::CONNECTION).unwrap(), "close");
        assert!(started.elapsed() >= BODY_TIMEOUT);
    }

    #[tokio::test]
    async fn a_body_refused_once_stays_refused() {
        let mut body = CappedBody {
            inner: Body::new(Chunks(vec![
                Bytes::from(vec![b'x'; 20]),
                Bytes::from(vec![b'x'; 1]),
            ])),
            remaining: 10,
            deadline: Box::pin(tokio::time::sleep(BODY_TIMEOUT)),
            outcome: Arc::new(AtomicU8::new(BODY_OK)),
        };
        for _ in 0..3 {
            let frame =
                std::future::poll_fn(|cx| http_body::Body::poll_frame(Pin::new(&mut body), cx))
                    .await;
            assert!(matches!(frame, Some(Err(_))));
        }
        assert!(!http_body::Body::is_end_stream(&body));
    }

    /// A store that counts its calls and answers `answer`.
    struct Fixed {
        answer: Result<Admission, SharedError>,
        calls: AtomicUsize,
    }

    impl LimitStore for Fixed {
        fn hit(&self, _: &str, _: u64, _: i64, _: i64) -> Result<Admission, SharedError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.answer.clone()
        }

        fn bytes_admit(&self, _: &str, _: u64, _: i64, _: i64) -> Result<Admission, SharedError> {
            self.answer.clone()
        }

        fn bytes_add(&self, _: &str, _: u64, _: i64, _: i64) -> Result<(), SharedError> {
            Ok(())
        }
    }

    fn limited(answer: Result<Admission, SharedError>) -> (Router, Arc<Fixed>, Arc<AtomicUsize>) {
        let store = Arc::new(Fixed {
            answer,
            calls: AtomicUsize::new(0),
        });
        let ran = Arc::new(AtomicUsize::new(0));
        let counted = Arc::clone(&ran);
        let router = Router::new()
            .route(
                "/",
                post(move || {
                    let counted = Arc::clone(&counted);
                    async move {
                        counted.fetch_add(1, Ordering::SeqCst);
                        "ran"
                    }
                }),
            )
            .layer(from_fn_with_state(
                Arc::new(IpLimit::new(
                    Arc::clone(&store) as Arc<dyn LimitStore>,
                    5,
                    Duration::from_secs(1),
                )),
                limit_ip,
            ));
        (router, store, ran)
    }

    fn from_peer() -> Request {
        let mut request = Request::post("/").body(Body::empty()).unwrap();
        request
            .extensions_mut()
            .insert(PeerAddr("192.0.2.7:50000".parse().unwrap()));
        request
    }

    #[tokio::test]
    async fn without_a_peer_address_nothing_behind_the_limit_runs() {
        let (router, store, ran) = limited(Ok(Admission::Allowed));
        let response = router
            .clone()
            .oneshot(Request::post("/").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(
            (
                store.calls.load(Ordering::SeqCst),
                ran.load(Ordering::SeqCst)
            ),
            (0, 0)
        );
        let response = router.oneshot(from_peer()).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(ran.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn a_refused_key_is_answered_from_memory_until_its_window_admits() {
        let (router, store, ran) = limited(Ok(Admission::Refused {
            retry_after_ms: 30_000,
        }));
        for _ in 0..3 {
            let response = router.clone().oneshot(from_peer()).await.unwrap();
            assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
            let seconds: i64 = response
                .headers()
                .get(header::RETRY_AFTER)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.parse().ok())
                .unwrap();
            assert!((29..=30).contains(&seconds), "{seconds}");
        }
        assert_eq!(store.calls.load(Ordering::SeqCst), 1);
        assert_eq!(ran.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn a_shared_store_that_cannot_answer_fails_closed() {
        let (router, _, ran) = limited(Err(SharedError::Timeout { store: "limits" }));
        let response = router.oneshot(from_peer()).await.unwrap();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(response.headers().get(header::RETRY_AFTER).unwrap(), "1");
        let body = axum::body::to_bytes(response.into_body(), 1000)
            .await
            .unwrap();
        let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(body["error"], "WORKSPACE_SHARED_TIMEOUT");
        assert_eq!(body["details"]["store"], "limits");
        let (router, _, ran_too) = limited(Err(SharedError::Failed {
            store: "limits",
            message: "disk full".into(),
        }));
        let response = router.oneshot(from_peer()).await.unwrap();
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(
            ran.load(Ordering::SeqCst) + ran_too.load(Ordering::SeqCst),
            0
        );
    }

    #[test]
    fn token_counters_are_named_under_the_workspaces_key() {
        let one = afd::Credentials::new("https://as", "ada", "app", "https://r/mcp", 1, 2);
        let renewed = afd::Credentials::new("https://as", "ada", "app", "https://r/mcp", 3, 4)
            .with_scopes(["umbel:read"]);
        let other = afd::Credentials::new("https://as", "bo", "app", "https://r/mcp", 1, 2);
        let key = [7u8; 32];
        // The issuer, subject and client name the counter, not the token.
        assert_eq!(token_key(&key, &one), token_key(&key, &renewed));
        assert_ne!(token_key(&key, &one), token_key(&key, &other));
        // Another workspace's key names the same caller otherwise.
        assert_ne!(token_key(&key, &one), token_key(&[8u8; 32], &one));
        assert!(!token_key(&key, &one).contains("ada"));
    }

    #[test]
    fn peers_key_on_their_ipv4_address_or_ipv6_prefix() {
        assert_eq!(
            ip_key(IpAddr::V4(Ipv4Addr::new(203, 0, 113, 5))),
            "ip:203.0.113.5"
        );
        let mapped: Ipv6Addr = "::ffff:203.0.113.5".parse().unwrap_or(Ipv6Addr::LOCALHOST);
        assert_eq!(ip_key(IpAddr::V6(mapped)), "ip:203.0.113.5");
        let one: Ipv6Addr = "2001:db8:1:2::1".parse().unwrap_or(Ipv6Addr::LOCALHOST);
        let other: Ipv6Addr = "2001:db8:1:2:ffff::9"
            .parse()
            .unwrap_or(Ipv6Addr::LOCALHOST);
        let next: Ipv6Addr = "2001:db8:1:3::1".parse().unwrap_or(Ipv6Addr::LOCALHOST);
        assert_eq!(ip_key(IpAddr::V6(one)), "ip:2001:db8:1:2::/64");
        assert_eq!(ip_key(IpAddr::V6(one)), ip_key(IpAddr::V6(other)));
        assert_ne!(ip_key(IpAddr::V6(one)), ip_key(IpAddr::V6(next)));
    }

    #[test]
    fn retry_after_rounds_up_to_whole_seconds() {
        for (ms, seconds) in [(1, "1"), (1_000, "1"), (1_001, "2"), (59_999, "60")] {
            let response = too_many(ms, "from this address");
            assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
            assert_eq!(
                response
                    .headers()
                    .get(header::RETRY_AFTER)
                    .and_then(|v| v.to_str().ok()),
                Some(seconds)
            );
        }
    }

    #[test]
    fn a_declared_length_over_the_cap_or_unreadable_is_refused() {
        let mut headers = axum::http::HeaderMap::new();
        assert!(!declares_more_than(&headers, 10));
        headers.insert(header::CONTENT_LENGTH, HeaderValue::from_static("10"));
        assert!(!declares_more_than(&headers, 10));
        headers.insert(header::CONTENT_LENGTH, HeaderValue::from_static("11"));
        assert!(declares_more_than(&headers, 10));
        headers.insert(header::CONTENT_LENGTH, HeaderValue::from_static("ten"));
        assert!(declares_more_than(&headers, 10));
    }
}

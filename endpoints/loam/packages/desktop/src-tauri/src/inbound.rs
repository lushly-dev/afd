//! The desktop's inbound MCP endpoint (phase 6 specification, 10.8; D137 to D140): one loopback HTTP endpoint the
//! Rust host serves while the window is open, so an agent or a script on the person's machine reaches the running
//! desktop's commands. The Rust side is a transport only, as in 10.4: it checks the request, passes the body alone to
//! the main webview as a `loam:inbound` DOM event, and answers with what the kernel sends back through
//! `inbound_reply`.
//!
//! The checks, in order, each answering before anything is forwarded: the `Host` (`421`), any `Origin` (`403`), the
//! token (`401`), the path (`404`) and the method (`405`), readiness (`503`), the body's size (`413`) and shape
//! (`400`: one JSON-RPC request or notification, never a batch). No request header reaches the webview, the journal
//! or a log, the token included.
use crate::notify::literal;
use bytes::Bytes;
use http_body_util::{BodyExt, Full, Limited};
use hyper::body::Incoming;
use hyper::header::{AUTHORIZATION, CACHE_CONTROL, CONTENT_TYPE, HOST, HeaderValue, ORIGIN};
use hyper::{Method, Request, Response, StatusCode};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::net::TcpListener;
use tokio::sync::{oneshot, watch};

/// The event's name on `window`.
pub const EVENT: &str = "loam:inbound";
/// One JSON-RPC message, at most 1 MiB, as 10.4's bound.
pub const REQUEST_MAX: usize = crate::mounts::REQUEST_MAX;
/// A reply, at most 4 MiB, as 10.4's bound.
pub const RESPONSE_MAX: usize = crate::mounts::RESPONSE_MAX;
/// How long a request waits for the kernel's answer: past it, `504`, which a client must not retry for a mutation.
pub const REPLY_TIMEOUT: Duration = Duration::from_secs(60);
/// Requests waiting on the kernel at once; one more is `429` with `Retry-After: 1`, as the relay's `MOUNT_LIMIT`.
pub const IN_FLIGHT_MAX: usize = 16;
/// Connections open at once, before any is authenticated: past it a new one is closed at once, so no local process
/// can hold the host's file descriptors.
pub const CONNECTIONS_MAX: usize = 64;
/// How long a connection may take to send its headers, and then its body.
pub const READ_TIMEOUT: Duration = Duration::from_secs(10);

/// Evaluates one statement in the main webview.
pub type Deliver = Arc<dyn Fn(String) + Send + Sync>;

/// What a waiting request is given.
enum Answer {
    /// The kernel's reply, serialised.
    Reply(Vec<u8>),
    /// Over [`RESPONSE_MAX`].
    TooLarge,
    /// The main webview started a page load: the request may or may not have run.
    Reloaded,
}

/// The endpoint's state for one run: its token, its port, the kernel's readiness and the requests waiting on it.
pub struct Inbound {
    port: u16,
    /// `Bearer <token>`, compared whole.
    expected: Vec<u8>,
    ready: AtomicBool,
    /// Between a page load's `Started` and its `Finished`: a `ready` then may be the outgoing page's, so it is refused
    /// and the new page asks again.
    loading: AtomicBool,
    next: AtomicU64,
    pending: Mutex<HashMap<u64, oneshot::Sender<Answer>>>,
    deliver: Deliver,
    timeout: Duration,
}

/// 32 random bytes, base64url without padding: made at each start, so a restart revokes every client (D140).
pub fn token() -> String {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).expect("the operating system's random source");
    base64url(&bytes)
}

fn base64url(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let word = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));
        for index in 0..=chunk.len() {
            out.push(char::from(
                ALPHABET[((word >> (18 - 6 * index)) & 63) as usize],
            ));
        }
    }
    out
}

/// Equal bytes, in a time that depends on the lengths alone.
fn same(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |held, (x, y)| held | (x ^ y)) == 0
}

/// Removes a waiting request when its HTTP exchange ends, however it ends, so a client that hangs up leaves nothing.
struct Waiting<'a> {
    inbound: &'a Inbound,
    id: u64,
}

impl Drop for Waiting<'_> {
    fn drop(&mut self) {
        self.inbound
            .pending
            .lock()
            .expect("pending")
            .remove(&self.id);
    }
}

fn plain(status: StatusCode, text: &'static str) -> Response<Full<Bytes>> {
    let mut response = Response::new(Full::new(Bytes::from_static(text.as_bytes())));
    *response.status_mut() = status;
    let headers = response.headers_mut();
    headers.insert(
        CONTENT_TYPE,
        HeaderValue::from_static("text/plain; charset=utf-8"),
    );
    headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(
        "X-Content-Type-Options",
        HeaderValue::from_static("nosniff"),
    );
    response
}

fn json_answer(body: Vec<u8>) -> Response<Full<Bytes>> {
    let mut response = plain(StatusCode::OK, "");
    *response.body_mut() = Full::new(Bytes::from(body));
    response
        .headers_mut()
        .insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    response
}

/// A request's `id` as JSON-RPC allows one: a string, or an integer a JavaScript number holds exactly.
fn valid_id(id: &Value) -> bool {
    const SAFE: i64 = (1 << 53) - 1;
    id.is_string() || id.as_i64().is_some_and(|n| (-SAFE..=SAFE).contains(&n))
}

impl Inbound {
    pub fn new(port: u16, token: &str, deliver: Deliver) -> Arc<Self> {
        Self::with_timeout(port, token, deliver, REPLY_TIMEOUT)
    }

    /// As [`Inbound::new`], with another wait for the kernel's answer, for the unit tests' `504`.
    pub fn with_timeout(port: u16, token: &str, deliver: Deliver, timeout: Duration) -> Arc<Self> {
        Arc::new(Self {
            port,
            expected: format!("Bearer {token}").into_bytes(),
            ready: AtomicBool::new(false),
            loading: AtomicBool::new(false),
            next: AtomicU64::new(1),
            pending: Mutex::new(HashMap::new()),
            deliver,
            timeout,
        })
    }

    /// The kernel said it is ready, after stage B has loaded (`inbound_reply { ready: true }`). Refused, `false`,
    /// while a page load is under way, since the outgoing page may be the one saying it: the page asks again.
    pub fn set_ready(&self) -> bool {
        // Under the pending lock, so a load that starts meanwhile is seen.
        let _held = self.pending.lock().expect("pending");
        if self.loading.load(Ordering::SeqCst) {
            return false;
        }
        self.ready.store(true, Ordering::SeqCst);
        true
    }

    /// The main webview's page load finished: the page now there may say it is ready.
    pub fn page_finished(&self) {
        let _held = self.pending.lock().expect("pending");
        self.loading.store(false, Ordering::SeqCst);
    }

    /// The main webview started a page load: not ready until the new page says so, and every waiting request is
    /// answered `503`.
    pub fn page_started(&self) {
        let mut pending = self.pending.lock().expect("pending");
        self.loading.store(true, Ordering::SeqCst);
        self.ready.store(false, Ordering::SeqCst);
        let waiting: Vec<_> = pending.drain().map(|(_, sender)| sender).collect();
        drop(pending);
        for sender in waiting {
            let _ = sender.send(Answer::Reloaded);
        }
    }

    /// The kernel's answer to request `id`, and whether it reached a request still waiting. An id this host did not
    /// issue, or one already answered, does nothing and answers `false`: no reply is forwarded.
    pub fn reply(&self, id: u64, message: &Value) -> bool {
        let Some(sender) = self.pending.lock().expect("pending").remove(&id) else {
            return false;
        };
        let body = serde_json::to_vec(message).expect("a JSON value serialises");
        sender
            .send(if body.len() > RESPONSE_MAX {
                Answer::TooLarge
            } else {
                Answer::Reply(body)
            })
            .is_ok()
    }

    fn host_allowed(&self, request: &Request<Incoming>) -> bool {
        let mut hosts = request.headers().get_all(HOST).iter();
        let (Some(host), None) = (hosts.next(), hosts.next()) else {
            return false;
        };
        let Ok(host) = host.to_str() else {
            return false;
        };
        let host = host.to_ascii_lowercase();
        let allowed = [
            format!("127.0.0.1:{}", self.port),
            format!("localhost:{}", self.port),
        ];
        // An absolute target must name the same authority.
        allowed.contains(&host)
            && request
                .uri()
                .authority()
                .is_none_or(|authority| authority.as_str().eq_ignore_ascii_case(&host))
    }

    fn authorized(&self, request: &Request<Incoming>) -> bool {
        let mut values = request.headers().get_all(AUTHORIZATION).iter();
        match (values.next(), values.next()) {
            (Some(value), None) => same(value.as_bytes(), &self.expected),
            _ => false,
        }
    }

    /// One HTTP exchange.
    pub async fn handle(&self, request: Request<Incoming>) -> Response<Full<Bytes>> {
        if !self.host_allowed(&request) {
            return plain(
                StatusCode::MISDIRECTED_REQUEST,
                "Use 127.0.0.1 or localhost with this port",
            );
        }
        // Browsers send `Origin` on every request but `GET` and `HEAD`, and on a preflight: no page reaches the endpoint.
        if request.headers().contains_key(ORIGIN) {
            return plain(StatusCode::FORBIDDEN, "No web page may call this endpoint");
        }
        if !self.authorized(&request) {
            let mut response = plain(
                StatusCode::UNAUTHORIZED,
                "Run loam-desktop mcp --print-connection for this run's header",
            );
            response
                .headers_mut()
                .insert("WWW-Authenticate", HeaderValue::from_static("Bearer"));
            return response;
        }
        if request.uri().path() != "/mcp" || request.uri().query().is_some() {
            return plain(StatusCode::NOT_FOUND, "The endpoint is /mcp");
        }
        if request.method() != Method::POST {
            let mut response = plain(StatusCode::METHOD_NOT_ALLOWED, "POST one JSON-RPC message");
            response
                .headers_mut()
                .insert("Allow", HeaderValue::from_static("POST"));
            return response;
        }
        if !self.ready.load(Ordering::SeqCst) {
            return plain(
                StatusCode::SERVICE_UNAVAILABLE,
                "Loam is loading; retry shortly",
            );
        }
        let body = match tokio::time::timeout(
            READ_TIMEOUT,
            Limited::new(request.into_body(), REQUEST_MAX).collect(),
        )
        .await
        {
            Err(_) => return plain(StatusCode::REQUEST_TIMEOUT, "The body took over 10 s"),
            Ok(Ok(body)) => body.to_bytes(),
            Ok(Err(error)) if error.is::<http_body_util::LengthLimitError>() => {
                return plain(
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "One message is at most 1 MiB",
                );
            }
            Ok(Err(_)) => return plain(StatusCode::BAD_REQUEST, "The body could not be read"),
        };
        let Ok(message) = serde_json::from_slice::<Value>(&body) else {
            return plain(StatusCode::BAD_REQUEST, "The body is not JSON");
        };
        let well_formed = message.is_object()
            && message["jsonrpc"] == "2.0"
            && message["method"].is_string()
            && message.get("id").is_none_or(valid_id);
        if !well_formed {
            return plain(
                StatusCode::BAD_REQUEST,
                "Send one JSON-RPC request or notification; batches are refused",
            );
        }
        // A notification reaches the kernel with no reply. A reload begun since the check above is `503`; one that
        // starts between the statement's posting and its run can still lose it, which a notification may be.
        if message.get("id").is_none() {
            {
                let _held = self.pending.lock().expect("pending");
                if !self.ready.load(Ordering::SeqCst) {
                    return plain(
                        StatusCode::SERVICE_UNAVAILABLE,
                        "Loam is loading; retry shortly",
                    );
                }
                (self.deliver)(script(None, &message));
            }
            let mut response = plain(StatusCode::ACCEPTED, "");
            response.headers_mut().remove(CONTENT_TYPE);
            return response;
        }
        let id = self.next.fetch_add(1, Ordering::SeqCst);
        let (sender, receiver) = oneshot::channel();
        {
            let mut pending = self.pending.lock().expect("pending");
            if pending.len() >= IN_FLIGHT_MAX {
                drop(pending);
                let mut response =
                    plain(StatusCode::TOO_MANY_REQUESTS, "Too many requests at once");
                response
                    .headers_mut()
                    .insert("Retry-After", HeaderValue::from_static("1"));
                return response;
            }
            // A reload between the check above and here would leave this request waiting out its timeout.
            if !self.ready.load(Ordering::SeqCst) {
                return plain(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "Loam is loading; retry shortly",
                );
            }
            pending.insert(id, sender);
        }
        let _waiting = Waiting { inbound: self, id };
        (self.deliver)(script(Some(id), &message));
        match tokio::time::timeout(self.timeout, receiver).await {
            Ok(Ok(Answer::Reply(body))) => json_answer(body),
            Ok(Ok(Answer::Reloaded)) | Ok(Err(_)) => plain(
                StatusCode::SERVICE_UNAVAILABLE,
                "Loam reloaded; the call may have run",
            ),
            Ok(Ok(Answer::TooLarge)) => plain(
                StatusCode::GATEWAY_TIMEOUT,
                "The answer was over 4 MiB; the call may have run",
            ),
            Err(_) => plain(
                StatusCode::GATEWAY_TIMEOUT,
                "No answer within 60 s; the call may have run, so check before you retry a change",
            ),
        }
    }
}

/// The statement for one message: `{ id, message }` for a request, `{ message }` for a notification. The detail is
/// `JSON.parse` of one string literal under 10.4's serialization rule, never an object literal, so nothing a client
/// sent is formatted into code and the page receives exactly the JSON sent: as an object literal, a `"__proto__"` key
/// would set the object's prototype rather than an own property.
pub fn script(id: Option<u64>, message: &Value) -> String {
    let detail = match id {
        Some(id) => json!({ "id": id, "message": message }),
        None => json!({ "message": message }),
    };
    let text = serde_json::to_string(&detail).expect("a JSON value serialises");
    format!(
        "window.dispatchEvent(new CustomEvent('{EVENT}',{{detail:JSON.parse({})}}))",
        literal(&Value::String(text))
    )
}

/// Serves `listener` until `stop` changes, one task per connection, over HTTP/1.1.
pub async fn serve(listener: TcpListener, inbound: Arc<Inbound>, mut stop: watch::Receiver<bool>) {
    let open = Arc::new(tokio::sync::Semaphore::new(CONNECTIONS_MAX));
    loop {
        let accepted = tokio::select! {
            accepted = listener.accept() => accepted,
            _ = stop.changed() => return,
        };
        let Ok((stream, _)) = accepted else {
            // Out of descriptors, say: a moment's pause rather than a spin.
            tokio::time::sleep(Duration::from_millis(50)).await;
            continue;
        };
        // Past the cap the connection is closed at once, before anything is read.
        let Ok(slot) = open.clone().try_acquire_owned() else {
            drop(stream);
            continue;
        };
        let inbound = inbound.clone();
        let mut stopped = stop.clone();
        tokio::spawn(async move {
            let _slot = slot;
            let service = hyper::service::service_fn(move |request| {
                let inbound = inbound.clone();
                async move { Ok::<_, std::convert::Infallible>(inbound.handle(request).await) }
            });
            let connection = hyper::server::conn::http1::Builder::new()
                .timer(hyper_util::rt::TokioTimer::new())
                .header_read_timeout(READ_TIMEOUT)
                .serve_connection(hyper_util::rt::TokioIo::new(stream), service);
            tokio::select! {
                _ = connection => {}
                _ = stopped.changed() => {}
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    struct Fixture {
        inbound: Arc<Inbound>,
        url: String,
        port: u16,
        delivered: Arc<StdMutex<Vec<Value>>>,
        stop: watch::Sender<bool>,
    }

    const TOKEN: &str = "t0ken";

    /// The endpoint on a free port, with a webview that records each event's detail and, when `answer` is given,
    /// replies to each request with it.
    async fn fixture(answer: Option<fn(&Value) -> Value>, timeout: Duration) -> Fixture {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let delivered = Arc::new(StdMutex::new(Vec::new()));
        let held: Arc<StdMutex<Option<Arc<Inbound>>>> = Arc::new(StdMutex::new(None));
        let deliver: Deliver = {
            let delivered = delivered.clone();
            let held = held.clone();
            Arc::new(move |statement: String| {
                let detail = detail_of(&statement);
                delivered.lock().unwrap().push(detail.clone());
                if let (Some(answer), Some(id)) = (answer, detail["id"].as_u64()) {
                    let inbound = held.lock().unwrap().clone().unwrap();
                    let reply = answer(&detail["message"]);
                    tokio::spawn(async move { inbound.reply(id, &reply) });
                }
            })
        };
        let inbound = Inbound::with_timeout(port, TOKEN, deliver, timeout);
        *held.lock().unwrap() = Some(inbound.clone());
        let (stop, stopped) = watch::channel(false);
        tokio::spawn(serve(listener, inbound.clone(), stopped));
        Fixture {
            inbound,
            url: format!("http://127.0.0.1:{port}/mcp"),
            port,
            delivered,
            stop,
        }
    }

    /// The event's detail, read back from the statement as the page's `JSON.parse` reads it.
    fn detail_of(statement: &str) -> Value {
        let start = statement.find("{detail:JSON.parse(").unwrap() + "{detail:JSON.parse(".len();
        // The statement ends `)}))`: the literal, `JSON.parse`'s call, the options object, the constructor and the call.
        let text: String = serde_json::from_str(&statement[start..statement.len() - 4]).unwrap();
        serde_json::from_str(&text).unwrap()
    }

    fn echo(message: &Value) -> Value {
        json!({ "jsonrpc": "2.0", "id": message["id"], "result": { "echo": message["method"] } })
    }

    fn client() -> reqwest::Client {
        reqwest::Client::builder().no_proxy().build().unwrap()
    }

    async fn json_of(response: reqwest::Response) -> Value {
        serde_json::from_slice(&response.bytes().await.unwrap()).unwrap()
    }

    fn ping(id: u64) -> String {
        json!({ "jsonrpc": "2.0", "id": id, "method": "ping" }).to_string()
    }

    async fn post(url: &str, headers: &[(&str, &str)], body: String) -> reqwest::Response {
        let mut request = client().post(url).body(body);
        for (name, value) in headers {
            request = request.header(*name, *value);
        }
        request.send().await.unwrap()
    }

    const BEARER: (&str, &str) = ("Authorization", "Bearer t0ken");

    #[test]
    fn the_token_is_32_random_bytes_in_base64url() {
        let first = token();
        assert_eq!(first.len(), 43);
        assert!(
            first
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
        );
        assert_ne!(first, token());
        assert_eq!(base64url(b"\xfb\xff"), "-_8");
        assert_eq!(base64url(b"Man"), "TWFu");
        assert!(same(b"abc", b"abc") && !same(b"abc", b"abd") && !same(b"abc", b"ab"));
    }

    #[test]
    fn the_statement_is_data_under_the_serialization_rule() {
        let statement = script(
            Some(7),
            &json!({ "method": "</script><!--\u{2028}\u{2029}'\"&" }),
        );
        assert!(!statement.contains('<') && !statement.contains('\u{2028}'));
        assert!(statement.starts_with(
            "window.dispatchEvent(new CustomEvent('loam:inbound',{detail:JSON.parse(\"{"
        ));
        // A `__proto__` key stays data: the page parses it from a string, never meets it as an object literal.
        let prototype = json!({ "method": "tools/call", "params": { "arguments": { "__proto__": { "x": 1 } } } });
        assert_eq!(
            detail_of(&script(Some(1), &prototype))["message"],
            prototype
        );
        assert!(!script(Some(1), &prototype).contains("{\"__proto__\""));
        assert_eq!(
            detail_of(&statement),
            json!({ "id": 7, "message": { "method": "</script><!--\u{2028}\u{2029}'\"&" } })
        );
        assert_eq!(
            detail_of(&script(
                None,
                &json!({ "method": "notifications/initialized" })
            )),
            json!({ "message": { "method": "notifications/initialized" } })
        );
    }

    #[tokio::test]
    async fn p6_d6_every_check_answers_before_anything_is_forwarded() {
        let f = fixture(Some(echo), REPLY_TIMEOUT).await;
        f.inbound.set_ready();
        let port = f.port.to_string();
        // No token, a wrong one, the last run's, and two headers.
        for headers in [
            vec![],
            vec![("Authorization", "Bearer wrong")],
            vec![("Authorization", "Bearer t0ke")],
            vec![("Authorization", "t0ken")],
        ] {
            let response = post(&f.url, &headers, ping(1)).await;
            assert_eq!(response.status(), 401, "{headers:?}");
        }
        // Another `Host`, through the same socket.
        for host in [
            "example.com",
            "127.0.0.1",
            "127.0.0.2:1",
            "evil.localhost:1",
        ] {
            let response = post(&f.url, &[BEARER, ("Host", host)], ping(1)).await;
            assert_eq!(response.status(), 421, "{host}");
        }
        // `localhost:<port>` is accepted.
        let localhost = format!("localhost:{port}");
        let response = post(&f.url, &[BEARER, ("Host", &localhost)], ping(1)).await;
        assert_eq!(response.status(), 200);
        // Any `Origin`, a valid token or not.
        for origin in [
            "null",
            "http://127.0.0.1",
            "loam://localhost",
            "https://example.com",
        ] {
            let response = post(&f.url, &[BEARER, ("Origin", origin)], ping(1)).await;
            assert_eq!(response.status(), 403, "{origin}");
        }
        // Another path, a query, and methods but `POST`.
        let other = format!("http://127.0.0.1:{port}/");
        assert_eq!(post(&other, &[BEARER], ping(1)).await.status(), 404);
        let query = format!("{}?x=1", f.url);
        assert_eq!(post(&query, &[BEARER], ping(1)).await.status(), 404);
        for method in [
            reqwest::Method::GET,
            reqwest::Method::DELETE,
            reqwest::Method::PUT,
        ] {
            let response = client()
                .request(method.clone(), &f.url)
                .header(BEARER.0, BEARER.1)
                .send()
                .await
                .unwrap();
            assert_eq!(response.status(), 405, "{method}");
        }
        // A batch, an array of one, a response, a non-JSON body, an id that is neither a string nor a safe integer.
        for body in [
            json!([{ "jsonrpc": "2.0", "id": 1, "method": "ping" }]).to_string(),
            json!({ "jsonrpc": "2.0", "id": 1, "result": {} }).to_string(),
            "not json".into(),
            json!({ "jsonrpc": "2.0", "id": 1.5, "method": "ping" }).to_string(),
            json!({ "jsonrpc": "2.0", "id": 9007199254740992u64, "method": "ping" }).to_string(),
            json!({ "jsonrpc": "2.0", "id": null, "method": "ping" }).to_string(),
            json!({ "id": 1, "method": "ping" }).to_string(),
        ] {
            assert_eq!(
                post(&f.url, &[BEARER], body.clone()).await.status(),
                400,
                "{body}"
            );
        }
        // A message over 1 MiB.
        let big = json!({ "jsonrpc": "2.0", "id": 1, "method": "ping", "params": { "pad": "x".repeat(REQUEST_MAX) } });
        assert_eq!(post(&f.url, &[BEARER], big.to_string()).await.status(), 413);
        // Only the two accepted pings reached the webview, as their bodies alone.
        let delivered = f.delivered.lock().unwrap().clone();
        assert_eq!(delivered.len(), 1);
        assert_eq!(
            delivered[0]["message"],
            json!({ "jsonrpc": "2.0", "id": 1, "method": "ping" })
        );
        assert!(!delivered[0].to_string().contains(TOKEN));
        let _ = f.stop.send(true);
    }

    #[tokio::test]
    async fn p6_d6_a_request_is_answered_with_the_kernels_reply_and_a_notification_with_202() {
        let f = fixture(Some(echo), REPLY_TIMEOUT).await;
        f.inbound.set_ready();
        let response = post(
            &f.url,
            &[BEARER, ("Content-Type", "application/json")],
            ping(42),
        )
        .await;
        assert_eq!(response.status(), 200);
        assert_eq!(response.headers()["content-type"], "application/json");
        assert_eq!(response.headers()["cache-control"], "no-store");
        assert!(response.headers().get("mcp-session-id").is_none());
        assert_eq!(
            json_of(response).await,
            json!({ "jsonrpc": "2.0", "id": 42, "result": { "echo": "ping" } })
        );
        let notification = json!({ "jsonrpc": "2.0", "method": "notifications/initialized" });
        let response = post(&f.url, &[BEARER], notification.to_string()).await;
        assert_eq!(response.status(), 202);
        assert!(response.bytes().await.unwrap().is_empty());
        let delivered = f.delivered.lock().unwrap().clone();
        assert_eq!(delivered[1], json!({ "message": notification }));
        // The host's ids are its own: the client's never reaches `inbound_reply`'s lookup.
        assert_eq!(delivered[0]["id"], 1);
        let _ = f.stop.send(true);
    }

    #[tokio::test]
    async fn p6_d6_503_before_ready_and_for_a_request_waiting_through_a_reload() {
        let f = fixture(None, REPLY_TIMEOUT).await;
        assert_eq!(post(&f.url, &[BEARER], ping(1)).await.status(), 503);
        assert!(f.delivered.lock().unwrap().is_empty());
        f.inbound.set_ready();
        let url = f.url.clone();
        let waiting = tokio::spawn(async move { post(&url, &[BEARER], ping(2)).await.status() });
        while f.delivered.lock().unwrap().is_empty() {
            tokio::task::yield_now().await;
        }
        f.inbound.page_started();
        assert_eq!(waiting.await.unwrap(), 503);
        // After the reload, until the new page says it is ready; a notification too, never `202` for no page.
        assert_eq!(post(&f.url, &[BEARER], ping(3)).await.status(), 503);
        let note = json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }).to_string();
        assert_eq!(post(&f.url, &[BEARER], note).await.status(), 503);
        // A `ready` while the load is under way may be the outgoing page's: refused, and the new page asks again.
        assert!(!f.inbound.set_ready());
        assert_eq!(post(&f.url, &[BEARER], ping(3)).await.status(), 503);
        f.inbound.page_finished();
        assert!(f.inbound.set_ready());
        let url = f.url.clone();
        let next = tokio::spawn(async move { post(&url, &[BEARER], ping(4)).await });
        while f.delivered.lock().unwrap().len() < 2 {
            tokio::task::yield_now().await;
        }
        let id = f.delivered.lock().unwrap()[1]["id"].as_u64().unwrap();
        // An id never issued, and the first request's, answered after the reload, do nothing, say so, and leave the
        // waiting request waiting: no reply is forwarded.
        assert!(!f.inbound.reply(
            999,
            &json!({ "jsonrpc": "2.0", "id": 4, "result": "forged" })
        ));
        assert!(
            !f.inbound
                .reply(1, &json!({ "jsonrpc": "2.0", "id": 4, "result": "late" }))
        );
        assert!(f.inbound.pending.lock().unwrap().contains_key(&id));
        assert!(
            f.inbound
                .reply(id, &json!({ "jsonrpc": "2.0", "id": 4, "result": "real" }))
        );
        // Already answered: nothing.
        assert!(
            !f.inbound
                .reply(id, &json!({ "jsonrpc": "2.0", "id": 4, "result": "again" }))
        );
        let response = next.await.unwrap();
        assert_eq!(response.status(), 200);
        assert_eq!(json_of(response).await["result"], "real");
        let _ = f.stop.send(true);
    }

    #[tokio::test]
    async fn p6_d6_no_answer_in_time_and_an_answer_over_4_mib_are_504() {
        let f = fixture(None, Duration::from_millis(200)).await;
        f.inbound.set_ready();
        assert_eq!(post(&f.url, &[BEARER], ping(1)).await.status(), 504);
        assert!(f.inbound.pending.lock().unwrap().is_empty());
        let _ = f.stop.send(true);
        fn huge(message: &Value) -> Value {
            json!({ "jsonrpc": "2.0", "id": message["id"], "result": "x".repeat(RESPONSE_MAX) })
        }
        let f = fixture(Some(huge), REPLY_TIMEOUT).await;
        f.inbound.set_ready();
        assert_eq!(post(&f.url, &[BEARER], ping(1)).await.status(), 504);
        let _ = f.stop.send(true);
    }

    #[tokio::test]
    async fn a_client_that_hangs_up_leaves_nothing_waiting_and_the_limit_holds() {
        let f = fixture(None, REPLY_TIMEOUT).await;
        f.inbound.set_ready();
        let mut held = Vec::new();
        for id in 0..IN_FLIGHT_MAX as u64 {
            let url = f.url.clone();
            held.push(tokio::spawn(async move {
                post(&url, &[BEARER], ping(id)).await
            }));
        }
        while f.inbound.pending.lock().unwrap().len() < IN_FLIGHT_MAX {
            tokio::task::yield_now().await;
        }
        let response = post(&f.url, &[BEARER], ping(99)).await;
        assert_eq!(response.status(), 429);
        assert_eq!(response.headers()["retry-after"], "1");
        for task in &held {
            task.abort();
        }
        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        while !f.inbound.pending.lock().unwrap().is_empty() {
            assert!(
                tokio::time::Instant::now() < deadline,
                "a hung-up request stayed waiting"
            );
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        let _ = f.stop.send(true);
    }

    #[tokio::test]
    async fn connections_past_the_cap_are_closed_before_anything_is_read() {
        let f = fixture(Some(echo), REPLY_TIMEOUT).await;
        f.inbound.set_ready();
        // Idle connections that never send a header, as a process without the token can open.
        let mut idle = Vec::new();
        for _ in 0..CONNECTIONS_MAX {
            idle.push(
                tokio::net::TcpStream::connect(("127.0.0.1", f.port))
                    .await
                    .unwrap(),
            );
        }
        // Each one has been accepted once a request on a new connection is refused.
        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        loop {
            let refused = client()
                .post(&f.url)
                .header(BEARER.0, BEARER.1)
                .body(ping(1))
                .send()
                .await
                .is_err();
            if refused {
                break;
            }
            assert!(tokio::time::Instant::now() < deadline, "the cap never held");
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        drop(idle);
        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        loop {
            let answered = client()
                .post(&f.url)
                .header(BEARER.0, BEARER.1)
                .body(ping(2))
                .send()
                .await
                .is_ok_and(|response| response.status() == 200);
            if answered {
                break;
            }
            assert!(
                tokio::time::Instant::now() < deadline,
                "slots were not released"
            );
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        let _ = f.stop.send(true);
    }

    #[tokio::test]
    async fn after_stop_nothing_listens() {
        let f = fixture(Some(echo), REPLY_TIMEOUT).await;
        f.inbound.set_ready();
        assert_eq!(post(&f.url, &[BEARER], ping(1)).await.status(), 200);
        let _ = f.stop.send(true);
        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        loop {
            let refused = client()
                .post(&f.url)
                .header(BEARER.0, BEARER.1)
                .body(ping(2))
                .send()
                .await
                .is_err();
            if refused {
                break;
            }
            assert!(tokio::time::Instant::now() < deadline, "still listening");
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }
}

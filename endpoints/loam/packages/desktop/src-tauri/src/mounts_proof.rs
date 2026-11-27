//! Pre-bearer server identity verification and connection-bound loopback HTTP/1.1 transport for
//! managed plugin engines (phase 5 no-terminal amendment, 5.2 and 5.3).
use super::{
    ANSWER_TIMEOUT, Notify, RESPONSE_MAX, RESULT_INVALID, UNAUTHORIZED, UNREACHABLE, event_data,
    is_notification, next_event, response_id,
};
use crate::desktop_state::hex64;
use bytes::Bytes;
use hmac::{Hmac, KeyInit, Mac};
use http_body_util::{BodyExt, Full};
use serde_json::Value;
use sha2::Sha256;
use std::time::Duration;
use tokio::sync::Mutex;

/// Pre-bearer `/health` proof timeout (phase 5 no-terminal amendment, 5.2).
pub(super) const PROOF_TIMEOUT: Duration = Duration::from_secs(2);
/// Maximum `/health` response body bytes drained and discarded unread to preserve HTTP/1.1
/// keep-alive framing on the verified TCP connection; larger or unclosed bodies fail closed.
const HEALTH_BODY_DISCARD_MAX: usize = 4096;

/// Parsed loopback HTTP target for `proof_key`-verified mounts: host is strictly `127.0.0.1` or
/// `[::1]`, scheme is `http`, port is explicit, and credentials/query/fragment are forbidden.
#[derive(Clone)]
pub(super) struct LoopbackTarget {
    pub(super) ip: std::net::IpAddr,
    pub(super) port: u16,
    pub(super) authority: String,
    pub(super) mcp_path: String,
}

pub(super) fn loopback_target(url: &str) -> Option<LoopbackTarget> {
    let parsed = reqwest::Url::parse(url).ok()?;
    if parsed.scheme() != "http"
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return None;
    }
    let host = parsed.host_str()?;
    let ip = match host {
        "127.0.0.1" => std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
        "[::1]" => std::net::IpAddr::V6(std::net::Ipv6Addr::LOCALHOST),
        _ => return None,
    };
    let port = parsed.port()?;
    let path = parsed.path();
    let mcp_path = if path.is_empty() {
        "/".to_owned()
    } else {
        path.to_owned()
    };
    Some(LoopbackTarget {
        ip,
        port,
        authority: format!("{host}:{port}"),
        mcp_path,
    })
}

struct AbortOnDrop(tokio::task::AbortHandle);

impl Drop for AbortOnDrop {
    fn drop(&mut self) {
        self.0.abort();
    }
}

/// One live loopback HTTP/1.1 connection that has already passed `/health` `X-Loam-Proof`.
pub(super) struct VerifiedConn {
    sender: hyper::client::conn::http1::SendRequest<Full<Bytes>>,
    _driver: AbortOnDrop,
}

fn decode_hex32(hex: &str) -> Option<[u8; 32]> {
    if !hex64(hex) {
        return None;
    }
    let bytes = hex.as_bytes();
    let mut out = Vec::with_capacity(32);
    for pair in bytes.as_chunks::<2>().0 {
        let hi = hex_nibble(pair[0])?;
        let lo = hex_nibble(pair[1])?;
        out.push((hi << 4) | lo);
    }
    out.try_into().ok()
}

fn hex_nibble(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        _ => None,
    }
}

pub(super) fn encode_hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write as _;
        let _ = write!(&mut out, "{byte:02x}");
    }
    out
}

/// Computes the 64-character lowercase hex `HMAC-SHA256(proofKey, nonce)` proof where `proof_key`
/// is decoded from 64 lowercase hex characters into its 32-byte key and `nonce` is hashed as its
/// 64-character ASCII lowercase hex string (amendment 5.2).
#[allow(dead_code)]
pub(crate) fn compute_proof(proof_key: &str, nonce: &str) -> Option<String> {
    let key = decode_hex32(proof_key)?;
    if !hex64(nonce) {
        return None;
    }
    let mut mac = Hmac::<Sha256>::new_from_slice(&key)
        .unwrap_or_else(|_| unreachable!("HMAC-SHA256 accepts a 32-byte key"));
    mac.update(nonce.as_bytes());
    Some(encode_hex(&mac.finalize().into_bytes()))
}

/// Verifies `X-Loam-Proof` in constant time against `HMAC-SHA256(proofKey, nonce)` (amendment 5.2).
pub(super) fn verify_proof_header(proof_key: &str, nonce: &str, header: &str) -> bool {
    let Some(key) = decode_hex32(proof_key) else {
        return false;
    };
    if !hex64(nonce) {
        return false;
    }
    let Some(received) = decode_hex32(header) else {
        return false;
    };
    let mut mac = Hmac::<Sha256>::new_from_slice(&key)
        .unwrap_or_else(|_| unreachable!("HMAC-SHA256 accepts a 32-byte key"));
    mac.update(nonce.as_bytes());
    mac.verify_slice(&received).is_ok()
}

/// Why [`connect_and_verify_detailed`] failed to establish a verified loopback connection.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ProofConnectError {
    /// TCP connection could not be opened or timed out before a response arrived.
    ConnectFailed,
    /// A listener answered `/health` without HTTP 200 and a valid `X-Loam-Proof` header, or
    /// exceeded the response discard cap / closed keep-alive: likely another program on the port.
    ProofFailed,
}

/// Opens a direct loopback TCP connection (no proxy, no redirects) and verifies the peer via
/// unauthenticated `GET /health?nonce=<64-random-hex>` + constant-time `X-Loam-Proof` before
/// returning the live connection for subsequent authenticated MCP requests (amendment 5.2).
pub(crate) async fn connect_and_verify_detailed(
    target: &LoopbackTarget,
    proof_key: &str,
    timeout: Duration,
) -> Result<VerifiedConn, ProofConnectError> {
    if !hex64(proof_key) {
        return Err(ProofConnectError::ProofFailed);
    }
    let mut nonce_bytes = [0u8; 32];
    getrandom::fill(&mut nonce_bytes).map_err(|_| ProofConnectError::ConnectFailed)?;
    let nonce = encode_hex(&nonce_bytes);

    tokio::time::timeout(timeout, async {
        let stream = tokio::net::TcpStream::connect((target.ip, target.port))
            .await
            .map_err(|_| ProofConnectError::ConnectFailed)?;
        let (mut sender, conn) =
            hyper::client::conn::http1::handshake(hyper_util::rt::TokioIo::new(stream))
                .await
                .map_err(|_| ProofConnectError::ConnectFailed)?;
        let driver = AbortOnDrop(
            tokio::spawn(async move {
                let _ = conn.await;
            })
            .abort_handle(),
        );

        let request = hyper::Request::builder()
            .method(hyper::Method::GET)
            .uri(format!("/health?nonce={nonce}"))
            .header(hyper::header::HOST, target.authority.as_str())
            .body(Full::new(Bytes::new()))
            .map_err(|_| ProofConnectError::ConnectFailed)?;
        sender
            .ready()
            .await
            .map_err(|_| ProofConnectError::ConnectFailed)?;
        let response = sender
            .send_request(request)
            .await
            .map_err(|_| ProofConnectError::ConnectFailed)?;
        let status = response.status();
        let proof_ok = if status == hyper::StatusCode::OK {
            let mut headers = response.headers().get_all("X-Loam-Proof").iter();
            match (headers.next(), headers.next()) {
                (Some(value), None) => value
                    .to_str()
                    .ok()
                    .is_some_and(|proof| verify_proof_header(proof_key, &nonce, proof)),
                _ => false,
            }
        } else {
            false
        };
        if !proof_ok {
            return Err(ProofConnectError::ProofFailed);
        }
        // Discard any `/health` response body unread (bounded to `HEALTH_BODY_DISCARD_MAX`) so the
        // HTTP/1.1 connection stays cleanly framed for subsequent authenticated requests on this
        // exact verified TCP socket without buffering or parsing untrusted body bytes.
        let mut body = response.into_body();
        let mut discarded = 0usize;
        while let Some(frame) = body.frame().await {
            let frame = frame.map_err(|_| ProofConnectError::ProofFailed)?;
            if let Some(data) = frame.data_ref() {
                discarded = discarded.saturating_add(data.len());
                if discarded > HEALTH_BODY_DISCARD_MAX {
                    return Err(ProofConnectError::ProofFailed);
                }
            }
        }
        // Confirm the verified connection remains open for keep-alive reuse (refuses `Connection: close`).
        sender
            .ready()
            .await
            .map_err(|_| ProofConnectError::ProofFailed)?;
        Ok(VerifiedConn {
            sender,
            _driver: driver,
        })
    })
    .await
    .map_err(|_| ProofConnectError::ConnectFailed)?
}

pub(super) async fn connect_and_verify(
    target: &LoopbackTarget,
    proof_key: &str,
    timeout: Duration,
) -> Result<VerifiedConn, &'static str> {
    connect_and_verify_detailed(target, proof_key, timeout)
        .await
        .map_err(|_| UNREACHABLE)
}

/// Pre-bearer server identity verification (phase 5 no-terminal amendment, 5.2): sends an
/// unauthenticated `GET http://<loopback>:<port>/health?nonce=<64-random-hex>` with no redirects,
/// no proxy, and a 2 s timeout, discards the response body unread, and verifies HTTP `200` plus a
/// single `X-Loam-Proof` header matching `HMAC-SHA256(proofKey, nonce)` in constant time.
#[allow(dead_code)]
pub(crate) async fn verify_proof(url: &str, proof_key: &str) -> Result<(), &'static str> {
    let target = loopback_target(url).ok_or(UNREACHABLE)?;
    connect_and_verify(&target, proof_key, PROOF_TIMEOUT)
        .await
        .map(|_| ())
}

/// Sends one MCP message over a `proof_key`-verified loopback HTTP/1.1 connection. If the held
/// verified socket has closed, opens a new TCP connection and runs a fresh `/health` proof BEFORE
/// transmitting any `Authorization` header (amendment 5.2).
#[allow(clippy::too_many_arguments)]
pub(super) async fn send_verified_http(
    handle: u64,
    target: &LoopbackTarget,
    proof_key: &str,
    proof_timeout: Duration,
    conn_slot: &Mutex<Option<VerifiedConn>>,
    bearer: Option<&str>,
    session: &Mutex<Option<String>>,
    message: &Value,
    encoded: Vec<u8>,
    notify: Notify,
) -> Result<Value, &'static str> {
    let modern = crate::era::headers(message)?;
    let held_session = if modern.is_some() {
        None
    } else {
        session.lock().await.clone()
    };

    let mut guard = conn_slot.lock().await;
    // Reuse the verified connection only if it is still live and ready; otherwise run fresh
    // pre-bearer `/health` proof on a new TCP connection before any bearer is sent.
    let reusable = match guard.as_mut() {
        Some(live) => live.sender.ready().await.is_ok(),
        None => false,
    };
    if !reusable {
        *guard = None;
        let fresh = connect_and_verify(target, proof_key, proof_timeout).await?;
        *guard = Some(fresh);
    }

    let mut builder = hyper::Request::builder()
        .method(hyper::Method::POST)
        .uri(target.mcp_path.as_str())
        .header(hyper::header::HOST, target.authority.as_str())
        .header(hyper::header::ACCEPT, "application/json, text/event-stream")
        .header(hyper::header::CONTENT_TYPE, "application/json");
    if let Some(bearer) = bearer {
        builder = builder.header(hyper::header::AUTHORIZATION, format!("Bearer {bearer}"));
    }
    if let Some(id) = &held_session {
        builder = builder.header("Mcp-Session-Id", id.as_str());
    }
    for (name, value) in modern.into_iter().flatten() {
        builder = builder.header(name, value);
    }
    let request = builder
        .body(Full::new(Bytes::from(encoded)))
        .map_err(|_| UNREACHABLE)?;

    let deadline = tokio::time::Instant::now() + ANSWER_TIMEOUT;
    let response = {
        let live = guard.as_mut().expect("verified connection initialized");
        match tokio::time::timeout_at(deadline, live.sender.send_request(request)).await {
            Ok(Ok(response)) => response,
            _ => {
                *guard = None;
                return Err(UNREACHABLE);
            }
        }
    };

    let status = response.status();
    if status == hyper::StatusCode::UNAUTHORIZED || status == hyper::StatusCode::FORBIDDEN {
        *guard = None;
        return Err(UNAUTHORIZED);
    }
    if status == hyper::StatusCode::NOT_FOUND && held_session.is_some() {
        *session.lock().await = None;
        *guard = None;
        return Err(UNREACHABLE);
    }
    if !status.is_success() {
        *guard = None;
        return Err(UNREACHABLE);
    }
    if message["method"] == "initialize"
        && let Some(id) = response.headers().get("Mcp-Session-Id")
    {
        let Ok(id) = id.to_str() else {
            *guard = None;
            return Err(RESULT_INVALID);
        };
        if id.is_empty() || id.len() > 256 || !id.bytes().all(|byte| (0x21..=0x7e).contains(&byte))
        {
            *guard = None;
            return Err(RESULT_INVALID);
        }
        *session.lock().await = Some(id.to_owned());
    }
    let content_type = response
        .headers()
        .get(hyper::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    let expects_answer = message.get("id").is_some() && message.get("method").is_some();
    let stream = content_type.starts_with("text/event-stream");
    if !stream && !content_type.is_empty() && !content_type.starts_with("application/json") {
        *guard = None;
        return Err(RESULT_INVALID);
    }
    let mut body = response.into_body();
    let mut bytes = Vec::new();
    let mut read = 0usize;
    let body_result = tokio::time::timeout_at(deadline, async {
        while let Some(frame) = body.frame().await {
            let frame = frame.map_err(|_| UNREACHABLE)?;
            let Some(chunk) = frame.data_ref() else {
                continue;
            };
            read += chunk.len();
            if read > RESPONSE_MAX {
                return Err(RESULT_INVALID);
            }
            bytes.extend_from_slice(chunk);
            if stream {
                while let Some(event) = next_event(&mut bytes) {
                    let Some(value) = event_data(&event)? else {
                        continue;
                    };
                    if response_id(&value).is_some() && value.get("id") == message.get("id") {
                        return Ok(Some(value));
                    }
                    if is_notification(&value) {
                        notify(handle, value);
                    }
                }
            }
        }
        Ok(None)
    })
    .await;
    match body_result {
        Ok(Ok(Some(early))) => {
            // SSE returned early before EOF; drop the connection so the next call re-verifies cleanly.
            *guard = None;
            return Ok(early);
        }
        Ok(Ok(None)) => {}
        Ok(Err(code)) => {
            *guard = None;
            return Err(code);
        }
        Err(_) => {
            *guard = None;
            return Err(UNREACHABLE);
        }
    }
    if stream || bytes.iter().all(u8::is_ascii_whitespace) {
        return if expects_answer {
            Err(RESULT_INVALID)
        } else {
            Ok(Value::Null)
        };
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| RESULT_INVALID)?;
    if response_id(&value).is_some() && value.get("id") == message.get("id") {
        Ok(value)
    } else {
        Err(RESULT_INVALID)
    }
}

/// Outcome of a single authenticated MCP probe over a `/health`-verified loopback connection
/// (phase 5 no-terminal amendment, 5.2 & 7.3).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum VerifiedProbeError {
    /// Listener has not accepted a TCP connection yet or timed out before responding.
    NotReady,
    /// Listener failed `/health` `X-Loam-Proof` (likely a port squatter): zero bearer was sent.
    ProofFailed,
    /// Authenticated `/mcp` returned HTTP 401 or 403.
    Unauthorized,
    /// Authenticated `/mcp` answered with a non-200 status, non-JSON/SSE body, or JSON-RPC error.
    BadResponse,
}

/// Runs one pre-bearer `/health` proof check on a direct loopback TCP connection and, ONLY if
/// `X-Loam-Proof` verifies in constant time, sends `POST /mcp` (`MCP-Protocol-Version: 2026-07-28`,
/// `Authorization: Bearer <token>`) on that exact keep-alive socket and validates HTTP 200 with a
/// JSON-RPC `"result"` object and no `"error"` (amendment 5.2, 7.3, 7.4).
pub(crate) async fn probe_verified_mcp(
    url: &str,
    proof_key: &str,
    bearer: &str,
    timeout: Duration,
) -> Result<(), VerifiedProbeError> {
    let target = loopback_target(url).ok_or(VerifiedProbeError::ProofFailed)?;
    let mut verified = match connect_and_verify_detailed(&target, proof_key, timeout).await {
        Ok(conn) => conn,
        Err(ProofConnectError::ConnectFailed) => return Err(VerifiedProbeError::NotReady),
        Err(ProofConnectError::ProofFailed) => return Err(VerifiedProbeError::ProofFailed),
    };
    let payload = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2026-07-28",
            "capabilities": {},
            "clientInfo": {
                "name": "loam-desktop",
                "version": env!("CARGO_PKG_VERSION"),
            }
        }
    });
    let encoded = serde_json::to_vec(&payload).map_err(|_| VerifiedProbeError::BadResponse)?;
    let request = hyper::Request::builder()
        .method(hyper::Method::POST)
        .uri(target.mcp_path.as_str())
        .header(hyper::header::HOST, target.authority.as_str())
        .header(hyper::header::ACCEPT, "application/json, text/event-stream")
        .header(hyper::header::CONTENT_TYPE, "application/json")
        .header("MCP-Protocol-Version", "2026-07-28")
        .header("Mcp-Method", "initialize")
        .header(hyper::header::AUTHORIZATION, format!("Bearer {bearer}"))
        .body(Full::new(Bytes::from(encoded)))
        .map_err(|_| VerifiedProbeError::BadResponse)?;

    let deadline = tokio::time::Instant::now() + timeout;
    let response =
        match tokio::time::timeout_at(deadline, verified.sender.send_request(request)).await {
            Ok(Ok(resp)) => resp,
            _ => return Err(VerifiedProbeError::NotReady),
        };
    let status = response.status();
    if status == hyper::StatusCode::UNAUTHORIZED || status == hyper::StatusCode::FORBIDDEN {
        return Err(VerifiedProbeError::Unauthorized);
    }
    if status != hyper::StatusCode::OK {
        return Err(VerifiedProbeError::BadResponse);
    }
    let content_type = response
        .headers()
        .get(hyper::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    let is_sse = content_type.starts_with("text/event-stream");
    if !is_sse && !content_type.is_empty() && !content_type.starts_with("application/json") {
        return Err(VerifiedProbeError::BadResponse);
    }
    let mut body = response.into_body();
    let mut buf = Vec::new();
    let read_result = tokio::time::timeout_at(deadline, async {
        while let Some(frame) = body.frame().await {
            let frame = frame.map_err(|_| VerifiedProbeError::BadResponse)?;
            if let Some(chunk) = frame.data_ref() {
                if buf.len().saturating_add(chunk.len()) > RESPONSE_MAX {
                    return Err(VerifiedProbeError::BadResponse);
                }
                buf.extend_from_slice(chunk);
                if is_sse {
                    while let Some(event) = next_event(&mut buf) {
                        if let Ok(Some(value)) = event_data(&event)
                            && value.get("id") == Some(&serde_json::json!(1))
                        {
                            return Ok(Some(value));
                        }
                    }
                }
            }
        }
        Ok(None)
    })
    .await;
    let answer = match read_result {
        Ok(Ok(Some(v))) => v,
        Ok(Ok(None)) if !is_sse => {
            serde_json::from_slice::<Value>(&buf).map_err(|_| VerifiedProbeError::BadResponse)?
        }
        _ => return Err(VerifiedProbeError::BadResponse),
    };
    validate_initialize_answer(&answer)
}

fn validate_initialize_answer(answer: &Value) -> Result<(), VerifiedProbeError> {
    if answer.get("jsonrpc") == Some(&Value::String("2.0".to_owned()))
        && answer.get("id") == Some(&serde_json::json!(1))
        && answer.get("result").is_some_and(Value::is_object)
        && answer.get("error").is_none()
    {
        Ok(())
    } else {
        Err(VerifiedProbeError::BadResponse)
    }
}

/// Runs one unauthenticated MCP 2026-07-28 `initialize` probe (`auth.mode = "none"`) over a direct
/// loopback HTTP/1.1 connection using the exact same `RESPONSE_MAX` cap and JSON/SSE response
/// parser as [`probe_verified_mcp`].
pub(crate) async fn probe_unauthenticated_mcp_bounded(
    url: &str,
    timeout: Duration,
) -> Result<(), VerifiedProbeError> {
    let target = loopback_target(url).ok_or(VerifiedProbeError::BadResponse)?;
    let deadline = tokio::time::Instant::now() + timeout;
    let stream = match tokio::time::timeout_at(
        deadline,
        tokio::net::TcpStream::connect((target.ip, target.port)),
    )
    .await
    {
        Ok(Ok(s)) => s,
        _ => return Err(VerifiedProbeError::NotReady),
    };
    let (mut sender, conn) = match tokio::time::timeout_at(
        deadline,
        hyper::client::conn::http1::handshake(hyper_util::rt::TokioIo::new(stream)),
    )
    .await
    {
        Ok(Ok(pair)) => pair,
        _ => return Err(VerifiedProbeError::NotReady),
    };
    let _driver = AbortOnDrop(
        tokio::spawn(async move {
            let _ = conn.await;
        })
        .abort_handle(),
    );
    let payload = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2026-07-28",
            "capabilities": {},
            "clientInfo": {
                "name": "loam-desktop",
                "version": env!("CARGO_PKG_VERSION"),
            }
        }
    });
    let encoded = serde_json::to_vec(&payload).map_err(|_| VerifiedProbeError::BadResponse)?;
    let request = hyper::Request::builder()
        .method(hyper::Method::POST)
        .uri(target.mcp_path.as_str())
        .header(hyper::header::HOST, target.authority.as_str())
        .header(hyper::header::ACCEPT, "application/json, text/event-stream")
        .header(hyper::header::CONTENT_TYPE, "application/json")
        .header("MCP-Protocol-Version", "2026-07-28")
        .header("Mcp-Method", "initialize")
        .body(Full::new(Bytes::from(encoded)))
        .map_err(|_| VerifiedProbeError::BadResponse)?;

    if tokio::time::timeout_at(deadline, sender.ready())
        .await
        .ok()
        .and_then(Result::ok)
        .is_none()
    {
        return Err(VerifiedProbeError::NotReady);
    }
    let response = match tokio::time::timeout_at(deadline, sender.send_request(request)).await {
        Ok(Ok(resp)) => resp,
        _ => return Err(VerifiedProbeError::NotReady),
    };
    if response.status() != hyper::StatusCode::OK {
        return Err(VerifiedProbeError::BadResponse);
    }
    let content_type = response
        .headers()
        .get(hyper::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    let is_sse = content_type.starts_with("text/event-stream");
    if !is_sse && !content_type.is_empty() && !content_type.starts_with("application/json") {
        return Err(VerifiedProbeError::BadResponse);
    }
    let mut body = response.into_body();
    let mut buf = Vec::new();
    let read_result = tokio::time::timeout_at(deadline, async {
        while let Some(frame) = body.frame().await {
            let frame = frame.map_err(|_| VerifiedProbeError::BadResponse)?;
            if let Some(chunk) = frame.data_ref() {
                if buf.len().saturating_add(chunk.len()) > RESPONSE_MAX {
                    return Err(VerifiedProbeError::BadResponse);
                }
                buf.extend_from_slice(chunk);
                if is_sse {
                    while let Some(event) = next_event(&mut buf) {
                        if let Ok(Some(value)) = event_data(&event)
                            && value.get("id") == Some(&serde_json::json!(1))
                        {
                            return Ok(Some(value));
                        }
                    }
                }
            }
        }
        Ok(None)
    })
    .await;
    let answer = match read_result {
        Ok(Ok(Some(v))) => v,
        Ok(Ok(None)) if !is_sse => {
            serde_json::from_slice::<Value>(&buf).map_err(|_| VerifiedProbeError::BadResponse)?
        }
        _ => return Err(VerifiedProbeError::BadResponse),
    };
    validate_initialize_answer(&answer)
}

/// Sends `DELETE` only if the already-verified TCP connection is still open; never opens a new
/// unverified connection just to transmit a bearer on close, and bounds the mutex wait so a hung
/// `send` never blocks shutdown.
pub(super) async fn close_verified_http(
    target: &LoopbackTarget,
    proof_timeout: Duration,
    conn: &Mutex<Option<VerifiedConn>>,
    bearer: Option<&str>,
    session_id: &str,
) {
    let deadline = tokio::time::Instant::now() + proof_timeout;
    if let Ok(mut guard) = tokio::time::timeout_at(deadline, conn.lock()).await {
        if let Some(live) = guard.as_mut()
            && live.sender.ready().await.is_ok()
        {
            let mut builder = hyper::Request::builder()
                .method(hyper::Method::DELETE)
                .uri(target.mcp_path.as_str())
                .header(hyper::header::HOST, target.authority.as_str())
                .header("Mcp-Session-Id", session_id);
            if let Some(bearer) = bearer {
                builder = builder.header(hyper::header::AUTHORIZATION, format!("Bearer {bearer}"));
            }
            if let Ok(req) = builder.body(Full::new(Bytes::new())) {
                let _ = tokio::time::timeout_at(deadline, live.sender.send_request(req)).await;
            }
        }
        *guard = None;
    }
}

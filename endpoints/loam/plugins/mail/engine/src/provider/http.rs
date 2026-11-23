//! One-click HTTPS POST client for `mail-unsubscribe` (RFC 8058; the
//! specification's 9.5 and 13).
//!
//! Contacts only the exact `https://` target the person approved:
//! - Never follows HTTP redirects (`3xx` is refused).
//! - Rejects non-HTTPS schemes, embedded credentials, port `0`, invalid HTTP
//!   request targets, and non-global IP addresses (loopback, private,
//!   link-local, unique-local, multicast, unspecified, 6to4, Teredo, ORCHID,
//!   benchmarking, documentation) in production.
//! - Uses `POST` with `Content-Type: application/x-www-form-urlencoded` and
//!   exact body `List-Unsubscribe=One-Click`, with no cookies or auth headers.
//! - Tracks whether request bytes were written to the transport so a drop or
//!   timeout after handover reports [`UnsubscribeOutcome::Unknown`] rather
//!   than falsely claiming nothing was sent, and aborts the connection task on
//!   cancellation.
//! - Every error string is in the engine's own words: never echoes server
//!   response bodies, headers, or URLs.

use std::fmt;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::task::{Context, Poll};
use std::time::Duration;

use async_trait::async_trait;
use http_body_util::{BodyExt, Full, Limited};
use hyper::body::Bytes;
use hyper_util::rt::TokioIo;
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::TcpStream;
use url::{Host, Url};

use super::imap::tls;

/// How long to wait in total for DNS + TCP connect (and TLS handshake).
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
/// Maximum resolved IP addresses tried for one unsubscribe target.
const MAX_CONNECT_ADDRS: usize = 4;
/// How long to wait for the HTTP POST request and response.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
/// Most response body bytes drained before dropping the connection.
const MAX_RESPONSE_BODY: usize = 64 * 1024;
/// Exact RFC 8058 section 3.1 one-click POST body.
pub const ONE_CLICK_BODY: &[u8] = b"List-Unsubscribe=One-Click";

/// Outcome of one RFC 8058 one-click HTTPS POST attempt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UnsubscribeOutcome {
    /// The endpoint accepted the request with a 2xx status.
    Accepted {
        /// HTTP status code (200..=299).
        status: u16,
    },
    /// The endpoint answered with a 3xx redirect, which the engine never follows.
    RedirectRefused {
        /// HTTP status code (300..=399).
        status: u16,
    },
    /// The endpoint rate-limited the request (429).
    RateLimited {
        /// HTTP status code (429).
        status: u16,
    },
    /// The endpoint permanently refused the request (other 4xx).
    Refused {
        /// HTTP status code (400..=499).
        status: u16,
    },
    /// The endpoint failed with a 5xx status.
    ServerError {
        /// HTTP status code (500..=599).
        status: u16,
    },
    /// Definitely not sent: URL/policy rejection, DNS, connect, or TLS failed
    /// before any HTTP request bytes were written.
    Failed(&'static str),
    /// The connection dropped, timed out, or returned an unreadable reply
    /// after request bytes were written: whether the server processed the
    /// unsubscribe is not known.
    Unknown(&'static str),
}

/// Executes an RFC 8058 one-click HTTPS POST to an approved target URL.
#[async_trait]
pub trait UnsubscribePoster: Send + Sync {
    /// Sends `POST` with `List-Unsubscribe=One-Click` to `url`.
    async fn post_one_click(&self, url: &str) -> UnsubscribeOutcome;
}

/// Production (TLS + global IP guard) and loopback-test HTTPS POST client.
#[derive(Clone)]
pub struct HttpsPoster {
    /// When `Some`, connects plain TCP to this loopback address instead of
    /// resolving the URL's host over TLS. Used only in tests against scripted
    /// HTTP doubles.
    test_endpoint: Option<SocketAddr>,
    /// Override for `REQUEST_TIMEOUT` (for timeout tests).
    request_timeout: Duration,
}

impl fmt::Debug for HttpsPoster {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("HttpsPoster")
            .field("test_endpoint", &self.test_endpoint)
            .field("request_timeout", &self.request_timeout)
            .finish()
    }
}

impl Default for HttpsPoster {
    fn default() -> Self {
        Self::new()
    }
}

impl HttpsPoster {
    /// Production client: `https://` only, OS root certificates, refuses
    /// non-global IPs and redirects.
    #[must_use]
    pub fn new() -> Self {
        Self {
            test_endpoint: None,
            request_timeout: REQUEST_TIMEOUT,
        }
    }

    /// Test client routing all validated `https://` URLs over plain TCP to a
    /// scripted loopback server at `addr`.
    ///
    /// # Panics
    /// Panics if `addr` is not a loopback address, so plain TCP can never
    /// target a remote host.
    #[must_use]
    pub fn for_test_endpoint(addr: SocketAddr) -> Self {
        assert!(
            addr.ip().is_loopback(),
            "test unsubscribe endpoint must be on loopback"
        );
        Self {
            test_endpoint: Some(addr),
            request_timeout: REQUEST_TIMEOUT,
        }
    }

    /// Sets a shorter request timeout (for tests).
    #[must_use]
    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.request_timeout = timeout;
        self
    }
}

/// Checks whether an IPv4 address is globally routable (not loopback, private,
/// link-local, CGNAT, documentation, broadcast, unspecified, or multicast).
#[must_use]
fn is_global_v4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    if ip.is_loopback()
        || ip.is_private()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_documentation()
        || ip.is_unspecified()
        || ip.is_multicast()
    {
        return false;
    }
    // 0.0.0.0/8 ("this network")
    if a == 0 {
        return false;
    }
    // 100.64.0.0/10 (RFC 6598 shared address space / CGNAT)
    if a == 100 && (64..=127).contains(&b) {
        return false;
    }
    // 192.0.0.0/24 (IETF protocol assignments)
    if a == 192 && b == 0 && c == 0 {
        return false;
    }
    // 198.18.0.0/15 (benchmarking)
    if a == 198 && (b == 18 || b == 19) {
        return false;
    }
    // 240.0.0.0/4 (reserved)
    if a >= 240 {
        return false;
    }
    true
}

/// Checks whether an IPv6 address is globally routable (including checking any
/// IPv4-mapped address against [`is_global_v4`] and rejecting special-purpose
/// prefixes such as 6to4, Teredo, ORCHID, benchmarking, and documentation).
#[must_use]
fn is_global_v6(ip: Ipv6Addr) -> bool {
    if let Some(v4) = ip.to_ipv4_mapped() {
        return is_global_v4(v4);
    }
    if ip.is_loopback() || ip.is_unspecified() || ip.is_multicast() {
        return false;
    }
    let segs = ip.segments();
    // Unique local fc00::/7
    if (segs[0] & 0xfe00) == 0xfc00 {
        return false;
    }
    // Link-local unicast fe80::/10
    if (segs[0] & 0xffc0) == 0xfe80 {
        return false;
    }
    // Discard-only 100::/64
    if segs[0] == 0x0100 && segs[1] == 0 && segs[2] == 0 && segs[3] == 0 {
        return false;
    }
    // 6to4 2002::/16 (embeds arbitrary IPv4)
    if segs[0] == 0x2002 {
        return false;
    }
    // RFC 9637 documentation 3fff::/20
    if segs[0] == 0x3fff && (segs[1] & 0xf000) == 0x0000 {
        return false;
    }
    // 2001:: special-purpose sub-blocks
    if segs[0] == 0x2001 {
        // Teredo 2001:0000::/32
        if segs[1] == 0x0000 {
            return false;
        }
        // Benchmarking 2001:0002::/48
        if segs[1] == 0x0002 && segs[2] == 0x0000 {
            return false;
        }
        // ORCHID / ORCHIDv2 2001:0010::/28 and 2001:0020::/28
        if (segs[1] & 0xfff0) == 0x0010 || (segs[1] & 0xfff0) == 0x0020 {
            return false;
        }
        // Documentation 2001:0db8::/32
        if segs[1] == 0x0db8 {
            return false;
        }
    }
    // Only allow global unicast (2000::/3)
    (segs[0] & 0xe000) == 0x2000
}

/// Whether `ip` is a globally routable unicast IP address.
#[must_use]
pub fn is_global_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_global_v4(v4),
        IpAddr::V6(v6) => is_global_v6(v6),
    }
}

/// Extracts the HTTP/1.1 request-target (`path[?query]`) for `url`.
fn request_target_of(url: &Url) -> String {
    let path = if url.path().is_empty() {
        "/"
    } else {
        url.path()
    };
    match url.query() {
        Some(query) => format!("{path}?{query}"),
        None => path.to_string(),
    }
}

/// Validates that `url` is an allowed RFC 8058 one-click HTTPS target:
/// `https://` scheme, no credentials, non-zero port, valid RFC 3986 HTTP
/// request-target, and valid public host (never `localhost`, `.localhost`,
/// `.local`, or a non-global IP literal).
#[must_use]
pub fn is_allowed_https_url(url: &Url) -> bool {
    if url.scheme() != "https" {
        return false;
    }
    if !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    if url.port() == Some(0) {
        return false;
    }
    let target = request_target_of(url);
    if hyper::Uri::try_from(target.as_str()).is_err()
        || target
            .bytes()
            .any(|b| matches!(b, b'{' | b'}' | b'|' | b'^' | b'`' | b'\\'))
    {
        return false;
    }
    match url.host() {
        Some(Host::Domain(domain)) => {
            let lower = domain.trim_end_matches('.').to_ascii_lowercase();
            !(lower.is_empty()
                || lower == "localhost"
                || lower.ends_with(".localhost")
                || lower.ends_with(".local")
                || !lower.contains('.'))
        }
        Some(Host::Ipv4(v4)) => is_global_v4(v4),
        Some(Host::Ipv6(v6)) => is_global_v6(v6),
        None => false,
    }
}

/// How [`HttpsPoster`] connects to a validated URL and names it on the wire.
#[derive(Debug, Clone, PartialEq, Eq)]
enum ConnectPlan {
    /// IP literal: skip DNS, connect directly to `addr`, pass unbracketed
    /// `tls_name` to `rustls::ServerName`.
    Direct {
        addr: SocketAddr,
        tls_name: String,
        host_header: String,
    },
    /// Domain name: resolve DNS, verify all IPs are global, connect, pass
    /// `domain` to `rustls::ServerName`.
    Resolve {
        domain: String,
        port: u16,
        host_header: String,
    },
}

impl ConnectPlan {
    fn from_url(url: &Url) -> Option<Self> {
        let port = url.port_or_known_default().unwrap_or(443);
        let raw_host = url.host_str()?;
        let host_header = if url.port().is_some() {
            format!("{raw_host}:{port}")
        } else {
            raw_host.to_string()
        };
        match url.host()? {
            Host::Ipv4(v4) => Some(Self::Direct {
                addr: SocketAddr::new(IpAddr::V4(v4), port),
                tls_name: v4.to_string(),
                host_header,
            }),
            Host::Ipv6(v6) => Some(Self::Direct {
                addr: SocketAddr::new(IpAddr::V6(v6), port),
                tls_name: v6.to_string(),
                host_header,
            }),
            Host::Domain(domain) => Some(Self::Resolve {
                domain: domain.to_string(),
                port,
                host_header,
            }),
        }
    }

    fn host_header(&self) -> &str {
        match self {
            Self::Direct { host_header, .. } | Self::Resolve { host_header, .. } => host_header,
        }
    }
}

/// Aborts a spawned hyper HTTP/1 connection driver whenever the caller's
/// future finishes or is dropped (server timeout / terminal Ctrl-C).
struct AbortOnDrop<T>(tokio::task::JoinHandle<T>);

impl<T> Drop for AbortOnDrop<T> {
    fn drop(&mut self) {
        self.0.abort();
    }
}

enum HttpStream {
    Plain(TcpStream),
    Tls(Box<tokio_rustls::client::TlsStream<TcpStream>>),
}

struct TrackingStream {
    inner: HttpStream,
    wrote_any: Arc<AtomicBool>,
}

impl AsyncRead for TrackingStream {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        match &mut self.get_mut().inner {
            HttpStream::Plain(s) => Pin::new(s).poll_read(cx, buf),
            HttpStream::Tls(s) => Pin::new(s.as_mut()).poll_read(cx, buf),
        }
    }
}

impl AsyncWrite for TrackingStream {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        let this = self.get_mut();
        let poll = match &mut this.inner {
            HttpStream::Plain(s) => Pin::new(s).poll_write(cx, buf),
            HttpStream::Tls(s) => Pin::new(s.as_mut()).poll_write(cx, buf),
        };
        if let Poll::Ready(Ok(n)) = &poll
            && *n > 0
        {
            this.wrote_any.store(true, Ordering::Release);
        }
        poll
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        match &mut self.get_mut().inner {
            HttpStream::Plain(s) => Pin::new(s).poll_flush(cx),
            HttpStream::Tls(s) => Pin::new(s.as_mut()).poll_flush(cx),
        }
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        match &mut self.get_mut().inner {
            HttpStream::Plain(s) => Pin::new(s).poll_shutdown(cx),
            HttpStream::Tls(s) => Pin::new(s.as_mut()).poll_shutdown(cx),
        }
    }
}

#[async_trait]
impl UnsubscribePoster for HttpsPoster {
    async fn post_one_click(&self, raw_url: &str) -> UnsubscribeOutcome {
        let Ok(url) = Url::parse(raw_url) else {
            return UnsubscribeOutcome::Failed("the unsubscribe target is not a valid HTTPS URL");
        };
        if !is_allowed_https_url(&url) {
            return UnsubscribeOutcome::Failed("the unsubscribe target URL is not allowed");
        }
        let Some(plan) = ConnectPlan::from_url(&url) else {
            return UnsubscribeOutcome::Failed("the unsubscribe target has no host");
        };
        let request_target = request_target_of(&url);

        // Construct and validate the HTTP request before opening any socket.
        let Ok(request) = hyper::Request::post(request_target)
            .header(hyper::header::HOST, plan.host_header())
            .header(
                hyper::header::CONTENT_TYPE,
                "application/x-www-form-urlencoded",
            )
            .header(hyper::header::CONTENT_LENGTH, ONE_CLICK_BODY.len())
            .header(
                hyper::header::USER_AGENT,
                format!("loam-mail/{}", env!("CARGO_PKG_VERSION")),
            )
            .header(hyper::header::CONNECTION, "close")
            .body(Full::new(Bytes::from_static(ONE_CLICK_BODY)))
        else {
            return UnsubscribeOutcome::Failed("the unsubscribe request could not be constructed");
        };

        let deadline = tokio::time::Instant::now() + CONNECT_TIMEOUT;
        let stream = if let Some(addr) = self.test_endpoint {
            if !addr.ip().is_loopback() {
                return UnsubscribeOutcome::Failed(
                    "plain HTTP unsubscribe is allowed only on a loopback test endpoint",
                );
            }
            match tokio::time::timeout_at(deadline, TcpStream::connect(addr)).await {
                Ok(Ok(tcp)) => HttpStream::Plain(tcp),
                _ => {
                    return UnsubscribeOutcome::Failed(
                        "the unsubscribe server could not be reached",
                    );
                }
            }
        } else {
            let (tcp, tls_name) = match plan {
                ConnectPlan::Direct { addr, tls_name, .. } => {
                    if !is_global_ip(addr.ip()) {
                        return UnsubscribeOutcome::Failed(
                            "the unsubscribe server is a private or local address, which is refused",
                        );
                    }
                    let Ok(Ok(tcp)) =
                        tokio::time::timeout_at(deadline, TcpStream::connect(addr)).await
                    else {
                        return UnsubscribeOutcome::Failed(
                            "the unsubscribe server could not be reached",
                        );
                    };
                    (tcp, tls_name)
                }
                ConnectPlan::Resolve { domain, port, .. } => {
                    let resolved: Vec<SocketAddr> = match tokio::time::timeout_at(
                        deadline,
                        tokio::net::lookup_host((domain.as_str(), port)),
                    )
                    .await
                    {
                        Ok(Ok(addrs)) => addrs.collect(),
                        _ => {
                            return UnsubscribeOutcome::Failed(
                                "the unsubscribe server's host could not be resolved",
                            );
                        }
                    };
                    if resolved.is_empty() {
                        return UnsubscribeOutcome::Failed(
                            "the unsubscribe server's host could not be resolved",
                        );
                    }
                    if !resolved.iter().all(|addr| is_global_ip(addr.ip())) {
                        return UnsubscribeOutcome::Failed(
                            "the unsubscribe server resolved to a private or local address, which is refused",
                        );
                    }
                    let mut connected = None;
                    for addr in resolved.into_iter().take(MAX_CONNECT_ADDRS) {
                        if let Ok(Ok(tcp)) =
                            tokio::time::timeout_at(deadline, TcpStream::connect(addr)).await
                        {
                            connected = Some(tcp);
                            break;
                        }
                    }
                    let Some(tcp) = connected else {
                        return UnsubscribeOutcome::Failed(
                            "the unsubscribe server could not be reached",
                        );
                    };
                    (tcp, domain)
                }
            };
            match tokio::time::timeout_at(deadline, tls(&tls_name, tcp)).await {
                Ok(Ok(tls_stream)) => HttpStream::Tls(Box::new(tls_stream)),
                _ => {
                    return UnsubscribeOutcome::Failed(
                        "TLS with the unsubscribe server could not be established",
                    );
                }
            }
        };

        let wrote_any = Arc::new(AtomicBool::new(false));
        let tracked = TrackingStream {
            inner: stream,
            wrote_any: Arc::clone(&wrote_any),
        };
        let Ok((mut sender, connection)) =
            hyper::client::conn::http1::handshake(TokioIo::new(tracked)).await
        else {
            return UnsubscribeOutcome::Failed(
                "the connection to the unsubscribe server failed before sending",
            );
        };
        let _conn_guard = AbortOnDrop(tokio::spawn(connection));

        let response =
            tokio::time::timeout(self.request_timeout, sender.send_request(request)).await;

        match response {
            Ok(Ok(resp)) => {
                let status = resp.status().as_u16();
                // Drain bounded body politely and discard it; never echo server bytes.
                let _ = tokio::time::timeout(
                    Duration::from_secs(5),
                    Limited::new(resp.into_body(), MAX_RESPONSE_BODY).collect(),
                )
                .await;
                match status {
                    200..=299 => UnsubscribeOutcome::Accepted { status },
                    300..=399 => UnsubscribeOutcome::RedirectRefused { status },
                    429 => UnsubscribeOutcome::RateLimited { status },
                    400..=499 => UnsubscribeOutcome::Refused { status },
                    500..=599 => UnsubscribeOutcome::ServerError { status },
                    _ => UnsubscribeOutcome::Unknown(
                        "the unsubscribe server gave an unexpected status code",
                    ),
                }
            }
            Ok(Err(_)) => {
                if wrote_any.load(Ordering::Acquire) {
                    UnsubscribeOutcome::Unknown(
                        "the connection ended after the unsubscribe request was sent; whether it took effect is not known",
                    )
                } else {
                    UnsubscribeOutcome::Failed("the connection to the unsubscribe server failed")
                }
            }
            Err(_) => {
                if wrote_any.load(Ordering::Acquire) {
                    UnsubscribeOutcome::Unknown(
                        "the unsubscribe server timed out after the request was sent; whether it took effect is not known",
                    )
                } else {
                    UnsubscribeOutcome::Failed("the unsubscribe server timed out before sending")
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_global_ips_and_allows_public_ones() {
        for blocked in [
            "127.0.0.1",
            "0.0.0.0",
            "10.0.0.1",
            "172.16.0.1",
            "192.168.1.1",
            "169.254.169.254",
            "100.64.0.1",
            "198.18.0.1",
            "224.0.0.1",
            "240.0.0.1",
            "255.255.255.255",
            "::1",
            "::",
            "fc00::1",
            "fd12:3456::1",
            "fe80::1",
            "ff02::1",
            "2001:db8::1",
            "2002:7f00:0001::1",
            "2001:0000::1",
            "2001:0002::1",
            "2001:0010::1",
            "2001:0020::1",
            "3fff::1",
            "::ffff:127.0.0.1",
            "::ffff:169.254.169.254",
            "::ffff:10.0.0.5",
        ] {
            let ip: IpAddr = blocked
                .parse()
                .unwrap_or_else(|_| panic!("bad ip {blocked}"));
            assert!(!is_global_ip(ip), "{blocked} must be blocked");
        }
        for allowed in ["93.184.216.34", "1.1.1.1", "2606:2800:220:1::1"] {
            let ip: IpAddr = allowed
                .parse()
                .unwrap_or_else(|_| panic!("bad ip {allowed}"));
            assert!(is_global_ip(ip), "{allowed} must be allowed");
        }
    }

    #[test]
    fn validates_https_urls_strictly() {
        for ok in [
            "https://lists.example.com/u/41",
            "https://lists.example.com:8443/unsub?token=abc",
            "https://93.184.216.34/unsub",
            "https://[2606:2800:220:1::1]/unsub",
        ] {
            let url = Url::parse(ok).unwrap_or_else(|_| panic!("bad url {ok}"));
            assert!(is_allowed_https_url(&url), "{ok} should be allowed");
        }
        for bad in [
            "http://lists.example.com/u/41",
            "https://lists.example.com:0/u/41",
            "https://lists.example.com/u?x={bad}",
            "https://lists.example.com/u?x=a|b",
            "https://user:pass@lists.example.com/u/41",
            "https://user@lists.example.com/u/41",
            "https://localhost/u/41",
            "https://sub.localhost/u/41",
            "https://printer.local/u/41",
            "https://intranet/u/41",
            "https://127.0.0.1/u/41",
            "https://169.254.169.254/latest/meta-data",
            "https://[::1]/u/41",
            "https://[fe80::1]/u/41",
            "https://[2002:7f00:1::1]/u/41",
            "mailto:unsub@lists.example.com",
        ] {
            let url = Url::parse(bad).unwrap_or_else(|_| panic!("bad url {bad}"));
            assert!(!is_allowed_https_url(&url), "{bad} must be refused");
        }
    }

    #[test]
    fn connect_plan_handles_ipv6_literals_unbracketed_for_tls_and_bracketed_for_host() {
        let url = Url::parse("https://[2606:2800:220:1::1]:8443/u/41")
            .unwrap_or_else(|_| panic!("valid ipv6 url"));
        let plan = ConnectPlan::from_url(&url).unwrap_or_else(|| panic!("plan"));
        match plan {
            ConnectPlan::Direct {
                addr,
                tls_name,
                host_header,
            } => {
                assert_eq!(addr.port(), 8443);
                assert_eq!(tls_name, "2606:2800:220:1::1");
                assert_eq!(host_header, "[2606:2800:220:1::1]:8443");
                // Confirm rustls ServerName accepts the unbracketed IPv6 literal.
                assert!(rustls::pki_types::ServerName::try_from(tls_name).is_ok());
            }
            ConnectPlan::Resolve { .. } => panic!("IPv6 literal must use Direct plan"),
        }
    }
}

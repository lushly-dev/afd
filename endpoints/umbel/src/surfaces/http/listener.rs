//! The HTTP listener: accepts connections, terminates TLS when configured (layer 1 of phase 5
//! section 6.3), and serves HTTP/1.1 on each with the router.
//!
//! It is `axum::serve` with two additions, which is why it is not `axum::serve`: every request
//! gets the connection's peer address ([`PeerAddr`]), which the per-IP limit keys on, and, when
//! the client presented a certificate in the TLS handshake, AFD's [`ClientCertificate`] made from
//! it, which the token verifier binds tokens to (RFC 8705). Both come from the connection alone;
//! the request's headers never stand in for either.
//!
//! **Trusted proxies** (`http.trusted_proxies`, amendment from phase 5 step 3). A connection whose
//! peer is a listed address must open with a PROXY protocol version 2 header (a `PROXY` command
//! over TCP on IPv4 or IPv6), read before TLS and before HTTP; its source address becomes the
//! connection's [`PeerAddr`]. A listed peer's connection without a valid header, with a `LOCAL`
//! command, another family or transport, or a header longer than [`MAX_PROXY_HEADER_BYTES`], is
//! closed. No other peer's header is read (to it, a PROXY header is bytes TLS or HTTP refuses),
//! and no forwarded header ever is.
//!
//! [`ClientCertificate`]: afd::server::auth::ClientCertificate

use std::convert::Infallible;
use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use axum::body::Body;
use hyper::body::Incoming;
use hyper_util::rt::{TokioIo, TokioTimer};
use hyper_util::server::graceful::GracefulShutdown;
use tokio::io::AsyncReadExt;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Semaphore;
use tower::ServiceExt;

use super::layers::PeerAddr;

/// How long a client has to finish the TLS handshake.
#[cfg(feature = "auth")]
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
/// How long a client has to send a request's headers once it starts one.
const HEADER_TIMEOUT: Duration = Duration::from_secs(30);
/// How long to wait before accepting again after an error that is not the connection's own
/// (too many open files, for example).
const ACCEPT_BACKOFF: Duration = Duration::from_millis(50);
/// The most connections served at once, TLS handshakes included; past it the listener stops
/// accepting until one closes, so the operating system's backlog holds the rest.
pub(crate) const MAX_CONNECTIONS: usize = 1024;
/// How long requests in flight get to finish once shutdown begins, before their connections are
/// dropped.
pub(crate) const SHUTDOWN_GRACE: Duration = Duration::from_secs(10);
/// How long a trusted proxy has to send its PROXY protocol header.
const PROXY_HEADER_TIMEOUT: Duration = Duration::from_secs(10);
/// The PROXY protocol version 2 signature.
pub(crate) const PROXY_V2_SIGNATURE: [u8; 12] = [
    0x0D, 0x0A, 0x0D, 0x0A, 0x00, 0x0D, 0x0A, 0x51, 0x55, 0x49, 0x54, 0x0A,
];
/// The longest PROXY protocol header read: its 16 fixed bytes and the addresses with any TLVs.
/// A longer one is refused rather than buffered.
pub(crate) const MAX_PROXY_HEADER_BYTES: usize = 4096;

/// Read a PROXY protocol version 2 header from `stream`, exactly its bytes and no more, and
/// return the source address it supplies: only a `PROXY` command over TCP on IPv4 (`0x11`) or
/// IPv6 (`0x21`), with a source that is not unspecified, multicast or the IPv4 broadcast
/// address. TLVs are skipped unread. Anything else is refused with the reason, for the log.
pub(crate) async fn read_proxy_v2<R>(stream: &mut R) -> Result<std::net::SocketAddr, &'static str>
where
    R: tokio::io::AsyncRead + Unpin,
{
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
    let mut fixed = [0u8; 16];
    stream
        .read_exact(&mut fixed)
        .await
        .map_err(|_| "the connection closed before a PROXY protocol header")?;
    if fixed[..12] != PROXY_V2_SIGNATURE {
        return Err("the connection did not open with a PROXY protocol version 2 header");
    }
    if fixed[12] >> 4 != 0x2 {
        return Err("the PROXY protocol header is not version 2");
    }
    if fixed[12] & 0x0F != 0x1 {
        return Err("the PROXY protocol header is not a PROXY command (LOCAL names no client)");
    }
    let length = usize::from(u16::from_be_bytes([fixed[14], fixed[15]]));
    let addresses = match fixed[13] {
        0x11 => 12,
        0x21 => 36,
        _ => return Err("the PROXY protocol header is not TCP over IPv4 or IPv6"),
    };
    if length < addresses || 16 + length > MAX_PROXY_HEADER_BYTES {
        return Err("the PROXY protocol header's length is not one this listener reads");
    }
    let mut rest = vec![0u8; length];
    stream
        .read_exact(&mut rest)
        .await
        .map_err(|_| "the connection closed inside its PROXY protocol header")?;
    let source = if addresses == 12 {
        let ip = Ipv4Addr::new(rest[0], rest[1], rest[2], rest[3]);
        SocketAddr::new(IpAddr::V4(ip), u16::from_be_bytes([rest[8], rest[9]]))
    } else {
        let mut octets = [0u8; 16];
        octets.copy_from_slice(&rest[..16]);
        SocketAddr::new(
            IpAddr::V6(Ipv6Addr::from(octets)),
            u16::from_be_bytes([rest[32], rest[33]]),
        )
    };
    let broadcast = source.ip() == IpAddr::V4(Ipv4Addr::BROADCAST);
    if source.ip().is_unspecified() || source.ip().is_multicast() || broadcast {
        return Err("the PROXY protocol header names no client address");
    }
    Ok(source)
}

/// The TLS acceptor, or nothing for plain HTTP.
#[cfg(feature = "auth")]
pub(crate) type Tls = Option<tokio_rustls::TlsAcceptor>;
#[cfg(not(feature = "auth"))]
pub(crate) type Tls = Option<Infallible>;

/// Serve `listener` until `shutdown` completes, then give every connection [`SHUTDOWN_GRACE`] to
/// finish its requests in flight. At most [`MAX_CONNECTIONS`] are served at once.
pub(crate) async fn serve(
    listener: TcpListener,
    router: Router,
    tls: Tls,
    proxies: Arc<[std::net::IpAddr]>,
    shutdown: impl Future<Output = ()> + Send + 'static,
) {
    let graceful = GracefulShutdown::new();
    let slots = Arc::new(Semaphore::new(MAX_CONNECTIONS));
    tokio::pin!(shutdown);
    loop {
        let slot = tokio::select! {
            slot = Arc::clone(&slots).acquire_owned() => match slot {
                Ok(slot) => slot,
                Err(_) => break,
            },
            () = &mut shutdown => break,
        };
        let (stream, peer) = tokio::select! {
            accepted = listener.accept() => match accepted {
                Ok(pair) => pair,
                Err(error) => {
                    if !is_connection_error(&error) {
                        tracing::warn!(target: "umbel::http", %error, "accepting a connection failed");
                        tokio::time::sleep(ACCEPT_BACKOFF).await;
                    }
                    continue;
                }
            },
            () = &mut shutdown => break,
        };
        let router = router.clone();
        #[allow(clippy::clone_on_copy)] // `Option<Infallible>` without the `auth` feature.
        let tls = tls.clone();
        let watcher = graceful.watcher();
        let proxies = Arc::clone(&proxies);
        tokio::spawn(async move {
            let _ = stream.set_nodelay(true);
            connection(stream, peer, router, tls, &proxies, watcher).await;
            drop(slot);
        });
    }
    drop(listener);
    if tokio::time::timeout(SHUTDOWN_GRACE, graceful.shutdown())
        .await
        .is_err()
    {
        tracing::warn!(target: "umbel::http", "requests still in flight after the shutdown grace were dropped");
    }
}

/// Errors of one connection that never reached us, after which accepting goes on at once.
fn is_connection_error(error: &std::io::Error) -> bool {
    use std::io::ErrorKind;
    matches!(
        error.kind(),
        ErrorKind::ConnectionRefused | ErrorKind::ConnectionAborted | ErrorKind::ConnectionReset
    )
}

/// One accepted connection: from a trusted proxy, its PROXY protocol header; then the TLS
/// handshake when configured; then HTTP/1.1.
async fn connection(
    mut stream: TcpStream,
    peer: std::net::SocketAddr,
    router: Router,
    tls: Tls,
    proxies: &[std::net::IpAddr],
    watcher: hyper_util::server::graceful::Watcher,
) {
    let peer = if proxies.contains(&peer.ip().to_canonical()) {
        match tokio::time::timeout(PROXY_HEADER_TIMEOUT, read_proxy_v2(&mut stream)).await {
            Ok(Ok(client)) => client,
            Ok(Err(reason)) => {
                tracing::debug!(target: "umbel::http", %peer, reason, "a trusted proxy's connection was refused");
                return;
            }
            Err(_) => {
                tracing::debug!(target: "umbel::http", %peer, "a trusted proxy sent no PROXY protocol header in time");
                return;
            }
        }
    } else {
        peer
    };
    #[cfg(feature = "auth")]
    if let Some(acceptor) = tls {
        let stream = match tokio::time::timeout(HANDSHAKE_TIMEOUT, acceptor.accept(stream)).await {
            Ok(Ok(stream)) => stream,
            Ok(Err(error)) => {
                tracing::debug!(target: "umbel::http", %peer, %error, "a TLS handshake failed");
                return;
            }
            Err(_) => {
                tracing::debug!(target: "umbel::http", %peer, "a TLS handshake timed out");
                return;
            }
        };
        // The end-entity certificate the client proved it holds in this handshake, if any:
        // rustls verified it per `client_auth` before the handshake completed.
        let certificate = stream
            .get_ref()
            .1
            .peer_certificates()
            .and_then(|chain| chain.first())
            .map(|der| afd::server::auth::ClientCertificate::from_der(der));
        http(TokioIo::new(stream), peer, router, certificate, watcher).await;
        return;
    }
    #[cfg(not(feature = "auth"))]
    if let Some(never) = tls {
        match never {}
    }
    http(TokioIo::new(stream), peer, router, None, watcher).await;
}

#[cfg(feature = "auth")]
type Certificate = Option<afd::server::auth::ClientCertificate>;
#[cfg(not(feature = "auth"))]
type Certificate = Option<Infallible>;

/// HTTP/1.1 on one connection, each request carrying the connection's peer and certificate.
async fn http<I>(
    io: I,
    peer: std::net::SocketAddr,
    router: Router,
    certificate: Certificate,
    watcher: hyper_util::server::graceful::Watcher,
) where
    I: hyper::rt::Read + hyper::rt::Write + Unpin + Send + 'static,
{
    let service = hyper::service::service_fn(move |mut request: hyper::Request<Incoming>| {
        let router = router.clone();
        let extensions = request.extensions_mut();
        extensions.insert(PeerAddr(peer));
        #[cfg(feature = "auth")]
        if let Some(certificate) = &certificate {
            extensions.insert(certificate.clone());
        }
        #[cfg(not(feature = "auth"))]
        let _ = &certificate;
        async move {
            match router.oneshot(request.map(Body::new)).await {
                Ok(response) => Ok::<_, Infallible>(response),
                Err(never) => match never {},
            }
        }
    });
    let connection = hyper::server::conn::http1::Builder::new()
        .timer(TokioTimer::new())
        .header_read_timeout(HEADER_TIMEOUT)
        .serve_connection(io, service);
    if let Err(error) = watcher.watch(connection).await {
        tracing::debug!(target: "umbel::http", %peer, %error, "an HTTP connection ended with an error");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn header(command: u8, family: u8, addresses: &[u8], tlv: &[u8]) -> Vec<u8> {
        let mut bytes = PROXY_V2_SIGNATURE.to_vec();
        bytes.push(0x20 | command);
        bytes.push(family);
        let length = u16::try_from(addresses.len() + tlv.len()).unwrap();
        bytes.extend_from_slice(&length.to_be_bytes());
        bytes.extend_from_slice(addresses);
        bytes.extend_from_slice(tlv);
        bytes
    }

    fn v4(source: [u8; 4], port: u16) -> Vec<u8> {
        let mut addresses = source.to_vec();
        addresses.extend_from_slice(&[127, 0, 0, 1]);
        addresses.extend_from_slice(&port.to_be_bytes());
        addresses.extend_from_slice(&443u16.to_be_bytes());
        addresses
    }

    async fn parse(bytes: &[u8]) -> (Result<std::net::SocketAddr, &'static str>, Vec<u8>) {
        let mut cursor = std::io::Cursor::new(bytes.to_vec());
        let read = read_proxy_v2(&mut cursor).await;
        let at = usize::try_from(cursor.position()).unwrap();
        (read, bytes[at..].to_vec())
    }

    #[tokio::test]
    async fn a_proxy_v2_header_supplies_the_client_and_nothing_after_it_is_read() {
        let mut bytes = header(
            0x1,
            0x11,
            &v4([192, 0, 2, 7], 50_000),
            &[0x04, 0x00, 0x01, 0xFF],
        );
        bytes.extend_from_slice(b"GET / HTTP/1.1\r\n");
        let (read, left) = parse(&bytes).await;
        assert_eq!(read.unwrap(), "192.0.2.7:50000".parse().unwrap());
        assert_eq!(left, b"GET / HTTP/1.1\r\n");
        let mut six = [0u8; 36];
        six[..16].copy_from_slice(
            &"2001:db8::7"
                .parse::<std::net::Ipv6Addr>()
                .unwrap()
                .octets(),
        );
        six[32..34].copy_from_slice(&443u16.to_be_bytes());
        let (read, _) = parse(&header(0x1, 0x21, &six, &[])).await;
        assert_eq!(read.unwrap(), "[2001:db8::7]:443".parse().unwrap());
    }

    #[tokio::test]
    async fn anything_but_a_proxy_command_over_tcp_naming_a_client_is_refused() {
        let addresses = v4([192, 0, 2, 7], 1);
        for (bytes, why) in [
            (b"GET / HTTP/1.1\r\nHost: x\r\n\r\n".to_vec(), "no header"),
            (
                b"PROXY TCP4 192.0.2.7 127.0.0.1 1 2\r\n".to_vec(),
                "version 1",
            ),
            (header(0x0, 0x11, &addresses, &[]), "LOCAL"),
            (header(0x1, 0x12, &addresses, &[]), "UDP"),
            (header(0x1, 0x31, &[0; 216], &[]), "UNIX"),
            (header(0x1, 0x00, &[], &[]), "UNSPEC"),
            (header(0x1, 0x11, &addresses[..8], &[]), "short addresses"),
            (
                header(0x1, 0x11, &v4([0, 0, 0, 0], 1), &[]),
                "unspecified source",
            ),
            (
                header(0x1, 0x11, &v4([224, 0, 0, 1], 1), &[]),
                "multicast source",
            ),
            (
                header(0x1, 0x11, &v4([255, 255, 255, 255], 1), &[]),
                "broadcast source",
            ),
            (
                header(0x1, 0x11, &addresses, &vec![0u8; MAX_PROXY_HEADER_BYTES]),
                "too long",
            ),
            (
                header(0x1, 0x11, &addresses, &[])[..20].to_vec(),
                "truncated",
            ),
        ] {
            let (read, _) = parse(&bytes).await;
            assert!(read.is_err(), "{why}");
        }
        // Version 3 is not version 2.
        let mut three = header(0x1, 0x11, &addresses, &[]);
        three[12] = 0x31;
        assert!(parse(&three).await.0.is_err());
    }
}

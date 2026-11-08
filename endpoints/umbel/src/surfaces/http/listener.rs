//! The HTTP listener: accepts connections, terminates TLS when configured (layer 1 of phase 5
//! section 6.3), and serves HTTP/1.1 on each with the router.
//!
//! It is `axum::serve` with two additions, which is why it is not `axum::serve`: every request
//! gets the connection's peer address ([`PeerAddr`]), which the per-IP limit keys on, and, when
//! the client presented a certificate in the TLS handshake, AFD's [`ClientCertificate`] made from
//! it, which the token verifier binds tokens to (RFC 8705). Both come from the connection alone;
//! the request's headers never stand in for either.
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
        tokio::spawn(async move {
            let _ = stream.set_nodelay(true);
            connection(stream, peer, router, tls, watcher).await;
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

/// One accepted connection: the TLS handshake when configured, then HTTP/1.1.
async fn connection(
    stream: TcpStream,
    peer: std::net::SocketAddr,
    router: Router,
    tls: Tls,
    watcher: hyper_util::server::graceful::Watcher,
) {
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

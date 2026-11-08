//! `umbel-testkit-idp`: a credential-free identity provider, authorization server, gateway signer
//! and certificate authority for Umbel's auth tests (phase 5 specification, sections 1 and 14,
//! step 1b).
//!
//! **Test-only.** Use it from `[dev-dependencies]` only; Umbel is never an authorization server
//! (A7, D107), and the host's `tests/no_auth_server.rs` fails if this crate is reachable from a
//! shipped crate. [`TestIdp::start`] binds `127.0.0.1` on ephemeral ports (never another
//! address), generates every key and certificate in memory, and writes nothing to disk; dropping
//! the [`TestIdp`] stops it.
//!
//! One HTTPS listener plays three roles, with its own [`TestCa`]:
//!
//! - [`IdentityProvider`] (`https://127.0.0.1:<port>/idp`): an OpenID Connect provider with
//!   discovery at the path-inserted and appended well-known URLs, a JWKS, an authorization endpoint
//!   with a scripted login ([`LoginScript`]) or a password form for the synthetic users `ada`, `bo`
//!   and `cy`, and a token endpoint that redeems codes with PKCE `S256` for ID tokens carrying the
//!   `nonce`, `auth_time`, `acr`, `amr` and `groups`, and runs the RFC 8693 token exchange that
//!   issues an ID-JAG (draft-ietf-oauth-identity-assertion-authz-grant).
//! - [`AuthorizationServer`] (`https://127.0.0.1:<port>/as`): RFC 8414 metadata, a JWKS, the
//!   authorization code grant with PKCE, client credentials, the RFC 7523 JWT bearer grant that
//!   redeems an ID-JAG, RFC 9068 access tokens for one audience (RFC 8707), certificate-bound when
//!   the client is (RFC 8705), and RFC 7662 introspection with client authentication.
//! - [`GatewaySigner`]: the per-request `Umbel-Gateway-Assertion` of the gateway-trusted mode
//!   (section 4.4), with its pinned key set and a client certificate.
//!
//! Every token comes from a [`TokenBuilder`], whose [`Break`]s each break exactly one rule of
//! section 3.2; [`Break::rule`] names the rule code AFD's `JwtVerifier` refuses it with. Every
//! endpoint can be made to misbehave with a [`Fault`] (a status, a redirect that must not be
//! followed, a delay, an oversized or a malformed body), and the metadata and key set can be
//! patched, rotated and overridden.

mod ca;
mod gateway;
mod http;
mod keys;
mod role;
mod token;

use std::fmt;
use std::net::{Ipv4Addr, SocketAddr};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;

pub use ca::{IssuedCertificate, TestCa};
pub use gateway::GatewaySigner;
pub use keys::{Algorithm, KeyKind, KeySet};
pub use role::{
    AuthorizationServer, Client, Endpoint, Fault, IdentityProvider, Issuer, LoginScript,
    MetadataUrls, ResponseIss, ScriptedLogin, User,
};
pub use token::{Break, IntrospectionAnswer, RequiredClaim, TokenBuilder, TokenKind};

/// The `typ` of an RFC 9068 access token.
pub const ACCESS_TOKEN_TYP: &str = "at+jwt";
/// The `typ` of an ID-JAG (draft-ietf-oauth-identity-assertion-authz-grant, section 3.1).
pub const ID_JAG_TYP: &str = "oauth-id-jag+jwt";
/// The `typ` of a gateway assertion (phase 5 specification, section 4.4).
pub const GATEWAY_ASSERTION_TYP: &str = "umbel-gw+jwt";
/// The RFC 8693 grant type.
pub const TOKEN_EXCHANGE_GRANT: &str = "urn:ietf:params:oauth:grant-type:token-exchange";
/// The RFC 7523 grant type.
pub const JWT_BEARER_GRANT: &str = "urn:ietf:params:oauth:grant-type:jwt-bearer";
/// The token type of an ID-JAG in a token exchange.
pub const ID_JAG_TOKEN_TYPE: &str = "urn:ietf:params:oauth:token-type:id-jag";
/// The token type of an ID token in a token exchange (RFC 8693, section 3).
pub const ID_TOKEN_TOKEN_TYPE: &str = "urn:ietf:params:oauth:token-type:id_token";

/// Why the kit could not start, or could not make a key or certificate.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Error(String);

impl Error {
    pub(crate) fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "umbel-testkit-idp: {}", self.0)
    }
}

impl std::error::Error for Error {}

/// A running test identity provider, authorization server and gateway signer on `127.0.0.1`.
/// Dropping it stops the listener and every open connection.
pub struct TestIdp {
    address: SocketAddr,
    base_url: String,
    ca: TestCa,
    server_certificate: IssuedCertificate,
    identity_provider: IdentityProvider,
    authorization_server: AuthorizationServer,
    gateway: GatewaySigner,
    plain_base_url: String,
    stop: Option<tokio::sync::oneshot::Sender<()>>,
}

impl fmt::Debug for TestIdp {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("TestIdp")
            .field("base_url", &self.base_url)
            .finish_non_exhaustive()
    }
}

impl TestIdp {
    /// Start on `127.0.0.1` at ephemeral ports with a new test CA, a server certificate for
    /// `127.0.0.1` and `localhost`, fresh keys of every [`KeyKind`] for each role, and the synthetic
    /// users `ada`, `bo` and `cy` at both the identity provider and the authorization server
    /// ([`User::synthetic`]). No client is registered.
    ///
    /// The kit serves from a thread and Tokio runtime of its own, so a test that blocks its own
    /// runtime (a synchronous child process fetching the kit's metadata, a current-thread
    /// `#[tokio::test]`) cannot stall it.
    ///
    /// # Errors
    /// A port cannot be bound, a key or certificate cannot be made, or the thread cannot start.
    pub async fn start() -> Result<Self, Error> {
        let bind = || {
            let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
                .map_err(|error| Error::new(format!("cannot bind 127.0.0.1: {error}")))?;
            let address = listener
                .local_addr()
                .map_err(|error| Error::new(format!("cannot read the bound address: {error}")))?;
            if !address.ip().is_loopback() {
                return Err(Error::new("the listener is not on a loopback address"));
            }
            listener
                .set_nonblocking(true)
                .map_err(|error| Error::new(format!("cannot configure the listener: {error}")))?;
            Ok((listener, address))
        };
        let (listener, address) = bind()?;
        let (plain_listener, plain_address) = bind()?;
        let base_url = format!("https://{address}");
        let plain_base_url = format!("http://{plain_address}");
        let ca = TestCa::new()?;
        let server_certificate = ca.server_certificate(&["127.0.0.1", "localhost"])?;
        let idp_keys = Arc::new(KeySet::generate("idp")?);
        let as_keys = Arc::new(KeySet::generate("as")?);
        let idp_issuer = format!("{base_url}/idp");
        let as_issuer = format!("{base_url}/as");
        let idp = role::Role::new(
            role::RoleKind::IdentityProvider,
            (&base_url, &plain_base_url),
            "/idp",
            Arc::clone(&idp_keys),
            role::Partner {
                issuer: as_issuer.clone(),
                keys: Arc::clone(&as_keys),
            },
        );
        let authorization = role::Role::new(
            role::RoleKind::AuthorizationServer,
            (&base_url, &plain_base_url),
            "/as",
            as_keys,
            role::Partner {
                issuer: idp_issuer,
                keys: idp_keys,
            },
        );
        for name in ["ada", "bo", "cy"] {
            idp.add_user(User::synthetic(name));
            authorization.add_user(User::synthetic(name));
        }
        let gateway = GatewaySigner::new(
            format!("{base_url}/gateway"),
            Arc::new(KeySet::generate("gateway")?),
            ca.client_certificate("umbel-testkit-idp gateway")?,
        );
        let tls = http::server_config(&ca, &server_certificate)?;
        let roles = [Arc::clone(&idp), Arc::clone(&authorization)];
        let router = http::router(&roles);
        let plain_router = http::plain_router(&roles);
        let (stop, stopped) = tokio::sync::oneshot::channel::<()>();
        let (ready, started) = tokio::sync::oneshot::channel::<Result<(), Error>>();
        std::thread::Builder::new()
            .name("umbel-testkit-idp".to_owned())
            .spawn(move || {
                let runtime = match tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                {
                    Ok(runtime) => runtime,
                    Err(error) => {
                        let _ = ready.send(Err(Error::new(format!("no runtime: {error}"))));
                        return;
                    }
                };
                runtime.block_on(async move {
                    let (Ok(listener), Ok(plain_listener)) = (
                        tokio::net::TcpListener::from_std(listener),
                        tokio::net::TcpListener::from_std(plain_listener),
                    ) else {
                        let _ = ready.send(Err(Error::new("cannot adopt the listeners")));
                        return;
                    };
                    let _ = ready.send(Ok(()));
                    tokio::select! {
                        () = http::serve(listener, Some(tls), router) => {}
                        () = http::serve(plain_listener, None, plain_router) => {}
                        _ = stopped => {}
                    }
                });
            })
            .map_err(|error| Error::new(format!("cannot start the kit's thread: {error}")))?;
        // Return only once the kit serves, or with the reason it cannot.
        started
            .await
            .map_err(|_| Error::new("the kit's thread stopped before serving"))??;
        Ok(Self {
            address,
            base_url,
            ca,
            server_certificate,
            identity_provider: IdentityProvider(Issuer::new(idp)),
            authorization_server: AuthorizationServer(Issuer::new(authorization)),
            gateway,
            plain_base_url,
            stop: Some(stop),
        })
    }

    /// `http://127.0.0.1:<port>`: a second, plain-HTTP listener that serves only the roles'
    /// metadata and JWKS at the same paths ([`Issuer::plain_url`]) and counts its requests
    /// ([`Issuer::plain_hits`]), so a test proves a client refused an `http` URL rather than
    /// failing to reach it.
    pub fn plain_base_url(&self) -> &str {
        &self.plain_base_url
    }

    /// The listener's address, always on `127.0.0.1`.
    pub fn address(&self) -> SocketAddr {
        self.address
    }

    /// `https://127.0.0.1:<port>`.
    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    /// The test CA: it issued the listener's certificate, and issues server and client
    /// certificates for the tests (mTLS, `x5t#S256`).
    pub fn ca(&self) -> &TestCa {
        &self.ca
    }

    /// The listener's own certificate (for `127.0.0.1` and `localhost`).
    pub fn server_certificate(&self) -> &IssuedCertificate {
        &self.server_certificate
    }

    /// The identity provider (`<base>/idp`).
    pub fn identity_provider(&self) -> &IdentityProvider {
        &self.identity_provider
    }

    /// The resource authorization server (`<base>/as`).
    pub fn authorization_server(&self) -> &AuthorizationServer {
        &self.authorization_server
    }

    /// The gateway signer (issuer `<base>/gateway`; it serves nothing).
    pub fn gateway(&self) -> &GatewaySigner {
        &self.gateway
    }
}

impl Drop for TestIdp {
    fn drop(&mut self) {
        // Ending `block_on` drops the runtime, which aborts every connection.
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
    }
}

/// A PKCE pair (RFC 7636) with the `S256` method: a verifier of 43 characters from 32 random
/// bytes, and its challenge.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pkce {
    /// The `code_verifier`.
    pub verifier: String,
    /// The `code_challenge`: unpadded base64url of the verifier's SHA-256.
    pub challenge: String,
}

impl Pkce {
    /// A new random pair.
    pub fn new() -> Self {
        let verifier = random_token(32);
        let challenge = Self::challenge_of(&verifier);
        Self {
            verifier,
            challenge,
        }
    }

    /// The `S256` challenge of `verifier`.
    pub fn challenge_of(verifier: &str) -> String {
        b64(sha256(verifier.as_bytes()))
    }
}

impl Default for Pkce {
    fn default() -> Self {
        Self::new()
    }
}

/// Seconds since the Unix epoch.
pub(crate) fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| i64::try_from(elapsed.as_secs()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}

/// Unpadded base64url.
pub(crate) fn b64(bytes: impl AsRef<[u8]>) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

/// SHA-256.
pub(crate) fn sha256(bytes: &[u8]) -> Vec<u8> {
    aws_lc_rs::digest::digest(&aws_lc_rs::digest::SHA256, bytes)
        .as_ref()
        .to_vec()
}

/// `count` bytes from the OS random source.
#[allow(
    clippy::expect_used,
    reason = "a test kit with no randomness must stop rather than issue predictable tokens"
)]
pub(crate) fn random_bytes(count: usize) -> Vec<u8> {
    let mut bytes = vec![0u8; count];
    aws_lc_rs::rand::fill(&mut bytes).expect("the OS random source failed");
    bytes
}

/// `count` random bytes as unpadded base64url.
pub(crate) fn random_token(count: usize) -> String {
    b64(random_bytes(count))
}

/// Lock `mutex`, ignoring poisoning: a test that panicked while holding it must not hide the
/// state from the next assertion.
pub(crate) fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

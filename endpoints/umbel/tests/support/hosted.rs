//! The hosted HTTP surface over real sockets (phase 5 step 2a): a host's `http_server` serving on
//! `127.0.0.1:0`, and a client that speaks HTTP/1.1 over TCP or TLS, with or without a client
//! certificate, one connection per request. The workspaces use `umbel-testkit-idp`'s CA for the
//! server certificate and the client certificates, and its authorization server's tokens.

use std::net::SocketAddr;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use afd::server::auth::{
    AuthRefusal, ClientCertificate, Credentials, JwtIssuer, JwtVerifier, SigningAlgorithm,
    StaticKeys, TokenRules, TokenVerifier,
};
use async_trait::async_trait;
use bytes::Bytes;
use http::{HeaderMap, Request};
use http_body_util::{BodyExt, Full};
use serde_json::Value;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_rustls::TlsConnector;
use tokio_rustls::rustls::pki_types::pem::PemObject;
use tokio_rustls::rustls::pki_types::{CertificateDer, PrivateKeyDer, ServerName};
use tokio_rustls::rustls::{self, ClientConfig, RootCertStore, SupportedProtocolVersion};
use umbel::Host;
use umbel_testkit_idp::{IssuedCertificate, TestIdp};

pub use umbel::testkit::mcp::Reply;

/// The public URL every hosted test workspace publishes. Its host is in `allowed_hosts`; the
/// listener's port is whatever the test bound, which an `allowed_hosts` entry without a port
/// admits.
pub const PUBLIC_URL: &str = "https://127.0.0.1/mcp";
/// The two metadata paths of [`PUBLIC_URL`] (RFC 9728 3.1): path-inserted first.
pub const METADATA_PATHS: [&str; 2] = [
    "/.well-known/oauth-protected-resource/mcp",
    "/.well-known/oauth-protected-resource",
];

/// Write the server certificate (for `127.0.0.1`), its key and the kit CA (as `client_ca`) under
/// `<dir>/tls/`.
pub fn write_tls(dir: &Path, kit: &TestIdp) {
    let tls = dir.join("tls");
    std::fs::create_dir_all(&tls).unwrap();
    let server = kit.ca().server_certificate(&["127.0.0.1"]).unwrap();
    std::fs::write(tls.join("cert.pem"), server.certificate_pem()).unwrap();
    std::fs::write(tls.join("key.pem"), server.private_key_pem()).unwrap();
    std::fs::write(tls.join("client-ca.pem"), kit.ca().certificate_pem()).unwrap();
}

/// `[http.tls]` with the files of [`write_tls`] and `client_auth`.
pub fn tls_table(client_auth: &str) -> String {
    let client_ca = if client_auth == "ca" {
        "client_ca = \"tls/client-ca.pem\"\n"
    } else {
        ""
    };
    format!(
        "[http.tls]\ncert = \"tls/cert.pem\"\nkey = \"tls/key.pem\"\nclient_auth = \"{client_auth}\"\n{client_ca}"
    )
}

/// An `auth.mode = "oauth"` configuration: namespace `corp`, the kit's authorization server as
/// issuer `as`, and a login-only issuer `idp` that the metadata must leave out. `http` and `auth`
/// hold extra `[http]` and `[auth]` keys, and `rest` is appended (`[http.tls]`, `[limits]`, ...).
pub fn oauth_config(kit: &TestIdp, http: &str, auth: &str, rest: &str) -> String {
    format!(
        r#"config_version = 5

[principal]
local_id = "corp/ada"

[http]
public_url = "{PUBLIC_URL}"
allowed_hosts = ["127.0.0.1"]
{http}

[auth]
mode = "oauth"
{auth}

[auth.namespaces.corp]
person = {{ issuer = "idp", client_id = "umbel-person-page", client_secret_env = "UMBEL_TEST_PERSON_SECRET", acr_values = ["phr"], uv_amr = ["pin"] }}

[auth.issuers.idp]
issuer = "{idp}"
namespace = "corp"
access_tokens = false

[auth.issuers.as]
issuer = "{issuer}"
namespace = "corp"
algorithms = ["ES256", "RS256"]

{rest}
"#,
        idp = kit.identity_provider().issuer(),
        issuer = kit.authorization_server().issuer(),
    )
}

/// AFD's verifier for the kit's authorization server (alias `as`) with its published keys, tokens
/// for [`PUBLIC_URL`], bound tokens required or not.
pub fn kit_verifier(kit: &TestIdp, bound: bool) -> JwtVerifier {
    let keys = StaticKeys::from_jwks(&kit.authorization_server().keys().published_jwks()).unwrap();
    let issuer = JwtIssuer::new(
        "as",
        kit.authorization_server().issuer(),
        [SigningAlgorithm::ES256, SigningAlgorithm::RS256],
        keys,
    )
    .unwrap();
    let rules = TokenRules::new(PUBLIC_URL)
        .unwrap()
        .with_require_bound_tokens(bound);
    JwtVerifier::new(rules, vec![issuer]).unwrap()
}

/// A valid kit access token for [`PUBLIC_URL`].
pub fn kit_token(kit: &TestIdp) -> String {
    kit.authorization_server()
        .access_token(PUBLIC_URL)
        .subject("ada")
        .scopes(["umbel:read"])
        .sign()
}

/// A verifier that records what each call saw (the TLS client certificate's thumbprint, and
/// whether an `Authorization` header was still on the request) and then asks `inner`.
#[derive(Clone)]
pub struct Recording {
    inner: Arc<dyn TokenVerifier>,
    seen: Arc<Mutex<Vec<Option<String>>>>,
}

impl Recording {
    pub fn new(inner: impl TokenVerifier + 'static) -> Self {
        Self {
            inner: Arc::new(inner),
            seen: Arc::default(),
        }
    }

    /// The certificate thumbprint each verification saw, in order.
    pub fn seen(&self) -> Vec<Option<String>> {
        self.seen.lock().unwrap().clone()
    }

    /// How many tokens were verified.
    pub fn calls(&self) -> usize {
        self.seen.lock().unwrap().len()
    }
}

#[async_trait]
impl TokenVerifier for Recording {
    async fn verify(
        &self,
        token: &str,
        request: &http::request::Parts,
    ) -> Result<Credentials, AuthRefusal> {
        self.seen.lock().unwrap().push(
            request
                .extensions
                .get::<ClientCertificate>()
                .map(|certificate| certificate.thumbprint().to_owned()),
        );
        self.inner.verify(token, request).await
    }

    fn rules(&self) -> Option<&TokenRules> {
        self.inner.rules()
    }
}

/// A host's HTTP surface served on `127.0.0.1:0` until dropped or stopped.
pub struct Served {
    pub address: SocketAddr,
    stop: Option<tokio::sync::oneshot::Sender<()>>,
    task: Option<tokio::task::JoinHandle<()>>,
}

impl Served {
    /// Build `host`'s HTTP surface and serve it.
    pub async fn start(host: &Host) -> Self {
        let server = host.http_server().unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (stop, stopped) = tokio::sync::oneshot::channel::<()>();
        let task = tokio::spawn(async move {
            server
                .serve(listener, async move {
                    let _ = stopped.await;
                })
                .await
                .unwrap();
        });
        Self {
            address,
            stop: Some(stop),
            task: Some(task),
        }
    }

    /// Stop accepting and wait for the server to finish.
    pub async fn stop(mut self) {
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
        if let Some(task) = self.task.take() {
            tokio::time::timeout(Duration::from_secs(15), task)
                .await
                .unwrap()
                .unwrap();
        }
    }
}

impl Drop for Served {
    fn drop(&mut self) {
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
    }
}

/// An HTTP/1.1 client of one server: plain, or TLS trusting one CA, with an optional client
/// certificate. Every request opens its own connection.
#[derive(Clone)]
pub struct Client {
    address: SocketAddr,
    tls: Option<Arc<ClientConfig>>,
    host: String,
}

fn provider() -> Arc<rustls::crypto::CryptoProvider> {
    Arc::new(rustls::crypto::aws_lc_rs::default_provider())
}

/// A certificate and its key, for a client identity.
pub fn identity(
    certificate: &IssuedCertificate,
) -> (CertificateDer<'static>, PrivateKeyDer<'static>) {
    (
        CertificateDer::from(certificate.certificate_der().to_vec()),
        PrivateKeyDer::Pkcs8(certificate.private_key_der().to_vec().into()),
    )
}

impl Client {
    /// Plain HTTP to `address`.
    pub fn plain(address: SocketAddr) -> Self {
        Self {
            address,
            tls: None,
            host: "127.0.0.1".to_owned(),
        }
    }

    /// TLS 1.3 or 1.2 to `address`, trusting `ca_pem`, presenting `certificate` when given.
    pub fn tls(address: SocketAddr, ca_pem: &str, certificate: Option<&IssuedCertificate>) -> Self {
        Self::tls_versions(
            address,
            ca_pem,
            certificate,
            &[&rustls::version::TLS13, &rustls::version::TLS12],
            &[b"http/1.1"],
        )
    }

    /// TLS with only `versions` and the ALPN protocols `alpn`.
    pub fn tls_versions(
        address: SocketAddr,
        ca_pem: &str,
        certificate: Option<&IssuedCertificate>,
        versions: &[&'static SupportedProtocolVersion],
        alpn: &[&[u8]],
    ) -> Self {
        let mut roots = RootCertStore::empty();
        roots
            .add(CertificateDer::from_pem_slice(ca_pem.as_bytes()).unwrap())
            .unwrap();
        let builder = ClientConfig::builder_with_provider(provider())
            .with_protocol_versions(versions)
            .unwrap()
            .with_root_certificates(roots);
        let mut config = match certificate {
            Some(certificate) => {
                let (certificate, key) = identity(certificate);
                builder
                    .with_client_auth_cert(vec![certificate], key)
                    .unwrap()
            }
            None => builder.with_no_client_auth(),
        };
        config.alpn_protocols = alpn.iter().map(|protocol| protocol.to_vec()).collect();
        Self {
            address,
            tls: Some(Arc::new(config)),
            host: "127.0.0.1".to_owned(),
        }
    }

    /// Send `Host: host` instead of `127.0.0.1`.
    pub fn with_host(mut self, host: &str) -> Self {
        self.host = host.to_owned();
        self
    }

    pub fn host(&self) -> &str {
        &self.host
    }

    /// Connect and, with TLS, finish the handshake and wait briefly for the server's verdict.
    /// `Err` with the reason when either fails.
    pub async fn handshake(&self) -> Result<(), String> {
        let stream = self.open().await?;
        let Stream::Tls(mut stream) = stream else {
            return Ok(());
        };
        // TLS 1.3 sends the server's verdict on a client certificate after the client's
        // Finished: a refusal arrives as an alert, or as the connection closing. Nothing else
        // comes before a request.
        let mut probe = [0u8; 1];
        match tokio::time::timeout(Duration::from_millis(300), stream.read(&mut probe)).await {
            Err(_) => Ok(()),
            Ok(Ok(0)) => Err("the server closed the connection after the handshake".to_owned()),
            Ok(Ok(_)) => Err("the server sent data before any request".to_owned()),
            Ok(Err(error)) => Err(error.to_string()),
        }
    }

    /// Open a connection, let the server's post-handshake messages (session tickets) arrive, and
    /// say whether the handshake was full or resumed an earlier session.
    pub async fn handshake_kind(&self) -> Result<rustls::HandshakeKind, String> {
        let Stream::Tls(mut stream) = self.open().await? else {
            return Err("not a TLS client".to_owned());
        };
        let mut probe = [0u8; 1];
        let _ = tokio::time::timeout(Duration::from_millis(300), stream.read(&mut probe)).await;
        stream
            .get_ref()
            .1
            .handshake_kind()
            .ok_or_else(|| "no handshake".to_owned())
    }

    async fn open(&self) -> Result<Stream, String> {
        let tcp = TcpStream::connect(self.address)
            .await
            .map_err(|error| error.to_string())?;
        match &self.tls {
            None => Ok(Stream::Plain(tcp)),
            Some(config) => {
                let name = ServerName::IpAddress(self.address.ip().into());
                let stream = TlsConnector::from(Arc::clone(config))
                    .connect(name, tcp)
                    .await
                    .map_err(|error| error.to_string())?;
                Ok(Stream::Tls(Box::new(stream)))
            }
        }
    }

    /// Send `request` on a new connection. `Err` when the connection, the handshake or the
    /// exchange fails.
    pub async fn try_send(&self, request: Request<Full<Bytes>>) -> Result<Reply, String> {
        match self.open().await? {
            Stream::Plain(stream) => exchange(stream, request).await,
            Stream::Tls(stream) => exchange(*stream, request).await,
        }
    }

    pub async fn send(&self, request: Request<Full<Bytes>>) -> Reply {
        self.try_send(request).await.unwrap()
    }

    /// A request to `path` with this client's `Host`, `headers` and `body`.
    pub fn request(
        &self,
        method: &str,
        path: &str,
        headers: &[(&str, &str)],
        body: impl Into<Bytes>,
    ) -> Request<Full<Bytes>> {
        let mut request = Request::builder()
            .method(method)
            .uri(path)
            .header("host", &self.host);
        for (name, value) in headers {
            request = request.header(*name, *value);
        }
        request.body(Full::new(body.into())).unwrap()
    }

    /// GET `path` with `headers`.
    pub async fn get(&self, path: &str, headers: &[(&str, &str)]) -> Reply {
        self.send(self.request("GET", path, headers, Bytes::new()))
            .await
    }

    /// POST the JSON-RPC `body` to `/mcp` with a bearer `token` when given.
    pub async fn post_mcp(&self, body: &Value, token: Option<&str>) -> Reply {
        let bearer = token.map(|token| format!("Bearer {token}"));
        let mut headers = vec![
            ("content-type", "application/json"),
            ("accept", "application/json, text/event-stream"),
        ];
        if let Some(bearer) = &bearer {
            headers.push(("authorization", bearer));
        }
        self.send(self.request("POST", "/mcp", &headers, body.to_string()))
            .await
    }

    /// Write `bytes` on a new connection and read the answer until the server closes it or a
    /// second passes without data.
    pub async fn raw(&self, bytes: &[u8]) -> Result<String, String> {
        async fn run<S: AsyncRead + AsyncWrite + Unpin>(
            mut stream: S,
            bytes: &[u8],
        ) -> Result<String, String> {
            stream
                .write_all(bytes)
                .await
                .map_err(|error| error.to_string())?;
            let mut answer = Vec::new();
            let mut buffer = [0u8; 4096];
            loop {
                match tokio::time::timeout(Duration::from_secs(1), stream.read(&mut buffer)).await {
                    Ok(Ok(0)) | Err(_) => break,
                    Ok(Ok(read)) => answer.extend_from_slice(&buffer[..read]),
                    Ok(Err(error)) if answer.is_empty() => return Err(error.to_string()),
                    Ok(Err(_)) => break,
                }
            }
            Ok(String::from_utf8_lossy(&answer).into_owned())
        }
        match self.open().await? {
            Stream::Plain(stream) => run(stream, bytes).await,
            Stream::Tls(stream) => run(*stream, bytes).await,
        }
    }
}

enum Stream {
    Plain(TcpStream),
    Tls(Box<tokio_rustls::client::TlsStream<TcpStream>>),
}

async fn exchange<S>(stream: S, request: Request<Full<Bytes>>) -> Result<Reply, String>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let (mut sender, connection) =
        hyper::client::conn::http1::handshake(hyper_util::rt::TokioIo::new(stream))
            .await
            .map_err(|error| error.to_string())?;
    tokio::spawn(async move {
        let _ = connection.await;
    });
    let response = sender
        .send_request(request)
        .await
        .map_err(|error| error.to_string())?;
    let status = response.status().as_u16();
    let headers: HeaderMap = response.headers().clone();
    let bytes = response
        .into_body()
        .collect()
        .await
        .map_err(|error| error.to_string())?
        .to_bytes();
    Ok(Reply {
        status,
        headers,
        text: String::from_utf8_lossy(&bytes).into_owned(),
    })
}

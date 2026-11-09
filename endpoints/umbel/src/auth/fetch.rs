//! Umbel's outbound HTTPS for token verification (phase 5 specification, section 3.3): each
//! issuer's metadata and key set, and the one introspection endpoint.
//!
//! **HTTPS only, no redirects, 1 MiB, 10 seconds.** Every request goes to a URL derived from a
//! configured issuer or published in its verified metadata; a redirect is an error (it could
//! point anywhere, SSRF), an `http` URL is refused before any connection, a body is read in
//! chunks and refused past 1 MiB (or when `Content-Length` says so), and a whole fetch, metadata
//! and key set together, has 10 seconds. Nothing here logs a URL's query, a header or a body.
//!
//! **Whom it trusts.** An issuer without `ca_file` is reached through the platform's roots. An
//! issuer with `ca_file` (amendment from step 2c) is reached through a client of its own that
//! trusts **only** that file's roots: never the platform's, and never another issuer's, so a
//! private certificate authority vouches for its issuer alone.

use std::sync::Arc;
use std::time::Duration;

use afd::Clock;
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, HeaderValue};
use serde_json::{Map, Value};

/// The largest body read: 1 MiB.
pub(crate) const MAX_BODY_BYTES: usize = 1024 * 1024;
/// How long one fetch may take, metadata and key set together.
pub(crate) const FETCH_TIMEOUT: Duration = Duration::from_secs(10);

/// The test seams of the outbound client: extra trusted roots, the clock that ages caches and
/// tokens, and the timeout. A shipped build uses the platform's roots, the system clock and
/// [`FETCH_TIMEOUT`]; only the `testkit` feature's `HostBuilder` methods change them. The extra
/// roots stand beside the platform's, so they never reach an issuer with a `ca_file`.
#[derive(Clone)]
pub(crate) struct AuthEnvironment {
    pub(crate) roots: Vec<Vec<u8>>,
    pub(crate) clock: Arc<dyn Clock>,
    pub(crate) timeout: Duration,
    /// Secrets by environment variable name, read before the environment; only the `testkit`
    /// seam sets them (tests cannot set a variable: `unsafe_code` is forbidden).
    pub(crate) secrets: std::collections::BTreeMap<String, String>,
}

impl Default for AuthEnvironment {
    fn default() -> Self {
        Self {
            roots: Vec::new(),
            clock: Arc::new(afd::SYSTEM_CLOCK),
            timeout: FETCH_TIMEOUT,
            secrets: std::collections::BTreeMap::new(),
        }
    }
}

impl std::fmt::Debug for AuthEnvironment {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AuthEnvironment")
            .field("roots", &self.roots.len())
            .field("timeout", &self.timeout)
            .finish_non_exhaustive()
    }
}

/// Why a fetch gave no document. Logged as its code; never with the URL's details or the body.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FetchError {
    /// The server answered 404: the next discovery location may be tried.
    NotFound,
    /// Any other status, a redirect included.
    Status,
    /// The URL is not `https` or cannot be parsed.
    Insecure,
    /// The body is larger than [`MAX_BODY_BYTES`].
    TooLarge,
    /// The body is not one JSON object.
    Malformed,
    /// The connection, TLS or the time limit failed.
    Unreachable,
}

impl FetchError {
    /// The code logged.
    pub(crate) fn code(self) -> &'static str {
        match self {
            Self::NotFound => "not-found",
            Self::Status => "status",
            Self::Insecure => "insecure-url",
            Self::TooLarge => "too-large",
            Self::Malformed => "malformed",
            Self::Unreachable => "unreachable",
        }
    }
}

/// A JSON document and the cache lifetime its response asked for, in seconds (`max-age`).
pub(crate) struct Fetched {
    pub(crate) document: Map<String, Value>,
    pub(crate) max_age_s: Option<u64>,
}

/// The outbound HTTPS client.
#[derive(Clone)]
pub(crate) struct Fetcher {
    client: reqwest::Client,
}

impl std::fmt::Debug for Fetcher {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Fetcher")
    }
}

impl Fetcher {
    /// A client trusting the platform's roots and `environment.roots`.
    ///
    /// # Errors
    /// A root certificate that cannot be read, or a client that cannot be built.
    pub(crate) fn new(environment: &AuthEnvironment) -> Result<Self, String> {
        use rustls_pki_types::CertificateDer;
        use rustls_pki_types::pem::PemObject;
        use tokio_rustls::rustls;
        let roots = environment
            .roots
            .iter()
            .map(|pem| {
                CertificateDer::from_pem_slice(pem)
                    .map_err(|_| "a trusted root certificate cannot be read".to_owned())
            })
            .collect::<Result<Vec<_>, _>>()?;
        // The provider is passed explicitly, never read from the process default, which any
        // crate in the process could replace (step 0b's and 2a's reasoning).
        let provider = Arc::new(rustls::crypto::aws_lc_rs::default_provider());
        let verifier =
            rustls_platform_verifier::Verifier::new_with_extra_roots(roots, Arc::clone(&provider))
                .map_err(|_| "the platform's certificate verifier cannot be built".to_owned())?;
        let tls = rustls::ClientConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()
            .map_err(|_| "the TLS client cannot be built".to_owned())?
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(verifier))
            .with_no_client_auth();
        Self::with_tls(tls, environment)
    }

    /// A client trusting exactly `roots`, an issuer's `ca_file`: not the platform's roots, and not
    /// `environment.roots`. Every handshake is refused outside the window in which all of them
    /// are valid, so a root that expires while the process runs stops being trusted then.
    ///
    /// # Errors
    /// A root that cannot be a trust anchor, or a client that cannot be built.
    pub(crate) fn with_roots(
        roots: Vec<super::files::Certificate>,
        environment: &AuthEnvironment,
    ) -> Result<Self, String> {
        use tokio_rustls::rustls;
        let provider = Arc::new(rustls::crypto::aws_lc_rs::default_provider());
        let verifier = RootsInDate::new(roots, &provider)?;
        let tls = rustls::ClientConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()
            .map_err(|_| "the TLS client cannot be built".to_owned())?
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(verifier))
            .with_no_client_auth();
        Self::with_tls(tls, environment)
    }

    /// The HTTPS client over `tls`: HTTP/1.1, no redirect, no proxy, the time limit.
    fn with_tls(
        mut tls: tokio_rustls::rustls::ClientConfig,
        environment: &AuthEnvironment,
    ) -> Result<Self, String> {
        tls.alpn_protocols = vec![b"http/1.1".to_vec()];
        let client = reqwest::Client::builder()
            .tls_backend_preconfigured(tls)
            .https_only(true)
            .redirect(reqwest::redirect::Policy::none())
            // An environment proxy (`HTTPS_PROXY`) would see every issuer this host asks.
            .no_proxy()
            .timeout(environment.timeout)
            .connect_timeout(environment.timeout)
            .pool_max_idle_per_host(0)
            .build()
            .map_err(|_| "the HTTPS client for token verification cannot be built".to_owned())?;
        Ok(Self { client })
    }

    /// GET `url` as JSON.
    pub(crate) async fn get(&self, url: &str) -> Result<Fetched, FetchError> {
        let url = https(url)?;
        let request = self
            .client
            .get(url)
            .header(ACCEPT, HeaderValue::from_static("application/json"));
        self.send(request).await
    }

    /// POST the form `body` to `url`, authenticated with `authorization` (an RFC 6749 2.3.1
    /// `Basic` value), as JSON.
    pub(crate) async fn post_form(
        &self,
        url: &str,
        authorization: &HeaderValue,
        body: String,
    ) -> Result<Fetched, FetchError> {
        let url = https(url)?;
        let request = self
            .client
            .post(url)
            .header(ACCEPT, HeaderValue::from_static("application/json"))
            .header(
                CONTENT_TYPE,
                HeaderValue::from_static("application/x-www-form-urlencoded"),
            )
            .header(AUTHORIZATION, authorization.clone())
            .body(body);
        self.send(request).await
    }

    async fn send(&self, request: reqwest::RequestBuilder) -> Result<Fetched, FetchError> {
        let mut response = request.send().await.map_err(|_| FetchError::Unreachable)?;
        let status = response.status();
        if status == reqwest::StatusCode::NOT_FOUND {
            return Err(FetchError::NotFound);
        }
        if status != reqwest::StatusCode::OK {
            return Err(FetchError::Status);
        }
        if response
            .content_length()
            .is_some_and(|length| length > MAX_BODY_BYTES as u64)
        {
            return Err(FetchError::TooLarge);
        }
        let max_age_s = max_age(response.headers());
        let mut body: Vec<u8> = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| FetchError::Unreachable)?
        {
            if body.len() + chunk.len() > MAX_BODY_BYTES {
                return Err(FetchError::TooLarge);
            }
            body.extend_from_slice(&chunk);
        }
        match serde_json::from_slice::<Value>(&body) {
            Ok(Value::Object(document)) => Ok(Fetched {
                document,
                max_age_s,
            }),
            _ => Err(FetchError::Malformed),
        }
    }
}

/// WebPKI over an issuer's own roots, refusing every certificate outside the window in which all
/// of the roots are valid: WebPKI never checks a trust anchor's own dates, so without this an
/// expired private root would be trusted for as long as the process runs.
#[derive(Debug)]
pub(crate) struct RootsInDate {
    inner: Arc<tokio_rustls::rustls::client::WebPkiServerVerifier>,
    not_before: i64,
    not_after: i64,
}

impl RootsInDate {
    fn new(
        roots: Vec<super::files::Certificate>,
        provider: &Arc<tokio_rustls::rustls::crypto::CryptoProvider>,
    ) -> Result<Self, String> {
        use tokio_rustls::rustls;
        let not_before = roots.iter().map(|root| root.not_before).max();
        let not_after = roots.iter().map(|root| root.not_after).min();
        let (Some(not_before), Some(not_after)) = (not_before, not_after) else {
            return Err("holds no root certificate".to_owned());
        };
        let mut store = rustls::RootCertStore::empty();
        for root in roots {
            store
                .add(root.der)
                .map_err(|_| "holds a certificate that cannot be a trust anchor".to_owned())?;
        }
        let inner = rustls::client::WebPkiServerVerifier::builder_with_provider(
            Arc::new(store),
            Arc::clone(provider),
        )
        .build()
        .map_err(|_| "cannot verify servers with its roots".to_owned())?;
        Ok(Self {
            inner,
            not_before,
            not_after,
        })
    }
}

impl tokio_rustls::rustls::client::danger::ServerCertVerifier for RootsInDate {
    fn verify_server_cert(
        &self,
        end_entity: &rustls_pki_types::CertificateDer<'_>,
        intermediates: &[rustls_pki_types::CertificateDer<'_>],
        server_name: &rustls_pki_types::ServerName<'_>,
        ocsp_response: &[u8],
        now: rustls_pki_types::UnixTime,
    ) -> Result<tokio_rustls::rustls::client::danger::ServerCertVerified, tokio_rustls::rustls::Error>
    {
        use tokio_rustls::rustls::{CertificateError, Error};
        let now_s = i64::try_from(now.as_secs()).unwrap_or(i64::MAX);
        if now_s > self.not_after {
            return Err(Error::InvalidCertificate(CertificateError::Expired));
        }
        if now_s < self.not_before {
            return Err(Error::InvalidCertificate(CertificateError::NotValidYet));
        }
        self.inner
            .verify_server_cert(end_entity, intermediates, server_name, ocsp_response, now)
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &rustls_pki_types::CertificateDer<'_>,
        dss: &tokio_rustls::rustls::DigitallySignedStruct,
    ) -> Result<
        tokio_rustls::rustls::client::danger::HandshakeSignatureValid,
        tokio_rustls::rustls::Error,
    > {
        self.inner.verify_tls12_signature(message, cert, dss)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &rustls_pki_types::CertificateDer<'_>,
        dss: &tokio_rustls::rustls::DigitallySignedStruct,
    ) -> Result<
        tokio_rustls::rustls::client::danger::HandshakeSignatureValid,
        tokio_rustls::rustls::Error,
    > {
        self.inner.verify_tls13_signature(message, cert, dss)
    }

    fn supported_verify_schemes(&self) -> Vec<tokio_rustls::rustls::SignatureScheme> {
        self.inner.supported_verify_schemes()
    }
}

/// The client for `issuer`: one trusting only its `ca_file`'s roots when it names one, else
/// `platform`, the client over the platform's roots. `root` is the workspace a relative path is
/// read from; the roots must be valid on `environment`'s clock.
///
/// # Errors
/// What is wrong with the `ca_file`, naming the path, never its contents.
pub(crate) fn for_issuer(
    issuer: &crate::workspace::IssuerConfig,
    root: &std::path::Path,
    environment: &AuthEnvironment,
    platform: &Fetcher,
) -> Result<Fetcher, String> {
    let Some(path) = &issuer.ca_file else {
        return Ok(platform.clone());
    };
    let path = root.join(path);
    let now_s = environment.clock.now().div_euclid(1000);
    let roots = super::files::roots(&path, now_s)?;
    Fetcher::with_roots(roots, environment)
        .map_err(|problem| format!("{} {problem}", path.display()))
}

/// `url` parsed, when it is an absolute `https` URL with a host and no user information.
pub(crate) fn https(url: &str) -> Result<reqwest::Url, FetchError> {
    let parsed = reqwest::Url::parse(url).map_err(|_| FetchError::Insecure)?;
    let ok = parsed.scheme() == "https"
        && parsed.host_str().is_some_and(|host| !host.is_empty())
        && parsed.username().is_empty()
        && parsed.password().is_none();
    ok.then_some(parsed).ok_or(FetchError::Insecure)
}

/// The `max-age` of a `Cache-Control` header, in seconds; `None` without one, and `Some(0)` for
/// `no-store` or `no-cache`.
fn max_age(headers: &reqwest::header::HeaderMap) -> Option<u64> {
    let mut found = None;
    for value in headers.get_all(reqwest::header::CACHE_CONTROL) {
        let Ok(text) = value.to_str() else { continue };
        for directive in text.split(',') {
            let directive = directive.trim().to_ascii_lowercase();
            if directive == "no-store" || directive == "no-cache" {
                return Some(0);
            }
            if let Some(seconds) = directive.strip_prefix("max-age=") {
                found = seconds.trim_matches('"').parse::<u64>().ok().or(found);
            }
        }
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_https_urls_without_credentials_are_fetched() {
        assert!(https("https://idp.example.com/.well-known/openid-configuration").is_ok());
        for bad in [
            "http://idp.example.com/jwks",
            "https://user:pw@idp.example.com/jwks",
            "file:///etc/passwd",
            "jwks",
            "",
        ] {
            assert_eq!(https(bad).err(), Some(FetchError::Insecure), "{bad}");
        }
    }

    #[test]
    fn cache_control_gives_the_max_age() {
        let headers = |value: &str| {
            let mut map = reqwest::header::HeaderMap::new();
            map.insert(
                reqwest::header::CACHE_CONTROL,
                HeaderValue::from_str(value).unwrap(),
            );
            map
        };
        assert_eq!(max_age(&headers("public, max-age=600")), Some(600));
        assert_eq!(max_age(&headers("max-age=600, no-store")), Some(0));
        assert_eq!(max_age(&headers("no-cache")), Some(0));
        assert_eq!(max_age(&headers("public")), None);
        assert_eq!(max_age(&reqwest::header::HeaderMap::new()), None);
    }

    #[test]
    fn an_issuers_roots_stop_being_trusted_when_one_of_them_expires() {
        use tokio_rustls::rustls::client::danger::ServerCertVerifier;
        use tokio_rustls::rustls::{CertificateError, Error};
        let now = 2_000_000_000_i64;
        let ca = umbel_testkit_idp::TestCa::valid_between(now - 3_600, now + 86_400).unwrap();
        let server = ca.server_certificate(&["127.0.0.1"]).unwrap();
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("roots.pem");
        std::fs::write(&path, ca.certificate_pem()).unwrap();
        let mut roots = super::super::files::roots(&path, now).unwrap();
        let provider = Arc::new(tokio_rustls::rustls::crypto::aws_lc_rs::default_provider());
        // WebPKI alone still accepts the leaf after its root's notAfter: an anchor's own dates are
        // never checked. Here the root ends an hour into the leaf's validity.
        let webpki = RootsInDate::new(roots.clone(), &provider).unwrap().inner;
        roots[0].not_after = now + 3_600;
        let verifier = RootsInDate::new(roots, &provider).unwrap();
        let leaf = rustls_pki_types::CertificateDer::from(server.certificate_der().to_vec());
        let name = rustls_pki_types::ServerName::try_from("127.0.0.1").unwrap();
        let at = |seconds: i64| {
            rustls_pki_types::UnixTime::since_unix_epoch(Duration::from_secs(
                u64::try_from(seconds).unwrap(),
            ))
        };
        assert!(
            verifier
                .verify_server_cert(&leaf, &[], &name, &[], at(now))
                .is_ok()
        );
        let later = at(now + 7_200);
        assert!(
            webpki
                .verify_server_cert(&leaf, &[], &name, &[], later)
                .is_ok()
        );
        assert_eq!(
            verifier
                .verify_server_cert(&leaf, &[], &name, &[], later)
                .err(),
            Some(Error::InvalidCertificate(CertificateError::Expired))
        );
        assert_eq!(
            verifier
                .verify_server_cert(&leaf, &[], &name, &[], at(now - 7_200))
                .err(),
            Some(Error::InvalidCertificate(CertificateError::NotValidYet))
        );
    }

    #[test]
    fn the_caps_are_the_specifications() {
        assert_eq!(MAX_BODY_BYTES, 1_048_576);
        assert_eq!(FETCH_TIMEOUT, Duration::from_secs(10));
    }
}

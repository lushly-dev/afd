//! Umbel's outbound HTTPS for token verification (phase 5 specification, section 3.3): each
//! issuer's metadata and key set, and the one introspection endpoint.
//!
//! **HTTPS only, no redirects, 1 MiB, 10 seconds.** Every request goes to a URL derived from a
//! configured issuer or published in its verified metadata; a redirect is an error (it could
//! point anywhere, SSRF), an `http` URL is refused before any connection, a body is read in
//! chunks and refused past 1 MiB (or when `Content-Length` says so), and a whole fetch, metadata
//! and key set together, has 10 seconds. Nothing here logs a URL's query, a header or a body.

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
/// [`FETCH_TIMEOUT`]; only the `testkit` feature's `HostBuilder` methods change them.
#[derive(Clone)]
pub(crate) struct AuthEnvironment {
    pub(crate) roots: Vec<Vec<u8>>,
    pub(crate) clock: Arc<dyn Clock>,
    pub(crate) timeout: Duration,
    /// Serve mode `oauth` before the disclosure controls it needs exist (amendment from step
    /// 2b); only the `testkit` seam sets it.
    pub(crate) serve_oauth: bool,
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
            serve_oauth: false,
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
        let mut tls = rustls::ClientConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()
            .map_err(|_| "the TLS client cannot be built".to_owned())?
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(verifier))
            .with_no_client_auth();
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
    fn the_caps_are_the_specifications() {
        assert_eq!(MAX_BODY_BYTES, 1_048_576);
        assert_eq!(FETCH_TIMEOUT, Duration::from_secs(10));
    }
}
